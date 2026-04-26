// ====================================================
// MEASURE — geometric substrate construction
//
// Inlines: knn.ts, threshold.ts, mutualRank.ts, nodes.ts, substrate.ts
//
// Phase discipline (enforced invariant):
//   field  = buildPairwiseField(paragraphs, embeddings)   // embeddings only
//   stats  = computeStats(field)                           // field only
//   graph  = buildMutualRankGraph(field)                   // field only
//   nodes  = computeNodeStats(graph, paragraphs)           // graph + paragraphs only
//   health = deriveHealth(field, graph, nodes)             // already-computed values only
//
// INVERSION TEST: L1. Pure math on pairwise similarity distributions.
// ====================================================

import type { ShadowParagraph } from '../shadow/shadow-paragraph-projector';
import type {
  GeometricSubstrate,
  DegenerateSubstrate,
  DegenerateReason,
  NodeLocalStats,
  MutualRankGraph,
  MutualRankEdge,
  MutualRankNodeStats,
  MutualRecognitionThresholdStats,
  PairwiseField,
  PairwiseFieldStats,
  SubstrateHealth,
  ExtendedSimilarityStats,
} from './types';
import { computeUmapLayout } from './layout';

export type { MeasuredSubstrate, SubstrateHealth } from './types';
export { isDegenerate } from './types';

export interface SubstrateConfig {
  minParagraphs: number;
}

export const DEFAULT_SUBSTRATE_CONFIG: SubstrateConfig = {
  minParagraphs: 3,
};

// --─ Utilities --------------------------------------------------------------─

const QUANTIZATION = 1e6;

export function quantize(value: number): number {
  return Math.round(value * QUANTIZATION) / QUANTIZATION;
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
  }
  return dot;
}

export function computeExtendedStatsFromArray(allSims: number[]): ExtendedSimilarityStats {
  if (allSims.length === 0) {
    return {
      count: 0,
      min: 0,
      p10: 0,
      p25: 0,
      p50: 0,
      p75: 0,
      p80: 0,
      p90: 0,
      p95: 0,
      max: 0,
      mean: 0,
      stddev: 0,
    };
  }

  const sorted = allSims.slice().sort((a, b) => a - b);

  const percentile = (p: number) => {
    const idx = Math.floor(sorted.length * p);
    return sorted[Math.min(idx, sorted.length - 1)];
  };

  const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  const variance = sorted.reduce((s, x) => s + (x - mean) ** 2, 0) / sorted.length;

  return {
    count: sorted.length,
    min: sorted[0],
    p10: percentile(0.1),
    p25: percentile(0.25),
    p50: percentile(0.5),
    p75: percentile(0.75),
    p80: percentile(0.8),
    p90: percentile(0.9),
    p95: percentile(0.95),
    max: sorted[sorted.length - 1],
    mean,
    stddev: Math.sqrt(variance),
  };
}

// --─ Phase 1: Pairwise field --------------------------------------------------

export function buildPairwiseField(
  paragraphIds: string[],
  embeddings: Map<string, Float32Array>
): PairwiseField {
  const n = paragraphIds.length;
  const matrix = new Map<string, Map<string, number>>();
  const allSims: number[] = [];

  for (const id of paragraphIds) {
    matrix.set(id, new Map());
  }

  for (let i = 0; i < n; i++) {
    const idI = paragraphIds[i];
    const embI = embeddings.get(idI);
    if (!embI) continue;

    for (let j = i + 1; j < n; j++) {
      const idJ = paragraphIds[j];
      const embJ = embeddings.get(idJ);
      if (!embJ) continue;

      const sim = quantize(cosineSimilarity(embI, embJ));
      matrix.get(idI)!.set(idJ, sim);
      matrix.get(idJ)!.set(idI, sim);
      allSims.push(sim);
    }
  }

  const perNode = new Map<string, Array<{ nodeId: string; similarity: number }>>();
  for (const id of paragraphIds) {
    const row = matrix.get(id)!;
    const neighbors: Array<{ nodeId: string; similarity: number }> = [];
    for (const [neighborId, sim] of row) {
      neighbors.push({ nodeId: neighborId, similarity: sim });
    }
    neighbors.sort((a, b) => {
      if (a.similarity !== b.similarity) return b.similarity - a.similarity;
      return a.nodeId.localeCompare(b.nodeId);
    });
    perNode.set(id, neighbors);
  }

  const baseStats = computeExtendedStatsFromArray(allSims);
  const discriminationRange = baseStats.p90 - baseStats.p10;

  // Histogram — sqrt(N) bins over [min, max], algorithm-independent
  const binCount = Math.max(1, Math.ceil(Math.sqrt(allSims.length)));
  const binMin = baseStats.min;
  const binMax = baseStats.max;
  const spread = binMax - binMin;
  const binWidth = spread > 0 ? spread / binCount : 0;
  const histogram = new Array<number>(binCount).fill(0);
  if (binWidth > 0) {
    for (const s of allSims) {
      const raw = Math.floor((s - binMin) / binWidth);
      histogram[raw < 0 ? 0 : raw >= binCount ? binCount - 1 : raw]++;
    }
  } else if (allSims.length > 0) {
    histogram[0] = allSims.length;
  }

  const stats: PairwiseFieldStats = {
    ...baseStats,
    discriminationRange,
    histogram,
    binCount,
    binMin,
    binMax,
    binWidth,
  };

  return { matrix, perNode, stats, nodeCount: n };
}

// --─ Phase 2: Mutual recognition graph --------------------------------------─

export function buildMutualRankGraph(pairwiseField: PairwiseField): MutualRankGraph {
  const { perNode } = pairwiseField;

  const thresholdStats = new Map<string, MutualRecognitionThresholdStats>();
  const notableLookup = new Map<string, Set<string>>();

  for (const [nodeId, neighbors] of perNode) {
    const count = neighbors.length;
    if (count === 0) {
      thresholdStats.set(nodeId, {
        paragraphId: nodeId,
        mean: 0,
        stddev: 0,
        threshold: 0,
        notableNeighborCount: 0,
      });
      notableLookup.set(nodeId, new Set());
      continue;
    }

    let sum = 0;
    for (const n of neighbors) sum += n.similarity;
    const mean = sum / count;

    let variance = 0;
    for (const n of neighbors) {
      const d = n.similarity - mean;
      variance += d * d;
    }
    variance /= count;
    const stddev = Math.sqrt(variance);
    const threshold = mean + stddev;

    const notable = new Set<string>();
    for (const n of neighbors) {
      if (n.similarity > threshold) notable.add(n.nodeId);
    }

    thresholdStats.set(nodeId, {
      paragraphId: nodeId,
      mean,
      stddev,
      threshold,
      notableNeighborCount: notable.size,
    });
    notableLookup.set(nodeId, notable);
  }

  // Mutual edges — canonical form: source < target lexicographically
  const edges: MutualRankEdge[] = [];
  const seen = new Set<string>();

  for (const [nodeId, notableNeighbors] of notableLookup) {
    for (const neighborId of notableNeighbors) {
      const canonicalKey =
        nodeId < neighborId ? `${nodeId}|${neighborId}` : `${neighborId}|${nodeId}`;
      if (seen.has(canonicalKey)) continue;

      const neighborNotables = notableLookup.get(neighborId);
      if (!neighborNotables || !neighborNotables.has(nodeId)) continue;

      const source = nodeId < neighborId ? nodeId : neighborId;
      const target = nodeId < neighborId ? neighborId : nodeId;
      const simAB = pairwiseField.matrix.get(source)?.get(target);
      const simBA = pairwiseField.matrix.get(target)?.get(source);
      const similarity = simAB ?? simBA ?? 0;
      if (simAB === undefined && simBA === undefined) {
        console.warn(`[MutualRank] Missing similarity for pair ${source}|${target}`);
      }

      edges.push({ source, target, similarity });
      seen.add(canonicalKey);
    }
  }

  edges.sort((a, b) => `${a.source}|${a.target}`.localeCompare(`${b.source}|${b.target}`));

  const adjacency = new Map<string, MutualRankEdge[]>();
  for (const nodeId of perNode.keys()) {
    adjacency.set(nodeId, []);
  }
  for (const edge of edges) {
    adjacency.get(edge.source)!.push(edge);
    adjacency
      .get(edge.target)!
      .push({ source: edge.target, target: edge.source, similarity: edge.similarity });
  }

  const nodeStats = new Map<string, MutualRankNodeStats>();
  for (const nodeId of perNode.keys()) {
    const neighbors = adjacency.get(nodeId) || [];
    const neighborIds = neighbors.map((e) => e.target);
    const neighborhood = [nodeId, ...neighborIds].sort((a, b) => a.localeCompare(b));
    nodeStats.set(nodeId, {
      paragraphId: nodeId,
      mutualRankDegree: neighbors.length,
      isolated: neighbors.length === 0,
      mutualRankNeighborhood: neighborhood,
    });
  }

  return { edges, adjacency, nodeStats, thresholdStats };
}

// --─ Phase 3: Node stats ------------------------------------------------------

export function computeNodeStats(
  paragraphs: ShadowParagraph[],
  mutualRankGraph: MutualRankGraph
): NodeLocalStats[] {
  const nodes: NodeLocalStats[] = [];

  for (const p of paragraphs) {
    const id = p.id;
    const mrStats = mutualRankGraph.nodeStats.get(id);
    const mutualRankDegree = mrStats?.mutualRankDegree ?? 0;
    const patch = mrStats?.mutualRankNeighborhood ?? [id];
    const isolated = mrStats?.isolated ?? true;

    nodes.push({
      paragraphId: id,
      modelIndex: p.modelIndex,
      dominantStance: p.dominantStance,
      contested: p.contested,
      statementIds: [...p.statementIds],
      isolationScore: isolated ? 1 : 0,
      mutualNeighborhoodPatch: patch,
      mutualRankDegree,
    });
  }

  nodes.sort((a, b) => a.paragraphId.localeCompare(b.paragraphId));
  return nodes;
}

// --─ Phase 4: Health derivation ----------------------------------------------─

function deriveHealth(
  pairwiseField: PairwiseField,
  mutualRankGraph: MutualRankGraph,
  n: number
): SubstrateHealth {
  const edgeCount = mutualRankGraph.edges.length;
  const maxPossibleEdges = n > 1 ? (n * (n - 1)) / 2 : 0;
  let isolatedCount = 0;
  for (const ns of mutualRankGraph.nodeStats.values()) {
    if (ns.isolated) isolatedCount++;
  }
  return {
    isolationRatio: n > 0 ? isolatedCount / n : 1,
    edgeCount,
    edgeSaturation: maxPossibleEdges > 0 ? edgeCount / maxPossibleEdges : 0,
    discriminationRange: pairwiseField.stats.discriminationRange,
    nodeCount: n,
  };
}

// --─ Degenerate substrate ----------------------------------------------------─

function buildDegenerateSubstrate(
  paragraphs: ShadowParagraph[],
  reason: DegenerateReason,
  embeddingBackend: 'webgpu' | 'wasm' | 'none',
  buildTimeMs: number
): DegenerateSubstrate {
  const n = paragraphs.length;

  const nodes: NodeLocalStats[] = paragraphs.map((p) => ({
    paragraphId: p.id,
    modelIndex: p.modelIndex,
    dominantStance: p.dominantStance,
    contested: p.contested,
    statementIds: [...p.statementIds],
    isolationScore: 1,
    mutualNeighborhoodPatch: [p.id],
    mutualRankDegree: 0,
  }));

  const nodeStats = new Map<string, MutualRankNodeStats>();
  for (const p of paragraphs) {
    nodeStats.set(p.id, {
      paragraphId: p.id,
      mutualRankDegree: 0,
      isolated: true,
      mutualRankNeighborhood: [p.id],
    });
  }
  const mutualRankGraph: MutualRankGraph = {
    edges: [],
    adjacency: new Map(paragraphs.map((p) => [p.id, []])),
    nodeStats,
    thresholdStats: new Map(),
  };

  const pairwiseField: PairwiseField = {
    matrix: new Map(paragraphs.map((p) => [p.id, new Map()])),
    perNode: new Map(paragraphs.map((p) => [p.id, []])),
    stats: {
      count: 0,
      min: 0,
      p10: 0,
      p25: 0,
      p50: 0,
      p75: 0,
      p80: 0,
      p90: 0,
      p95: 0,
      max: 0,
      mean: 0,
      stddev: 0,
      discriminationRange: 0,
      histogram: [],
      binCount: 0,
      binMin: 0,
      binMax: 0,
      binWidth: 0,
    },
    nodeCount: n,
  };

  return {
    degenerate: true,
    degenerateReason: reason,
    nodes,
    pairwiseField,
    mutualRankGraph,
    health: { isolationRatio: 1, edgeCount: 0, edgeSaturation: 0, discriminationRange: 0, nodeCount: n },
    meta: {
      embeddingSuccess: reason !== 'embedding_failure',
      embeddingBackend,
      nodeCount: n,
      similarityStats: { max: 0, p95: 0, p80: 0, p50: 0, mean: 0 },
      quantization: '1e-6',
      tieBreaker: 'lexicographic',
      buildTimeMs,
    },
  };
}

// --─ Main entry point --------------------------------------------------------─

/**
 * Build a MeasuredSubstrate from paragraphs and their embeddings.
 *
 * Strict phase discipline: each step reads only from the previous step's output.
 * Health is derived once and stored on the substrate — no re-traversal in gates.
 */
export function measureSubstrate(
  paragraphs: ShadowParagraph[],
  embeddings: Map<string, Float32Array> | null,
  embeddingBackend: 'webgpu' | 'wasm' | 'none' = 'wasm',
  config: SubstrateConfig = DEFAULT_SUBSTRATE_CONFIG
): GeometricSubstrate | DegenerateSubstrate {
  const startTime = performance.now();
  const n = paragraphs.length;

  if (n < config.minParagraphs) {
    return buildDegenerateSubstrate(
      paragraphs,
      'insufficient_paragraphs',
      embeddingBackend,
      performance.now() - startTime
    );
  }

  if (!embeddings || embeddings.size === 0) {
    return buildDegenerateSubstrate(
      paragraphs,
      'embedding_failure',
      embeddingBackend,
      performance.now() - startTime
    );
  }

  const paragraphIds = paragraphs.map((p) => p.id);

  // Phase 1 — Pairwise field
  const field = buildPairwiseField(paragraphIds, embeddings);

  // Degenerate: all embeddings identical
  if (field.stats.discriminationRange === 0 && field.nodeCount > 1) {
    return buildDegenerateSubstrate(
      paragraphs,
      'all_embeddings_identical',
      embeddingBackend,
      performance.now() - startTime
    );
  }

  // Phase 2 — Mutual recognition graph
  const graph = buildMutualRankGraph(field);

  // Phase 3 — Node stats (basin IDs are annotated post-construction via annotateSubstrateBasins)
  const nodes = computeNodeStats(paragraphs, graph);

  // Phase 4 — Health (reads already-computed values only, no re-traversal)
  const health = deriveHealth(field, graph, n);

  if (field.stats.discriminationRange < 0.1) {
    console.warn(
      `[Substrate] Insufficient embedding discrimination: range P90-P10 = ${field.stats.discriminationRange.toFixed(3)} < 0.10.`
    );
  }

  // Layout — side-computation, no downstream logic dependencies
  const layout2d = computeUmapLayout(paragraphIds, embeddings);

  const similarityStats = {
    max: field.stats.max,
    p95: field.stats.p95,
    p80: field.stats.p80,
    p50: field.stats.p50,
    mean: field.stats.mean,
  };

  return {
    nodes,
    pairwiseField: field,
    mutualRankGraph: graph,
    layout2d,
    health,
    meta: {
      embeddingSuccess: true,
      embeddingBackend,
      nodeCount: n,
      similarityStats,
      quantization: '1e-6',
      tieBreaker: 'lexicographic',
      buildTimeMs: performance.now() - startTime,
    },
  };
}

/**
 * Backward-compat alias for measureSubstrate.
 * Prefer measureSubstrate in new code.
 */
export const buildGeometricSubstrate = measureSubstrate;

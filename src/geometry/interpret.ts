// ======================================
// INTERPRET — substrate interpretation
//
// Inlines: interpretation/pipelineGates.ts, interpretation/regions.ts,
//          interpretation/profiles.ts, interpretation/periphery.ts,
//          interpretation/index.ts
//
// Collect-then-Construct invariant:
//   Objects are constructed once, fully. No typed domain object exists in a
//   partially-constructed state. Population-level metrics are derived before
//   any MeasuredRegion is constructed.
//
// Dual-geometry principle:
//   Basin topology → periphery, corpusMode, largestBasinRatio, basinByNodeId
//   Region topology → MeasuredRegion[], regionMeta, regionSource
//   These are two lenses. They must not be conflated.
//
// INVERSION TEST: L1. No semantic context crosses this boundary.
// ===========================================================

import type {
  GeometricSubstrate,
  NodeLocalStats,
  MeasuredRegion,
  SubstrateInterpretation,
  RegionizationMeta,
  PipelineGateResult,
  PeripheryResult,
  BasinNodeProfile,
  NodeStructuralProfile,
} from './types';
import { isDegenerate } from './types';
import { cosineSimilarity } from '../clustering/distance';
import { computeGapRegionalization } from './algorithms/gap-regionalization';
import { computeBasinInversion } from './algorithms/basin-inversion-bayesian';
import type { BasinInversionResult } from '../../shared/types';
import type { GapRegionalizationResult } from './algorithms/gap-regionalization';

export type {
  SubstrateInterpretation,
  MeasuredRegion,
  RegionizationMeta,
  CorpusMode,
  PeripheryResult,
  PipelineGateResult,
  GateVerdict,
  BasinNodeProfile,
  NodeStructuralProfile,
} from './types';

// --- Gate constants ----------------------------------------

const DISCRIMINATION_MIN_RANGE = 0.1;
const ISOLATION_SKIP_THRESHOLD = 0.7;
const GATE_CONFIDENCE_BASELINE = 0.25;
const GATE_DENSITY_WEIGHT = 0.45;
const GATE_DENSITY_SATURATION = 0.35;
const GATE_CONNECTIVITY_WEIGHT = 0.3;
const GATE_CONNECTIVITY_SATURATION = 0.9;

function clamp01(value: number): number {
  return value <= 0 ? 0 : value >= 1 ? 1 : value;
}

function formatPct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

// ----- Step 1: Gate evaluation ---------------------------------

function evaluateGate(substrate: GeometricSubstrate): PipelineGateResult {
  const { isolationRatio, edgeCount, density, discriminationRange, nodeCount } = substrate.health;

  const measurements: PipelineGateResult['measurements'] = {
    isDegenerate: isDegenerate(substrate),
    isolationRatio,
    edgeCount,
    density,
    discriminationRange,
    nodeCount,
  };

  if (measurements.isDegenerate) {
    return {
      verdict: 'skip_geometry',
      confidence: 1,
      evidence: ['degenerate_substrate=true'],
      measurements,
    };
  }

  const evidence: string[] = [
    `mutual_recognition_edges=${edgeCount}`,
    `discrimination_range=${discriminationRange.toFixed(3)}`,
    `isolation_ratio=${formatPct(isolationRatio)}`,
    `density=${density.toFixed(4)}`,
  ];

  if (edgeCount === 0 || discriminationRange < DISCRIMINATION_MIN_RANGE) {
    return {
      verdict: 'skip_geometry',
      confidence: 0.9,
      evidence: [
        ...evidence,
        edgeCount === 0
          ? 'no_mutual_recognition_edges'
          : `discrimination_range_below_floor(${discriminationRange.toFixed(3)}<${DISCRIMINATION_MIN_RANGE})`,
      ],
      measurements,
    };
  }

  if (isolationRatio > ISOLATION_SKIP_THRESHOLD) {
    const confidence = clamp01(
      (isolationRatio - ISOLATION_SKIP_THRESHOLD) / (1 - ISOLATION_SKIP_THRESHOLD)
    );
    return {
      verdict: 'insufficient_structure',
      confidence,
      evidence: [
        ...evidence,
        `isolation_above_threshold(${formatPct(isolationRatio)}>${formatPct(ISOLATION_SKIP_THRESHOLD)})`,
      ],
      measurements,
    };
  }

  const proceedConfidence = clamp01(
    GATE_CONFIDENCE_BASELINE +
      GATE_DENSITY_WEIGHT * clamp01(density / GATE_DENSITY_SATURATION) +
      GATE_CONNECTIVITY_WEIGHT * clamp01((1 - isolationRatio) / GATE_CONNECTIVITY_SATURATION)
  );

  return { verdict: 'proceed', confidence: proceedConfidence, evidence, measurements };
}

// ----- Step 3A: Raw topology index ---------------------------------------------------------------------------

interface TopologyIndex {
  nodeToBasin: Map<string, number>; // paragraphId → basinId
  nodeToGap: Map<string, number>; // paragraphId → gapId
  gapSizes: Map<number, number>; // gapId → node count
  nodeIsolation: Map<string, number>; // paragraphId → isolationScore
  nodeNeighborhood: Map<string, string[]>; // paragraphId → neighbor ids
}

function buildTopologyIndex(
  substrate: GeometricSubstrate,
  basinInversion?: BasinInversionResult | null,
  gapResult?: GapRegionalizationResult | null
): TopologyIndex {
  const nodeToBasin = new Map<string, number>();
  const nodeToGap = new Map<string, number>();
  const gapSizes = new Map<number, number>();
  const nodeIsolation = new Map<string, number>();
  const nodeNeighborhood = new Map<string, string[]>();

  // Basin index
  if (basinInversion?.status === 'ok' && Array.isArray(basinInversion.basins)) {
    for (const basin of basinInversion.basins) {
      for (const nodeId of basin.nodeIds) {
        nodeToBasin.set(nodeId, basin.basinId);
      }
    }
  }

  // Gap index
  if (gapResult && Array.isArray(gapResult.regions)) {
    for (const gr of gapResult.regions) {
      const size = (gr.allNodeIds as string[]).length;
      gapSizes.set(gr.id, size);
      for (const nodeId of gr.allNodeIds as string[]) {
        nodeToGap.set(nodeId, gr.id);
      }
    }
  }

  // Node isolation + neighborhood from substrate
  for (const node of substrate.nodes) {
    nodeIsolation.set(node.paragraphId, node.isolationScore);
    const neighbors = (substrate.mutualRankGraph.adjacency.get(node.paragraphId) || []).map(
      (e) => e.target
    );
    nodeNeighborhood.set(node.paragraphId, neighbors);
  }

  return { nodeToBasin, nodeToGap, gapSizes, nodeIsolation, nodeNeighborhood };
}

// ----- Step 3B: Region construction (identity only) ---------------------------------------------─

interface RawRegionIdentity {
  id: string;
  kind: 'basin' | 'gap';
  nodeIds: string[];
  statementIds: string[];
  modelIndices: number[];
  sourceId: string;
}

function uniqueSorted(numbers: number[]): number[] {
  return Array.from(new Set(numbers)).sort((a, b) => a - b);
}

function unionStatementIdsStable(
  nodeIds: string[],
  nodesById: Map<string, NodeLocalStats>
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const nodeId of nodeIds) {
    const node = nodesById.get(nodeId);
    if (!node) continue;
    for (const sid of node.statementIds) {
      if (seen.has(sid)) continue;
      seen.add(sid);
      out.push(sid);
    }
  }
  return out;
}

function collectRegionIdentities(
  substrate: GeometricSubstrate,
  gapResult?: GapRegionalizationResult | null
): RawRegionIdentity[] {
  const nodesById = new Map(substrate.nodes.map((n) => [n.paragraphId, n]));
  const identities: RawRegionIdentity[] = [];
  let idx = 0;

  if (gapResult && Array.isArray(gapResult.regions)) {
    for (const gr of gapResult.regions) {
      const nodeIds: string[] = [...gr.allNodeIds];
      const modelIndices: number[] = [];
      for (const nodeId of nodeIds) {
        const node = nodesById.get(nodeId);
        if (node) modelIndices.push(node.modelIndex);
      }
      identities.push({
        id: `r_${idx++}`,
        kind: 'gap',
        nodeIds,
        statementIds: unionStatementIdsStable(nodeIds, nodesById),
        modelIndices: uniqueSorted(modelIndices),
        sourceId: `gap_${gr.id}`,
      });
    }
  }
  // Basin-sourced region construction removed — regions are always from gap.

  // Sort: gaps first, then by nodeCount descending, tiebreak lexicographic on id
  identities.sort((a, b) => {
    const kindOrder = { gap: 0, basin: 1 } as const;
    if (kindOrder[a.kind] !== kindOrder[b.kind]) return kindOrder[a.kind] - kindOrder[b.kind];
    if (b.nodeIds.length !== a.nodeIds.length) return b.nodeIds.length - a.nodeIds.length;
    return a.id.localeCompare(b.id);
  });

  // Re-index after sort (deterministic, order-dependent IDs)
  identities.forEach((r, i) => {
    r.id = `r_${i}`;
  });

  return identities;
}

// ----- Step 4: Population phase --------------------------------------------------------------------------------─

interface PopulationMetrics {
  nodeCount: number;
  modelDiversity: number;
  modelDiversityRatio: number;
  internalDensity: number;
  isolation: number;
  nearestCarrierSimilarity: number;
  avgInternalSimilarity: number;
}

function computeInternalDensity(nodeIds: string[], substrate: GeometricSubstrate): number {
  if (nodeIds.length < 2) return 0;
  const nodeSet = new Set(nodeIds);
  let internalEdges = 0;
  for (const edge of substrate.mutualRankGraph.edges) {
    if (nodeSet.has(edge.source) && nodeSet.has(edge.target)) internalEdges++;
  }
  const maxPossible = (nodeIds.length * (nodeIds.length - 1)) / 2;
  return maxPossible > 0 ? internalEdges / maxPossible : 0;
}

function computeAvgInternalSimilarity(nodeIds: string[], substrate: GeometricSubstrate): number {
  if (nodeIds.length < 2) return 0;
  const nodeSet = new Set(nodeIds);

  let sum = 0;
  let count = 0;
  for (const edge of substrate.mutualRankGraph.edges) {
    if (nodeSet.has(edge.source) && nodeSet.has(edge.target)) {
      if (typeof edge.similarity === 'number' && Number.isFinite(edge.similarity)) {
        sum += edge.similarity;
        count++;
      }
    }
  }
  if (count > 0) return sum / count;

  // Fallback: pairwise field
  for (let i = 0; i < nodeIds.length; i++) {
    const row = substrate.pairwiseField.matrix.get(nodeIds[i]);
    if (!row) continue;
    for (let j = i + 1; j < nodeIds.length; j++) {
      const sim = row.get(nodeIds[j]);
      if (typeof sim === 'number' && Number.isFinite(sim)) {
        sum += sim;
        count++;
      }
    }
  }
  return count > 0 ? sum / count : 0;
}

function computePopulationMetrics(
  identities: RawRegionIdentity[],
  substrate: GeometricSubstrate,
  paragraphEmbeddings?: Map<string, Float32Array> | null
): Map<string, PopulationMetrics> {
  const nodesById = new Map(substrate.nodes.map((n) => [n.paragraphId, n]));
  const observedModelCount = Math.max(1, new Set(substrate.nodes.map((n) => n.modelIndex)).size);

  // nearestCarrierSimilarity — pairwise across all regions
  const nearestCarrierByRegion = new Map<string, number>();
  for (const r of identities) nearestCarrierByRegion.set(r.id, 0);

  // Try centroid method first
  let usedCentroids = false;
  if (paragraphEmbeddings && paragraphEmbeddings.size > 0) {
    let dims = 0;
    outer: for (const r of identities) {
      for (const pid of r.nodeIds) {
        const emb = paragraphEmbeddings.get(pid);
        if (emb && emb.length > 0) {
          dims = emb.length;
          break outer;
        }
      }
    }

    if (dims > 0) {
      const centroids = new Map<string, Float32Array>();
      for (const r of identities) {
        const acc = new Float32Array(dims);
        let count = 0;
        for (const pid of r.nodeIds) {
          const emb = paragraphEmbeddings.get(pid);
          if (!emb || emb.length !== dims) continue;
          for (let i = 0; i < dims; i++) acc[i] += emb[i];
          count++;
        }
        if (count === 0) continue;
        for (let i = 0; i < dims; i++) acc[i] /= count;
        let norm = 0;
        for (let i = 0; i < dims; i++) norm += acc[i] * acc[i];
        norm = Math.sqrt(norm);
        if (norm > 0) for (let i = 0; i < dims; i++) acc[i] /= norm;
        centroids.set(r.id, acc);
      }

      const ids = Array.from(centroids.keys()).sort((a, b) => a.localeCompare(b));
      if (ids.length >= 2) {
        usedCentroids = true;
        for (let i = 0; i < ids.length; i++) {
          const ca = centroids.get(ids[i])!;
          for (let j = i + 1; j < ids.length; j++) {
            const cb = centroids.get(ids[j])!;
            const sim = Math.max(0, Math.min(1, cosineSimilarity(ca, cb)));
            if (sim > (nearestCarrierByRegion.get(ids[i]) ?? 0))
              nearestCarrierByRegion.set(ids[i], sim);
            if (sim > (nearestCarrierByRegion.get(ids[j]) ?? 0))
              nearestCarrierByRegion.set(ids[j], sim);
          }
        }
      }
    }
  }

  // Fallback: edge-bridge method
  if (!usedCentroids && identities.length >= 2) {
    const nodeToRegion = new Map<string, string>();
    for (const r of identities) for (const nodeId of r.nodeIds) nodeToRegion.set(nodeId, r.id);

    for (const edge of substrate.mutualRankGraph.edges) {
      const a = nodeToRegion.get(edge.source);
      const b = nodeToRegion.get(edge.target);
      if (!a || !b || a === b) continue;
      if (edge.similarity > (nearestCarrierByRegion.get(a) ?? 0))
        nearestCarrierByRegion.set(a, edge.similarity);
      if (edge.similarity > (nearestCarrierByRegion.get(b) ?? 0))
        nearestCarrierByRegion.set(b, edge.similarity);
    }
  }

  // Assemble population metrics per region
  const result = new Map<string, PopulationMetrics>();
  for (const r of identities) {
    const { nodeIds, modelIndices } = r;
    const modelDiversity = modelIndices.length;
    const modelDiversityRatio = observedModelCount > 0 ? modelDiversity / observedModelCount : 0;
    const internalDensity = computeInternalDensity(nodeIds, substrate);
    const avgInternalSimilarity = computeAvgInternalSimilarity(nodeIds, substrate);

    let totalIsolation = 0;
    for (const nodeId of nodeIds) {
      const node = nodesById.get(nodeId);
      if (node) totalIsolation += node.isolationScore;
    }
    const isolation = nodeIds.length > 0 ? totalIsolation / nodeIds.length : 1;

    result.set(r.id, {
      nodeCount: nodeIds.length,
      modelDiversity,
      modelDiversityRatio,
      internalDensity,
      isolation,
      nearestCarrierSimilarity: nearestCarrierByRegion.get(r.id) ?? 0,
      avgInternalSimilarity,
    });
  }

  return result;
}

// ----- Step 5: Construct MeasuredRegion[] ------------------------------------------------------------──

function constructMeasuredRegions(
  identities: RawRegionIdentity[],
  populationMetrics: Map<string, PopulationMetrics>
): MeasuredRegion[] {
  return identities.map((r) => {
    const pop = populationMetrics.get(r.id) ?? {
      nodeCount: r.nodeIds.length,
      modelDiversity: 0,
      modelDiversityRatio: 0,
      internalDensity: 0,
      isolation: 1,
      nearestCarrierSimilarity: 0,
      avgInternalSimilarity: 0,
    };
    return {
      id: r.id,
      kind: r.kind,
      nodeIds: r.nodeIds,
      statementIds: r.statementIds,
      sourceId: r.sourceId,
      modelIndices: r.modelIndices,
      nodeCount: pop.nodeCount,
      modelDiversity: pop.modelDiversity,
      modelDiversityRatio: pop.modelDiversityRatio,
      internalDensity: pop.internalDensity,
      isolation: pop.isolation,
      nearestCarrierSimilarity: pop.nearestCarrierSimilarity,
      avgInternalSimilarity: pop.avgInternalSimilarity,
    };
  });
}

// ----- Step 6: Corpus mode + periphery (basin authority) -----------------------------------──

export function identifyPeriphery(
  basinInversion: BasinInversionResult | null,
  regionsOrTopologyIndex?:
    | { kind: 'basin' | 'gap'; nodeIds: string[] }[]
    | { nodeToGap: Map<string, number>; gapSizes: Map<number, number> }
): PeripheryResult {
  const empty: PeripheryResult = {
    corpusMode: 'no-geometry',
    peripheralNodeIds: new Set(),
    peripheralRatio: 0,
    largestBasinRatio: null,
    basinByNodeId: {},
  };

  if (!basinInversion || basinInversion.status !== 'ok' || !basinInversion.basins?.length) {
    return empty;
  }

  const ratio = basinInversion.largestBasinRatio;
  if (ratio == null) return empty;

  const totalNodes = basinInversion.nodeCount;
  if (totalNodes === 0) return empty;

  if (ratio <= 0.5) {
    return {
      corpusMode: 'parallel-cores',
      peripheralNodeIds: new Set(),
      peripheralRatio: 0,
      largestBasinRatio: ratio,
      basinByNodeId: basinInversion.basinByNodeId ?? {},
    };
  }

  // Dominant-core: largest basin is the core
  let largestBasin = basinInversion.basins[0];
  for (const b of basinInversion.basins) {
    if (b.nodeIds.length > largestBasin.nodeIds.length) largestBasin = b;
  }

  const coreNodeIds = new Set<string>(largestBasin.nodeIds);
  const peripheralNodeIds = new Set<string>();

  for (const b of basinInversion.basins) {
    if (b.basinId === largestBasin.basinId) continue;
    for (const nodeId of b.nodeIds) peripheralNodeIds.add(nodeId);
  }

  // Gap singletons outside core — authority is basin topology (via topology index or region list)
  if (regionsOrTopologyIndex) {
    if ('nodeToGap' in regionsOrTopologyIndex) {
      // Topology index path (internal usage)
      const { nodeToGap, gapSizes } = regionsOrTopologyIndex;
      for (const [nodeId, gapId] of nodeToGap) {
        if (gapSizes.get(gapId) === 1 && !coreNodeIds.has(nodeId)) {
          peripheralNodeIds.add(nodeId);
        }
      }
    } else {
      // Legacy MinimalRegion[] path (backward compat for deterministicPipeline.js fallback)
      for (const r of regionsOrTopologyIndex) {
        if (r.kind === 'gap' && r.nodeIds.length === 1) {
          const nodeId = r.nodeIds[0];
          if (!coreNodeIds.has(nodeId)) peripheralNodeIds.add(nodeId);
        }
      }
    }
  }

  return {
    corpusMode: 'dominant-core',
    peripheralNodeIds,
    peripheralRatio: totalNodes > 0 ? peripheralNodeIds.size / totalNodes : 0,
    largestBasinRatio: ratio,
    basinByNodeId: basinInversion.basinByNodeId ?? {},
  };
}

function deriveCorpusMode(
  basinInversion: BasinInversionResult | null,
  topologyIndex: TopologyIndex,
  _totalNodes: number
): Pick<
  SubstrateInterpretation,
  'corpusMode' | 'peripheralNodeIds' | 'peripheralRatio' | 'largestBasinRatio' | 'basinByNodeId'
> {
  const periphery = identifyPeriphery(basinInversion, {
    nodeToGap: topologyIndex.nodeToGap,
    gapSizes: topologyIndex.gapSizes,
  });

  return {
    corpusMode: periphery.corpusMode,
    peripheralNodeIds: periphery.peripheralNodeIds,
    peripheralRatio: periphery.peripheralRatio,
    largestBasinRatio: periphery.largestBasinRatio,
    basinByNodeId: periphery.basinByNodeId,
  };
}

// ----- Basin node profiles ------------------------------------------------------------------------------------------

function buildBasinNodeProfiles(
  substrate: GeometricSubstrate,
  basinInversion: BasinInversionResult | null
): Map<string, BasinNodeProfile> {
  const profiles = new Map<string, BasinNodeProfile>();

  if (!basinInversion || basinInversion.status !== 'ok' || !basinInversion.basins?.length) {
    for (const node of substrate.nodes) {
      profiles.set(node.paragraphId, {
        basinId: null,
        intraBasinSimilarity: 0,
        interBasinSimilarity: 0,
        separationDelta: 0,
      });
    }
    return profiles;
  }

  const nodeBasin = new Map<string, number>();
  for (const basin of basinInversion.basins) {
    for (const nodeId of basin.nodeIds) {
      nodeBasin.set(nodeId, basin.basinId);
    }
  }

  for (const node of substrate.nodes) {
    const pid = node.paragraphId;
    const bid = nodeBasin.get(pid) ?? null;

    if (bid == null) {
      profiles.set(pid, {
        basinId: null,
        intraBasinSimilarity: 0,
        interBasinSimilarity: 0,
        separationDelta: 0,
      });
      continue;
    }

    const row = substrate.pairwiseField.matrix.get(pid);
    if (!row) {
      profiles.set(pid, {
        basinId: bid,
        intraBasinSimilarity: 0,
        interBasinSimilarity: 0,
        separationDelta: 0,
      });
      continue;
    }

    let intraSum = 0,
      intraCount = 0;
    let interSum = 0,
      interCount = 0;

    for (const [otherId, sim] of row) {
      if (otherId === pid) continue;
      const otherBasin = nodeBasin.get(otherId);
      if (otherBasin === bid) {
        intraSum += sim;
        intraCount++;
      } else {
        interSum += sim;
        interCount++;
      }
    }

    const intra = intraCount > 0 ? intraSum / intraCount : 0;
    const inter = interCount > 0 ? interSum / interCount : 0;

    profiles.set(pid, {
      basinId: bid,
      intraBasinSimilarity: intra,
      interBasinSimilarity: inter,
      separationDelta: intra - inter,
    });
  }

  return profiles;
}

// ----- Structural profiles ------------------------------------------------------------------------------------------

function buildStructuralProfiles(
  substrate: GeometricSubstrate,
  gapResult: GapRegionalizationResult | null,
  basinNodeProfiles: Map<string, BasinNodeProfile>
): Map<string, NodeStructuralProfile> {
  const profiles = new Map<string, NodeStructuralProfile>();
  const N = substrate.nodes.length;
  const maxDegree = Math.max(1, N - 1);

  for (const node of substrate.nodes) {
    const pid = node.paragraphId;

    // Connectivity: mutual rank degree normalized by (N-1)
    const edges = substrate.mutualRankGraph.adjacency.get(pid);
    const connectivity = N <= 1 ? 0 : clamp01((edges?.length ?? 0) / maxDegree);

    // Gap strength: upper boundary from NodeGapProfile (local discontinuity)
    const gapProfile = gapResult?.nodeProfiles?.[pid];
    const gapStrength = gapProfile?.upperBoundary != null ? clamp01(gapProfile.upperBoundary) : 0;

    // Basin fields from BasinNodeProfile
    const basinProfile = basinNodeProfiles.get(pid);

    profiles.set(pid, {
      paragraphId: pid,
      connectivity,
      gapStrength,
      basinId: basinProfile?.basinId ?? null,
      basinSeparationDelta: basinProfile?.separationDelta ?? 0,
    });
  }

  return profiles;
}

// ----- Orchestrator ----------------------------------------------------------------------------------------------------─

/**
 * Interpret a measured substrate: gate → basin → gap → collect → populate
 * → construct → periphery.
 *
 * Basin is computed internally as a parallel structural signal.
 * Regions are ALWAYS from gap — no selection step.
 *
 * Phase discipline: reads only from substrate + paragraphs. No semantic context
 * crosses this boundary (L1-only).
 */
export function interpretSubstrate(
  substrate: GeometricSubstrate,
  paragraphEmbeddings?: Map<string, Float32Array> | null
): SubstrateInterpretation {
  // Step 1 — Gate (reads substrate.health only)
  const gate = evaluateGate(substrate);

  const emptyMeta: RegionizationMeta = {
    regionCount: 0,
    kindCounts: { basin: 0, gap: 0 },
    coveredNodes: 0,
    totalNodes: substrate.nodes.length,
  };

  // Compute basin internally — parallel structural signal
  const basinInversion = gate.verdict !== 'skip_geometry' ? computeBasinInversion(substrate) : null;

  if (gate.verdict === 'skip_geometry') {
    const periphery = identifyPeriphery(basinInversion);
    const nodeAnnotations = new Map<string, { basinId: number | null; regionId: string | null }>();
    for (const node of substrate.nodes) {
      nodeAnnotations.set(node.paragraphId, { basinId: null, regionId: null });
    }
    const basinNodeProfiles = buildBasinNodeProfiles(substrate, basinInversion);
    const structuralProfiles = buildStructuralProfiles(substrate, null, basinNodeProfiles);
    return {
      gate,
      regions: [],
      regionMeta: emptyMeta,
      corpusMode: periphery.corpusMode,
      peripheralNodeIds: periphery.peripheralNodeIds,
      peripheralRatio: periphery.peripheralRatio,
      largestBasinRatio: periphery.largestBasinRatio,
      basinByNodeId: periphery.basinByNodeId,
      basinInversion,
      nodeAnnotations,
      structuralProfiles,
      basinNodeProfiles,
    };
  }

  // Compute gap result — regions are ALWAYS from gap
  let gapResult: GapRegionalizationResult | null = null;
  if (paragraphEmbeddings && paragraphEmbeddings.size > 0) {
    const nodes = substrate.nodes
      .map((n) => ({ id: n.paragraphId, embedding: paragraphEmbeddings.get(n.paragraphId)! }))
      .filter((n) => n.embedding != null);
    if (nodes.length > 0) {
      gapResult = computeGapRegionalization(nodes);
    }
  }

  // Step 3A — Raw topology index (plain data, no typed objects)
  const topologyIndex = buildTopologyIndex(substrate, basinInversion, gapResult);

  // Step 3B — Region identities (structural, no metrics — always from gap)
  const identities = collectRegionIdentities(substrate, gapResult);

  // Step 4 — Population phase (all regions known before metrics computed)
  const populationMetrics = computePopulationMetrics(identities, substrate, paragraphEmbeddings);

  // Step 5 — Construct (each MeasuredRegion built fully in one shot)
  const regions = constructMeasuredRegions(identities, populationMetrics);

  // Region meta
  const kindCounts: Record<'basin' | 'gap', number> = { basin: 0, gap: 0 };
  const coveredNodes = new Set<string>();
  for (const r of regions) {
    kindCounts[r.kind]++;
    for (const nodeId of r.nodeIds) coveredNodes.add(nodeId);
  }
  const regionMeta: RegionizationMeta = {
    regionCount: regions.length,
    kindCounts,
    coveredNodes: coveredNodes.size,
    totalNodes: substrate.nodes.length,
  };

  // Step 6 — Corpus mode + periphery (authority: basin topology, not regions)
  const corpus = deriveCorpusMode(basinInversion, topologyIndex, substrate.nodes.length);

  // Build nodeAnnotations — derived map, no substrate mutation
  const nodeAnnotations = new Map<string, { basinId: number | null; regionId: string | null }>();
  const regionByNode = new Map<string, string>();
  for (const r of regions) {
    for (const nodeId of r.nodeIds) regionByNode.set(nodeId, r.id);
  }
  for (const node of substrate.nodes) {
    const bid = basinInversion?.basinByNodeId?.[node.paragraphId] ?? null;
    const rid = regionByNode.get(node.paragraphId) ?? null;
    nodeAnnotations.set(node.paragraphId, { basinId: bid, regionId: rid });
  }

  // Step 7 — Structural profiles (measurement layer)
  const basinNodeProfiles = buildBasinNodeProfiles(substrate, basinInversion);
  const structuralProfiles = buildStructuralProfiles(substrate, gapResult, basinNodeProfiles);

  return {
    gate,
    regions,
    regionMeta,
    ...corpus,
    basinInversion,
    nodeAnnotations,
    structuralProfiles,
    basinNodeProfiles,
  };
}

/**
 * Backward-compat alias. Prefer interpretSubstrate in new code.
 */
export function buildPreSemanticInterpretation(
  substrate: GeometricSubstrate,
  paragraphEmbeddings?: Map<string, Float32Array> | null,
  _queryRelevanceBoost?: unknown
): SubstrateInterpretation {
  return interpretSubstrate(substrate, paragraphEmbeddings);
}

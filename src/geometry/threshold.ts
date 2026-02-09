// ═══════════════════════════════════════════════════════════════════════════
// SOFT THRESHOLD COMPUTATION
// ═══════════════════════════════════════════════════════════════════════════

import type { MutualKnnEdge, MutualKnnGraph, StrongGraph } from './types';
import { quantize } from './knn';

export interface ThresholdConfig {
  method: 'p80_top1' | 'p75_top1' | 'fixed';
  fixedValue?: number;
  clampMin: number;
  clampMax: number;
}

export const DEFAULT_THRESHOLD_CONFIG: ThresholdConfig = {
  method: 'p80_top1',
  clampMin: 0.55,
  clampMax: 0.78,
};

/**
 * Compute soft threshold from top-1 similarity distribution.
 * 
 * This creates a "field intensity cutoff" for structural edges
 * without forcing any merges.
 */
export function computeSoftThreshold(
  top1Sims: Map<string, number>,
  config: ThresholdConfig = DEFAULT_THRESHOLD_CONFIG
): number {
  if (config.method === 'fixed') {
    return config.fixedValue ?? 0.65;
  }

  // Collect all top-1 similarities
  const sims = Array.from(top1Sims.values()).filter(s => s > 0);

  if (sims.length === 0) {
    return config.clampMin; // Degenerate case
  }

  // Sort ascending for percentile
  sims.sort((a, b) => a - b);

  // Compute percentile
  const percentile = config.method === 'p80_top1' ? 0.80 : 0.75;
  const idx = Math.floor(sims.length * percentile);
  const rawThreshold = sims[Math.min(idx, sims.length - 1)];

  // Clamp to sanity bounds
  const clamped = Math.max(config.clampMin, Math.min(config.clampMax, rawThreshold));

  return quantize(clamped);
}

/**
 * Build strong graph: subset of mutual edges where similarity >= threshold.
 */
export function buildStrongGraph(
  mutual: MutualKnnGraph,
  paragraphIds: string[],
  softThreshold: number,
  thresholdMethod: ThresholdConfig['method']
): StrongGraph {
  const strongEdges: MutualKnnEdge[] = [];
  const strongAdjacency = new Map<string, MutualKnnEdge[]>();

  // Initialize adjacency
  for (const id of paragraphIds) {
    strongAdjacency.set(id, []);
  }

  // Filter mutual edges by threshold
  for (const edge of mutual.edges) {
    if (edge.similarity >= softThreshold) {
      if (!strongAdjacency.has(edge.source) || !strongAdjacency.has(edge.target)) {
        continue;
      }

      strongEdges.push(edge);
      strongAdjacency.get(edge.source)!.push(edge);
      strongAdjacency.get(edge.target)!.push({
        source: edge.target,
        target: edge.source,
        similarity: edge.similarity,
        rank: edge.rank,
      });
    }
  }

  return {
    softThreshold,
    thresholdMethod,
    edges: strongEdges,
    adjacency: strongAdjacency,
  };
}

/**
 * Compute similarity distribution stats (for meta).
 */
export function computeSimilarityStats(
  topKSims: Map<string, number[]>
): {
  max: number;
  p95: number;
  p80: number;
  p50: number;
  mean: number;
} {
  // Flatten all similarities
  const allSims: number[] = [];
  for (const sims of topKSims.values()) {
    allSims.push(...sims);
  }

  if (allSims.length === 0) {
    return { max: 0, p95: 0, p80: 0, p50: 0, mean: 0 };
  }

  allSims.sort((a, b) => a - b);

  const percentile = (p: number) => {
    const idx = Math.floor(allSims.length * p);
    return allSims[Math.min(idx, allSims.length - 1)];
  };

  return {
    max: allSims[allSims.length - 1],
    p95: percentile(0.95),
    p80: percentile(0.80),
    p50: percentile(0.50),
    mean: allSims.reduce((a, b) => a + b, 0) / allSims.length,
  };
}
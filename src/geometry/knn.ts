// ═══════════════════════════════════════════════════════════════════════════
// PAIRWISE FIELD BUILDER
// ═══════════════════════════════════════════════════════════════════════════

import type { PairwiseField, PairwiseFieldStats } from './types';
import { computeExtendedStatsFromArray } from './threshold';

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

/**
 * Build the full pairwise similarity field.
 *
 * Stores both directions in the matrix, builds sorted per-node neighbor lists,
 * and computes extended distribution stats with discrimination range.
 *
 * At N=102 this is ~5K unique pairs — trivial cost.
 */
export function buildPairwiseField(
  paragraphIds: string[],
  embeddings: Map<string, Float32Array>
): PairwiseField {
  const n = paragraphIds.length;
  const matrix = new Map<string, Map<string, number>>();
  const allSims: number[] = [];

  // Initialize matrix rows
  for (const id of paragraphIds) {
    matrix.set(id, new Map());
  }

  // Compute all pairwise similarities
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

  // Build per-node sorted neighbor lists (descending similarity, lexicographic tie-break)
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

  // Compute stats
  const baseStats = computeExtendedStatsFromArray(allSims);
  const stats: PairwiseFieldStats = {
    ...baseStats,
    discriminationRange: baseStats.p90 - baseStats.p10,
  };

  return { matrix, perNode, stats, nodeCount: n };
}

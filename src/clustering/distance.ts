// ═══════════════════════════════════════════════════════════════════════════
// SIMILARITY UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Cosine similarity between two normalized vectors.
 * Assumes vectors are already L2 normalized.
 */
let cosineSimilarityDimensionMismatchCount = 0;

export function getCosineSimilarityDimensionMismatchCount(): number {
  return cosineSimilarityDimensionMismatchCount;
}

export function resetCosineSimilarityDimensionMismatchCount(): void {
  cosineSimilarityDimensionMismatchCount = 0;
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    cosineSimilarityDimensionMismatchCount += 1;
    console.warn('[cosineSimilarity] dimension mismatch', {
      leftLength: a.length,
      rightLength: b.length,
      count: cosineSimilarityDimensionMismatchCount,
    });
  }

  let dot = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
  }
  return dot;
}

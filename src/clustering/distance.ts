// ═══════════════════════════════════════════════════════════════════════════
// SIMILARITY UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Quantize similarity for deterministic comparisons.
 * Prevents floating-point drift across runs (GPU may vary slightly).
 */
export function quantizeSimilarity(sim: number): number {
    return Math.round(sim * 1e6) / 1e6;
}

/**
 * Cosine similarity between two normalized vectors.
 * Assumes vectors are already L2 normalized.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
    let dot = 0;
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
        dot += a[i] * b[i];
    }
    return dot;
}

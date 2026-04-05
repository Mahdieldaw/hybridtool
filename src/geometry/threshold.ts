// ═══════════════════════════════════════════════════════════════════════════
// SIMILARITY STATS
// ═══════════════════════════════════════════════════════════════════════════

export interface ExtendedSimilarityStats {
  count: number;
  min: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p80: number;
  p90: number;
  p95: number;
  max: number;
  mean: number;
  stddev: number;
}

/**
 * Compute full distribution stats for threshold auditing.
 */
export function computeExtendedSimilarityStats(
  topKSims: Map<string, number[]>
): ExtendedSimilarityStats {
  const allSims: number[] = [];
  for (const sims of topKSims.values()) {
    allSims.push(...sims);
  }

  if (allSims.length === 0) {
    return { count: 0, min: 0, p10: 0, p25: 0, p50: 0, p75: 0, p80: 0, p90: 0, p95: 0, max: 0, mean: 0, stddev: 0 };
  }

  allSims.sort((a, b) => a - b);

  const percentile = (p: number) => {
    const idx = Math.floor(allSims.length * p);
    return allSims[Math.min(idx, allSims.length - 1)];
  };

  const mean = allSims.reduce((a, b) => a + b, 0) / allSims.length;
  const variance = allSims.reduce((s, x) => s + (x - mean) ** 2, 0) / allSims.length;

  return {
    count: allSims.length,
    min: allSims[0],
    p10: percentile(0.10),
    p25: percentile(0.25),
    p50: percentile(0.50),
    p75: percentile(0.75),
    p80: percentile(0.80),
    p90: percentile(0.90),
    p95: percentile(0.95),
    max: allSims[allSims.length - 1],
    mean,
    stddev: Math.sqrt(variance),
  };
}

/**
 * Compute full distribution stats from a flat array of similarities.
 * Same logic as computeExtendedSimilarityStats but takes a pre-flattened array.
 */
export function computeExtendedStatsFromArray(
  allSims: number[]
): ExtendedSimilarityStats {
  if (allSims.length === 0) {
    return { count: 0, min: 0, p10: 0, p25: 0, p50: 0, p75: 0, p80: 0, p90: 0, p95: 0, max: 0, mean: 0, stddev: 0 };
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
    p10: percentile(0.10),
    p25: percentile(0.25),
    p50: percentile(0.50),
    p75: percentile(0.75),
    p80: percentile(0.80),
    p90: percentile(0.90),
    p95: percentile(0.95),
    max: sorted[sorted.length - 1],
    mean,
    stddev: Math.sqrt(variance),
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
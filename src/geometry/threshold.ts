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
 * Compute full distribution stats from a flat array of similarities.
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


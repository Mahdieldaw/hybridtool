// ─────────────────────────────────────────────────────────────────────────
// ADD to shared/contract.ts — inside PassageClaimRouting.diagnostics
// ─────────────────────────────────────────────────────────────────────────

// Replace the existing diagnostics block in PassageClaimRouting:

  diagnostics: {
    concentrationDistribution: number[];
    densityRatioDistribution: number[];
    totalClaims: number;
    floorCount: number;
    /** 'dominant-core' = largestBasinRatio > 0.5, periphery filtered before scoring.
     *  'parallel-cores' = no dominant basin, full corpus scored, basin membership annotated.
     *  'no-geometry' = no basin data available, full corpus scored (graceful degradation). */
    corpusMode: 'dominant-core' | 'parallel-cores' | 'no-geometry';
    /** Paragraph IDs excluded from scoring (empty in parallel-cores / no-geometry mode) */
    peripheralNodeIds: string[];
    /** periphery.size / totalNodes — how much was excluded */
    peripheralRatio: number;
    /** Basin ratio that drove the decision */
    largestBasinRatio: number | null;
  };


// ─────────────────────────────────────────────────────────────────────────
// ADD to shared/contract.ts — inside PassageRoutingResult
// ─────────────────────────────────────────────────────────────────────────

// Add after the existing `meta` field:

  /** Per-passage basin annotation (populated only in parallel-cores mode) */
  basinAnnotations?: Record<string, number>;  // paragraphId → basinId

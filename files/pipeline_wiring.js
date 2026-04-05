// ─────────────────────────────────────────────────────────────────────────
// CHANGE in src/core/execution/deterministicPipeline.js
//
// Location: ~line 374, inside the passage routing call
// ─────────────────────────────────────────────────────────────────────────

// BEFORE:
        if (result.claimDensityResult) {
          const { computePassageRouting } =
            await import('../passageRouting');
          result.passageRoutingResult = computePassageRouting({
            claimDensityResult: result.claimDensityResult,
            enrichedClaims,
            validatedConflicts,
            modelCount,
          });

// AFTER:
        if (result.claimDensityResult) {
          const { computePassageRouting } =
            await import('../passageRouting');
          result.passageRoutingResult = computePassageRouting({
            claimDensityResult: result.claimDensityResult,
            enrichedClaims,
            validatedConflicts,
            modelCount,
            basinInversion: result.basinInversion ?? null,
            regions: preSemantic?.regionization?.regions ?? [],
          });

// ─────────────────────────────────────────────────────────────────────────
// Update the console.log to include peripheral diagnostics
// ─────────────────────────────────────────────────────────────────────────

// BEFORE:
          console.log(`[DeterministicPipeline] PassageRouting: ${result.passageRoutingResult.gate.loadBearingCount} load-bearing, ${result.passageRoutingResult.routing.diagnostics.floorCount} floor in ${result.passageRoutingResult.meta.processingTimeMs.toFixed(0)}ms`);

// AFTER:
          const prDiag = result.passageRoutingResult.routing.diagnostics;
          console.log(`[DeterministicPipeline] PassageRouting: ${result.passageRoutingResult.gate.loadBearingCount} load-bearing, ${prDiag.floorCount} floor, mode=${prDiag.corpusMode} peripheral=${prDiag.peripheralNodeIds.length}/${(prDiag.largestBasinRatio ?? 0).toFixed(2)} in ${result.passageRoutingResult.meta.processingTimeMs.toFixed(0)}ms`);

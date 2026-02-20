# Audit Instructions — Post-Sprint Cleanup

## Priority 1 — Clustering removal assessment

### Context
Clustering (`src/clustering/`) is an entire module (engine, HAC, config, distance, types) that produces `ParagraphCluster[]`. Its **only pipeline consumer** is `regions.ts`, where clusters become regions of `kind: 'cluster'` — but only when `shouldRunClustering` is true AND usable clusters exist. The fallback (component-based regions + patch-based regions) covers all nodes regardless. Clustering was an early attempt to reduce mapper load by pre-grouping statements, but in practice the mapper doesn't use cluster groupings for claim extraction.

### Investigation required
1. Confirm clustering output is NOT consumed by anything outside `regions.ts` and the debug artifact. Search for: `clusteringResult`, `paragraphClusterSummary`, `ParagraphCluster` imports.
2. Verify that removing the cluster path from `buildRegions` still produces complete regionization (component + patch fallback covers everything).

### Action if confirmed
- Remove `shouldRunClustering` from `AdaptiveLens` type and `lens.ts`
- Remove `clusters?: ParagraphCluster[]` parameter from `buildRegions` and `buildPreSemanticInterpretation`
- Remove `clusterToRegion()` function from `regions.ts`
- Remove `kind: 'cluster'` from Region type (only `component` and `patch` remain)
- Remove cluster-related meta from `RegionizationResult` (`fallbackUsed`, `fallbackReason` — no longer meaningful when there's no primary path to fall back from)
- In `StepExecutor.js`: remove the clustering step, remove `paragraphClusterSummary` from artifact
- Do NOT delete `src/clustering/` module yet — its `embeddings.ts` and `distance.ts` are used by other parts of the pipeline (substrate, provenance). Only remove the clustering engine (`engine.ts`, `hac.ts`, `config.ts`) and the `ParagraphCluster` type after confirming zero remaining imports.
- Update `COMPUTATION_INVENTORY.md`

---

## Priority 2 — Regime removal

### Context
`Regime` is a type alias (`'fragmented' | 'parallel_components' | 'bimodal_fork' | 'convergent_core'`) set on `AdaptiveLens`. The function `mapPriorToRegime(shape.prior)` is a 1:1 identity passthrough — it returns exactly what it receives. Zero pipeline consumers. One UI consumer: `DecisionMapObservabilityRow.tsx` displays it as a summary card label.

### Action
- Remove `Regime` type from `types.ts`
- Remove `regime` field from `AdaptiveLens` interface
- Remove `mapPriorToRegime()` function from `lens.ts`
- In `DecisionMapObservabilityRow.tsx`: replace `lens?.regime` display with `substrate?.shape?.prior` (the actual source value, no passthrough needed). Or remove the card entirely — `shape.prior` is already on the substrate if anyone needs it.
- Remove `Regime` from all export barrels (`interpretation/index.ts`, `geometry/index.ts`)
- Update `COMPUTATION_INVENTORY.md`

---

## Priority 3 — coverageAudit.ts: Remove contaminated reason logic

### Context
The plan said "remove `likelyClaim`" but the agent only removed the field name. The **identical logic** still runs inside `findUnattendedRegions`, producing a `reason` label from the same three heuristics:
- `stanceVariety >= 2` → `'stance_diversity'` (uses L2 stance classifications, imports `Stance` type)
- `avgMutualDegree >= 2` → `'high_connectivity'` (wrong proxy — coherence ≠ missed claim)  
- `bridgesTo.length > 1` → `'bridge_region'` (wrong proxy — bridge structure ≠ missed claim)

This IS the likelyClaim logic wearing a different name.

### Action
- Remove the entire `reason` derivation block from `findUnattendedRegions`
- Remove `stanceCounts`, `stanceVariety` calculation
- Remove `Stance` import from `coverageAudit.ts`
- Remove `reason` field from `UnattendedRegion` interface
- Simplify `UnattendedRegion` to only honest measurements:
  ```typescript
  interface UnattendedRegion {
      id: string;
      nodeIds: string[];
      statementIds: string[];
      statementCount: number;
      modelDiversity: number;
      avgIsolation: number;
      bridgesTo: string[];  // keep as structural fact — which claims this region neighbors
  }
  ```
- In `completenessReport.ts`: remove `reason` from `unattendedRegionPreviews`. The region previews show statement text — let the reader decide what they mean.
- The only classification for unattended regions that matters is whether they contain query-relevant statements — and that's already handled by the `unaddressed` fate in `fateTracking.ts`.

---

## Priority 4 — completenessReport.ts: Remove verdict labels

### Context
The `verdict` block uses motivated thresholds (0.85, 0.8, 0.7, 0.6) to produce categorical labels (`complete: boolean`, `confidence: 'high' | 'medium' | 'low'`, `recommendation: 'coverage_acceptable' | 'review_orphans' | 'possible_gaps'`). Same pattern as tier — continuous measurements compressed into labels via unjustified cutoffs. The coverage ratios are honest. The labels interpreting them are not.

### Action
- Remove `verdict` block entirely from `CompletenessReport` interface
- Keep `statements: { total, inClaims, orphaned, unaddressed, noise, coverageRatio }` — all honest counts
- Keep `regions: { total, attended, unattended, coverageRatio }` — all honest counts
- Keep `recovery: { unaddressedStatements, unattendedRegionPreviews }` — these are the worklist
- Remove the `complete`, `confidence`, and `recommendation` derivation logic from `buildCompletenessReport`
- Any UI consuming `verdict` should read the raw counts instead. The display layer can apply its own thresholds if needed — that's a UI policy decision, not a pipeline measurement.

---

## Priority 5 — Wire claimProvenance to debug panel

### Context
`claimProvenance.ts` contains three honest structural measurements (computeStatementOwnership, computeClaimExclusivity, computeClaimOverlap) that were deliberately built for the Claim entity profile. They currently have zero consumers because the entity profile infrastructure hasn't been built yet.

### Action
- Wire all three computations into the debug artifact output in `StepExecutor.js` (call them after `reconstructProvenance` produces `LinkedClaim[]`, add results to the artifact under a `claimProvenance` key)
- This makes them visible and testable while the profiles infrastructure is built
- Do NOT delete these functions — they are the seed of `src/profiles/`

---

## Priority 6 — Create profiles directory

### Context
Entity profiles were designed this session but the directory doesn't exist. `profiles.ts` in `geometry/interpretation/` is the region profiler — it's not the entity profiles directory.

### Action
- Create `src/profiles/` directory
- Move or reference `claimProvenance.ts` measurements as the first Claim profile entries
- Create a `README.md` in the directory documenting the six entity profile types (Claim, Statement, Model, Region, Edge, Query) and what measurements each contains
- This is scaffolding — actual profile files will be populated as the audit continues

---

## Later — Isolation naming unification (separate task)

### Context
"Isolation" currently means six different things across the codebase:

| Name | Scope | Measures |
|---|---|---|
| `isolationScore` | SubstrateNode | `1 - normalizedMutualDegree` per paragraph-node |
| `isolationRatio` | TopologyMetrics | fraction of nodes with zero strong edges (substrate-level) |
| `isolation` | RegionProfile.geometry | mean of node isolationScores within region |
| `geometricIsolation` | StatementFate.shadowMetadata | copies node's isolationScore |
| `recusant` (queryRelevance) | per-statement | `1 - normalizedMutualDegree` (same formula as node isolationScore) |
| `avgIsolation` | UnattendedRegion | mean of node isolationScores in region |

This is the same naming collision that caused the ReactiveBridge/tier confusion. Every mention of "isolation" in a code review or conversation is ambiguous without checking which scope is intended.

### Action (when addressed)
- Audit all six usages
- Choose distinct names that encode the scope: e.g. `nodeDetachment`, `substrateIsolationRatio`, `regionMeanDetachment`, `statementDetachment`
- Rename `recusant` as part of this pass, not separately
- Single find-and-replace pass across codebase, types, contract, UI
- This is a refactoring task, not an epistemic audit item — no measurements change, only names

---

## Verification checklist

After all priorities are complete:

1. `tsc --noEmit` — zero errors
2. `grep -r "shouldRunClustering\|ParagraphCluster" src/geometry/` → zero hits
3. `grep -r "Regime\|regime" src/geometry/interpretation/lens.ts` → zero hits  
4. `grep -r "stanceVariety\|stance_diversity\|high_connectivity\|bridge_region" src/` → zero hits
5. `grep -r "\.verdict\b" src/geometry/interpretation/completenessReport.ts` → zero hits
6. `grep "Stance" src/geometry/interpretation/coverageAudit.ts` → zero hits (no stance import)
7. Smoke test — full query through pipeline, artifact renders, debug panel shows claimProvenance data
8. `src/profiles/` directory exists with README.md

---

## NOT in scope (confirmed)

| Item | Status |
|---|---|
| Provenance supporter filter | ✅ Already fixed — matches all statements |
| Unaddressed fate category | ✅ Already implemented in fateTracking.ts |
| Cross-entity distance (region↔claim centroid) | ❌ Struck from roadmap — geometry can't determine missed claims from distances |
| SA engine audit | Later — separate 7-file session |
| Shadow layer audit | Later |
| ExclusionRules.ts | Later — ongoing tuning |
| ReactiveBridge audit | Later — separate system, separate session |
| Traversal / synthesis audit | Later |

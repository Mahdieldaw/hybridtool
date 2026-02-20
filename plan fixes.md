Here's Document 2 with the missing pieces added:

---

Let me audit what actually landed versus what should have. I'll check the critical paths. That's the big one. Now let me check UI and shared: Now let me check what the agent actually created: Now let me read the convergence block in StepExecutor: Now let me check one more thing — whether the orchestrator implements gate-aware branching: Here's the full audit. The agent did the geometry layer correctly but didn't follow the ripple.

---

## What landed correctly

The core restructure is solid:

- **Deletions:** opposition.ts, routing.ts, guidance.ts, guidance.test.ts — all gone
- **New modules:** pipelineGates.ts, modelOrdering.ts, diagnostics.ts — all well-implemented, matching the spec
- **types.ts:** Properly simplified, PreSemanticInterpretation has the right shape
- **validation.ts:** Clean compatibility wrapper around diagnostics
- **Exports:** Both interpretation/index.ts and geometry/index.ts updated
- **shape.ts:** recommendation removed
- **Compiles + tests pass**

---

## What was missed — 6 real problems

### 1. StepExecutor.js convergence block (CRITICAL — silent degradation)

Lines ~1490-1970. This is `.js`, so TypeScript never catches it. It reads three fields that no longer exist:

```js
const signals = Array.isArray(pre?.interRegionSignals) ? pre.interRegionSignals : [];  // → []
const hintsExpectedClaimCount = pre?.hints?.expectedClaimCount ...  // → null
const oppositions = Array.isArray(pre?.oppositions) ? pre.oppositions : [];  // → []
```

The `|| []` guards prevent crashes, but the convergence object becomes a hollow shell. Concretely:

- `comparableEdges` and `matchedEdges` = 0 (no signals to compare against)
- `mechanicalConflicts` = [] → `conflictConfirmationRatio` = null
- `confirmedClaims` always empty → `relationshipComponent` always 0 → **claim convergenceConfidence capped at 0.33** (only tier + coherence, never relationship)
- Edge convergenceConfidence loses the 0.5 signal-matching boost
- All partition opposition metrics (oppositionCoverageRatio, focalOppositionRatio, alignedToOppositionPairsRatio) = 0
- `coverageConvergence.expectedClaimCount` = null, `withinExpectedRange` = null

The convergence object still gets emitted, goes into the cognitive artifact, gets displayed in UI — all showing zeros as if there's deliberately no convergence, rather than "we removed the inputs."

### 2. shared/contract.ts (CRITICAL — type/runtime mismatch)

The shared contract's `PreSemanticInterpretation` still says:

```typescript
oppositions: PipelineOppositionPair[];
interRegionSignals?: PipelineInterRegionSignal[];
hints: PipelineMapperGeometricHints;
```

While the actual runtime type from `src/geometry/interpretation/types.ts` is:

```typescript
pipelineGate: PipelineGateResult;
modelOrdering: ModelOrderingResult;
```

Plus 7 dead types still defined: `PipelineOppositionPair`, `PipelineInterRegionSignal`, `PipelineInterRegionRelationship`, `PipelineMapperGeometricHints`, `PipelineShapePrediction`, `StructuralViolation`, `StructuralValidation`.

Any TypeScript consumer typed against the shared contract will have incorrect expectations.

### 3. Orchestrator has no gate branching (MODERATE — spec violation)

The updated `buildPreSemanticInterpretation` always runs the full pipeline:

```typescript
const regionization = buildRegions(...);
const regionProfiles = profileRegions(...);
const modelOrdering = computeModelOrdering(regionization.regions, regionProfiles, substrate);
```

The spec says:

- `skip_geometry` → early return, empty regions/profiles, default model order
- `insufficient_structure` → compute regions/profiles but model ordering falls back to default

Neither branch exists.

### 4. Missing `queryRelevanceBoost` reservation (MODERATE — spec deviation)

The spec requires `queryRelevanceBoost` to be reserved on both the **type** and the **function signature**. Neither was added:

```typescript
// ModelScore type — missing:
queryRelevanceBoost?: Map<number, number>;

// computeModelOrdering signature — missing:
function computeModelOrdering(
  regions: Region[],
  profiles: RegionProfile[],
  substrate: Substrate,
  queryRelevanceBoost?: Map<number, number>  // not present
): ModelOrderingResult
```

This is a reserved parameter — it doesn't need to do anything yet — but the omission means any future caller building against the spec will find a signature mismatch, and the type won't reflect the intended contract.

### 5. shared/cognitive-artifact.ts stale reference (MINOR — always defaults)

Line 49: `hint: pipeline.preSemantic.lens?.shape ?? 'sparse'`

`AdaptiveLens` has no `shape` field — only the **substrate** carries `shape` as a `ShapeClassification`. The `lens?.shape` access always evaluates to `undefined`, so this always resolves to `'sparse'`. Not a crash, but referencing a path that doesn't exist and silently masking whatever the substrate's actual shape is.

Note: a broader grep for `shape` references will surface hits in `lens.ts` reading `substrate.shape` — those are fine and expected. Only the `lens?.shape` access in cognitive-artifact.ts is the problem.

### 6. UI convergence cards still display opposition metrics (MINOR — dead display)

`DecisionMapObservabilityRow.tsx` lines 695-706 still read `partitionConv?.oppositionCoverageRatio`, `oppositionsPredicted`, etc. Always 0 now. Renders correctly but meaninglessly.

---

## What this means practically

The geometry interpretation layer itself is clean. The problem is that the convergence computation in StepExecutor was the **primary consumer** of the removed signals, and it wasn't touched at all. That block is now a zombie — it runs, it produces output, but the output is structurally degraded. And the shared contract creates a type fiction where the old interface appears to still exist.

The question for you is: **do you want to fix these now, or is the convergence block something you planned to rework anyway?** Because the honest answer might be that the convergence computation was itself a case of the same epistemic overreach we just removed from geometry — it was trying to validate mapper output against geometric predictions that were guesses. If so, the right move might be to strip the convergence block down to what survives without the removed signals (tier-based confidence + embedding coherence only) rather than trying to patch it.
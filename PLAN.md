# Parity Work Plan: Closing the Gap Between Implementation Plan and Codebase

This document identifies every remaining gap between the implementation plan and the current codebase, excludes items deliberately changed by later design decisions, and lays out the concrete work needed to reach parity.

---

## Items Excluded (Deliberately Changed — No Work Needed)

| Plan Item | Why It's Excluded |
|---|---|
| **Milestone 1 — Condensed Evidence Set / query relevance pre-filter** | Decisions doc removed the filter. Geometry runs on everything. Query relevance is a scoring signal, not a gate. `condensedStatementIds[]` should not exist. |
| **Milestone 2 — Route geometry through condensed evidence** | Follows from M1 removal. Geometry runs on the full statement set. No implementation needed. |
| **Milestone 3 — Disruption formula (cluster-size)** | Carrier-uniqueness formula replaced the original cluster-size formula per decisions doc. Already implemented correctly. |
| **Milestone 5 — Deduplication strategy** | Fully implemented as designed: Jaccard on statement IDs (threshold 0.6) AND hinge question token Jaccard (threshold 0.25). No gap. |

---

## Actual Gaps — Ordered by Impact

### GAP 1 (Critical): Traversal UI Does Not Consume `TraversalQuestion[]`

**What the plan requires:** A unified traversal UI that renders `TraversalQuestion[]` — both partition-type and conditional-type questions — with ordering (partitions first, conditionals after) and `blockedBy` logic.

**What exists:**
- The pipeline produces `TraversalQuestion[]` via `mergeTraversalQuestions()` and stores it on `artifact.traversal.traversalQuestions`.
- The UI does NOT import or reference the `TraversalQuestion` type anywhere in functional code.
- `TraversalGraphView.tsx` renders two separate widgets using two separate data types:
  - "Partition Questions" from `MapperPartition[]` directly
  - "Key Decision Points" from `ForcingPoint[]` (old traversal engine format)
- `useTraversal.ts` hook works exclusively with `ForcingPoint[]` / `TraversalState`.
- `traversalEngine.ts` defines and operates on `ForcingPoint[]`, never `TraversalQuestion[]`.
- Conditional gates derived from the region-based gate derivation (Task 2) may not be visible to users through the unified format.
- The unified question ordering and `blockedBy` blocking logic never reaches the user.

**Work required:**

Two approaches — choose one:

**Option A — Adapter (faster, some information loss):**
1. Write a `traversalQuestionsToForcingPoints(questions: TraversalQuestion[]): ForcingPoint[]` adapter in `traversalEngine.ts`.
2. Map partition-type questions to conflict-type forcing points (hinge question → conflict options A/B).
3. Map conditional-type questions to conditional-type forcing points.
4. Preserve `blockedBy` → `blockedByGateIds` mapping.
5. Wire `useTraversal.ts` to prefer consuming the adapted `TraversalQuestion[]` when available, falling back to the existing `extractForcingPoints()` path.
6. Update `TraversalGraphView.tsx` to use a single rendering path for both types.

**Option B — Native `TraversalQuestion` UI (cleaner, larger change):**
1. Create a new `useTraversalQuestions.ts` hook that consumes `TraversalQuestion[]` directly.
2. Build a `TraversalQuestionCard.tsx` component that renders both partition and conditional types.
3. Implement resolution handlers that update `partitionAnswers` (for partition-type) and `claimStatuses` (for conditional-type) from a single interaction model.
4. Implement `blockedBy` blocking: don't render blocked questions until their blocker is resolved.
5. Replace the dual-widget rendering in `TraversalGraphView.tsx` with a single ordered list.
6. Wire partition answers back to the continuation endpoint.

**Files touched:** `ui/hooks/useTraversal.ts`, `ui/components/traversal/TraversalGraphView.tsx`, `src/utils/cognitive/traversalEngine.ts`, potentially `ui/components/traversal/TraversalForcingPointCard.tsx`.

---

### GAP 2 (Critical): Auto-Resolution of Conditional Gates After Partition Answers (Fix 14)

**What the plan requires:** When a user answers a partition question and prunes one side's advocacy, conditional gates whose affected statements are now mostly pruned should auto-resolve — preventing redundant questions.

**What exists:**
- `traversalEngine.ts` has `autoResolveConditionalsByPriorPruning()` that auto-resolves conditionals when 80%+ of their affected claims are pruned. This fires after every `resolveGate` and `resolveForcingPoint` in `useTraversal.ts`.
- `questionMerge.ts` has `checkAutoResolution()` that runs at build time against `prunedStatementIds`.
- **Neither of these bridges the gap between partition answers and conditional gate resolution.** The traversal engine auto-resolves conditionals based on *claim* pruning from forcing point resolution — but partition answers don't flow through the forcing point resolution path. They go into `partitionAnswers` which is a separate data structure.

**Work required:**
1. After a partition answer prunes advocacy statements, compute the set of newly-pruned statement IDs.
2. Check all pending conditional-type `TraversalQuestion[]` (or `ForcingPoint[]` depending on GAP 1 approach) against the new pruned set.
3. Auto-resolve conditionals where 80%+ of affected statements are now pruned.
4. This must happen reactively in the UI (in `useTraversal.ts` or the new hook) — not just at pipeline build time.

**Dependency:** Partially depends on GAP 1 (how partition answers and conditional gates coexist in the UI).

**Files touched:** `ui/hooks/useTraversal.ts` (or new hook), `src/utils/cognitive/traversalEngine.ts`.

---

### GAP 3 (High): Retroactive Disruption Scoring for Emergent Forks

**What the plan requires:** Emergent forks get a retroactive disruption score computed by selecting a representative anchor statement per side and running the same disruption formula used for focal statements, so emergent forks and focal partitions are ranked on the same scale.

**What exists:**
- `computeDisruptionScores()` runs pre-mapper on `ShadowStatement[]`. It produces per-statement disruption scores with full breakdowns.
- Emergent forks are extracted post-mapper. No code path retroactively scores them.
- Emergent forks have no `impactScore` based on the disruption formula. If they have any score, it's estimated from statement features (stance/signals/confidence/isolation) — a different scale.
- Cross-type ordering (focal partitions vs emergent forks) is therefore unreliable.

**Work required:**
1. After emergent forks are parsed, for each fork:
   - Identify the highest-disruption statement among `sideAStatementIds` and `sideBStatementIds` (lookup from the already-computed `disruptionScores` map).
   - Set `impactScore = max(disruption(anchorA), disruption(anchorB))`.
   - Persist the breakdown (which anchor, which side, raw disruption values) for calibration.
2. This makes emergent fork ranking comparable to focal partition ranking.
3. Location: in `StepExecutor.js` after emergent fork extraction (around line 1397-1408), before dedup/validation.

**Files touched:** `src/core/execution/StepExecutor.js`.

---

### GAP 4 (High): Fallback Trigger Should Check Mechanical Opposition Signals

**What the plan requires:** Fallback triggers when partitions are empty AND mechanical opposition signals indicate forks exist (high-opposition statements in the top quartile of disruption).

**What exists:**
- Fallback fires when: `validatedPartitions.length === 0 || avgConfidence < 0.5 || maxConfidence < 0.55`.
- These conditions check mapper output quality only — not whether the mechanical layer detected real opposition.
- The fallback fires whenever the mapper is weak, even if there are genuinely no forks (unnecessary fallback).
- It does NOT fire when the mapper returns zero partitions but disruption scoring shows high-opposition statements — exactly the case where fallback is most valuable.

**Work required:**
1. After computing `shouldPartitionFallback`, add a mechanical opposition check:
   - Look at `disruptionScores` top quartile. If any score exceeds a threshold (e.g., top 25th percentile of disruption > 0.3), set `mechanicalOppositionDetected = true`.
   - Alternatively, check `preSemanticInterpretation.oppositions` — if any inter-region opposition signal exists with strength above threshold.
2. Revise fallback condition:
   - Fire fallback when `validatedPartitions.length === 0 && mechanicalOppositionDetected`.
   - Keep confidence-based fallback as a separate "low quality" path.
3. Log fallback trigger events with disruption context (what the mechanical layer detected that the mapper missed).

**Files touched:** `src/core/execution/StepExecutor.js` (around lines 1454-1498).

---

### GAP 5 (Medium): Shadow Delta Audit Against Partition Participation

**What the plan requires:** `computeShadowDelta()` reports high-relevance statements that didn't participate in any partition — auditing the partition path's coverage.

**What exists:**
- `computeShadowDelta()` in `ShadowDelta.ts` takes `referencedStatementIds: Set<string>`.
- In `StepExecutor.js`, the referenced IDs are built from `enrichedClaims.sourceStatementIds` only.
- Partition statement IDs (`sideAStatementIds`, `sideBStatementIds`, `advocacyStatementIds`) are NOT included.
- A statement in a partition's advocacy but not in a claim appears as "unreferenced."

**Work required:**
1. In `StepExecutor.js` (around lines 1853-1871), when building `referencedIds`, also include statement IDs from all validated partitions:
   ```js
   for (const p of validatedPartitions) {
     for (const id of [...(p.sideAStatementIds || []), ...(p.sideBStatementIds || [])]) {
       referencedIds.add(id);
     }
   }
   ```
2. This makes the shadow delta audit accurately reflect what the partition path actually consumed.

**Files touched:** `src/core/execution/StepExecutor.js`.

---

### GAP 6 (Medium): Disruption Score Breakdown in Debug Panel

**What the plan requires:** The debug panel shows per-region breakdown (uniqueness value, nearest carrier region and similarity, stanceWeight, modelDiversity, final disruption score) for calibration.

**What exists:**
- `DisruptionScoredStatement.breakdown` has all the data: `nearestCarrierSimilarity`, `uniqueness`, `stanceWeight`, `modelDiversity`, `disruptionRaw`, `composite`.
- Top 50 disruption scores with breakdowns are stored on `pipelineArtifacts.preSemantic.disruption.scores.top`.
- `DecisionMapObservabilityRow.tsx` has NO "Disruption" tab. The tab list includes Shadow, Clustering, Embedding, Geometry, Regions, Routing, Mapping, Traversal, Pruning, Query, Audit — but no Disruption.
- The breakdown data is written but never surfaced.

**Work required:**
1. Add a "Disruption" tab to `DecisionMapObservabilityRow.tsx`.
2. Read from `artifact?.preSemantic?.disruption?.scores?.top`.
3. Render a table with columns: Statement (truncated text), Uniqueness, Nearest Carrier Similarity, Stance Weight, Model Diversity, Raw Score, Composite Score.
4. Add summary cards: count of statements scored, mean/max composite, top focal regions.

**Files touched:** `ui/components/DecisionMapObservabilityRow.tsx`.

---

### GAP 7 (Medium): Query Relevance Distribution Summary in Debug Panel

**What the plan requires:** Per-turn query relevance score distributions (min, max, mean, percentiles) so you can see how query-relevant the model outputs were.

**What exists:**
- The debug panel shows per-statement relevance rows and tier counts (high/medium/low).
- No min, max, mean, or percentile values are computed or displayed.
- The `quantile` function exists in `queryRelevance.ts` but is used internally for tier thresholding only.

**Work required:**
1. In `queryRelevance.ts`, extend `QueryRelevanceMeta` to include distribution stats: `{ min, max, mean, p25, p50, p75 }`.
2. Compute these from the `statementScores` map before returning.
3. In `DecisionMapObservabilityRow.tsx` `buildQueryView`, add summary cards for these distribution values above the per-statement table.

**Files touched:** `src/geometry/queryRelevance.ts`, `ui/components/DecisionMapObservabilityRow.tsx`.

---

### GAP 8 (Medium): Structural Analysis Still Load-Bearing in Gate Derivation

**What the plan requires:** Structural analysis "must not be load-bearing for traversal selection, pruning, or synthesis."

**What exists:**
- `deriveConditionalGates.ts` receives `structuralAnalysis` as a required input.
- `computeInterRegionBoost()` uses `structuralAnalysis.patterns.conflictClusters`, `.conflicts`, and `.tradeoffs` to add a boost (0.12–0.2) to gate ranking scores.
- `shapePrimary`, `convergenceRatio`, `signalStrength`, `componentCount`, and `conflictCount` from structural analysis are used in the gate derivation debug output and potentially in gate threshold logic.
- This means structural analysis IS load-bearing: it influences which conditional gates are surfaced and their ranking.

**Work required:**
1. Make `structuralAnalysis` optional in `deriveConditionalGates` input type.
2. Set `interRegionBoost` to 0 when structural analysis is absent.
3. Remove structural analysis from gate ranking influence — or move it to a "tiebreaker only" role that doesn't change which gates pass the threshold.
4. Keep structural analysis available for the debug panel display.

**Files touched:** `src/core/traversal/deriveConditionalGates.ts`, `src/core/execution/StepExecutor.js`.

---

### GAP 9 (Low): Baseline Harness for Regression Testing (Milestone 0)

**What the plan requires:** A "truth harness" that runs the mapping step on stored sample turns and emits comparison metrics (statement counts, region counts, oppositions, query relevance distributions, traversal question counts). Plus invariant checks (stable statement IDs, modelIndex alignment, no-pruning-when-traversal-empty).

**What exists:**
- A single test file: `StepExecutor.mapping.truth-harness.test.ts` — a unit test that runs one mapping step with two provider texts and checks the artifact has expected shape. It validates citation ordering and basic observability.
- No stored sample turns for before/after comparison.
- No invariant check suite.
- No automated way to compare pipeline output across code changes.

**Work required:**
1. Create 3-5 stored sample turn fixtures (diverse query types, varying model count).
2. Expand the truth harness test to run each fixture and emit structured metrics: statement count, region count, opposition count, disruption score distribution, partition count, traversal question count.
3. Add invariant assertions: stable statement IDs across runs on same input, modelIndex alignment, no pruning when traversal state is empty.
4. Store baseline metric snapshots and compare on each run.

**Files touched:** `src/core/execution/StepExecutor.mapping.truth-harness.test.ts`, new fixture files.

---

### GAP 10 (Low): `partitionAnswers` Persistence Across Sessions

**What the plan requires:** `partitionAnswers` persisted and surviving page refreshes / session restoration, using the same mechanism as existing traversal state.

**What exists:**
- `partitionAnswers` stored in `traversalStateByTurnAtom` which uses `atomWithImmer` (in-memory only, NOT `atomWithStorage`).
- Lost on page reload or extension restart.
- The existing `completedTraversalState` on the `AiTurn` object can rehydrate `partitionAnswers` on re-render, but in-flight state is not persisted to `localStorage`.

**Work required:**
1. Either switch `traversalStateByTurnAtom` to `atomWithStorage` (affects all traversal state — may have side effects to evaluate).
2. Or add a separate `partitionAnswersByTurnAtom` using `atomWithStorage` to persist partition answers specifically.
3. Ensure rehydration on page load reconstructs the correct partition answer state.

**Files touched:** `ui/state/atoms.ts`, `ui/hooks/useTraversal.ts` (or new hook).

---

### GAP 11 (Low): Convergence Validation Report Completeness

**What the plan requires:** A convergence report comparing mechanical predictions (regions/oppositions) against mapper partitions — answering "were predicted oppositions surfaced as partitions?" and "are partitions aligned with geometry neighborhoods?"

**What exists:**
- A convergence artifact is computed in `StepExecutor.js` (lines 2260-2502) with three dimensions: coverage, mechanical conflict, relationship.
- This compares claims/edges against mechanical structure — NOT partitions against mechanical structure.
- The `coverageConvergence.withinExpectedRange` field is frequently `null`.
- No logic acts on the convergence data as a gate or actionable report.

**Work required:**
1. Add a partition-vs-mechanical convergence dimension:
   - For each validated partition, check whether its side statement IDs map to distinct regions (geometric alignment).
   - Check whether the partition's focal statement has opposition signals in the pre-semantic interpretation.
   - Score: what fraction of mechanical oppositions became partitions, and what fraction of partitions have mechanical support.
2. Persist alongside existing convergence dimensions.
3. Surface in the debug panel convergence display.

**Files touched:** `src/core/execution/StepExecutor.js`, `ui/components/DecisionMapObservabilityRow.tsx`.

---

## Summary: Priority Ordering

| Priority | Gap | Impact | Effort |
|---|---|---|---|
| **P0** | GAP 1: Traversal UI → `TraversalQuestion[]` | Blocks unified question rendering | Large (Option A: Medium, Option B: Large) |
| **P0** | GAP 2: Auto-resolution after partition answers | Causes redundant questions | Medium |
| **P1** | GAP 3: Emergent fork disruption scoring | Makes cross-type ordering unreliable | Small |
| **P1** | GAP 4: Fallback trigger checks mechanical signals | Fallback fires incorrectly / misses cases | Small-Medium |
| **P2** | GAP 5: Shadow delta includes partition IDs | Audit misses partition coverage | Small (a few lines) |
| **P2** | GAP 6: Disruption breakdown debug tab | Can't calibrate disruption formula | Medium |
| **P2** | GAP 7: Query relevance distribution summary | Can't see relevance distributions | Small |
| **P2** | GAP 8: Structural analysis isolation from gates | SA shouldn't be load-bearing | Small-Medium |
| **P3** | GAP 9: Baseline regression harness | No automated before/after comparison | Medium |
| **P3** | GAP 10: partitionAnswers persistence | Lost on page refresh | Small |
| **P3** | GAP 11: Convergence report for partitions | Can't validate partition-mechanical alignment | Medium |

**P0 = Blocks core user flow. P1 = Correctness/reliability. P2 = Observability/debuggability. P3 = Safety net/nice-to-have.**


Verification 1: Do pseudo claims in Fix 13 survive triageStatements?
This is already covered by the implementation itself — if the build passes and the triage pipeline runs without errors, the pseudo claims survived. But the deeper concern (does triageStatements read fields beyond id and sourceStatementIds?) is worth a one-time manual verification before you consider Fix 13 closed.

The specific risk: the CarrierDetector.detectCarriers function receives the pruned claim and computes claim embedding similarity against candidate statements. If it tries to access a claim centroid embedding that doesn't exist on the pseudo claim, it either errors or silently skips carrier detection — which means every conditional gate affected statement becomes SKELETONIZE (sole carrier path) even when paraphrases exist elsewhere.

Add this as a sub-check under GAP 2 or as a standalone verification task: Run a query where a conditional gate fires, answer "no," and inspect the triage debug output. Verify that some affected statements get REMOVE (carrier found) and not all get SKELETONIZE. If all get SKELETONIZE regardless of paraphrase presence, the carrier detector is failing silently on pseudo claims.

Verification 2: Does auto-resolution check the right claim ID format?
This maps directly to GAP 2 in your plan. The auto-resolution function autoResolveConditionalsByPriorPruning checks whether affected claims are in the pruned set. The conditional gates' affected claims come from affectedClaims on the forcing point, which were populated from the conditional gate's region-based derivation. The partition answers prune different claim IDs (real claims from the mapper, or pseudo claims from advocacy expansion).

The question is whether a partition answer's pruning propagates to the claim IDs that the conditional gate's forcing point references. If partition pruning sets claimStatuses['claim_1'] = 'pruned' but the conditional gate's forcing point has affectedClaims: ['cg:gate_r_3:s_42'], then auto-resolution checks a different ID space and never fires.

This is the core issue in GAP 2. The work described in GAP 2 (computing newly-pruned statement IDs after a partition answer, then checking conditional gates against the statement-level pruned set rather than the claim-level pruned set) is exactly the fix for this. The auto-resolution needs to work at the statement level: "are the statements this gate cares about now pruned?" — not at the claim level: "are the claims this gate references now pruned?"

Your GAP 2 description already captures this correctly. No additional work item needed — just make sure the implementer understands that the bridge between partition answers and conditional gate auto-resolution operates on statement IDs, not claim IDs.

Verification 3: Are disruption scores normalized before the Fix 15 priority boost?
This is a standalone check that fits into GAP 6 (disruption score observability) but should be verified before GAP 6 work begins.

The fix instructions said: "Normalize disruption scores to [0, 1] range before applying the boost (divide each score by the maximum disruption score across all regions) so the TYPE_BOOST has consistent effect regardless of the absolute disruption scale."

If disruption scores are not normalized, the 0.3 boost for partitions has wildly different effects depending on the absolute scale. If disruption scores range from 0 to 0.5, the 0.3 boost makes partitions nearly always rank first (0.5 + 0.3 = 0.8 vs 0.5 for a conditional). If disruption scores range from 0 to 50, the 0.3 boost is meaningless (50.3 vs 50).

Add this as a pre-check for GAP 1 implementation: Before the traversal UI renders ordered questions, verify that priorityScore values in the TraversalQuestion[] array are in a sensible range. If partition scores cluster around 100 and conditional scores cluster around 50, the old 100 - N / 50 - N formula is still in effect somewhere. If they're in [0, ~1.3] range, normalization is working.

Check the mergeTraversalQuestions function in questionMerge.ts — specifically where it assigns priorityScore. If it reads disruption scores from the partition/gate objects and adds 0.3, verify that those disruption scores were already normalized by the disruption scoring computation (divided by max). If not, add the normalization step inside mergeTraversalQuestions before computing priority.


The architecture document is largely accurate but has several status markers that are wrong and a few descriptions that don't match the current codebase state. Here's everything that needs correcting.

---

## Status Marker Corrections

**Phase 6: Disruption Scoring** — The formula shown includes `partitionRelevance = disruption × hasOpposition × (1 + qrBoost)` and a worklist filtered by `partitionRelevance > 0`. Current code computes disruption as `disruption = uniqueness × stanceWeight × (1 + modelDiversity × 0.1)` with `uniqueness = 1 / (1 + nearestCarrierSimilarity)`. There is no active `partitionRelevance` multiplier in the disruption scoring path, and the worklist selection is not filtered by `partitionRelevance > 0` (a `minPartitionRelevance` meta field exists but is not used to filter). Routing (opposition/conflict signals vs conditional-density gating) is a separate step after disruption scoring.

**Phase 7: Jury Construction** — Marked as 🔲 PLANNED. This is wrong. The agent implemented jury construction including centroid representatives, high-signal representatives, outlier selection, and dissenter selection (with the embedding proximity fix from Task 5). The status should be ✅ IMPLEMENTED. The `constructJury` function exists in `interpretation/index.ts`.

**Phase 8: Mapper** — Marked as 🔲 PLANNED. This is wrong. The disruption-first mapper prompt exists in `semanticMapper.ts`. It receives worklist/jury format, produces partitions with hinge questions and statement ID references, handles emergent forks, and has a parser that validates IDs against the shadow inventory. The status should be ✅ IMPLEMENTED with a note that the prompt and schema may iterate.

**Phase 9: Advocacy Validation** — Marked as 🔲 PLANNED (optional, deferred). Advocacy expansion is actually implemented — jury members recruit region-mates with aligned stance, contested statements go to UNTRIAGED (Task 6 fix). The validation (confidence scoring per partition, topical alignment checks, directional differential) also exists. The status should be ✅ IMPLEMENTED. The description says "Region-based expansion (not similarity radius)" but the earlier status audit revealed the implementation uses similarity-threshold-based expansion (0.72 cosine) with region ID as a small boost, not pure region-based expansion. The description should match the implementation or the implementation should be changed to match.

**Phase 10: Traversal** — Marked as 🔁 TRANSITIONAL. This is correct but the description is incomplete. The unified `TraversalQuestion[]` type exists in the contract and the question merge step produces ordered, merged questions. But the traversal UI does not consume `TraversalQuestion[]` — it still renders through the old `ForcingPoint` format and a separate partition rendering path. The status should note this as the primary gap: the pipeline produces unified questions but the UI doesn't render them.

**Phase 11: Pruning** — Marked as 🔁 TRANSITIONAL. The dual-regime pruning (partition-based + skeletonization for non-participants) is implemented. Conditional gate pruning through the triage cascade (Fix 13) is implemented via pseudo claims. The description says Regime 1 is 🔲 and Regime 2 is 🔲 — both should be ✅ IMPLEMENTED with a note that they currently use pseudo claims rather than the planned region-based index.

**Phase 5.5: Conditional Gate Scanning** — The description says conditional gates are produced by `conditionalFinder.ts` running inside `buildMechanicalTraversal()`. The Tasks 1-4 implementation added a separate region-based conditional gate derivation (`regionGates.ts`) and an opposition-based routing step (`routing.ts`) that splits regions into partition candidates and gate candidates. Both systems currently exist. The description should reflect both paths and note that the routing + region-based path is the intended primary, with the existing `conditionalFinder` as the fallback/transitional system.

---

## Code Truth Table Corrections

**Jury construction** — Listed as 🔲 Planned. Should be ✅ Implemented.

**Mapper as annotator** — Listed as 🔲 Planned, "Current mapper still extraction." Should be ✅ Implemented for the disruption-first path. The old extraction mapper still exists as fallback.

**Partition-based pruning** — Listed as 🔲 Planned, "Current: claim-based skel. only." Should be ✅ Implemented. Dual-regime pruning exists with partition decisions taking precedence.

**Conditional gates** — The table says "🔲 Not yet passed to Partition module." The question merge step (`questionMerge.ts`) does merge conditional gates with partition questions. The gap is that the merged output doesn't reach the UI through the unified format.

---

## Description Inaccuracies

**Phase 6 uniqueness formula** — The document says `uniqueness = 1 - nearestCarrierSimilarity`. The code (confirmed in earlier verification) computes `uniqueness = 1 / (1 + nearestCarrierSimilarity)`. These are different functions. `1 - x` is linear (0.3 similarity → 0.7 uniqueness). `1 / (1 + x)` is hyperbolic (0.3 similarity → 0.77 uniqueness, 0.9 similarity → 0.53 uniqueness). The document should match the code.

**Phase 7 dissenter selection** — The description says "preferring high topical similarity + query relevance gap." The implementation (after Task 5 fix) uses `0.60*cosSim + 0.25*pickScore + 0.15*abs(dissenterQueryRel - focalQueryRel)` with a minimum cosine threshold of 0.35 (dropping to 0.25 if pool is too small). The description is correct in spirit but should note the specific weighting if this document is meant to be code-truth.

**Phase 9 advocacy expansion** — The description says "Region-based expansion (not similarity radius)." The implementation uses similarity-threshold expansion (0.72) with region as a small boost. These are different mechanisms. Either update the description to match the code, or flag this as a discrepancy to resolve.

---

## Missing Items

**Opposition-based routing** — Not shown as a separate step or mentioned anywhere in the phase flow. The routing logic (Task 1) that splits regions into partition candidates vs gate candidates is a distinct computation that runs after disruption scoring and before jury construction / conditional gate derivation. It should appear between Phase 6 and Phase 7, or as a sub-step within Phase 6, with its own status marker (✅ IMPLEMENTED).

**Question merge** — Not shown as a step. The merge of partition questions and conditional gate questions into a unified `TraversalQuestion[]` list (with `blockedBy` logic, priority ordering, capping at 5) is a distinct computation inside the Partition module. It's implemented but not visible in the phase flow.

**Auto-resolution** — Not mentioned. The mechanism where conditional gates auto-resolve when prior partition answers make them irrelevant (Fix 14) is implemented in the traversal engine but not reflected in the traversal phase description.

**Retroactive disruption scoring for emergent forks** — This is implemented in `StepExecutor.js`: emergent forks get `impactScore` set from the max disruption composite of anchor statements on each side (with a note trail). The architecture doc should mark this as ✅ IMPLEMENTED and keep the description aligned to the actual anchor-pick logic.

---

## What's Accurately Represented

Phases 1, 2, 3, 4, and 12 are accurate. The dependency graph is accurate. The 4-module collapse is accurate. The module API contracts are accurate (with the caveat that `EvidenceOutput` no longer has separate `condensed`/`parked` sets, which is correctly reflected). The architectural decisions section is accurate and well-articulated. The "Regions as Claims" section correctly describes a planned transition that hasn't happened yet.

The document is a good architectural reference that needs a status update pass rather than a structural revision.

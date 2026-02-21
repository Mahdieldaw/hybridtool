# Structural Analysis — Epistemic Audit Report

**Scope:** `src/core/structural-analysis/` (7 files)
**Principle:** Every calculation must measure what it claims to measure, and every measurement must serve an actual decision. Numbers that don't change what happens are decorative weight.

---

## Executive Summary

SA is an observation layer. It does not affect the happy path. Its job is to characterize the landscape — shapes, tensions, patterns, leverage — for UI rendering and backend diagnostics.

After this audit:

- **2 dead exports removed** from `engine.ts` (`computeFullAnalysis`, `computeProblemStructureFromArtifact`)
- **1 dead file deleted** (`V31Verification.ts`)
- **Every function and metric labeled** LIVE, HEURISTIC, or DECORATIVE with documented reasoning
- **No computations removed** — SA is an observation layer; removals require confirmed UI tracing

---

## Consumer Map (what actually reads what)

| Consumer | Path | Fields Read |
|---|---|---|
| CognitiveOutputRenderer | client-side `useMemo` | `shape.primary`, `shape.confidence`, `shape.patterns` (→ StructureGlyph) |
| MetricsRibbon | receives `analysis` | `claimsWithLeverage`, `patterns.conflicts`, `landscape`, `shape.confidence`, `shape.evidence` |
| DecisionMapGraph | receives `problemStructure` | `shape.peaks`, `shape.primary`, `shape.confidence`, `shape.patterns` (dissent/keystone/chain/fragile detail data) |
| DecisionMapSheet | client-side `useMemo` | `shape`, `claimsWithLeverage`, `patterns.conflicts`, `patterns.tradeoffs` |
| DecisionMapObservabilityRow | local SA call | `claimsWithLeverage` |
| StructureGlyph | receives `pattern` + `secondaryPatterns` | `pattern` (primary), `p.type` for: keystone/chain/dissent/fragile/challenged/conditional |
| context-resolver.js | backend | `claimsWithLeverage`, `edges` (everything else discarded) |
| StepExecutor.js | backend diagnostics | passes artifact to SA; reads `postSemantic` for `validateStructuralMapping` |

**Fields with no confirmed live consumer:** `ratios`, `ghostAnalysis`, `shape.signalStrength` (top-level), `graph.articulationPoints`, `graph.localCoherence`, `graph.clusterCohesion`

---

## Task 1: Dead Exports Removed

### `computeProblemStructureFromArtifact()` — REMOVED
One-liner wrapper around `computeStructuralAnalysis().shape`. Zero callers in the codebase. Running the full SA computation just to return `.shape` was wasteful; callers can do that themselves.

### `computeFullAnalysis()` — REMOVED
Wrapped `computeStructuralAnalysis` with shadow analysis (extracting unreferenced statements from batch responses). Zero callers. Shadow analysis is already handled separately in `StepExecutor` via its own shadow pipeline. This function was a dead integration path from an earlier architecture where shadow and structural analysis were co-located.

**Dead imports also removed:** `executeShadowExtraction`, `executeShadowDelta`, `extractReferencedIds`, `ShadowAudit`, `UnindexedStatement` from `../../shadow`.

---

## Task 2: V31Verification.ts Deleted

`src/core/V31Verification.ts` was a standalone scenario runner that called `computeStructuralAnalysis` on two hardcoded mock artifacts and printed results to console. It was not imported by anything, not part of the build, and not registered as a test. It served as a development scratch pad. Deleted.

---

## Task 3: `applyComputedRoles` Audit

**Status: HEURISTIC**

### What it does
Overrides the mapper's role assignments (anchor, challenger, branch, supplement) using graph topology rather than LLM reasoning.

### The core tension
The mapper sees the full claim text and uses LLM semantic understanding to assign roles. `applyComputedRoles` sees only edges and support counts. Neither is definitively more trustworthy:

- Mapper advantage: semantics. A claim's text may clearly indicate it's a challenger even if the edge structure is ambiguous.
- Structural advantage: determinism. Graph topology doesn't hallucinate or drift between runs. The override produces stable, reproducible role assignments.

The function exists because mapper role assignments were found to be inconsistent across runs. The override trades semantic fidelity for structural consistency. This is a reasonable engineering decision but should be documented — the mapper's reasoning is silently discarded.

### Threshold analysis: 50% consensus
The challenger detector marks a claim as a challenger if one side of a conflict edge has ≥50% support and the other doesn't. With 6 models, that's 3+ supporters. With 10 models, it's 5+. The threshold is percentage-based (scale-consistent) but not calibrated against outcome quality. 50% is a natural majority boundary, but there's no evidence it's the right cutoff for "this is consensus enough to call the other side a challenger."

### Anchor score weights
`prereqOut * 2 + supportIn * 1 + conflictTargets * 1.5 + dependentsArePrereqs * 1.5`, threshold ≥ 2.

These are invented. The intuitions behind them:
- Prerequisite-out gets the highest weight (2) because gating downstream claims is the most load-bearing structural role
- Conflict-target count gets 1.5 because being challenged by multiple claims signals consensus status
- `dependentsArePrereqs` gets 1.5 because a chain of chains compounds importance

No calibration against outcomes exists. The threshold of ≥ 2 means a claim needs at least one strong structural signal to qualify as an anchor.

### Branch detection and traversal alignment
Branch IDs come from `conditional.affectedClaims` and from prerequisite-downstream claims of conditional-type claims. **As of this audit, the traversal engine uses edge types (prerequisite, conflicts) for pruning decisions, not claim roles.** Branch vs. supplement is therefore DECORATIVE for the traversal path. The distinction may matter to UI rendering (DecisionMapGraph could treat branches differently), but this is unconfirmed.

### Recommendation
Consider making the override additive rather than destructive: flag structural contradictions with the mapper's roles rather than silently replacing them. This preserves LLM reasoning as a signal while surfacing disagreements between semantic and structural role detection.

---

## Task 4: Leverage Computation Audit

**Status: HEURISTIC throughout**

### `leverage` score formula

```
leverage = (supportRatio * 2) + roleWeight + connectivityWeight + positionWeight
```

All four weights are heuristic, not calibrated:

| Component | Value | Reasoning | Status |
|---|---|---|---|
| `supportWeight` | `supportRatio * 2` | Doubles the contribution of model consensus | HEURISTIC — factor of 2 is arbitrary |
| `roleWeight` | challenger:4, anchor:2, branch:1, supplement:0.5 | Challenger weighted highest because challenging consensus is structurally significant | HEURISTIC — round numbers |
| `connectivityWeight` | `prereqOut*2 + prereqIn + conflicts*1.5 + degree*0.25` | Outgoing prerequisites dominate; conflict participation weighted above general connectivity | HEURISTIC — mirrors applyComputedRoles intuitions |
| `positionWeight` | `isChainRoot ? 2 : 0` | Flat bonus for chain roots | HEURISTIC — value 2 unjustified |

`leverage` IS consumed downstream: MetricsRibbon and StructuralInsight render leverage scores at the claim level. The computation is live. The weights are unvalidated.

### `keystoneScore = outDegree * supporters.length`

This treats outgoing-connection count and supporter count as interchangeable contributors to keystoneness. Two claims that score 12 via different combinations (2×6 vs. 6×2) represent structurally different situations:
- **2 out-edges × 6 supporters**: narrowly connected but broadly supported — consensus bottleneck
- **6 out-edges × 2 supporters**: broadly connected but lightly supported — structural hub on thin ice

The formula equates these. The assumption is that both dimensions independently signal "load-bearing" status and that their product captures combined keystoneness. This is a plausible heuristic but unvalidated. A claim that's both highly connected AND highly supported would score highest (6×6=36), which is coherent.

### `supportSkew` and `isOutlier`

`supportSkew = maxFromSingleModel / supporters.length` measures whether one model dominates a claim's support (e.g., if model 3 contributed 3 of a claim's 4 supporters, skew = 0.75). `isOutlier` fires when supportSkew is in the top 20th percentile AND supporters ≥ 2.

**As of this audit, `isOutlier` is not rendered by any UI component.** Both `supportSkew` and `isOutlier` appear on `EnrichedClaim` but no component reads them. They are **DECORATIVE** unless a future component surfaces them (e.g., a warning that a claim's support is concentrated from one model, indicating potential model-specific bias rather than genuine consensus).

---

## Task 5: `computeCoreRatios` Audit

**Status: DECORATIVE**

Returns `{ concentration, alignment, tension, fragmentation, depth }`.

| Ratio | Formula | Intended meaning |
|---|---|---|
| `concentration` | max_support / modelCount | How dominant is the most-supported claim? |
| `alignment` | reinforcingEdges / topEdges | Do top claims reinforce each other? |
| `tension` | (conflict+tradeoff edges) / total edges | What fraction of structure is adversarial? |
| `fragmentation` | (components - 1) / (claims - 1) | How disconnected is the graph? |
| `depth` | longestChain / claimCount | How sequential is the reasoning? |

**None of these ratios are read by any live consumer.** The UI components (MetricsRibbon, DecisionMapGraph, DecisionMapSheet, CognitiveOutputRenderer) do not destructure `analysis.ratios`. The context-resolver explicitly discards everything except `claimsWithLeverage` and `edges`. StepExecutor diagnostics don't reference `ratios`.

These ratios are well-motivated and would become meaningful once `positionBrief` and `synthesisPrompt` are reconnected — they could plausibly influence how the synthesis layer characterizes the landscape to the concierge. **Retained as documented placeholders. Do not remove yet.**

---

## Task 6: Signal Strength Audit

**Status: HEURISTIC formula, PARTIALLY DECORATIVE at top level**

```
signalStrength = edgeSignal*0.4 + supportSignal*0.3 + coverageSignal*0.3
```

### Semantic meaning
Signal strength estimates "how much structure can be read from this artifact." High signal = confident pattern classification. Low signal = sparse/uncertain landscape. This is the right thing to measure for an observation layer.

### `supportSignal = variance(normalizedSupportCounts) * 5`

The *5 amplifier embeds a non-obvious design choice: **disagreement between models is treated as more informative than agreement**. High variance in support counts means models have opinions (they distinguish claims differently); zero variance means all claims have equal support (models cannot discriminate). This is coherent — uniform support prevents pattern detection — but counterintuitive. High signal does NOT mean "strong consensus"; it means "the artifact has discriminating structure." This should be explicit in any UI that surfaces signal strength to users.

The *5 multiplier is arbitrary (scales variance, which typically falls in 0-0.25 for normalized values, into a 0-1 range approximately). It is not calibrated.

### Consumer chain
`signalStrength` lives in two places:
1. **`shape.signalStrength`** (top-level `ProblemStructure` field) — **no UI component reads this directly**. DECORATIVE at this level.
2. **`ExploratoryShapeData.signalStrength`** (inside `shape.data` for sparse shapes) — potentially LIVE if a component renders the sparse pattern's detail view, but this is unconfirmed.

The top-level `shape.signalStrength` field should either be wired to a UI display or removed from `ProblemStructure`. It's computing and storing a value that isn't used.

---

## Task 7: Ghost Analysis Audit

**Status: DECORATIVE (summary object); LIVE (raw strings in builders)**

`analyzeGhosts()` returns:
```ts
{ count: number; mayExtendChallenger: boolean; challengerIds: string[] }
```

This summary object lands on `StructuralAnalysis.ghostAnalysis`. **No UI component reads `ghostAnalysis` from the analysis object.** The object has no live consumer in its current form.

However, the underlying ghost strings themselves (`semantic.ghosts[]`) ARE used by the builders:
- `buildConvergentData`: `ghosts` → `blindSpots[]` in `SettledShapeData`
- `buildParallelData`: `ghosts` → `gaps[]` in `DimensionalShapeData`
- `buildSparseData`: ghost count influences `sparsityReasons` and `clarifyingQuestions`

The ghost strings flow into shape data (potentially LIVE depending on shape.data rendering). The `ghostAnalysis` summary wrapper around them is the decorative part.

**Recommendation:** Either wire `ghostAnalysis.mayExtendChallenger` to a UI affordance (e.g., a warning that ghost concepts may invalidate the challenger analysis) or remove the summary object and keep only the raw ghost-to-builder flow.

---

## Task 8: Shape Data Builders Audit

**Status: LIVE (structure and hoisted fields), PARTIALLY DECORATIVE (rich detail sub-structures)**

### What the builders produce and what survives to UI

The engine hoists three fields from `shape.data` up to the top-level `ProblemStructure` object:
- `floorAssumptions` (from `SettledShapeData`) → rendered via `shape.evidence`
- `centralConflict` (collapsingQuestion from `ContestedShapeData`) → rendered as shape label
- `tradeoffs` (string[] from `TradeoffShapeData`) → rendered as shape label

These hoisted fields are **LIVE**. The rich sub-structures inside each builder's output are less certain:

| Builder | Rich fields status |
|---|---|
| `buildConvergentData` | `floor[]` (claim detail): unconfirmed UI renderer. `strongestOutlier`: unconfirmed. `challengers[]`: unconfirmed. `transferQuestion`: unconfirmed. |
| `buildForkedData` | `centralConflict` object (full): partially live (collapsingQuestion hoisted). Cluster structure (`ConflictCluster[]`): unconfirmed. `secondaryConflicts[]`: unconfirmed. `fragilities`: unconfirmed. |
| `buildConstrainedData` | `tradeoffs[]` (string labels hoisted): LIVE. Full tradeoff objects with text/supportRatio: unconfirmed. `dominatedOptions[]`: unconfirmed. |
| `buildParallelData` | `dimensions[]`, `interactions[]`, `dominantDimension`, `hiddenDimension`: unconfirmed. Substantial computation for potentially decorative output. |
| `buildSparseData` | `signalStrength`: see Task 6. `looseClusters[]`, `outerBoundary`, `clarifyingQuestions[]`: unconfirmed. |

### The fallback cascade — epistemic honesty concern

Two fallbacks silently reclassify shapes:

**Forked → Convergent fallback:** If primary shape is 'forked' but `enrichedConflicts.length === 0 && conflictClusters.length === 0`, the builder falls back to `buildConvergentData`. The `shape.primary` label says 'forked' but the data is structured as 'settled'. This means peak analysis detected conflict edges (enough to call the shape forked) but the enriched conflict detector found no valid conflicts. This is a classification disagreement between two functions that should agree. The fallback masks it rather than surfacing it. A forked classification with no extractable conflicts is a data quality signal worth preserving.

**Parallel → Convergent fallback:** If primary shape is 'parallel' but `graph.componentCount < 2`, falls back to `buildConvergentData`. Same issue: the peak analysis said "independent peaks" but the graph says "everything is connected." These are inconsistent readings of the same data.

**Recommendation:** When fallbacks fire, log a warning (or add a flag to `shape.data`) indicating that the classification was overridden. This preserves observability into upstream detection errors.

### `detectEnrichedConflicts` + `detectConflictClusters`

These are substantial computations (~80 lines combined) called unconditionally in `engine.ts` even for non-forked shapes. The results are used:
1. In `buildForkedData` (directly)
2. In `buildConstrainedData` (not directly — only patterns.tradeoffs is passed, not clusters)
3. In `patterns.conflictInfos` and `patterns.conflictClusters` (stored on analysis)

`patterns.conflictInfos` (enriched conflicts) and `patterns.conflictClusters` are on the analysis object. As of this audit, `patterns.conflicts` (the simpler `ConflictPair[]`) IS read by DecisionMapSheet; `patterns.conflictInfos` and `patterns.conflictClusters` are not confirmed as read by any UI component. The cluster computation may be partially decorative.

---

## Task 9: Secondary Patterns Audit

**Status: Mixed — 6 of 7 types LIVE (at indicator level); 3 of 7 LIVE at detail level**

### StructureGlyph rendering (boolean presence → icon/indicator)

| Pattern type | StructureGlyph | DecisionMapGraph detail |
|---|---|---|
| `dissent` | ✅ renders indicator | ✅ voices[].id, strongestVoice.id for node decoration |
| `keystone` | ✅ renders indicator | ✅ keystone.id for node decoration |
| `chain` | ✅ renders indicator | ✅ chain[] ids + positions for sequence rendering |
| `fragile` | ✅ renders indicator | ✅ fragilities[].peak.id for node decoration |
| `challenged` | ✅ renders indicator | ❌ data not consumed |
| `conditional` | ✅ renders indicator | ❌ data not consumed |
| `orphaned` | ❌ not checked | ❌ data not consumed |

### Pattern-level findings

**`detectOrphanedPattern`** — **DECORATIVE**. Not checked by StructureGlyph, not used by DecisionMapGraph. Detects isolated high-support peaks (no edges). The detection is cheap (~5 lines) but the output has no consumer. Either add it to StructureGlyph's pattern checks or remove the detector.

**`detectChallengedPattern`** and **`detectConditionalPattern`** — **LIVE at indicator level only**. StructureGlyph checks for their presence and renders an icon. The rich data inside (`challenges[]` pairs, `conditions[]` with branch arrays) is not consumed by any component. The detection produces full data structures that are never unpacked by the UI.

**`detectDissentPattern`** — **LIVE end-to-end**. The most comprehensively rendered pattern. `voices[]`, `strongestVoice`, and `suppressedDimensions` are all accessible to DecisionMapGraph for node-level annotation. `whyItMatters` strings are generated per voice. This is the richest pattern and the most exercised.

**`detectKeystonePattern`** and **`detectChainPattern`** — **LIVE end-to-end**. Both consumed by DecisionMapGraph for node decoration and layout decisions. Chain positions are used for sequential node arrangement.

**`detectFragilePattern`** — **LIVE at indicator level, partial at detail level**. DecisionMapGraph reads `fragilities[].peak.id` for node highlighting but not the `weakFoundation` detail (which could be rendered as a tooltip or detail view).

### Note on detection cost
Pattern detection functions range from 5 to 130 lines. The heavier ones (`detectDissentPattern` at ~130 lines with four voice-detection paths) are justified by their live consumption. The lighter orphaned/challenged/conditional detectors have simpler implementations but orphaned has no consumer. The cost asymmetry is acceptable but worth noting.

---

## Inventory Summary

| Component | Function/Metric | Status |
|---|---|---|
| `engine.ts` | `computeStructuralAnalysis` | LIVE |
| `engine.ts` | `applyComputedRoles` | HEURISTIC (see Task 3) |
| `engine.ts` | `buildShapeData` dispatch + fallbacks | LIVE with epistemic caveats (Task 8) |
| `metrics.ts` | `computeLandscapeMetrics` | LIVE (`landscape` read by MetricsRibbon) |
| `metrics.ts` | `computeClaimRatios` | HEURISTIC (weights invented — Task 4) |
| `metrics.ts` | `assignPercentileFlags` | LIVE (`isHighSupport`, `isKeystone`, `isLeverageInversion`, etc. consumed by multiple paths) |
| `metrics.ts` | `computeCoreRatios` | DECORATIVE (no live consumer — Task 5) |
| `metrics.ts` | `supportSkew` + `isOutlier` | DECORATIVE (no UI renderer — Task 4) |
| `classification.ts` | `analyzePeaks` | LIVE |
| `classification.ts` | `detectPrimaryShape` | LIVE |
| `classification.ts` | `computePeakPairRelationships` | LIVE (`peakPairRelations` on shape, status uncertain but stored) |
| `classification.ts` | `detectCompositeShape` | LIVE |
| `patterns.ts` | `detectLeverageInversions` | LIVE (`leverageInversions` read by `buildForkedData.fragilities`) |
| `patterns.ts` | `detectCascadeRisks` | LIVE (used by `assignPercentileFlags` for `evidenceGapScore`) |
| `patterns.ts` | `detectConflicts` | LIVE (`patterns.conflicts` read by DecisionMapSheet) |
| `patterns.ts` | `detectTradeoffs` | LIVE (`patterns.tradeoffs` read by DecisionMapSheet) |
| `patterns.ts` | `detectConvergencePoints` | UNCERTAIN (stored on patterns, no confirmed UI reader) |
| `patterns.ts` | `detectIsolatedClaims` | UNCERTAIN (stored on patterns, no confirmed UI reader) |
| `patterns.ts` | `detectEnrichedConflicts` | LIVE (feeds buildForkedData and patterns.conflictInfos) |
| `patterns.ts` | `detectConflictClusters` | HEURISTIC/PARTIALLY DECORATIVE (cluster structure unconfirmed in UI) |
| `patterns.ts` | `analyzeGhosts` | DECORATIVE (summary object — Task 7) |
| `patterns.ts` | `detectDissentPattern` | LIVE end-to-end |
| `patterns.ts` | `detectKeystonePattern` | LIVE end-to-end |
| `patterns.ts` | `detectChainPattern` | LIVE end-to-end |
| `patterns.ts` | `detectFragilePattern` | LIVE (indicator + partial detail) |
| `patterns.ts` | `detectChallengedPattern` | LIVE (indicator only) |
| `patterns.ts` | `detectConditionalPattern` | LIVE (indicator only) |
| `patterns.ts` | `detectOrphanedPattern` | DECORATIVE (no consumer — Task 9) |
| `builders.ts` | `buildConvergentData` | LIVE (hoisted fields); UNCERTAIN (rich detail) |
| `builders.ts` | `buildForkedData` | LIVE (hoisted fields); UNCERTAIN (cluster detail) |
| `builders.ts` | `buildConstrainedData` | LIVE (hoisted fields); UNCERTAIN (rich detail) |
| `builders.ts` | `buildParallelData` | UNCERTAIN (no hoisted fields, no confirmed UI reader) |
| `builders.ts` | `buildSparseData` | PARTIALLY LIVE (signalStrength); UNCERTAIN (detail fields) |
| `builders.ts` | `buildKeystonePatternData` | LIVE (consumed by detectKeystonePattern → DecisionMapGraph) |
| `builders.ts` | `buildChainPatternData` | LIVE (consumed by detectChainPattern → DecisionMapGraph) |
| `graph.ts` | `computeConnectedComponents` | LIVE (`componentCount`, `components` consumed by builders and classification) |
| `graph.ts` | `computeLongestChain` | LIVE (chain pattern detection) |
| `graph.ts` | `findArticulationPoints` | DECORATIVE (stored on `graph.articulationPoints`, no confirmed consumer reads it) |
| `graph.ts` | `analyzeGraph` | LIVE (but `articulationPoints`, `localCoherence`, `clusterCohesion` are DECORATIVE sub-outputs) |
| `utils.ts` | `computeSignalStrength` | HEURISTIC formula; PARTIALLY DECORATIVE at shape level (Task 6) |
| `utils.ts` | `getTopNCount`, `isInTopPercentile`, `isInBottomPercentile` | LIVE (used in percentile flag assignment) |
| `utils.ts` | `isHubLoadBearing` | LIVE (keystone detection) |
| `utils.ts` | `determineTensionDynamics` | LIVE (conflict rendering) |

---

## Candidates for Next Pass

Listed in priority order (highest impact-to-effort ratio):

1. **`detectOrphanedPattern`** — Add to StructureGlyph checks or remove. The cost is low either way.
2. **`isOutlier` / `supportSkew`** — Wire to a UI warning ("support concentrated from one model") or remove from `EnrichedClaim`. The concept is valuable; the implementation just needs a renderer.
3. **`computeCoreRatios`** — Reconnect to `positionBrief` / `synthesisPrompt` when those are reintroduced. These ratios are the most natural candidates for synthesis-layer inputs.
4. **`ghostAnalysis` summary** — Either wire `mayExtendChallenger` to a UI affordance or drop the summary object and keep only raw ghost strings flowing to builders.
5. **Fallback cascade documentation** — Log a warning (or add a `classificationOverride` flag to `shape`) when forked/parallel fall back. Preserves observability into upstream detection errors.
6. **`graph.articulationPoints`** — Computed by Tarjan's algorithm (non-trivial cost), stored on `GraphAnalysis`, never consumed. Remove or wire to a UI affordance (articulation points are where the graph would split if removed — a useful structural observation).
7. **`detectConvergencePoints` / `detectIsolatedClaims`** — Need tracing into UI to confirm whether `patterns.convergencePoints` and `patterns.isolatedClaims` are read anywhere. Not confirmed during this audit.
8. **Shape data detail fields** — A dedicated UI audit of shape.data sub-structures (floor claims, tradeoff options, dimension clusters, etc.) would clarify which rich fields are rendered vs. decorative. This requires running the full UI, not static analysis.
9. **`applyComputedRoles` override** — Consider making additive rather than destructive: preserve mapper role as `role_mapper` field, use computed role as `role`, surface disagreements in observability panel.





extras

Update(src\core\structural-analysis\engine.ts)
  ⎿  Added 38 lines
      33  } from "./builders";
      34  type ConditionalAffectedClaims = Array<{ affectedClaims: string[] }>;
      35
      36 +/*
      37 + * AUDIT: applyComputedRoles — HEURISTIC
      38 + *
      39 + * WHY IT EXISTS:
      40 + *   The mapper assigns roles (anchor, challenger, branch, supplement) using LLM
      41 + *   reasoning over the full claim text. This function overrides those assignments
      42 + *   using graph structure alone (edge types, support ratios). The override exists
      43 + *   because LLM role assignment is inconsistent across runs and models; structural
      44 + *   evidence is deterministic and reproducible. The tradeoff: structural evidence
      45 + *   ignores semantic content that the mapper understood.
      46 + *
      47 + * WHAT IT MEASURES:
      48 + *   Challenger: one side of a conflict edge has ≥50% support, the other doesn't.
      49 + *   Branch: claim appears in a conditional's affectedClaims or downstream of a
      50 + *           conditional via prerequisite edges.
      51 + *   Anchor: score ≥ 2 on (prereqOut*2 + supportIn*1 + conflictTargets*1.5 +
      52 + *           dependentsArePrereqs*1.5). Threshold and weights are heuristic,
      53 + *           chosen by design intuition, not calibrated against outcomes.
      54 + *   Supplement: everything else.
      55 + *
      56 + * KNOWN LIMITATIONS:
      57 + *   1. The 50% consensus threshold is percentage-based (relative to modelCount),
      58 + *      making it scale-consistent but not calibrated to any quality outcome. With
      59 + *      3 models, 2 supporters qualifies as consensus; with 10 models, 5 are needed.
      60 + *      The threshold is reasonable but arbitrary.
      61 + *   2. Anchor score weights (2, 1, 1.5, 1.5) and the ≥ 2 threshold are invented.
      62 + *      No empirical validation exists; they encode intuitions about structural
      63 + *      importance (prerequisite chains outweigh incoming support).
      64 + *   3. Branch detection is structurally derived but may not match how the traversal
      65 + *      engine uses branch roles. If traversal doesn't distinguish branch from
      66 + *      supplement when pruning, branch detection is DECORATIVE for that path.
      67 + *      (As of this audit, traversal uses edge types, not claim roles, for pruning.)
      68 + *
      69 + * FUTURE DIRECTION:
      70 + *   Consider removing in favor of trusting mapper roles, or making the override
      71 + *   additive (flag structural contradictions) rather than destructive (silently
      72 + *   replace LLM reasoning with graph topology).
      73 + */
      74  const applyComputedRoles = (
      75      claims: Claim[],
      76      edges: Edge[],

● Update(src\core\structural-analysis\metrics.ts)
  ⎿  Added 8 lines
      13      isHubLoadBearing
      14  } from "./utils";
      15
      16 +// AUDIT: computeCoreRatios — DECORATIVE
      17 +// Returns concentration, alignment, tension, fragmentation, depth.
      18 +// As of this audit, no UI component or downstream consumer reads `ratios` from
      19 +// the StructuralAnalysis object. The context-resolver discards it; StepExecutor
      20 +// diagnostics don't reference it; no UI component destructures it.
      21 +// These ratios are candidates for removal once positionBrief/synthesisPrompt are
      22 +// reconnected — at that point they could feed the synthesis layer meaningfully.
      23 +// DO NOT REMOVE YET: retain as documented placeholders for the reconnection phase.
      24  export const computeCoreRatios = (
      25      claims: EnrichedClaim[],
      26      edges: Edge[],

● Update(src\core\structural-analysis\metrics.ts)
  ⎿  Added 25 lines
      114      };
      115  };
      116
      117 +// AUDIT: computeClaimRatios — HEURISTIC
      118 +// The leverage score combines four weights into a single number per claim.
      119 +// These weights are heuristic (design intuition), not calibrated against outcomes:
      120 +//   supportWeight  = supportRatio * 2         — HEURISTIC: doubles support's contribution
      121 +//   roleWeight     = { challenger:4, anchor:2, branch:1, supplement:0.5 } — HEURISTIC:
      122 +//     challenger is weighted highest because it structurally constrains the peak;
      123 +//     values are round-number intuitions, not derived from data.
      124 +//   connectivityWeight = prereqOut*2 + prereqIn + conflictEdges*1.5 + degree*0.25 — HEURISTIC:
      125 +//     prerequisite-out is weighted heaviest (you gate others); conflict edges more
      126 +//     than degree edges (conflict is structural not incidental). All multipliers invented.
      127 +//   positionWeight = isChainRoot ? 2 : 0     — HEURISTIC: chain roots get a flat bonus
      128 +//     on the assumption that the first link in a dependency chain is disproportionately
      129 +//     important. The value 2 is not calibrated.
      130 +//
      131 +// keystoneScore = outDegree * supporters.length — HEURISTIC:
      132 +//   Treats outgoing-connection count and supporter count as symmetric contributors to
      133 +//   keystoneness. A claim with 2 out-edges and 6 supporters scores 12; so does one with
      134 +//   6 out-edges and 2 supporters. These are structurally different situations (broad
      135 +//   support vs. broad connectivity) but the formula equates them. The assumption is that
      136 +//   both dimensions independently signal "load-bearing" status. Unvalidated.
      137 +//
      138 +// supportSkew = maxFromSingleModel / supporters.length — HEURISTIC:
      139 +//   Measures whether one model dominates a claim's support. Used only for the isOutlier
      140 +//   flag in assignPercentileFlags. isOutlier is not rendered by any current UI component;
      141 +//   if that remains true, supportSkew and isOutlier are DECORATIVE.
      142  export const computeClaimRatios = (
      143      claim: Claim,
      144      edges: Edge[],

● Update(src\core\structural-analysis\utils.ts)
  ⎿  Added 32 lines
      37      return value < threshold;
      38  };
      39
      40 +// AUDIT: computeSignalStrength — HEURISTIC (partially DECORATIVE)
      41 +//
      42 +// Semantic: signal strength estimates "how much structure can be read from this
      43 +// artifact." High signal = confident classifications. Low signal = sparse/uncertain.
      44 +//
      45 +// Formula: edgeSignal*0.4 + supportSignal*0.3 + coverageSignal*0.3
      46 +//
      47 +//   edgeSignal = edges / max(3, claims*0.15) clamped 0-1
      48 +//     Measures edge density relative to a minimum threshold. The 0.15 multiplier
      49 +//     (15% of claims should have edges for "some structure") is heuristic.
      50 +//
      51 +//   supportSignal = variance(normalizedSupportCounts) * 5, clamped 0-1
      52 +//     The *5 multiplier is the key design decision: it assumes that DISAGREEMENT
      53 +//     between models (high variance in support counts) is more informative than
      54 +//     agreement (low variance). The logic: uniform support = models don't distinguish
      55 +//     claims; varying support = models have opinions. This is intentional but
      56 +//     counterintuitive — high signal does NOT mean strong consensus; it means
      57 +//     the artifact has discriminating structure. The *5 amplifier is arbitrary.
      58 +//
      59 +//   coverageSignal = uniqueModels / totalModels
      60 +//     Straightforward coverage measure. LIVE and well-motivated.
      61 +//
      62 +//   Weights (0.4, 0.3, 0.3) are heuristic, not calibrated.
      63 +//
      64 +// CONSUMER CHAIN:
      65 +//   signalStrength is stored on ProblemStructure.signalStrength AND passed to
      66 +//   buildSparseData() where it's stored in ExploratoryShapeData.signalStrength.
      67 +//   As of this audit, no UI component reads shape.signalStrength directly.
      68 +//   buildSparseData renders it into ExploratoryShapeData for potential UI use,
      69 +//   but current UI components don't surface it. PARTIALLY DECORATIVE at the
      70 +//   ProblemStructure level; potentially LIVE inside ExploratoryShapeData if
      71 +//   a future component renders that pattern's detail view.
      72  export const computeSignalStrength = (
      73      claimCount: number,
      74      edgeCount: number,

● Update(src\core\structural-analysis\patterns.ts)
  ⎿  Added 8 lines
      517      return claims.filter((c) => c.isIsolated).map((c) => c.id);
      518  };
      519
      520 +// AUDIT: analyzeGhosts — DECORATIVE
      521 +// ghostAnalysis ends up on StructuralAnalysis.ghostAnalysis. As of this audit,
      522 +// no UI component reads structuralAnalysis.ghostAnalysis. The ghost strings
      523 +// themselves flow into shape data builders (buildConvergentData's `blindSpots`,
      524 +// buildParallelData's `gaps`, buildSparseData's clarifyingQuestions) and those
      525 +// fields may be rendered if a component renders shape.data detail views.
      526 +// But the ghostAnalysis summary object itself (count, mayExtendChallenger,
      527 +// challengerIds) has no live consumer. DECORATIVE until wired to UI.
      528  export const analyzeGhosts = (ghosts: string[], claims: EnrichedClaim[]): StructuralAnalysis["ghostAnalysis"] => {
      529      const challengers = claims.filter((c) => c.role === "challenger" || c.isChallenger);
      530      return {

● Update(src\core\structural-analysis\builders.ts)
  ⎿  Added 55 lines
      105      return "assumptions underlying the consensus";
      106  }
      107
      108 +// AUDIT: Shape Data Builders — LIVE (structure), PARTIALLY DECORATIVE (detail fields)
      109 +//
      110 +// All builders produce shape.data (ProblemStructure.data), which is stored on the
      111 +// StructuralAnalysis object. The primary consumers are:
      112 +//   - engine.ts itself: extracts floorAssumptions, centralConflict, tradeoffs from
      113 +//     shape.data and hoists them to top-level shape properties (LIVE path).
      114 +//   - UI components: CognitiveOutputRenderer, MetricsRibbon, DecisionMapGraph read
      115 +//     shape.primary / shape.patterns / shape.confidence / shape.evidence but do NOT
      116 +//     appear to drill into shape.data's rich sub-structures (floor arrays, cluster
      117 +//     objects, dimension clusters, etc.) as of this audit.
      118 +//
      119 +// Per-builder status:
      120 +//
      121 +//   buildConvergentData → SettledShapeData
      122 +//     LIVE: floorAssumptions (hoisted to shape, displayed by MetricsRibbon via evidence)
      123 +//     LIVE: floor[] (may be read by DecisionMapGraph for node highlighting — unconfirmed)
      124 +//     HEURISTIC: floorStrength ("strong"/"moderate"/"weak" thresholds: 0.6 and 0.4 are
      125 +//       round-number heuristics, not calibrated)
      126 +//     DECORATIVE (likely): strongestOutlier, challengers[], transferQuestion —
      127 +//       rich fields with no confirmed UI renderer as of this audit
      128 +//
      129 +//   buildForkedData → ContestedShapeData
      130 +//     LIVE: centralConflict (collapsingQuestion hoisted to shape.centralConflict)
      131 +//     HEURISTIC: detectEnrichedConflicts + detectConflictClusters are substantial
      132 +//       computations (~100 lines combined). Cluster structure (ConflictCluster[]) has
      133 +//       no confirmed UI renderer. The individual conflict axis and stakes are rich
      134 +//       data that may only partially reach the screen.
      135 +//     NOTE — FALLBACK EPISTEMIC ISSUE: if classified 'forked' but enrichedConflicts
      136 +//       and conflictClusters are both empty, builder falls back to buildConvergentData.
      137 +//       This silently reclassifies a forked shape as convergent. The primary shape
      138 +//       label then mismatches the data pattern. A forked classification with no
      139 +//       extractable conflicts indicates a classification error upstream (peak analysis
      140 +//       detected conflict edges but enrichedConflicts found none); the fallback masks
      141 +//       this rather than surfacing it.
      142 +//
      143 +//   buildConstrainedData → TradeoffShapeData
      144 +//     LIVE: tradeoffs[] labels (hoisted to shape.tradeoffs as string array)
      145 +//     DECORATIVE (likely): dominatedOptions[], full TradeoffOption objects with text
      146 +//       and supportRatio detail — no confirmed UI renderer
      147 +//
      148 +//   buildParallelData → DimensionalShapeData
      149 +//     DECORATIVE (likely): dimensions[], interactions[], dominantDimension,
      150 +//       hiddenDimension, governingConditions — rich structure with no confirmed
      151 +//       UI renderer. Ghost strings flow in as gaps[].
      152 +//     NOTE — FALLBACK: if graph.componentCount < 2, reclassifies as convergent.
      153 +//       Same epistemic issue as forked fallback: classification says 'parallel'
      154 +//       but data says 'not enough components'. Masks the mismatch.
      155 +//
      156 +//   buildSparseData → ExploratoryShapeData
      157 +//     LIVE: signalStrength (stored, may be rendered by future sparse detail view)
      158 +//     HEURISTIC: sparsityReasons thresholds (componentCount > claims*0.5,
      159 +//       avgSupport < 0.3, ghosts > claims*0.3) are round-number heuristics
      160 +//     DECORATIVE (likely): looseClusters[], outerBoundary, clarifyingQuestions[]
      161 +//       — no confirmed UI renderer for these fields
      162 +//
      163  export const buildConvergentData = (
      164      claims: EnrichedClaim[],
      165      edges: Edge[],

● Update(src\core\structural-analysis\patterns.ts)
  ⎿  Added 27 lines
      297      };
      298  };
      299
      300 +// AUDIT: Secondary Pattern Renderers
      301 +//
      302 +// shape.patterns (SecondaryPattern[]) flows to:
      303 +//   - StructureGlyph: checks for keystone, chain, dissent, fragile, challenged, conditional
      304 +//     presence (boolean checks — renders an icon or indicator if the pattern exists).
      305 +//     ALL SIX of these types trigger UI output. orphaned is NOT checked by StructureGlyph.
      306 +//   - DecisionMapGraph: reads dissent (strongestVoice.id, voices[].id), keystone
      307 +//     (keystone.id), chain (chain[] ids with position), fragile (fragilities[].peak.id)
      308 +//     for node decoration. Does NOT use challenged, conditional, or orphaned.
      309 +//   - CognitiveOutputRenderer: passes patterns array to StructureGlyph (no direct reads).
      310 +//   - classification.ts: maps pattern types to evidence strings for shape.evidence array.
      311 +//
      312 +// Per-pattern UI rendering status:
      313 +//   dissent    — LIVE: StructureGlyph (indicator) + DecisionMapGraph (node decoration)
      314 +//   keystone   — LIVE: StructureGlyph (indicator) + DecisionMapGraph (node decoration)
      315 +//   chain      — LIVE: StructureGlyph (indicator) + DecisionMapGraph (node sequence)
      316 +//   fragile    — LIVE: StructureGlyph (indicator) + DecisionMapGraph (node decoration)
      317 +//   challenged — LIVE: StructureGlyph (indicator only, no detail rendering confirmed)
      318 +//   conditional — LIVE: StructureGlyph (indicator only, no detail rendering confirmed)
      319 +//   orphaned   — DECORATIVE: not checked by StructureGlyph, not used by DecisionMapGraph.
      320 +//     Detection cost is low (~5 lines) but output has no live consumer. Candidate for
      321 +//     removal or for adding to StructureGlyph's pattern checks.
      322 +//
      323 +// NOTE: For dissent, keystone, chain, fragile — the pattern.data sub-structures are
      324 +//   consumed by DecisionMapGraph for node-level decoration. The rich fields inside
      325 +//   (dissentVoices[], strongestVoice, cascadeSize, weakLinks[], etc.) are accessed.
      326 +//   For challenged and conditional, only the pattern's existence is checked (not data).
      327  export const detectAllSecondaryPatterns = (
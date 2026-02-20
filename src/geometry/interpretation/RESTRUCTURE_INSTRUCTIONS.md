# Geometry Interpretation Layer Restructure

## Guiding Principle

**The geometry layer must only compute what embeddings can actually prove.** Every calculation must be either (a) a direct measurement with no semantic claim, or (b) a conservative topological gate whose failure mode is "proceed anyway" rather than "lose data." Anything that requires understanding meaning (what text says, whether two positions agree or disagree, what a region "represents") is the mapper's job, not geometry's.

The **inversion test** determines whether a calculation is honest: *can you construct a scenario where the geometric measurement is true but the semantic inference is false?* If yes, the calculation overreaches. Opposition detection, shape labeling, expected claim counts, relationship classification between regions — all fail this test trivially. Measurements like model diversity, internal density, isolation, cosine similarity, connected components — these pass.

---

## Part 1: Removals

### 1.1 DELETE: `opposition.ts`

**File:** `src/geometry/interpretation/opposition.ts`

**Why:** `detectOppositions` infers semantic conflict from geometric proximity + regex-derived stance labels. Two regions can be geometrically close because they discuss the same topic from the same angle using different rhetorical framing that triggers different stance regexes. "Be careful with X" (cautionary) and "You should do X" (prescriptive) can be the same advice. The inversion is trivial — this calculation claims meaning from form.

**Action:** Delete the entire file.

**Downstream cleanup:**
- Remove `import { detectOppositions }` from `src/geometry/interpretation/index.ts`
- Remove `detectOppositions` call from `buildPreSemanticInterpretation` in `src/geometry/interpretation/index.ts`
- Remove `export { detectOppositions }` from `src/geometry/index.ts`
- Remove `OppositionPair` type from `src/geometry/interpretation/types.ts`
- Remove `OppositionPair` from all export lists in `src/geometry/interpretation/index.ts` and `src/geometry/index.ts`

### 1.2 DELETE: `routing.ts`

**File:** `src/geometry/interpretation/routing.ts`

**Why:** `routeRegions` consumes oppositions and `interRegionSignals` to classify regions as `partition_candidate` / `gate_candidate` / `unrouted`. Both input signals are being removed. The conditional density proxy (using stance distribution as a stand-in for actual conditional signals) is also epistemically suspect — stance distribution does not reliably indicate conditionality. The routing concept is replaced by the new pipeline gates (Part 2.1).

**Action:** Delete the entire file.

**Downstream cleanup:**
- Remove all exports of `routeRegions`, `RoutingResult`, `RoutedRegion`, `RegionRoute` from `src/geometry/interpretation/index.ts` and `src/geometry/index.ts`
- The only current consumer is `src/ConciergeService/oldstep.js` (already deprecated). No live pipeline dependency.

### 1.3 DELETE: `guidance.ts`

**File:** `src/geometry/interpretation/guidance.ts`

**Why:** `buildMapperGeometricHints` produces `MapperGeometricHints` containing: `predictedShape` (label on topology), `expectedClaimCount` (guess with unknown error bounds), `expectedConflicts` (derived from deleted oppositions), `expectedDissent` (derived from deleted oppositions), `attentionRegions` (narrative guidance strings about what geometry "means"). All of these fail the inversion test. The hints are not currently fed to the mapper anyway.

**Action:** Delete the entire file. Its replacement is the model ordering module (Part 2.2).

**Downstream cleanup:**
- Remove `import { buildMapperGeometricHints }` from `src/geometry/interpretation/index.ts`
- Remove `buildMapperGeometricHints` call from `buildPreSemanticInterpretation`
- Remove `export { buildMapperGeometricHints }` from `src/geometry/index.ts`
- Remove `MapperGeometricHints` and `ShapePrediction` types from `src/geometry/interpretation/types.ts`
- Remove `MapperGeometricHints`, `ShapePrediction` from all export lists
- Delete `src/geometry/interpretation/guidance.test.ts`

### 1.4 REWRITE: `validation.ts`

**File:** `src/geometry/interpretation/validation.ts`

**Why:** `validateStructuralMapping` compares geometry predictions (which are guesses) against mapper output (which is also uncertain). When they disagree, you cannot determine which is wrong. The current implementation treats geometry as ground truth and scores the mapper's "fidelity" to it — this is backwards. The function will be replaced with advisory diagnostics (Part 2.3).

**Action:** Do not delete yet — it will be replaced in Part 2.3.

### 1.5 SIMPLIFY: `types.ts`

**File:** `src/geometry/interpretation/types.ts`

Remove these types entirely:
- `OppositionPair`
- `InterRegionRelationship`
- `InterRegionSignal`
- `ShapePrediction`
- `MapperGeometricHints`
- `StructuralViolation` (replaced by new diagnostic type in Part 2.3)
- `StructuralValidation` (replaced by new diagnostic type in Part 2.3)
- `ValidationInputs` (replaced)

Keep these types unchanged:
- `Regime`
- `AdaptiveLens`
- `Region`
- `RegionizationResult`
- `RegionProfile`
- `InterpretationInputs`
- `ClaimWithProvenance`
- `EdgeList`

Modify `PreSemanticInterpretation`:

```typescript
// BEFORE:
export interface PreSemanticInterpretation {
    lens: AdaptiveLens;
    regionization: RegionizationResult;
    regionProfiles: RegionProfile[];
    oppositions: OppositionPair[];
    interRegionSignals: InterRegionSignal[];
    hints: MapperGeometricHints;
}

// AFTER:
export interface PreSemanticInterpretation {
    lens: AdaptiveLens;
    regionization: RegionizationResult;
    regionProfiles: RegionProfile[];
    pipelineGate: PipelineGateResult;
    modelOrdering: ModelOrderingResult;
}
```

The new types `PipelineGateResult` and `ModelOrderingResult` are defined in Parts 2.1 and 2.2 below.

### 1.6 SIMPLIFY: `shape.ts`

**File:** `src/geometry/shape.ts`

The raw topology signals (`fragmentationScore`, `bimodalityScore`, `parallelScore`) are honest measurements. The `ShapePrior` label and `recommendation` block are not.

**Action:** Keep `ShapeClassification` but remove the `recommendation` field. The `prior` label can remain as a convenience tag for logging/debugging, but it must not be used as a decision input. The pipeline gate (Part 2.1) replaces the decision role that shape classification was serving.

Remove:
```typescript
// Remove from ShapeClassification interface:
recommendation: {
    expectClusterCount: [number, number];
    expectConflicts: boolean;
    expectDissent: boolean;
};
```

Remove the `getExpectedClusterRange` function entirely.

Remove the `recommendation` assignment from `classifyShape`.

### 1.7 UPDATE: UI Observability

The `DecisionMapObservabilityRow.tsx` is not currently wired into the UI. The existing DecisionMap sheet is the active display surface.

**Action:**
- The pipeline gate result (verdict + measurements) and model ordering scores should be exposed as data that `DecisionMapSheet` (or any future diagnostics panel) can read.
- The full signal breakdown (per-model irreplaceability scores, per-region weights, gate evidence strings) should be available in a collapsible or secondary diagnostics layer — not front-and-center in the main Decision Map.
- Summary-level stats (gate verdict, model order, region count) are appropriate for the primary Decision Map view.
- Remove the `interRegionSignals` table from `DecisionMapObservabilityRow.tsx` so it doesn't confuse future wiring attempts. Replace with a placeholder that reads from the new `pipelineGate` and `modelOrdering` fields if/when the component gets wired.
- No specific UI layout is prescribed — integrate with whatever observability surface makes sense.

---

## Part 2: New Modules

### 2.1 NEW: Pipeline Gates — `pipelineGates.ts`

**File:** `src/geometry/interpretation/pipelineGates.ts`

**Purpose:** Conservative binary decisions about whether the topology has enough structure to be worth navigating. All gates default to "proceed" — the failure mode is never "skip something important." These replace the shape classification's decision role.

**Types:**

```typescript
export type GateVerdict = 'proceed' | 'skip_geometry' | 'trivial_convergence' | 'insufficient_structure';

export interface PipelineGateResult {
    verdict: GateVerdict;
    confidence: number;         // how confident the gate is in its verdict
    evidence: string[];         // human-readable reasons for the verdict
    measurements: {
        isDegenerate: boolean;
        largestComponentRatio: number;
        largestComponentModelDiversityRatio: number;
        isolationRatio: number;
        maxComponentSize: number;
        nodeCount: number;
    };
}
```

**Function signature:**

```typescript
export function evaluatePipelineGates(
    substrate: GeometricSubstrate
): PipelineGateResult
```

**What each verdict means for downstream steps:**

| Verdict | Interpretation (regions, profiles) | Model ordering | Mapper | Traversal |
|---------|-----------------------------------|----------------|--------|-----------|
| `proceed` | Full computation | Use computed ordering | Receives text in computed model order | Normal — mapper decides traversal structure |
| `skip_geometry` | Skip entirely — substrate is degenerate, no valid embeddings to work with | Default model order (1,2,3,4,5,6) | Receives text in default order | Mapper decides from text alone |
| `trivial_convergence` | Full computation — measurements are valid | Use computed ordering (still informative even in convergent case) | Receives text in computed order | Likely unnecessary — all models agree. Flag to caller that traversal can be simplified or skipped |
| `insufficient_structure` | Computed but results are low-signal — regions will be mostly single-node patches, profiles will reflect fragmented landscape | Default model order — region structure too unreliable to base ordering on | Receives text in default order | Mapper decides from text alone |

**Gate logic (evaluated in order, first match wins):**

1. **Degenerate gate:** If `isDegenerate(substrate)` → verdict `skip_geometry`.
   - This flag was already set during substrate construction (embedding failure, insufficient paragraphs, or all-identical embeddings). The gate does not discover degeneracy — it surfaces an already-known fact into the pipeline gate result so downstream consumers have one unified place to check.
   - Confidence: 1.0 (the substrate itself reported this).
   - Note: When this fires, `buildPreSemanticInterpretation` should still return a valid `PreSemanticInterpretation` object, but with empty regions, empty profiles, and default model ordering. The caller uses the `pipelineGate.verdict` to decide what to skip.

2. **Trivial convergence gate:**
   - Condition: Largest strong component contains >85% of nodes (`largestComponentRatio > 0.85`) AND that component has model diversity ratio > 0.8 (computed by checking how many distinct `modelIndex` values appear in the component's nodes versus total observed models) AND `isolationRatio < 0.1`.
   - Verdict: `trivial_convergence`
   - Confidence: Proportional to how far above thresholds the measurements are. E.g., `largestComponentRatio = 0.95` is higher confidence than `0.86`.
   - Meaning: Every model said roughly the same thing and the geometry reflects it. The mapper still receives all content (nothing is filtered), but the pipeline can skip traversal since there's likely nothing to disambiguate. This is a signal to the caller, not a hard gate — the caller decides whether to actually skip traversal.

3. **Insufficient structure gate:**
   - Condition: `isolationRatio > 0.7` AND no strong component with `size > 2`.
   - Verdict: `insufficient_structure`
   - Confidence: Proportional to how severe the fragmentation is (higher isolation = higher confidence in the verdict).
   - Meaning: The substrate exists and has valid topology numbers, but those numbers say "there's no useful structure here." Embeddings may be low quality, or the content is genuinely too fragmented for geometric analysis to help. Regions and profiles are still computed (they're still technically correct measurements of a fragmented landscape), but model ordering falls back to default because the region structure isn't reliable enough to base ordering decisions on. The mapper and traversal proceed as if geometry has nothing useful to contribute.

4. **Default:** verdict `proceed` — geometry has structure worth using.
   - Confidence: Based on how clearly the topology has structure (consider globalStrongDensity, componentCount, isolation levels). Higher density + lower isolation + more structure = higher confidence.

**Evidence array** should contain human-readable strings like `"largest_component=95%_of_nodes"`, `"model_diversity_in_largest=5/6"`, `"isolation_ratio=0.05"`, etc. These are for debugging/logging, not decision-making.

### 2.2 NEW: Model Ordering — `modelOrdering.ts`

**File:** `src/geometry/interpretation/modelOrdering.ts`

**Purpose:** Score each model by geometric irreplaceability — how much unique geometric terrain this model is the sole or primary carrier of. Then arrange models in outside-in order for context window placement (strongest at edges, weakest in middle) to exploit LLM primacy/recency attention bias. This is ordering, not filtering — every model's complete text is preserved in its original paragraph order within each model.

**Types:**

```typescript
export interface ModelScore {
    modelIndex: number;
    irreplaceability: number;    // higher = more irreplaceable
    breakdown: {
        soloCarrierRegions: number;       // regions where this is the only model present
        lowDiversityContribution: number; // weighted contribution to regions with modelDiversity <= 2
        totalParagraphsInRegions: number; // how many of this model's paragraphs landed in regions
    };
    queryRelevanceBoost?: number;  // reserved for future composition with query relevance
}

export interface ModelOrderingResult {
    /** Model indices in outside-in order. First and last are most irreplaceable. */
    orderedModelIndices: number[];
    scores: ModelScore[];
    meta: {
        totalModels: number;
        regionCount: number;
        processingTimeMs: number;
    };
}
```

**Function signature:**

```typescript
export function computeModelOrdering(
    regions: Region[],
    profiles: RegionProfile[],
    substrate: GeometricSubstrate,
    queryRelevanceBoost?: Map<number, number>  // modelIndex → boost factor, for future use
): ModelOrderingResult
```

**Irreplaceability scoring:**

For each model `m`, compute:

```
irreplaceability(m) = Σ over regions r containing m's paragraphs:
    (count of m's paragraphs in r) / (total paragraphs in r)
    × regionWeight(r)
```

Where `regionWeight(r)` = `1 / modelDiversity(r)`. This means:
- A region with modelDiversity=1 (only one model has paragraphs there) gives weight 1.0 — the sole carrier model gets full credit.
- A region with modelDiversity=6 gives weight ~0.17 — everyone covers it, nobody is irreplaceable for it.

This naturally scores high for:
- Models that are the **sole carrier** of sparsely-populated regions (outlier positions that would be lost without this model).
- Models that contribute **substantially** to regions where few other models participate.

And scores low for:
- Models whose paragraphs all land in high-diversity (consensus) regions where 5 other models also have content.

**How to get modelDiversity for a region:** Use `profiles` array. Each `RegionProfile` has `mass.modelDiversity`. Match by `regionId`.

**How to count model paragraphs per region:** Each `Region` has `nodeIds: string[]` (paragraph IDs). Each node in `substrate.nodes` has `paragraphId` and `modelIndex`. Build a map: for each region, count paragraphs per modelIndex.

**Breakdown fields:**
- `soloCarrierRegions`: count of regions where `modelDiversity == 1` AND this model has paragraphs there. Pure count.
- `lowDiversityContribution`: sum of `(m's paragraphs in r) / (total paragraphs in r)` only for regions where `modelDiversity <= 2`.
- `totalParagraphsInRegions`: count of this model's paragraphs that are inside any region (vs orphaned nodes not in any region).

**Outside-in placement:**

After scoring, sort models by `irreplaceability` descending. Then interleave into positions from edges toward center:

```
sorted by score: [m1, m2, m3, m4, m5, m6]  (highest → lowest irreplaceability)

Placement algorithm:
  position 0 (first)  ← m1  (most irreplaceable)
  position 5 (last)   ← m2  (second most)
  position 1          ← m3
  position 4          ← m4
  position 2          ← m5
  position 3          ← m6  (least irreplaceable, buried in middle)

Result array: [m1, m3, m5, m6, m4, m2]
```

Implementation:
```typescript
function outsideInOrder(sortedIndices: number[]): number[] {
    const result = new Array(sortedIndices.length);
    let left = 0;
    let right = sortedIndices.length - 1;
    for (let i = 0; i < sortedIndices.length; i++) {
        if (i % 2 === 0) {
            result[left++] = sortedIndices[i];
        } else {
            result[right--] = sortedIndices[i];
        }
    }
    return result;
}
```

**Edge cases:**
- If `regions.length === 0` (geometry had nothing — e.g., insufficient_structure verdict), fall back to original model order `[1, 2, 3, 4, 5, 6]`.
- If all models have equal irreplaceability (uniform distribution across regions), preserve original order — no reason to reorder.
- Models that have zero paragraphs in any region should go to the middle (lowest priority).

**Future composition (do not implement now, just reserve the interface):**

When query relevance is integrated, the final ordering will multiply:
```
finalScore(m) = irreplaceability(m) × queryRelevanceBoost.get(m) ?? 1.0
```
This ensures a model that is geometrically unique but off-topic doesn't get prime position. The `queryRelevanceBoost` parameter already accepts this. When provided, multiply each model's irreplaceability by its boost before sorting.

### 2.3 NEW: Advisory Diagnostics — `diagnostics.ts`

**File:** `src/geometry/interpretation/diagnostics.ts`

**Purpose:** After the mapper runs, produce observations about discrepancies between geometric structure and mapper output. These are **questions, not verdicts**. They are for power-user debugging and UI display only. They do not feed back into the pipeline or correct anything.

**Types:**

```typescript
export interface GeometricObservation {
    type:
        | 'uncovered_peak'           // peak region has no corresponding high-support claim
        | 'overclaimed_floor'        // floor region spawned multiple claims
        | 'claim_count_outside_range'// more or fewer claims than geometric position groups suggest
        | 'topology_mapper_divergence' // topology shows X components but mapper found Y independent claim groups
        | 'embedding_quality_suspect'; // topology fragmented but mapper found convergence (embeddings may be bad)
    observation: string;             // human-readable description of what was observed
    regionIds?: string[];
    claimIds?: string[];
}

export interface DiagnosticsResult {
    observations: GeometricObservation[];
    summary: string;                 // one-line summary for UI header
    meta: {
        regionCount: number;
        claimCount: number;
        processingTimeMs: number;
    };
}
```

**Function signature:**

```typescript
import type { StructuralAnalysis } from '../../../shared/contract';

export function computeDiagnostics(
    preSemantic: PreSemanticInterpretation,
    postSemantic: StructuralAnalysis
): DiagnosticsResult
```

**Observations to compute:**

1. **`uncovered_peak`:** For each peak-tier region, check whether any claim with `supportRatio > 0.3` has `sourceStatementIds` overlapping that region's `statementIds`. If a peak region has zero claim coverage, emit observation: `"Peak region {regionId} (modelDiversity={n}, density={d}) has no corresponding high-support claim. The mapper may have missed a consensus position, or the region's geometric prominence may not reflect semantic importance."` This is an honest question — it flags the discrepancy without asserting which side is wrong.

2. **`overclaimed_floor`:** For each floor-tier region, count claims whose `sourceStatementIds` overlap that region. If count > 1, emit: `"Floor region {regionId} spawned {n} claims. The mapper may have found nuance the geometry couldn't see, or may have fragmented a single position."` Again, honest uncertainty.

3. **`claim_count_outside_range`:** Use the same union-find position counting approach from the old `guidance.ts` (this is a measurement, not an interpretation): count connected components at the `hardMergeThreshold` in the mutual graph. If mapper claim count is less than the number of multi-member components or more than 2× total position groups, flag it. Observation should state both numbers without asserting which is correct.

4. **`topology_mapper_divergence`:** Compare strong graph component count to the number of independent claim groups (claims that share no edges). If they differ significantly, flag. Again purely observational.

5. **`embedding_quality_suspect`:** If the topology is fragmented (isolationRatio > 0.5, no component > 40% of nodes) but the mapper found convergent structure (one dominant claim with supportRatio > 0.7), this suggests the embeddings may not be tracking semantic content well. Flag for investigation.

**Important:** Every observation string must be phrased as a question or neutral observation, never as a verdict. Use "may have" not "did." Use "suggests" not "proves."

---

## Part 3: Rewire the Orchestrator

### 3.1 UPDATE: `index.ts`

**File:** `src/geometry/interpretation/index.ts`

The `buildPreSemanticInterpretation` function must be updated to use the new modules and drop the old ones.

```typescript
import type { ParagraphCluster } from '../../clustering/types';
import type { ShadowParagraph } from '../../shadow/ShadowParagraphProjector';
import type { GeometricSubstrate } from '../types';
import type { PreSemanticInterpretation } from './types';
import { isDegenerate } from '../types';
import { deriveLens } from './lens';
import { buildRegions } from './regions';
import { profileRegions } from './profiles';
import { evaluatePipelineGates } from './pipelineGates';
import { computeModelOrdering } from './modelOrdering';

export function buildPreSemanticInterpretation(
    substrate: GeometricSubstrate,
    paragraphs: ShadowParagraph[],
    clusters?: ParagraphCluster[],
    paragraphEmbeddings?: Map<string, Float32Array> | null
): PreSemanticInterpretation {
    const lens = deriveLens(substrate);
    const pipelineGate = evaluatePipelineGates(substrate);

    // If geometry is degenerate, return minimal result with defaults
    if (pipelineGate.verdict === 'skip_geometry') {
        return {
            lens,
            regionization: {
                regions: [],
                meta: {
                    regionCount: 0,
                    kindCounts: { cluster: 0, component: 0, patch: 0 },
                    fallbackUsed: true,
                    fallbackReason: 'clustering_skipped_by_lens',
                    coveredNodes: 0,
                    totalNodes: substrate.nodes.length,
                },
            },
            regionProfiles: [],
            pipelineGate,
            modelOrdering: computeModelOrdering([], [], substrate),
            // ^ returns default order when regions is empty
        };
    }

    const regionization = buildRegions(substrate, paragraphs, lens, clusters);
    const regionProfiles = profileRegions(
        regionization.regions, substrate, paragraphs, paragraphEmbeddings ?? null
    );

    // If insufficient structure, compute regions/profiles (they're measurements)
    // but model ordering falls back to default since region structure is unreliable
    const modelOrdering = pipelineGate.verdict === 'insufficient_structure'
        ? computeModelOrdering([], [], substrate)  // forces default order
        : computeModelOrdering(regionization.regions, regionProfiles, substrate);

    return {
        lens,
        regionization,
        regionProfiles,
        pipelineGate,
        modelOrdering,
    };
}
```

Update all exports:
- Remove exports: `detectOppositions`, `buildMapperGeometricHints`, `OppositionPair`, `InterRegionRelationship`, `InterRegionSignal`, `ShapePrediction`, `MapperGeometricHints`
- Add exports: `evaluatePipelineGates`, `computeModelOrdering`, `PipelineGateResult`, `GateVerdict`, `ModelOrderingResult`, `ModelScore`
- Keep `validateStructuralMapping` export temporarily — rename to `computeDiagnostics` after Part 2.3 is implemented

### 3.2 UPDATE: `src/geometry/index.ts`

Mirror the export changes from 3.1. Remove all references to deleted types and functions. Add new exports.

### 3.3 UPDATE: `lens.ts`

**File:** `src/geometry/interpretation/lens.ts`

Currently `deriveLens` depends on `shape.recommendation` indirectly (through `shape.confidence`). Since we're removing `recommendation` from shape but keeping the rest, verify `deriveLens` still compiles. It should — it only reads `shape.prior`, `shape.confidence`, and topology/stats.

No functional changes needed, just verify compilation after shape.ts changes.

---

## Part 4: What Stays Unchanged

These files require NO modifications (verify they compile after type changes):

- `src/geometry/interpretation/regions.ts` — partition construction, pure Level 1
- `src/geometry/interpretation/profiles.ts` — measurements only (tier, mass, purity, geometry blocks)
- `src/geometry/interpretation/lens.ts` — topology-based clustering decision (may need recompile check)
- `src/geometry/substrate.ts` — substrate builder
- `src/geometry/knn.ts` — KNN graph construction
- `src/geometry/threshold.ts` — threshold computation
- `src/geometry/topology.ts` — topology computation
- `src/geometry/nodes.ts` — node stats
- `src/geometry/alignment.ts` — claim↔geometry alignment (post-hoc, embedding-based). Note: this may reference deleted types from validation — check and update imports if needed.
- `src/geometry/queryRelevance.ts` — query relevance scoring

---

## Part 5: Verification Checklist

After all changes:

1. **Compile check:** `tsc --noEmit` from project root. All type errors from removed types must be resolved.

2. **No orphan imports:** Search the entire `src/` tree for any remaining imports of: `OppositionPair`, `InterRegionSignal`, `InterRegionRelationship`, `MapperGeometricHints`, `ShapePrediction`, `detectOppositions`, `buildMapperGeometricHints`, `routeRegions`, `RoutingResult`, `RoutedRegion`, `RegionRoute`. All must be removed.

3. **No orphan imports in `ui/`:** Search `ui/` for `interRegionSignal`, `oppositions`, `MapperGeometricHints`. Update any references found.

4. **Test files:** Delete `src/geometry/interpretation/guidance.test.ts`. Check for any other test files referencing deleted types/functions and update them.

5. **`shared/contract.ts`:** Check if `PrimaryShape` type is still needed by other consumers. If only used by the deleted guidance/validation, it can stay (it's referenced by the structural analysis engine which is separate). Do not remove from shared contract.

6. **`ConciergeService/oldstep.js` and `ConciergeService/oldinterpreindex.ts`:** These are already deprecated old files. They reference `routeRegions`, `detectInterRegionSignals`, `computeDisruptionScores`, etc. Leave them as-is — they're archived reference code. Do not update them.

7. **PreSemanticInterpretation consumers:** Search for all code that reads `preSemantic.oppositions`, `preSemantic.interRegionSignals`, `preSemantic.hints`. All must be updated or removed.

8. **Documentation:** After all code changes are complete, update the pipeline documentation files to reflect the new architecture. The geometry interpretation layer section should describe: pipeline gates, region profiling (unchanged), model ordering, and advisory diagnostics. Remove all references to oppositions, inter-region signals, mapper geometric hints, and structural validation scoring.

---

## Summary of File Actions

| File | Action |
|------|--------|
| `interpretation/opposition.ts` | DELETE |
| `interpretation/routing.ts` | DELETE |
| `interpretation/guidance.ts` | DELETE |
| `interpretation/guidance.test.ts` | DELETE |
| `interpretation/validation.ts` | REWRITE → `diagnostics.ts` |
| `interpretation/types.ts` | SIMPLIFY (remove 8 types, modify PreSemanticInterpretation, add new types) |
| `interpretation/index.ts` | REWRITE orchestrator + exports |
| `interpretation/pipelineGates.ts` | NEW |
| `interpretation/modelOrdering.ts` | NEW |
| `interpretation/diagnostics.ts` | NEW |
| `geometry/shape.ts` | SIMPLIFY (remove recommendation) |
| `geometry/index.ts` | UPDATE exports |
| `geometry/alignment.ts` | CHECK imports |
| `geometry/interpretation/lens.ts` | CHECK compilation |
| `ui/` | UPDATE any references to removed types; diagnostics data available for existing DecisionMap sheet or future diagnostics panel |

---

## Execution Order

1. Start with `types.ts` — define all new types, remove old ones, update `PreSemanticInterpretation`
2. Delete `opposition.ts`, `routing.ts`, `guidance.ts`, `guidance.test.ts`
3. Create `pipelineGates.ts`
4. Create `modelOrdering.ts`
5. Create `diagnostics.ts` (replacing `validation.ts`)
6. Update `interpretation/index.ts` (new orchestrator)
7. Update `geometry/index.ts` (exports)
8. Update `shape.ts` (remove recommendation)
9. Fix compilation across `src/` (orphan imports)
10. Update `ui/` references
11. Verify with `tsc --noEmit`

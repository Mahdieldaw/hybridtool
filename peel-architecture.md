# Peel Architecture — Design Document

## Overview

The peel system is a set of three decomposition instruments that operate on the same corpus output but at different levels of abstraction. They were designed independently but share a schema. The central recognition is that they are the same operation — partition a set of objects so that structure becomes visible — applied to graph topology, scalar aggregates, and per-object measurement columns respectively. The value of the system compounds when all three are live and can be compared. Each instrument alone is a new output. All three together, with a cross-peel validation check, constitute a falsifiable epistemics layer.

---

## The Three Peels

### 1. Topology Peel (existing)

**Input:** The mapper's claim graph — edges only (conflict, prerequisite, convergence).

**Operation:** Recursive decomposition of graph shape. Layer 0 is the dominant topology. Layer 1 is the residual structure after layer 0 is accounted for.

**Output:** `StructureLayer[]` with `primary: 'convergent' | 'forked' | 'parallel' | 'constrained' | 'sparse'` plus `causalClaimIds`.

**What it cannot see:** Measurements, density, framing, stance. It sees connectivity only.

---

### 2. Cross-Signal Peel (existing, flat)

**Input:** Scalar aggregates across the corpus — four frozen mapper-vs-geometry pairs.

| Pair | Mapper signal | Geometry signal |
|---|---|---|
| Conflicts | conflicts + tradeoffs count | geometry-validated conflict edges |
| Consensus | high-support % | passage-backed claim count |
| Hub | out-degree z-score | max concentrationRatio |
| Fragmentation | connected components | region count |

**Operation:** Agreement flag per pair. No bracket test. No recursion.

**Output:** Four `(pair, agree/warn)` tuples at corpus level.

**Limitation:** Flat. Scalar. No layers, no minority bracket, no cross-scale validation.

---

### 3. Measurement Peel (proposed)

**Input:** Per-object column matrix. Rows are claims or paragraphs. Columns are measurement lenses.

**Operation:** Find where two columns structurally disagree across the distribution. Partition into minorities. Recurse on the residual. Full description in the Atomic Split section below.

**Output:** `StructureLayer[]` extended with measurement-peel-specific fields (see Schema section).

**Two scales:** Claim-scale (mapper-mediated) and paragraph-scale (near-substrate). These are not symmetric — see the Mapper Asymmetry section.

---

## The Atomic Split

The atomic split is the base operation of the measurement peel. One execution of it produces one `StructureLayer`.

### Steps

**1. Select a lens pair dynamically.**
Two columns from different lenses — e.g. density × separation. The pair is chosen based on where structured disagreement is highest in this corpus, not frozen in advance. The existing `landscapePosition` logic uses concentrationRatio × maxPassageLength as a frozen pair. The measurement peel treats this as a default fallback, not as the only valid pair.

**2. Measure disagreement across the full distribution.**
Not at the tails only. Two columns can disagree sharply at the extremes while agreeing in the middle, producing an outlier set vs. a bulk rather than two comparable groups. The minority bracket test catches this late; the disagreement metric should catch it early.

The correct metric is not rank correlation. It is closer to: do these two columns induce different partitions of the object set? Candidate metrics: Rand index, variation of information. The test is whether disagreement is structured across the whole distribution, not whether it is concentrated in tails.

**3. Partition into minorities.**
Objects that rank high on column A but low on column B form minority A. The inverse form minority B. The bracket test verifies both minorities are non-trivial in size. A split where one minority is a tail outlier set is rejected — it is an outlier detection, not a structural partition.

**4. Apply preconditions.**
`MAJ ≥ 1` gates claim-scale splits. Carried forward from the existing landscape position logic.

**5. Recurse on the residual.**
Objects that fall into neither minority form the bulk. The next split runs on the bulk. Layer 0 is the dominant split. Layer 1 is the structure remaining after layer 0 is accounted for.

**6. Apply cross-scale validation.**
Run the same split at paragraph scale. If paragraph-level columns move in the same direction as the claim-level split, the split survives. If they do not, apply the mapper-asymmetry tie-breaker (see below) before deciding to discard.

### Output of one atomic split

```typescript
{
  columnA: string,
  columnB: string,
  lensPair: LensTag,           // 'density' | 'separation' | 'similarity' | 'cross'
  minorityA_ids: string[],
  minorityB_ids: string[],
  cross_scale_status: 'confirmed' | 'discarded' | 'embedding_invisible',
  layer_index: number,
  causalClaimIds: string[]     // paragraph-scale splits must resolve to touched claims
}
```

---

## The Mapper Asymmetry

The cross-scale validation gate has a directional bias the original documents gloss. It matters for the tie-breaker.

**Paragraph-scale columns** are ~90% substrate. `basinId`, `regionId`, `separationDelta`, `gapStrength`, `isolationScore`, `intraBasinSimilarity`, `interBasinSimilarity` are all downstream of embeddings only. The mapper touches them minimally.

**Claim-scale columns** are ~50/50. `MAJ`, `concentrationRatio`, `modelSpread`, `structuralContributors`, `exclusivityRatio`, `provenanceBulk` all depend on the mapper having committed statements to claims earlier in the pipeline. The geometry participates through statement-claim similarity, but the measurement is mediated by a semantic decision the mapper made.

**The bias:** A naive "discard claim-scale split if paragraph scale doesn't confirm it" rule encodes geometry as ground truth. This is unjustified. The mapper's commits can reveal structure that geometry misses — specifically stance and framing disagreement, which compresses out in 768-dimensional embeddings. Two claims can differ meaningfully in stance while their paragraphs sit on adjacent topic regions. Geometry says: same. Mapper says: different. Discarding the claim-split here is systematically wrong.

**The tie-breaker:** When claim-scale and paragraph-scale disagree, check whether the claim-level minority aligns with model identity or with stance/role across models.

- **Model-aligned minority:** The split follows model boundaries — all of minority A came from model X, all of minority B from model Y. This is a mapper artifact. The mapper committed statements differently across models and the measurement reflects that commit, not an underlying structural difference. Discard.

- **Stance-aligned across models:** Minority A and minority B each contain claims from multiple models, but the claims within each minority share a framing or stance. This is an embedding-invisible framing distinction the geometry could not resolve. Keep the split and tag it `cross_scale_status: 'embedding_invisible'`.

Without this tie-breaker the cross-scale gate silently discards a real class of signal.

---

## Measurement Vocabulary — Ground Truth

The column set as verified in the codebase. This resolves terminology drift between the design document and the actual field names.

### Claim-scale columns (confirmed real)

| Field | Location | Notes |
|---|---|---|
| `provenanceBulk` | `EnrichedClaim.provenanceBulk` | Σ paragraph weights |
| `exclusivityRatio` | `exclusivityMap: Map<claimId, ClaimExclusivity>` | Not on the claim object itself |
| `concentrationRatio` | Claim density profile | `dominantMAJ / totalMAJ` |
| `modelSpread` | Claim density profile | Count of distinct contributing models |
| `MAJ` / `majorityParagraphCount` | Claim density profile | Gate-bearing |
| `MAXLEN` / `maxPassageLength` | Claim density profile | Gate-bearing |
| `structuralContributors` | Claim density profile | Models with MAJ ≥ 1 |
| `isLoadBearing` | Derived in Surface phase | `(Gate A ∨ Gate B) ∧ (MAJ ≥ 1)` |
| `landscapePosition` | Passage routing output | `northStar \| eastStar \| mechanism \| floor` |

### Claim-scale columns (under-developed)

| Field | Status | Notes |
|---|---|---|
| `avgStatementRelevance` | Not pre-computed | Derivable from `sim_query` and `globalSim` per statement; not stored |
| `avgQueryDistance` | Partial | `queryDistance = 1 − sim_query` exists only for isolate-routed claims |

The similarity lens at claim scale is thin. Both fields must be derived on-the-fly rather than read from stored columns. A lens that must be built in flight has different noise properties than one computed consistently since the beginning of the pipeline, and splitting on it means splitting on an uncalibrated instrument.

### Paragraph-scale columns

`basinId`, `isolationScore`, `separationDelta`, `gapStrength`, `intraBasinSimilarity`, `interBasinSimilarity`, `mutualRankDegree`, `regionId` — all confirmed to exist conceptually in `fullMeasurements` / `digest-geometry`. Exact field names on `BasinNodeProfile` / `NodeStructuralProfile` / `GapRegionalizationResult.nodeProfiles` to be verified before first split run.

### Columns that are not split inputs

`isLoadBearing` and `landscapePosition` are **outputs of gate logic**, not independent lenses. Feeding them into the split matrix as columns smuggles the answer into the question. These are label overlays applied to the split output after the fact.

`landscapePosition` is specifically a frozen instance of the measurement peel: `concentrationRatio × maxPassageLength`, fixed thresholds, one level deep. It should become the default first split with a fixed-pair fallback inside the general engine — not a column in the matrix.

---

## Schema Extension

The measurement peel reuses `StructureLayer[]`. This is the correct decision. Reusing the schema forces the new peel to emit `causalClaimIds`, which is a useful constraint — even paragraph-scale splits must resolve to the claim set they structurally touch. It also means `StructuralSummary` can render the new peel's layers with one additional case in the existing switch.

The extended `StructureLayer` adds:

```typescript
interface MeasurementLayer extends StructureLayer {
  primary: 'column_disagreement'  // new primary kind
  columnA: string
  columnB: string
  lensPair: 'density' | 'separation' | 'similarity' | 'cross'
  minorityA: string[]
  minorityB: string[]
  cross_scale_status: 'confirmed' | 'discarded' | 'embedding_invisible'
  layer_index: number
}
```

Fork this only if the `causalClaimIds` requirement turns out to be dishonest for a class of splits — i.e., if certain splits genuinely cannot resolve to a claim set without fabricating a relationship. Absent that, extend.

---

## The Cross-Peel Check

This is the genuinely new instrument. Neither existing peel produces it. It is cheap. It is the validation payoff that makes the whole system falsifiable.

**The question:** Does topology layer 0 isolate the same claims as measurement layer 0?

**Implementation:** One set intersection. `topologyLayer0.causalClaimIds ∩ measurementLayer0.causalClaimIds`.

**Interpretation:**
- **High overlap → strong load-bearing.** Two instruments using different decomposition rules, reading from different data (edge topology vs. column matrix), agree that these are the structurally dominant claims. This is the strongest possible confirmation the system can produce.
- **Low overlap → instrument-selection question.** The topology says the corpus is shaped one way; the measurement matrix says another set of claims carries the structural weight. This is not a failure — it is information. One instrument may be seeing noise, or they may be measuring genuinely different things (connectivity vs. density disagreement). The question of which to surface as the primary reading is now an empirical one, not a default.

Without this check the peel is an additional output. With it the system can disagree with itself in a structured way, which is the precondition for trust.

---

## Visualization Contract

### Lens vocabulary is shared

The viz document's four map modes and the peel's four lenses are the same vocabulary:

| Map mode | Peel lens |
|---|---|
| Density | density lens · basins |
| Fracture | separation · regions |
| Connectivity | mutual-rank lens |
| Tension | peel · disagreement |

This is not coincidence. Both documents are downstream of the same contradiction-first framework. The map view's four modes are the measurement peel's lens pairs displayed one at a time. The peel crosses them and finds the split automatically. The map view puts the reader in the position of crossing them manually — except in tension mode.

### Tension mode is the peel's natural home in the map view

Tension mode is the only map mode where the lens-crossing is done for the reader rather than by them. The viz document's section 14 lists tension mode's default composition as an open decision, with candidate contents (cross-partition edges, singleton cross-tab cells, overlap-without-edge claim pairs) that read like a description of peel output. It is waiting for the peel to tell it what to show.

**The contract:** The peel emits `{ split_columns, minorityA_ids, minorityB_ids, cross_scale_status, layer_index }`. Tension mode renders this. Layer 0 is the primary rendering. Residual layers are reachable through a layer selector.

**The design gap:** The viz document describes tension mode as flat. The peel recurses. Tension mode requires a layer selector. This is a small addition but it must be on the contract before either side is built — otherwise the peel produces layers and tension mode can render only one.

### Paragraph-scale splits have no native home in the map view

The viz document's three paragraph-rendering paths (unclaimed, multi-owned, peripheral) are all defined by paragraph-to-claim relationships. A paragraph-scale split with no claim-level expression — specifically a split tagged `embedding_invisible` where the geometry disagreed with the mapper — cannot be rendered spatially. These outputs live in the editorial arrangement only. The map view is insufficient for them.

This is the one case where taking the mapper-asymmetry tie-breaker seriously requires a rendering surface the viz document does not currently specify.

### Editorial arrangement is the primary rendering surface

Peel layers are ordered. That is prose-shaped, not spatial. The editorial arrangement renders layers as ordered prose — layer 0 first, residuals following. The map view adds a spatial second reading; it does not replace the sequential one. The user's eye lands on the layers; the map shows where they sit in embedding space.

The editorial arrangement's own design document is the remaining gap in this synthesis. It is where the peel's layer-stack-as-prose lands most directly and it is not described in either the peel document or the viz document.

---

## Two Diagnostic Variants

Once the measurement peel is running, two variants of it produce a diagnostic that the current UI cannot generate.

**Pure-geometric peel:** Run on paragraph-scale columns only. Input is substrate, almost no mapper influence. Output is the geometry's own view of corpus structure.

**Hybrid peel:** Run on claim-scale columns included. Input is geometry plus mapper commits. Output is the mapper-weighted view.

Where the two agree, the mapper is preserving substrate structure — its commits followed the geometry. Where they disagree, the mapper is either revealing something the geometry missed (stance, framing) or suppressing something the geometry saw (topic structure). This is a diagnostic the current UI cannot produce because it has only the topology peel and the flat cross-signal check. It becomes available once the measurement peel runs at both scales.

---

## Build Order

The minimum coherent unit is the atomic split plus the cross-peel check in the same release. The peel without the cross-peel check is an additional output with no validation path. The cross-peel check without the peel has nothing to compare. They are not separable deliverables.

1. **Atomic split** — implement against one query, verify minority bracket and cross-scale validation including the mapper-asymmetry tie-breaker.
2. **Extend `StructureLayer[]`** — add measurement-peel fields, decide extend vs. fork.
3. **Prose rendering in editorial arrangement** — peel layers as ordered prose, layer 0 first.
4. **Cross-peel check** — set intersection against topology layer 0, surface agreement or instrument-selection question.
5. **Tension mode in map view** — wire to receive `StructureLayer[]` from the peel, add layer selector.

Steps 1–4 are one release. Step 5 is second-lens work and can follow. The peel is useful at step 3. It is trustworthy at step 4.

---

## Open Questions

- **Gap-region-to-node lookup shape.** `gap-regionalization.ts` returns `GapRegionalizationResult` with `regions[]` and `nodeProfiles{}`. Whether there is a flat `regionByNodeId: Map<nodeId, regionId>` lookup or whether it must be constructed by iterating `regions[].allNodeIds` determines whether the basin/region cross-tab is a zip or a join. A join has implications for how cheap the cross-tab is to compute at split time.

- **Peripheral node pre-exclusion.** Whether `peripheralNodeIds` are filtered before measurement or only flagged. Filtering before measurement changes the distribution of every normalized column. This must be confirmed before calibrating thresholds.

- **Exact field names on paragraph-scale profiles.** `BasinNodeProfile`, `NodeStructuralProfile`, `GapRegionalizationResult.nodeProfiles` — the conceptual fields are confirmed; the exact names as used in the codebase need one verification pass before the first paragraph-scale split run.

- **Editorial arrangement design.** The primary prose rendering surface for peel layers has no design document currently referenced. This is the most load-bearing gap remaining.

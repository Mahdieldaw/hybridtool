# Hybrid Pipeline Architecture v2 — Post-Inversion Taxonomy

This is the end-state architecture: what the pipeline looks like when the inversion test audit is complete. It uses the same four-module structure as `substratearchitecture.md` but maps every computation to its honest level and removes what cannot survive.

---

## Inversion Test Levels

Every computation in the pipeline is classified by one of four levels. The classification is a property of what the computation consumes, not how it is used.

| Level | Definition | What survives |
|---|---|---|
| **L1** | Pure math on vectors, graphs, and set membership. Computable without reading any text. Could be re-derived from embeddings alone. | Everything here is honest geometry. |
| **L2** | Uses labeled signals (stance, signals, tier) as inputs. Legitimate when the label's derivation is explicit and the proxy nature is documented. Illegitimate when passed downstream as if it were L1. | Survives with explicit flagging. Cannot silently become an L1 input. |
| **L3** | Semantic interpretation masquerading as geometry. Requires understanding what the text *means*. Computable only by something that has read and understood the content. | Does not belong in the geometry layer. Belongs in the mapper or synthesis. Removed. |
| **Decision** | Pipeline configuration or policy. Not derived from measurements — chosen by design. Thresholds, orderings, regime labels. | Stays at origin. Labeled as configuration, not derivation. |
| **Observation** | A named pattern in measurements. Text produced by consuming L1/L2 output. Not a measurement itself. | Stays at origin. May not trigger pipeline decisions without explicit consumer logic. |

**Audit status:**
- ✅ Evidence module
- ✅ Landscape module — **cleanup complete** (tier/purity removed, query relevance reduced to two measurements, likelyClaim/estimatedMissedClaims removed, `unaddressed` fate added)
- ✅ Partition: Semantic Mapper, Survey Mapper, Claim Provenance — **claimProvenance wired to debug panel**
- ⚠️ Partition: Structural Analysis — **not yet audited**
- ⚠️ Partition: Traversal — **not yet audited**
- ⚠️ Synthesis — **skeletonization clean** (triage + carrier detection L1, stance/counterevidence removed); reconstruction + concierge handoff not yet audited

---

## Four-Module Mental Model

```
    Batch Responses + User Query
              │
    ┌─────────▼────────┐
    │                  │
    │    EVIDENCE      │   "What was said?"
    │                  │
    │  Shadow + Embed  │   Extract → embed → project paragraphs
    │                  │
    │                  │   OUT: statement inventory + paragraph
    │                  │        projections + embeddings
    └────────┬─────────┘
             │
    ┌────────▼──────────┐
    │                   │
    │   LANDSCAPE       │   "What does the terrain look like?"
    │                   │
    │  Substrate + Geom │   KNN graphs → regions → profiles →
    │  + Profiles       │   model ordering + query relevance
    │                   │
    │                   │   OUT: substrate + regions + region
    │                   │        profiles (L1 measurements only)
    └────────┬──────────┘
             │
    ┌────────▼──────────┐          ┌────────┐
    │                   │   ◄──────│  USER  │
    │   PARTITION       │   ──────►│ANSWERS │
    │                   │          └────────┘
    │  Mapper + Traverse│
    │                   │   Mapper finds claims + traversal graph;
    │                   │   user resolves forcing points.
    │                   │   Claim provenance links claims to evidence.
    │                   │
    │                   │   OUT: traversal state (claim statuses)
    └────────┬──────────┘
             │
    ┌────────▼──────────┐
    │                   │
    │   SYNTHESIS       │   "What survives your reality?"
    │                   │
    │  Prune + Concierge│   Evidence pruning → final answer from
    │                   │   surviving evidence
    │                   │
    │                   │   OUT: recommendation grounded in
    │                   │        surviving evidence
    └───────────────────┘
```

**The inversion test rule:** Geometry outputs measurements. The mapper outputs interpretations. Nothing in the geometry layer names a pattern ("this is a conflict"), forecasts semantic output ("this region likely has a claim"), or assigns rhetorical character ("this region is assertive"). Those are the mapper's jobs.

---

## Module 1: Evidence

**"Turn raw text into addressable, embedded evidence."**

The Evidence module is the purely mechanical layer. After audit, it is clean — stance and signals are honestly labeled as L2 pattern matches and carry appropriate caveats downstream.

---

### 1.1 Shadow Extraction

| Computation | Level | Notes |
|---|---|---|
| Sentence splitting, paragraph grouping | L1 | Pure text manipulation |
| Substantiveness filter | L1 | Syntactic/length rules only |
| **Stance classification** | **L2** | Regex-driven pattern matching. Six categories: prescriptive, cautionary, prerequisite, dependent, assertive, uncertain. Tells you which patterns matched, not what the sentence truly means. Downstream consumers must know this is a regex label, not semantic understanding. |
| **Confidence score** | **L2** | Derived from match count in stance classification. Scales with pattern matches (1→0.65, 2→0.80, 3→0.95). Not semantic confidence. |
| **Signal detection** (sequence/tension/conditional) | **L2** | Boolean flags from regex families. Presence means the pattern appeared; absence does not mean the signal is absent. These are hints, not facts. |
| Exclusion rules | L1 | Hard syntactic filters that remove false positive stances. Scoped per stance. |

**What to do with L2 signals downstream:** They are available for display, filtering, and as light hints to the mapper. They must not be consumed by geometry computations (graph building, region profiling) as if they were structural facts. They are explicitly not L1 inputs to anything after this module.

---

### 1.2 Paragraph Projection

| Computation | Level | Notes |
|---|---|---|
| Statement grouping by (modelIndex, paragraphIndex) | L1 | Set membership |
| `statementIds[]` per paragraph | L1 | Provenance join |
| **`dominantStance`** | **L2** | Majority-vote on L2 stance labels. Display and filtering only. Not a geometry input. |
| **`contested` flag** | **L2** | Polarity pair detection (prescriptive∩cautionary, assertive∩uncertain) on L2 labels. Display and filtering only. |
| `signals` (OR-union across statements) | L2 | Inherits from statement signals |

**Rule enforced in v2:** `dominantStance` and `contested` on paragraphs do not enter any geometry computation. They flow to the UI. Period.

---

### 1.3 Embeddings

| Computation | Level | Notes |
|---|---|---|
| Statement embeddings | L1 | Float vectors from inference |
| Paragraph embeddings (mean-pooled) | L1 | Weighted mean of statement vectors, L2-normalized |
| Query embedding | L1 | Same |
| Cosine similarity | L1 | Pure vector math |
| Quantization (1e-6) | L1 | Determinism, not interpretation |
| **Pooling weights** (confidence × signal boosts: tension×1.3, conditional×1.2, sequence×1.1) | **L2** | Uses L2 confidence and L2 signals as weights. The weighting is motivated and documented; inputs are still L2. |

---

### 1.4 Evidence Module Output Contract

```
{
  statements: ShadowStatement[];           // L2 stance/signal labels explicitly marked
  paragraphs: ShadowParagraph[];           // L2 dominantStance/contested for display only
  embeddings: {
    statements: Map<statementId, Float32Array>;  // L1
    paragraphs: Map<paragraphId, Float32Array>;  // L1 (pooled)
  };
}
```

---

## Module 2: Landscape

**"Measure the terrain."**

The Landscape module takes embedded evidence and produces geometric structure: graphs, topology, regions, and per-entity measurements. The inversion test is strictly enforced: no computation here uses L2 labels as authoritative inputs to geometric calculations.

---

### 2.1 Geometric Substrate

| Computation | Level | Notes |
|---|---|---|
| KNN graph (k=5) | L1 | Top-K similarity edges per paragraph node |
| Mutual KNN graph | L1 | Edges mutual in both directions |
| Strong graph (soft threshold) | L1 | Mutual edges above the p80 similarity threshold |
| `top1Sim`, `avgTopKSim` per node | L1 | Raw similarity stats |
| `mutualDegree`, `strongDegree`, `knnDegree` per node | L1 | Degree on each graph |
| `isolationScore` = 1 − normalizedMutualDegree | L1 | How geometrically alone this paragraph is |
| `mutualNeighborhoodPatch` per node | L1 | Set of self + mutual neighbors |
| Soft threshold (p80 of top1Sim distribution) | Decision | Threshold choice — motivated but not derived. Documented as configuration. |
| `largestComponentRatio` | L1 | |
| `isolationRatio` | L1 | |
| `globalStrongDensity` | L1 | |
| `fragmentationScore`, `bimodalityScore`, `parallelScore` | L1 | Continuous scores for shape classification |
| **Shape prior label** (`convergent_core`, `fragmented`, `bimodal_fork`, `parallel_components`) | **L2** | Categorical label derived from threshold-crossing on L1 scores. The scores are L1; the named label is a classification that assigns meaning to thresholds. Both are available to consumers; label must be treated as approximate regime identification, not a fact. |

---

### 2.2 Clustering

| Computation | Level | Notes |
|---|---|---|
| HAC clustering (average linkage) | L1 | Distance = 1 − cosine similarity |
| Cluster membership | L1 | Set membership |
| Cluster centroid | L1 | Mean embedding, normalized |
| Cluster cohesion | L1 | Average cosine similarity to centroid |
| **Uncertainty detection** (low_cohesion, dumbbell, oversized) | **L2** | Uses cohesion thresholds as L2 proxies. The patterns are real structural signals; the thresholds are chosen, not derived. |
| **`stance_diversity` and `high_contested_ratio` uncertainty reasons** | **L2** | Consume L2 inputs (dominantStance, contested). Valid as secondary uncertainty signals, labeled explicitly. |

---

### 2.3 Regionization

| Computation | Level | Notes |
|---|---|---|
| Cluster regions (from HAC) | L1 | Set membership |
| Component regions (from strong graph) | L1 | Connected component membership |
| Patch regions (from mutual neighborhood) | L1 | Neighborhood set membership |
| `statementIds[]`, `nodeIds[]`, `modelIndices[]` per region | L1 | Provenance union |
| Region ordering and renumbering | Decision | Deterministic policy: cluster→component→patch, size desc |

**Regionization is pure L1.** A region is a named set of paragraphs grouped by geometric proximity. No stance or tier logic enters here.

---

### 2.4 Region Profile

The region profile is the measurement object for a region. After v2 audit + cleanup:

| Measurement | Level | Status |
|---|---|---|
| `modelDiversity` (count of distinct model indices) | L1 | ✅ |
| `modelDiversityRatio` (modelDiversity / total observed models) | L1 | ✅ |
| `internalDensity` (internal strong-graph edges / max possible) | L1 | ✅ |
| `avgInternalSimilarity` (mean pairwise cosine inside region) | L1 | ✅ |
| `isolation` (mean `isolationScore` of member nodes) | L1 | ✅ |
| `nearestCarrierSimilarity` (cosine to nearest other region centroid) | L1 | ✅ |
| ~~`tier` label (peak/hill/floor)~~ | ~~L2~~ | ✅ **REMOVED** — categorical label encoding policy as data. `TIER_THRESHOLDS` constant retained; consumers (diagnostics.ts) apply thresholds directly on L1 measurements. |
| ~~`tierConfidence`~~ | ~~L2~~ | ✅ **REMOVED** — derived from tier. |
| ~~`purity.{dominantStance, stanceUnanimity, contestedRatio, stanceVariety}`~~ | ~~L2~~ | ✅ **REMOVED** — distributions of L2 stance labels; not structural measurements. |

**Consumers after tier removal:** `diagnostics.ts` uses `TIER_THRESHOLDS` constants directly on `p.mass.*` and `p.geometry.*` to identify peak/floor regions for `uncovered_peak`/`overclaimed_floor` observations.

---

### 2.5 Model Ordering

| Computation | Level | Notes |
|---|---|---|
| `irreplaceability` per model | L1 | Weighted sum of region contributions: weight = 1/regionModelDiversity. Low-diversity regions contribute more per model. Motivated and documented. |
| Per-model query relevance mean | L1 | Mean cosine(query, statement) across all of a model's statements |
| `adaptiveAlphaFraction` | L1 | min(0.25, stddev of per-model query relevance means). Collapses to 0 when all models equally on-topic. |
| `orderedModelIndices` | Decision | Outside-in ordering (most irreplaceable at prompt edges). **Wired** to StepExecutor sort before mapper prompt build. |

Model ordering is clean. `1/diversity` weighting is motivated and documented. No L3.

---

### 2.6 Query Relevance

After v2 audit + cleanup:

| Computation | Level | Status |
|---|---|---|
| `querySimilarity` per statement = (cosine(query, stmt) + 1) / 2 | L1 | ✅ Standalone per-statement score. Used by `buildStatementFates` for `unaddressed` promotion. |
| `recusant` (currently misnamed — measures isolation) | L1 | ✅ `1 - normalizedMutualDegree`. Rename to `isolationScore` deferred. |
| ~~`subConsensusCorroboration`~~ | ~~L2~~ | ✅ **REMOVED** — fused two independent measurements into a binary flag. `modelDiversity` on region profile and `isolationScore` on node already capture the same signals independently. |
| ~~`compositeRelevance`~~ | ~~L2 composite~~ | ✅ **REMOVED** — sole consumer (`deriveConditionalGates`) was deleted. |
| ~~Statement tiers (high/medium/low)~~ | ~~Decision~~ | ✅ **REMOVED** — no downstream decision consumer. |

**Module output:** `statementScores: Map<statementId, { querySimilarity, recusant }>`. Two independent measurements. Nothing fused.

---

### 2.7 Claim ↔ Geometry Alignment

| Computation | Level | Notes |
|---|---|---|
| Claim vectors (mean-pooled source statement embeddings) | L1 | |
| Per-region statement coverage ratio | L1 | |
| Split alerts (claim sources span geometrically distant regions) | L1 | Uses `sourceRegionIds` from `LinkedClaim` |
| Merge alerts (near-identical claim vectors) | L1 | |
| Global coverage ratio | L1 | |

`sourceRegionIds` on `LinkedClaim` is now a direct L1 field (stmt → para → region set membership), replacing the former `geometricSignals.sourceRegionIds` which was buried in an L2/L3 object.

---

### 2.8 Coverage and Fate

After v2 audit + cleanup:

**Fate taxonomy:** `primary → supporting → unaddressed → orphan → noise`
Each step is a demotion in structural integration. `unaddressed` breaks out from `orphan` because `querySimilarity` gives it a specific consumer pathway (recovery worklist).

| Computation | Level | Status |
|---|---|---|
| Statement fate (primary / supporting / **unaddressed** / orphan / noise) | L1 | ✅ Set membership + querySimilarity threshold |
| `unaddressed` promotion | L1 | ✅ Orphan AND querySimilarity > 0.55 — two independent honest measurements intersected |
| Region coverage ratio (attended / total) | L1 | ✅ |
| Statement coverage ratio (inClaims / total) | L1 | ✅ |
| Unattended region detection | L1 | ✅ |
| Completeness verdict | Observation | ✅ Threshold interpretation, advisory only |
| `signalWeight` (conditional×3 + sequence×2 + tension×1) | L2 | ✅ Still in shadowMetadata for display. 3/2/1 coefficients unaudited — see ShadowDelta deferred list. |
| ~~`likelyClaim` on unattended regions~~ | ~~L3~~ | ✅ **REMOVED** — geometry predicting semantic output. Replaced by `unaddressed` fate on statements. |
| ~~`estimatedMissedClaims`~~ | ~~L3~~ | ✅ **REMOVED** — unmotivated `/3` divisor and L2/L3 inputs. |
| ~~`highSignalOrphans`~~ | ~~L2~~ | ✅ **REMOVED** from recovery — replaced by `unaddressedStatements` (querySimilarity-ordered). |

**`unaddressedStatements` in `CompletenessReport.recovery`:** Sorted by `querySimilarity` descending, top-10. Fields: statementId, text, modelIndex, querySimilarity. Facts only — consumer decides if each is a missed claim, background context, implicit coverage, or noise.

---

### 2.9 Pipeline Configuration

`AdaptiveLens` and `PipelineGateResult` are **pipeline configuration and policy outputs**, not measurements.

| Output | What it is | Label |
|---|---|---|
| `AdaptiveLens` (regime, thresholds, shouldRunClustering, k) | Translates L1 shape scores + topology into configuration choices for downstream steps. Which thresholds, whether to run clustering, what k. | Decision — configuration function, not derivation |
| `PipelineGateResult` (proceed / skip_geometry / trivial_convergence / insufficient_structure) | Threshold-based gate verdict from topology measurements. | Decision |

`deriveLens` should be documented and named as a configuration function. Shape scores that feed it are L1; the configuration choices that come out are policy.

---

### 2.10 Landscape Module Output Contract

```
{
  substrate: GeometricSubstrate;              // L1 graphs, topology, shape scores, node stats
  clusters: ClusteringResult;                 // L1 membership + L2 uncertainty flags (labeled)
  regionization: RegionizationResult;         // L1 regions
  regionProfiles: RegionProfile[];            // L1 measurements only: modelDiversity,
                                              //   modelDiversityRatio, internalDensity,
                                              //   isolation, nearestCarrierSimilarity,
                                              //   avgInternalSimilarity
  modelOrdering: ModelOrderingResult;         // L1 irreplaceability scores + Decision ordering
  queryRelevance: QueryRelevanceResult;       // L1: { querySimilarity, recusant } per statement
  coverage: {                                 // L1 fates + ratios
    statementFates: Map<...>;                 // fate: primary/supporting/unaddressed/orphan/noise
    unattendedRegions: UnattendedRegion[];
    report: CompletenessReport;               // Observation (advisory)
  };
  alignment: AlignmentResult;                 // L1 coverage + split/merge alerts
  lens: AdaptiveLens;                         // Decision (configuration)
  gate: PipelineGateResult;                   // Decision
}
```

---

## Module 3: Partition

**"Find what needs resolution, ask the user."**

The mapper is the single authority for claim identification and question generation. Geometry provides context (ordered evidence, query-relevant signals, geometric hints). It does not generate gates or forcing points.

---

### 3.1 Semantic Mapper

✅ Audited. The mapper receives:
- Evidence sorted by `orderedModelIndices` (outside-in)
- Geometric hints from the Landscape module

It produces `MapperClaim[]` (id, label, text, supporters, challenges) and edges. No L3 inputs from geometry enter the prompt as constraints. Hints are advisory.

---

### 3.2 Survey Mapper

✅ Audited. Receives conflict and tradeoff edges from the semantic mapper. Produces gates (forced_choice / conditional_gate) from conflict semantics. All semantic interpretation — this is the mapper's domain.

---

### 3.3 Claim Provenance — `reconstructProvenance` → `LinkedClaim`

`reconstructProvenance` is a pure L1 linking function after the rewrite:

| Computation | Level | Notes |
|---|---|---|
| Claim text → source statement cosine matching | L1 | Threshold 0.45, top-12, **all statements** (no supporter filter) |
| Paragraph-level fallback | L1 | Threshold 0.5, top-5 paragraphs, when statement-level yields nothing |
| `sourceRegionIds` (stmt→para→region set membership) | L1 | |
| `supportRatio` (supporters.length / totalModelCount) | L1 | |
| `hasConditionalSignal`, `hasSequenceSignal`, `hasTensionSignal` | L2 | Inherits from statement signals. Used by traversal serialization. |

**`LinkedClaim` output type:** id, label, text, supporters, challenges, support_count, type (placeholder: 'assertive'), role (placeholder: 'supplement'), sourceStatementIds, sourceStatements, sourceRegionIds, supportRatio, signal flags. SA engine overwrites type and role with real values.

**[REMOVED]:** Supporter filter (mapper's opinion was silently constraining L1 evidence linking). Derived type from stance voting (L3). `geometricSignals` object (backedByPeak/Hill/Floor, avgGeometricConfidence — all L2/L3 tier-derived). `isContested` (SA engine's job). All zeroed structural fields (`leverage: 0`, `keystoneScore: 0`, etc. — contract bloat overwritten immediately by SA engine).

---

### 3.4 Claim Provenance — `claimProvenance.ts`

| Computation | Level | Status |
|---|---|---|
| Statement ownership (statement → Set\<claimId\>) | L1 | ✅ **Wired to debug panel** (`mapperArtifact.claimProvenance.statementOwnership`) |
| `exclusivityRatio` per claim (exclusive evidence / total evidence) | L1 | ✅ **Wired to debug panel** (`mapperArtifact.claimProvenance.claimExclusivity`) |
| Pairwise Jaccard on source statement sets | L1 | ✅ **Wired to debug panel** (`mapperArtifact.claimProvenance.claimOverlap`) |

**First occupants of the Claim entity profile** (`src/profiles/claim.ts` — infrastructure pending). These are the foundational measurements for claim triage: which claims share evidence, which are built from exclusive evidence, which overlap by provenance (independent of semantic content).

---

### 3.5 Post-Mapper Diagnostics

| Computation | Level | Status |
|---|---|---|
| Source coherence per claim (mean pairwise cosine of source statement embeddings) | L1 | ✅ |
| Embedding spread per claim (stddev of pairwise cosines) | L1 | ✅ |
| Region span per claim (distinct regions source statements cross) | L1 | ✅ |
| Source model diversity per claim (exact, via stmt→para→modelIndex) | L1 | ✅ |
| Dominant region per claim | L1 | ✅ |
| Edge geographic separation (cross-region boolean) | L1 | ✅ |
| Edge centroid similarity | L1 | ✅ |
| Observations (uncovered_peak, overclaimed_floor, etc.) | Observation | ✅ Advisory. Tier-based triggers need rewrite against continuous measurements after tier removal. |

---

### 3.6 Structural Analysis

⚠️ **NOT YET AUDITED**

The SA engine computes leverage, roles, patterns, and shape from the semantic claim graph (`artifact.semantic.claims` + edges). It operates entirely independently of `reconstructProvenance` — it reads raw claim fields and recomputes all structural flags via `metrics.ts`.

Known properties of SA engine:
- Reads `claim.type`, `claim.supporters`, `claim.challenges`, and edges
- `challenges` field is actively consumed for directed role assignment (challenger pattern)
- Computes `leverage`, `keystoneScore`, `isContested`, `isConditional`, and all `is*` flags from scratch
- These fields are not pre-populated by `reconstructProvenance` (removed in v2)

Until the SA engine is audited, no determination has been made about which computations are L1/L2/L3. Flag for next audit pass.

---

### 3.7 Traversal

⚠️ **NOT YET AUDITED**

The traversal engine processes forcing points, manages user decisions, and computes claim statuses (active/pruned). The engine's state management, normalization logic, and forcing point extraction have not been audited against the inversion test.

The traversal layer is explicitly semantic — user questions, claim pruning, path logging. The inversion test has limited applicability here. Audit pass should focus on: are there any geometry-derived computations inside traversal that should be in the geometry layer?

---

## Module 4: Synthesis

**Partially audited. Skeletonization is now clean.**

Skeletonization uses `claim.sourceStatementIds` as its pruning index — a pure L1 join. The triage pipeline has been simplified to a three-stage L1 pipeline:

1. **Protection** — any statement sourced by a surviving claim is PROTECTED (set membership, pure L1).
2. **Relevance gate** — cosine similarity to the pruned claim's centroid. Below threshold → PROTECTED (not about this claim). Single measurement, single decision.
3. **Carrier detection + graduated response** — carrier count drives the outcome: 0 carriers → SKELETONIZE (sole carrier); 1 carrier → SKELETONIZE (some redundancy); ≥2 carriers → REMOVE (demonstrably redundant). No stance labels, no counterevidence logic, no dual centroids.

**Removed from skeletonization:** `isOpposingStance`, `dominantClaimStance`, `opposingStancePenalty`, all counterevidence PROTECTED branches, the conditional gate override block in `index.ts`, and the `removeRelevanceMin` secondary gate (carrier count alone is the redundancy signal). Paraphrase sweep uses flat cosine threshold, no stance exceptions.

Carrier detection (`CarrierDetector.ts`) is now flat cosine: claim similarity + source similarity, both at fixed thresholds. No L2 inputs.

**Remaining audit scope for Synthesis:** substrate reconstruction (`SubstrateReconstructor.ts`) and concierge handoff have not been audited. These are downstream of triage and operate on the already-decided statement fates.

---

## Entity Profiles (Planned Architecture)

The audit revealed that measurements about entities (claims, statements, models, regions, edges) are scattered across pipeline stages. The planned end state consolidates them:

```
src/profiles/
  claim.ts      — claim-level measurements
  statement.ts  — per-statement measurements
  model.ts      — per-model measurements
  region.ts     — per-region measurements (no tier)
  edge.ts       — per-edge measurements
  substrate.ts  — run-level globals
```

**Why one directory:** Entity profile is read by multiple consumers at different pipeline stages. Distributing measurements to their "most active" consumer recreates the scatter problem. A convergence point (`profiles/`) with a clear import arrow (computation → profile → consumer) is the right structure.

**What belongs in profiles:**

| Measurement | Entity | Level |
|---|---|---|
| `sourceStatementIds`, `sourceStatements`, `sourceRegionIds` | Claim | L1 — provenance linking |
| `exclusivityRatio` | Claim | L1 — from claimProvenance.ts |
| Pairwise Jaccard with other claims | Claim | L1 — from claimProvenance.ts |
| Source coherence, embedding spread, region span, source model diversity | Claim | L1 — from diagnostics.ts |
| Mean querySimilarity of source statements | Claim | L1 — join on querySimilarity |
| `querySimilarity` | Statement | L1 — from queryRelevance.ts |
| `isolationScore` (rename from `novelty`) | Statement | L1 — from substrate |
| Fate (primary/supporting/orphan/noise) | Statement | L1 — from fateTracking.ts |
| Which claim(s) cite it | Statement | L1 — from claimProvenance.ts |
| Which region it sits in | Statement | L1 — from regionization |
| `irreplaceability` | Model | L1 — from modelOrdering.ts |
| Per-model query relevance mean and variance | Model | L1 — from modelOrdering.ts |
| `modelDiversity`, `modelDiversityRatio` | Region | L1 — from profiles.ts |
| `internalDensity`, `avgInternalSimilarity` | Region | L1 — from profiles.ts |
| `isolation`, `nearestCarrierSimilarity` | Region | L1 — from profiles.ts |
| Geographic separation, centroid similarity, source Jaccard | Edge | L1 — from diagnostics.ts |
| Topology globals (largestComponentRatio, isolationRatio, etc.) | Substrate | L1 — from substrate |
| Coverage ratios | Substrate | L1 — from completeness |
| Shape scores (fragmentationScore, bimodalityScore, parallelScore) | Substrate | L1 — from shape.ts |

**What does NOT belong in profiles:** Process outputs (`orderedModelIndices`, lens config, gate verdicts), observations (text-form pattern names), or L3 interpretations.

---

## Computation Status Summary

| Area | Already Removed | Pending Removal | Clean |
|---|---|---|---|
| `reconstructProvenance` | Supporter filter, derivedType, geometricSignals, isContested, zeroed structural fields | — | sourceStatementIds, sourceRegionIds, supportRatio, signal flags |
| `claimAssembly.ts` | `assembleClaims()`, `formatClaimEvidence()`, `SemanticMapperOutput` import | — | reconstructConditionProvenance, getGateProvenance, getConflictProvenance, validateProvenance |
| Region profiles | — | `tier`, stanceUnanimity, contestedRatio, stanceVariety, dominantStance, likelyClaims | modelDiversity, internalDensity, isolation, nearestCarrierSimilarity |
| Query relevance | `compositeRelevance`, `adaptiveWeights`, `adaptiveWeightsActive`, `toJsonSafeQueryRelevance` | `subConsensusCorroboration` | `querySimilarity`, `isolationScore` |
| Coverage/completeness | — | `signalWeight`, `likelyClaim` on regions, `estimatedMissedClaims` | fates, coverage ratios, unattended detection |
| `regionGates.ts` | Entire file deleted | — | — |
| Model ordering | — | — | irreplaceability, queryRelevance, adaptiveAlpha, orderedModelIndices |
| Diagnostics | — | Tier-based observation triggers (rewrite against continuous measurements) | All L1 measurements (coherence, spread, span, diversity, edge separation) |
| SA engine | — | Not yet audited | — |
| Traversal | — | Not yet audited | — |
| Synthesis | — | Not yet audited | — |

---

## Key Architectural Decisions (Post-Audit)

**The geometry layer cannot speak semantics.**
Geometry outputs vectors, counts, ratios, and distances. It does not output labels like "peak" (interpretation of diversity + density), "assertive" (interpretation of text content), or "likely to contain a claim" (forecasting semantic output). These are interpretations consumers make using geometry's measurements.

**L2 measurements must be explicitly labeled.**
Stance, signals, tier, and stance-derived metrics are legitimate as L2 when their derivation is visible and the proxy nature is documented. Unlabeled L2 passed as L1 to geometry computations is the primary failure mode the audit corrects. The pattern: geometry may receive L2 labels as display metadata; it may not consume them as structural inputs.

**The supporter filter was an L3 gate on an L1 computation.**
`reconstructProvenance` previously restricted statement matching to models that "supported" the claim (mapper's assessment). This let the mapper's semantic opinion constrain what evidence could be linked — passing L3 through the L1 linking step. Now all statements are eligible; coherence measurements expose bad matches downstream.

**Entity profiles have one canonical location.**
"What do we know about claim X" is one question with one answer. Profiles converge measurements from where they're computed; consumers pull from profiles. Scattered provenance signals computed at different pipeline stages was the structural problem; `profiles/` is the structural answer.

**The mapper is the question author.**
No computation in the geometry layer generates forcing points, gates, or pruning decisions. Observations (`uncovered_peak`, `splitAlert`) are advisory signals available to consumers. They do not trigger pipeline behavior on their own.

**Tier is an interpretation of measurements, not a measurement.**
`modelDiversity` and `internalDensity` are L1 facts about a region. "Peak/hill/floor" is a label that assigns meaning to threshold-crossings. The measurements survive; the label is removed. Consumers that need tier-equivalent logic apply thresholds appropriate to their decision context, with the threshold choice documented.

**V8 inversion holds.**
Claims are the pruning index. Text remains the output. The synthesizer reads evidence, not abstractions.

**Claims are the permanent pruning index. The transition to regions-as-pruning-index is closed.**
Regions guarantee every statement falls into some blast zone — completeness is their virtue. But completeness is a vice for destruction. The failure modes are asymmetric: a claim-indexed blast zone that misses targets leaves content as UNTRIAGED (recoverable — it lingers but doesn't dominate); a region-indexed blast zone that takes false hits destroys evidence for the surviving position (unrecoverable). For any destructive operation, the index must fail conservative. Claims fail conservative; regions fail aggressive. The planned transition was wrong in its direction. Regions remain the observation layer: coverage audits, model ordering, diagnostic signals. The mapper's precision in linking statements to claims is the correct bottleneck to invest in.

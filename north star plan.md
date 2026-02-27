# Singularity Geometry Pipeline — North Star

**Purpose**: This document defines the final vision for every geometric measurement in the pipeline: what it measures, what level of honesty it operates at, who consumes it, and what the gap is between the current implementation and the target state. It does not make architectural decisions — it presents the decision surface for each measurement so implementation choices are grounded.

**Governing principles are defined first. Every measurement must satisfy all four.**
---

## Part I: Governing Principles

### The Inversion Test

Every calculation in the geometry layer must pass: "Could you compute this number from the embeddings alone, without knowing what any text says?"

- **L1**: Pure math on vectors, graphs, set membership. Computable without reading text.
- **L2**: Uses labeled signals (stance, confidence, signals, claim assignments) as inputs. Permitted only with explicit flagging. Cannot silently feed an L1 computation.
- **L3**: Semantic interpretation masquerading as geometry. Belongs in mapper or synthesis. Not permitted in the geometry layer.

### The Placement Principle

A calculation should exist where it serves a decision. Every measurement names its consumer. If no downstream step consumes it for routing, weighting, filtering, or user-facing decision support, it belongs in diagnostics — not the active pipeline.

### The Degradation Principle

Every derived threshold, boundary, or classification must define its behavior when the input data lacks the structure it expects. The honest output of "I cannot distinguish this" is always preferable to a fabricated boundary. Degradation is flagged, never silent.

### The Irreplaceability Principle

The pipeline's protective bias is toward preservation. Every measurement is calibrated to answer "can this be safely subtracted?" rather than "is this important?" Importance is a semantic judgment belonging to the mapper and the user. Irreplaceability is a geometric fact belonging to the substrate.

This orientation is visible at every layer. Model ordering measures which model carries terrain no other model covers. Exclusivity measures which claim owns evidence no other claim protects. Blast radius measures the cost of removal — cascade breadth, exclusive evidence loss, structural disconnection — and suppresses questions where that cost is low enough that the user's attention isn't warranted. Carrier detection checks whether a pruned statement's content survives in a carrier before allowing removal. Skeletonization preserves structural bones even when arguments are removed.

The default is survival. Removal requires the user's explicit decision, scoped by geometric evidence of what can't be recovered from elsewhere. The system does not decide what is valuable. It ensures the user is never allowed to destroy something irreplaceable without being shown what they're destroying, and that even chosen destruction is as minimal as the evidence permits.

**Consequence for calibration**: When a measurement fails to discriminate (0% exclusivity, 82% carrier pass rate), the failure mode is under-protection of irreplaceable content — the system treats everything as redundant and cannot distinguish what would genuinely be lost. Calibration work (elbow detection, per-distribution thresholds) restores the system's ability to protect selectively rather than uniformly.

---

## Part II: Stored Primitives

The pipeline stores three categories of data. Everything else is derived at view-time from these primitives. If you change a derivation function, reload, and navigate to any historical turn, the new function's output appears without recompute.

### Primitive 1: Batch Text Responses

|Property|Value|
|---|---|
|What|Raw text response from each AI model|
|Keyed by|`(turn_id, model_id)`|
|Stored where|`provider_responses` in IndexedDB|
|Invalidated|Never — frozen on creation|
|Downstream|Shadow extraction (deterministic parse → statements, paragraphs, model index)|

### Primitive 2: Embeddings

|Property|Value|
|---|---|
|What|Float32Array per statement, Float32Array per paragraph, embedding model metadata|
|Keyed by|`(turn_id, embedding_model_id)`|
|Stored where|IndexedDB `embeddings` store (new)|
|Invalidated|Embedding model change|
|Size|~1.3 MB per turn at 768 dims, ~7 MB at 4096 dims|
|Downstream|Every geometric computation in the pipeline|

**Status**: Implemented. Persisted during pipeline execution in IndexedDB.
View-time derivation of all geometry from cached embeddings. 
Historical turns populate all diagnostic panels without recompute.

### Primitive 3: Mapper Output

|Property|Value|
|---|---|
|What|Raw mapper text → parsed claims, edges|
|Keyed by|`(turn_id, mapper_model_id)`|
|Stored where|`provider_responses` in IndexedDB (already stored as mapper provider response)|
|Invalidated|Mapper model change or explicit mapper recompute|
|Downstream|Claim centroids (L2 bridge), provenance, structural analysis, traversal, synthesis|

**The contract**: These three primitives are sufficient to derive the complete geometry and provenance layers. Nothing else needs persistence. The recompute surface is:

|Recompute target|What it does|When needed|
|---|---|---|
|Geometry|Rederive all geometric measurements from cached embeddings|Never — view-time derivation replaces this|
|Mapping|Re-run mapper LLM, persist new claims, persist embeddings if missing|Mapper model change, or explicit request|
|Singularity|Re-run synthesis on frozen map + frozen geometry + frozen batches|Synthesis model change, or explicit request|

---

## Part III: Layer-by-Layer Specification

---

### Layer 0: Shadow Extraction

**What it does**: Deterministic parse of batch text into atomic evidence units.

**Outputs**: `ShadowStatement[]`, `ShadowParagraph[]`

|Measurement|Level|What it honestly measures|Consumer|Status|
|---|---|---|---|---|
|`statement.text`|L1|One sentence or clause, extracted by regex/heuristic|Every downstream layer|Active|
|`statement.modelIndex`|L1|Which model produced this text|Model ordering, coverage, provenance diversity|Active|
|`statement.stance`|L2|Pattern-match classification (assertive/prescriptive/cautionary/prerequisite/dependent/uncertain). The computation is L1 (regex). The label is L2 inference ("contains 'before' → prerequisite").|`signalWeight` in fate tracking (advisory ranking). `claimAssembly` boolean flags (display only).|Active — soft annotation|
|`statement.confidence`|L2|Pattern match count (1/2/3+ patterns), not semantic confidence. Honest name: `patternStrength`.|Display only|Active — rename deferred|
|`statement.signals` (sequence, tension, conditional)|L2|Binary flags from regex detection|`signalWeight` in fate tracking (advisory ranking). `claimAssembly` derived type hints (display only).|Active — soft annotation|
|`paragraph.dominantStance`|L2|Most common stance among constituent statements|`NodeLocalStats` labeling|Active — display only|
|`paragraph.contested`|L2|Multiple stances present in paragraph|`NodeLocalStats` flag|Active — display only|

**Gap**: None architecturally. `ExclusionRules.ts` (88 patterns, 329 lines) performs L3 semantic gatekeeping at extraction — false exclusion silently drops statements. Deferred as a tuning problem: the architecture is right (exclusion rules belong here), the patterns need domain review.

**Principle applied**: Stances and signals have a known false-positive budget. They are never expanded as hard gates. They annotate evidence; they do not filter it.

---

### Layer 1: The Full Pairwise Field

**What it does**: Computes the complete geometric substrate from paragraph embeddings. This is the foundation from which every graph and threshold derives.

**Inputs**: Paragraph embeddings (L2-normalized Float32Array per paragraph)

**Outputs**: N×N similarity matrix, per-distribution statistics, per-node statistics

#### Substrate Measurements

|Measurement|Level|What it honestly measures|Consumer|Current status|Target status|
|---|---|---|---|---|---|
|Full pairwise similarity matrix (N×N paragraphs)|L1|Cosine similarity between every pair of paragraph embeddings|Mutual recognition graph construction, carrier detection, provenance anchoring, per-consumer threshold calibration, all downstream density/isolation measures|Diagnostic (computed to find top-5, then discarded except in diagnostic surface)|**Active** — the substrate from which everything derives|
|Distribution stats: count, min, P10, P25, P50, P75, P80, P90, P95, max, mean, stddev|L1|Shape of the full similarity distribution|Consumer threshold calibration (carrier: P75; provenance: per-claim distribution)|Diagnostic|**Active** — each consumer reads the percentile appropriate to its decision|
|Discrimination range: P90 − P10|L1|How much useful spread the embedding model provides for this query|Degradation detection: if range < 0.02, flag "insufficient embedding discrimination" — no downstream threshold can be meaningful|Diagnostic|**Active** — gate for honest degradation flagging|
|Per-node: sorted similarity list to all other nodes|L1|Each paragraph's relationship to the entire field, not just its top-K neighbors|Mutual recognition graph (rank position determines edge existence), provenance (claim centroid similarity to each paragraph)|Not stored|**Active** — stored as part of full pairwise|
|Per-node: `top1Sim`|L1|Cosine similarity to nearest paragraph neighbor. Nearest-neighbor distance proxy.|Isolation detection, substrate quality check|Active|Active (no change)|
|Per-node: `avgTopKSim` (K=5)|L1|Mean cosine to 5 nearest neighbors. Local density estimate.|Diagnostic — provides local context but no active consumer uses it for a decision|Active|**Diagnostic** — retained as a density descriptor, not a pipeline input|

**What gets removed from this layer**:

|Removed|Why|
|---|---|
|Strong graph|Soft threshold derivation (P80 of top-1 similarities) was overridden by clamp [0.55, 0.78] on every test query. Policy disguised as derivation.|
|`softThreshold`|Dead — consumer (strong graph) is removed|
|`strongDegree` per node|Dead — consumer (strong graph) is removed|
|Clamp [0.55, 0.78]|Dead — was the policy override|

---

### Layer 2: Derived Graphs

**What this layer does**: Constructs graph views on the full pairwise field. Each graph answers a different structural question. No graph pre-filters or discards information from the substrate — they are views, not reductions.

#### kNN Graph (k=5)

|Property|Value|
|---|---|
|Construction|Symmetric union of top-5 edges per node|
|Level|L1|
|What it measures|Each node's strongest local connections|
|Parameter|k=5 (fixed)|

|Consumer|How it uses this graph|Status|
|---|---|---|
|Backward compatibility diagnostics|Shows local neighborhood structure|Diagnostic|
|Mutual recognition construction|Implicitly superseded — mutual recognition uses full ranked lists, not kNN truncation|Diagnostic after mutual recognition|

**Current state**: Diagnostic — retained for visualization and comparison. 
Not a structural foundation. Superseded by mutual recognition graph.

#### Mutual Recognition Graph

| Property | Value |
|---|---|
| Construction | Edge (i,j) iff sim(i,j) > μ_i + σ_i AND sim(i,j) > μ_j + σ_j. Each node's threshold is derived from its own similarity distribution across all other nodes. |
| Level | L1 |
| What it measures | Mutual recognition — both nodes consider each other notably similar in their own local context |
| Parameters | None. μ and σ are properties of each node's own similarity distribution across all other nodes. |
| Degradation | In uniform fields (σ ≈ 0 for all nodes), threshold ≈ μ, no edges form. Honest: "no mutual recognition structure exists." |

Note: μ_i and σ_i are computed excluding self-similarity (sim(i,i)=1.0 is omitted). Formally:

μ_i = mean({ sim(i,j) | j ≠ i })
σ_i = stddev({ sim(i,j) | j ≠ i })

This prevents the unit self-similarity from inflating per-node thresholds.

|Consumer|How it uses this graph|Status|
|---|---|---|
|Regionization|Connected components = regions|Active|
|`mutualRankDegree` per node|Number of mutual recognition edges. Community membership signal.|Active|
|`isolationScore` per node|0 if node has mutual-rank edges, 1 if none|Active|
|`mutualRankNeighborhood` per node|[self + mutual recognition neighbors], sorted — the node's local "patch"|Active|
|Pipeline gates|"Is there enough mutual recognition to produce meaningful regions?" Replaces shape-based gating.|Active|
|`profiles.internalDensity`|Fraction of possible mutual-rank edges within region that exist|Active|
|Coverage audit|Bridge detection between regions|Active|

**Current state**: Active. Replaces mutual KNN (fixed top-5) for structural routing.

**Why mutual recognition and not alternatives**:

```
- Mutual recognition: no parameters, degrades to "no structure" honestly, 
  defines edges relative to each node's own distribution
```

#### Regionization

|Property|Value|
|---|---|
|Construction|Connected components on the mutual recognition graph|
|Level|L1|
|Degradation|If one component contains >70% of nodes: report "convergent field." Do not fabricate sub-structure. Per-node measurements remain available for consumers needing finer resolution within a convergent region.|

|Consumer|How it uses regions|Status|
|---|---|---|
|Model ordering (irreplaceability)|Weight = 1/regionModelDiversity. If convergent field, degrades to volume measure.|Active|
|Provenance (region span)|How many regions a claim's evidence spans|Diagnostic|
|Coverage audit|Unattended region detection|Active|
|Fate tracking|Region assignment per statement (via paragraph → region lookup)|Active|
|Diagnostics|Region profiles, alignment checks|Diagnostic|

**Current state**: Connected components on mutual recognition graph. 
No clamp, no threshold parameter.

#### Per-Region Profile Measurements

Computed from the substrate + region membership. All L1.

|Measurement|What it honestly measures|Consumer|Target status|
|---|---|---|---|
|`modelDiversity`|Count of distinct model indices in region|Model ordering (irreplaceability weight)|Active|
|`modelDiversityRatio`|modelDiversity / total models. Normalized for cross-run comparison.|Diagnostic|Diagnostic|
|`internalDensity`|Fraction of possible mutual-rank edges that exist within region|Diagnostic — describes region tightness but no active consumer gates on it|Diagnostic|
|`avgInternalSimilarity`|Mean pairwise cosine of nodes within region (from full pairwise matrix, not from any graph)|Diagnostic|Diagnostic|
|`isolation` (region-level)|Mean node isolation score within region|Diagnostic|Diagnostic|
|`nearestCarrierSimilarity`|Cosine between this region's centroid and nearest other region's centroid|Diagnostic — "how close are regions to each other." No active consumer.|Diagnostic|

---

### Layer 3: Query Relevance Field

**What this layer does**: Lays a scalar field over the evidence landscape measuring geometric proximity to the user's question in embedding space. This field is query-dependent but substrate-independent — it does not modify, reweight, or condition the geometric substrate.

**Inputs**: Query embedding, statement embeddings, paragraph embeddings

#### Query Relevance Measurements

|Measurement|Level|What it honestly measures|Consumer|Current status|Target status|
|---|---|---|---|---|---|
|Raw cosine (query, statement)|L1|Geometric proximity of statement to query in embedding space|Fate tracking (orphan ranking), model ordering (per-model mean), recovery worklist (sort order), blast radius (claim-level mean)|**Active — canonical signal**|Active|
|Raw cosine (query, paragraph)|L1|Geometric proximity of paragraph to query in embedding space|Diagnostic comparison with statement-level. Empirical question post-model-change: which granularity discriminates better?|Computed as `paragraphSimRaw`|Diagnostic until empirical resolution|
|`(cos+1)/2` normalized|L1 (math is honest, but compresses observed range into top 20% of [0,1])|Same as raw cosine, rescaled|Legacy consumers — diagnostics only|**Diagnostic**|Diagnostic|
|Per-distribution stats: mean, stddev, P10, P90 of raw query similarities|L1|Shape of the query relevance field|Consumer threshold calibration (elbow detection for unaddressed promotion)|Partial (summary cards in diagnostics)|**Active** — feeds per-distribution threshold derivation|
|`recusant` (`1 - normalizedMutualDegree`)|L1|Geometric isolation of statement's parent paragraph (misnamed — measures isolation, not recusance)|Debug panel only|Diagnostic|**Diagnostic** — duplicate of `isolationScore` at different granularity. Rename to `paragraphIsolation` when touched.|

**What query relevance is NOT**:

- Does not delete or exclude evidence from any pipeline step
- Does not multiply with or condition structural centrality
- Does not feed the geometric substrate
- A structurally critical outlier (the thing the user didn't know to ask about) will have LOW query similarity by definition. Query relevance is a lens, not a filter.

**Consumers and their threshold mechanisms**:

| Consumer | Current threshold | Target threshold | Mechanism |
|---|---|---|---|
| Fate tracking: orphan → unaddressed | Static 0.55 on `(cos+1)/2` | **No binary gate** | Orphans ranked by raw cosine descending. Optional secondary sort: query affinity relative to mean claim affinity (query cosine − mean cosine across all claim centroids). Continuous list, user decides cutoff. |
| Model ordering: per-model mean | Raw mean, feeds adaptive alpha | No change needed | Alpha already scales with stddev. Collapses to 0 when all models equally on-topic. |
| Blast radius: per-claim query relevance | Mean raw cosine across claim's source statements | No change needed | Continuous input to composite score. |
| Recovery worklist | Sorted by raw cosine descending | No change needed | Signal change only. |

---

### Layer 4: Claim Centroids — The L2 Bridge

**What this layer does**: Computes the one place where mapper output enters 
geometric computation. A claim centroid is the embedding of the claim's own text 
as output by the mapper. This avoids circularity — provenance reconstruction 
determines which statements belong to a claim, so the centroid cannot be computed 
from those statements. The claim text embedding represents where the claim sits 
in embedding space based on what it says, not based on what evidence has been 
assigned to it. It is computed by `generateClaimEmbeddings` prior to provenance 
reconstruction.

**Level**: L2 — explicitly flagged. Cannot be computed without knowing what the mapper said. Every downstream computation on centroids is L1 math on top of this L2 seed.

|Measurement|Level|What it honestly measures|Consumer|Current status|Target status|
|---|---|---|---|---|---|
|Claim centroid vector|L2|Position in embedding space of the claim's own text, as described by the mapper. Not the mean of source statement embeddings — that would be circular since provenance is what determines source statements.|Provenance (centroid → paragraph similarities for competitive assignment), inter-claim distance, alignment|**Active** — computed once by `generateClaimEmbeddings`, consumed by provenance as the primary consumer|Active|
|Inter-claim centroid distance matrix|L1 (on top of L2 centroids)|How far apart claims are in embedding space, independent of mapper's edge labels|Diagnostic — potential consumer: survey mapper (group nearby claims for joint forcing points)|Not computed|**Diagnostic** — add when survey mapper can consume it|

**Current state**: Computed once by `generateClaimEmbeddings`. Provenance consumes it as the primary consumer.  
**Target state**: No change needed.

---
### Layer 5: Provenance Reconstruction

**What this layer does**: Links mapper claims back to source evidence using geometric proximity, without relying on the mapper to enumerate supporters accurately. This is the lynchpin: provenance quality determines whether exclusivity is meaningful, whether blast radius measures real damage, and whether pruning removes actual evidence.

**Inputs**: Claim centroids (L2), paragraph embeddings (L1), statement embeddings (L1)

**Mechanism: Competitive Assignment**

Provenance is not determined by global constants or elbow detection. It is determined by competitive assignment — each paragraph independently decides which claims it belongs to, based on its own similarity distribution across all claim centroids.



```
For each paragraph P (N total):
  For each claim c (C total):
    sim[P][c] = cosine(paragraphEmbedding[P], claimCentroid[c])
  
  μ_P = mean(sim[P][c] for all c)
  σ_P = stddev(sim[P][c] for all c)
  
  For each claim c:
    if sim[P][c] > μ_P + σ_P → assign P to claim c's pool

For each claim c:
  pool[c] = all paragraphs assigned to c
  sourceStatementIds[c] = union of statementIds from all paragraphs in pool[c]
```

No magic numbers. μ and σ are properties of each paragraph's own affinity 
distribution across all claim centroids. The mean is the paragraph's center of 
gravity. The standard deviation measures how much the paragraph prefers some claims 
over others. A claim owns a paragraph only if it is notably closer than average — 
not just above the middle, but standing out from the pack. With 15 claims (illustrative; the mechanism is parameter-free and scales to any claim count), μ + σ 
selects roughly 2-3 claims per paragraph, producing pools of 6-29 paragraphs per 
claim on homogeneous queries and tighter pools on heterogeneous queries.
**Why pool sizes are naturally unequal**: A broadly-discussed claim has its centroid 
in a densely populated region of embedding space. Many paragraphs have this claim 
notably above their μ + σ threshold. Large pool. A narrowly-discussed claim has its 
centroid in a sparse region. Few paragraphs have this claim notably above their 
threshold. Small pool. The count is emergent, not imposed.

**Why exclusivity emerges from centroid geometry**: If two centroids are close together, they compete for the same paragraphs. Both are above-mean for the same paragraphs. Those paragraphs are shared. If two centroids are far apart, they don't compete. Each claim gets its own paragraphs. Exclusivity is a geometric property of centroid separation, not an artifact of threshold tuning.

**Degradation**: When all claims have nearly identical centroids (homogeneous query), every paragraph's similarities across claims are nearly uniform and σ is small. μ + σ then selects only the top 1–3 claims per paragraph. Empirically we observed pools of ~6–29 paragraphs per claim on homogeneous queries. Heterogeneous queries do NOT produce "tighter" pools; instead they show higher exclusivity (a higher fraction of paragraphs uniquely assigned to a single claim) while often producing larger pools — empirically 12–65 paragraphs per claim with average exclusivity ≈33.6%. The key distinction is pool size vs exclusivity: they are independent. When centroids are truly identical (σ = 0 for 
all paragraphs), no claim exceeds any paragraph's threshold. Flagged as 
"undifferentiated — claim centroids colocated." Fallback: assign all paragraphs 
to all claims.

**Future refinement — proportional weights**: The binary assignment (above mean = in, below mean = out) can be extended to continuous weights:



```
excess(P, c) = sim(P, c) - (μ_P + σ_P)    (positive for assigned claims only)
weight(P, c) = excess(P, c) / Σ excess(P, c')   (across all assigned claims)
bulk(c) = Σ weight(P, c)                    (across all assigned paragraphs)
```

Weights enable graduated blast radius (a paragraph where the pruned claim had 90% weight is heavily exposed; one where it had 15% is barely affected), weight-aware carrier detection (don't sweep for carriers on lightly-weighted statements), and proportional skeletonization. Implement after binary competitive assignment is validated.

```
**Council resolution**: Linear weights confirmed. Softmax and nonlinear 
> **Council resolution**: Linear weights confirmed. Softmax and nonlinear
> alternatives rejected — they manufacture false confidence in homogeneous fields
> where tiny numerical differences would dominate. Linear excess is the honest
> measurement of marginal affinity.
|Measurement|Level|What it honestly measures|Consumer|Status|
|---|---|---|---|---|
|Per-claim source statement IDs|L2 (depends on claim centroid)|Which statements live in paragraphs that competitively select this claim|Fate tracking, exclusivity, blast radius, skeletonization, completeness|Active|
|Per-claim pool size|L1 (count)|How many paragraphs competitively assigned to this claim. Emergent from centroid geometry, not imposed.|Diagnostics, provenance quality assessment|Active|
|Per-claim source region IDs|L1 (set lookup: statement → paragraph → region)|Which regions this claim draws evidence from|Diagnostics (region span), alignment|Active|
|`supportRatio`|L2|sourceStatementIds.length / totalStatements|Survey mapper prompt, structural analysis|Active|
|Statement ownership (inverse index: statement → claiming claim IDs)|L1 (set membership)|Which claims compete for the same evidence|Blast radius, triage, synthesis deduplication|Active|
|`exclusivityRatio` per claim|L1 (set membership)|Exclusive source statements / total. Emerges from centroid geometry.|Blast radius (exclusive evidence loss), triage, skeletonization|Active|
|Pairwise Jaccard on source statement sets|L1 (set overlap)|Evidence overlap between claim pairs|Blast radius axis clustering, deduplication, mapper quality check|Active|
|Per-claim excess affinity distribution|L1|Distribution of (sim - μ) values for assigned paragraphs. High excess = strong ownership. Low excess = marginal membership.|Diagnostics (provenance confidence per claim)|Diagnostic|
---

### Layer 6: Carrier Detection

**What this layer does**: During skeletonization (after user prunes claims), determines which surviving statements carry the content of pruned statements — enabling removal of redundant evidence rather than wholesale deletion.

**Inputs**: Statement embeddings (L1), pruning decisions (user input via traversal)

|Measurement|Level|What it honestly measures|Consumer|Current status|Target status|
|---|---|---|---|---|---|
|Per-statement carrier candidates|L1|Which other statements are geometrically close enough to "carry" a pruned statement's content|Skeletonization: carrier found → pruned statement REMOVE, carrier → SKELETONIZE. No carrier → pruned statement SKELETONIZE (sole carrier).|Active — global 0.60 threshold (82% pass rate, ambient noise acceptance)|**Active** — per-statement elbow detection on statement-to-statement similarities|

#### Carrier Threshold

|Property|Current|Target|
|---|---|---|
| Mechanism | Global static 0.60 | `max(μ_statement + σ_statement, P75_global)` on both gates. Per-statement μ+σ adapts to local density. Global P75 floor prevents isolated statements from getting falsely "carried" by distant neighbors. |
| Dual gate | Both gates use 0.60 | Both gates (claim similarity and statement similarity) use the same mechanism: `max(μ+σ, P75_global)` applied to their respective distributions. |
| Degradation | Everything above 0.60 is a carrier (most pairs) | In uniform fields (σ ≈ 0), threshold ≈ max(μ, P75). Most statements won't have carriers. Content is preserved as skeletonized text. Correct bias under irreplaceability principle. |

---

### Layer 7: Paraphrase Detection

**What this layer does**: Identifies near-duplicate statements across models for compression in the mapper prompt.

|Measurement|Level|What it honestly measures|Consumer|Current status|Target status|
|---|---|---|---|---|---|
|Statement-pair cosine similarity|L1|Geometric proximity of two statement embeddings|Paraphrase expansion in `TriageEngine.ts`|Active — threshold 0.85 (0.1% pass rate, only threshold that actually discriminates)|Active — retain 0.85 as floor|
|Token Jaccard overlap|L1|Lexical overlap between statement texts|Not implemented|—|**Add as secondary gate**: Jaccard > 0.5 required alongside cosine > 0.85. Guards against stance-flipped near-duplicates ("Drug X is safe" / "Drug X is lethal" — high cosine, low Jaccard).|

**Validation** (post-implementation): Cross-reference paraphrase detections against mapper-labeled paraphrases. If >95% of mapper-identified paraphrases have cosine ≥ 0.85 AND Jaccard > 0.5, thresholds are calibrated.

---

### Layer 8: Model Ordering

**What this layer does**: Determines the order in which model outputs appear in the mapper prompt. Models that carry unique geometric terrain go first.

**Current state**: Works well. 22x spread between most and least irreplaceable. No changes needed to the core mechanism.

|Measurement|Level|What it honestly measures|Consumer|Status|
|---|---|---|---|---|
|`irreplaceability` per model|L1|Weighted sum of region contributions, weight = 1/regionModelDiversity. "Would losing this model lose statements not represented anywhere else?"|Prompt ordering — `indexedSourceData` sorted by `orderedModelIndices`|Active|
|Per-model query relevance mean|L1|Mean raw cosine (query, statement) across model's statements|Adaptive alpha blend into irreplaceability|Active|
|`adaptiveAlphaFraction`|L1|min(0.25, stddev of per-model query relevance means). Scales query relevance contribution. Collapses to 0 when all models equally on-topic.|Internal to model ordering|Active|
|`orderedModelIndices`|L1 output|Outside-in ordering (most irreplaceable at edges, least in middle)|`StepExecutor` sorts `indexedSourceData` before mapper prompt build|Active|

**Pending validation**: Does the 22x spread survive transition from strong-graph regions to mutual recognition regions? **Open** — test now.

#### Future Addition: Inter-Model Geometric Structure

|Measurement|Level|What it honestly measures|Consumer|Priority|
|---|---|---|---|---|
|Per-model-pair similarity distribution|L1|Slice of full pairwise matrix by model index. Which models are saying similar things vs geometrically divergent.|Mapper prompt ordering (diversity-aware: after relevance, prefer models most different from already-included). Model ordering diagnostics (explains _why_ a model is irreplaceable).|Low — model ordering already works. Add when diagnostics need to show the "why."|
|Per-model internal spread|L1|Internal similarity distribution within a single model's paragraphs. High = model says one thing many ways. Low = model covers diverse ground.|Model ordering diagnostics.|Low|

---

### Layer 9: Structural Analysis

**What this layer does**: Analyzes the claim graph (mapper's output) for structural properties that inform blast radius and survey gating. Operates on the claim graph topology, not on embeddings directly.

**Note**: This layer takes mapper output at face value — it does not geometrically validate claim relationships. Geometric validation signals (`centroidSimilarity`, `crossesRegionBoundary`) exist in diagnostics but are not currently consumed here. Promotion of those signals into structural analysis is a future improvement.

|Measurement|Source|Consumer|Status|
|---|---|---|---|
|`leverage` per claim|Structural analysis|Blast radius composite|Active|
|`isLeverageInversion`|Structural analysis|Blast radius modifier|Active|
|`isKeystone`|Structural analysis|Blast radius modifier|Active|
|`cascadeRisks`|Structural analysis|Blast radius cascade breadth|Active|
|`articulationPoints`|Structural analysis|Blast radius articulation signal|Active|
|`convergenceRatio`|Structural analysis|Blast radius zero-question gate|Active|

**Gap**: Structural analysis trusts mapper edges without geometric validation. A `supports` edge between claims with centroid similarity 0.3 is geometrically implausible. Adding a "geometric plausibility" filter using `centroidSimilarity` would improve claim graph quality before blast radius. Deferred — geometry provides the measurement; structural analysis decides whether to consume it.

---

### Layer 10: Blast Radius

**What this layer does**: Computes per-claim "question-worthiness" scores that gate which claims become survey questions. This is an L2 policy-weighted blend of L1 inputs. The weights are explicit choices, not derived from data.

|Measurement|Level|What it honestly measures|Consumer|Status|
|---|---|---|---|---|
|Per-claim composite score|L2 (policy blend)|`0.30×cascadeBreadth + 0.25×exclusiveEvidence + 0.20×normalizedLeverage + 0.15×queryRelevance + 0.10×articulationPoint`|Axes ordering, gate priority|Active|
|Floor suppression (composite < 0.20)|L2 (policy threshold)|"Below this, the claim is noise for survey purposes"|Candidate set filtering|Active|
|Consensus discount|L2 (policy modifier)|Penalizes claims with broad model support (less controversial → less question-worthy)|Composite modifier|Active|
|Sole-source off-topic discount|L2 (policy modifier)|Penalizes single-model claims with low query relevance (< 0.30 raw cosine)|Guards against hallucinated tangents|Active|
|Redundancy discount|L2 (policy modifier)|Penalizes claims whose evidence pool is largely shared with other claims|Composite modifier|Active|
|Axis clustering|L1 (Jaccard overlap)|Connected components over claim pairs with provenance Jaccard > 0.30. One axis ≈ one decision surface.|Groups overlapping claims into single questions|Active|
|Question ceiling (hard cap 3)|L2 (policy)|Max axes passed to survey mapper. Based on conflict cluster count + sole-source outliers.|Survey mapper scoping|Active|

**Dependency**: Blast radius is currently inert because its key inputs (exclusivity, overlap) are non-discriminating. Once provenance produces meaningful exclusivity, blast radius activates without code changes to this layer.

**Principle**: The L2 weights (0.30/0.25/0.20/0.15/0.10) are policy, not measurement. They should be visible, tunable, and not disguised as derivations. The current implementation is honest about this.

---

### Layer 11: Fate Tracking and Completeness

**What this layer does**: Classifies every statement by what happened to it in the pipeline. Produces recovery worklists for evidence the mapper may have missed.

|Measurement|Level|What it honestly measures|Consumer|Status|
|---|---|---|---|---|
|Statement fate: primary/supporting/unaddressed/orphan/noise|L1 (set membership: is this statement in a claim's source set?)|Whether each statement was claimed, orphaned, or isolated|Completeness reporting, recovery worklist|Active|
|`unaddressed` classification|L1 (ranking, no threshold)|Orphan statements ranked by raw cosine descending — "these statements are not in any claim's evidence pool, ordered by proximity to the user's question"|Recovery worklist (continuous list, no binary gate)|Active — binary threshold eliminated per council resolution|
|`signalWeight` per statement|L2 (weighted sum: conditional×3 + sequence×2 + tension×1)|Advisory ranking heuristic. Weight values are policy choices.|Fate metadata (display/debug only)|Active — display only|
|Statement coverage ratio|L1|inClaims / total statements|Completeness panel|Active|
|Region coverage ratio|L1|attended / total regions|Completeness panel|Active|
|Unattended region detection|L1 (set difference: regions not covered by any claim's source statements)|Coverage gaps in mapper output|Completeness panel, recovery worklist|Active|

---

### Layer 12: Post-Mapper Diagnostics

**What this layer does**: Geometric quality checks on mapper output. These measurements are L1 computations on embeddings, applied to mapper-defined groupings (claims, edges). They answer: "does the mapper's semantic structure match the geometric structure?"

|Measurement|Level|What it honestly measures|Current consumer|Target consumer|
|---|---|---|---|---|
|`sourceCoherence` per claim|L1|Mean pairwise cosine of source statement embeddings. High (>0.8) = focused claim. Low (<0.5) = mapper stapled unrelated content.|Debug panel|**Vetoed for promotion.** Legitimate broad claims naturally have low coherence — penalizing them would suppress integrative insights. Keep in diagnostics for human inspection only.|
|`embeddingSpread` per claim|L1|Stddev of pairwise cosines among source statements. Complements coherence.|Debug panel|Diagnostic (companion to coherence)|
|`regionSpan` per claim|L1|How many distinct regions source statements come from. 1 = concentrated, 3+ = broad synthesis or mapper error.|Debug panel|**Promote to traversal** — claims spanning many regions are either genuine syntheses or mapper fabrications. Present this information at forcing points.|
|`sourceModelDiversity` per claim (exact)|L1|Which specific models authored source statements. Traced: sourceStatementId → paragraph → modelIndex. Different from mapper's `supporters[]` (mapper's assessment vs actual geometric sourcing).|Debug panel|**Promote to blast radius** — cross-check mapper `supporters[]` against actual geometric sourcing. If mapper claims 4 supporters but geometry traces to 1 model, flag as fragile consensus. Safe to promote now.|
|`crossesRegionBoundary` per edge|L1|Whether two connected claims draw from different regions. Cross-region relationships are more likely real tensions. Same-region relationships may be mapper over-fragmentation.|Debug panel|**Hold.** Meaningful only when field has genuine structure (not convergent). Promote conditionally after pipeline gates include discrimination range floor.|
|`centroidSimilarity` per edge|L1|Cosine between two claims' source statement centroids. Continuous version of geographic separation.|Debug panel|**Hold.** Legitimate semantic links can bridge geometric distance (prerequisites, cross-domain dependencies). Risk of penalizing long-range connections. Keep diagnostic, promote only with empirical validation.|

**Principle**: Geometry computes these numbers honestly. Whether and when consumers adopt them is each consumer's decision, not geometry's. The measurements exist in diagnostics until a consumer is ready.

---

### Layer 13: Alignment

**What this layer does**: Compares geometric structure (regions, substrate) against mapper structure (claims, edges). Detects mismatches.

|Measurement|Level|What it honestly measures|Consumer|Status|
|---|---|---|---|---|
|`globalCoverage`|L1|How much of the geometric substrate is covered by mapper claims|Diagnostic panel|Diagnostic|
|`unattendedRegionIds`|L1|Regions with no claim coverage|Diagnostic panel (overlaps with coverage audit)|Diagnostic|
|`splitAlerts`|L1|Regions where claims split geometric clusters (claim centroids in same region but far apart)|Diagnostic panel|Diagnostic|
|`mergeAlerts`|L1|Claims where source statements come from geometrically distant regions (mapper merged distinct content)|Diagnostic panel|Diagnostic|

**Assessment**: Correctly positioned as diagnostic. These are mapper quality checks, not pipeline decisions. No promotion needed.

---

### Pipeline Gates

**What this layer does**: Decides whether enough geometric structure exists to proceed with geometry-dependent pipeline steps.

|Gate|Current mechanism|Target mechanism|
|---|---|---|
| "Is there enough structure?" | Shape classification → lens → threshold-dependent regions | Mutual recognition edge count > 0 AND discrimination range (P90-P10) ≥ 0.10 AND participation_rate > 5%, where participation_rate = (number of nodes with ≥1 mutual recognition edge) / total_nodes. If edges exist but discrimination range is below floor: `undifferentiated_field`. If >0 edges but one component >70%: `convergent_field`. If participation_rate < 5% while other conditions (edges>0 and discrimination≥0.10) hold, return verdict `insufficient_structure` (few spurious dyads do not constitute usable substrate). |
| Skip geometry entirely | `pipelineGates.verdict === 'skip_geometry'` | Same verdict. Triggers: 0 mutual recognition edges OR discrimination range < 0.10. |

**What gets removed**: Shape classification (`fragmentationScore`, `bimodalityScore`, `parallelScore`) as active pipeline inputs. Retained as diagnostic field descriptors. The lens (`AdaptiveLens`) loses both its consumers (HAC is deleted, strong graph is dying) and becomes diagnostic-only.

---

## Part IV: The Derivation Chain

Everything below the stored primitives is a function. This is the complete dependency graph, showing what derives from what.



```
STORED PRIMITIVES
├── batch_responses[model_id]
│   └── shadow_extraction (deterministic)
│       ├── statements[] (text, modelIndex, stance, signals)
│       └── paragraphs[] (statementIds, modelIndex, dominantStance)
│
├── embeddings (statement vectors, paragraph vectors)
│   ├── LAYER 1: full_pairwise_matrix (paragraph × paragraph)
│   │   ├── distribution_stats (percentiles, discrimination range)
│   │   └── per_node_stats (top1Sim, sorted similarity list)
│   │
│   ├── LAYER 2: mutual_recognition_graph (from full pairwise, per-node μ+σ thresholds)
│   │   ├── regions (connected components)
│   │   ├── per_node: mutualRankDegree, isolationScore, neighborhood
│   │   └── region_profiles (modelDiversity, internalDensity, etc.)
│   │
│   ├── LAYER 3: query_relevance_field (query embedding × statement/paragraph embeddings)
│   │   ├── per_statement: raw cosine
│   │   ├── per_paragraph: raw cosine
│   │   └── distribution_stats (mean, stddev, P10, P90)
│   │
│   ├── LAYER 7: paraphrase_detection (statement × statement, threshold 0.85 + Jaccard)
│   │
│   └── LAYER 8: model_ordering
│       ├── per_model: query relevance mean
│       ├── irreplaceability (from regions + profiles)
│       └── orderedModelIndices (output → mapper prompt ordering)
│
└── mapper_response[mapper_id]
    ├── claims[] (label, text, supporters, challenges)
    ├── edges[] (from, to, type)
    │
    ├── LAYER 4: claim_centroids (embedding of claim text via generateClaimEmbeddings — L2 BRIDGE)
    │
    ├── LAYER 5: provenance → competitive assignment (per-paragraph μ+σ across all claim centroids)
    │   ├── per_claim: sourceStatementIds, sourceRegionIds, supportRatio
    │   ├── statement_ownership (inverse index)
    │   ├── exclusivity per claim
    │   └── pairwise Jaccard overlap
    │
    ├── LAYER 6: carrier_detection (statement × statement → elbow, post-pruning)
    │
    ├── LAYER 9: structural_analysis (claim graph topology)
    │   ├── leverage, cascadeRisks, articulationPoints
    │   └── convergenceRatio
    │
    ├── LAYER 10: blast_radius (structural analysis + exclusivity + query relevance)
    │   ├── per_claim: composite score, suppression
    │   ├── axes (Jaccard clustering)
    │   └── questionCeiling
    │
    ├── LAYER 11: fate_tracking (provenance + query relevance → statement fates)
    │   ├── completeness_report (coverage ratios, recovery worklist)
    │   └── unattended_regions
    │
    ├── LAYER 12: post_mapper_diagnostics (embeddings × claim assignments)
    │   ├── sourceCoherence, embeddingSpread, regionSpan per claim
    │   └── centroidSimilarity, crossesRegionBoundary per edge
    │
    └── LAYER 13: alignment (regions + claims → coverage, split/merge alerts)
```

---
## Part V: Implementation Sequence

Each step is independently valuable and testable. Dependencies flow downward.

| Step | What changes | What validates it | Depends on | Status |
|---|---|---|---|---|
| 1. Embedding storage | Persist statement + paragraph + claim text embeddings in IndexedDB | Navigate to old turn, embeddings load | Nothing | **Complete** |
| 2. View-time elbow diagnostics | Elbow diagnostic panel derives from cached embeddings + cached claims | Old turn shows full elbow table without recompute | Step 1 | **Complete** |
| 3. Provenance competitive assignment | `reconstructProvenance` uses competitive assignment (μ+σ per paragraph across claim centroids) instead of global thresholds | Exclusivity nonzero. Pool sizes 6-29 (homogeneous), tighter (heterogeneous). Blast radius differentiates claims. | Step 1 | **Complete** |
| 4. Raw cosine as canonical query signal | Replace `(cos+1)/2` with raw cosine throughout pipeline consumers | Fate tracking, blast radius, recovery worklist use raw values. Diagnostics still show both. | Nothing | **Complete** |
| 5. Full pairwise matrix as foundation | Store complete N×N paragraph matrix + distribution stats as named substrate entity | Per-consumer threshold calibration reads from this field | Step 1 | **Complete** |
| 6. Mutual recognition graph | Replace mutual KNN (fixed top-5) with mutual recognition (per-node μ+σ). Connected components for regionization. | Regions reflect local density. Convergent fields reported honestly. | Step 5 | **Implemented — validation pending** |
| 7. Strong graph removal + gating | Remove strong graph, softThreshold, clamp, strongDegree. Rewire all consumers to mutual recognition. Shape classification and lens become diagnostic-only. Pipeline gates use mutual recognition edge count + discrimination range ≥ 0.10 + participation_rate > 5%. | All consumers of strong graph switched. Pipeline gates fire correctly on edge cases. | Step 6 | **Implemented — validation pending** |
| 8. Unaddressed recovery ranking | Eliminate binary gate for orphan → unaddressed promotion. Orphans ranked by raw cosine descending, optionally weighted by competitive affinity (query cosine − mean claim cosine). Continuous list, no threshold. | Recovery worklist shows all orphans ranked by query affinity. No false negatives from binary gate. | Steps 3, 4 | **Complete** |
| 9. Carrier detection calibration | Replace static 0.60 with gate-specific thresholds `threshold_claim` and `threshold_statement` (see Mechanism). | Carrier pass rate drops from 82% to meaningful range. Isolated statements protected by P75 floor. | Steps 3, 5 | **Implemented — validation pending** |
| 10. Provenance weights | Add linear excess affinity weights to competitive assignment. excess = sim − (μ+σ), normalized per paragraph. Graduated blast radius, weight-aware carrier detection. | Blast radius distinguishes high-weight vs low-weight evidence loss. | Step 3 validated | **Implemented — validation pending** |
| 11. Paraphrase Jaccard gate | Add token Jaccard > 0.5 as secondary gate alongside cosine > 0.85 | Stance-flipped near-duplicates rejected. True paraphrases still pass. | Nothing | **Implemented — validation pending** |
| 12. Diagnostic promotions | Promote `sourceModelDiversity` → blast radius (hallucination check). Veto `sourceCoherence` promotion. Hold `centroidSimilarity` and `crossesRegionBoundary` for empirical validation. | sourceModelDiversity disagreements flagged in blast radius. | Steps 3, 6 | **Implemented — validation pending** |

## Part VI: Empirical Questions

These cannot be resolved by design. They require data from diverse queries.

| Question | How to answer | When | Status |
|---|---|---|---|
| Does competitive assignment produce reasonable pool sizes on homogeneous queries? | Run threshold calibration query. Pool sizes per claim. | After step 3 | **Answered**: 6-29 per claim, avg exclusivity 8.7% |
| Does competitive assignment produce tight pools on heterogeneous queries? | Run diverse-topic query. | After step 3 | **Answered**: 12-65 per claim, avg exclusivity 33.6% |
| Does blast radius differentiate after competitive assignment? | Check blast radius composite scores. | After step 3 | **Answered**: Meaningful spread, non-uniform suppression |
| Does the 22x model ordering spread survive mutual recognition transition? | Run same queries, check irreplaceability spread. | After step 6 | **Open** — test now |
| Does pipeline gating with discrimination range ≥ 0.10 catch spurious structure? | Run queries with tight similarity distributions. Check whether gate fires. | After step 7 | Open |
| Does `max(μ+σ, P75_global)` produce meaningful carrier detection? | Run pruning decisions, check carrier pass rate and replacement fidelity. | After step 9 | Open |
| Does linear weight entropy distinguish homogeneous from heterogeneous provenance? | Compute weight entropy per paragraph across queries of varying breadth. | After step 10 | Open |
| Does sourceModelDiversity reliably flag mapper hallucinated consensus? | Compare mapper `supporters[]` to geometric model diversity across queries. Measure disagreement frequency. | After step 12 | Open |
| Does paraphrase Jaccard > 0.5 cause false negatives on legitimate paraphrases? | Check paraphrases with different wording against Jaccard threshold. | After step 11 | Open |

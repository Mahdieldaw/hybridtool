# Measurement Reference

What we are actually computing at each stage, what each number honestly tells you, and who could act on it.
Format: **Level 1** = pure math on vectors/graphs (honest). **Level 2** = defensible proxy (labeled). **Level 3** = interpretation (belongs in mapper or synthesis, not geometry).

---

## Inputs

| Input | What it is |
|---|---|
| Shadow statements | One sentence or clause per model, with stance label (assertive/prescriptive/cautionary/prerequisite/dependent/uncertain) and binary signals (sequence, tension, conditional). Unit of evidence throughout the pipeline. |
| Statement embeddings | Float32Array per statement, generated from statement text. All similarity math runs on these. |
| Paragraph embeddings | Float32Array per paragraph (centroid of its statements' embeddings). Used for substrate construction and claim-to-paragraph matching fallback. |
| Query embedding | Float32Array for the user's question. Used for query relevance scoring and per-model relevance boost. |

---

## Substrate / Graph Layer

Per-node stats from KNN, mutual, and strong graphs built on paragraph embeddings.

| Measurement | What it actually tells you | Level | Who could use it |
|---|---|---|---|
| `top1Sim` | Cosine similarity to nearest paragraph neighbor | Level 1 | Isolation proxy, substrate quality check |
| `avgTopKSim` | Mean cosine to k nearest neighbors | Level 1 | Local density estimate |
| `mutualDegree` | How many paragraphs mutually agree this is their neighbor | Level 1 | Community membership signal — high = embedded in cluster, low = peripheral |
| `strongDegree` | Degree in above-threshold similarity graph | Level 1 | Core connectivity — only counts edges above softThreshold |
| `isolationScore` | 1 − normalizedMutualDegree | Level 1 | How geometrically alone this paragraph is. Currently mislabeled `novelty` in queryRelevance output. |
| `largestComponentRatio` | Fraction of nodes in the biggest connected component | Level 1 | Whether there is a dominant cluster or the space is fragmented |
| `isolationRatio` | Fraction of nodes with zero mutual neighbors | Level 1 | How much of the content is isolated from everything else |
| `globalStrongDensity` | Fraction of possible edges that exist in the strong graph | Level 1 | Overall tightness of the semantic space |
| `fragmentationScore` | Signal for shape classification | Level 1 | Lens / pipeline gate |
| `bimodalityScore` | Signal for shape classification | Level 1 | Lens / pipeline gate |
| `parallelScore` | Signal for shape classification | Level 1 | Lens / pipeline gate |

---

## Region / Profile Layer

Per-region measurements from `profiles.ts`, computed after `buildRegions`.

| Measurement | What it actually tells you | Level | Who could use it |
|---|---|---|---|
| `modelDiversity` | Count of distinct model indices with paragraphs in this region | Level 1 | Primary tier signal — how many models independently ended up here |
| `modelDiversityRatio` | modelDiversity / total observed models | Level 1 | Normalized version for cross-run comparison |
| `internalDensity` | Fraction of possible strong-graph edges that exist between nodes inside the region | Level 1 | How tightly the region's content clusters in embedding space |
| `avgInternalSimilarity` | Mean pairwise similarity of nodes inside region | Level 1 | Coherence of the region as a semantic unit |
| `stanceUnanimity` | Fraction of nodes sharing the dominant stance | Level 2 | Purity signal — high unanimity means the region speaks with one voice. Stance labels are regex-derived so this is a proxy. |
| `contestedRatio` | Fraction of nodes flagged as contested (cross-model disagreement on dominant stance) | Level 2 | Conflict density within a region |
| `stanceVariety` | Count of distinct stances present in region | Level 2 | Diversity of rhetorical posture |
| `isolation` (region-level) | Mean isolationScore of nodes in region | Level 1 | How detached this region is from the rest of the graph |
| `nearestCarrierSimilarity` | Cosine similarity between this region's centroid and the nearest other region's centroid | Level 1 | How close/far regions are — high means regions bleed into each other |
| `tier` (peak/hill/floor) | Derived from modelDiversity + modelDiversityRatio + internalDensity meeting thresholds | Level 1 output from Level 1 inputs | Model ordering weights, diagnostics, claim geometric signals |

---

## Model Ordering Layer

From `modelOrdering.ts`. Computed before mapper runs.

| Measurement | What it actually tells you | Level | Who could use it |
|---|---|---|---|
| `irreplaceability` per model | Weighted sum of how much of each region this model uniquely carries. High = this model is the sole or primary carrier of geometrically distinct terrain. | Level 1 | Prompt ordering (not yet wired) |
| Per-model `queryRelevance` mean | Mean cosine(query, statement) across all of a model's statements | Level 1 | Adaptive alpha blend into irreplaceability — nudges ordering toward on-topic models |
| `adaptiveAlphaFraction` | min(0.25, stddev of per-model query relevance means) — scales how much query relevance shifts model ordering | Level 1 | Internal to model ordering. Collapses to 0 when all models are equally on-topic. |
| `orderedModelIndices` | Outside-in ordering (most irreplaceable at edges, least in middle) | Level 1 output | **Wired** — `StepExecutor` sorts `indexedSourceData` by this order before building the mapper prompt. Falls back to `citationOrder` if geometry didn't run. |

---

## Query Relevance Layer

From `queryRelevance.ts`. Per-statement scores.

| Measurement | What it actually tells you | Level | Who could use it |
|---|---|---|---|
| `querySimilarity` | (cosine(query, statement) + 1) / 2 normalized to [0,1] | Level 1 | How directly this statement addresses what was asked |
| `novelty` *(misnamed — measures isolation)* | 1 − normalizedMutualDegree. High = paragraph is geometrically alone. | Level 1 | Captures content not in the consensus core. Rename pending. |
| `subConsensusCorroboration` | 1 if this statement's paragraph has multi-model neighbors AND is not in a peak region, else 0 | Level 2 | Cross-model agreement below the consensus peak. Disabled for peak regions (region-profile-aware). |
| `compositeRelevance` | 0.5×querySim + 0.3×novelty + 0.2×subConsensus | Level 2 | Currently orphaned — `deriveConditionalGates` (its only consumer) was deleted. Needs a new consumer. |

---

## Claim Provenance Layer

From `claimProvenance.ts`. Post-mapper, requires `sourceStatementIds` on claims.

| Measurement | What it actually tells you | Level | Who could use it |
|---|---|---|---|
| Statement ownership (inverse index: statement → Set of claiming claim IDs) | Which claims compete for the same evidence. A statement cited by N claims is structurally different from one cited by 1. | Level 1 — set membership | Triage (pruning decisions), synthesis (deduplication detection) |
| `exclusivityRatio` per claim | exclusive source statements / total source statements. 1.0 = claim built entirely from evidence no other claim touches. 0.0 = all evidence shared — pruning this claim loses nothing unique. | Level 1 — set membership | Triage (which claims can be safely pruned), skeletonization |
| Pairwise Jaccard on source statement sets | How much two claims' evidence overlaps. High Jaccard = near-duplicate claims by provenance, independent of semantic content. | Level 1 — set overlap | Deduplication, mapper quality check — should a conflict edge exist between two claims that share most evidence? |

---

## Post-Mapper Diagnostics Layer

From `diagnostics.ts`. Requires claims with `sourceStatementIds` and statement embeddings.

| Measurement | What it actually tells you | Level | Who could use it |
|---|---|---|---|
| **Claim source coherence** — mean pairwise cosine of source statement embeddings | Are this claim's source statements actually about the same thing, or did the mapper staple unrelated content together? High (>0.8) = focused. Low (<0.5) = possibly over-merged. | Level 1 | Traversal (trust claim less if incoherent), UI badge, triage |
| **Claim embedding spread** — stddev of pairwise cosines among source statements | Low spread + high coherence = uniformly tight. High spread + moderate coherence = tight core with outlier statements. | Level 1 | Complements source coherence. Debug panel. |
| **Claim geographic spread** — how many distinct regions source statements come from | Did the mapper draw from one concentrated area, or stitch across distant parts of the space? 1 = concentrated, 3+ = broad synthesis. | Level 1 — counting | Quality flag for mapper output. Claims spanning many regions are either genuine syntheses or mapper errors. |
| **Claim source model diversity** (exact) | Which specific models authored the specific statements backing this claim. Traced: sourceStatementId → paragraph → modelIndex. Different from mapper's `supporters[]` (mapper's assessment vs actual text used). | Level 1 | Cross-check mapper supporters against actual sourcing |
| **Claim dominant region + tier** | Which region contains the most of this claim's evidence, and what tier is it | Level 1 | Claims anchored in floor regions warrant less trust than peak-anchored claims |
| **Edge geographic separation** — do the two claims connected by an edge come from different regions | The relationship spans a structural boundary vs is internal to one cluster. Cross-region conflicts are more likely real tensions; same-region conflicts may be mapper over-fragmentation. | Level 1 | Traversal — structural edges between regions carry more weight |
| **Edge centroid similarity** — cosine between the two claims' source statement centroids | Continuous version of geographic separation. Low similarity = claims are far apart in embedding space. | Level 1 | Edge quality signal. A "supports" edge between claims with low centroid similarity is suspicious. |

---

## Observations (advisory, not measurements)

From `diagnostics.ts`. Not measurements — flags generated from the measurements above.

| Observation | Trigger |
|---|---|
| `uncovered_peak` | Peak region has no claim with supportRatio > 0.3 overlapping its statements |
| `overclaimed_floor` | Floor region has >1 claim drawing from it |
| `claim_count_outside_range` | Mapper claim count outside [multiMemberGroups, 2×totalGroups] at hardMergeThreshold |
| `topology_mapper_divergence` | Strong-graph component count differs from claim graph component count by ≥2 |
| `embedding_quality_suspect` | High fragmentation but mapper found dominant convergent claim |

---

## Coverage / Completeness Layer

From `fateTracking.ts`, `coverageAudit.ts`, `completenessReport.ts`.

| Measurement | What it actually tells you | Level | Who could use it |
|---|---|---|---|
| Statement fate (primary/supporting/orphan/noise) | Whether each statement ended up in a claim. Orphan = in a region but no claim cited it. Noise = isolated with no geometry. | Level 1 — set membership | Coverage reporting, recovery suggestions |
| `signalWeight` per statement | conditional×3 + sequence×2 + tension×1. High-signal orphans are worth surfacing. | Level 2 — weighted signals | Recovery section of completeness report |
| Unattended region detection | Regions not covered by any claim's sourceStatementIds | Level 1 | Coverage gap detection |
| `likelyClaim` on unattended region | stanceVariety ≥ 2 OR avgMutualDegree ≥ 2 OR bridges >1 claimed region | Level 2–3 | Recovery suggestions only — not a pipeline decision |
| Statement coverage ratio | inClaims / total statements | Level 1 | Completeness verdict |
| Region coverage ratio | attended / total regions | Level 1 | Completeness verdict |
| `estimatedMissedClaims` | unattendedWithLikelyClaims + ceil(highSignalOrphans / 3) | Level 3 | Advisory recovery estimate only |

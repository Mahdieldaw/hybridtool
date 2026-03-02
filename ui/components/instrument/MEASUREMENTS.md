# Instrument Panel — Measurements Reference

All measurements produced by the pipeline and surfaced in the Decision Map Sheet instrument panel (and the related entity Diagnostics tab). Organized by panel. Each entry covers what the number is, how it is computed, and what it tells you.

**Epistemic tier notation:**
- `L1` — pure math on vectors/graphs, no labeled signals
- `L2` — uses labeled signals (stance, supporter list, tier). Must be read as signal-conditioned, not purely geometric.

---

## Substrate (L1)

The embedding geometry of the paragraph space before any semantic interpretation. Source: `artifact.geometry.substrate` + `artifact.geometry.basinInversion`.

### Pairwise Similarity Distribution

What the UI actually draws depends on what data exists:
- Preferred: `artifact.geometry.basinInversion.histogram` + `{binMin, binMax, binWidth}` (a binned proxy for the full pairwise field).
- Fallback: `artifact.geometry.substrate.edges[*].similarity` (kNN-truncated edge distribution, not full pairwise).

| Measurement | What it is | What it tells you |
|---|---|---|
| **Nodes** | Number of paragraphs (embedding nodes) | Input volume. More nodes = richer field but also more noise potential. |
| **Pairs** | When basin inversion exists: `artifact.geometry.basinInversion.pairCount` (all pairs). Otherwise: the number of kNN edge sims used in the fallback histogram. | Denominator for the distribution stats you’re looking at (full field vs truncated proxy). |
| **μ (mean)** | Mean of all pairwise cosine similarities | The average "temperature" of the space. High μ means everything is similar to everything. |
| **σ (stddev)** | Standard deviation of pairwise similarities | How spread out the distribution is. Low σ with high μ = collapsed space, no discrimination. |
| **P10** | 10th percentile similarity | The low end of the distribution. |
| **P90** | 90th percentile similarity | The high end — where mutual edges and strong edges live. |
| **D = P90 − P10** | Discrimination range | **The key health metric.** D ≥ 0.10 = meaningful geometry. D 0.05–0.10 = marginal. D < 0.05 = no discrimination; thresholds cannot separate anything. If D is low, downstream claim allocation is noise. |
| **T_v** | Valley threshold from basin inversion | The similarity value sitting in the natural valley between low-similarity and high-similarity clusters. Used to separate "soft" from "strong" edges. Emerald marker on histogram. |
| **Isolated** | Paragraphs with mutualDegree = 0 | Nodes with no mutual edges — they are semantically orphaned. High isolated count means model outputs are fragmented. |

**Per-Node Isolation table:**
- `mutualDegree`: how many mutual reciprocal high-similarity neighbors this paragraph has
- `top1Sim`: cosine similarity to nearest neighbor
- `isolationScore`: `1 - top1Sim` — how far this paragraph is from its closest peer

---

## Mutual Graph (L1)

The undirected reciprocal agreement graph. An edge exists between two paragraphs only when both have each other in their top-K neighbors above the soft threshold. Source: `artifact.geometry.substrate.mutualEdges`.

| Measurement | What it is | What it tells you |
|---|---|---|
| **Participation rate** | Fraction of paragraphs with mutualDegree > 0 | How much of the field is connected. < 5% = insufficient structure; the graph cannot support regionization. |
| **Components** | Connected components in the mutual graph | Number of isolated clusters. Ideally ≤ number of claims. Many small components = fragmented discourse. |
| **Largest component %** | Fraction of nodes in the biggest component | A single giant component means the models broadly agree. Many equal-sized components = no consensus topology. |
| **Avg MutualDeg** | Mean reciprocal connections per node | Average node centrality. Low = sparse mutual agreement. |
| **Max MutualDeg** | Highest-degree node | The most-agreed-upon paragraph. Sometimes a proxy for the epistemic center of the conversation. |

**Gate:** participation > 5% AND at least one mutual edge = structure present. Below this, regionization is unreliable.

---

## Basin Inversion (L1)

Topology of the full pairwise similarity field. Detects whether the distribution has a bimodal shape with a valley between a low-similarity cluster and a high-similarity cluster — the geometric precondition for meaningful thresholds. Source: `artifact.geometry.basinInversion`.

| Measurement | What it is | What it tells you |
|---|---|---|
| **D = P90 − P10** | Discrimination range (same as Substrate) | Prerequisite: D must be ≥ 0.05 for any basin to be detectable. |
| **T_v** | Valley threshold | The cosine similarity value where the density dips between basins. Represents the "natural gap" between unrelated and related paragraph pairs. Only meaningful when status = "ok". |
| **valleyDepthSigma** | Depth of valley in standard deviations | How pronounced the valley is. Deeper = cleaner threshold. Shallow valley = ambiguous separation. |
| **Basins** | Detected density peaks (above T_v) | Each basin is a cluster of mutually similar paragraphs. Should be ≥ number of claims. |
| **trenchDepth** (per basin) | Depth of separation from adjacent basin | How isolated this basin is. Deep trench = clearly distinct cluster. |
| **Zone Population** | % of pairs in High / Valley / Low zones | High zone (> μ+σ): strongly similar pairs. Valley zone (μ-σ to μ+σ): ambiguous. Low zone (< μ-σ): genuinely different. Healthy geometry has a meaningful split; pathological geometry puts > 80% in one zone. |

**Color coding:** blue = low zone, amber = valley zone, emerald = high zone.

---

## Query Relevance (L1)

How much each statement's embedding points toward the user's query embedding.

Source: `artifact.geometry.query.relevance.statementScores` where each entry is expected to be an object (not a bare number), keyed by statement id:
- `simRaw`: raw cosine similarity in [-1, 1]
- `querySimilarity`: normalized similarity in [0, 1] (used in diagnostics; raw↔norm conversion in UI assumes `querySimilarity ≈ (simRaw + 1) / 2`)
- `modelIndex`: model index used for per-model means (instrument summary)
- Optional fields used in diagnostics: `paragraphSimRaw`, `embeddingSource`, `recusant`

| Measurement | What it is | What it tells you |
|---|---|---|
| **simRaw** | Raw cosine similarity between statement embedding and query embedding, range [-1, 1] | Unthresholded geometric proximity to the query. Negative = pointing away, 0 = orthogonal, 1 = identical direction. |
| **Mean raw cosine** | Mean simRaw across all statements | If near 0, the models are not talking about the query subject. If > 0.5, strong topic alignment. |
| **D = P90 − P10** | Spread of query relevance distribution | High spread means some statements are highly on-topic and some are off-topic — the query is discriminating. Low spread means everything is equally irrelevant or equally relevant. |
| **Per-model mean** | Each model's average raw cosine to query | Tells you which models are responding to the query and which are off on tangents. |
| **Spread (max − min)** | Difference between highest-mean and lowest-mean model | > 0.10 = significant divergence between models on query alignment. |

**Threshold reference (instrument & diagnostics):**
- 0.30 raw cosine = sole-source off-topic threshold used in blast radius modifier.
- Diagnostics thresholds are usually expressed in normalized space (0–1) and shown alongside their raw-cosine equivalents.

---

## Competitive Provenance (L1/L2)

Two-level competitive assignment of evidence to claims, plus derived bulk and exclusivity measurements. Source: `artifact.statementAllocation` (§1 new system) and `artifact.claimProvenance` (old paragraph-based system).

### Entropy Distribution

How many claims each statement was assigned to after competitive allocation.

| Measurement | What it is | What it tells you |
|---|---|---|
| **1 claim (exclusive)** | Statements assigned to exactly one claim | These statements are unambiguous — they belong to one claim's territory. More = better claim differentiation. |
| **2 claims** | Statements assigned to two claims | Shared but still manageable. |
| **3+ claims (ambiguous)** | Statements assigned to 3+ claims | These are semantically diffuse — they aren't discriminating between claims. If this is the majority, the claim set may be poorly separated. |

**Health check:** If > 50% of statements are exclusive → good differentiation. If most statements are assigned to 3+ claims → the claims overlap too much, or the competitive threshold is too low (degenerate geometry).

### Old vs New Pool Size (TemporaryInstrumentationPanel)

| Column | What it measures |
|---|---|
| **Old Pool** | `artifact.claimProvenance.competitiveAssignmentDiagnostics[claimId].poolSize` (legacy §0 paragraph pool size). |
| **New Pool** | `artifact.statementAllocation.perClaim[claimId].poolSize` (unified geo §1 statement pool size). |
| **Bulk** | `artifact.statementAllocation.perClaim[claimId].provenanceBulk` (sum of §1 weights). |
| **Ratio** | `NewPool / OldPool` when OldPool > 0. Cross-unit (statements ÷ paragraphs), so not a percentage. |

### Per-Claim Table

| Column | What it measures |
|---|---|
| **Bulk** | Provenance bulk from old paragraph-based system. Sum of paragraph weights assigned to this claim. |
| **Excl%** | Exclusivity ratio from `artifact.claimProvenance.claimExclusivity[claimId].exclusivityRatio` displayed as a percent (×100) in the UI. Low exclusivity (< 20%) = claim is not differentiated from others. |
| **Pool** | §1 statement-level pool size (new system). |
| **Stmts** | `sourceStatementIds.length` — statements collected from the old paragraph pool. All statements from all assigned paragraphs, including off-topic ones from those paragraphs. |

**Why Pool < Stmts:** The old system assigns a paragraph unit and then includes every statement in it wholesale. The §1 system requires each statement to individually beat the μ+σ threshold in cross-claim competition. The §1 pool is more selective.

### Statement Allocation Table (per-claim view)

When a claim is selected, the per-statement competitive allocation table appears.

| Column | What it measures |
|---|---|
| **w(S,C)** | Competitive weight of statement S for claim C. Normalized: `excess(S,C) / Σ excess(S,C')` across all claims where S exceeds threshold. Sums to 1 across assigned claims for each statement. |
| **sim** | Raw cosine similarity `cos(embedding_S, embedding_C)` before thresholding. |
| **excess** | `sim - τ_S` where `τ_S = μ_S + σ_S` (or `μ_S` when there are only 2 claims). Only positive for assigned pairs. |

**Note:** The supporter constraint is applied after competitive allocation. Only statements from models in `claim.supporters` are retained. This can make Pool smaller than the raw competitive count.

### Geometry Correlation

Pearson r between the old paragraph-weight system and the new statement-weight system (mapped back to paragraph space). A high value means the two systems broadly agree on which paragraphs carry the most evidence mass. Low correlation means they diverge — the new system is re-weighting evidence differently from the old one.

The implementation collects this metric from several possible artifact locations and uses the first available value. Source precedence (checked in order):

1. `artifact.geometryCorrelation`
2. `artifact.statementAllocation.geometryCorrelation`
3. `artifact.claimProvenance.geometryCorrelation`
4. `artifact.instrumentation.geometryCorrelation`

If none exist, the UI falls back to computing a local Pearson r when possible.

---

## Continuous Field (L1)

Per-claim z-score relevance field. Scores every statement against every claim without any threshold — a continuous gravity model. Source: `artifact.continuousField`.

### Per-Claim Field Summary

| Column | What it measures |
|---|---|
| **Stmts** | Total statements in the field. **Always the full corpus** — no threshold, no filtering. |
| **Core** | Number of statements with `z_claim > 1.0`. These are the top ~16% most similar statements to the claim by within-claim distribution. The "dense core" of the claim's semantic territory. |
| **μ_sim** | Mean cosine similarity of all statements to this claim's embedding. The baseline semantic temperature. |
| **σ_sim** | Standard deviation. Low σ = all statements are equally (ir)relevant. High σ = clear separation between close and far statements. |

### Field Scores (per statement, per claim)

| Field | What it measures |
|---|---|
| **sim_claim** | Raw cosine similarity: `cos(embedding_stmt, embedding_claim)`. Used as the "Direct" control in the Compare panel. |
| **z_claim** | `(sim_claim - μ_claim) / σ_claim`. How many standard deviations above this claim's mean this statement sits. z_claim > 1.0 → core set. |
| **z_core** | Standardized mean cosine similarity of this statement to the core set statements. Measures proximity to the dense center, not just the centroid. |
| **evidenceScore** | `z_claim + z_core`. Composite within-claim relevance. A statement deep inside both the centroid and the core cluster gets a high score. Can be negative (statement is below the claim's average). |

**Why continuous "includes more":** It does not filter. Every statement is scored. The comparison between continuous and competitive reveals which statements the competitive threshold excluded, and whether those exclusions were correct.

### Competitive vs Continuous Divergence

A disagreement matrix: statements where competitive allocation assigns to claim A but continuous evidenceScore ranks highest for claim B.

| Column | What it measures |
|---|---|
| **Comp→** | Which claim "won" this statement in competitive allocation (highest weight). |
| **Field→** | Which claim has the highest evidenceScore for this statement in the continuous field. |
| **W_comp** | The competitive weight in the winning claim. |
| **E_field** | The evidenceScore in the continuous winner. |

These are the fault lines. A statement competitively assigned to claim A but deeply inside claim B's continuous field may be misclassified by the competitive system — or it may mean the claims overlap semantically.

---

## Compare (L1)

Three-column side-by-side comparison of all assignment methods per claim. Source: `artifact.continuousField.perClaim` and `artifact.statementAllocation.perClaim`.

| Column | Method | Score shown | What it tells you |
|---|---|---|---|
| **Direct (control)** | Sort all statements by `sim_claim` descending, no threshold | `sim_claim` (0–1) | Naive cosine nearest-neighbors. The baseline: which statements are closest to this claim's embedding in the raw vector space. |
| **Competitive §1** | Only statements that beat the per-statement μ+σ threshold in cross-claim competition, filtered by supporters | `w(S,C)` (0–1) | Which statements the system decided "belong to" this claim after competing against all other claims. Fewer, more selective. |
| **Continuous §2** | All statements ranked by `evidenceScore = z_claim + z_core` | `evidenceScore` (can be negative) | Statements ranked by depth inside the claim's semantic territory. Higher score = sits both near the centroid and near the dense core. |

**Reading the comparison:**
- If Direct and Competitive agree on the top statements → the threshold is working as intended.
- If Competitive is empty or very small while Direct has many → the threshold is too aggressive or supporters are filtering heavily.
- If Continuous ranks a statement very highly that Competitive excluded → either it failed the cross-claim threshold (another claim scored higher) or it failed the supporter filter. Worth investigating which.

The header row shows `N comp · M total` — competitive pool size vs total statement count for that claim.

---

## Cross-Signal Compare (Scatterplot diagnostics)

Implemented in the UI scatter panel used by the Decision Map instrument. Useful to quickly spot relationships between any two per-claim measures (e.g., provenanceBulk vs exclusivityRatio, avgStatementRelevance vs blastRadius).

Computed / surfaced fields:
- Points: per-claim `{ id, label, x, y }` where `x` and `y` come from selectable measures. Measures implemented in the UI:
  - `provenanceBulk` (claim field)
  - `supportCount` (legacy: `claim.support_count` or `claim.supporters.length`)
  - `exclusivityRatio` (displayed as a percent in the scatter UI: `exclusivityRatio * 100`)
  - `blastRadius` (uses `score.composite` or `score.score` from `artifact.blastRadiusFilter.scores`)
  - `avgStatementRelevance` (attempts to average per-statement values over `claim.sourceStatementIds`)
- Pearson r (correlation): computed locally via `pearsonR(xs, ys)` when there are at least 3 points.
- Linear regression fit (slope `b`, intercept `a`): computed via ordinary least squares on visible points — used for a visual trend line.
- Residuals & outliers: absolute residuals sorted; top-K outliers collected for quick highlighting (UI shows up to 5 by default). Implementation details: residual = y_i - (a + b * x_i).

Source paths / hints:
- Measure values are resolved from claim objects and auxiliary artifact maps:
  - `artifact.claimProvenance.claimExclusivity[claimId].exclusivityRatio`
  - `artifact.blastRadiusFilter.scores` → mapped by claim id
  - `artifact.geometry.query.relevance.statementScores` → per-statement scores aggregated to `avgStatementRelevance` by claim via `sourceStatementIds`
  - Legacy `support_count` lives on the claim object as `claim.support_count` or `claim.supporters.length`

Important shape note:
- Most other UI panels treat `statementScores[statementId]` as an object with `{ simRaw, querySimilarity, ... }`. The scatter’s `avgStatementRelevance` aggregation currently only reads numeric values, so it may show blank unless the exporter also provides a numeric map or the UI is updated.

---

## Temporary Instrumentation Panel (runtime diagnostics)

These are the runtime-only computed summaries and tables the instrument panel shows. They are implemented in the `TemporaryInstrumentationPanel` and its helpers.

Extra computed pieces implemented in the UI and now documented as canonical:

- `geometryCorrelation` precedence and fallback (see above).
- `entropy` breakdown: prefers `artifact.statementAllocation.entropy`; otherwise derived from `artifact.statementAllocation.assignmentCounts` (per-statement assigned-claim count). Reported values: counts for 1-claim, 2-claim, 3+-claims and total statements.
- `stmtToPara` and `paraTextMap`: maps constructed from `artifact.shadow.paragraphs` to trace which paragraph a statement came from and to render sample paragraph text in pool comparisons.
- `paragraphSimilarityPerClaim`: read from `artifact.paragraphSimilarityField?.perClaim` when present — used to show ranked paragraphs for a claim using a `sim` field.
- `assignedParagraphsByClaim`: assigned paragraphs from legacy (§0) paragraph assignment, built from `claim.sourceStatementIds` → statement-to-paragraph map.
- `rankedParagraphsByClaim`: a ranked paragraph list per claim from `artifact.paragraphSimilarityField.perClaim[claimId].field`. Each row includes `{ id, text, sim, w1 }` where `w1` is computed in the UI as the per-paragraph sum of §1 statement weights (from `artifact.statementAllocation.perClaim[claimId].directStatementProvenance`) when available.
- `assignmentDiagnostics`, `perClaimAlloc`, `comparisonRows`: UI aggregates used to render the Old vs New pool table. `comparisonRows` includes per-claim OldPool, NewPool, Bulk, Ratio.
- `continuousSummary`: small summary of `artifact.continuousField` including claim count, total core size (sum of cores across claims) and disagreement count derived from `continuousField.disagreementMatrix`.
- `dualCoordinateActive`: boolean flag `statementAllocation.dualCoordinateActive` indicating whether the §1 allocator ran in "dual coordinate" mode. In the current UI it is displayed as a badge; `w1` is shown whenever per-paragraph weights can be computed (independent of this flag).

Important artifact paths used by these computations:
- `artifact.statementAllocation` (perClaim, entropy, assignmentCounts, dualCoordinateActive)
- `artifact.claimProvenance` (competitiveAssignmentDiagnostics, claimExclusivity, geometryCorrelation)
- `artifact.continuousField` (perClaim, disagreementMatrix)
- `artifact.paragraphSimilarityField` (perClaim)
- `artifact.shadow.paragraphs`, `artifact.shadow.statements`
- `artifact.blastRadiusFilter.scores`

---

## Carrier Detection (L2)

Statement fate triage. For each statement, tracks whether it ended up as primary evidence, supporting evidence, or fell through to unaddressed/orphan/noise. Source: `artifact.completeness.statementFates`.

| Fate | Meaning |
|---|---|
| **primary** | Statement is directly cited as evidence for at least one claim. |
| **supporting** | Statement is indirectly associated (e.g. carrier relationship). |
| **unaddressed** | Statement passed relevance gating but wasn't placed. |
| **orphan** | Statement had no claim relationship at all. |
| **noise** | Statement was explicitly rejected. |

| Measurement | What it tells you |
|---|---|
| **Coverage rate** | `(primary + supporting) / total`. The fraction of statements that ended up represented in the output. Low coverage = many statements were gathered but not used, suggesting either the models went off-topic or pruning is too aggressive. |
| **Unaddressed count** | Statements that were relevant but not incorporated. These are the missed evidence opportunities. |
| **Orphan + noise count** | Statements that weren't relevant at all. High orphan count is expected when models have divergent topic coverage. |

---

## Model Ordering (L1)

Ranks models by their geometric irreplaceability — how much unique evidence each model contributes that no other model covers. Source: `artifact.geometry.preSemantic.modelOrdering`.

| Measurement | What it tells you |
|---|---|
| **Irreplaceability** | Score 0–1. A model with high irreplaceability has statements that are geometrically unique — their removal would create evidence gaps. Low irreplaceability = redundant model; another model covers the same territory. |
| **queryRelevanceBoost** | Adjustment to irreplaceability from query alignment. A model whose outputs are highly query-relevant gets a boost even if it overlaps with others geometrically. |
| **soloCarrierRegions** | Regions where this model is the only carrier. High solo carrier count = if this model is removed, those regions have no coverage. |
| **lowDiversityContribution** | Penalty for contributing to regions that already have many contributors. Present in the artifact breakdown; not currently surfaced in the instrument card table. |
| **Spread (max − min irreplaceability)** | How differentiated the models are. Low spread = all models contribute roughly equally. High spread = some models are essential and some are redundant. |

---

## Blast Radius (L2 — policy)

Composite claim importance score used to gate which claims become survey questions. Components are L1 geometry, but the blend weights are policy decisions, not data. Source: `artifact.blastRadiusFilter`.

### Policy Weights (fixed, not learned)

| Component | Weight | What it measures |
|---|---|---|
| **Cascade breadth** | 0.30 | How many claims would be affected if this claim were removed (downstream in the causal/logical graph). High cascade = structural hub. |
| **Exclusive evidence** | 0.25 | Fraction of this claim's supporting statements that no other claim shares. High exclusivity = irreplaceable evidence anchor. |
| **Leverage** | 0.20 | Structural leverage score — whether this claim is an articulation point for epistemic chains. |
| **Query relevance** | 0.15 | Average query relevance of this claim's supporting statements. |
| **Articulation point** | 0.10 | Binary (0/1): whether removing this claim would disconnect the semantic graph. |

### Modifiers (applied after component blend)

| Modifier | Effect |
|---|---|
| **Consensus discount** | `score *= (1 - supportRatio * discountStrength)`. Claims supported by all models are down-weighted — they don't need to be surveyed because they're already settled. Scales with model count. |
| **Sole-source off-topic** | `score *= 0.50` when supporters = 1 AND queryRelevance < 0.30. A claim supported by only one off-topic model is penalized. |
| **Redundancy discount** | For pairs with Jaccard > 0.5 (shared statement pool), the lower-scoring claim is discounted: `score *= (1 - jaccard * 0.4)`. |

### Key metrics

| Measurement | What it tells you |
|---|---|
| **rawComposite** | Pre-modifier composite score. |
| **composite** | Post-modifier score. This is what gates inclusion. |
| **Suppressed** | Claims with composite < 0.20 are excluded from survey axis selection. The floor (0.20) is the only binary kill. |
| **Convergence ratio** | Fraction of claims with strong model consensus. If > 0.7, no leverage inversions, no sole-source outliers, and no conflicts → survey is skipped entirely. |
| **Axes** | Claims that survived suppression and were selected as survey question topics. |
| **Question ceiling** | Hard max of 3 survey questions. |

---

## Alignment

Region-to-claim coverage analysis. Checks whether the geometric regions identified by regionization are correctly covered by the semantic claims. Source: `artifact.alignment` or `artifact.geometry.alignment`.

| Measurement | What it tells you |
|---|---|
| **Global coverage** | `alignment.globalCoverage` (0–1). High means most region content is covered by at least one claim. |
| **Unattended regions** | `alignment.unattendedRegionIds[]`. Regions with no covering claims. |
| **Region coverages** | `alignment.regionCoverages[]` rows with `regionId`, `coverageRatio`, `totalStatements`, `bestClaimSimilarity`. |
| **Split alerts** | `alignment.splitAlerts[]` rows with `maxInterRegionDistance` + `regionIds` for a claim that spans far regions. |
| **Merge alerts** | `alignment.mergeAlerts[]` rows with `(claimIdA, claimIdB, similarity)` for near-duplicate claims. |

---

## Decision Map Sheet UI (visual debug computations)

These are view-time computations and visual encodings used by the Decision Map Sheet. They don’t come from the pipeline directly, but they determine what you see.

### Field Health Bar (top of sheet)

Computed from `artifact.geometry.basinInversion` + `artifact.geometry.substrate`:
- `D`: discrimination range `basinInversion.discriminationRange` with a color scale (≥0.10 green, 0.05–0.10 amber, <0.05 red)
- `T_v`: `basinInversion.T_v`
- `basinCount`: `basinInversion.basinCount`
- `mutualEdges`: `artifact.geometry.substrate.mutualEdges.length`
- `participationRate`: `% of substrate.nodes with mutualDegree > 0`
- `status`: `basinInversion.status` / `statusLabel`

### Right Panel Composition (instrument mode)

The right panel always renders three stacked blocks (unless the layer is Raw Artifacts):
- Layer card (selected layer) with a layer-specific copy payload (see below)
- Cross-Signal Compare scatter diagnostics
- Temporary Instrumentation Panel summary (context-sensitive to the selected layer)

### Copy Payload (layer copy button)

The copy button serializes a layer-specific view of the artifact:
- Substrate: summary stats + per-node `{id, mutualDegree, top1Sim}` (no raw edge arrays)
- Mutual graph: per-node `{id, mutualDegree}` (no raw edge arrays)
- Provenance comparison: per claim, top-10 rows for Direct / Competitive / Continuous lists (text included when available)
- Mixed provenance: `artifact.mixedProvenance` as-is
- Raw artifacts layer: the entire artifact JSON

### ParagraphSpaceView (canvas encoding)

Inputs:
- Geometry: `artifact.geometry.substrate.nodes[]` (x/y, paragraphId, mutualDegree, statementIds, modelIndex, …)
- Mutual edges: `artifact.geometry.substrate.mutualEdges[]` (source/target paragraph ids)
- Basin inversion: `artifact.geometry.basinInversion` (optional; enables basin colors + basin bounding rects)
- Regions: `preSemanticRegions[]` (id, kind, nodeIds) (optional; enables hull overlays)
- Paragraph text: `artifact.shadow.paragraphs[]` with `_fullParagraph` and `statementIds` (for click-to-inspect)
- Claim overlay: claim centroids computed from claim source statements mapped into paragraph positions (see `useClaimCentroids`)
- Mapper edges: `artifact.semantic.edges[]` projected between claim centroids (optional; dashed)

View-time computations / encodings:
- View bounds: min/max substrate `node.x/node.y` padded by 8%, then remapped into a fixed SVG viewBox.
- Paragraph node radius: `r = clamp(3.2 + 0.55 * mutualDegree, 2.8..7.5)`.
- Basin coloring (optional): paragraph fill assigned by `basinId = basinInversion.basinByNodeId[paragraphId]` into a fixed palette.
- Basin bounding rects (optional): per-basin min/max of remapped paragraph positions, padded by 16px.
- Region hulls (optional): convex hull computed over region node positions; hull stroke thickens when it spans selected claim sources.
- Claim diamonds: sized by claim provenance bulk: `size = clamp(7 + 0.7 * provenanceBulk, 7..14)`; hover/selection reveals label.
- Mutual edges: drawn as lines between paragraph positions; when a claim is selected, edges whose endpoints are both source paragraphs are emphasized.
- Selection filtering: when a claim is selected, non-source paragraph nodes are dimmed; hulls not spanning sources are dimmed.
- Paragraph inspection drawer (bottom strip): clicking a paragraph shows `_fullParagraph` plus statement list (with optional stance tags).

### Toggle Bar (canvas switches)

UI-only boolean toggles exposed in the current toggle bar:
- `showMutualEdges`, `showClaimDiamonds`, `showMapperEdges`, `showRegionHulls`, `showBasinRects`

Additional highlight toggles are part of instrument state and are wired into the canvas, but are not currently exposed in the toggle bar UI:
- `highlightSourceParagraphs`, `highlightInternalEdges`, `highlightSpannedHulls`

### Claim Detail Drawer (right overlay)

Fields displayed and how they’re sourced:
- Claim identity: `claim.id`, `claim.label`, `claim.text`, `claim.role`, `claim.type`, `claim.challenges`
- Supporters: `claim.supporters[]` shown as provider orbs (resolved via `citationSourceOrder` when available)
- Connected edges: filters `artifact.semantic.edges[]` where `edge.from === claim.id || edge.to === claim.id`, labels other endpoint via `artifact.semantic.claims[]`
- Provenance profile: `claim.sourceStatementIds.length`, `claim.supportRatio`, `claim.provenanceBulk`, exclusivity counts from `artifact.claimProvenance.claimExclusivity[claim.id]`
- Structural profile: `claim.leverage`, `claim.inDegree`, `claim.outDegree`, `claim.chainDepth`, `claim.keystoneScore`
- Blast radius profile: looks up `artifact.blastRadiusFilter.scores[]` for `claimId === claim.id`, shows `composite` + component fields
- Skeletonization profile: uses `artifact.mixedProvenance.perClaim[claim.id]` when present, showing core/boundary/floor counts and the top survived statements (sorted by `globalSim`)
- Narrative excerpt: extracts up to 3 narrative paragraphs from `narrativeText` that contain the claim label (case-insensitive), and bolds the matched label
- Flags (badges): `claim.isKeystone`, `claim.isLeverageInversion`, `claim.isEvidenceGap`, `claim.isOutlier`, `claim.isIsolated`

---

## Diagnostics Tab (separate from instrument panel)

Available via the entity profile panel. Contains deeper panel-level diagnostics.

### Embeddings

Source: `artifact.geometry.substrate`.

Computed / displayed:
- Distribution summary cards:
  - Prefers `substrate.extendedSimilarityStats` (count/min/p10/p25/p50/p75/p90/p95/max/mean/stddev + discrimination range p90−p10)
  - Falls back to `substrate.similarityStats` (mean/p50/p80/p95/max)
- Threshold overlay table:
  - Computes `% above/below` against the kNN edge similarity distribution (`substrate.edges`)
  - If `substrate.allPairwiseSimilarities` is missing, the panel can compute the full pairwise field from cached embeddings via `GET_PARAGRAPH_EMBEDDINGS_RECORD` and then show `% above/below` for the full field too
- Histograms: full pairwise (if available), kNN edges, mutual edges, and per-node `top1Sim`
- Per-node table: `paragraphId`, `modelIndex`, `top1Sim`, `avgTopKSim`, `mutualDegree`, `strongDegree`, `isolationScore`
- Per-edge table (merged): kNN / mutual / strong edges with `source`, `target`, `similarity`, `rank`, `graphType`
- Diagnostic observations: `artifact.geometry.diagnostics.observations[]` rows with `type`, optional `regionIds`, optional `claimIds`, and `observation`

### Basin Inversion

Source: prefers `artifact.geometry.basinInversion`, otherwise can compute from cached paragraph embeddings for the current AI turn.

Computed / displayed:
- Summary cards: μ/σ/p10/p90/D/T_v, peak detection diagnostics (`bandwidth`, peak prominences, valley depth), basin counts + largest basin ratio, zone population %, status label
- Per-basin table: `basinId`, `size`, `ratio`, `trenchDepth`
- Bridge inspector table: `nodeA`, `nodeB`, `similarity`, `(basinA, basinB)`, `Δ from T_v` (with paragraph text tooltips when available)

### Provenance

Deeper per-claim exclusivity analysis:
- **Exclusivity ratio**: fraction of source statements exclusive to this claim (not shared with any other claim)
- **Fully exclusive claims**: claims with exclusivityRatio = 1.0
- **Fully shared claims**: claims with exclusivityRatio = 0 (every statement they cite is also cited by at least one other claim)
- **Multi-claimed statements**: statements that appear in more than one claim's source pool — these are the contested evidence points
- **Claim Overlap (Jaccard)**: for each pair of claims, what fraction of their statement pools overlap

Also shown:
- Per-claim elbow diagnostics (gap distribution), sourced from `artifact.claimProvenance.elbowDiagnostics` or derived via cached embeddings (`DERIVE_ELBOW_DIAGNOSTICS`).
- Completeness report cards from `artifact.completeness.report` and a statement fate table from `artifact.completeness.statementFates`.

### Structural Analysis

Graph-theoretic analysis of the semantic edge graph:
- Articulation points (claims whose removal disconnects the graph)
- Leverage inversions (claims with high out-degree but low in-degree — they receive no support but make strong claims)
- Chain depth: longest dependency chain from this claim
- Cascade risks: claims that would cause many downstream failures if removed

### Blast Radius (deeper)

Same as instrument Blast Radius tab but with histograms of composite score distribution and detailed modifier breakdown.

### Skeletonization

Statement-level triage diagnostics combining completeness + shadow audit.

Computed / displayed:
- Summary cards from `artifact.shadow.audit` (referenced/unreferenced counts, high-signal unreferenced, gap counts) and `artifact.completeness.report` (coverage/orphaned/noise), plus unattended region count
- Fate distribution derived from `artifact.completeness.statementFates`
- Stance distribution from `artifact.shadow.audit.byStance` (referenced vs unreferenced)
- Statement triage table: statement id, modelIndex, stance, confidence, signal flags (sequence/tension/conditional), fate + reason, claim count, querySimilarity, isolationScore (from `statement.geometricCoordinates.isolationScore` when present)
- Unattended regions table: regionId, statementCount, modelDiversity, avgIsolation, bridgesTo
- Top unreferenced statements callout from `shadow.topUnreferenced` or `shadow.audit.topUnreferenced`

### Regenerate (Diagnostics tab button)

The Diagnostics tab can trigger a regen run:
- Sends `REGENERATE_EMBEDDINGS` for the active `{aiTurnId, providerId}`.
- Merges the returned artifact patch into the in-memory turn (deep merge; arrays prefer the patch when non-empty).
- Clears derived elbow cache for the turn so elbow diagnostics re-derive against the new geometry.

---

## Field-Level Thresholds Quick Reference

| Value | Used in | Meaning |
|---|---|---|
| 0.20 | Blast radius floor | Below this composite score, a claim is suppressed from survey selection |
| 0.30 | Query relevance (sole-source) | Blast radius penalty for sole-source off-topic claims |
| 0.45 | Provenance paragraph anchor | Paragraph-to-claim similarity needed to enter the candidate pool (old system) |
| 0.55 | Statement refinement / carrier min | Statement-to-claim similarity minimum; also skeletonization elbow fallback |
| 0.60 | Carrier detection | Source-to-surviving-claim similarity needed to classify as "carried" |
| 0.72 | Clustering merge default | Default threshold for merging close paragraphs into the same cluster |
| 0.78 | Soft threshold ceiling | Upper clamp for the dynamically computed soft threshold |
| 0.85 | Paraphrase detection | Near-paraphrase gate |
| 0.92 | Merge alert | Claim-to-claim similarity threshold for near-duplicate alert |
| μ+σ | §1 statement allocation threshold | Per-statement dynamic threshold for cross-claim competition (or just μ when N=2 claims) |
| T_v | Basin inversion valley | Dynamic threshold from topology; separates "soft" from "strong" similarities |

The §1 competitive allocation and blast radius design goal is to eliminate most of the static values above. After Phase 3, only T_v and the blast radius floor (0.20) should remain.

---

## Implementation mapping (quick reference)

Below are the canonical artifact property paths the UI reads for each major measurement. Use these as the source-of-truth bindings when implementing or instrumenting:

- Substrate / Mutual / Basin → `artifact.geometry.substrate`, `artifact.geometry.substrate.mutualEdges`, `artifact.geometry.basinInversion`
- Query relevance → `artifact.geometry.query.relevance.statementScores` (aggregated to claims via `claim.sourceStatementIds`)
- Statement allocation (competitive §1) → `artifact.statementAllocation.perClaim`, `artifact.statementAllocation.assignmentCounts`, `artifact.statementAllocation.entropy`
- Claim provenance (paragraph legacy + exclusivity) → `artifact.claimProvenance` (including `claimExclusivity`, `competitiveAssignmentDiagnostics`, `geometryCorrelation`)
- Continuous field → `artifact.continuousField` (includes `perClaim`, `disagreementMatrix`)
- Blast radius → `artifact.blastRadiusFilter` (includes `scores`, component breakdown)
- Paragraph similarity / ranked paragraphs → `artifact.paragraphSimilarityField?.perClaim`
- Shadow corpus (statements / paragraphs) → `artifact.shadow.statements`, `artifact.shadow.paragraphs`
- Instrumentation overrides / computed geometry correlation → `artifact.instrumentation.*`


If a new measurement is added to the UI, add the artifact path here and a one-line description.

---

## Notes for engineers

- The Decision Map sheet UI implements resilient fallbacks: when a direct artifact path is missing the UI will attempt to compute the metric locally from available inputs (e.g., computing Pearson r from arrays). Keep the artifact path list above updated if you choose to persist a derived metric server-side.
- Scatterplot / compare visuals compute linear fits and residuals locally — these are not persisted in artifacts and are UI-only diagnostics.
- Paragraph-level ranked lists in the Decision Map Sheet read from `artifact.paragraphSimilarityField.perClaim` when available; otherwise the ranked paragraph section is not shown.
- `dualCoordinateActive` is a persisted run-mode flag; the current UI shows it as a badge, but does not gate whether `w1` is rendered.

---

This document is intended to be the single source-of-truth for what the Decision Map instrument shows, where it reads the numbers from, and how derived diagnostics are computed. Keep it in sync with `ui/components/DecisionMapSheet.tsx`, `ui/components/ParagraphSpaceView.tsx`, `ui/components/instrument/*`, `ui/components/entity-profiles/audit/*`, and any server-side artifact producers.

### ReconstructProvenance (canonical linking)

The pipeline function `reconstructProvenance(...)` (implemented in `src/ConciergeService/claimAssembly.ts`) is the canonical L1 linking pass that enriches mapper claims with the evidence links the UI reads. The Decision Map UI expects claims to be "enriched" by this function (see `// IMPORTANT: use artifact claims (enriched by reconstructProvenance, which adds sourceStatementIds).` in `ui/components/DecisionMapSheet.tsx`).

Signature (canonical):
- `reconstructProvenance(claims, statements, paragraphs, paragraphEmbeddings, regions, totalModelCount, statementEmbeddings?) -> LinkedClaim[]`

Primary outputs added to each LinkedClaim (persisted into artifact and read by the UI):
- `sourceStatementIds: string[]` — canonical list of statement IDs linked to the claim (used everywhere the UI shows per-claim pools).
- `sourceStatements: Statement[]` — optional inline statement objects for convenience in debug views.
- `sourceRegionIds: string[]` — derived by mapping statement → paragraph → region; used by alignment and region coverage tables.
- `supportRatio` / `supporters` — fraction/identity of models that supply supporting statements for the claim.
- `provenanceBulk` — scalar evidence mass for the claim computed as the sum of per-source "excess" values (excess = sim − stats.threshold) as collected during the competitive allocation pass. This is the canonical bulk used by the UI `provenanceBulk` measure.
- `paragraphAssignment` (legacy §0): a mapping of assigned paragraph ids for the claim (OldPool) with per-paragraph `{ sim, threshold, excess }` used to populate OldPool / NewPool comparisons.

Secondary / diagnostic outputs written nearby (artifact keys):
- `artifact.statementAllocation` — (new §1 system) includes `perClaim` weights, `assignmentCounts`, `entropy`, and `dualCoordinateActive`. When present the UI shows statement-level pools, and can compute per-paragraph `w1` by summing weights of statements mapped into each paragraph.
- `artifact.claimProvenance` — contains diagnostic objects like `competitiveAssignmentDiagnostics`, `claimExclusivity` and any Jaccard overlap matrices the exporter persisted.
- `artifact.claimProvenance.geometryCorrelation` — when computed server-side it is placed here; UI will fall back to other paths if missing.

Implementation notes / invariants (important for UI correctness):
- The UI treats `mappingArtifact.semantic.claims` (or `artifact.semantic.claims`) as the source-of-truth claim list; ensure `reconstructProvenance` enriches those claim objects with `sourceStatementIds` before artifact persistence or StepExecutor wiring.
- `provenanceBulk` and `meanExcess` must be computed consistently from the same "excess" definition. (Audit fix: when computing totalExcess ensure `totalExcess += (sim - stats.threshold)` so `meanExcess` and `provenanceBulk` use the same baseline.) See the notes in `comparison/northstar` audit for the exact patch location.
- `dualCoordinateActive` should be set to `true` under `artifact.statementAllocation.dualCoordinateActive` when the statement-level allocator ran in dual-coordinate mode. The current UI treats it as an informational badge, not a rendering gate.
- The legacy paragraph-competitive assignment remains available for OldPool comparisons; the current UI merges both sources into `comparisonRows` and derives `OldPool`/`NewPool`/`Bulk`/`Ratio`.

Where the UI reads these values:
- `mappingArtifact.semantic.claims[*].sourceStatementIds` — per-claim statement lists used by nearly all per-claim aggregations
- `artifact.statementAllocation.perClaim` — competitive §1 weights and per-claim statement assignments
- `artifact.claimProvenance.claimExclusivity[claimId].exclusivityRatio` — exclusivity used in scatterplots and blast modifiers
- `artifact.paragraphSimilarityField.perClaim` — ranked paragraph sims for per-claim paragraph views (preferred over assembling from shadow)

Developer checklist when changing reconstructProvenance or related exporters:
- Persist `sourceStatementIds` on `semantic.claims` before returning the artifact to the UI.
- If you add or change the definition of `excess` / `threshold`, update `provenanceBulk` computation and the UI docs here.
- When adding a new diagnostic array (e.g., `competitiveAssignmentDiagnostics`), update `artifact.claimProvenance` mapping and add a short one-line entry in the Implementation mapping section above.

### Mixed-Method Provenance (implemented)

This project implements the Mixed-Method Provenance algorithm in `src/ConciergeService/claimAssembly.ts` as `computeMixedMethodProvenance(...)`. The MD below is a verbatim, code-traced description of what the function actually does, the exact thresholds used, and the artifact shape the UI reads.

Purpose
- Run alongside existing paragraph-centric competitive allocation (unchanged) and produce a merged, statement-resolved canonical source set per claim.
- Recover evidence that paragraph-competitive loses and remove paragraph-inherited noise via statement-level filtering.

Where results are stored
- The result is returned as a `MixedProvenanceResult` and is attached to the artifact as `artifact.mixedProvenance` by the step executor when available. The UI reads `artifact.mixedProvenance.perClaim[claimId]`.

Algorithm (exactly as implemented)

1. Preconditions
   - Inputs: claims[], paragraphs[], statements[], paragraphEmbeddings, statementEmbeddings, claimEmbeddings, competitivePools (Map<claimId, Set<paragraphId>>).
   - Build lookups: stmtById, paraById, paraByStmtId.
   - Precompute `allCorpusEmbeddings` = embeddings for every statement in corpus for corpusAffinity calculations.

2. Claim-centric paragraph scoring (claim-text centroids)
   - For each claim C with centroid e_C compute sim for every paragraph P: sim = cosine(e_C, e_P).
   - Compute ccMu = mean(sim over paragraphs), ccSigma = stddev(sim over paragraphs), ccThreshold = ccMu + ccSigma.
   - Claim-centric pool ccPool := { P | sim(P) > ccThreshold } (empty when σ=0).

3. Merge pools
   - Retrieve competitiveParas = competitivePools.get(C) (paragraph-centric pool built from reconstructProvenance mapping paragraph→claim).
   - mergedParagraphs = union(competitiveParas, ccPool). Each merged paragraph is tagged with origin ∈ { 'both', 'competitive-only', 'claim-centric-only' } and claimCentricSim when available.

4. Preservation-by-default statement candidate set
   - Compute globalSim for every statement S in mergedParagraphs: globalSim[S] = cos(e_S, e_C).
   - Compute globalMu = mean(globalSim over ALL statements in corpus) and globalSigma = stddev(globalSim over ALL statements in corpus).
   - Define boundaryFloor = globalMu - globalSigma.
   - Classify each candidate statement into zones:
     - core if globalSim >= globalMu
     - boundary if boundaryFloor <= globalSim < globalMu
     - floor-removed if globalSim < boundaryFloor
   - For floor-removed statements zone becomes 'removed' immediately.

5. Differential filter on boundary zone (specificity test)
   - Build coreEmbeddings = embeddings of all core statements (for this claim).
   - For each boundary statement B compute:
     - coreAffinity = mean_{R in coreSet} cos(e_B, e_R)
     - corpusAffinity = mean_{A in ALL statements} cos(e_B, e_A)
     - differential = coreAffinity - corpusAffinity
   - Promotion rule (sign-of-zero split):
     - If differential <= 0 ⇒ promote B to 'boundary-promoted' (kept).
     - If differential > 0 ⇒ mark B 'removed'.
   - Edge cases:
     - If coreEmbeddings is empty OR corpusEmbeddings empty ⇒ all boundary statements are removed (can't compute differential).

6. Supporter constraint and canonical set
   - Canonical survived statements for claim C = { statements with zone ∈ { 'core', 'boundary-promoted' } AND statement.modelIndex ∈ claim.supporters }.
   - Counts and diagnostics are collected: coreCount, boundaryPromotedCount, boundaryRemovedCount, floorRemovedCount, keptCount, removedCount, totalCount, bothCount, competitiveOnlyCount, claimCentricOnlyCount.

Exact thresholds and parameters
- Claim-centric paragraph threshold: ccThreshold = μ_C + σ_C (μ+σ) except when σ == 0, which yields empty ccPool.
- Statement global floor: keep if globalSim >= globalMu; boundary if globalMu - globalSigma ≤ globalSim < globalMu; removed if globalSim < globalMu - globalSigma.
- Differential threshold: sign-of-zero (<= 0 promoted, >0 removed). No tunable constants beyond μ and σ.

Output shape (contract mapping)
- artifact.mixedProvenance.perClaim[claimId] → MixedProvenanceClaimResult with fields:
  - claimId, ccMu, ccSigma, ccThreshold
  - mergedParagraphs: Array<MixedParagraphEntry> (paragraphId, origin, claimCentricSim, claimCentricAboveThreshold)
  - statements: Array<MixedStatementEntry> with exact fields:
    - statementId, globalSim, kept (boolean), fromSupporterModel (boolean), paragraphOrigin, paragraphId,
      zone ∈ { 'core', 'boundary-promoted', 'removed' }, coreCoherence (coreAffinity), corpusAffinity, differential
  - globalMu, globalSigma, boundaryCoherenceMu
  - keptCount, removedCount, totalCount
  - bothCount, competitiveOnlyCount, claimCentricOnlyCount
  - coreCount, boundaryPromotedCount, boundaryRemovedCount, floorRemovedCount
  - canonicalStatementIds: string[] (core + boundary-promoted after supporter filter)
- Aggregate result: MixedProvenanceResult has perClaim map and recoveryRate, expansionRate, removalRate.

Downstream semantics
- The canonicalStatementIds become the canonical source statements consumed by downstream systems (exclusivity, skeletonization inputs, blast radius computations). The StepExecutor wires `mixedProvenance` into the artifact so UI and other consumers can read it.

Debug Panel and UI changes (exact additions)
- Mixed provenance statement table: new columns populated from `MixedStatementEntry`:
  - Fate (zone): core / boundary-promoted / removed
  - Core affinity (coreCoherence): mean cos to retained core set (boundary rows)
  - Corpus affinity (corpusAffinity): mean cos to all statements (boundary rows)
  - Differential: coreCoherence - corpusAffinity (boundary rows)
  - paragraphOrigin: 'competitive-only'|'claim-centric-only'|'both'
- Sort boundary rows by differential ascending (most negative = most specifically aligned) and draw a zero-line marker in the UI.
- Aggregate diagnostics added to instrumentation:
  - Boundary promotion rate = boundaryPromotedCount / (boundaryPromotedCount + boundaryRemovedCount)
  - Boundary exclusion rate = boundaryRemovedCount / (boundaryPromotedCount + boundaryRemovedCount)
  - Per-claim boundary size and counts above.

Implementation notes (code-accurate)
- This function uses `cosineSimilarity` over Float32Array embeddings; all means and stddevs are population statistics (divide by N) as in the code (not sample-corrected).
- The sign test for differential is intentional: differential <= 0 indicates specificity to the claim core; > 0 indicates generic affinity and removal.
- The function preserves competitive paragraph assignment logic and only enhances it; it never replaces or removes competitive output—both pools are unioned.

Where to look in code
- Implementation: `src/ConciergeService/claimAssembly.ts` → `computeMixedMethodProvenance` (lines ~998–1480)
- Contract types: `shared/contract.ts` → `MixedProvenanceClaimResult`, `MixedStatementEntry`, `MixedParagraphEntry` (lines ~760+)
- Step wiring: `src/core/execution/StepExecutor.js` and `src/sw-entry.js` — the step executor attaches `mixedProvenance` into the artifact object for UI consumption.

---

Developer checklist (code-traced)
- Ensure `artifact.mixedProvenance` is persisted in runs where `computeMixedMethodProvenance` executes.
- When changing `globalMu`/`globalSigma` calculation or the differential rule, update the UI tests and the Debug Panel column behavior.
- If you enable LLM attribution for pruning later, keep this pipeline as a geometric fallback and record differences.

---

# Evidence Console — Architecture & Usage Manual

The Evidence Console replaces the old 13-tab card layout with a forensic-first evidence table as the primary instrument surface. It consists of four layers:

```
┌─────────────────────────────────────────────────┐
│  Context Strip (always visible, ~40px)          │  ← geometry health at a glance
├─────────────────────────────────────────────────┤
│  Toolbar: claim | view | scope | + Columns      │  ← controls
├─────────────────────────────────────────────────┤
│  Evidence Table (flex-1, virtualized)           │  ← primary surface
├─────────────────────────────────────────────────┤
│  Reference Shelf (max-h-72, collapsible)        │  ← deep-dive cards
└─────────────────────────────────────────────────┘
```

---

## File Map

| File | Purpose |
|------|---------|
| `ui/hooks/useEvidenceRows.ts` | Assembles `EvidenceRow[]` from the cognitive artifact |
| `ui/components/instrument/columnRegistry.ts` | Column definitions, view presets, types |
| `ui/components/instrument/EvidenceTable.tsx` | Virtualized table with sort/group/threshold preview |
| `ui/components/instrument/ContextStrip.tsx` | Geometry health pills (D, T_v, basins, participation, Q_spread, status) |
| `ui/components/instrument/ColumnPicker.tsx` | Column visibility popover + computed column builder |
| `ui/components/instrument/expressionEngine.ts` | Safe expression parser (no `eval()`) for computed columns |
| `ui/hooks/useInstrumentState.ts` | State: `selectedView`, `scope`, `expandedRefSections` |
| `ui/components/DecisionMapSheet.tsx` | Parent — wires everything together |

---

## 1. `useEvidenceRows(artifact, selectedClaimId)` — Data Assembly

**Location:** `ui/hooks/useEvidenceRows.ts`

Produces one `EvidenceRow` per shadow statement. Data is pulled from multiple artifact paths and merged into a flat row.

### Data sources

| Field(s) | Artifact path | Scope |
|----------|---------------|-------|
| `sim_query` | `geometry.query.relevance.statementScores[stmtId].querySimilarity` | Global (same for all claims) |
| `fate` | `completeness.statementFates[stmtId].fate` | Global |
| `claimCount` | `statementAllocation.assignmentCounts[stmtId]` | Global |
| `sim_claim`, `z_claim`, `z_core`, `evidenceScore` | `continuousField.perClaim[claimId].field[].{sim_claim, z_claim, z_core, evidenceScore}` | Claim-relative |
| `w_comp`, `excess_comp`, `tau_S` | `statementAllocation.perClaim[claimId].directStatementProvenance[].{weight, excess, threshold}` | Claim-relative |
| `globalSim`, `zone`, `coreCoherence`, `corpusAffinity`, `differential`, `paragraphOrigin` | `mixedProvenance.perClaim[claimId].statements[]` | Claim-relative |
| `isExclusive` | `claimProvenance.claimExclusivity[claimId].exclusiveIds` OR fate has only 1 claimId | Claim-relative |
| `stance`, `confidence` | `shadow.statements[].{stance, confidence}` | Per-statement |

### Memoization strategy

- **`globalMaps`** (query scores, fates, assignment counts) — recomputed only when `artifact` changes.
- **`claimMaps`** (continuous field, competitive, mixed, exclusivity) — recomputed when `artifact` OR `selectedClaimId` changes.
- **Row assembly** — recomputed when any of the above change.

### Inclusion flags

Determine which statements appear when `scope = 'claim'`:

| Flag | Condition |
|------|-----------|
| `inCompetitive` | Statement appears in competitive allocation for this claim |
| `inContinuousCore` | Statement in continuous field AND `z_claim > 1.0` |
| `inMixed` | Statement appears in mixed provenance for this claim |
| `inDirectTopN` | Statement appears in continuous field at all |

### Why some rows show `null` for claim-relative fields

Claim-relative fields (`sim_claim`, `w_comp`, `globalSim`, etc.) are `null` when the statement was NOT included in that analysis pipeline for the selected claim. This is expected — not every statement participates in every provenance method. When `scope = 'all'`, these null-field rows become visible (they're filtered out in `scope = 'claim'`).

---

## 2. `columnRegistry.ts` — Column Definitions & Views

### ColumnDef

Each column is a typed object:

```typescript
interface ColumnDef {
  id: string;           // Used as key everywhere
  label: string;        // Display name in table header
  accessor: (row: EvidenceRow) => any;  // Value extractor
  type: 'number' | 'text' | 'category' | 'boolean';
  format?: (val: any) => string;        // Display formatter
  sortable: boolean;
  groupable: boolean;
  description?: string;  // Tooltip text
  source: 'built-in' | 'computed';
  category: 'identity' | 'geometry' | 'competitive' | 'continuous' | 'mixed' | 'metadata';
}
```

### Built-in columns (20)

| Category | Columns |
|----------|---------|
| **Identity** | `text`, `model`, `paragraphId` |
| **Geometry** | `sim_claim`, `sim_query` |
| **Competitive** | `w_comp`, `excess_comp`, `tau_S`, `claimCount` |
| **Continuous** | `z_claim`, `z_core`, `evidenceScore` |
| **Mixed** | `globalSim`, `zone`, `coreCoherence`, `corpusAffinity`, `differential`, `paragraphOrigin` |
| **Metadata** | `fate`, `stance`, `isExclusive` |

### ViewConfig

Each view preset controls which columns are visible, how rows are sorted, and whether they're grouped:

```typescript
interface ViewConfig {
  id: string;
  label: string;
  columns: string[];       // Which column IDs are shown
  sortBy: string;          // Default sort column
  sortDir: 'asc' | 'desc';
  groupBy: string | null;  // Default group column (null = flat list)
}
```

### Default views

| View | Purpose | Columns | Sort | Group |
|------|---------|---------|------|-------|
| **Provenance** | Core evidence view. "Which statements back this claim and how strongly?" | text, model, sim_claim, w_comp, evidenceScore, zone | sim_claim desc | zone |
| **Differential** | Boundary analysis. "Which statements are specifically aligned vs generically present?" | text, model, globalSim, zone, coreCoherence, corpusAffinity, differential | differential asc | zone |
| **Allocation** | Resource sharing. "How is each statement distributed across claims?" | text, model, claimCount, w_comp, isExclusive, sim_query | w_comp desc | (none) |
| **Query Alignment** | Query relevance. "How well does each statement address the original question?" | text, model, sim_query, sim_claim, fate | sim_query desc | fate |

### What happens when you switch views

1. `selectedView` state updates (in `useInstrumentState`)
2. `useEffect` in `DecisionMapSheet` resets `visibleColumnIds` to the new view's `.columns`
3. `activeViewConfig` memo recalculates
4. `useEffect` in `EvidenceTable` syncs local sort/group state from the new `viewConfig`
5. Table re-renders with new columns, sort order, and grouping

---

## 3. `EvidenceTable` — Virtualized Table

**Location:** `ui/components/instrument/EvidenceTable.tsx`

### Architecture

Uses `@tanstack/react-virtual` v3 `useVirtualizer` to render 200+ rows without scroll lag. Only rows visible in the viewport are rendered.

```
Props:
  rows: EvidenceRow[]       ← from useEvidenceRows
  columns: ColumnDef[]      ← filtered by visibleColumnIds
  viewConfig: ViewConfig    ← active view preset
  scope: 'claim' | 'cross-claim' | 'statement'
  onSort, onGroup, onRowClick  ← optional callbacks
```

### Processing pipeline (inside the component)

```
rows
  → scopedRows (filtered by scope: 'claim' = only inclusion-flagged rows)
  → sortedRows (sorted by localSortBy + localSortDir)
  → virtualItems (grouped by localGroupBy, interleaved group headers + rows)
  → useVirtualizer (estimates: group=28px, row=32px, expanded=96px)
```

### Row sizes

| Item type | Height |
|-----------|--------|
| Group header | 28px |
| Normal row | 32px |
| Expanded row | 96px (shows full text + metadata) |

### Scope filtering

| Scope | What's shown |
|-------|-------------|
| `claim` | Only rows where `inCompetitive \|\| inContinuousCore \|\| inMixed \|\| inDirectTopN` |
| `cross-claim` / `statement` | All shadow statements |

### Sorting

Click a column header to cycle: **desc** → **asc** → **none** → **desc**. Only columns with `sortable: true` respond to clicks. Active sort column is highlighted in the header.

Null values sort to the bottom regardless of direction.

### Grouping

Columns with `groupable: true` show a small `÷ group` / `÷ ungroup` button below the header label. When grouped, rows are partitioned by the column value and each group gets a colored header showing the group key and count.

Groupable columns: `model`, `paragraphId`, `claimCount`, `zone`, `paragraphOrigin`, `fate`, `stance`, `isExclusive`.

### Threshold preview (Phase 8)

The `zone` column header has a range slider (`z_claim` from -2 to 3, step 0.1, default 1.0). Dragging it reclassifies zones in real-time:
- `z_claim > threshold` → core
- `z_claim > threshold * 0.5` → boundary-promoted
- else → removed

Changed rows are highlighted `bg-amber-500/10`. Click `✕` to clear the preview. This does NOT modify the artifact — it's a local visual preview only.

### Row expansion

Click any row to expand it. The expanded state shows:
- Full statement text (word-wrapped)
- Statement ID, model index, paragraph ID

---

## 4. `ContextStrip` — Geometry Health Bar

**Location:** `ui/components/instrument/ContextStrip.tsx`

A row of colored pills showing geometry health metrics. Always visible at the top of the instrument panel.

### Metrics

| Pill | Source | Color thresholds |
|------|--------|-----------------|
| **D** (discrimination range) | `basinInversion.discriminationRange` | Green: D >= 0.10, Amber: 0.05-0.10, Red: < 0.05 |
| **T_v** (valley threshold) | `basinInversion.T_v` | Always neutral (informational) |
| **basins** | `basinInversion.basinCount` | Always neutral |
| **particip** (participation rate) | `substrate.nodes` where `mutualDegree > 0` / total | Green: >= 20%, Amber: 5-20%, Red: < 5% |
| **Q_spread** | P90 - P10 of `query.relevance.statementScores[*].querySimilarity` | Always neutral |
| **status** | `basinInversion.status` | Green: "ok", Amber: "undifferentiated", Red: anything else |

### Clickable histograms

Pills with histogram data (`D` and `Q_spread`) open a popover on click showing a 20-bin mini histogram with the distribution. The `D` histogram also shows a vertical marker at `T_v`.

### Implementation details

- `MiniHistogram`: 20-bin histogram rendered as flex bars. Hover shows bin range and count.
- `Pill`: button with outside-click-to-close behavior. Only pills with `histogramData` are clickable.
- Uses `useMemo` on `artifact` to rebuild pill array. No claim-relative state.

---

## 5. `ColumnPicker` — Column Visibility & Computed Columns

**Location:** `ui/components/instrument/ColumnPicker.tsx`

Opened via the `+ Columns` button in the toolbar. A popover with:

### Column visibility

Checkboxes grouped by category (Identity, Geometry, Competitive, Continuous, Mixed, Metadata, Computed). Toggle any column on/off. `Reset` restores the active view's default column set.

### Computed columns (expression engine)

At the bottom of the popover, users can add custom computed columns:

1. Enter a **label** (column display name)
2. Enter an **expression** (e.g., `sim_claim - tau_S`, `w_comp > 0.5 ? 1 : 0`)
3. Click `+ Add Column`

The expression is validated and compiled via `expressionEngine.ts`. Invalid expressions show an error. Valid columns appear in the table with an `fx` badge.

Autocomplete suggests column names as you type.

---

## 6. `expressionEngine.ts` — Safe Expression Evaluator

**Location:** `ui/components/instrument/expressionEngine.ts`

A recursive descent parser that evaluates expressions without `eval()`.

### Supported syntax

| Feature | Examples |
|---------|---------|
| **Arithmetic** | `sim_claim + w_comp`, `z_claim * 2`, `excess_comp / tau_S` |
| **Comparison** | `sim_claim > 0.5`, `z_claim >= 1.0`, `claimCount === 1` |
| **Logic** | `isExclusive && w_comp > 0.3`, `!isExclusive` |
| **Ternary** | `z_claim > 1 ? "core" : "removed"` |
| **Functions** | `abs(differential)`, `max(sim_claim, sim_query)`, `min(w_comp, 0.5)`, `round(z_claim)` |
| **Column references** | Any `EvidenceRow` field name: `sim_claim`, `w_comp`, `fate`, etc. |
| **Literals** | Numbers (`0.5`, `100`), strings (`"core"`), booleans (`true`, `false`), `null` |

### Null propagation

If any column reference in an arithmetic or comparison expression is `null`, the entire expression returns `null`. This prevents misleading results from missing data.

### API

| Function | Signature | Purpose |
|----------|-----------|---------|
| `compileExpression(expr, columnIds)` | `→ CompiledExpression \| null` | Compile and validate. Returns an object with `.evaluate(row)` |
| `validateExpression(expr, columnIds)` | `→ string \| null` | Validate only. Returns error message or null if valid |

### Parser precedence (low to high)

1. Ternary (`? :`)
2. OR (`\|\|`)
3. AND (`&&`)
4. Equality (`===`, `!==`)
5. Comparison (`>`, `<`, `>=`, `<=`)
6. Add/subtract (`+`, `-`)
7. Multiply/divide/modulo (`*`, `/`, `%`)
8. Unary (`-`, `!`)
9. Primary (literals, identifiers, function calls, parenthesized expressions)

---

## 7. `useInstrumentState` — State Management

**Location:** `ui/hooks/useInstrumentState.ts`

### State shape

| Field | Type | Default | Purpose |
|-------|------|---------|---------|
| `selectedView` | `string` | `'provenance'` | Active view preset ID |
| `scope` | `'claim' \| 'cross-claim' \| 'statement'` | `'claim'` | Row filter scope |
| `expandedRefSections` | `string[]` | `[]` | Which Reference Shelf sections are open |

### Actions

| Action | What it does |
|--------|-------------|
| `setSelectedView(id)` | Switch view → triggers column + sort/group reset |
| `setScope(scope)` | Switch scope → filters rows in EvidenceTable |
| `toggleRefSection(id)` | Open/close a Reference Shelf card section |

---

## 8. Wiring in `DecisionMapSheet.tsx`

### Toolbar controls (top of instrument panel)

| Control | State | Effect |
|---------|-------|--------|
| **Claim selector** (`<select>`) | `selectedClaimId` | Changes which claim's data `useEvidenceRows` assembles |
| **View switcher** (`<select>`) | `selectedView` | Resets visible columns + sort/group via `useEffect` |
| **Scope toggle** (claim / all) | `scope` | Filters rows to claim-relevant or all statements |
| **+ Columns** button | opens `ColumnPicker` | Toggle column visibility, add computed columns |

### Data flow

```
artifact (from parent)
  ↓
useEvidenceRows(artifact, selectedClaimId) → EvidenceRow[]
  ↓
activeColumns = visibleColumnIds.map(id → allColumns.find(id))
  ↓
<EvidenceTable rows={evidenceRows} columns={activeColumns} viewConfig={activeViewConfig} scope={scope} />
```

### Column state

- `extraColumns`: computed columns added by user (persisted in component state)
- `allColumns`: `BUILT_IN_COLUMNS` + `extraColumns`
- `visibleColumnIds`: set from active view's `.columns` on view switch; toggled via ColumnPicker

### Reference Shelf

Below the evidence table. Each section is a collapsible `RefSection` wrapper around existing card components. Sections: Pairwise Geometry, Mutual Graph, Basin Inversion, Model Ordering, Blast Radius, Carrier Detection, Alignment, Cross-Signal Scatter, Raw Artifacts.

Expand/collapse is tracked in `useInstrumentState.expandedRefSections`.

---

## Quick-reference: column semantics

| Column | What it measures | L1/L2 | Interpretation |
|--------|-----------------|-------|---------------|
| `sim_claim` | cos(statement, claim embedding) | L1 | Higher = more geometrically aligned |
| `sim_query` | cos(statement, query embedding) | L1 | Higher = more relevant to user's question |
| `w_comp` | Competitive allocation weight | L1 | Share of this statement "owned" by the claim |
| `excess_comp` | Weight above threshold | L1 | How far above the allocation threshold |
| `tau_S` | Allocation threshold | L1 | The competitive cutoff for this claim |
| `claimCount` | Number of claims this statement supports | L2 | 1 = exclusive, >1 = shared evidence |
| `z_claim` | Z-score relative to claim distribution | L1 | >1.0 = core, 0.5-1.0 = boundary |
| `z_core` | Z-score relative to core cluster | L1 | How far from the core center |
| `evidenceScore` | Composite evidence score | L1 | Blended measure of evidence strength |
| `globalSim` | Global similarity from mixed provenance | L1 | Position in the global field |
| `zone` | core / boundary-promoted / removed | L2 | Mixed-provenance classification |
| `coreCoherence` | Mean cos to core cluster | L1 | How well the statement fits the core |
| `corpusAffinity` | Mean cos to all statements | L1 | Generic similarity (not claim-specific) |
| `differential` | coreCoherence - corpusAffinity | L1 | Negative = specifically aligned to claim |
| `paragraphOrigin` | Which method found this statement | L2 | competitive-only / claim-centric-only / both |
| `fate` | Statement disposition | L2 | primary / supporting / unaddressed / orphan / noise |
| `stance` | Epistemic stance label | L2 | From semantic mapper |
| `isExclusive` | Exclusively assigned to this claim | L2 | true = not shared with other claims |

# Stages 2–6 — Measurements + Thresholds (Code Truth)

This document maps the current measurements and thresholds used in the pipeline stages after embeddings: query relevance, provenance reconstruction, structural analysis, blast radius filtering, and skeletonization.

Scope: code-truth only (what the current implementation does), including threshold values and any per-query normalization behavior.

---

## Threshold Index (current constants)

**Note**: All similarity thresholds are in **raw cosine scale [-1, 1]** unless marked otherwise.

| Threshold / Policy | Value | Scale | What it gates | Where |
|---|---:|---|---|---|
| Query similarity canonical | `querySimilarity = simRaw` | raw [-1,1] | Source of truth for all threshold comparisons | `src/geometry/queryRelevance.ts` |
| Query similarity display (normalized) | `(simRaw + 1) / 2` | normalized [0,1] | UI display only, never used for logic | `src/geometry/queryRelevance.ts` |
| Blast radius sole-source off-topic | `< 0.30` | raw [-1,1] | Off-topic discount trigger. On-topic range: 0.4–0.7 | `src/core/blast-radius/blastRadiusFilter.ts` |
| Provenance paragraph anchor | `0.45` | raw [-1,1] | Claim→paragraph candidate set | `src/ConciergeService/claimAssembly.ts` |
| Provenance statement refinement | `0.55` | raw [-1,1] | Claim→statement selection | `src/ConciergeService/claimAssembly.ts` |
| Provenance fallback (no statement embeddings) | `0.5` + top `5` paragraphs | raw [-1,1] | Claim→paragraph matches feeding statement ids | `src/ConciergeService/claimAssembly.ts` |
| Skeletonization claim relevance min | `0.55` | raw [-1,1] | “Is this statement about the pruned claim?” gate. Computed via elbow; fallback: 0.55 | `src/skeletonization/TriageEngine.ts` |
| Carrier similarity thresholds (defaults) | `0.6 / 0.6` | raw [-1,1] | Candidate must match claim + match source | `src/skeletonization/types.ts`, `src/skeletonization/CarrierDetector.ts` |
| Skeletonization paragraph prefilter | `0.45` | raw [-1,1] | Candidate statement set by paragraph relevance | `src/skeletonization/TriageEngine.ts` |
| Paraphrase threshold | `0.85` | raw [-1,1] | Cross-model paraphrase detection | `src/skeletonization/TriageEngine.ts` |
| Consensus support ratio boundary | `0.5` | ratio [0,1] | Structural “consensus” designation | `src/core/structural-analysis/engine.ts` |
| Anchor score threshold | `>= 2` | count | Structural “anchor” role | `src/core/structural-analysis/engine.ts` |
| Fragile foundation support ratio | `< 0.4` | ratio [0,1] | Fragility pattern detection | `src/core/structural-analysis/patterns.ts` |
| Blast radius redundancy jaccard | `> 0.50` | ratio [0,1] | Redundancy discount trigger | `src/core/blast-radius/blastRadiusFilter.ts` |
| Blast radius composite floor | `< 0.20` | ratio [0,1] | Only binary suppression gate | `src/core/blast-radius/blastRadiusFilter.ts` |
| Axis clustering jaccard | `> 0.30` | ratio [0,1] | Claims grouped into one axis | `src/core/blast-radius/blastRadiusFilter.ts` |
| Zero-question convergence gate | `> 0.70` | ratio [0,1] | Skip survey if no counter-signals | `src/core/blast-radius/blastRadiusFilter.ts` |
| Zero-gate override (sole-source) | `composite > 0.50` | ratio [0,1] | Prevent skip if strong sole-source outlier exists | `src/core/blast-radius/blastRadiusFilter.ts` |
| Remove-only-when-multiple-carriers | `>= 2` | count | Allows `REMOVE` instead of `SKELETONIZE` | `src/skeletonization/TriageEngine.ts` |

---

## Stage 2 — Query Relevance (statement-level)

### Outputs

`computeQueryRelevance(...)` returns:

- `statementScores: Map<string, { querySimilarity: number; recusant: number }>`

Source: `src/geometry/queryRelevance.ts`

### Measurement 2.1 — Query similarity

For each statement:

1. Choose an embedding:
   - Prefer `statementEmbeddings.get(statementId)`
   - Else fall back to the statement’s paragraph embedding: `paragraphEmbeddings.get(paragraphId)`
   - Else treat as missing (similarity defaults to 0)
2. Compute raw cosine similarity:
   - `simRaw = cosineSimilarity(queryEmbedding, embedding)` (range [-1, 1])
   - **CANONICAL VALUE**: `querySimilarity = simRaw` (stored raw, used directly for all threshold comparisons)
   - For UI display only: `querySimilarityNormalized = clamp01((simRaw + 1) / 2)` maps to [0, 1]

Important behavior:
- `simRaw = 0` (orthogonal) = `querySimilarity = 0` (raw) = `querySimilarityNormalized = 0.5` (normalized)
- `simRaw = 1` (parallel) = `querySimilarity = 1` (raw) = `querySimilarityNormalized = 1.0` (normalized)
- `simRaw = -1` (opposite) = `querySimilarity = -1` (raw) = `querySimilarityNormalized = 0.0` (normalized)

Source: `src/geometry/queryRelevance.ts`

### Measurement 2.2 — Recusant (statement detachment proxy)

For each statement, derive a degree from geometry:

- Map statement → paragraph id via `ShadowParagraph.statementIds`
- Map paragraph id → substrate node
- Use `node.mutualDegree` as the statement’s degree (default 0 if unmapped)

Then min-max normalize degrees over the current statement set:

- `normalizedDensity = (degree - minDegree) / (maxDegree - minDegree)` (clamped to [0,1])
- `recusant = 1 - normalizedDensity` (clamped to [0,1])

Interpretation (as implemented): `recusant = 1` means most isolated (lowest mutual degree in the run), `recusant = 0` means most connected (highest mutual degree in the run).

Source: `src/geometry/queryRelevance.ts`

### Known downstream thresholds using querySimilarity

Query relevance itself does not apply thresholds, but `querySimilarity` (raw cosine [-1,1]) is used by:

- **Stage 5 (Blast Radius)**: `SOLE_SOURCE_OFFTOPIC_QUERY_THRESHOLD = 0.30` for sole-source off-topic discount.
  - Compares: `queryRelevance < 0.30` (raw cosine)
  - Semantics: On-topic content typically 0.4–0.7; below 0.30 = genuinely tangential
  - Source: `src/core/blast-radius/blastRadiusFilter.ts:291`

- **Stage 6 (Skeletonization)**: `dynamicRelevanceMin` (computed via elbow or fallback `0.55`) for “is-this-statement-about-the-pruned-claim” gating.
  - Compares: `similarity > dynamicRelevanceMin` (raw cosine)
  - Computed via elbow detection on source-to-centroid similarities; fallback value 0.55
  - Source: `src/skeletonization/TriageEngine.ts:154–163`

- **Stage 6 (Skeletonization Carrier Detection)**: Carrier similarity thresholds (default `0.6 / 0.6`) for matching statements to candidates.
  - Compares: `similarity >= threshold` (raw cosine)
  - Source: `src/skeletonization/CarrierDetector.ts`

**Historical note**: Fatetracking (Step 8) removed the orphan→unaddressed promotion threshold. All orphans with query scores now become 'unaddressed' (no binary gate).

---

## Stage 3 — Provenance Reconstruction (claim ↔ source statements)

### Measurement 3.1 — Claim embeddings

`reconstructProvenance(...)` builds claim texts as:

- `${claim.label}. ${claim.text || ''}`

Then generates embeddings:

- `claimEmbeddings = await generateTextEmbeddings(claimTexts)`

Source: `src/ConciergeService/claimAssembly.ts`

### Measurement 3.2 — Claim → paragraph candidate selection

If statement embeddings are available (`statementEmbeddings !== null && statementEmbeddings.size > 0`), provenance matching uses a two-phase approach:

1. For each paragraph with an embedding:
   - `similarity = cosineSimilarity(claimEmbedding, paragraphEmbedding)`
   - Keep paragraph if `similarity > 0.45`
2. Sort passing paragraphs by similarity descending (tie-break by paragraph id)
3. Collect candidate statement ids from the matched paragraphs’ `statementIds`

Threshold: `0.45` paragraph gate.

Source: `src/ConciergeService/claimAssembly.ts`

### Measurement 3.3 — Claim → statement refinement

Within candidate statements:

- `similarity = cosineSimilarity(claimEmbedding, statementEmbedding)`
- Keep statement if `similarity > 0.55`
- Sort passing statements by similarity descending (tie-break by statement id)
- `sourceStatementIds = scoredStatements.map(statementId)`

Fallback behavior:

- If no statements pass `> 0.55`, provenance falls back to using all candidate statement ids from matched paragraphs.

Threshold: `0.55` statement gate.

Source: `src/ConciergeService/claimAssembly.ts`

### Measurement 3.4 — Provenance fallback mode (no statement embeddings)

If statement matching is disabled (missing statement embeddings), provenance uses paragraph-level matching only:

- Keep paragraphs where `cosineSimilarity(claimEmbedding, paragraphEmbedding) > 0.5`
- Sort descending by similarity
- Take the top `5` paragraphs
- Union their `statementIds` as `sourceStatementIds`

Threshold: `0.5`, Top-K: `5` paragraphs.

Source: `src/ConciergeService/claimAssembly.ts`

### Measurement 3.5 — Claim provenance set metrics (structural)

After `sourceStatementIds` exist, the pipeline computes structural provenance metrics:

- Statement ownership: `statementId -> Set<claimId>`
  - Source: `computeStatementOwnership` in `src/ConciergeService/claimProvenance.ts`
- Claim exclusivity:
  - `exclusiveIds`: statements owned by only this claim
  - `sharedIds`: statements owned by multiple claims
  - `exclusivityRatio = exclusive / (exclusive + shared)` (0 if no statements)
  - Source: `computeClaimExclusivity` in `src/ConciergeService/claimProvenance.ts`
- Claim overlap:
  - Pairwise Jaccard similarity over statement-id sets, returning only pairs with jaccard > 0
  - Sorted descending by Jaccard
  - Source: `computeClaimOverlap` in `src/ConciergeService/claimProvenance.ts`

No thresholds are applied in these three functions; thresholds appear later (Stage 5) when overlap/exclusivity are used for gating.

---

## Stage 4 — Structural Analysis (graph-structural metrics over claims)

Entry: `computeStructuralAnalysis(artifact)` in `src/core/structural-analysis/engine.ts`.

### Measurement 4.1 — Landscape metrics

`computeLandscapeMetrics(artifact)` derives:

- `claimCount`
- `modelCount`:
  - Prefer `artifact.meta.modelCount` if present and > 0
  - Else derive from unique supporter model indices observed
- `convergenceRatio`:
  - Define `topThreshold = getTopNCount(claims.length, 0.3)`
  - Define `topSupportLevel = sortedBySupport[topThreshold - 1].supporters.length`
  - `convergentClaims = claims where supporters.length >= topSupportLevel`
  - `convergenceRatio = convergentClaims.length / claims.length` (0 if no claims)

Percentile policy: top ~30% by support (via `getTopNCount`).

Source: `src/core/structural-analysis/metrics.ts`

### Measurement 4.2 — Deterministic role override (applyComputedRoles)

`applyComputedRoles(...)` overwrites mapper roles based on graph structure:

- Consensus designation: `supportRatio >= 0.5`
- Challenger role:
  - For each conflict edge where exactly one side is consensus, the non-consensus claim becomes a challenger of the consensus claim
  - If multiple conflict targets exist, challenger chooses the highest-support target
- Branch role:
  - Any claim id in `conditionals[].affectedClaims`
  - Plus any claim that is the `to` of a prerequisite edge from a conditional claim
- Anchor role:
  - `anchorScore = prereqOut*2 + supportIn*1 + conflictTargets*1.5 + dependentsArePrereqs*1.5`
  - Anchor if `anchorScore >= 2`
- Supplement role: everything else

Thresholds: consensus `0.5`; anchor score `>= 2`; weights as above.

Source: `src/core/structural-analysis/engine.ts`

### Measurement 4.3 — Per-claim leverage score (computeClaimRatios)

`computeClaimRatios(claim, edges, modelCount)` computes:

- `supportRatio = supporters.length / modelCount`
- `supportWeight = supportRatio * 2`
- `roleWeight`:
  - `challenger: 4`, `anchor: 2`, `branch: 1`, `supplement: 0.5`
- `connectivityWeight`:
  - `prereqOut = (# outgoing prerequisite edges) * 2`
  - `prereqIn = (# incoming prerequisite edges)`
  - `conflictEdges = (# conflict edges incident to claim) * 1.5`
  - `degreeTerm = (incoming.length + outgoing.length) * 0.25`
  - `connectivityWeight = prereqOut + prereqIn + conflictEdges + degreeTerm`
- `positionWeight = 2` if chain root (`no incoming prerequisite` and `has outgoing prerequisite`), else `0`
- `leverage = supportWeight + roleWeight + connectivityWeight + positionWeight`

Also computed:

- `keystoneScore = outDegree * supporters.length`
- `supportSkew = maxSupportFromOneModel / supporters.length`

Weights are per-implementation constants, not data-calibrated.

Source: `src/core/structural-analysis/metrics.ts`

### Measurement 4.4 — Percentile flags (assignPercentileFlags)

Derived boolean flags depend on fixed percentiles:

- `isHighSupport`: membership in top ~30% by support (precomputed in engine)
- `isLeverageInversion`: bottom 30% support AND top 25% leverage
- `isKeystone`:
  - candidate: top 20% keystoneScore AND `outDegree >= 2`
  - then must pass `isHubLoadBearing(claim.id, edges)`
- `isEvidenceGap`: top 20% evidenceGapScore AND `evidenceGapScore > 0`
- `isOutlier`: top 20% supportSkew AND `supporters.length >= 2`

These flags are per-run relative: they depend on the distribution within the current artifact.

Source: `src/core/structural-analysis/metrics.ts`

### Measurement 4.5 — Graph analysis + articulation points

`analyzeGraph(...)` computes:

- connected components over undirected adjacency
- longest chain through prerequisite edges
- articulation points (Tarjan algorithm) over undirected adjacency
- hub claim:
  - compute outDegree over `supports` + `prerequisite` edges
  - define `hubDominance = topOut / secondOut` (or `10` if secondOut=0 and topOut>0)
  - `hubClaim = topId` iff `hubDominance >= 1.5` and `topOut >= 2`

Source: `src/core/structural-analysis/graph.ts`

### Measurement 4.6 — Cascade risk (dependency blast)

`detectCascadeRisks` (prerequisite graph traversal) produces, per prerequisite source claim:

- `dependentIds`: transitive dependents via prerequisite edges
- `depth`: maximum DFS depth along prerequisite edges

Source: `src/core/structural-analysis/patterns.ts`

---

## Stage 5 — Blast Radius Filter (survey gating)

Entry: `computeBlastRadiusFilter(input)` in `src/core/blast-radius/blastRadiusFilter.ts`.

This composes five normalized components into a single `composite` per claim, applies continuous modifiers, applies a single floor threshold, clusters surviving claims into axes, then chooses a question ceiling (0–3).

### Measurement 5.1 — Component scores per claim

For each claim:

- Cascade breadth:
  - `cascadeBreadth = dependentIds.length / (totalClaims - 1)` (clamped to 1)
- Exclusive evidence:
  - `exclusiveEvidence = exclusivity.get(claimId)?.exclusivityRatio ?? 0`
- Leverage (normalized within the run):
  - `normalizedLeverage = (leverage - minLev) / (maxLev - minLev)` else `0.5` if range is 0
- Query relevance (mean over claim source statements):
  - Default `0.5` if no scores available
  - Else mean of `queryRelevanceScores.get(statementId).querySimilarity`
- Articulation point:
  - `1` if claim id is in `articulationPoints`, else `0`

### Measurement 5.2 — Weighted composite

Weights:

- `W_CASCADE = 0.30`
- `W_EXCLUSIVE = 0.25`
- `W_LEVERAGE = 0.20`
- `W_QUERY = 0.15`
- `W_ARTICULATION = 0.10`

Composite:

`composite = 0.30*cascadeBreadth + 0.25*exclusiveEvidence + 0.20*normalizedLeverage + 0.15*queryRel + 0.10*isArticulation`

Source: `src/core/blast-radius/blastRadiusFilter.ts`

### Measurement 5.3 — Continuous modifiers (no categorical kills)

Applied in this order:

1. Consensus discount:
   - `discountStrength = 0.50 * min(modelCount / 4, 1.0)`
   - Multiply: `composite *= (1 - supportRatio * discountStrength)`
2. Sole-source off-topic discount:
   - If `supporters.length === 1` and `queryRel < 0.30`, multiply `composite *= 0.50`
3. Redundancy discount (pairwise overlap entries sorted by jaccard desc):
   - For each overlap entry with `jaccard > 0.50`:
     - Find lower-scoring claim (loser)
     - Multiply: `loser.composite *= (1 - jaccard * 0.40)`
4. Floor threshold (only binary gate):
   - Suppress if `composite < 0.20`

Source: `src/core/blast-radius/blastRadiusFilter.ts`

### Measurement 5.4 — Axes (claim clustering)

Single-linkage clustering: surviving claims are grouped into one axis if their provenance overlap has `jaccard > 0.30`.

Each axis:

- `claimIds`: connected component under the jaccard adjacency
- `representativeClaimId`: member with max `composite`
- `maxBlastRadius`: that max score

Source: `src/core/blast-radius/blastRadiusFilter.ts`

### Measurement 5.5 — Zero-question gate + ceiling

Zero-question skip happens only if all conditions hold:

- `convergenceRatio > 0.70`
- no `isLeverageInversion` claims
- no “sole source high blast radius” claim:
  - exists claim with `supporters.length === 1` and `composite > 0.50` and not suppressed
- `conflictEdgeCount === 0`

If skip triggers: `questionCeiling = 0`, `skipSurvey = true`.

Otherwise ceiling:

- If no conflicts and there is a sole-source outlier (`supporters.length === 1` and (`isLeverageInversion` or `isKeystone`)): ceiling is 1
- Else if no conflicts: ceiling is min(2, axisCount)
- Else count connected components in the conflict subgraph:
  - `clusterCount <= 2` => ceiling min(2, axisCount)
  - else ceiling min(3, axisCount)

Source: `src/core/blast-radius/blastRadiusFilter.ts`

---

## Stage 6 — Skeletonization (statement triage for pruned claims)

Entry: `triageStatements(input, thresholds?)` in `src/skeletonization/TriageEngine.ts`.

### Measurement 6.1 — Protected set

Statements are protected if they are sourced by surviving claims:

- `protectedStatementIds = union of survivingClaims[].sourceStatementIds`

Source: `src/skeletonization/TriageEngine.ts`

### Measurement 6.2 — Claim centroids (for pruned claims)

For each pruned claim:

- Gather embeddings for its `sourceStatementIds`
- Compute mean vector
- Normalize to unit length
- Store in `claimEmbeddings` as the claim centroid

Source: `src/skeletonization/TriageEngine.ts`

### Measurement 6.3 — Paragraph-first candidate narrowing

If `paragraphEmbeddings` exists and claim centroid exists:

- Candidate paragraph if `cosineSimilarity(paragraphEmbedding, claimCentroid) > 0.45`
- Candidate statements = union of those paragraphs’ statement ids

Threshold: `0.45`

Source: `src/skeletonization/TriageEngine.ts`

### Measurement 6.4 — Relevance gate for pruning targets

For each pruned claim source statement id:

- `relevance = cosineSimilarity(sourceEmbedding, claimCentroid)`
- If `relevance < 0.55`, action becomes `PROTECTED`

Threshold: `relevanceMin = 0.55`

Source: `src/skeletonization/TriageEngine.ts`

### Measurement 6.5 — Carrier detection + removal policy

Carrier search (for a given pruned claim and a given pruning-target statement):

- For each candidate statement (excluding protected and the source itself):
  - `claimSimilarity = cosineSimilarity(candidateEmbedding, claimCentroid)`
  - Require `claimSimilarity >= 0.6`
  - `sourceSimilarity = cosineSimilarity(candidateEmbedding, sourceEmbedding)`
  - Require `sourceSimilarity >= 0.6`

Defaults:

- `claimSimilarity: 0.6`
- `sourceSimilarity: 0.6`

Source: `src/skeletonization/types.ts`, `src/skeletonization/CarrierDetector.ts`

Removal policy:

- If carriers exist:
  - Carriers are marked `SKELETONIZE` (subject to an additional relevance check against the same 0.55 minimum)
  - The original source statement is marked:
    - `REMOVE` only if `carrierCount >= 2`
    - else `SKELETONIZE`
- If no carriers exist:
  - Source statement is `SKELETONIZE` as sole carrier

Threshold: carrier count `>= 2` for `REMOVE`.

Source: `src/skeletonization/TriageEngine.ts`

### Measurement 6.6 — Cross-model paraphrase detection

For every pruning target statement (those marked `REMOVE` or `SKELETONIZE`):

- Find paraphrases across remaining untriaged statements:
  - `similarity = cosineSimilarity(targetEmbedding, candidateEmbedding)`
  - If `similarity >= 0.85`, classify candidate as a paraphrase
- Then apply a relevance check against the triggering claim centroid (when available):
  - If `relevance < 0.55`, set paraphrase action to `PROTECTED`
  - Else set to `SKELETONIZE`

Thresholds:

- `paraphraseThreshold = 0.85`
- `relevanceMin = 0.55`

Source: `src/skeletonization/TriageEngine.ts`

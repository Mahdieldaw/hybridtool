# provenance — file digest (5-phase orchestration)

---

## Architecture Overview

**5-Phase Pipeline (Collect-then-Construct):** The provenance module processes canonical statement assignment and claim routing through five sequential phases:

```
engine.ts (orchestrator)
         ↓
Phase 1 (measure)   — Canonical provenance, density profiles, ownership
         ↓
[Table-cell filter] — Prose-safe maps derived from Phase 1 output
         ↓
Phase 2 (validate)  — Conflict validation, allegiance-based refinement
Phase 3 (surface)   — Passage routing, blast surface assessment
Phase 4 (structure) — Global graph topology, cascade analysis
Phase 5 (classify)  — Statement classification (claimed, unclaimed)
```

**File Organization:**

- `engine.ts` — **Orchestrator:** Threads all 5 phases in strict sequence; wired into `deterministicPipeline.js` via `buildProvenancePipeline()`
- `measure.ts` — **Phase 1:** Embeddings, similarity matrix, competitive assignment, mixed-method merge, ownership, statement-level passage detection, density profiles
- `validate.ts` — **Phase 2:** Conflict validation (triangle residual primary, cross-pool proximity fallback), provenance refinement (3-tier allegiance)
- `surface.ts` — **Phase 3:** Passage routing (L1 on density), blast surface (twin map, risk vectors, deletion certainty sub-typing)
- `structure.ts` — **Phase 4:** Graph analysis (components, chains, convergence, tradeoff pairs, cascade risks)
- `classify.ts` — **Phase 5:** Statement classification (claimed/unclaimed grouping; strict ownershipMap)
- `semantic-mapper.ts` — **Parallel L3:** LLM cross-read synthesis (independent of deterministic path; v5 cross-read reframe)

**Invariant:** Collect-then-Construct discipline: Phase 1 fully builds canonical structures before any downstream phase reads them. All metrics (routing, density, risk) derive from finalized sourceStatementIds.

---

## engine.ts

Provenance pipeline orchestrator. Threads all 5 phases in strict sequence.

**`buildProvenancePipeline(input): Promise<ProvenancePipelineOutput>`**

Wired into `deterministicPipeline.js`.

Input: `ProvenancePipelineInput` — mapper claims, enriched claims, edges, statements, paragraphs, embeddings, regions, periphery, query context, totalCorpusStatements.

**Execution:**

1. **Phase 1 (measure)** → `measureProvenance(...)` — builds canonical structures, ownership, density
2. **[Table-cell filter]** — strips `isTableCell` statements from all structures that feed Phases 2–5. Produces prose-safe variants: `safeStatementIds`, `measurementSafeStatements`, `measurementSafeParagraphs`, `safeOwnershipMap`, `safeCanonicalSets`, `safeExclusiveIds`, `safeExclusivityMap`, `safeCanonicalStatementIds`. Table cells remain attached to `enrichedClaims` for editorial/synthesizer consumers but are invisible to the L1 surface pipeline.
3. **Phase 2 (validate)** → `validateEdgesAndAllegiance(...)` — receives prose-safe maps; conflicts, allegiance
4. **Phase 3 (surface)** → `computeTopologicalSurface(...)` — receives prose-safe maps; routing, blast surface
5. **Phase 4 (structure)** → `runStructurePhase(...)` — graph topology, cascade risks
6. **Phase 5 (classify)** → `computeStatementClassification(...)` — receives prose-safe maps; statement classification

**`claimsForDownstream` note:** Engine uses `const claimsForDownstream = enrichedClaims` (the input enrichedClaims, already enriched with table cells). Downstream phases receive the input enriched claims directly.

**Output split:** `claimProvenance` in the output returns the *full* `measure.ownershipMap` and `measure.canonicalSets` (including table cells). Everything else (`passageRoutingResult`, `blastSurfaceResult`, `statementClassification`) derives from the prose-safe variants.

Output: `ProvenancePipelineOutput`:
- `enrichedClaims` — downstream claims (input enrichedClaims, includes table-cell attachments)
- `mixedProvenanceResult` — from Phase 1
- `claimProvenance` — `{ ownershipMap, exclusivityMap, canonicalSets, exclusiveIds }` (full, not filtered)
- `claimDensityResult`, `claimEmbeddings`
- `validatedConflicts`, `provenanceRefinement` — from Phase 2
- `passageRoutingResult`, `blastSurfaceResult` — from Phase 3
- `structuralAnalysis` — from Phase 4
- `statementClassification` — from Phase 5

---

## measure.ts

**Phase 1 — Canonical Provenance, Ownership, Density**

Unified single-pass construction of canonical structures. Foundational maps built once and shared across all downstream phases.

**`measureProvenance(input): Promise<MeasurePhaseOutput>`**

**Pipeline:**

1. **Embeddings** — generates claim centroids (pooled/mean of source statement embeddings, or accepts `precomputedClaimEmbeddings`)
2. **Similarity matrix** — C×N matrix of cosine similarities (claim centroids × paragraphs)
3. **Competitive assignment** — each paragraph assigns to claims above its affinity threshold
   - Gate: N = 2 claims uses μ; N ≥ 3 uses μ+σ
   - Degenerate guards: single-claim empty pool → assign all paragraphs; all pools empty (identical centroids) → uniform assignment across all claims
   - Produces: claimPools, normalizedWeights, rawExcess
4. **Mixed-method merge** — per-claim union of competitive + claim-centric pools
   - Competitive pool: from step 3
   - Claim-centric pool: paragraphs > claim-specific μ+σ
   - Global preservation floor: statements ≥ μ across all statement embeddings
   - Produces: canonical `sourceStatementIds` (zone='core')
5. **Ownership accumulation** — inverse index: statement → Set\<claimId\>
6. **Exclusivity classification** — per-claim ratio of exclusive vs shared statements
7. **Density profiling** — two passage representations per claim:
   - **`statementPassages` (primary):** Full-sequence scan per model in paragraph order. Walks all statements, detects *contiguous canonical runs* (no non-canonical gap permitted). A run of < 2 canonical statements is discarded as an isolated mention. Each run produces a `StatementPassageEntry` with `statementIds`, `statementLength`, paragraph index range, and `avgCoverage`. `maxPassageLength` and `meanCoverageInLongestRun` derive from these runs.
   - **`passages` (legacy, deprecated):** Paragraph-level consecutive-majority-paragraph runs (coverage > 0.5, non-peripheral). Kept for backward compatibility with validate.ts, classify.ts, and editorial-mapper.ts consumers until they migrate to `statementPassages`.

**New output field:** `canonicalStatementIds: Map<string, string[]>` — ordered array of canonical statement IDs per claim. Distinct from `canonicalSets` (which is a `Set<string>`). Both are included in `MeasurePhaseOutput` and passed downstream by engine.ts as `safeCanonicalStatementIds` after the table-cell filter.

Output: `MeasurePhaseOutput` — enrichedClaims, mixedProvenance, ownershipMap, claimDensity, claimEmbeddings, canonicalSets, canonicalStatementIds, exclusiveIds, competitiveWeights, competitiveExcess, competitiveThresholds.

**Invariant:** All canonical statement IDs finalized before Phase 2 touches them.

---

## validate.ts

**Phase 2 — Conflict Validation, Allegiance-Based Refinement**

Validates mapper-labeled conflict edges using geometry. Disambiguates jointly-owned statements via 3-tier allegiance.

**`validateEdgesAndAllegiance(input): ValidateOutput`**

**Subpipeline A: Conflict Validation (two-tier system)**

Two-pass over all claim pairs (i, j):

Pass 1 — Collect metrics:
1. **Exclusive statement check** — exclA = A's canonical set minus B's, vice versa
2. **Gate** — require exclA.length ≥ 2 AND exclB.length ≥ 2; abort if embeddings missing
3. **Cross-pool proximity** (old system) — for each exclusive statement in A, find max cosine similarity to any statement in B's full canonical pool. Average A→B and B→A; return min(meanAtoB, meanBtoA). Collected for corpus mean μProximity.
4. **Triangle residual** (new system, requires queryEmbedding) — `sim(A,Q) × sim(B,Q) − sim(A,B)` on claim centroids. Positive residual means the claims diverge more than their shared query relevance predicts. Collected for corpus mean μResidual.

Pass 2 — Threshold:
- **Primary (triangle residual):** If queryEmbedding is available and μResidual is computable, validate when `residual > μResidual` (dynamic threshold = mean of all corpus residuals).
- **Fallback (cross-pool proximity):** Used only when triangle residual is unavailable. Validate when `proximity > μProximity`. This confirms the pair is arguing about the same localized topic.

`ValidatedConflict` now carries: `triangleResidual`, `centroidSim` (simAB), `muTriangle`, `querySimPair` in addition to the existing cross-pool fields.

Output: `ValidatedConflict[]` — each pair with proximity, triangle residual, fail reason, validation flag.

**Subpipeline B: Provenance Refinement**

For each jointly-owned statement (statement ∈ multiple claims' canonical sets):
1. **Find dominant claim** — highest coverage of statement's paragraph
2. **3-Tier Allegiance:**
   - **Tier 1 (Calibrated)** — if ≥2 exclusive statements in dominant claim: compute weighted allegiance via calibration pool similarities vs subject statement profile
   - **Tier 2 (Centroid Fallback)** — if <2 exclusive: rank assigned claims by cosine similarity to statement; pick highest
   - **Tier 3 (Passage Fallback)** — if no embeddings: passage owner with max coverage in this paragraph; passage membership now built from `statementPassages` (not legacy `passages`)
3. **Instrumentation signals** — passage dominance (coverage fraction), signal strength (word count)

Output: `ProvenanceRefinementResult` — primaryClaim per joint statement, method histogram, timing.

---

## surface.ts

**Phase 3 — Passage Routing, Blast Surface Assessment**

Passage-routing-driven claim selection + speculative damage assessment for pruned claims.

**`computeTopologicalSurface(input): SurfaceOutput`**

Input: enrichedClaims, claimDensityResult, validatedConflicts, modelCount, periphery, statementEmbeddings, canonicalSets, exclusiveIds, shadowParagraphs.

**Subpipeline A: Passage Routing**

Pure L1 arithmetic on ClaimDensityResult fields:

1. **Structural contributors** — per-claim, per-model: contributors have ≥1 majority paragraph (coverage > 0.5)
2. **Dominant model** — highest majority paragraph count among contributors
3. **Concentration ratio** — dominantMAJ / totalMAJ (core paragraphs only)
4. **Density ratio** — maxPassageLength of dominant / dominantMAJ
5. **Load-bearing gates** (precondition: totalMAJ ≥ 1):
   - Gate A: concentrationRatio ≥ μ+σ
   - Gate B: maxPassageLength ≥ 2
6. **Landscape:** northStar (A+B), eastStar (A only), mechanism (B only), floor (neither)
7. **Conflict clusters:** connected components from validated + mapper edges
8. **Routing assembly:** clusters → load-bearing → passthrough
9. **Optional `basinAnnotations`:** attached to result when computed

**Subpipeline B: Blast Surface**

*Twin map* (`computeTwinMap`): reciprocal best-match for each canonical statement.
- Threshold τ_S = μ + 2σ of per-statement similarity distribution
- Forward pass: find best candidate above τ_S; backward pass: confirm reciprocal maps back to origin statement
- Twin = null if either pass fails or no embedding available

*Type classification per exclusive statement:*
- Type 1 (shared): owned by multiple claims
- Type 2 (deletion): exclusive + twin exists (orphaning risk)
- Type 3 (degradation): exclusive + no twin (lost semantics)

**Deletion certainty sub-typing (new):**
- `2a` (unconditional): twin is unclassified (not owned by any claim)
- `2b` (conditional): twin has multiple claim owners
- `2c` (fragile): twin has a single claim owner

**Degradation damage reframe (new):** `degradationDamage` in the risk vector is now computed over *all* canonical statements (not just Type 3 orphans). This makes it a per-claim referential density signal applicable to any statement subset. `degradationDetails` covers the full canonical set; the old orphan-only `degradationDetails` array is replaced by `allDegradationDetails`.

*Risk vector* per claim: deletion count/damage, degradation count (Type 3 orphans), cascade fragility (μ and σ), simplex [type1/K, type2/K, type3/K], totalDegradationDamage, deletionCertainty counts (unconditional/conditional/fragile).

*Speculative mixed-parent:* PROTECTED / REMOVE / SKELETONIZE fate per shared statement.

**`computeNounSurvivalRatio(text): number`** — exported. Strips non-noun POS tags via compromise NLP; returns surviving token count / total word count. Used to quantify semantic density loss.

**`buildSourceContinuityMap(claimDensity): Map<string, SourceContinuityEntry>`** — new export. Builds a per-passage linked list (prevPassageKey / nextPassageKey) sorted by paragraph order within each model. Consumed by editorial-mapper and step-executor.

Output: `SurfaceOutput`:
- `passageRoutingResult`: routedClaimIds, landscape positions, cluster map, basin annotations (optional), diagnostics
- `blastSurfaceResult`: per-claim scores (with deletion certainty), twin map, speculative fates, diagnostics

---

## structure.ts

**Phase 4 — Global Graph Topology, Cascade Analysis**

No changes since last digest.

**`analyzeGlobalStructure` (alias: `runStructurePhase`, `computeStructuralAnalysis`)**

Input: claims, edges, modelCount.

- **Connected components** (union-find on claim graph)
- **Hub detection** (out-degree z-score: topOut > μ+σ → hubClaim)
- **Articulation points** (Tarjan's DFS — graph-critical nodes)
- **Prerequisite chains** (longest paths through prereq edges)
- **Convergence detection** (N claims → common successor via support/prereq edges)
- **Tradeoff pairs** (bidirectional conflicts with structural balance; symmetry: both_consensus | both_singular | asymmetric)
- **Cascade risks** (BFS over prereq children; depth + full dependent set)
- **Iterative layer detection** (peel causal claims each round; `detectShape()` per layer)
  - Primary shapes: forked | constrained | convergent | sparse
  - Secondary patterns: keystone, chain, fragile, challenged, conditional

Output: `StructurePhaseOutput`:
- `claimsWithLeverage`: enrichedClaims with inDegree, outDegree, isChainRoot, isChainTerminal, isIsolated, isContested, isConditional, isOutlier, chainDepth, isSalient, isKeystone, hubDominance
- `graph`: GraphAnalysis (componentCount, components, longestChain, chainCount, hubClaim, articulationPoints)
- `patterns`: conflicts, conflictInfos, tradeoffs, convergencePoints, cascadeRisks, isolatedClaims
- `layers`: StructureLayer[] (primary shape + secondary patterns per layer)
- `shape`: ProblemStructure (dominant layer primary + all secondary patterns)

---

## classify.ts

**Phase 5 — Statement Classification**

**`computeStatementClassification(input): StatementClassificationResult`**

Input: shadowStatements, shadowParagraphs, enrichedClaims, claimDensityResult, passageRoutingResult, paragraphEmbeddings, claimEmbeddings, queryRelevanceScores, ownershipMap (required, from Phase 1), canonicalStatementIds (from Phase 1 via engine.ts).

**`ownershipMap` is strictly required.** No fallback computation. The defensive `statementOwnership ?? computeStatementOwnership(...)` path from the pre-pipeline version has been removed.

Steps:
1. **Claimed set** — reads directly from `ownershipMap` (no reconstruction)
2. **Passage membership** — stmtId → "claimId:modelIndex:startParagraphIndex" from ClaimDensityResult profiles
3. **Claimed entries** — `{ claimIds, inPassage, passageKey }` per stmtId
4. **Paragraph categorization** — for each ShadowParagraph: fullyCovered (all claimed) | fullyUnclaimed | mixed (both)
5. **Per-paragraph claim similarities** — cosine similarity of paragraph embedding to each claim embedding; select bestClaimId
6. **Group by nearestClaimId** → UnclaimedGroup per claim; attach meanClaimSimilarity, meanQueryRelevance, maxQueryRelevance, nearestClaimLandscapePosition (from passage routing)

Output: `StatementClassificationResult`:
- `claimed`: Record\<stmtId, { claimIds, inPassage, passageKey }\>
- `unclaimedGroups`: UnclaimedGroup[] (with nearestClaimId, nearestClaimLandscapePosition, per-paragraph details, query relevance stats)
- `summary`: totalStatements, claimedCount, unclaimedCount, mixedParagraphCount, fullyUnclaimedParagraphCount, fullyCoveredParagraphCount, unclaimedGroupCount
- `meta`: processingTimeMs

---

## semantic-mapper.ts

**Parallel L3 — LLM Cross-Read Synthesis**

Independent of the deterministic pipeline. Feeds `enrichedClaims` and `edges` inputs before Phase 1.

**v5: Cross-Read Reframe**

The prompt no longer asks the model to answer the query or improve individual responses. It positions the LLM as the first reader to hold all model responses simultaneously. Claims are relational rather than positional: they must represent convergence, tension, or singular voice — things only visible from reading across responses, not within any single one.

**`buildSemanticMapperPrompt(userQuery, responses): string`**

Assembles model outputs as `[Model N]\n{text}` blocks separated by `---`. Instructs the LLM to:
- Read everything before marking anything
- Output a `<narrative>` in flowing prose: shared ground → tensions → singular voices → uncovered terrain. Weave canonical markers `[Label|claim_id]` and citations inline. Close with "This naturally leads to questions about..." naming unresolved tensions.
- Output a `<map>` in valid JSON with `claims` and `edges` arrays. Claim labels are two-word noun phrases. Edges carry `supports | conflicts | tradeoff | prerequisite` types.

**`parseSemanticMapperOutput(rawResponse): ParseResult`**

- Normalizes escaped tag delimiters
- Extracts `<map>` and `<narrative>` via regex; falls back to full-text JSON extraction if tags are malformed or unclosed
- Validates the parsed object has `claims[]` and `edges[]`; coerces missing `edges` to `[]`
- Returns `{ success, output: UnifiedMapperOutput, narrative, errors, warnings }`

---

## Data Flow (updated)

```
[INPUT]
         ├─ mapperClaims, enrichedClaims (with table cells)
         ├─ edges (from semantic-mapper L3)
         ├─ shadowStatements, shadowParagraphs
         ├─ paragraphEmbeddings, statementEmbeddings
         ├─ regions, periphery, queryEmbedding
         └─ queryRelevanceScores, totalCorpusStatements
         ↓
[PHASE 1: MEASURE] — measureProvenance()
         ├─ Claim embeddings (precomputed or generated from label+text)
         ├─ C×N similarity matrix (claim centroids × paragraphs)
         ├─ Competitive assignment: μ threshold (N=2) or μ+σ (N≥3)
         │   └─ Degenerate guards: single-claim empty pool; all pools empty
         ├─ Mixed-method merge: competitive ∪ claim-centric ∪ global floor
         │   └─ Canonical sourceStatementIds (zone='core') per claim
         ├─ Ownership: stmtId → Set<claimId>
         ├─ Exclusivity: per-claim exclusive vs shared statement ratio
         └─ Density profiling per claim:
             ├─ statementPassages (primary): contiguous canonical runs ≥2 stmts per model
             │   ├─ Full model-order sequence scan
             │   ├─ Non-canonical gap breaks the run
             │   └─ Produces: statementIds, statementLength, avgCoverage, paragraph range
             └─ passages (legacy, deprecated): paragraph-level majority runs
         ↓
[Output: MeasurePhaseOutput]
         ├─ enrichedClaims (with canonical sourceStatementIds)
         ├─ ownershipMap, canonicalSets, canonicalStatementIds, exclusiveIds
         ├─ claimDensity (ClaimDensityResult — profiles per claim)
         └─ claimEmbeddings, competitiveWeights, competitiveThresholds
         ↓
[TABLE-CELL FILTER] — inline in engine.ts
         ├─ safeStatementIds: all stmts where isTableCell = false
         ├─ measurementSafeStatements: shadowStatements filtered to prose only
         ├─ measurementSafeParagraphs: shadowParagraphs with table-cell stmt IDs removed
         │   └─ Paragraphs that become empty after filtering are dropped
         ├─ safeOwnershipMap: ownershipMap filtered to safeStatementIds
         ├─ safeCanonicalSets: canonicalSets filtered to safeStatementIds
         ├─ safeExclusiveIds: exclusiveIds filtered to safeStatementIds
         └─ safeCanonicalStatementIds: canonicalStatementIds filtered to safeStatementIds
         ↓
[PHASE 2: VALIDATE] — validateEdgesAndAllegiance()
         ├─ Conflict Validation (two-tier, two-pass)
         │   ├─ Pass 1 — collect per-pair metrics:
         │   │   ├─ Exclusive statement gate: exclA ≥ 2 AND exclB ≥ 2
         │   │   ├─ Cross-pool proximity: max sim of each excl-A stmt to any B stmt
         │   │   │   └─ min(mean(A→B), mean(B→A)) → crossPoolProximity
         │   │   └─ Triangle residual: sim(A,Q)×sim(B,Q) − sim(A,B) (requires queryEmbedding)
         │   └─ Pass 2 — threshold:
         │       ├─ PRIMARY (triangle residual): residual > μResidual → validated
         │       └─ FALLBACK (cross-pool proximity): proximity > μProximity → validated
         └─ Provenance Refinement (jointly-owned statements only)
             ├─ Tier 1 (Calibrated): calibration pool ≥ 2 exclusive stmts in dominant claim
             │   └─ Weighted allegiance → primary = dominant or strongest rival
             ├─ Tier 2 (Centroid Fallback): calibration pool < 2
             │   └─ Rank assigned claims by cosine sim to subject statement; pick highest
             └─ Tier 3 (Passage Fallback): no embeddings
                 └─ Pick passage owner with max coverage; membership built from statementPassages
         ↓
[Output: ValidateOutput]
         ├─ validatedConflicts: ValidatedConflict[] (proximity, triangle residual, fail reason)
         └─ provenanceRefinement: primaryClaim per joint statement, method histogram
         ↓
[PHASE 3: SURFACE] — computeTopologicalSurface()
         ├─ Passage Routing (L1 — arithmetic on density profiles only)
         │   ├─ Structural contributors: model has ≥1 majority paragraph (coverage > 0.5)
         │   ├─ Dominant model: highest majority paragraph count among contributors
         │   ├─ Concentration ratio: dominantMAJ / totalMAJ (core paragraphs only)
         │   ├─ Density ratio: maxPassageLength of dominant / dominantMAJ
         │   ├─ Load-bearing gates (precondition: totalMAJ ≥ 1):
         │   │   ├─ Gate A: concentrationRatio ≥ μ+σ
         │   │   └─ Gate B: maxPassageLength ≥ 2
         │   ├─ Landscape: northStar (A+B), eastStar (A only), mechanism (B only), floor (neither)
         │   ├─ Conflict clusters: connected components from validated + mapper edges
         │   ├─ Routing assembly: clusters → load-bearing → passthrough
         │   └─ Optional basinAnnotations
         └─ Blast Surface (twin map + risk vectors)
             ├─ Twin map: reciprocal best-match for each canonical statement
             │   ├─ Threshold τ_S = μ + 2σ of per-statement similarity distribution
             │   ├─ Forward pass: best candidate above τ_S
             │   ├─ Backward pass: confirm reciprocal maps back to origin
             │   └─ Twin = null if either pass fails
             ├─ Type classification per exclusive statement:
             │   ├─ Type 1 (shared): owned by multiple claims
             │   ├─ Type 2 (deletion): exclusive + twin exists (orphaning risk)
             │   │   └─ Sub-types: 2a (twin unclassified), 2b (twin multi-owned), 2c (twin single-owned)
             │   └─ Type 3 (degradation): exclusive + no twin (lost semantics)
             ├─ Risk vector: deletion count/damage, orphan count, cascade fragility (μ, σ)
             │   ├─ degradationDamage: computed over ALL canonical stmts (not just orphans)
             │   └─ deletionCertainty: { unconditional(2a), conditional(2b), fragile(2c) }
             └─ Speculative mixed-parent: PROTECTED / REMOVE / SKELETONIZE fate per shared stmt
         ↓
[Output: SurfaceOutput]
         ├─ passageRoutingResult: routedClaimIds, landscape positions, cluster map, diagnostics
         └─ blastSurfaceResult: per-claim scores, twin map, deletion certainty, speculative fates
         ↓
[PHASE 4: STRUCTURE] — analyzeGlobalStructure() [alias: runStructurePhase]
         ├─ Connected components (union-find on claim graph)
         ├─ Hub detection (out-degree z-score: topOut > μ+σ → hubClaim)
         ├─ Articulation points (Tarjan's DFS — graph-critical nodes)
         ├─ Prerequisite chains (longest paths through prereq edges)
         ├─ Convergence detection (N claims → common successor)
         ├─ Tradeoff pairs (bidirectional conflicts with structural balance)
         ├─ Cascade risks (fragile convergence points, high in-degree prereq nodes)
         └─ Iterative layer detection (peel salient claims each round)
             ├─ detectShape() per layer → primary: forked | constrained | convergent | sparse
             └─ Secondary patterns: keystone, chain, fragile, challenged, conditional
         ↓
[Output: StructurePhaseOutput]
         ├─ claimsWithLeverage (enrichedClaims with topology flags)
         ├─ graph: GraphAnalysis, hubClaim, articulationPoints: string[]
         ├─ conflicts, conflictInfos, tradeoffs, convergencePoints
         └─ cascadeRisks, layers: StructureLayer[]
         ↓
[PHASE 5: CLASSIFY] — computeStatementClassification()
         ├─ Claimed set: read directly from ownershipMap (required, no fallback)
         ├─ passageMembership map: stmtId → "claimId:modelIndex:startParagraphIndex"
         ├─ Paragraph categorization: fullyCovered | fullyUnclaimed | mixed
         ├─ Claimed statements: { claimIds, inPassage, passageKey } per stmtId
         └─ Unclaimed paragraphs: cosine sim to claim embeddings → bestClaimId
             ├─ Grouped by nearestClaimId → UnclaimedGroup
             └─ Attaches nearestClaimLandscapePosition from passage routing
         ↓
[Output: StatementClassificationResult]
         ├─ claimed: Record<stmtId, { claimIds, inPassage, passageKey }>
         ├─ unclaimedGroups: UnclaimedGroup[] (with nearestClaimId, nearestClaimLandscapePosition)
         └─ summary (counts), meta (processingTimeMs)
```

**Parallel (Independent L3):**

- **semantic-mapper** → LLM cross-read (v5 reframe) → claims + edges (feeds enrichedClaims + edges inputs before Phase 1)

---

## Key Design Principles

- **Collect-then-Construct**: Phase 1 fully builds canonical structures before Phase 2 reads them; no feedback loops
- **Table-cell isolation**: Table cells stay attached to claims for editorial consumers but are stripped from all L1 surface structures (ownership, canonical sets, statements, paragraphs)
- **L1 purity**: Phases 1–3 use only embeddings, similarity distributions, set membership; no semantic context
- **Strict phase discipline**: Each phase reads only from previous output; no backward references
- **Statement-first passages**: `statementPassages` (contiguous canonical runs at statement resolution) is the primary passage structure; paragraph-level `passages` is deprecated legacy
- **Dual-system conflict validation**: Triangle residual (query-aware) is the primary conflict test when a query embedding is present; cross-pool proximity is the fallback
- **Degradation as density signal**: `degradationDamage` in the blast surface covers the full canonical set, not just orphans — usable as a per-claim referential density metric
- **Provenance-driven**: All metrics (density, routing, risk) derive from finalized sourceStatementIds (post Phase 1)
- **Twin map as canonical**: Phase 3 twin map is single source of truth for statement similarity; used for orphan classification and deletion certainty sub-typing

---

## Integration with Broader System

**Upstream (provides input):**
- Shadow extraction (`shadow/`) → statements, paragraphs
- Geometry layer (`geometry/`) → regions, periphery classification
- Clustering (`clustering/`) → embeddings
- Semantic mapper (`semantic-mapper.ts`) → mapper claims, edges

**Downstream (consumes output):**
- `StepExecutor.js` deterministic pipeline receives canonical claims, routing, graph topology
- Traversal assembly uses routing + structure
- Synthesis layer uses claims + edges + structure for narrative
- Editorial mapper and step-executor consume `buildSourceContinuityMap` output from surface.ts

---

## Entry Points

- **Full pipeline:** `buildProvenancePipeline(input)` (engine.ts) — wired into `deterministicPipeline.js`
- **Individual phases:** import directly from measure/validate/surface/structure/classify for fine-grained control
- **Surface utilities:** `buildSourceContinuityMap`, `computeNounSurvivalRatio` exported from surface.ts
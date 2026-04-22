# provenance — file digest (5-phase orchestration)

---

## Architecture Overview

**5-Phase Pipeline (Collect-then-Construct):** The provenance module processes canonical statement assignment and claim routing through five sequential phases:

```
engine.ts (orchestrator)
         ↓
Phase 1 (measure)   — Canonical provenance, density profiles, ownership
Phase 2 (validate)  — Conflict validation, allegiance-based refinement
Phase 3 (surface)   — Passage routing, blast surface assessment
Phase 4 (structure) — Global graph topology, cascade analysis
Phase 5 (classify)  — Statement classification (claimed, routed, unclassified)
```

**File Organization:**

- `engine.ts` — **Orchestrator:** Threads all 5 phases in strict sequence; wired into `deterministicPipeline.js` via `buildProvenancePipeline()`
- `measure.ts` — **Phase 1:** Embeddings, similarity matrix, competitive assignment, mixed-method merge, ownership, density profiles
- `validate.ts` — **Phase 2:** Conflict validation (cross-pool proximity), provenance refinement (3-tier allegiance)
- `surface.ts` — **Phase 3:** Passage routing (L1 on density), blast surface (twin map, risk vectors)
- `structure.ts` — **Phase 4:** Graph analysis (components, chains, convergence, tradeoff pairs, cascade risks)
- `classify.ts` — **Phase 5:** Statement classification (landscape routing, claimed/routed/unclassified)
- `semantic-mapper.ts` — **Parallel L3:** LLM cross-read synthesis (independent of deterministic path)
- `flow.md` — Documentation of phase semantics and epistemic boundaries

**Invariant:** Collect-then-Construct discipline: Phase 1 fully builds canonical structures before any downstream phase reads them. All metrics (routing, density, risk) derive from finalized sourceStatementIds.

---

## engine.ts

Provenance pipeline orchestrator. Threads all 5 phases in strict sequence.

**`buildProvenancePipeline(input): Promise<ProvenancePipelineOutput>`**

Wired into `deterministicPipeline.js` — both `StepExecutor.js` (live path) and `sw-entry.js` (REGENERATE_EMBEDDINGS path) call this function.

Input: `ProvenancePipelineInput` — mapper claims, enriched claims, edges, statements, paragraphs, embeddings, regions, periphery, query context, totalCorpusStatements.

**Execution:**

1. **Phase 1 (measure)** → `measureProvenance(...)` — builds canonical structures, ownership, density
2. **Phase 2 (validate)** → `validateEdgesAndAllegiance(...)` — conflicts, allegiance
3. **Phase 3 (surface)** → `computeTopologicalSurface(...)` — routing, blast surface
4. **Phase 4 (structure)** → `runStructurePhase(...)` — graph topology, cascade risks
5. **Phase 5 (classify)** → `computeStatementClassification(...)` — statement routing/classification

**`claimsForDownstream` note:** Engine uses `const claimsForDownstream = enrichedClaims` (the input enrichedClaims, already enriched with table cells). `measure.enrichedClaims` carries canonical `sourceStatementIds` for provenance consumers, but downstream phases receive the input enriched claims directly.

Output: `ProvenancePipelineOutput`:
- `enrichedClaims` — downstream claims (input enrichedClaims)
- `mixedProvenanceResult` — from Phase 1
- `claimProvenance` — nested object: `{ ownershipMap, exclusivityMap, canonicalSets, exclusiveIds }`
- `claimDensityResult`, `claimEmbeddings`
- `validatedConflicts`, `provenanceRefinement` — from Phase 2
- `passageRoutingResult`, `blastSurfaceResult` — from Phase 3
- `structuralAnalysis` — from Phase 4
- `statementClassification` — from Phase 5

**Design:** Collect-then-Construct invariant: each phase reads only from previous output; no feedback loops.

---

## measure.ts

**Phase 1 — Canonical Provenance, Ownership, Density**

Unified single-pass construction of canonical structures. Foundational maps built once and shared across all downstream phases.

**`measureProvenance(input): Promise<MeasurePhaseOutput>`**

**Pipeline:**

1. **Embeddings** — generates claim centroids (pooled/mean of source statement embeddings)
2. **Similarity matrix** — C×N matrix of cosine similarities (claims × paragraphs)
3. **Competitive assignment** — each paragraph assigns to claims above its affinity threshold (μ or μ+σ)
   - Gate: N ≥ 3 claims uses μ+σ; otherwise μ
   - Produces: claimPools, normalizedWeights, rawExcess
4. **Mixed-method merge** — per-claim union of competitive + claim-centric pools
   - Competitive pool: from step 3
   - Claim-centric pool: paragraphs > claim-specific μ+σ
   - Global preservation floor: statements ≥ μ across all statement embeddings
   - Produces: canonical sourceStatementIds (zone='core')
5. **Ownership accumulation** — inverse index: statement → Set<claimId>
6. **Exclusivity classification** — per-claim ratio of exclusive vs shared statements
7. **Density profiling** — per-claim passage detection, model spread, coverage metrics

Output: `MeasurePhaseOutput` — enrichedClaims, mixedProvenance, ownershipMap, claimDensity, claimEmbeddings, and supporting maps (competitiveWeights, exclusivityMap, canonicalSets).

**Invariant:** All canonical statement IDs finalized before Phase 2 touches them.

---

## validate.ts

**Phase 2 — Conflict Validation, Allegiance-Based Refinement**

Validates mapper-labeled conflict edges using geometry. Disambiguates jointly-owned statements via 3-tier allegiance.

**`validateEdgesAndAllegiance(input): ValidateOutput`**

**Subpipeline A: Conflict Validation**

For each claim pair (i, j):
1. **Exclusive statement check** — exclA = A's canonical set minus B's, vice versa
2. **Gate** — require exclA.length ≥ 2 AND exclB.length ≥ 2; abort if embeddings missing
3. **Cross-pool proximity** — for each exclusive statement, find max similarity to rival claim's full pool
   - Average A→B and B→A; return min(meanAtoB, meanBtoA)
4. **Triangle residual** (optional) — sim(A,Q) × sim(B,Q) − sim(A,B) using claim centroids + query embedding
5. **Threshold** — μProximity = mean of all valid cross-pool values; validate if proximity > μProximity

Output: `ValidatedConflict[]` — each pair with proximity, residuals, fail reason, certainty counts.

**Subpipeline B: Provenance Refinement**

For each jointly-owned statement (statement ∈ multiple claims' canonical sets):
1. **Find dominant claim** — highest coverage of statement's paragraph
2. **3-Tier Allegiance:**
   - **Tier 1 (Calibrated)** — if ≥2 exclusive statements in dominant claim: compute weighted allegiance via calibration pool similarities vs subject statement profile
   - **Tier 2 (Centroid Fallback)** — if <2 exclusive: rank assigned claims by cosine similarity; pick highest
   - **Tier 3 (Passage Fallback)** — if no embeddings: passage owner with max coverage in this paragraph
3. **Instrumentation signals** — passage dominance (coverage fraction), signal strength (word count)

Output: `ProvenanceRefinementResult` — primaryClaim per joint statement, method histogram, timing.

---

## surface.ts

**Phase 3 — Passage Routing, Blast Surface Assessment**

Passage-routing-driven claim selection + speculative damage assessment for pruned claims.

**`computeTopologicalSurface(input): SurfaceOutput`**

Input: enrichedClaims, claimDensityResult, validatedConflicts, modelCount, periphery, statementEmbeddings, canonicalSets, exclusiveIds.

**Subpipeline A: Passage Routing**

Pure L1 arithmetic on ClaimDensityResult fields:

1. **Structural contributors** — per-claim, per-model: contributors have ≥1 majority paragraph (coverage > 0.5)
2. **Dominant model** — claim's model with highest majority paragraph count
3. **Concentration ratio** — dominantMAJ / totalMAJ (core paragraphs only if peripheral filtering active)
4. **Density ratio** — maxPassageLengthOfDominant / dominantMAJ (contiguity in dominant model)
5. **Load-bearing gates** (precondition: totalMAJ ≥ 1):
   - **Gate A**: concentrationRatio ≥ μ+σ
   - **Gate B**: maxPassageLength ≥ 2
6. **Landscape positions**: northStar (both gates), eastStar (A only), mechanism (B only), floor (neither)
7. **Conflict clusters** — connected components from validated + mapper edges
8. **Routing assembly**:
   - All conflict cluster members (union of all clusters)
   - Load-bearing claims not in clusters (sorted by concentration ratio)
   - Passthrough: remaining non-load-bearing claims

Output: `PassageRoutingResult` — routedClaimIds, diagnostics, landscape positions, cluster map.

**Subpipeline B: Blast Surface**

Twin-map-based damage assessment for exclusive statements:

1. **Twin map** — reciprocal best-match for each canonical statement
   - Threshold: τ_S = μ + 2σ (similarity distribution across all candidate matches)
   - Forward/backward pass to confirm reciprocal best-match
2. **Per-claim risk classification**:
   - **Type 1 (shared)**: owned by multiple claims
   - **Type 2 (deletion)**: exclusive + twin exists (orphaning risk)
   - **Type 3 (degradation)**: exclusive + no twin (lost semantics)
3. **Risk vector** — deletion count/sum, degradation count, cascade fragility (1/(ownerCount−1) per shared statement)
4. **Speculative mixed-parent** (if shared statement's co-owners pruned) — twin points away (independent root) vs toward pruned claim (bystander)

Output: `BlastSurfaceResult` — per-claim scores, twin map, diagnostics, speculative fates.

---

## structure.ts

**Phase 4 — Global Graph Topology, Cascade Risk Analysis**

Analyzes claim-to-claim connectivity for structural patterns: convergences, tradeoffs, prerequisites, cascade risks.

**`analyzeGlobalStructure(input): StructurePhaseOutput`**

`runStructurePhase` is an alias: `export const runStructurePhase = analyzeGlobalStructure`.

Input: `{ claims, edges, modelCount? }` — claims cast to `Claim[]`.

**Pipeline:**

1. **Connected components** — union-find on claim graph (mapper edges + validated conflicts)
2. **Hub detection** — out-degree z-score: `hubClaim = sigma > 0 && topOut > mu + sigma ? topId : null`
3. **Articulation points** — Tarjan's DFS to find graph-critical nodes (removal would disconnect graph)
4. **Prerequisite chains** — longest paths through prerequisite edges
5. **Convergence detection** — N claims sharing same successor(s) (common conclusion point)
6. **Tradeoff pairs** — bidirectional conflicts with structural balance
7. **Cascade risks** — fragile convergence points (many incoming prerequisite edges, few outgoing)
8. **Iterative layer detection** — iterative: peel salient claims each round, call `detectShape()` per layer
   - `detectShape()` returns `StructureLayer.primary`: `'forked' | 'constrained' | 'convergent' | 'sparse'`
   - Secondary patterns detected per layer: `keystone`, `chain`, `fragile`, `challenged`, `conditional`

**Structural Taxonomy:**

- `ConflictInfo` — edge type (conflict | tradeoff), bidirectional signal
- `TradeoffPair` — [A, B] with assertion count on both sides
- `ConvergencePoint` — claim(s) serving as common conclusion
- `CascadeRisk` — prerequisite convergence with fragility metric
- `StructureLayer` — `primary` shape + secondary patterns array per peeled layer
- `hubClaim` — single claimId (or null) for the out-degree z-score outlier

Output: `StructurePhaseOutput` — rich output including:
- `enrichedClaims` — claims annotated with graph metrics: `inDegree`, `outDegree`, `isChainRoot`, `isKeystone`, `chainDepth`
- `graph: GraphAnalysis` — full graph representation
- `conflicts`, `conflictInfos`, `tradeoffs`, `convergencePoints`
- `cascadeRisks`, `layers: StructureLayer[]`
- `hubClaim`, `articulationPoints: string[]`

---

## classify.ts

**Phase 5 — Statement Classification**

Routes shadow statements into landscape-based categories using passage routing results.

**`computeStatementClassification(input): StatementClassificationResult`**

Input: shadowStatements, shadowParagraphs, enrichedClaims, claimDensityResult, passageRoutingResult, ownershipMap, paragraphEmbeddings, claimEmbeddings, queryRelevanceScores.

**Classification Pipelines:**

1. **`passageMembership` map construction** — built from density profiles: `stmtId → "claimId:modelIndex:startParagraphIndex"` (passage key)

2. **Paragraph categorization** — each shadow paragraph classified as:
   - `fullyCovered` — all statements owned by at least one claim
   - `fullyUnclaimed` — no statements owned
   - `mixed` — some claimed, some unclaimed

3. **Claimed statements** — statements in enrichedClaims' canonical sets
   - Output shape: `Record<stmtId, { claimIds, inPassage, passageKey }>` 
   - `inPassage`: boolean — whether statement falls in a detected passage
   - `passageKey`: string — `"claimId:modelIndex:startParagraphIndex"` from passageMembership
   - Landscape position from passage routing (northStar/eastStar/mechanism/floor)

4. **Unclaimed paragraphs** — scored by cosine similarity to all claim embeddings
   - `bestClaimId` — nearest claim by cosine sim
   - Paragraphs grouped by `nearestClaimId` → `UnclaimedGroup`
   - `nearestClaimLandscapePosition` — landscape position of the nearest claim (from passage routing)

Output: `StatementClassificationResult`:
- `claimed: Record<stmtId, { claimIds, inPassage, passageKey }>`
- `unclaimedGroups: UnclaimedGroup[]` — each with `nearestClaimId`, `nearestClaimLandscapePosition`, `paragraphIds`
- `summary: { claimedCount, unclaimedCount, ... }`
- `meta: { processingTimeMs }`

**Epistemic Boundaries:**
- Reads only Phase 1–3 outputs (no backward references to Phase 4)
- Statement-to-claim assignments finalized in Phase 1; Phase 5 only adds passage membership and routing metadata

---

## semantic-mapper.ts

LLM-based synthesis layer (parallel to deterministic pipeline, independent of Phases 1–5).

**`buildSemanticMapperPrompt(userQuery, responses): string`**

Builds prompt instructing LLM to:
- Read all model responses together (cross-read, not independently)
- Surface convergences, tensions, singular voices
- Output narrative (prose with canonical markers + citations)
- Output map (JSON with claims + edges)

Claim definition: distinct idea visible only from reading responses together (convergence, tension, singular contribution).

Edge types: supports, conflicts, tradeoff, prerequisite.

**`parseSemanticMapperOutput(rawResponse): ParseResult`**

Parses LLM output:
- Extracts `<narrative>` and `<map>` tags (with backslash normalization)
- Validates shape: UnifiedMapperOutput (claims array + edges array)
- Returns: success/failure, output, narrative, errors, warnings

---

## flow.md

Detailed semantics of each phase, epistemic boundaries, and phase discipline.

---

## Provenance Pipeline Flow

**Full Pipeline (measure → validate → surface → structure → classify):**

```
Input (mapperClaims, enrichedClaims, edges, statements, paragraphs,
       paragraphEmbeddings, statementEmbeddings, regions, periphery, queryContext)
         ↓
[PHASE 1: MEASURE] — measureProvenance()
         ├─ Claim Centroid Construction
         │   ├─ Pool statement embeddings per claim (mean)
         │   ├─ Fallback: generate via text embedding if missing
         │   └─ Produces claimEmbeddings Map
         ├─ Similarity Matrix (C×N)
         │   ├─ Cosine similarity: each claim centroid → each paragraph embedding
         │   └─ Paragraph affinity thresholds: μ (N<3 claims) or μ+σ (N≥3 claims)
         ├─ Competitive Assignment
         │   ├─ Each paragraph self-assigns to claims above its affinity threshold
         │   ├─ Single-claim fallback if only one claim present
         │   └─ Produces: claimPools, normalizedWeights, rawExcess
         ├─ Mixed-Method Merge
         │   ├─ Competitive pool: from assignment step
         │   ├─ Claim-centric pool: paragraphs above claim-specific μ+σ
         │   ├─ Union tagged by origin (both, competitive-only, claim-centric-only)
         │   └─ Global preservation floor (statements ≥ μ_global across all embeddings)
         ├─ Canonical Statement IDs
         │   └─ zone='core' statements finalized; zone='removed' discarded
         ├─ Ownership Accumulation
         │   └─ Inverse index: statement → Set<claimId> (ownershipMap)
         ├─ Exclusivity Classification
         │   └─ Per-claim: exclusiveIds, sharedIds, exclusivityRatio
         └─ Density Profiling (per-claim)
             ├─ Coverage fraction per paragraph (% claimed statements)
             ├─ Passage detection: contiguous runs with coverage > 0.5 + non-peripheral
             └─ Aggregates: paragraphCount, majorityParagraphCount, modelSpread,
                           passageCount, maxPassageLength, meanCoverage
         ↓
[Output: MeasurePhaseOutput]
         ├─ enrichedClaims (with canonical sourceStatementIds)
         ├─ ownershipMap, exclusivityMap, canonicalSets, exclusiveIds
         ├─ claimDensity (ClaimDensityResult — profiles per claim)
         └─ claimEmbeddings, competitiveWeights, competitiveThresholds
         ↓
[PHASE 2: VALIDATE] — validateEdgesAndAllegiance()
         ├─ Conflict Validation (all mapper-labeled conflict edges)
         │   ├─ Exclusive statement gate: exclA ≥ 2 AND exclB ≥ 2
         │   ├─ Cross-pool proximity: max sim of each excl-A stmt to any B stmt
         │   │   └─ min(mean(A→B), mean(B→A)) → crossPoolProximity
         │   ├─ Triangle residual (optional): sim(A,Q)×sim(B,Q) − sim(A,B)
         │   └─ Threshold: μProximity = mean across all valid pairs; validated if > μ
         └─ Provenance Refinement (jointly-owned statements only)
             ├─ Tier 1 (Calibrated): calibration pool ≥ 2 exclusive stmts in dominant claim
             │   ├─ Mean similarity of calibration pool to dominant vs rival centroids
             │   └─ Weighted allegiance → primary = dominant or strongest rival
             ├─ Tier 2 (Centroid Fallback): calibration pool < 2
             │   └─ Rank assigned claims by cosine sim to subject statement; pick highest
             └─ Tier 3 (Passage Fallback): no embeddings
                 └─ Pick passage owner with max coverage in statement's paragraph
         ↓
[Output: ValidateOutput]
         ├─ validatedConflicts: ValidatedConflict[] (proximity, residuals, fail reason)
         └─ provenanceRefinement: primaryClaim per joint statement, method histogram
         ↓
[PHASE 3: SURFACE] — computeTopologicalSurface()
         ├─ Passage Routing (L1 — arithmetic on density profiles only)
         │   ├─ Structural contributors: model has ≥1 majority paragraph (coverage > 0.5)
         │   ├─ Dominant model: highest majority paragraph count among contributors
         │   ├─ Concentration ratio: dominantMAJ / totalMAJ (core paragraphs only)
         │   ├─ Density ratio: maxPassageLengthOfDominant / dominantMAJ
         │   ├─ Load-bearing gates (precondition: totalMAJ ≥ 1):
         │   │   ├─ Gate A: concentrationRatio ≥ μ+σ
         │   │   └─ Gate B: maxPassageLength ≥ 2
         │   ├─ Landscape: northStar (A+B), eastStar (A only), mechanism (B only), floor (neither)
         │   ├─ Conflict clusters: connected components from validated + mapper edges
         │   └─ Routing assembly: clusters → load-bearing → passthrough
         └─ Blast Surface (twin map + risk vectors)
             ├─ Twin map: reciprocal best-match for each canonical statement
             │   ├─ Threshold τ_S = μ + 2σ of similarity distribution
             │   ├─ Forward pass: best candidate; backward pass: confirm reciprocal
             │   └─ Twin = null if either pass fails
             ├─ Type classification per exclusive statement:
             │   ├─ Type 1 (shared): owned by multiple claims
             │   ├─ Type 2 (deletion): exclusive + twin exists (orphaning risk)
             │   └─ Type 3 (degradation): exclusive + no twin (lost semantics)
             ├─ Risk vector: deletion count/damage, degradation count, cascade fragility
             └─ Speculative mixed-parent: PROTECTED / REMOVE / SKELETONIZE fate per shared stmt
         ↓
[Output: SurfaceOutput]
         ├─ passageRoutingResult: routedClaimIds, landscape positions, cluster map, diagnostics
         └─ blastSurfaceResult: per-claim scores, twin map, speculative fates, diagnostics
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
         ├─ enrichedClaims (with inDegree, outDegree, isChainRoot, isKeystone, chainDepth)
         ├─ graph: GraphAnalysis, hubClaim, articulationPoints: string[]
         ├─ conflicts, conflictInfos, tradeoffs, convergencePoints
         └─ cascadeRisks, layers: StructureLayer[]
         ↓
[PHASE 5: CLASSIFY] — computeStatementClassification()
         ├─ passageMembership map: stmtId → "claimId:modelIndex:startParagraphIndex"
         ├─ Paragraph categorization: fullyCovered | fullyUnclaimed | mixed
         ├─ Claimed statements: { claimIds, inPassage, passageKey } per stmtId
         │   └─ Landscape position from passage routing (northStar/eastStar/mechanism/floor)
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

- **semantic-mapper** → LLM cross-read → claims + edges (independent; read by engine.ts before Phase 1, feeds enrichedClaims + edges inputs)

---

## Key Design Principles

- **Collect-then-Construct**: Phase 1 fully builds canonical structures before Phase 2 reads them; no feedback loops
- **L1 purity**: Phases 1–3 use only embeddings, similarity distributions, set membership; no semantic context
- **Strict phase discipline**: Each phase reads only from previous output; no backward references
- **Provenance-driven**: All metrics (density, routing, risk) derive from finalized sourceStatementIds (post Phase 1)
- **Geometry-aware**: Phases 1–3 filter peripheral paragraphs when dominant-core exists
- **Twin map as canonical**: Phase 3 twin map is single source of truth for statement similarity; used for orphan classification
- **Instrumentation layering**: Phases 3–4 compute diagnostic signals; Phase 5 consumes orthogonal subsets for statement routing

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

---

## Summary of Architecture

**5-Phase Provenance Pipeline:**

The provenance module has been refactored from individual files into a **5-phase orchestrator pattern** with strict Collect-then-Construct discipline:

1. **Measure** (measure.ts) — canonical provenance, ownership, density (single-pass)
2. **Validate** (validate.ts) — conflict validation, allegiance-based refinement
3. **Surface** (surface.ts) — passage routing, blast surface assessment
4. **Structure** (structure.ts) — global graph topology, cascade analysis
5. **Classify** (classify.ts) — statement routing/classification

All orchestrated by **engine.ts**.

**Design Principles:**

- **Phase discipline:** Each phase reads only from previous output. No backward references.
- **Epistemic boundary (L1-only):** Phases 1–3 use only embeddings, similarity, set membership; no semantic context.
- **Collect-then-Construct:** Phase 1 fully builds canonical structures before Phase 2 touches them.
- **Geometry-aware:** Peripheral filtering when dominant-core exists.
- **Twin map canonical:** Phase 3 twin map single source of truth.
- **Instrumentation layering:** Orthogonal signal extraction across phases.

**Entry Points:**

- **Full pipeline:** `buildProvenancePipeline(input)` (engine.ts) — wired into `deterministicPipeline.js`
- **Individual phases:** import directly from measure/validate/surface/structure/classify for fine-grained control

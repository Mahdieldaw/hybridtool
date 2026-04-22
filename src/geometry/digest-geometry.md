# geometry — file digest (current consolidated architecture)

---

## Architecture Overview

**Consolidation (Apr 2026):** The geometry module has been refactored from 7+ individual files into a **4-phase orchestrator pattern**:

```
measure.ts          interpret.ts         annotate.ts          engine.ts
(substrate)      → (regions, gates)   → (statements)    →    (orchestrator)
   ├─ pairwise field     ├─ gate logic       ├─ enrichment
   ├─ mutual rank        ├─ basin inversion  ├─ query relevance
   ├─ node stats         ├─ structural profiles
   └─ health             ├─ region build (gap only)
                         └─ periphery
```

**File Organization:**

- `index.ts` — public API (type + function exports)
- `types.ts` — all type definitions
- `layout.ts` — UMAP 2D projection (visualization, no logic deps)
- `algorithms/` — topographic basin detection (3 variants)
- `measure.ts` — **Phase 1:** substrate construction (inlines former knn, threshold, mutualRank, nodes, substrate)
- `interpret.ts` — **Phase 2:** interpretation & regionalization (inlines former gating, regions, profiles, periphery)
- `annotate.ts` — **Phase 3:** statement enrichment + query relevance (inlines former enrichment, queryRelevance)
- `engine.ts` — **Phase 4:** orchestration (measure → interpret → annotate → query)

**Invariant:** Each phase reads only from previous phase's output. No backward references. Strict epistemic boundary (L1-only).

---

## types.ts

All type definitions for the geometry module. Central schema for substrate, regions, graphs, and interpretation results.

**Substrate Types:**

- `GeometricSubstrate` — complete measured substrate (nodes, pairwiseField, mutualRankGraph, layout2d, health, meta)
- `DegenerateSubstrate` — degenerate case (empty graphs, all isolated); type guard: `isDegenerate()`
- `SubstrateHealth` — health metrics: isolationRatio, edgeCount, density, discriminationRange, nodeCount

**Node & Graph Types:**

- `NodeLocalStats` — per-paragraph metrics: paragraphId, modelIndex, stance, statementIds, isolationScore, mutualRankDegree, basinId, neighborhood
- `PairwiseField` — N×N similarity matrix and per-node ranking: matrix (Map), perNode (sorted neighbors), stats, nodeCount
- `PairwiseFieldStats` — full percentile distribution: p10, p25, p50, p75, p80, p90, p95, mean, stddev, discriminationRange, plus pre-computed histogram (sqrt(n) bins, algorithm-independent): histogram[], binCount, binMin, binMax, binWidth
- `MutualRankGraph` — symmetric threshold-based edges: edges (canonical), adjacency (bidirectional), nodeStats, thresholdStats
- `MutualRankEdge` — undirected edge: source, target, similarity (canonical: source < target)

**Region Types:**

- `MeasuredRegion` — constructed region: id, kind (basin|gap), nodeIds, statementIds, sourceId, modelIndices, nodeCount, modelDiversity, internalDensity, isolation, nearestCarrierSimilarity, avgInternalSimilarity
- `RegionizationMeta` — region aggregates: regionCount, kindCounts (basin/gap), coveredNodes, totalNodes

**Interpretation Types:**

- `SubstrateInterpretation` — full interpretation result: gate, regions, regionMeta, corpusMode, peripheralNodeIds, peripheralRatio, largestBasinRatio, basinByNodeId, nodeAnnotations, structuralProfiles, basinNodeProfiles, basinInversion
- `PipelineGateResult` — verdict: 'proceed' | 'skip_geometry' | 'insufficient_structure', confidence, evidence, measurements
- `PeripheryResult` — periphery classification: corpusMode (dominant-core|parallel-cores|no-geometry), peripheralNodeIds, peripheralRatio, largestBasinRatio, basinByNodeId

**Annotation Types:**

- `BasinNodeProfile` — raw inter/intra basin measurements per-node
- `NodeStructuralProfile` — structural evaluation of node placement
- `EnrichmentResult` — statement enrichment: enrichedCount, unenrichedCount, failures (array of {statementId, reason})
- `QueryRelevanceStatementScore` — per-statement score: querySimilarity [-1,1], querySimilarityNormalized [0,1], embeddingSource (statement|paragraph|none), paragraphSimRaw
- `QueryRelevanceResult` — query scores: Map<stmtId, QueryRelevanceStatementScore>

**INVERSION TEST:** Pure type definitions; no logic.

---

## algorithms/ — submodule

Topographic basin detection via three algorithmic approaches. All operate on pairwise similarity distributions; all return compatible `BasinInversionResult` for drop-in use.

### basin-inversion.ts

Peak-finding via kernel density estimation (KDE) and multi-bandwidth valley stability.

**`computeBasinInversion(substrate: MeasuredSubstrate): BasinInversionResult`**

**Pipeline:**

1. Read similarity stats from substrate `PairwiseField` matrix
2. KDE sweep — evaluate kernel density at grid of bandwidths
3. Peak discovery — local maxima in density curve
4. Valley finding — inter-peak troughs; select stable across bandwidths
5. Basin assignment — union-find on valley-linked pairs
6. Trench depth — max inter-basin similarity
7. Bridge pairs — cross-basin edges near valley floor

**Output:**

- `status` — 'ok' | 'no_basin_structure' | 'insufficient_data'
- `basinCount, largestBasinRatio, basins[]` — topology
- `T_low, T_high, T_v` — thresholds (μ±σ, valley floor)
- `mu, sigma, p10, p90, discriminationRange` — similarity distribution
- `histogram, peaks, bridgePairs` — density diagnostics

**Key:** Multiple bandwidth estimates; valleys selected for stability (curvature + prominence + depth).

**INVERSION TEST:** L1. Pure math on similarity distributions; no embeddings re-accessed.

### basin-inversion-bayesian.ts

Bayesian per-node change-point detection with Jaccard-gated mutual inclusion.

**`computeBasinInversion(substrate: MeasuredSubstrate): BasinInversionResult`**

**Pipeline:**

1. Per-node profile — sort each node's similarities (descending)
2. Change-point detection — for each k, compute log-marginal-likelihood of two-segment model (in-group vs out-group)
3. Posterior inference — Bayes factor: does splitting beat null (single population)?
4. In-group assignment — nodes ≥ MAP boundary join node's in-group
5. Mutual inclusion — two nodes share basin iff each includes the other
6. Jaccard-gated union-find — threshold derived via change-point on Jaccard distribution itself (recursive application)
7. Basin extraction — union-find components
8. **Histogram** — Read from pre-computed field stats (no re-computation; supports visualization)

**Key Insight:** Jaccard threshold prevents transitive false merging via bridge nodes. Same principled method (change-point) applied recursively to neighborhood overlap. Histogram pre-computed in substrate phase for algorithm-independent use.

**Output:** Same `BasinInversionResult` interface as peak-finding. `meta.bayesian` includes detailed diagnostics: nodesWithBoundary, mutualInclusionPairs, jaccardGating, concentration, per-node profiles.

**INVERSION TEST:** L1. Pure Bayesian math; no embeddings accessed post-pairwise, no label context.

### gap-regionalization.ts

Dual-gap clustering: identify gaps above/below each node's peer ranking, then region via reciprocal-upper + vote assignment.

**`computeGapRegionalization(nodes): GapRegionalizationResult`**

Input: `{id, embedding}[]`

**Pipeline:**

1. Pairwise matrix (cosine, sorted per node)
2. Gap detection (dual-boundary) — find upper gap (top-down) and lower gap (bottom-up) where jump > μ+σ
3. Classification — peers binned: upper (≥upper), middle (between), lower (≤lower)
4. Reciprocal-upper edges — bidirectional "upper" classification
5. Union-find core components — reciprocal pairs; size ≥ 2 become cores
6. Vote assignment — singletons vote on core regions; ties stay singleton
7. Region assembly — sort by size; compute internal similarity stats

**Output:**

- `regions[]` — GapRegion (coreNodeIds, votedNodeIds, allNodeIds, size, stats)
- `nodeProfiles{}` — per-node thresholds (upperBoundary, lowerBoundary, counts)
- `meta` — nodeCount, reciprocalEdgeCount

**INVERSION TEST:** L1. Pure math on embeddings and rankings; no label context.

---

## measure.ts

**Phase 1: Substrate Construction** (inlines former knn, threshold, mutualRank, nodes, substrate logic)

Builds the geometric substrate from paragraphs and embeddings via strict phase discipline.

**`measureSubstrate(paragraphs, embeddings, embeddingBackend?, config?, basinInversionResult?): GeometricSubstrate | DegenerateSubstrate`**

**Pipeline (happy path):**

1. **Validation** — paragraph count ≥ minParagraphs (default 3), embeddings exist
2. **Pairwise field** — `buildPairwiseField(paragraphIds, embeddings)`
   - N×N cosine similarities (quantized to 1e-6)
   - Per-node neighbor ranking (sorted descending, lexicographic tie-break)
   - Stats: min, p10, p25, p50, p75, p80, p90, p95, max, mean, stddev, discriminationRange
   - **Histogram** — Pre-computed sqrt(n) bins over [min, max] for algorithm-independent density visualization (used by basin inversion variants)
3. **Degenerate check** — if discriminationRange = 0 (identical embeddings), return degenerate
4. **Mutual recognition graph** — `buildMutualRankGraph(pairwiseField)`
   - Per-node threshold: μ + σ of that node's neighbors
   - Mutual edges: both must exceed each other's threshold
   - Canonical form: source < target (lexicographic)
   - Adjacency (bidirectional) and threshold stats (per-node)
5. **Node stats** — `computeNodeStats(paragraphs, mutualRankGraph)`
   - Extract isolation: 0 (connected) to 1 (fully isolated)
   - Neighborhood: [self, ...neighbors] sorted
6. **Health** — `deriveHealth(field, graph, nodeCount)`
   - isolationRatio, edgeCount, density, discriminationRange
7. **Layout** — `computeUmapLayout(paragraphIds, embeddings)`
   - 2D projection (visualization only, no logic deps)
   - Normalized to [-1, 1]²

**Degenerate Handling:**

`buildDegenerateSubstrate(paragraphs, reason, embeddingBackend, buildTimeMs): DegenerateSubstrate`

Reasons: 'embedding_failure' | 'insufficient_paragraphs' | 'all_embeddings_identical'

Returns valid (empty) substrate; all nodes isolated (isolationScore = 1), no edges.

**Helper Functions (Exported):**

- `buildPairwiseField(paragraphIds, embeddings)` — N×N matrix + per-node ranking
- `buildMutualRankGraph(pairwiseField)` — threshold-based edges
- `computeNodeStats(paragraphs, mutualRankGraph, basinInversionResult?)` — per-node enrichment
- `computeExtendedStatsFromArray(allSims)` — percentile distribution
- `quantize(value)` — round to 1e-6

**Backward Compat:**

`buildGeometricSubstrate` is an alias for `measureSubstrate`.

**INVERSION TEST:** L1. Pure math on embeddings, no label context.

---

## interpret.ts

**Phase 2: Substrate Interpretation** (inlines former gating, regions, profiles, periphery logic)

Converts measured substrate into structured interpretation: gates substrate adequacy, selects region source, constructs regions, detects corpus mode.

**`interpretSubstrate(substrate, paragraphEmbeddings?): SubstrateInterpretation`**

**Phase Discipline (Collect-then-Construct invariant):**

Objects constructed once, fully. All population metrics derived before any `MeasuredRegion` is built. Basin and gap topologies kept separate (two lenses).

**Pipeline:**

1. **Gate evaluation** — `evaluateGate(substrate)`
   - Check: degenerate? no edges? discrimination < 0.1? isolation > 0.7?
   - Return: verdict (proceed | skip_geometry | insufficient_structure) + confidence + evidence + measurements
2. **Compute basin internally** — parallel structural signal via computeBasinInversion
3. **Topology index** — plain data: nodeToBasin, nodeToGap, nodeIsolation, nodeNeighborhood
4. **Region identities** — structural only: collect gap members, union statement IDs, model indices (no metrics yet)
5. **Population phase** — compute metrics for all regions:
   - nodeCount, modelDiversity, modelDiversityRatio
   - internalDensity (mutual rank edges within region / max possible)
   - avgInternalSimilarity (edge-weighted)
   - isolation (avg isolationScore of members)
   - nearestCarrierSimilarity (centroid-to-centroid or edge-bridge)
6. **Region construction** — each `MeasuredRegion` built fully in one shot from identity + metrics
7. **Corpus mode + periphery** — `identifyPeriphery(basinInversion, topologyIndex)`
   - Classify: 'dominant-core' (largest basin ≥ 50%) | 'parallel-cores' | 'no-geometry'
   - Mark peripheral: non-core basin members + gap singletons
8. **Structural Profiles** — compute `BasinNodeProfile` and `NodeStructuralProfile` for every node.

**Output: `SubstrateInterpretation`**

- `gate` — PipelineGateResult (verdict, confidence, evidence, measurements)
- `regions` — MeasuredRegion[] (sorted: gap first, then size descending)
- `regionMeta` — RegionizationMeta (regionCount, kindCounts, coveredNodes, totalNodes)
- `corpusMode` — 'dominant-core' | 'parallel-cores' | 'no-geometry'
- `peripheralNodeIds` — Set<string>
- `peripheralRatio` — fraction of nodes deemed peripheral
- `largestBasinRatio` — size of largest basin / total nodes
- `basinByNodeId` — Map<nodeId, basinId> (basin topology trace)
- `nodeAnnotations` — mapped region and basin IDs
- `structuralProfiles`, `basinNodeProfiles` — node geometric profile maps
  **Helper Functions:**

- `evaluateGate(substrate)` — gate logic
- `identifyPeriphery(basinInversion, regionsOrTopologyIndex?)` — periphery + corpus mode

**Backward Compat:**

`buildPreSemanticInterpretation(substrate, paragraphEmbeddings?, _queryRelevanceBoost?)` is an alias.

**INVERSION TEST:** L1. No semantic context crosses this boundary; all logic on substrate structure + graphs.

---

## annotate.ts

**Phase 3: Statement Annotation** (inlines former enrichment, queryRelevance logic)

Attaches geometric position and query relevance data to shadow statements.

**`enrichStatementsWithGeometry(statements, paragraphs, substrate, interpretation): EnrichmentResult`**

Decorates each statement in-place with `geometricCoordinates`:

- `paragraphId` — owning paragraph
- `regionId` — region (if in a region, else null)
- `basinId` — topographic cluster membership
- `isolationScore` — from substrate node

Returns: enrichedCount, unenrichedCount, failures (array of {statementId, reason}).

Reasons: 'no_paragraph' | 'no_node'

**`computeQueryRelevance(input): QueryRelevanceResult`**

Scores all statements against a query embedding using cosine similarity.

Input:

- `queryEmbedding` — Float32Array (normalized)
- `statements` — ShadowStatement[]
- `statementEmbeddings` — optional Map<stmtId, Float32Array>
- `paragraphEmbeddings` — optional Map<parId, Float32Array>
- `paragraphs` — ShadowParagraph[]

Per-statement scoring:

1. Retrieve statement embedding; fall back to paragraph; mark source
2. Compute cosine similarity: `simRaw ∈ [-1, 1]` (**canonical for pipeline**)
3. Normalize for UI: `simNormalized = (simRaw + 1) / 2 ∈ [0, 1]`
4. Also compute paragraph-level similarity (context)

Output: `QueryRelevanceResult` with `statementScores` Map<stmtId, QueryRelevanceStatementScore>

Per-statement record:

- `querySimilarity` — [-1, 1] (canonical, for decisions)
- `querySimilarityNormalized` — [0, 1] (UI display only)
- `simRaw` — deprecated alias
- `embeddingSource` — 'statement' | 'paragraph' | 'none'
- `paragraphSimRaw` — context value

**`annotateStatements(input)`**

Convenience wrapper: enriches statements and optionally computes query relevance in one call.

**INVERSION TEST:** L1. Pure cosine math; no semantic context crosses boundary.

---

## engine.ts

**Phase 4: Orchestration** (full pipeline coordinator)

Composes all phases in strict sequence: measure → interpret → annotate → query.

**`buildGeometryPipeline(input): GeometryPipelineResult`**

**Input:**

- `paragraphs` — ShadowParagraph[]
- `statements` — ShadowStatement[]
- `paragraphEmbeddings` — Map<paragraphId, Float32Array> | null
- `statementEmbeddings` — optional Map<stmtId, Float32Array>
- `embeddingBackend` — 'webgpu' | 'wasm' | 'none' (default 'wasm')
- `basinInversionResult` — optional (feeds interpret phase)
- `queryEmbedding` — optional Float32Array (triggers query relevance phase)

**Pipeline:**

1. **Measure** → `measureSubstrate(paragraphs, paragraphEmbeddings, ...)`
2. **Interpret** → `interpretSubstrate(substrate, paragraphEmbeddings)`
3. **Annotate** → `enrichStatementsWithGeometry(statements, paragraphs, substrate, interpretation)`
4. **Query** → `computeQueryRelevance(...)` if queryEmbedding provided

**Output: `GeometryPipelineResult`**

- `substrate` — MeasuredSubstrate | DegenerateSubstrate
- `interpretation` — SubstrateInterpretation (gate, regions, corpusMode, periphery)
- `queryRelevance` — QueryRelevanceResult | null

**Design:**

- Single call point for full pipeline; no intermediate returns
- Phase discipline enforced: each phase reads only from previous output
- Layout and query are side-computations (no logic deps)
- For fine-grained control, import measure/interpret/annotate directly

**INVERSION TEST:** L1. Orchestration only; all phases are L1.

---

## layout.ts

Dimensionality reduction via UMAP to 2D visualization coordinates.

**`computeUmapLayout(paragraphIds, embeddings, seed=42): Layout2DResult`**

Uses `umap-js` library to project high-dimensional embeddings to 2D.

**Pipeline:**

1. Gather vectors; skip missing embeddings
2. Handle degenerate: < 2 vectors → return all zeros
3. Create seeded UMAP instance (nNeighbors=min(15, N-1), minDist=0.1)
4. Fit and project to 2D
5. Normalize to [-1, 1]² bounding box
6. Build coordinate map; pad missing IDs with [0, 0]

**Output: `Layout2DResult`**

- `method` — always 'umap'
- `coordinates` — Record<paragraphId, [x, y]> ∈ [-1, 1]²
- `buildTimeMs` — elapsed time

**Role:** Visualization only. No downstream logic depends on layout; safe to compute asynchronously.

**INVERSION TEST:** L1. Math on embeddings only; no label context.

---

## index.ts

Public API surface. Exports types and key functions for downstream consumption.

**Type Exports:**

- Substrate: `GeometricSubstrate, DegenerateSubstrate, SubstrateHealth`
- Nodes/graphs: `NodeLocalStats, PairwiseField, PairwiseFieldStats, MutualRankEdge, MutualRankGraph`
- Regions: `MeasuredRegion, RegionizationMeta`
- Interpretation: `SubstrateInterpretation, PipelineGateResult, PeripheryResult`
- Annotations: `NodeStructuralProfile, BasinNodeProfile`
- Enrichment/query: `EnrichmentResult, QueryRelevanceResult, QueryRelevanceStatementScore`

**Function Exports:**

- Orchestration: `buildGeometryPipeline` (full pipeline)
- Phase functions: `measureSubstrate, interpretSubstrate, enrichStatementsWithGeometry, computeQueryRelevance`
- Substrate builders: `buildPairwiseField, buildMutualRankGraph, computeNodeStats`
- Utilities: `quantize, computeExtendedStatsFromArray, computeUmapLayout`
- Type guards: `isDegenerate`

---

## Geometry Pipeline Flow

**Full Pipeline (measure → interpret → annotate → engine):**

```
Input (paragraphs, embeddings, statements, optional: queryEmbedding)
         ↓
[PHASE 1: MEASURE] — measureSubstrate()
         ├─ Pairwise Field Construction
         │   ├─ Compute N×N cosine similarities
         │   ├─ Quantize to 6 decimals (stability)
         │   ├─ Generate percentile distribution (p10, p25, p50, p75, p90, p95)
         │   └─ Rank neighbors per node
         ├─ Mutual Recognition Graph
         │   ├─ Apply dynamic threshold (μ + σ)
         │   ├─ Filter to symmetric edges (source < target, canonical)
         │   └─ Build adjacency bidirectional index
         ├─ Node Statistics
         │   ├─ Compute isolation score per node (inverse of neighbor count)
         │   ├─ Determine mutual rank degree
         │   └─ Collect model indices and statement IDs
         └─ Degenerate Check + Layout
             ├─ Flag if <3 edges or insufficient structure
             └─ Compute UMAP 2D projection
         ↓
[Output: GeometricSubstrate | DegenerateSubstrate]
         ↓
[PHASE 2: INTERPRET] — interpretSubstrate()
         ├─ Gate Evaluation
         │   ├─ Measure density, distribution, discriminationRange
         │   ├─ Apply thresholds: structure sufficient? (edgeCount ≥ 3, discriminationRange ≥ 0.2)
         │   └─ Return gate verdict: 'proceed' | 'skip_geometry' | 'insufficient_structure'
         ├─ Basin/Gap Topology Detection
         │   ├─ Invoke basin inversion (KDE, Bayesian, or gap-regionalization)
         ├─ Region Construction
         │   ├─ Build region identities (id, kind, nodeIds, sourceId)
         │   ├─ Populate statementIds from nodeIds
         │   └─ Compute region metrics (internalDensity, isolation, modelDiversity)
         ├─ Periphery Classification
         │   ├─ Identify isolated/low-neighborhood nodes
         │   ├─ Determine corpus mode: dominant-core | parallel-cores | no-geometry
         │   └─ Compute peripheralRatio and largestBasinRatio
         ├─ Structural Profiles
         │   ├─ Measure inter/intra basin similarities per-node
         │   └─ Map node alignment strengths and layout gaps
         └─ Region Population
             └─ Link nodes to regions; attach basin metadata to nodes
         ↓
[Output: SubstrateInterpretation]
         ├─ gate: PipelineGateResult
         ├─ regions: MeasuredRegion[]
         ├─ corpusMode: 'dominant-core' | 'parallel-cores' | 'no-geometry'
         ├─ structuralProfiles, basinNodeProfiles
         └─ peripheralNodeIds, largestBasinRatio, basinByNodeId, nodeAnnotations
         ↓
[PHASE 3: ANNOTATE] — enrichStatementsWithGeometry() + computeQueryRelevance()
         ├─ Statement Enrichment
         │   ├─ Map statements → paragraphs → nodes
         │   ├─ Attach geometricCoordinates (paragraphId, regionId, basinId, isolationScore)
         │   └─ Report enrichment success/failures
         └─ Query Relevance (if queryEmbedding provided)
             ├─ Score each statement vs. query embedding
             ├─ Use statement embedding if available; fallback to paragraph embedding
             ├─ Compute cosine similarity [-1, 1] (canonical) and normalized [0, 1]
             └─ Determine embeddingSource (statement | paragraph | none)
         ↓
[Output: Enriched statements with geometricCoordinates + QueryRelevanceResult]
         ↓
[PHASE 4: ENGINE] — buildGeometryPipeline()
         ├─ Orchestrates all phases in sequence
         ├─ Threads results through phase boundaries
         └─ Returns combined GeometryPipelineResult
         ↓
[Output: Complete pipeline result]
         ├─ substrate (GeometricSubstrate | DegenerateSubstrate)
         ├─ interpretation (SubstrateInterpretation)
         ├─ enrichedStatements (with geometricCoordinates)
         └─ queryRelevance (QueryRelevanceResult | null)
```

**Design Principles:**

- **Phase discipline:** Each phase reads only from previous output. No backward references.
- **Epistemic boundary (L1-only):** No semantic interpretation in geometry; all decisions based on embeddings, similarity distributions, and structural graphs.
- **Collect-then-Construct:** All metrics derived before objects fully built. Prevents partial state.
- **Dual geometry lenses:** Basin (peaked density) and gap (reciprocal-upper clustering) kept separate.
- **Degenerate safety:** All builders return valid (empty/isolated) substrates on failure; downstream code checks `isDegenerate()`.
- **Quantization for stability:** 6-decimal rounding on similarities prevents floating-point artifacts in thresholds.
- **Canonical edges:** Mutual recognition edges stored as source|target with lexicographic ordering.

---

## Summary of Architecture

**Consolidated Structure:**

The geometry module has evolved from 7+ individual files into a **4-phase orchestrator pattern** with clear separation of concerns:

1. **Measure** (substrate.ts inlined) — pure similarity math
2. **Interpret** (gating + regions inlined) — topological classification
3. **Annotate** (enrichment + query relevance inlined) — statement decoration
4. **Engine** (orchestrator) — phase sequencing

**Design Principles:**

- **Phase discipline:** Each phase reads only from previous output. No backward references.
- **Epistemic boundary (L1-only):** No semantic interpretation in geometry; all decisions based on embeddings, similarity distributions, and structural graphs.
- **Collect-then-Construct:** All metrics derived before objects fully built. Prevents partial state.
- **Dual geometry lenses:** Basin (peaked density) and gap (reciprocal-upper clustering) kept separate.
- **Degenerate safety:** All builders return valid (empty/isolated) substrates on failure; downstream code checks `isDegenerate()`.
- **Quantization for stability:** 6-decimal rounding on similarities prevents floating-point artifacts in thresholds.
- **Canonical edges:** Mutual recognition edges stored as source|target with lexicographic ordering.

**Entry Points:**

- **Full pipeline:** `buildGeometryPipeline(input)` (engine.ts)
- **Substrate only:** `measureSubstrate(paragraphs, embeddings)` (measure.ts)
- **Interpretation only:** `interpretSubstrate(substrate, paragraphs)` (interpret.ts)
- **Individual phases:** import directly for fine-grained control

**Basin Topology:**

Three complementary algorithms in `algorithms/`:

- **Peak-finding (KDE):** Stable valleys across bandwidth sweep
- **Bayesian change-point:** Per-node boundaries with Jaccard-gated union-find
- **Gap regionalization:** Dual-gap clustering with reciprocal-upper edges

All return compatible `BasinInversionResult` for drop-in use.

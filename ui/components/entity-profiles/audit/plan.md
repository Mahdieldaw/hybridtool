 Plan to implement                                                                                                    │
│                                                                                                                      │
│ Thresholding Audit Plan — Layer-by-Layer with UI Instrumentation                                                     │
│                                                                                                                      │
│ Context                                                                                                              │
│                                                                                                                      │
│ Pipeline measurements may be miscalibrated — values cluster too closely within fields, thresholds were set without   │
│ empirical grounding against real similarity distributions. This audit traces forward from embeddings through each    │
│ measurement boundary, adding UI instrumentation at each stage so you can run manual queries, inspect distributions,  │
│ and calibrate before moving to the next layer.                                                                       │
│                                                                                                                      │
│ Approach: Iterative. We implement Stage 1 (Embeddings), you run queries and report findings, then we reconvene for   │
│ Stage 2, etc. Each stage adds a panel to a new "Diagnostics" tab.                                                    │
│                                                                                                                      │
│ ---                                                                                                                  │
│ Stage 1: Embeddings (implement now)                                                                                  │
│                                                                                                                      │
│ What we're answering                                                                                                 │
│                                                                                                                      │
│ - What do actual cosine similarity distributions look like for real queries?                                         │
│ - Are the 15+ thresholds (0.45 → 0.92) set at points that genuinely discriminate?                                    │
│ - Where in the distribution does the soft threshold land? How many edges survive it?                                 │
│                                                                                                                      │
│ Data already available in UI artifact (no backend changes needed)                                                    │
│                                                                                                                      │
│ - artifact.geometry.substrate.nodes[] — each has top1Sim, avgTopKSim, mutualDegree, strongDegree, isolationScore     │
│ - artifact.geometry.substrate.edges[] — kNN edges with .similarity                                                   │
│ - artifact.geometry.substrate.mutualEdges[] — mutual edges with .similarity                                          │
│ - artifact.geometry.substrate.strongEdges[] — strong edges with .similarity                                          │
│ - artifact.geometry.substrate.softThreshold — the computed threshold                                                 │
│ - artifact.geometry.diagnostics.observations[] — computed but never rendered                                         │
│                                                                                                                      │
│ Data NOT reaching the UI (needs plumbing)                                                                            │
│                                                                                                                      │
│ - substrate.meta.similarityStats ({max, p95, p80, p50, mean}) — exists in substrate, serialized into                 │
│ substrateSummary.meta but NOT into the cognitiveArtifact.geometry.substrate object that the UI reads                 │
│                                                                                                                      │
│ 1A. Extend computeSimilarityStats → full distribution                                                                │
│                                                                                                                      │
│ File: src/geometry/threshold.ts                                                                                      │
│ - Add ExtendedSimilarityStats interface: {count, min, p10, p25, p50, p75, p80, p90, p95, max, mean, stddev}          │
│ - Add computeExtendedSimilarityStats(topKSims) function (reuse sort + percentile logic from existing                 │
│ computeSimilarityStats)                                                                                              │
│                                                                                                                      │
│ 1B. Store extended stats in substrate meta                                                                           │
│                                                                                                                      │
│ File: src/geometry/types.ts — add extendedSimilarityStats?: ExtendedSimilarityStats to GeometricSubstrate['meta']    │
│                                                                                                                      │
│ File: src/geometry/substrate.ts — call computeExtendedSimilarityStats(topKSims) and store alongside existing         │
│ similarityStats                                                                                                      │
│                                                                                                                      │
│ 1C. Serialize stats into substrateGraph (→ cognitive artifact → UI)                                                  │
│                                                                                                                      │
│ File: src/core/execution/StepExecutor.js (lines 810-846, the substrateGraph construction)                            │
│ - Add similarityStats and extendedSimilarityStats from substrate.meta:                                               │
│ substrateGraph = {                                                                                                   │
│   // ...existing node/edge mapping...                                                                                │
│   softThreshold: substrate.graphs?.strong?.softThreshold,                                                            │
│   similarityStats: substrate.meta?.similarityStats || null,                                                          │
│   extendedSimilarityStats: substrate.meta?.extendedSimilarityStats || null,                                          │
│ };                                                                                                                   │
│                                                                                                                      │
│ File: shared/cognitive-artifact.ts (line 37-43) — pass through the new fields:                                       │
│ substrate: {                                                                                                         │
│   // ...existing fields...                                                                                           │
│   similarityStats: substrateGraph?.similarityStats ?? null,                                                          │
│   extendedSimilarityStats: substrateGraph?.extendedSimilarityStats ?? null,                                          │
│ },                                                                                                                   │
│                                                                                                                      │
│ 1D. Add "Diagnostics" tab to EntityProfilesPanel                                                                     │
│                                                                                                                      │
│ File: ui/components/entity-profiles/EntityProfilesPanel.tsx                                                          │
│ - Add "diagnostics" to EntityTabKey union                                                                            │
│ - Add { key: "diagnostics", label: "Diagnostics" } to tabConfig                                                      │
│ - Import and render DiagnosticsTab when active                                                                       │
│                                                                                                                      │
│ 1E. Build DiagnosticsTab (new file)                                                                                  │
│                                                                                                                      │
│ New file: ui/components/entity-profiles/DiagnosticsTab.tsx                                                           │
│ - Stage selector: embeddings | query-relevance | provenance | structural | blast-radius | skeletonization            │
│ - Only "embeddings" panel implemented for now; others show "Not yet instrumented"                                    │
│ - Receives same { artifact, structuralAnalysis } props as other entity tabs                                          │
│                                                                                                                      │
│ 1F. Build EmbeddingDistributionPanel (new file)                                                                      │
│                                                                                                                      │
│ New file: ui/components/entity-profiles/audit/EmbeddingDistributionPanel.tsx                                         │
│                                                                                                                      │
│ Reads entirely from artifact.geometry.substrate. Sections:                                                           │
│                                                                                                                      │
│ A. Distribution Summary Cards (reuse SummaryCardsRow from entity-utils.tsx)                                          │
│ - Count, Min, P10, P25, Median, P75, P90, P95, Max, Mean, StdDev                                                     │
│ - "Discrimination Range" (P90 - P10) — flag amber if < 0.15 (too compressed)                                         │
│                                                                                                                      │
│ B. Threshold Overlay Table                                                                                           │
│ For each known threshold, compute where it falls against the actual edge similarity distribution (client-side from   │
│ edge arrays):                                                                                                        │
│                                                                                                                      │
│ ┌────────────────────────────┬────────┬─────────┬─────────┬────────────────────────────────────────────┐             │
│ │         Threshold          │ Value  │ % Above │ % Below │                  Used In                   │             │
│ ├────────────────────────────┼────────┼─────────┼─────────┼────────────────────────────────────────────┤             │
│ │ provenance para            │ 0.45   │ —       │ —       │ Paragraph spatial anchor                   │             │
│ ├────────────────────────────┼────────┼─────────┼─────────┼────────────────────────────────────────────┤             │
│ │ provenance stmt / clampMin │ 0.55   │ —       │ —       │ Statement refinement, soft threshold floor │             │
│ ├────────────────────────────┼────────┼─────────┼─────────┼────────────────────────────────────────────┤             │
│ │ carrier detection          │ 0.60   │ —       │ —       │ Carrier claim + source gates               │             │
│ ├────────────────────────────┼────────┼─────────┼─────────┼────────────────────────────────────────────┤             │
│ │ softThreshold (computed)   │ varies │ —       │ —       │ Strong graph gate                          │             │
│ ├────────────────────────────┼────────┼─────────┼─────────┼────────────────────────────────────────────┤             │
│ │ clustering merge           │ 0.72   │ —       │ —       │ Default clustering                         │             │
│ ├────────────────────────────┼────────┼─────────┼─────────┼────────────────────────────────────────────┤             │
│ │ clampMax                   │ 0.78   │ —       │ —       │ Soft threshold ceiling                     │             │
│ ├────────────────────────────┼────────┼─────────┼─────────┼────────────────────────────────────────────┤             │
│ │ paraphrase                 │ 0.85   │ —       │ —       │ Paraphrase detection                       │             │
│ ├────────────────────────────┼────────┼─────────┼─────────┼────────────────────────────────────────────┤             │
│ │ merge alert                │ 0.92   │ —       │ —       │ Near-duplicate claims                      │             │
│ └────────────────────────────┴────────┴─────────┴─────────┴────────────────────────────────────────────┘             │
│                                                                                                                      │
│ Percentages computed client-side by binary search on sorted edge similarities.                                       │
│                                                                                                                      │
│ C. Text Histogram                                                                                                    │
│ Simple div-based histogram (no charting library). 20 bins across [0,1], bar width proportional to count. Threshold   │
│ markers as colored vertical lines. Three histograms:                                                                 │
│ 1. All kNN edge similarities                                                                                         │
│ 2. Mutual edge similarities only                                                                                     │
│ 3. Top-1 similarities per node                                                                                       │
│                                                                                                                      │
│ D. Per-Node Table (reuse DataTable from entity-utils)                                                                │
│ Columns: paragraphId, modelIndex, top1Sim, avgTopKSim, mutualDegree, strongDegree, isolationScore                    │
│ Sortable. Default sort: top1Sim descending.                                                                          │
│                                                                                                                      │
│ E. Per-Edge Table                                                                                                    │
│ Columns: source, target, similarity, rank, graph type (kNN/mutual/strong)                                            │
│ Merge all three edge arrays with discriminator. Default sort: similarity descending.                                 │
│                                                                                                                      │
│ F. Diagnostic Observations                                                                                           │
│ Render artifact.geometry.diagnostics.observations[] — these are already computed (e.g., uncovered_peak,              │
│ topology_mapper_divergence, embedding_quality_suspect) but currently invisible.                                      │
│                                                                                                                      │
│ Stage 1 file summary                                                                                                 │
│                                                                                                                      │
│ File: src/geometry/threshold.ts                                                                                      │
│ Change: Add ExtendedSimilarityStats + computeExtendedSimilarityStats()                                               │
│ ────────────────────────────────────────                                                                             │
│ File: src/geometry/types.ts                                                                                          │
│ Change: Add optional extendedSimilarityStats to substrate meta type                                                  │
│ ────────────────────────────────────────                                                                             │
│ File: src/geometry/substrate.ts                                                                                      │
│ Change: Compute and store extended stats                                                                             │
│ ────────────────────────────────────────                                                                             │
│ File: src/core/execution/StepExecutor.js                                                                             │
│ Change: Add stats to substrateGraph object (~2 lines)                                                                │
│ ────────────────────────────────────────                                                                             │
│ File: shared/cognitive-artifact.ts                                                                                   │
│ Change: Pass stats through to artifact (~2 lines)                                                                    │
│ ────────────────────────────────────────                                                                             │
│ File: ui/components/entity-profiles/EntityProfilesPanel.tsx                                                          │
│ Change: Add diagnostics tab key + render                                                                             │
│ ────────────────────────────────────────                                                                             │
│ File: ui/components/entity-profiles/DiagnosticsTab.tsx                                                               │
│ Change: NEW — stage selector shell                                                                                   │
│ ────────────────────────────────────────                                                                             │
│ File: ui/components/entity-profiles/audit/EmbeddingDistributionPanel.tsx                                             │
│ Change: NEW — full embedding audit panel                                                                             │
│                                                                                                                      │
│ ---                                                                                                                  │
│ Stage 2: Query Relevance (outline, implement after Stage 1 findings)                                                 │
│                                                                                                                      │
│ The problem: (simRaw + 1) / 2 normalization maps cosine 0 → 0.5, compressing the useful range. Statement-level       │
│ granularity when paragraph-level may be more honest.                                                                 │
│                                                                                                                      │
│ Panel will show:                                                                                                     │
│ - Distribution of raw cosine vs query (before +1/2 shift)                                                            │
│ - Distribution of normalized values (after shift)                                                                    │
│ - Side-by-side so the compression is visible                                                                         │
│ - Per-statement table with both raw and normalized                                                                   │
│ - Threshold markers at 0.30 (sole-source off-topic in blast radius) and 0.50 (coverage)                              │
│                                                                                                                      │
│ File: src/geometry/queryRelevance.ts — expose simRaw alongside normalized score                                      │
│ New file: ui/components/entity-profiles/audit/QueryRelevancePanel.tsx                                                │
│                                                                                                                      │
│ ---                                                                                                                  │
│ Stage 3: Provenance (outline)                                                                                        │
│                                                                                                                      │
│ The problem: 0.45/0.55 thresholds in reconstructProvenance have no empirical basis. A claim at the boundary could    │
│ flip between 100% exclusive and 0% exclusive from a 0.01 cosine difference.                                          │
│                                                                                                                      │
│ Panel will show:                                                                                                     │
│ - Per-claim: all paragraph candidate scores (passed/failed the 0.45 gate)                                            │
│ - Per-claim: all statement candidate scores (passed/failed the 0.55 gate)                                            │
│ - Distribution of all claim-to-paragraph similarities                                                                │
│ - Distribution of all claim-to-statement similarities                                                                │
│ - Threshold markers at 0.45 and 0.55                                                                                 │
│                                                                                                                      │
│ File: src/ConciergeService/claimAssembly.ts — emit provenance audit log                                              │
│ New file: ui/components/entity-profiles/audit/ProvenancePanel.tsx                                                    │
│                                                                                                                      │
│ ---                                                                                                                  │
│ Stage 4: Structural Analysis (outline)                                                                               │
│                                                                                                                      │
│ The problem: Leverage uses min-max normalization (scale resets per query), cascade breadth operates on LLM-generated │
│  edges.                                                                                                              │
│                                                                                                                      │
│ Panel will show:                                                                                                     │
│ - Leverage distribution with factor breakdown (support, role, connectivity, position)                                │
│ - Cascade depth distribution                                                                                         │
│ - Articulation point identification                                                                                  │
│ - Claim graph component structure                                                                                    │
│ - All data already in StructuralAnalysis — mostly UI-only work                                                       │
│                                                                                                                      │
│ New file: ui/components/entity-profiles/audit/StructuralAnalysisPanel.tsx                                            │
│                                                                                                                      │
│ ---                                                                                                                  │
│ Stage 5: Blast Radius (deferred per user instruction)                                                                │
│                                                                                                                      │
│ Do not touch until Stages 1-4 are calibrated.                                                                        │
│                                                                                                                      │
│ ---                                                                                                                  │
│ Stage 6: Skeletonization (outline)                                                                                   │
│                                                                                                                      │
│ Panel will show:                                                                                                     │
│ - Carrier detection: all candidate similarities (not just those that passed 0.6/0.6)                                 │
│ - Paraphrase sweep: all pairwise similarities near 0.85 threshold                                                    │
│ - Triage decisions with the similarity values that drove them                                                        │
│                                                                                                                      │
│ Files: src/skeletonization/CarrierDetector.ts, src/skeletonization/TriageEngine.ts — emit audit data                 │
│ New file: ui/components/entity-profiles/audit/SkeletonizationPanel.tsx                                               │
│                                                                                                                      │
│ ---                                                                                                                  │
│ Verification (Stage 1)                                                                                               │
│                                                                                                                      │
│ 1. Run a manual query through the pipeline                                                                           │
│ 2. Open DecisionMapSheet → Entities → Diagnostics tab                                                                │
│ 3. Select "Embeddings" stage                                                                                         │
│ 4. Verify: summary cards show full distribution stats                                                                │
│ 5. Verify: threshold table shows % above/below for each threshold with the actual edge distribution                  │
│ 6. Verify: histograms render for kNN, mutual, and top-1 similarities                                                 │
│ 7. Verify: per-node and per-edge tables are sortable and show raw values                                             │
│ 8. Verify: diagnostic observations (if any fired) are rendered                                                       │
│ 9. Check: is the discrimination range (P90-P10) wide enough that thresholds at different points in the range         │
│ actually separate different populations?  
# Computation Inventory — Working Audit Reference

All calculations currently in the codebase, organized by pipeline layer.
Status: **active** = wired in happy path | **diagnostic** = computed, stored in artifact, not decision-making | **dead** = exported but no callers outside own file.

---

## Shadow Layer — Stances and Signals: Architectural Position

### What they actually are

Stances and signals are **L1 keyword observations labeled with L2 inference tags**.

- The **computation is L1**: `STANCE_PATTERNS['prerequisite'].some(p => p.test(text))` is deterministic pattern matching.
- The **label is L2 inference**: "text contains 'before' → this is a prerequisite claim." The label is a bet, not a fact.
- The **`confidence` field** (0.65 / 0.80 / 0.95) is not semantic confidence — it is pattern match count (1/2/3+ patterns). The honest name would be `patternStrength`. Rename deferred (touches `ShadowStatement` in contract and many consumers).

### Why false positives are managed (post Phase 1–4)

Stances and signals do not gate any geometry decision after the previous cleanup. Their impact is now limited to:
1. `ShadowDelta.ts` — `signalWeight` used for advisory ranking of unreferenced statements
2. `claimAssembly.ts` — `has*Signal` boolean flags on `LinkedClaim` (display only)
3. `fateTracking.ts` — `signalWeight` included in `StatementFate.shadowMetadata` (display/debug only)

A false positive produces a wrong label or a slightly re-ranked advisory list — cosmetic, not structural.

### The genuine remaining risk

`ExclusionRules.ts` (88 patterns, 329 lines) applies **semantic gatekeeping at the extraction layer**: it tries to distinguish epistemic vs deontic modality, temporal narration vs causal ordering, rhetorical vs genuine warning — all via regex. These are L3 semantic judgments that regex cannot reliably make. A false exclusion drops a real statement from the pipeline entirely, silently.

**Status: deferred as a tuning problem.** The architecture is sound — the exclusion rules are the right place to do this filtering. The patterns themselves need domain review, not structural change. Periodically: audit which rules exclude statements that should have survived; consider moving hard→soft for ambiguous pattern classes.

### Recommended long-term posture
- Stances/signals remain **soft annotations with a known false-positive budget**
- Never expand their use as hard gates
- Future pass: rename `confidence` → `patternStrength` across the shadow layer (requires contract migration)

---

## Layer 1 — Shadow / Evidence

**File:** `src/shadow/ShadowExtractor.ts`

| Computation | Output | Consumer | Status |
|---|---|---|---|
| `extractShadowStatements(models[])` | `ShadowStatement[]` each with: id, modelIndex, text, **stance** (assertive/prescriptive/cautionary/prerequisite/dependent/uncertain), confidence, signals (sequence/tension/conditional), location, fullParagraph | Entire downstream pipeline | active |
| Stance classification (regex-based) | `ShadowStatement.stance` | Shadow paragraphs, claim assembly, fateTracking signalWeight | active |
| Signal detection | `signals.{sequence, tension, conditional}` | fateTracking signalWeight, claimAssembly derivedType | active |

**File:** `src/shadow/ShadowParagraphProjector.ts`

| Computation | Output | Consumer | Status |
|---|---|---|---|
| `projectParagraphs(statements[])` | `ShadowParagraph[]` each with: id, modelIndex, paragraphIndex, statementIds, dominantStance, stanceHints, contested, confidence, signals | Substrate, embeddings, claimAssembly fallback | active |
| `dominantStance` per paragraph | `ShadowParagraph.dominantStance` | NodeLocalStats | active |
| `contested` flag | `ShadowParagraph.contested` | NodeLocalStats | active |

---

## Layer 2 — Geometry / Substrate

**File:** `src/geometry/substrate.ts` + `knn.ts` + `threshold.ts` + `topology.ts` + `nodes.ts`

| Computation | Output | Consumer | Status |
|---|---|---|---|
| `buildGeometricSubstrate(paragraphs, embeddings)` | `GeometricSubstrate` | Everything downstream of geometry | active |
| KNN graph (k=5) | `graphs.knn.edges[]` — each: source, target, similarity, rank | diagnostics position groups | active |
| Mutual KNN graph | `graphs.mutual.edges[]` + `adjacency` | regions, profiles internalDensity, pipelineGates isolationRatio, coverageAudit bridge detection | active |
| Strong graph (softThreshold) | `graphs.strong.edges[]` — edges above similarity threshold | profiles internalDensity/avgInternalSimilarity, pipelineGates, topology | active |
| `NodeLocalStats` per paragraph | top1Sim, avgTopKSim, knnDegree, mutualDegree, strongDegree, **isolationScore**, mutualNeighborhoodPatch | queryRelevance recusant, pipelineGates, profiles isolation, coverageAudit | active |
| `topology` — componentCount, largestComponentRatio, isolationRatio, globalStrongDensity | `substrate.topology` | pipelineGates, diagnostics observations | active |
| `shape` — prior (fragmented/parallel/bimodal/convergent), confidence, fragmentationScore, bimodalityScore, parallelScore | `substrate.shape` | lens derivation | active |

**File:** `src/geometry/enrichment.ts`

| Computation | Output | Consumer | Status |
|---|---|---|---|
| `enrichStatementsWithGeometry(statements, paragraphs, substrate, regions)` | Stamps `ShadowStatement.geometricCoordinates`: {regionId, componentId, isolationScore, paragraphId} | fateTracking (fate classification), claimAssembly geometricSignals | active |

---

## Layer 3 — Geometry Interpretation

**File:** `src/geometry/interpretation/pipelineGates.ts`

| Computation | Output | Consumer | Status |
|---|---|---|---|
| `evaluatePipelineGates(substrate)` | `PipelineGateResult`: verdict (proceed/skip_geometry/trivial_convergence/insufficient_structure), confidence, evidence[], measurements | `buildPreSemanticInterpretation` — gates regions/model-ordering computation | active |

**File:** `src/geometry/interpretation/lens.ts`

| Computation | Output | Consumer | Status |
|---|---|---|---|
| `deriveLens(substrate)` | `AdaptiveLens`: hardMergeThreshold, softThreshold, k, confidence, evidence[] | `buildRegions`, `computeDiagnostics` (position group threshold) | active |

**File:** `src/geometry/interpretation/regions.ts`

| Computation | Output | Consumer | Status |
|---|---|---|---|
| `buildRegions(substrate, paragraphs, lens)` | `RegionizationResult`: regions[] each with id, kind (component/patch), nodeIds[], statementIds[], sourceId, modelIndices[] | profiles, modelOrdering, diagnostics, coverageAudit, enrichment, alignment | active |

**File:** `src/geometry/interpretation/profiles.ts`

| Computation | Output | Consumer | Status |
|---|---|---|---|
| `profileRegions(regions, substrate, paragraphs, paragraphEmbeddings?)` | `RegionProfile[]` each with: **mass.{nodeCount, modelDiversity, modelDiversityRatio}**, **geometry.{internalDensity, isolation, nearestCarrierSimilarity, avgInternalSimilarity}** | modelOrdering, diagnostics | active |

*Removed (Phase 1): `tier`, `tierConfidence`, `purity.*` — categorical labels encoding policy as data.*

**File:** `src/geometry/interpretation/modelOrdering.ts`

| Computation | Output | Consumer | Status |
|---|---|---|---|
| `computePerModelQueryRelevance(queryEmbedding, statementEmbeddings, paragraphs)` | `Map<modelIndex, meanQuerySimilarity>` | `buildPreSemanticInterpretation` → `computeModelOrdering` | active |
| `computeModelOrdering(regions, profiles, substrate, queryRelevanceBoost?)` | `ModelOrderingResult`: **orderedModelIndices[]** (outside-in order), scores[].{irreplaceability, queryRelevanceBoost?, breakdown.{soloCarrierRegions, lowDiversityContribution, totalParagraphsInRegions}}, meta.{queryRelevanceVariance?, adaptiveAlphaFraction?} | Wired — `indexedSourceData` sorted by `orderedModelIndices` before mapper prompt build | active |
| Adaptive alpha blend | `adaptiveAlphaFraction = min(0.25, stddev(perModelBoosts))` — scales query relevance contribution to model score | Internal to `computeModelOrdering` | active |

**File:** `src/geometry/interpretation/diagnostics.ts`

| Computation | Output | Consumer | Status |
|---|---|---|---|
| `computeDiagnostics(preSemantic, postSemantic, substrate?, statementEmbeddings?, paragraphs?)` | `DiagnosticsResult`: observations[] (uncovered_peak, overclaimed_floor, claim_count_outside_range, topology_mapper_divergence, embedding_quality_suspect), **measurements.claimMeasurements[]**, **measurements.edgeMeasurements[]** | Stored as `mapperArtifact.diagnostics` | diagnostic |
| Per-claim: **sourceCoherence** (mean pairwise cosine of source statements) | `ClaimGeometricMeasurement.sourceCoherence` | Stamped on each claim for UI display | diagnostic |
| Per-claim: **embeddingSpread** (stddev of pairwise cosines) | `ClaimGeometricMeasurement.embeddingSpread` | Debug panel | diagnostic |
| Per-claim: **regionSpan** (distinct regions source statements come from) | `ClaimGeometricMeasurement.regionSpan` | Debug panel | diagnostic |
| Per-claim: **sourceModelDiversity** (distinct models in source statements, exact) | `ClaimGeometricMeasurement.sourceModelDiversity` | Debug panel | diagnostic |
| Per-claim: **dominantRegionId** | `ClaimGeometricMeasurement.dominantRegionId` | Debug panel | diagnostic |
| Per-edge: **crossesRegionBoundary** | `EdgeGeographicMeasurement.crossesRegionBoundary` | Debug panel | diagnostic |
| Per-edge: **centroidSimilarity** (cosine between claim source centroids) | `EdgeGeographicMeasurement.centroidSimilarity` | Debug panel | diagnostic |
| Position group count at hardMergeThreshold (union-find on mutual graph) | Used for `claim_count_outside_range` observation | Observation text only | diagnostic |
| Claim graph component count (union-find on edges) | Used for `topology_mapper_divergence` observation | Observation text only | diagnostic |

*Removed (Phase 2): `dominantRegionTier` from ClaimGeometricMeasurement — metadata only, never read downstream.*

**File:** `src/geometry/interpretation/fateTracking.ts`

| Computation | Output | Consumer | Status |
|---|---|---|---|
| `buildStatementFates(statements, claims, queryRelevanceScores?)` | `Map<statementId, StatementFate>`: fate (**primary/supporting/unaddressed/orphan/noise**), regionId, claimIds[], querySimilarity? (for unaddressed), shadowMetadata.{stance, confidence, **signalWeight** (conditional×3 + sequence×2 + tension×1), geometricIsolation} | `buildCompletenessReport` | active |
| `unaddressed` fate | Orphan statements with querySimilarity > 0.55 — query touched this territory but no claim addressed it | `buildCompletenessReport` → `recovery.unaddressedStatements` worklist | active |

*Removed (Phase 4): `getHighSignalOrphans` — zero callers in StepExecutor.*

**File:** `src/geometry/interpretation/coverageAudit.ts`

| Computation | Output | Consumer | Status |
|---|---|---|---|
| `findUnattendedRegions(substrate, paragraphs, claims, regions, statements)` | `UnattendedRegion[]`: id, nodeIds, statementIds, statementCount, modelDiversity, avgIsolation, bridgesTo[] | `buildCompletenessReport` | active |

*Removed (Phase 3): `reason` label (stance_diversity/high_connectivity/bridge_region) — same three likelyClaim heuristics wearing a different name. `Stance` import removed. `stanceVariety` calculation removed.*

**File:** `src/geometry/interpretation/completenessReport.ts`

| Computation | Output | Consumer | Status |
|---|---|---|---|
| `buildCompletenessReport(statementFates, unattendedRegions, statements, totalRegions)` | `CompletenessReport`: statements.{total, inClaims, orphaned, **unaddressed**, noise, coverageRatio}, regions.{total, attended, unattended, coverageRatio}, recovery.{**unaddressedStatements[]**, unattendedRegionPreviews[]} | Stored in artifact | diagnostic |

*Removed (Phase 4): `verdict` block (complete, confidence, recommendation) — unjustified thresholds (0.85/0.8/0.7/0.6) compressing continuous measurements into categorical labels. Also removed: `estimatedMissedClaims` (/3 divisor invented), `highSignalOrphans` (signalWeight-ordered), `unattendedWithLikelyClaims` (likelyClaim is gone).*

~~**File:** `src/geometry/interpretation/regionGates.ts` — **DELETED**~~

~~**Files:** `src/clustering/engine.ts`, `src/clustering/hac.ts` — **DELETED** (Phase 1)~~
- `buildClusters()` — HAC orchestration, only consumer was `regions.ts` via `shouldRunClustering` path. No extractable L1 measurements — `findCentroid` superseded by existing claim centroid logic in alignment/diagnostics; `detectUncertainty` was L2 classification via stance labels.
- `hierarchicalCluster()` — pure L1 algorithm but only has value with the cluster construct. Construct removed.

~~**Types:** `ClusterableItem`, `ParagraphCluster`, `ClusteringResult` from `src/clustering/types.ts` — **DELETED** (Phase 1)~~

~~**Functions:** `buildDistanceMatrix`, `computeCohesion`, `pairwiseCohesion` from `src/clustering/distance.ts` — **DELETED** (Phase 1)~~
- `buildDistanceMatrix` had L2 contamination: stance-adjusted and model-diversity-weighted distances (not honest cosine). Correctly removed.
- `computeCohesion`, `pairwiseCohesion` were L1 but only consumed by `engine.ts`.
- `cosineSimilarity`, `quantizeSimilarity` kept — 6 active consumers across pipeline.

~~**Exports:** `AdaptiveLens.regime`, `AdaptiveLens.shouldRunClustering`, `mapPriorToRegime()`, `Regime` type — **DELETED** (Phase 2)~~
- `mapPriorToRegime()` was a 1:1 identity passthrough. `regime` was just `shape.prior` under a different name. UI updated to read `substrate.shape.prior` directly.

---

## Layer 4 — Query Relevance

**File:** `src/geometry/queryRelevance.ts`

| Computation | Output | Consumer | Status |
|---|---|---|---|
| `computeQueryRelevance({queryEmbedding, statements, statementEmbeddings, ...})` | `QueryRelevanceResult`: statementScores Map | `buildStatementFates` (unaddressed promotion), cognitive artifact debug panel | active |
| Per-statement: **querySimilarity** | `(cosineSimilarity(query, stmtEmb) + 1) / 2` normalized to [0,1] | `buildStatementFates` unaddressed threshold | active |
| Per-statement: **recusant** *(measures isolation — misnamed, rename deferred)* | `1 - normalizedMutualDegree` | Debug panel | diagnostic |

*Removed (Phase 3): `subConsensusCorroboration`, `compositeRelevance`, `tiers`, `meta` (weightsUsed, regionSignalsUsed, distribution). All were either fusing signals at wrong layer or orphaned.*

---

## Layer 5 — ConciergeService / Claim

**File:** `src/ConciergeService/semanticMapper.ts`

| Computation | Output | Consumer | Status |
|---|---|---|---|
| `buildSemanticMapperPrompt(userQuery, responses[])` | Prompt string for LLM | StepExecutor → LLM call | active |
| `parseSemanticMapperOutput(rawText, shadowStatements?)` | `{claims[], edges[], conditionals: []}` — second param unused | StepExecutor claim assembly | active |
| Claim fields from mapper | id, label, text, **supporters[]** (model indices), challenges (directed pointer to challenged claim) | claimAssembly, structural-analysis engine/builders/patterns | active |
| Edge fields from mapper | from, to, type (supports/conflicts/tradeoff/prerequisite) | surveyMapper (conflicts+tradeoffs only), traversalGraph | active |

**File:** `src/ConciergeService/surveyMapper.ts`

| Computation | Output | Consumer | Status |
|---|---|---|---|
| `buildSurveyMapperPrompt(userQuery, claims, edges, batchTexts)` | Prompt string for LLM — operates on conflicts+tradeoffs only | StepExecutor → LLM call | active |
| `parseSurveyMapperOutput(rawText)` | `{gates[]}` — validated: forced_choice or conditional_gate, ≥2 claims, question | StepExecutor gate routing | active |
| forced_choice gate | → `gateQuestionByClaimPair` → attached to conflict edges | traversalGraph | active |
| conditional_gate | → `unifiedConditionals` → attached to claims | traversalGraph | active |

**File:** `src/ConciergeService/claimAssembly.ts`

| Computation | Output | Consumer | Status |
|---|---|---|---|
| `reconstructProvenance(claims, statements, paragraphs, paragraphEmbeddings, regions, totalModelCount, statementEmbeddings?)` | `LinkedClaim[]` each with: sourceStatementIds (cosine-matched by thresholds), sourceStatements[], sourceRegionIds (stmt→para→region lookup), supportRatio, hasConditional/Sequence/TensionSignal | surveyMapper, fateTracking, alignment, traversal serialization | active |
| Provenance matching (paragraph-first, statement-second) | Paragraph similarity > 0.45 → candidate statements → statement similarity > 0.55 → collect statement IDs; final list sorted by statement ID | sourceStatementIds | active |
| Statement-match fallback (no stmt-level matches) | Use union of all statementIds from the paragraph-anchor candidate set | sourceStatementIds when stmt-level returns empty | active |
| Paragraph-only matching (no statement embeddings) | Paragraph similarity > 0.5; take top-5 paragraphs and union their statementIds | sourceStatementIds | active |

**File:** `src/ConciergeService/claimProvenance.ts`

| Computation | Output | Consumer | Status |
|---|---|---|---|
| `computeStatementOwnership(claims)` | `Map<statementId, Set<claimId>>` — inverse index | **Wired to debug panel** (`mapperArtifact.claimProvenance.statementOwnership`) | diagnostic |
| `computeClaimExclusivity(claims, ownership)` | `Map<claimId, {exclusiveIds[], sharedIds[], exclusivityRatio}>` | **Wired to debug panel** (`mapperArtifact.claimProvenance.claimExclusivity`) | diagnostic |
| `computeClaimOverlap(claims)` | `ClaimOverlapEntry[]` — pairwise Jaccard on full sourceStatementIds, sorted descending, jaccard > 0 only | **Wired to debug panel** (`mapperArtifact.claimProvenance.claimOverlap`) | diagnostic |

*These are the first entries of the Claim entity profile (`src/profiles/` — infrastructure pending).*

---

## Layer 5.5 — Blast Radius Filter (Survey Gating)

**File:** `src/core/blast-radius/blastRadiusFilter.ts`

| Computation | Output | Consumer | Status |
|---|---|---|---|
| `computeBlastRadiusFilter(input)` | `BlastRadiusFilterResult`: scores[] (per-claim composite + components + suppressionReason), axes[] (clustered claim groups), questionCeiling (0–3), skipSurvey | StepExecutor survey-mapper scoping + zero-question skip | active |
| Per-claim base composite | `0.30*cascadeBreadth + 0.25*exclusiveEvidence + 0.20*normalizedLeverage + 0.15*queryRelevance + 0.10*articulationPoint` | Drives axes ordering + gate priority | active |
| Modifiers (continuous) + floor suppression | Consensus discount; sole-source off-topic discount; redundancy discount; **floor** `composite < 0.20` → suppressed | Candidate set for axes | active |
| Axis clustering (provenance overlap) | Connected components over claim pairs with Jaccard > 0.30 | One axis ≈ one question target | active |
| Question ceiling (hard cap 3) | Depends on conflict cluster count + sole-source outliers | Limits axes passed to survey mapper | active |

**Blast radius inputs (what must already exist upstream):**

| Input | Source | Notes |
|---|---|---|
| `claims` (enriched claims) | `computeStructuralAnalysis(...)` output in `PromptMethods` | Must include fields: leverage, supportRatio, supporters, sourceStatementIds, isLeverageInversion, isKeystone |
| `cascadeRisks`, `articulationPoints`, `convergenceRatio` | Structural analysis (`computeStructuralAnalysis`) | Used for cascade breadth, articulation signal, and zero-question gate |
| `exclusivity`, `overlap` | Claim provenance (`computeClaimExclusivity`, `computeClaimOverlap`) | Used for exclusive evidence loss + redundancy clustering/discount |
| `queryRelevanceScores` | Query relevance (`computeQueryRelevance`) | Map of statementId → querySimilarity, aggregated to claim-level mean |

---

## Layer 6 — Geometry / Alignment

**File:** `src/geometry/alignment.ts`

| Computation | Output | Consumer | Status |
|---|---|---|---|
| `buildClaimVectors(enrichedClaims, statementEmbeddings, dimensions)` | Per-claim centroid vectors from source statement embeddings | `computeAlignment` | active |
| `computeAlignment(claimVectors, regions, regionProfiles, statementEmbeddings)` | globalCoverage, unattendedRegionIds[], splitAlerts[], mergeAlerts[] | Stored in artifact (alignmentResult) | diagnostic |

---

## Known Dead Code — Candidates for Removal

| Item | File | Reason |
|---|---|---|
| ~~`deriveRegionConditionalGates()`~~ | ~~`regionGates.ts`~~ | **DELETED** — file removed |

---

## Key Gaps / Wiring Issues

| Gap | Location | Notes |
|---|---|---|
| ~~`orderedModelIndices` never controls prompt order~~ | `StepExecutor.js` | **FIXED** — `indexedSourceData` now sorted by `orderedModelIndices` before mapper prompt build. Falls back to `citationOrder` if geometry didn't run. |
| Geometric hints never reach semantic mapper | `semanticMapper.ts` | `buildSemanticMapperPrompt` has no hints param; architecture §3.1 said they would |
| `src/profiles/` directory | Post-audit infrastructure | `claimProvenance.ts` is its first content — wired to debug panel as interim |

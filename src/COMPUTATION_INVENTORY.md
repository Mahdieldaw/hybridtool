# Computation Inventory — Working Audit Reference

All calculations currently in the codebase, organized by pipeline layer.
Status: **active** = wired in happy path | **diagnostic** = computed, stored in artifact, not decision-making | **dead** = exported but no callers outside own file.

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
| `deriveLens(substrate)` | `AdaptiveLens`: regime, shouldRunClustering, hardMergeThreshold, softThreshold, k, confidence, evidence[] | `buildRegions`, `computeDiagnostics` (position group threshold) | active |

**File:** `src/geometry/interpretation/regions.ts`

| Computation | Output | Consumer | Status |
|---|---|---|---|
| `buildRegions(substrate, paragraphs, lens, clusters?)` | `RegionizationResult`: regions[] each with id, kind (cluster/component/patch), nodeIds[], statementIds[], sourceId, modelIndices[] | profiles, modelOrdering, diagnostics, coverageAudit, enrichment, alignment | active |

**File:** `src/geometry/interpretation/profiles.ts`

| Computation | Output | Consumer | Status |
|---|---|---|---|
| `profileRegions(regions, substrate, paragraphs, paragraphEmbeddings?)` | `RegionProfile[]` each with: **mass.{nodeCount, modelDiversity, modelDiversityRatio}**, **geometry.{internalDensity, isolation, nearestCarrierSimilarity, avgInternalSimilarity}** | modelOrdering, diagnostics (L1 tier checks via TIER_THRESHOLDS) | active |
| `TIER_THRESHOLDS` constant | Numeric thresholds: peak/hill minModelDiversityRatio, minModelDiversityAbsolute, minInternalDensity | diagnostics.ts L1 peak/floor classification | active |

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
| `findUnattendedRegions(substrate, paragraphs, claims, regions, statements)` | `UnattendedRegion[]`: id, statementIds, modelDiversity, avgIsolation, reason (stance_diversity/high_connectivity/bridge_region/isolated_noise), bridgesTo[] | `buildCompletenessReport` | active |

*Removed (Phase 4): `likelyClaim` field and the three heuristics (stanceVariety≥2, avgMutualDegree≥2, bridgesTo>1) that fed it.*

**File:** `src/geometry/interpretation/completenessReport.ts`

| Computation | Output | Consumer | Status |
|---|---|---|---|
| `buildCompletenessReport(statementFates, unattendedRegions, statements, totalRegions)` | `CompletenessReport`: statements.{total, inClaims, orphaned, **unaddressed**, noise, coverageRatio}, regions.{total, attended, unattended, coverageRatio}, verdict.{complete, confidence, **recommendation**}, recovery.{**unaddressedStatements[]**, unattendedRegionPreviews[]} | Stored in artifact | diagnostic |

*Removed (Phase 4): `estimatedMissedClaims` (`/3` divisor invented), `highSignalOrphans` (signalWeight-ordered), `unattendedWithLikelyClaims` (likelyClaim is gone).*

~~**File:** `src/geometry/interpretation/regionGates.ts` — **DELETED**~~

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
| `reconstructProvenance(claims, statements, paragraphs, paragraphEmbeddings, regions, totalModelCount, statementEmbeddings?)` | `LinkedClaim[]` each with: sourceStatementIds (cosine-matched, top-12), sourceStatements[], sourceRegionIds (stmt→para→region lookup), supportRatio, hasConditional/Sequence/TensionSignal | surveyMapper, fateTracking, alignment, traversal serialization | active |
| Statement-level cosine matching | Threshold 0.45, **all statements** (no supporter filter), top-12 | sourceStatementIds | active |
| Paragraph-level cosine fallback | Threshold 0.5, top-5 paragraphs, absorb all their statements | sourceStatementIds when stmt-level returns empty | active |
| `reconstructConditionProvenance(conditions, statements, statementEmbeddings)` | `ConditionProvenance[]` — links gate questions to statements by cosine (threshold 0.45, top-12) | **Not wired** — survey gates parsed in StepExecutor but conditions not passed to this function | not wired |
| `getGateProvenance`, `getConflictProvenance`, `validateProvenance` | Utility helpers | Not called from StepExecutor | needs check |

**File:** `src/ConciergeService/claimProvenance.ts`

| Computation | Output | Consumer | Status |
|---|---|---|---|
| `computeStatementOwnership(claims)` | `Map<statementId, Set<claimId>>` — inverse index | **Wired to debug panel** (`mapperArtifact.claimProvenance.statementOwnership`) | diagnostic |
| `computeClaimExclusivity(claims, ownership)` | `Map<claimId, {exclusiveIds[], sharedIds[], exclusivityRatio}>` | **Wired to debug panel** (`mapperArtifact.claimProvenance.claimExclusivity`) | diagnostic |
| `computeClaimOverlap(claims)` | `ClaimOverlapEntry[]` — pairwise Jaccard on full sourceStatementIds, sorted descending, jaccard > 0 only | **Wired to debug panel** (`mapperArtifact.claimProvenance.claimOverlap`) | diagnostic |

*These are the first entries of the Claim entity profile (`src/profiles/` — infrastructure pending).*

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
| `assembleClaims()` | `claimAssembly.ts` | Zero callers outside file |
| `getGateProvenance`, `getConflictProvenance`, `validateProvenance` | `claimAssembly.ts` | Not called from StepExecutor — needs verification |

---

## Key Gaps / Wiring Issues

| Gap | Location | Notes |
|---|---|---|
| ~~`orderedModelIndices` never controls prompt order~~ | `StepExecutor.js` | **FIXED** — `indexedSourceData` now sorted by `orderedModelIndices` before mapper prompt build. Falls back to `citationOrder` if geometry didn't run. |
| Geometric hints never reach semantic mapper | `semanticMapper.ts` | `buildSemanticMapperPrompt` has no hints param; architecture §3.1 said they would |
| `reconstructConditionProvenance` not wired | `claimAssembly.ts` | Confirmed: survey gates produced, but conditions not passed to this function. Deferred. |
| `src/profiles/` directory | Post-audit infrastructure | `claimProvenance.ts` is its first content — wired to debug panel as interim |

# Libraries

> **Navigation aid.** Library inventory extracted via AST. Read the source files listed here before modifying exported functions.

**123 library files** across 12 modules

## Ui (37 files)

- `ui\utils\copy-format-utils.ts` — formatDecisionMapForMd, formatBatchResponseParts, formatProviderResponseForMd, formatSessionForMarkdown, formatSingularityResponse, formatMapperResponse, …
- `ui\hooks\instrument\useInstrumentState.ts` — useInstrumentState, InstrumentState, InstrumentActions, PipelineLayer, SelectedEntity, EvidenceScope
- `ui\utils\provider-helpers.ts` — getProviderConfig, getProviderName, getProviderColor, getProviderLogo, getProviderAbbreviation, resolveProviderIdFromCitationOrder
- `ui\config\provider-registry.ts` — getProviderById, ProviderConfig, INITIAL_PROVIDERS, PROVIDER_COLORS, PROVIDER_ACCENT_COLORS
- `ui\hooks\reading\usePassageResolver.ts` — usePassageResolver, ResolvedPassage, ResolvedUnclaimedGroup, PassageResolver, ResolvedItem
- `ui\hooks\providers\useProviderStatus.ts` — useProviderStatus, UseProviderStatusOptions, UseProviderStatusReturn
- `ui\hooks\reading\useCorpusSearch.ts` — useCorpusSearch, CorpusSearchHit, ProbeSearchResult
- `ui\instrument\expression-engine.ts` — compileExpression, validateExpression, CompiledExpression
- `ui\utils\math-utils.ts` — containsMath, safeArr, pearsonR
- `ui\utils\turn-helpers.ts` — createOptimisticAiTurn, applyStreamingTurnUpdate, normalizeBackendRoundsToTurns
- `ui\hooks\instrument\useClaimCentroids.ts` — useClaimCentroids, ClaimCentroid
- `ui\hooks\instrument\useEvidenceRows.ts` — useEvidenceRows, EvidenceRow
- `ui\hooks\instrument\useParagraphRows.ts` — useParagraphRows, ParagraphRow
- `ui\hooks\instrument\useZoomPan.ts` — useZoomPan, Transform
- `ui\hooks\reading\useArtifactResolution.ts` — useArtifactResolution, ArtifactResolution
- `ui\hooks\reading\usePassageHighlight.ts` — usePassageHighlight, ParagraphHighlight
- `ui\hooks\ui\useSingularityOutput.ts` — useSingularityOutput, SingularityOutputState
- `ui\hooks\workflow\useSingularityTrigger.ts` — useSingularityMode, SingularityTransitionOptions
- `ui\utils\math-renderer.ts` — loadMathPlugins, renderMathInMarkdown
- `ui\hooks\chat\useChat.ts` — useChat
- `ui\hooks\chat\usePortMessageHandler.ts` — usePortMessageHandler
- `ui\hooks\chat\useRoundActions.ts` — useRoundActions
- `ui\hooks\providers\useProviderActions.ts` — useProviderActions
- `ui\hooks\providers\useProviderArtifact.ts` — useProviderArtifact
- `ui\hooks\providers\useSmartProviderDefaults.ts` — useSmartProviderDefaults
- _…and 12 more files_

## Execution (16 files)

- `src\execution\deterministic-pipeline.ts` — computeDerivedFields, buildSubstrateGraph, assembleMapperArtifact, executeArtifactPipeline, buildArtifactForProvider, computeProbeGeometry
- `src\execution\io\context-resolver.ts` — aggregateBatchOutputs, findLatestMappingOutput, extractUserMessage, ContextResolver
- `src\execution\utils\reactive-bridge.ts` — buildReactiveBridge, buildReactiveBridgeCached, ReactiveBridge, StoredAnalysis
- `src\execution\preflight-validator.ts` — getProviderUrl, createAuthErrorMessage, runPreflight
- `src\execution\pipeline\singularity-phase.ts` — runSingularityLLM, executeSingularityPhase
- `src\execution\io\context-manager.ts` — ContextManager
- `src\execution\io\persistence-coordinator.ts` — PersistenceCoordinator
- `src\execution\io\streaming-manager.ts` — StreamingManager
- `src\execution\io\turn-emitter.ts` — TurnEmitter
- `src\execution\pipeline\batch-phase.ts` — executeBatchPhase
- `src\execution\pipeline\mapping-phase.ts` — executeMappingPhase
- `src\execution\pipeline\recompute-handler.ts` — handleRecompute
- `src\execution\utils\geometry-runner.ts` — buildGeometryAsync
- `src\execution\utils\llm-runner.ts` — executeGenericSingleStep
- `src\execution\workflow-compiler.ts` — WorkflowCompiler
- `src\execution\workflow-engine.ts` — WorkflowEngine

## Providers (15 files)

- `src\providers\gemini.js` — GeminiProviderError, ColdStartDetectedError, GeminiSessionApi, GeminiProviderController, GeminiModels
- `src\providers\grok-signature.js` — generateSign, between, parseVerificationToken, parseSvgData, parseXValues
- `src\providers\chatgpt.js` — ChatGPTProviderError, ChatGPTProviderController, ChatGPTSessionApi, ChatGPTModels
- `src\providers\claude.js` — ClaudeProviderError, ClaudeSessionApi, ClaudeProviderController, ClaudeModels
- `src\providers\grok.js` — GrokProviderError, GrokSessionApi, GrokProviderController, GrokModels
- `src\providers\provider-locks.ts` — getProviderLocks, setProviderLock, subscribeToLockChanges, ProviderLocks
- `src\providers\qwen.js` — QwenProviderError, ServerTransientError, QwenSessionApi, QwenProviderController
- `src\providers\health\provider-health-gate.ts` — runWithProviderHealth, RunWithHealthOptions, HealthTrackerLike
- `src\providers\grok-crypto.js` — generateKeys, signChallenge
- `src\providers\health\provider-health-tracker.js` — getHealthTracker, ProviderHealthTracker
- `src\providers\chatgpt-adapter.js` — ChatGPTAdapter
- `src\providers\claude-adapter.js` — ClaudeAdapter
- `src\providers\gemini-adapter.js` — GeminiAdapter
- `src\providers\grok-adapter.js` — GrokAdapter
- `src\providers\qwen-adapter.js` — QwenAdapter

## Shared (10 files)

- `shared\corpus-utils.ts` — deriveArtifactIndex, buildCorpusTree, buildCorpusIndex, getParagraphsForClaim, getModelsForClaim, getBasinsForClaim, …
- `shared\measurement-registry.ts` — assertMeasurementConsumer, collectMeasurementViolation, getCollectedMeasurementViolations, clearCollectedMeasurementViolations, Consumer, MeasurementStatus, …
- `shared\types\turns.ts` — isUserTurn, isAiTurn, ProbeResult, ProbeCorpusHit, ProbeSessionResponse, ProbeSession, …
- `shared\provider-config.ts` — canonicalCitationOrder, buildCitationSourceOrder, selectBestProvider, isProviderAuthorized, ProviderRole, CANONICAL_PROVIDER_ORDER, …
- `shared\types\provider.ts` — HTOSError, ProviderAuthError, ProviderError, ProviderKey, ProviderErrorType, HTOSErrorCode
- `shared\citation-utils.ts` — normalizeProviderId, normalizeCitationSourceOrder, resolveProviderId, resolveModelDisplayName, getCitationSourceOrder
- `shared\parsing-utils.ts` — repairJson, extractJsonObject, extractJsonFromContent, parseSemanticMapperOutput
- `shared\artifact-processor.ts` — ArtifactProcessor, Artifact, ProcessedResponse
- `shared\think-utils.ts` — computeThinkFlag, ComputeThinkFlagArgs, AI_THINK_FLAG
- `shared\cognitive-artifact.ts` — buildCognitiveArtifact

## Geometry (9 files)

- `src\geometry\types.ts` — isDegenerate, ExtendedSimilarityStats, NodeLocalStats, PairwiseFieldStats, PairwiseField, MutualRankEdge, …
- `src\geometry\measure.ts` — quantize, computeExtendedStatsFromArray, buildPairwiseField, buildMutualRankGraph, computeNodeStats, measureSubstrate, …
- `src\geometry\annotate.ts` — enrichStatementsWithGeometry, computeQueryRelevance, annotateStatements, EnrichmentResult, QueryRelevanceStatementScore, QueryRelevanceResult, …
- `src\geometry\algorithms\gap-regionalization.ts` — computeGapRegionalization, GapRegionalizationResult, GapRegion, NodeGapProfile, GapRegionalizationMeta
- `src\geometry\interpret.ts` — identifyPeriphery, interpretSubstrate, buildPreSemanticInterpretation
- `src\geometry\engine.ts` — buildGeometryPipeline, GeometryPipelineResult
- `src\geometry\layout.ts` — computeUmapLayout, Layout2DResult
- `src\geometry\algorithms\basin-inversion-bayesian.ts` — computeBasinInversion
- `src\geometry\algorithms\basin-inversion.ts` — computeBasinInversion

## Persistence (8 files)

- `src\persistence\transactions.ts` — withTransaction, batchWrite, batchDelete, updateWithVersionCheck, multiStoreTransaction, promisifyRequest, …
- `src\persistence\persistence-monitor.ts` — PersistenceMonitor, PersistenceOperationRecord, PersistencePerformanceMetrics, PersistenceErrorRecord, PersistenceConnectionRecord, PersistenceMonitorMetrics, …
- `src\persistence\database.ts` — openDatabase, getCurrentSchemaVersion, checkDatabaseHealth, deleteDatabase, SCHEMA_VERSION, STORE_CONFIGS
- `src\persistence\embedding-codec.ts` — packEmbeddingMap, unpackEmbeddingMap
- `src\persistence\schema-verification.ts` — verifySchemaAndRepair, SchemaHealth
- `src\persistence\simple-indexeddb-adapter.ts` — SimpleIndexedDBAdapter, SimpleRecord
- `src\persistence\index.ts` — initializePersistenceLayer
- `src\persistence\session-manager.ts` — SessionManager

## Provenance (8 files)

- `src\provenance\surface.ts` — buildMassEligibilityDiagnostic, computeNounSurvivalRatio, computeTopologicalSurface, buildSourceContinuityMap, SurfaceInput, SurfaceOutput, …
- `src\provenance\measure.ts` — emptyClaimFootprintMeasurement, computeClaimFootprintMeasurement, measureProvenance, ClaimExclusivity, MeasurePhaseInput, MeasurePhaseOutput
- `src\provenance\structure.ts` — analyzeGlobalStructure, StructurePhaseOutput, computeStructuralAnalysis, runStructurePhase
- `src\provenance\claim-structural-fingerprint.ts` — computeContestedShareRatio, buildClaimStructuralFingerprints, ClaimStructuralFingerprintInput
- `src\provenance\engine.ts` — buildProvenancePipeline, ProvenancePipelineInput, ProvenancePipelineOutput
- `src\provenance\semantic-mapper.ts` — buildSemanticMapperPrompt, parseSemanticMapperOutput, ParseResult
- `src\provenance\validate.ts` — validateEdgesAndAllegiance, ValidateInput, ValidateOutput
- `src\provenance\classify.ts` — computeStatementClassification, ClassifyPhaseInput

## Clustering (4 files)

- `src\clustering\embeddings.ts` — structuredTruncate, stripInlineMarkdown, cleanupPendingEmbeddingsBuffers, generateEmbeddings, generateTextEmbeddings, generateStatementEmbeddings, …
- `src\clustering\config.ts` — getConfigForModel, EmbeddingConfig, EmbeddingModelEntry, EMBEDDING_MODELS, DEFAULT_CONFIG
- `src\clustering\corpus-search.ts` — searchCorpus, CorpusSearchHit
- `src\clustering\distance.ts` — cosineSimilarity

## Concierge-service (4 files)

- `src\concierge-service\editorial-mapper.ts` — buildPassageIndex, buildEditorialPrompt, parseEditorialOutput, IndexedPassage, IndexedUnclaimedGroup, EditorialParseResult
- `src\concierge-service\concierge-service.ts` — buildConciergePrompt, ConciergePromptOptions, ConciergeService
- `src\concierge-service\evidence-substrate.ts` — buildLookupCacheFromIndex, buildEvidenceSubstrate
- `src\concierge-service\position-brief.ts` — buildPositionBriefFromClaims, buildPositionBrief

## Errors (4 files)

- `src\errors\retry.ts` — getPolicy, policyForErrorType, logRetryEvent, computeBackoffMs, retryWithPolicy, RetryPolicy, …
- `src\errors\handler.ts` — createProviderAuthError, createMultiProviderAuthError, getErrorMessage, normalizeError, ErrorHandler, PROVIDER_CONFIG, …
- `src\errors\classifier.ts` — classifyError, formatRetryAfter, isProviderAuthError, isDefinitiveAuthError, isRateLimitError, isNetworkError
- `src\errors\infra-logger.ts` — logInfraError

## Shadow (4 files)

- `src\shadow\statement-types.ts` — getStancePriority, classifyStance, detectSignals, SignalPatterns, Stance, STANCE_PRIORITY, …
- `src\shadow\shadow-extractor.ts` — extractShadowStatements, TableCellMeta, ShadowStatement, ShadowStatementLocation, ShadowExtractionResult
- `src\shadow\exclusion-rules.ts` — isExcluded, ExclusionResult, ExclusionRule, EXCLUSION_RULES
- `src\shadow\shadow-paragraph-projector.ts` — projectParagraphs, ShadowParagraph, ParagraphProjectionResult

## System (4 files)

- `src\system\dnr-utils.ts` — DNRUtils, ProviderDNRGate
- `src\system\service-registry.ts` — ServiceRegistry, services
- `src\system\connection-handler.ts` — ConnectionHandler
- `src\system\lifecycle-manager.ts` — LifecycleManager

---
_Back to [overview.md](./overview.md)_
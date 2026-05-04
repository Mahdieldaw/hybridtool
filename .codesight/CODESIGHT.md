# project-htos — AI Context Map

> **Stack:** raw-http | none | react | typescript

> 0 routes | 0 models | 84 components | 123 lib files | 6 env vars | 4 middleware | 0% test coverage
> **Token savings:** this file is ~10,900 tokens. Without it, AI exploration would cost ~70,200 tokens. **Saves ~59,300 tokens per conversation.**
> **Last scanned:** 2026-05-04 20:28 — re-run after significant changes

---

# Components

- **App** — `ui\App.tsx`
- **AiTurnBlock** — props: aiTurn — `ui\chat\AiTurnBlock.tsx`
- **ChatInput** — props: onStartMapping, canShowMapping, mappingTooltip, mappingActive — `ui\chat\ChatInput.tsx`
- **ChatView** — `ui\chat\ChatView.tsx`
- **CouncilOrbs** — props: turnId, providers, voiceProviderId, onOrbClick, onCrownMove, isTrayExpanded, variant, visibleProviderIds, isEditMode, workflowProgress — `ui\chat\CouncilOrbs.tsx`
- **CouncilOrbsVertical** — `ui\chat\CouncilOrbsVertical.tsx`
- **MessageRow** — props: turnId — `ui\chat\MessageRow.tsx`
- **SingularityOutputView** — props: aiTurn, singularityState, onRecompute, isLoading, copyAllText — `ui\chat\SingularityOutputView.tsx`
- **CognitiveOutputRenderer** — props: aiTurn, singularityState — `ui\chat\TurnOutputRouter.tsx`
- **UserTurnBlock** — props: userTurn — `ui\chat\UserTurnBlock.tsx`
- **WelcomeScreen** — props: onSendPrompt, isLoading — `ui\chat\WelcomeScreen.tsx`
- **BayesianBasinCard** — props: artifact, _selectedEntity — `ui\instrument\cards\BayesianBasinCard.tsx`
- **RoutingCard** — props: artifact, selectedClaim — `ui\instrument\cards\BlastRadiusCard.tsx`
- **BlastVernalInline** — props: artifact — `ui\instrument\cards\BlastRadiusCard.tsx`
- **MixedResolutionInline** — props: artifact — `ui\instrument\cards\BlastRadiusCard.tsx`
- **BlastRadiusCard** — props: artifact, selectedEntity — `ui\instrument\cards\BlastRadiusCard.tsx`
- **Histogram** — props: values, bins, rangeMin, rangeMax, markers, height — `ui\instrument\cards\CardBase.tsx`
- **BinHistogram** — props: bins, binMin, binMax, binWidth, markers, height, zoneBounds — `ui\instrument\cards\CardBase.tsx`
- **StatRow** — props: label, value, color, title — `ui\instrument\cards\CardBase.tsx`
- **CardSection** — props: title, badge — `ui\instrument\cards\CardBase.tsx`
- **InterpretiveCallout** — props: text, variant — `ui\instrument\cards\CardBase.tsx`
- **SortableTable** — props: columns, rows, defaultSortKey, defaultSortDir, emptyMessage, maxRows — `ui\instrument\cards\CardBase.tsx`
- **ClaimDensityCard** — props: artifact — `ui\instrument\cards\ClaimDensityCard.tsx`
- **ClaimStatementsCard** — props: artifact — `ui\instrument\cards\ClaimStatementsCard.tsx`
- **CongruenceCard** — props: artifact — `ui\instrument\cards\CongruenceCard.tsx`
- **GeometryCard** — props: artifact, _selectedEntity — `ui\instrument\cards\GeometryCard.tsx`
- **PassageOwnershipCard** — props: artifact — `ui\instrument\cards\PassageOwnershipCard.tsx`
- **PeripheralNodeCard** — props: artifact — `ui\instrument\cards\PeripheralNodeCard.tsx`
- **RegionsCard** — props: artifact, _selectedEntity — `ui\instrument\cards\RegionsCard.tsx`
- **StatementClassificationCard** — props: artifact — `ui\instrument\cards\StatementClassificationCard.tsx`
- **SubstrateSnapshotCard** — props: artifact, _selectedEntity — `ui\instrument\cards\SubstrateSnapshotCard.tsx`
- **ClaimDetailDrawer** — props: claim, artifact, narrativeText, citationSourceOrder, variant, collapsed, onToggleCollapsed, onClose, onClaimNavigate — `ui\instrument\ClaimDetailDrawer.tsx`
- **ColumnPicker** — props: allColumns, visibleColumnIds, _defaultColumnIds, onToggle, onAddComputed, onReset — `ui\instrument\ColumnPicker.tsx`
- **RiskDonutGlyph** — props: cx, cy, rv, isSel, isHov — `ui\instrument\components\RiskDonutGlyph.tsx`
- **TooltipOverlay** — props: tooltip — `ui\instrument\components\TooltipOverlay.tsx`
- **ContextStrip** — props: artifact, className — `ui\instrument\ContextStrip.tsx`
- **CrossSignalComparePanel** — props: artifact, selectedLayer — `ui\instrument\CrossSignalComparePanel.tsx`
- **DecisionMapSheet** — `ui\instrument\DecisionMapSheet.tsx`
- **EvidenceTable** — props: rows, columns, viewConfig, scope, mode, bottomInset, onSort, onGroup, _onColumnToggle, onRowClick — `ui\instrument\EvidenceTable.tsx`
- **MapperSelector** — props: aiTurn, activeProviderId — `ui\instrument\MapperSelector.tsx`
- **MetricsRibbon** — props: artifact, analysis, problemStructure — `ui\instrument\MetricsRibbon.tsx`
- **NarrativePanel** — props: narrativeText, activeMappingPid, artifact, aiTurnId, rawMappingText — `ui\instrument\NarrativePanel.tsx`
- **ParagraphSpaceView** — props: graph, mutualEdges, regions, basinResult, disabled, citationSourceOrder, paragraphs, claimCentroids, mapperEdges, selectedClaimId — `ui\instrument\ParagraphSpaceView.tsx`
- **RefSection** — props: label, expanded, onToggle, copyText — `ui\instrument\ReferenceSection.tsx`
- **StructuralSummary** — props: analysis, problemStructure, layers — `ui\instrument\StructuralSummary.tsx`
- **StructureGlyph** — props: pattern, residualPattern, claimCount, width, height, onClick — `ui\instrument\StructureGlyph.tsx`
- **SupporterOrbs** — props: supporters, citationSourceOrder, size — `ui\instrument\SupporterOrbs.tsx`
- **ToggleBar** — props: state, actions, hasBasinData — `ui\instrument\ToggleBar.tsx`
- **ClaimRibbon** — props: artifact, focusedClaimId, onFocusClaim — `ui\reading\ClaimRibbon.tsx`
- **ConflictPair** — props: anchor, alternative — `ui\reading\ConflictPair.tsx`
- **ContextCollapse** — props: items — `ui\reading\ContextCollapse.tsx`
- **CorpusSearchPanel** — props: aiTurnId, citationSourceOrder — `ui\reading\CorpusSearchPanel.tsx`
- **EditorialDocument** — props: ast, artifact, citationSourceOrder, onCollapse, onClose — `ui\reading\EditorialDocument.tsx`
- **EditorialPreview** — props: ast, onExpand — `ui\reading\EditorialPreview.tsx`
- **ModelColumn** — props: artifact, modelIndex, modelName, focusedClaimId, highlightMap — `ui\reading\ModelColumn.tsx`
- **ModelGrid** — props: artifact, citationSourceOrder, focusedClaimId, highlightMap — `ui\reading\ModelGrid.tsx`
- **OrientationLine** — props: text — `ui\reading\OrientationLine.tsx`
- **PassageBlock** — props: resolved, role — `ui\reading\PassageBlock.tsx`
- **ThreadIndex** — props: threads, threadOrder, onJumpToThread — `ui\reading\ThreadIndex.tsx`
- **ThreadSection** — props: thread, resolver, threadNumber — `ui\reading\ThreadSection.tsx`
- **CopyButton** — props: text, html, label, buttonText, variant, className, onCopy, disabled — `ui\shared\CopyButton.tsx`
- **MenuIcon** — props: className, style — `ui\shared\Icons.tsx`
- **ChevronDownIcon** — props: className, style — `ui\shared\Icons.tsx`
- **ChevronRightIcon** — props: className, style — `ui\shared\Icons.tsx`
- **ChevronUpIcon** — props: className, style — `ui\shared\Icons.tsx`
- **BotIcon** — props: className, style — `ui\shared\Icons.tsx`
- **UserIcon** — props: className, style — `ui\shared\Icons.tsx`
- **ListIcon** — props: className, style, size — `ui\shared\Icons.tsx`
- **PlusIcon** — props: className, style — `ui\shared\Icons.tsx`
- **TrashIcon** — props: className, style — `ui\shared\Icons.tsx`
- **EllipsisHorizontalIcon** — props: className, style — `ui\shared\Icons.tsx`
- **SettingsIcon** — props: className, style — `ui\shared\Icons.tsx`
- **ListContext** — props: content, components, className — `ui\shared\MarkdownDisplay.tsx`
- **Banner** — `ui\shell\chrome\Banner.tsx`
- **Header** — `ui\shell\chrome\Header.tsx`
- **HistoryPanel** — `ui\shell\chrome\HistoryPanel.tsx`
- **PipelineErrorBanner** — props: type, failedProviderId, onRetry, onExplore, onContinue, compact, errorMessage, requiresReauth, retryable — `ui\shell\chrome\PipelineErrorBanner.tsx`
- **ReconnectOverlay** — props: visible, onReconnect — `ui\shell\chrome\ReconnectOverlay.tsx`
- **RenameDialog** — props: isOpen, onClose, onRename, defaultTitle, isRenaming — `ui\shell\chrome\RenameDialog.tsx`
- **SettingsPanel** — `ui\shell\chrome\SettingsPanel.tsx`
- **ArtifactOverlay** — props: artifact, onClose — `ui\shell\layout\ArtifactOverlay.tsx`
- **ModelResponsePanel** — props: turnId, providerId, sessionId, onClose — `ui\shell\layout\ModelResponsePanel.tsx`
- **ResizableSplitLayout** — props: leftPane, rightPane, isSplitOpen, controlledRatio, onRatioChange, minRatio, maxRatio, dividerContent, className, style — `ui\shell\layout\ResizableSplitLayout.tsx`
- **SplitPaneRightPanel** — `ui\shell\layout\SplitPaneRightPanel.tsx`

---

# Libraries

- `shared\artifact-processor.ts`
  - class ArtifactProcessor
  - interface Artifact
  - interface ProcessedResponse
- `shared\citation-utils.ts`
  - function normalizeProviderId: (backendId) => string
  - function normalizeCitationSourceOrder: (rawCitationOrder, string | number> | null) => string[]
  - function resolveProviderId: (modelIndex, citationSourceOrder?, any> | null) => string | null
  - function resolveModelDisplayName: (modelIndex, citationSourceOrder?, any> | null) => string
  - function getCitationSourceOrder: (artifact) => Record<string | number, string> | null
- `shared\cognitive-artifact.ts` — function buildCognitiveArtifact: (mapper?, pipeline?) => any | null
- `shared\corpus-utils.ts`
  - function deriveArtifactIndex: (artifact) => CorpusIndex | null
  - function buildCorpusTree: (shadowStatements, shadowParagraphs) => CorpusTree
  - function buildCorpusIndex: (tree, enrichedClaims, claimStatementIds?, string[]> | Record<string, string[]>) => CorpusIndex
  - function getParagraphsForClaim: (index, claimId) => string[]
  - function getModelsForClaim: (index, claimId) => number[]
  - function getBasinsForClaim: (index, claimId) => (number | null)[]
  - _...6 more_
- `shared\measurement-registry.ts`
  - function assertMeasurementConsumer: (key, consumer, contextOrOptions?) => void
  - function collectMeasurementViolation: (key, consumer, context?, collector) => MeasurementViolation | null
  - function getCollectedMeasurementViolations: () => MeasurementViolation[]
  - function clearCollectedMeasurementViolations: () => void
  - type Consumer
  - type MeasurementStatus
  - _...5 more_
- `shared\parsing-utils.ts`
  - function repairJson: (text) => string
  - function extractJsonObject: (text) => void
  - function extractJsonFromContent: (content) => any | null
  - function parseSemanticMapperOutput: (rawResponse) => SemanticMapperParseResult
- `shared\provider-config.ts`
  - function canonicalCitationOrder: (activeProviderIds) => string[]
  - function buildCitationSourceOrder: (orderedProviderIds) => Record<number, string>
  - function selectBestProvider: (role, authStatus, boolean>, availableProviders?) => string | null
  - function isProviderAuthorized: (providerId, authStatus, boolean>) => boolean
  - type ProviderRole
  - const CANONICAL_PROVIDER_ORDER: readonly string[]
  - _...1 more_
- `shared\think-utils.ts`
  - function computeThinkFlag: ({...}, input, inputFlags }) => boolean
  - interface ComputeThinkFlagArgs
  - const AI_THINK_FLAG
- `shared\types\provider.ts`
  - class HTOSError
  - class ProviderAuthError
  - interface ProviderError
  - type ProviderKey
  - type ProviderErrorType
  - type HTOSErrorCode
- `shared\types\turns.ts`
  - function isUserTurn: (turn) => turn is
  - function isAiTurn: (turn) => turn is
  - interface ProbeResult
  - interface ProbeCorpusHit
  - interface ProbeSessionResponse
  - interface ProbeSession
  - _...3 more_
- `src\clustering\config.ts`
  - function getConfigForModel: (modelId) => EmbeddingConfig
  - interface EmbeddingConfig
  - interface EmbeddingModelEntry
  - const EMBEDDING_MODELS: EmbeddingModelEntry[]
  - const DEFAULT_CONFIG: EmbeddingConfig
- `src\clustering\corpus-search.ts` — function searchCorpus: (queryEmbedding, paragraphEmbeddings, Float32Array>, paragraphMeta, maxResults) => CorpusSearchHit[], interface CorpusSearchHit
- `src\clustering\distance.ts` — function cosineSimilarity: (a, b) => number
- `src\clustering\embeddings.ts`
  - function structuredTruncate: (text, maxChars) => string
  - function stripInlineMarkdown: (text) => string
  - function cleanupPendingEmbeddingsBuffers: () => Promise<void>
  - function generateEmbeddings: (paragraphs, shadowStatements, config) => Promise<EmbeddingResult>
  - function generateTextEmbeddings: (texts, config) => Promise<TextEmbeddingResult>
  - function generateStatementEmbeddings: (statements, config) => Promise<StatementEmbeddingResult>
  - _...4 more_
- `src\concierge-service\concierge-service.ts`
  - function buildConciergePrompt: (userMessage, options?) => string
  - interface ConciergePromptOptions
  - const ConciergeService
- `src\concierge-service\editorial-mapper.ts`
  - function buildPassageIndex: (claimDensity, passageRouting, statementClassification, corpus, claims, citationSourceOrder, string>, continuityMap, SourceContinuityEntry>) => void
  - function buildEditorialPrompt: (userQuery, passages, unclaimed, corpusShape) => string
  - function parseEditorialOutput: (rawText, validPassageKeys, validUnclaimedKeys) => EditorialParseResult
  - interface IndexedPassage
  - interface IndexedUnclaimedGroup
  - interface EditorialParseResult
- `src\concierge-service\evidence-substrate.ts` — function buildLookupCacheFromIndex: (passages, unclaimed) => EvidenceSubstrateLookupCache, function buildEvidenceSubstrate: (artifact, mappingText, citationSourceOrder, string>, options?) => string
- `src\concierge-service\position-brief.ts` — function buildPositionBriefFromClaims: (claims) => string, function buildPositionBrief: (analysis) => string
- `src\errors\classifier.ts`
  - function classifyError: (error) => ProviderError
  - function formatRetryAfter: (ms) => string
  - function isProviderAuthError: (error) => boolean
  - function isDefinitiveAuthError: (error) => boolean
  - function isRateLimitError: (error) => boolean
  - function isNetworkError: (error) => boolean
- `src\errors\handler.ts`
  - function createProviderAuthError: (providerId, originalError, context, unknown>) => ProviderAuthError
  - function createMultiProviderAuthError: (providerIds, context) => HTOSError | null
  - function getErrorMessage: (error) => string
  - function normalizeError: (error, context, unknown>) => HTOSError
  - class ErrorHandler
  - const PROVIDER_CONFIG: Record<string, ProviderConfigEntry>
  - _...1 more_
- `src\errors\infra-logger.ts` — function logInfraError: (label, err) => void
- `src\errors\retry.ts`
  - function getPolicy: (name) => RetryPolicy
  - function policyForErrorType: (type) => RetryPolicy | null
  - function logRetryEvent: (event) => void
  - function computeBackoffMs: (policy, attempt, retryAfterMs?, retryStage?) => number
  - function retryWithPolicy: (fn) => void
  - interface RetryPolicy
  - _...3 more_
- `src\execution\deterministic-pipeline.ts`
  - function computeDerivedFields: ({...}, mapperClaimsForProvenance, parsedEdges, shadowStatements, shadowParagraphs, statementEmbeddings, paragraphEmbeddings, claimEmbeddings, queryEmbedding, substrate, preSemantic, regions, existingQueryRelevance, modelCount, mixedProvenanceResult, }, Float32Array> | null;
  paragraphEmbeddings, Float32Array>;
  claimEmbeddings, Float32Array> | null;
  queryEmbedding?) => Promise<DerivedFields>
  - function buildSubstrateGraph: ({...}, regions, }) => unknown
  - function assembleMapperArtifact: ({...}, enrichedClaims, parsedNarrative, queryText, modelCount, shadowStatements, shadowParagraphs, turn, }) => Promise<unknown>
  - function executeArtifactPipeline: ({...}) => void
  - function buildArtifactForProvider: ({...}, shadowStatements, shadowParagraphs, batchSources, statementEmbeddings, paragraphEmbeddings, queryEmbedding, geoRecord, claimEmbeddings, citationSourceOrder, queryText, modelCount, turn, embeddingModelId, }, Float32Array>;
  paragraphEmbeddings, Float32Array>;
  queryEmbedding?, unknown> | null;
  claimEmbeddings?, Float32Array> | null;
  citationSourceOrder?, string> | null;
  queryText?) => Promise<Record<string, unknown>>
  - function computeProbeGeometry: ({...}, content, embeddingConfig, }) => Promise<Record<string, unknown>>
- `src\execution\io\context-manager.ts` — class ContextManager
- `src\execution\io\context-resolver.ts`
  - function aggregateBatchOutputs: (providerResponses) => FrozenBatchMap
  - function findLatestMappingOutput: (providerResponses, preferredProvider?) => void
  - function extractUserMessage: (userTurn) => string
  - class ContextResolver
- `src\execution\io\persistence-coordinator.ts` — class PersistenceCoordinator
- `src\execution\io\streaming-manager.ts` — class StreamingManager
- `src\execution\io\turn-emitter.ts` — class TurnEmitter
- `src\execution\pipeline\batch-phase.ts` — function executeBatchPhase: (step, context, options) => void
- `src\execution\pipeline\mapping-phase.ts` — function executeMappingPhase: (step, context, stepResults, workflowContexts, options) => void
- `src\execution\pipeline\recompute-handler.ts` — function handleRecompute: (payload, options) => void
- `src\execution\pipeline\singularity-phase.ts` — function runSingularityLLM: (step, context, options) => Promise<any>, function executeSingularityPhase: (request, context, stepResults, any>, _resolvedContext, currentUserMessage, options) => void
- `src\execution\preflight-validator.ts`
  - function getProviderUrl: (providerId) => string
  - function createAuthErrorMessage: (unauthorizedProviders, context) => string | null
  - function runPreflight: (request, authStatus, boolean>, availableProviders) => Promise<
- `src\execution\utils\geometry-runner.ts` — function buildGeometryAsync: (paragraphResult, shadowResult, _indexedSourceData, payload, context, options, geometryDiagnostics, nowMs) => void
- `src\execution\utils\llm-runner.ts` — function executeGenericSingleStep: (step, context, providerId, prompt, stepType, options, parseOutputFn) => void
- `src\execution\utils\reactive-bridge.ts`
  - function buildReactiveBridge: (userMessage, previousAnalysis) => ReactiveBridge | null
  - function buildReactiveBridgeCached: (userMessage, previousAnalysis, turnId) => ReactiveBridge | null
  - interface ReactiveBridge
  - type StoredAnalysis
- `src\execution\workflow-compiler.ts` — class WorkflowCompiler
- `src\execution\workflow-engine.ts` — class WorkflowEngine
- `src\geometry\algorithms\basin-inversion-bayesian.ts` — function computeBasinInversion: (substrate) => BasinInversionResult
- `src\geometry\algorithms\basin-inversion.ts` — function computeBasinInversion: (idsIn, vectorsIn) => BasinInversionResult
- `src\geometry\algorithms\gap-regionalization.ts`
  - function computeGapRegionalization: (nodes) => GapRegionalizationResult
  - interface GapRegionalizationResult
  - interface GapRegion
  - interface NodeGapProfile
  - interface GapRegionalizationMeta
- `src\geometry\annotate.ts`
  - function enrichStatementsWithGeometry: (statements, paragraphs, substrate, interpretation?, statementToParagraph?, string>) => EnrichmentResult
  - function computeQueryRelevance: (input, Float32Array> | null;
  paragraphEmbeddings?, Float32Array> | null;
  paragraphs, string> | null;
}) => QueryRelevanceResult
  - function annotateStatements: (input, Float32Array> | null;
  paragraphEmbeddings?, Float32Array> | null;
}) => void
  - interface EnrichmentResult
  - interface QueryRelevanceStatementScore
  - interface QueryRelevanceResult
  - _...1 more_
- `src\geometry\engine.ts` — function buildGeometryPipeline: (input, Float32Array> | null;
  statementEmbeddings?, Float32Array> | null;
  embeddingBackend?) => GeometryPipelineResult, interface GeometryPipelineResult
- `src\geometry\interpret.ts`
  - function identifyPeriphery: (basinInversion, regionsOrTopologyIndex?, number>; gapSizes, number> }) => PeripheryResult
  - function interpretSubstrate: (substrate, paragraphEmbeddings?, Float32Array> | null) => SubstrateInterpretation
  - function buildPreSemanticInterpretation: (substrate, paragraphEmbeddings?, Float32Array> | null, _queryRelevanceBoost?) => SubstrateInterpretation
- `src\geometry\layout.ts` — function computeUmapLayout: (paragraphIds, embeddings, Float32Array>, seed) => Layout2DResult, interface Layout2DResult
- `src\geometry\measure.ts`
  - function quantize: (value) => number
  - function computeExtendedStatsFromArray: (allSims) => ExtendedSimilarityStats
  - function buildPairwiseField: (paragraphIds, embeddings, Float32Array>) => PairwiseField
  - function buildMutualRankGraph: (pairwiseField) => MutualRankGraph
  - function computeNodeStats: (paragraphs, mutualRankGraph) => NodeLocalStats[]
  - function measureSubstrate: (paragraphs, embeddings, Float32Array> | null, embeddingBackend, config) => GeometricSubstrate | DegenerateSubstrate
  - _...3 more_
- `src\geometry\types.ts`
  - function isDegenerate: (s) => s is DegenerateSubstrate
  - interface ExtendedSimilarityStats
  - interface NodeLocalStats
  - interface PairwiseFieldStats
  - interface PairwiseField
  - interface MutualRankEdge
  - _...18 more_
- `src\persistence\database.ts`
  - function openDatabase: () => Promise<IDBDatabase>
  - function getCurrentSchemaVersion: (db) => Promise<number>
  - function checkDatabaseHealth: () => Promise<
  - function deleteDatabase: () => Promise<void>
  - const SCHEMA_VERSION
  - const STORE_CONFIGS: StoreConfig[]
- `src\persistence\embedding-codec.ts` — function packEmbeddingMap: (map, Float32Array>, dimensions) => void, function unpackEmbeddingMap: (buffer, index, dimensions) => Map<string, Float32Array>
- `src\persistence\index.ts` — function initializePersistenceLayer: () => Promise<PersistenceLayer>
- `src\persistence\persistence-monitor.ts`
  - class PersistenceMonitor
  - interface PersistenceOperationRecord
  - interface PersistencePerformanceMetrics
  - interface PersistenceErrorRecord
  - interface PersistenceConnectionRecord
  - interface PersistenceMonitorMetrics
  - _...1 more_
- `src\persistence\schema-verification.ts` — function verifySchemaAndRepair: (autoRepair) => Promise<, interface SchemaHealth
- `src\persistence\session-manager.ts` — class SessionManager
- `src\persistence\simple-indexeddb-adapter.ts` — class SimpleIndexedDBAdapter, interface SimpleRecord
- `src\persistence\transactions.ts`
  - function withTransaction: (db, storeNames, mode, work) => void
  - function batchWrite: (db, storeName, records) => Promise<BatchWriteResult>
  - function batchDelete: (db, storeName, keys) => void
  - function updateWithVersionCheck: (db, storeName, id, updates, expectedVersion) => Promise<VersionConflictResult>
  - function multiStoreTransaction: (db, storeNames, operations, IDBObjectStore>) => void
  - function promisifyRequest: (request) => Promise<T>
  - _...3 more_
- `src\provenance\claim-structural-fingerprint.ts`
  - function computeContestedShareRatio: (presenceMass, territorialMass, sovereignMass) => number | null
  - function buildClaimStructuralFingerprints: (input) => ClaimStructuralFingerprintResult
  - interface ClaimStructuralFingerprintInput
- `src\provenance\classify.ts` — function computeStatementClassification: (input) => StatementClassificationResult, interface ClassifyPhaseInput
- `src\provenance\engine.ts`
  - function buildProvenancePipeline: (input) => Promise<ProvenancePipelineOutput>
  - interface ProvenancePipelineInput
  - interface ProvenancePipelineOutput
- `src\provenance\measure.ts`
  - function emptyClaimFootprintMeasurement: () => ClaimFootprintMeasurement
  - function computeClaimFootprintMeasurement: ({...}, canonicalStatementIds, ownershipMap, stmtToParagraphId, statementsById, paragraphOrder, }, Set<string>>;
  stmtToParagraphId, string>;
  statementsById, ShadowStatement>;
  paragraphOrder, number>;
}) => ClaimFootprintMeasurement
  - function measureProvenance: (input) => Promise<MeasurePhaseOutput>
  - interface ClaimExclusivity
  - interface MeasurePhaseInput
  - interface MeasurePhaseOutput
- `src\provenance\semantic-mapper.ts`
  - function buildSemanticMapperPrompt: (userQuery, responses) => string
  - function parseSemanticMapperOutput: (rawResponse, _shadowStatements?) => ParseResult
  - interface ParseResult
- `src\provenance\structure.ts`
  - function analyzeGlobalStructure: (input) => any
  - type StructurePhaseOutput
  - const computeStructuralAnalysis
  - const runStructurePhase
- `src\provenance\surface.ts`
  - function buildMassEligibilityDiagnostic: (claimId, profile, oldMajorityEligible) => MassEligibilityDiagnostic
  - function computeNounSurvivalRatio: (text) => number
  - function computeTopologicalSurface: (input) => SurfaceOutput
  - function buildSourceContinuityMap: (claimDensity) => Map<string, SourceContinuityEntry>
  - interface SurfaceInput
  - interface SurfaceOutput
  - _...1 more_
- `src\provenance\validate.ts`
  - function validateEdgesAndAllegiance: (input) => ValidateOutput
  - interface ValidateInput
  - interface ValidateOutput
- `src\providers\chatgpt-adapter.js` — class ChatGPTAdapter
- `src\providers\chatgpt.js`
  - class ChatGPTProviderError
  - class ChatGPTProviderController
  - class ChatGPTSessionApi
  - const ChatGPTModels
- `src\providers\claude-adapter.js` — class ClaudeAdapter
- `src\providers\claude.js`
  - class ClaudeProviderError
  - class ClaudeSessionApi
  - class ClaudeProviderController
  - const ClaudeModels
- `src\providers\gemini-adapter.js` — class GeminiAdapter
- `src\providers\gemini.js`
  - class GeminiProviderError
  - class ColdStartDetectedError
  - class GeminiSessionApi
  - class GeminiProviderController
  - const GeminiModels
- `src\providers\grok-adapter.js` — class GrokAdapter
- `src\providers\grok-crypto.js` — function generateKeys: () => void, function signChallenge: (challengeData, privateKeyB64) => void
- `src\providers\grok-signature.js`
  - function generateSign: (path, method, verificationToken, svg, xValues, timeN, randomFloat) => void
  - function between: (haystack, start, end) => void
  - function parseVerificationToken: (html, metaName) => void
  - function parseSvgData: (html, anim) => void
  - function parseXValues: (scriptContent) => void
- `src\providers\grok.js`
  - class GrokProviderError
  - class GrokSessionApi
  - class GrokProviderController
  - const GrokModels
- `src\providers\health\provider-health-gate.ts`
  - function runWithProviderHealth: (tracker, providerId, stage, fn) => void
  - interface RunWithHealthOptions
  - type HealthTrackerLike
- `src\providers\health\provider-health-tracker.js` — function getHealthTracker: () => void, class ProviderHealthTracker
- `src\providers\provider-locks.ts`
  - function getProviderLocks: () => Promise<ProviderLocks>
  - function setProviderLock: (role, locked) => Promise<void>
  - function subscribeToLockChanges: (callback) => void
  - interface ProviderLocks
- `src\providers\qwen-adapter.js` — class QwenAdapter
- `src\providers\qwen.js`
  - class QwenProviderError
  - class ServerTransientError
  - class QwenSessionApi
  - class QwenProviderController
- `src\shadow\exclusion-rules.ts`
  - function isExcluded: (text, stance, opts?) => ExclusionResult
  - interface ExclusionResult
  - interface ExclusionRule
  - const EXCLUSION_RULES: ExclusionRule[]
- `src\shadow\shadow-extractor.ts`
  - function extractShadowStatements: (responses) => ShadowExtractionResult
  - interface TableCellMeta
  - interface ShadowStatement
  - interface ShadowStatementLocation
  - interface ShadowExtractionResult
- `src\shadow\shadow-paragraph-projector.ts`
  - function projectParagraphs: (statements) => ParagraphProjectionResult
  - interface ShadowParagraph
  - interface ParagraphProjectionResult
- `src\shadow\statement-types.ts`
  - function getStancePriority: (stance) => number
  - function classifyStance: (text) => void
  - function detectSignals: (text) => void
  - interface SignalPatterns
  - type Stance
  - const STANCE_PRIORITY: Stance[]
  - _...2 more_
- `src\system\connection-handler.ts` — class ConnectionHandler
- `src\system\dnr-utils.ts` — class DNRUtils, class ProviderDNRGate
- `src\system\lifecycle-manager.ts` — class LifecycleManager
- `src\system\service-registry.ts` — class ServiceRegistry, const services: ServiceRegistry
- `ui\config\provider-registry.ts`
  - function getProviderById: (id) => ProviderConfig | undefined
  - interface ProviderConfig
  - const INITIAL_PROVIDERS: ProviderConfig[]
  - const PROVIDER_COLORS: Record<string, string>
  - const PROVIDER_ACCENT_COLORS: Record<string, string>
- `ui\hooks\chat\useChat.ts` — function useChat: () => void
- `ui\hooks\chat\usePortMessageHandler.ts` — function usePortMessageHandler: (enabled) => void
- `ui\hooks\chat\useRoundActions.ts` — function useRoundActions: () => void
- `ui\hooks\instrument\useClaimCentroids.ts` — function useClaimCentroids: (claims, substrate, mixedProvenance?, index?, _passageRouting?) => ClaimCentroid[], interface ClaimCentroid
- `ui\hooks\instrument\useEvidenceRows.ts` — function useEvidenceRows: (artifact, selectedClaimId) => EvidenceRow[], interface EvidenceRow
- `ui\hooks\instrument\useInstrumentState.ts`
  - function useInstrumentState: () => [InstrumentState, InstrumentActions]
  - interface InstrumentState
  - interface InstrumentActions
  - type PipelineLayer
  - type SelectedEntity
  - type EvidenceScope
- `ui\hooks\instrument\useParagraphRows.ts` — function useParagraphRows: (artifact, selectedClaimId) => ParagraphRow[], interface ParagraphRow
- `ui\hooks\instrument\useZoomPan.ts` — function useZoomPan: (svgRef) => void, interface Transform
- `ui\hooks\providers\useProviderActions.ts` — function useProviderActions: (sessionId, aiTurnId) => void
- `ui\hooks\providers\useProviderArtifact.ts` — function useProviderArtifact: (turnId, providerId) => void
- `ui\hooks\providers\useProviderStatus.ts`
  - function useProviderStatus: (options, enabled) => UseProviderStatusReturn
  - interface UseProviderStatusOptions
  - interface UseProviderStatusReturn
- `ui\hooks\providers\useSmartProviderDefaults.ts` — function useSmartProviderDefaults: (enabled) => void
- `ui\hooks\reading\useArtifactResolution.ts` — function useArtifactResolution: (turnId) => ArtifactResolution, interface ArtifactResolution
- `ui\hooks\reading\useCorpusSearch.ts`
  - function useCorpusSearch: (aiTurnId) => void
  - interface CorpusSearchHit
  - interface ProbeSearchResult
- `ui\hooks\reading\usePassageHighlight.ts` — function usePassageHighlight: (artifact, focusedClaimId) => Map<string, ParagraphHighlight>, interface ParagraphHighlight
- `ui\hooks\reading\usePassageResolver.ts`
  - function usePassageResolver: (artifact, citationSourceOrder, string> | null) => PassageResolver
  - interface ResolvedPassage
  - interface ResolvedUnclaimedGroup
  - interface PassageResolver
  - type ResolvedItem
- `ui\hooks\ui\useClipActions.ts` — function useClipActions: () => void
- `ui\hooks\ui\useConnectionMonitoring.ts` — function useConnectionMonitoring: (enabled) => void
- `ui\hooks\ui\useHistoryLoader.ts` — function useHistoryLoader: (isInitialized) => void
- `ui\hooks\ui\useInitialization.ts` — function useInitialization: () => boolean
- `ui\hooks\ui\useKey.ts` — function useKey: (key, callback) => void
- `ui\hooks\ui\useLoadingWatchdog.ts` — function useResponsiveLoadingGuard: (options?) => void
- `ui\hooks\ui\useSessionSync.ts` — function useSessionSync: (isInitialized) => void
- `ui\hooks\ui\useSingularityOutput.ts` — function useSingularityOutput: (aiTurnId, forcedProviderId?) => SingularityOutputState, interface SingularityOutputState
- `ui\hooks\workflow\useSingularityTrigger.ts` — function useSingularityMode: (trackedAiTurnId?) => void, type SingularityTransitionOptions
- `ui\instrument\expression-engine.ts`
  - function compileExpression: (expression, columnIds) => CompiledExpression | null
  - function validateExpression: (expression, columnIds) => string | null
  - interface CompiledExpression
- `ui\instrument\utils\svg-utils.ts` — function donutArc: (cx, cy, r, width, startAngle, endAngle) => string
- `ui\services\port-health-manager.ts` — class PortHealthManager
- `ui\state\cleanup.ts` — function cleanupTurnAtoms: (turnIds, turnIdProviderPairs) => void
- `ui\utils\copy-format-utils.ts`
  - function formatDecisionMapForMd: (narrative, claims, edges) => string
  - function formatBatchResponseParts: (batchResponses, any> | null | undefined) => string[]
  - function formatProviderResponseForMd: (response, providerName) => string
  - function formatSessionForMarkdown: (fullSession) => string
  - function formatSingularityResponse: (output) => string
  - function formatMapperResponse: (aiTurn, effectivePid) => string
  - _...4 more_
- `ui\utils\math-renderer.ts` — function loadMathPlugins: () => void, function renderMathInMarkdown: (content) => Promise<string>
- `ui\utils\math-utils.ts`
  - function containsMath: (content) => boolean
  - function safeArr: (v) => T[]
  - function pearsonR: (xs, ys) => number | null
- `ui\utils\parse-session-turns.ts` — function parseSessionTurns: (fullSession) => void
- `ui\utils\provider-helpers.ts`
  - function getProviderConfig: (providerId) => ProviderConfig | undefined
  - function getProviderName: (providerId) => string
  - function getProviderColor: (providerId) => string
  - function getProviderLogo: (providerId) => string | undefined
  - function getProviderAbbreviation: (providerId) => string
  - function resolveProviderIdFromCitationOrder: (modelIndex, citationSourceOrder?, string>) => string | null
- `ui\utils\streaming-buffer.ts` — class StreamingBuffer
- `ui\utils\turn-helpers.ts`
  - function createOptimisticAiTurn: (aiTurnId, userTurn, activeProviders, mappingProvider?, singularityProvider?, timestamp?, explicitUserTurnId?, requestedFeatures?) => AiTurnWithUI
  - function applyStreamingTurnUpdate: (aiTurn, updates) => void
  - function normalizeBackendRoundsToTurns: (rawTurns, sessionId) => Array<UserTurn | AiTurnWithUI>

---

# Config

## Environment Variables

- `HTOS_GEMINI_COLD_START_BACKOFF_BASE_MS` **required** — docs\test\retry-policy.test.ts
- `HTOS_GEMINI_COLD_START_BACKOFF_JITTER` **required** — docs\test\retry-policy.test.ts
- `HTOS_GEMINI_COLD_START_BACKOFF_MAX_MS` **required** — docs\test\retry-policy.test.ts
- `HTOS_GEMINI_COLD_START_BACKOFF_MULTIPLIER` **required** — docs\test\retry-policy.test.ts
- `HTOS_GEMINI_COLD_START_MAX_RETRIES` **required** — docs\test\retry-policy.test.ts
- `NODE_ENV` **required** — scripts\build-common.js

## Config Files

- `tailwind.config.js`
- `tsconfig.json`

## Key Dependencies

- react: ^18.2.0

---

# Middleware

## custom
- evidence-substrate — `src\concierge-service\evidence-substrate.ts`
- SubstrateSnapshotCard — `ui\instrument\cards\SubstrateSnapshotCard.tsx`

## auth
- auth-config — `src\providers\auth-config.ts`
- auth-manager — `src\providers\auth-manager.js`

---

# Dependency Graph

## Most Imported Files (change these carefully)

- `shared\corpus-utils.ts` — imported by **17** files
- `ui\services\extension-api.ts` — imported by **15** files
- `ui\config\constants.ts` — imported by **15** files
- `shared\messaging.ts` — imported by **13** files
- `src\shadow\shadow-paragraph-projector.ts` — imported by **11** files
- `src\shadow\shadow-extractor.ts` — imported by **10** files
- `shared\types\contract.ts` — imported by **9** files
- `src\geometry\types.ts` — imported by **9** files
- `src\clustering\distance.ts` — imported by **8** files
- `src\shadow\index.ts` — imported by **8** files
- `src\providers\auth-manager.js` — imported by **8** files
- `src\shadow\statement-types.ts` — imported by **8** files
- `ui\utils\provider-helpers.ts` — imported by **8** files
- `ui\shared\CopyButton.tsx` — imported by **8** files
- `shared\types\provider.ts` — imported by **7** files
- `shared\citation-utils.ts` — imported by **7** files
- `src\errors\handler.ts` — imported by **7** files
- `src\geometry\annotate.ts` — imported by **7** files
- `src\concierge-service\editorial-mapper.ts` — imported by **6** files
- `src\persistence\types.ts` — imported by **6** files

## Import Map (who imports what)

- `shared\corpus-utils.ts` ← `src\execution\deterministic-pipeline.ts`, `src\execution\pipeline\mapping-phase.ts`, `src\system\connection-handler.ts`, `ui\chat\TurnOutputRouter.tsx`, `ui\hooks\chat\usePortMessageHandler.ts` +12 more
- `ui\services\extension-api.ts` ← `ui\App.tsx`, `ui\chat\ChatInput.tsx`, `ui\hooks\chat\useChat.ts`, `ui\hooks\chat\usePortMessageHandler.ts`, `ui\hooks\chat\useRoundActions.ts` +10 more
- `ui\config\constants.ts` ← `ui\chat\ChatInput.tsx`, `ui\chat\CouncilOrbs.tsx`, `ui\chat\CouncilOrbsVertical.tsx`, `ui\chat\SingularityOutputView.tsx`, `ui\chat\TurnOutputRouter.tsx` +10 more
- `shared\messaging.ts` ← `src\execution\io\context-manager.ts`, `src\execution\io\context-resolver.ts`, `src\execution\io\turn-emitter.ts`, `src\execution\pipeline\mapping-phase.ts`, `src\execution\pipeline\recompute-handler.ts` +8 more
- `src\shadow\shadow-paragraph-projector.ts` ← `shared\corpus-utils.ts`, `src\clustering\embeddings.ts`, `src\execution\utils\geometry-runner.ts`, `src\geometry\annotate.ts`, `src\geometry\engine.ts` +6 more
- `src\shadow\shadow-extractor.ts` ← `shared\corpus-utils.ts`, `src\clustering\embeddings.ts`, `src\execution\utils\geometry-runner.ts`, `src\geometry\annotate.ts`, `src\geometry\engine.ts` +5 more
- `shared\types\contract.ts` ← `shared\types\index.ts`, `shared\types\turns.ts`, `src\execution\io\context-manager.ts`, `src\execution\io\context-resolver.ts`, `src\execution\pipeline\singularity-phase.ts` +4 more
- `src\geometry\types.ts` ← `src\execution\utils\geometry-runner.ts`, `src\geometry\algorithms\basin-inversion-bayesian.ts`, `src\geometry\annotate.ts`, `src\geometry\engine.ts`, `src\geometry\index.ts` +4 more
- `src\clustering\distance.ts` ← `src\clustering\corpus-search.ts`, `src\clustering\index.ts`, `src\geometry\annotate.ts`, `src\geometry\interpret.ts`, `src\provenance\classify.ts` +3 more
- `src\shadow\index.ts` ← `src\execution\deterministic-pipeline.ts`, `src\execution\deterministic-pipeline.ts`, `src\execution\pipeline\mapping-phase.ts`, `src\execution\pipeline\recompute-handler.ts`, `src\shadow\test.ts` +3 more

---

# Test Coverage

> **0%** of routes and models are covered by tests
> 17 test files found

---

_Generated by [codesight](https://github.com/Houseofmvps/codesight) — see your codebase clearly_
# @shared/types — file digest (current implementation)

---

## index.ts

Public API surface for the shared types module. Re-exports all type definitions from constituent files.

**Exports:**
- `graph.ts` — claim/edge/enrichment types
- `turns.ts` — persistence layer (user/AI turns, probe sessions)
- `provider.ts` — error handling and provider classification
- `editorial.ts` — UI rendering and cognitive artifact structure
- `contract.ts` — pipeline, workflow, and cross-layer contracts

---

## graph.ts

Core semantic graph types used by the deterministic pipeline and structural analysis.

**`Claim`**

Semantic unit representing a claim or assertion extracted from source texts.

- `id` — unique identifier (UUID)
- `label` — short display name
- `text` — full claim text
- `dimension` — optional legacy metadata tag
- `supporters` — array of model indices backing this claim
- `type` — claim classification: `'factual'` | `'prescriptive'` | `'cautionary'` | `'assertive'` | `'uncertain'` | `'conditional'` | `'contested'` | `'speculative'`
- `role` — optional narrative role: `'anchor'` | `'branch'` | `'challenger'` | `'supplement'`
- `quote` — optional source text snippet
- `support_count` — supporter count (legacy; use `supporters.length`)
- `sourceStatementIds` — provenance link to shadow statements

**`Edge`**

Directional relationship between two claims.

- `from` / `to` — claim IDs
- `type` — relationship kind: `'supports'` | `'conflicts'` | `'tradeoff'` | `'prerequisite'`

**`EnrichedClaim extends Claim`**

Claim augmented with structural metrics from graph and corpus analysis.

**Derivation fields (from measureCorpus):**
- `supportRatio` — `supporters.length / modelCount` (population-relative, baked in)
- `inDegree` / `outDegree` — incoming/outgoing edges of any type
- `prerequisiteOutDegree` — count of outgoing prerequisite edges (structural coupling)
- `conflictEdgeCount` — edges of type 'conflicts' touching this claim
- `chainDepth` — max distance to any chain root (MAX_SAFE_INTEGER if unreachable); baked in during construct phase

**Topology flags (from Phase 1 COLLECT, Phase 3 CONSTRUCT):**
- `isChainRoot` — no incoming prerequisite edges
- `isChainTerminal` — no outgoing prerequisite edges
- `isIsolated` — no edges of any type
- `isContested` — participates in conflict edge
- `isConditional` — has 2+ incoming prerequisite edges (branch point)
- `isOutlier` — high out-degree relative to corpus (per graph analysis)

**Salience flags (baked in during Phase 3 CONSTRUCT):**
- `isSalient` — `supportRatio > meanSupportRatio` (population-relative)
- `isHighSupport` — alias for `isSalient` (backwards compatibility)
- `isKeystone` — `isSalient && prerequisiteOutDegree >= 2` (structural importance)
- `hubDominance` — z-score for this claim if it is the graph hub (top out-degree, exceeds μ+σ); set only on the hub claim

**Geometric signals (optional, from passage routing/twin map):**
- `geometricSignals` — region backing flags + confidence:
  - `backedByPeak` — claim territory includes a peak landscape position
  - `backedByHill` — includes a hill (northStar or eastStar)
  - `backedByFloor` — includes a floor (neither concentration nor density gate)
  - `avgGeometricConfidence` — mean confidence across backing regions
  - `sourceRegionIds` — region IDs providing backing

**Query-relative:**
- `queryDistance` — optional relevance score against user query (from queryRelevance)

**Provenance (shadow mapper output):**
- `sourceStatementIds` — which shadow statements mapped to this claim
- `sourceStatements` — optional full statement objects (rarely populated in flow)
- `sourceCoherence` — optional coherence score (unused currently)
- `derivedType` — optional override type (unused currently)

---

## provider.ts

Error classification and runtime error types for provider interactions.

**`ProviderKey`**

Enumeration of supported LLM providers.

- `'claude'` | `'gemini'` | `'gemini-pro'` | `'gemini-exp'` | `'chatgpt'` | `'qwen'`

**`ProviderErrorType`**

Classification of provider failures for user-facing messaging and retry strategy selection.

- `'rate_limit'` — 429 (Retryable after cooldown; retryAfterMs supplied)
- `'auth_expired'` — 401/403 (Requires re-login; requiresReauth = true)
- `'timeout'` — Request duration exceeded (Retryable)
- `'circuit_open'` — Too many recent failures (Auto-retry later per circuit breaker policy)
- `'content_filter'` — Response blocked by provider policy (Not retryable)
- `'input_too_long'` — Input exceeds provider token/length limit (Not retryable)
- `'network'` — Connection failed (Retryable)
- `'unknown'` — Catch-all for unmapped errors (Maybe retryable)

**`ProviderError`**

Structured error for provider failures.

- `type` — ProviderErrorType (see above)
- `message` — user-facing error text
- `retryable` — boolean; if false, operation should not be retried
- `retryAfterMs` — optional; milliseconds to wait before retry (rate limits only)
- `requiresReauth` — optional; if true, user must re-authenticate

**`HTOSErrorCode`**

Enumeration of all runtime error codes in the system (auth, storage, circuit breaker, etc.).

Comprehensive list: AUTH_REQUIRED, MULTI_AUTH_REQUIRED, RATE_LIMITED, NETWORK_ERROR, STORAGE_QUOTA_EXCEEDED, INVALID_STATE, NOT_FOUND, TIMEOUT, INDEXEDDB_ERROR, INDEXEDDB_UNAVAILABLE, SERVICE_WORKER_ERROR, INPUT_TOO_LONG, UNKNOWN_ERROR, CIRCUIT_BREAKER_OPEN, FALLBACK_UNSUPPORTED, FALLBACK_FAILED, CACHE_CORRUPTED, NO_CACHE_AVAILABLE, DIRECT_UNSUPPORTED, NO_RECOVERY_STRATEGY, INVALID_RETRY_POLICY, RETRY_EXHAUSTED, LOCALSTORAGE_* variants, DIRECT_PERSISTENCE_NOT_IMPLEMENTED, DIRECT_SESSION_NOT_IMPLEMENTED.

**`HTOSError extends Error`**

Base runtime error class with structured context.

- `code` — HTOSErrorCode (machine-readable error type)
- `context` — Record<string, unknown> (additional details for logging/debugging)
- `recoverable` — whether the error is transient and can be retried
- `timestamp` — Date.now() at error creation
- `id` — unique error ID (`error_{timestamp}_{random}`) for tracing

Methods:
- `toJSON()` — serialization for logging/reporting (includes stack trace)
- `details` getter — alias for `context`

**`ProviderAuthError extends HTOSError`**

Specialized error for provider authentication failures.

- `providerId` — which provider failed (claude, gemini, chatgpt, etc.)
- `loginUrl` — optional URL to re-authenticate (from context)
- Inherits `code = 'AUTH_REQUIRED'` and `recoverable = false`

---

## turns.ts

Persistence and UI rendering boundary types for user interactions and multi-provider responses.

**`ProbeResult`**

Single model's response to a probe query (exploration mode).

- `modelIndex` — model array index
- `modelName` — display name (e.g., "Claude 3.5 Sonnet")
- `text` — full response text
- `paragraphs` — array of response paragraph strings
- `embeddings` — optional paragraph embedding metadata:
  - `paragraphIds` — IDs of embedded paragraphs
  - `dimensions` — embedding vector size

**`ProbeCorpusHit`**

Search result from corpus similarity against probe query.

- `paragraphId` — matching paragraph ID
- `similarity` — cosine similarity [-1, 1]
- `normalizedSim` — UI display similarity [0, 1]
- `modelIndex` — which model this paragraph came from
- `paragraphIndex` — index in that model's output
- `text` — paragraph text

**`ProbeSessionResponse`**

Streaming response metadata for a single provider in probe session.

- `providerId` — provider key (claude, gemini, etc.)
- `modelIndex` — model array index
- `modelName` — display name
- `text` — accumulated response text
- `paragraphs` — accumulated response paragraphs
- `status` — `'streaming'` | `'completed'` | `'error'`
- `error` — error message if status = error
- `createdAt` / `updatedAt` — timestamps

**`ProbeSession`**

Multi-provider exploration session with corpus search and streaming responses.

- `id` — unique session identifier
- `queryText` — user's probe query
- `searchResults` — ProbeCorpusHit[] (ranked by similarity)
- `providerIds` — which providers are/were queried
- `responses` — Record<providerId, ProbeSessionResponse> (per-provider state)
- `status` — `'searching'` | `'probing'` | `'complete'` (overall lifecycle)
- `createdAt` / `updatedAt` — timestamps

**`UserTurn`**

User input message in a thread.

- `id` — unique turn identifier
- `type` — always `'user'`
- `sessionId` — optional session context (can be null)
- `threadId` — which thread/conversation this belongs to
- `text` — user message text
- `createdAt` — timestamp
- `updatedAt` — optional modification timestamp
- `userId` — optional user identifier
- `meta` — optional metadata (custom key-value)

**`ProviderResponse`**

Single provider's response to a batch/mapping/singularity invocation.

- `providerId` — provider key
- `text` — response text
- `status` — lifecycle: `'pending'` | `'streaming'` | `'completed'` | `'error'` | `'failed'` | `'skipped'`
- `createdAt` / `updatedAt` — timestamps
- `attemptNumber` — retry count (if retried)
- `artifacts` — optional structured outputs (title, identifier, content, type)
- `meta` — provider-specific metadata:
  - Known fields: `conversationId`, `parentMessageId`, `tokenCount`, `thinkingUsed`, `_rawError`, `allAvailableOptions`, `citationSourceOrder`, `synthesizer`, `mapper`
  - Index signature allows genuinely unknown provider fields

**`AiTurn`**

AI/system output message (canonical domain model).

- `id` — unique turn identifier
- `type` — always `'ai'`
- `userTurnId` — which user turn triggered this response
- `sessionId` — optional session context
- `threadId` — which thread/conversation
- `createdAt` — timestamp
- `isComplete` — optional completion flag

**Phase data (pipeline stages):**
- `batch` — BatchPhase output (multi-model extraction)
- `mapping` — MappingPhase output (semantic graph construction)
- `singularity` — SingularityPhase output (synthesis)

**Per-provider responses:**
- `mappingResponses` — Record<providerId, any[]> (full mapping artifacts per provider)
- `singularityResponses` — Record<providerId, any[]> (synthesis artifacts per provider)

**Session data:**
- `probeSessions` — ProbeSession[] (exploration mode queries)
- `pipelineStatus` — optional execution status/diagnostics

**Metadata:**
- `meta` — execution context:
  - `mapper` — which mapper was used
  - `requestedFeatures` — flags for mapping/singularity inclusion
  - `branchPointTurnId` — optional branch context (for tree exploration)
  - `replacesId` — if this turn replaces a prior turn
  - `isHistoricalRerun` — if this is a re-execution of historical turn
  - `isOptimistic` — if response is speculative/not yet confirmed

**Type guards:**
- `isUserTurn(turn)` — type guard for UserTurn
- `isAiTurn(turn)` — type guard for AiTurn

---

## editorial.ts

UI rendering and cognitive artifact structure (pipeline output boundary).

**Secondary Pattern Types**

Container types for structural patterns detected during graph analysis.

- `ChallengedPatternData` — array of challenger/target pairs (peripheral vs. salient conflicts)
- `KeystonePatternData` — hub claim, dependents, cascade size
- `ChainPatternData` — chain ID array, length, weak link IDs
- `FragilePatternData` — array of peak/weak-foundation pairs
- `ConditionalPatternData` — array of conditional branch points

**`SecondaryPattern`**

Individual detected pattern with severity and data payload.

- `type` — pattern type (challenged, keystone, chain, fragile, or conditional)
- `severity` — `'high'` | `'medium'` | `'low'`
- `data` — union of pattern-specific data types

**`SingularityOutput`**

Synthesis result from singularity phase.

- `text` — synthesis narrative text
- `providerId` — which provider generated this
- `timestamp` — generation time
- `leakageDetected` — optional flag if pipeline state leaked into output
- `leakageViolations` — optional array of leaked field names
- `pipeline` — optional full pipeline state snapshot (for debugging)

**`EditorialThreadItem`**

Reference to a single item within an editorial thread.

- `id` — passageKey or unclaimed group key
- `role` — narrative role: `'anchor'` | `'support'` | `'context'` | `'reframe'` | `'alternative'`

**`EditorialThread`**

Thematic grouping of related passages and claims.

- `id` — unique thread identifier
- `label` — thread title
- `why_care` — brief explanation of thread relevance
- `start_here` — boolean; if true, thread should be presented first
- `items` — EditorialThreadItem[] (ordered sequence)

**`EditorialAST`**

Abstract syntax tree for editorial output (narrative structure).

- `orientation` — overall narrative stance/framing
- `threads` — EditorialThread[] array (thematic groupings)
- `thread_order` — string[] of thread IDs in presentation order
- `diagnostics` — metadata:
  - `flat_corpus` — whether corpus lacks structural variation
  - `conflict_count` — number of detected conflicts
  - `notes` — diagnostic notes

**`CognitiveArtifact`**

Complete pipeline output artifact (canonical domain model).

**Shadow section (extracted from batch responses):**
- `statements` — PipelineShadowStatement[] (extracted claims)
- `paragraphs` — PipelineShadowParagraph[] (paragraph structure)

**Geometry section (embedding & substrate):**
- `embeddingStatus` — `'computed'` | `'failed'`
- `substrate` — PipelineSubstrateGraph (geometric structure)
- `basinInversion` — optional topographic inversion result (for passage routing)
- `bayesianBasinInversion` — optional alternative inversion variant
- `preSemantic` — optional interpretation layer output (gating, regionalization)
- `diagnostics` — optional PipelineDiagnosticsResult
- `structuralValidation` — optional validation output

**Semantic section (graph extraction):**
- `claims` — Claim[] (semantic claims)
- `edges` — Edge[] (relationships)
- `conditionals` — any[] (conditional structures)
- `narrative` — optional narrative text

**Metadata:**
- `meta` — optional context:
  - `modelCount` — number of models in batch
  - `query` — user's query text
  - `turn` — turn number in conversation
  - `timestamp` — artifact creation time

**Re-exports:**
- `EnrichedClaim` — from graph.ts (for consumers importing from editorial)

---

## contract.ts

Comprehensive pipeline and workflow types (workflow state, mappers, substrate, interpretation gates, diagnostics).

**Structural classification:**

`PrimaryShape` — enumeration of dominant corpus patterns:
- `'FORKED'` — conflict between two salient claims
- `'CONSTRAINED'` — tradeoff between salient claims
- `'CONVERGENT'` — one or more salient claims with support edges
- `'PARALLEL'` — multiple salient claims, no tension edges
- `'SPARSE'` — flat distribution, no separation

`ShapeClassification` — shape type + evidence array

`ProblemStructure extends ShapeClassification` — adds optional SecondaryPattern[]

**Mapper output:**

`MapperClaim` — claim as extracted by semantic mapper (id, label, text, supporters)

`MapperEdge` — conflict or prerequisite relationship (with optional question field)

`UnifiedMapperOutput` — mapper result: claims, edges, optional conditions/determinants

**Conflict analysis:**

`ConflictClaim` — claim in conflict context (includes support stats, role, salience flags)

`ConflictInfo` — pairwise conflict with axis, stakes, dynamics, salience interaction flags

**Miscellaneous:**


`ProviderResponseType` — lifecycle stage: `'batch'` | `'mapping'` | `'editorial'` | `'singularity'` | `'probe'`

**Pipeline contract types** (detailed schema in contract.ts, extracted on demand):

- `BatchPhase`, `MappingPhase`, `SingularityPhase` — phase-specific output
- `PipelineShadowStatement`, `PipelineShadowParagraph` — extracted corpus
- `PipelineSubstrateGraph` — geometric substrate (nodes, edges, stats)
- `BasinInversionResult` — topographic basin membership
- `PreSemanticInterpretation` — regionalization + gating
- `PipelineDiagnosticsResult` — pipeline execution diagnostics

---

## Summary of Architecture

**Layered type hierarchy:**

1. **graph.ts** — semantic layer (Claim, Edge, EnrichedClaim); produced by mapper and enriched by structural analysis
2. **turns.ts** — persistence boundary (UserTurn, AiTurn, ProviderResponse); bridges storage and UI
3. **editorial.ts** — UI rendering boundary (CognitiveArtifact, EditorialThread, SingularityOutput); consumed by presentation layer
4. **provider.ts** — error handling (ProviderError, HTOSError); used across boundaries for diagnostics
5. **contract.ts** — all remaining shared types; orchestration, workflow, pipeline internals

**Key design patterns:**

- **Enrichment over mutation**: Claim → EnrichedClaim adds fields without modifying source; all salience/topology flags baked in at construction (Phase 3 CONSTRUCT)
- **Boundary types**: editorial.ts (UI), turns.ts (persistence), provider.ts (errors) are explicit seam types; contract.ts holds internal workflow
- **Union types**: ProviderErrorType, PrimaryShape, ProviderResponseType classify discrete alternatives
- **Structured error**: HTOSError/ProviderAuthError with code, context, timestamp, id for tracing
- **Type guards**: isUserTurn, isAiTurn disambiguate union types at runtime
- **Bidirectional provenance**: claims track sourceStatementIds; statements carry geometric/regional context

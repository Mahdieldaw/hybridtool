# execution — directory digest (workflow orchestration, deterministic pipeline, and I/O coordination)

---

## Architecture Overview

**Execution System:** The execution module orchestrates end-to-end workflow execution from user request to persisted artifact. It coordinates four processing phases (batch → mapping → singularity → recompute) with deterministic computation of derived fields (provenance, routing, structure) and multi-stage I/O coordination (context resolution → streaming → persistence → turn finalization).

```
User Request
       ↓
[WORKFLOW-ENGINE] — orchestrates phases + context management
       ├─ [BATCH PHASE] ← executeBatchPhase()
       │  ├─ Parallel LLM provider calls (batch-phase.ts)
       │  └─ llm-runner.ts: validate → context resolve → fanout → recovery → parse → persist
       │
       ├─ [GEOMETRY PIPELINE] ← buildGeometryAsync()
       │  ├─ geometry-runner.ts: embeddings → substrate → basin inversion → pre-semantic
       │  └─ Async background computation
       │
       ├─ [MAPPING PHASE] ← executeMappingPhase()
       │  ├─ Semantic mapper LLM invocation (mapping-phase.ts)
       │  └─ Parse semantic output + invoke deterministic pipeline
       │
       ├─ [DETERMINISTIC PIPELINE] ← computePreSurveyPipeline()
       │  ├─ Parse mapper → shadow → geometry → Phase 1 (measureProvenance)
       │  ├─ 5-Phase provenance pipeline (measure → validate → surface → structure → classify)
       │  ├─ Structural analysis + artifact assembly
       │  └─ Identical computation path for live + regeneration
       │
       ├─ [SINGULARITY PHASE] ← executeSingularityPhase()
       │  └─ Editorial model invocation (singularity-phase.ts)
       │
       └─ [RECOMPUTE HANDLER] ← handleRecompute()
          └─ Artifact rebuild from historical state (recompute-handler.ts)
       ↓
[I/O COORDINATION]
       ├─ context-manager.ts: resolve provider context (3-tier priority)
       ├─ streaming-manager.ts: emit partial results (delta-based)
       ├─ persistence-coordinator.ts: IndexedDB writes
       └─ turn-emitter.ts: finalize user/AI turns
       ↓
Persisted Artifact → UI Message
```

**Directory Organization:**

- **Root** — `workflow-engine.js`, `deterministic-pipeline.js`
  - `workflow-engine.js` — Orchestrator for foundation phases (batch → mapping → singularity) with step execution, context seeding, halt conditions, error recovery
  - `deterministic-pipeline.js` — Shared semantic pipeline ensuring identical derived field computation for both live and regeneration paths
  
- `pipeline/` — **Foundation Phases:** batch-phase.ts, mapping-phase.ts, singularity-phase.ts, recompute-handler.ts
  - Batch: parallel LLM provider invocations with health gating + auth fallback
  - Mapping: semantic mapper invocation + artifact building
  - Singularity: editorial model invocation for completeness/alignment
  - Recompute: artifact rebuild from historical snapshots

- `io/` — **I/O Coordination:** context-manager.ts, streaming-manager.ts, persistence-coordinator.ts, turn-emitter.ts
  - Context resolution: 3-tier priority (workflow-cached > historical/recompute > batch-step > persisted)
  - Streaming: delta-based partial result emission with divergence detection
  - Persistence: IndexedDB writes + batch aggregation
  - Turn finalization: immutable user/AI turn objects

- `utils/` — **Specialized Executors:** llm-runner.ts, geometry-runner.ts
  - LLM runner: single-step provider execution with partial recovery + auth fallback
  - Geometry runner: async embeddings + substrate + basin inversion + pre-semantic

- `geometry/` — **Geometry Pipeline:** measure.ts, interpret.ts, annotate.ts, engine.ts
  - (See geometry/digest-geometry.md for detailed 4-phase geometry description)

**Key Invariants:**

- **Deterministic computation:** All derived fields (provenance, routing, structure) computed identically in live and recompute paths
- **Phase discipline:** Each phase reads only from previous phase output; no backward references
- **Collect-then-construct:** All metrics derived before objects fully built (prevents partial state)
- **Artifact immutability:** Once assembled, artifacts are read-only snapshots
- **Context priority:** Workflow-cached > historical/recompute > batch-step > persisted (recency wins)
- **Streaming statefulness:** Delta computation resets on divergence (isReplace flag)
- **Graceful degradation:** All steps wrapped in try/catch; failures null-out results but don't block pipeline
- **Health gating:** Provider circuit breaker + auth fallback enable resilience across failures

---

## WorkflowEngine (workflow-engine.js)

**Foundation Phase Orchestrator — Request Routing, Step Execution, Control Flow, Finalization**

Main orchestrator for batch → mapping → singularity execution, with context seeding, halt conditions, error recovery, and turn finalization.

**`class WorkflowEngine`**

**Constructor:**
```typescript
new WorkflowEngine(orchestrator, sessionManager, port, _options?)
  - orchestrator: provider fanout + execution
  - sessionManager: context + persistence
  - port: UI message channel
  - Initializes: healthTracker, streamingManager, contextManager, persistenceCoordinator, turnEmitter
```

**Primary Methods:**

**`execute(request, resolvedContext): Promise<void>`**

Main workflow execution loop. Routes through batch → mapping → singularity phases, checks halt conditions, persists results, and finalizes turns.

**Input:**
- `request` — { context: {...}, steps: [...], workflowId: ... }
- `resolvedContext` — recompute/extend/initialize context with historical state

**Flow:**

1. Persist checkpoint (non-blocking)
2. Validate step types (only 'prompt'/'mapping'/'singularity' allowed)
3. Seed contexts from resolvedContext (recompute frozen batch + provider contexts)
4. Execute steps sequentially (order determined by WorkflowCompiler):
   - For each step: call `_executeStep()` → check halt conditions → persist response
   - Halt conditions: insufficient_witnesses (< 2 batch providers before mapping)
5. On success: `_persistAndFinalize()`
6. On error: attempt `_persistAndFinalize()` for cleanup, then mark turn as errored
7. Finally: clear streaming cache

**Error Recovery:**

- Try/catch wraps entire execution
- On critical error: attempt to mark turn as errored in IndexedDB (with exponential backoff retries)
- Always finalizes turn or emits WORKFLOW_COMPLETE message

**`_executeStep(step, context, stepResults, workflowContexts, resolvedContext): Promise<object>`**

Execute single step by delegating to phase-specific executor.

**Input:** step (type + payload), context, accumulating results maps

**Pipeline:**

1. Look up executor for step.type ('prompt' → executeBatchPhase, etc.)
2. Build options object: port, streamingManager, persistenceCoordinator, sessionManager, orchestrator, healthTracker, contextManager (for mapping only)
3. Execute step via executor function
4. On success:
   - Store result in stepResults map (status: 'completed')
   - Emit WORKFLOW_STEP_UPDATE message
   - Seed workflowContexts from batch provider metadata
   - Cache mapping artifact in context
   - Persist step response to turn
5. On error:
   - Classify error
   - Store error in stepResults map (status: 'failed')
   - Emit WORKFLOW_STEP_UPDATE message with error
   - Throw error (triggers halt)

**`_checkHaltConditions(step, result, request, context, steps, stepResults, resolvedContext): Promise<string | null>`**

Check if workflow should halt after step completion.

**Halt Conditions:**

- **'insufficient_witnesses'** — After batch phase: if mapping planned but < 2 batch providers succeeded
- Returns halt reason string or null (continue)

**`_haltWorkflow(request, context, steps, stepResults, resolvedContext, haltReason): Promise<void>`**

Halt workflow execution early.

- Calls `_persistAndFinalize()` with haltReason
- Emits WORKFLOW_COMPLETE message with haltReason

**`_persistAndFinalize(request, context, steps, stepResults, resolvedContext, haltReason): Promise<void>`**

Persist results and finalize turns.

**Flow:**

1. Build persistence payloads from stepResults (batch/mapping/singularity outputs)
2. Format batch phase: { responses: { [providerId]: { text, modelIndex, status, meta } } }
3. Format singularity phase: { prompt, output, timestamp }
4. Call `persistenceCoordinator.persistWorkflowResult()` to IndexedDB
5. Update context with canonical turn IDs from persist result
6. Emit WORKFLOW_COMPLETE message
7. Call `turnEmitter.emitTurnFinalized()` to finalize turn objects

**Helper Methods:**

- **`_seedContexts()`** — Populate workflowContexts from recompute frozen batch + provider contexts (extend mode)
- **`_emitStepUpdate()`** — Send WORKFLOW_STEP_UPDATE message to UI
- **`_persistStepResponse()`** — Upsert provider response to existing turn in IndexedDB
- **`_persistCheckpoint()`** — Early persist for in-progress turns (enables partial recovery)
- **`_buildOptionsForStep()`** — Assemble shared services for step executor
- **`_safePostMessage()`** — Emit message to port with disconnection handling

**Continuation Methods:**

- **`handleRetryRequest(message)`** — Reset circuit breaker for providers + re-queue execution
- **`handleContinueCognitiveRequest(payload)`** — Delegate to recompute handler for artifact rebuild

**Design:** Single execution loop with pluggable executors; strict phase ordering; multi-layer error recovery with turn error marking; port abstraction for testability.

---

## Deterministic Pipeline (deterministic-pipeline.js)

**Shared Semantic Pipeline — Identical Computation for Live and Regeneration Paths**

Central computation module ensuring both StepExecutor (live) and sw-entry.js (regeneration) produce identical artifacts. Single source of truth for all derived fields (claims, embeddings, density, routing, conflict validation, structural analysis).

**`computePreSurveyPipeline(input): Promise<object>`**

Full pre-survey workflow: parse → shadow → geometry → embeddings → Phase 1 → derived fields → assembly. Core entry point for artifact reconstruction.

**Input:**
- `mappingText` — raw semantic mapper output (or skip if parsedMappingResult provided)
- `parsedMappingResult` — pre-parsed { claims, edges, narrative, conditionals }
- `shadowStatements, shadowParagraphs` — pre-extracted (or reconstruct from batchSources)
- `statementEmbeddings, paragraphEmbeddings, queryEmbedding` — pre-computed vectors
- `preBuiltSubstrate, preBuiltPreSemantic` — skip geometry rebuild if provided
- `modelCount, queryText, turn` — context

**Output:** Complete pre-survey state object:
```javascript
{
  parsedClaims, parsedEdges, parsedNarrative, parsedConditionals,
  enrichedClaims,                 // canonical sourceStatementIds from Phase 1
  shadowStatements, shadowParagraphs,
  substrate, preSemantic, queryRelevance, regions,
  // Derived fields from 5-phase provenance:
  claimProvenance, blastSurfaceResult, mixedProvenanceResult,
  passageRoutingResult, claimDensityResult, provenanceRefinement,
  statementClassification, cachedStructuralAnalysis,
  // Shortcuts + metadata:
  claimRouting, claimDensityScores, derived: { ... },
  mapperClaimsForProvenance, citationSourceOrder,
}
```

**Pipeline:**

1. Parse mapping text (unless provided)
2. Shadow reconstruction (unless provided)
3. Geometry build or reuse (StepExecutor reuses; new workflows rebuild)
4. Phase 1 bootstrap (`measureProvenance`): canonical sourceStatementIds + claim embeddings
5. Call `computeDerivedFields()` for full 5-phase provenance + structural analysis
6. Return complete pre-survey state

**`computeDerivedFields(input): Promise<object>`**

Computes all derived metrics from embeddings + semantic output.

**Output:**
```javascript
{
  claimProvenance,                // canonical ownership + exclusivity
  claimProvenanceExclusivity,     // per-claim ratios
  statementOwnership,             // statement → Set<claimId> map
  cachedStructuralAnalysis,       // graph metrics + patterns
  blastSurfaceResult,             // twin map + risk vectors
  mixedProvenanceResult,          // Phase 1 canonical structures
  basinInversion,                 // topographic analysis
  bayesianBasinInversion,         // Bayesian variant
  queryRelevance,                 // statement scores vs. query
  semanticEdges, derivedSupportEdges,
  passageRoutingResult,           // load-bearing claims + landscape
  claimDensityResult,             // per-claim passage metrics
  provenanceRefinement,           // joint statement disambiguation
  statementClassification,        // claimed/unclaimable/routing
}
```

**5-Phase Provenance Pipeline** (via `buildProvenancePipeline`):

1. **Phase 1: Measure** — `measureProvenance()` → canonical provenance, ownership, density
2. **Phase 2: Validate** — `validateConflicts()` → conflict validation, allegiance scoring
3. **Phase 3: Surface** — `surfacePassageRouting()` → passage routing, blast surface
4. **Phase 4: Structure** — `analyzeStructure()` → graph topology, cascade risks
5. **Phase 5: Classify** — `classifyStatements()` → statement routing (claimed/unclaimable)

**Graceful Degradation:** All steps wrapped in try/catch; failures null-out results but don't block pipeline.

**`assembleMapperArtifact(derived, enrichedClaims, ...): object`**

Pure assembly: wraps derived fields + parsed output into immutable artifact.

**`assembleFromPreSurvey(preSurvey, opts): Promise<object>`**

Post-semantic assembly: mapper artifact → CognitiveArtifact.

**Output:** { cognitiveArtifact, mapperArtifact, enrichedClaims, claimEmbeddings, cachedStructuralAnalysis }

**`buildArtifactForProvider(options): Promise<object>`**

Thin wrapper: `computePreSurveyPipeline → assembleFromPreSurvey`. Single entry point for artifact reconstruction.

**Design:** Deterministic, reusable, gracefully degrading. New field checklist: add to `computeDerivedFields` → both live and regen paths get it automatically.

---

## Pipeline Phases

### Batch Phase (pipeline/batch-phase.ts)

Parallel LLM provider invocations with health gating and auth fallback.

**Flow:**
1. Resolve each provider's context (3-tier)
2. Execute in parallel via orchestrator.executeParallelFanout()
3. Apply health gating (circuit breaker, degradation)
4. Emit partial deltas as chunks arrive
5. Aggregate results: { results: { [providerId]: { text, status, meta, modelIndex } } }

### Mapping Phase (pipeline/mapping-phase.ts)

Semantic mapper invocation + deterministic pipeline orchestration.

**Flow:**
1. Resolve mapper provider context
2. Invoke mapper via executeGenericSingleStep()
3. Parse semantic output (claims, edges, narrative)
4. Invoke deterministic pipeline (`computePreSurveyPipeline`)
5. Return: { mapping: { artifact: CognitiveArtifact, ... } }

### Singularity Phase (pipeline/singularity-phase.ts)

Editorial model invocation for completeness + alignment assessment.

**Flow:**
1. Build editorial prompt from artifact + context
2. Invoke editorial model via executeGenericSingleStep()
3. Parse editorial output
4. Return: { singularity: { output, timestamp } }

### Recompute Handler (pipeline/recompute-handler.ts)

Artifact rebuild from historical snapshots.

**Flow:**
1. Load frozen batch outputs + provider contexts from source turn
2. Reconstruct geometry (if needed)
3. Invoke deterministic pipeline with frozen batch
4. Build artifact
5. Return: { artifact, ... }

---

## I/O Coordination

### Context Manager (io/context-manager.ts)

Three-tier provider context resolution with priority ranking.

**`resolveProviderContext(providerId, ...): Record<string, { meta, continueThread }>`**

**Resolution pipeline:**
1. **Tier 1 (Workflow Cache)** — contexts produced earlier in this workflow run
2. **Tier 2 (Historical/Recompute)** — for recompute operations re-reading historical state
3. **Tier 2b (Batch Step)** — context from prior batch step (backwards compatibility)
4. **Tier 3 (Persisted)** — last-known provider state from IndexedDB

Returns `{ [providerId]: { meta, continueThread } }` or `{}` if no context found.

**Design:** Workflow-local contexts preferred to avoid cross-execution state corruption.

### Streaming Manager (io/streaming-manager.ts)

Delta-based partial result streaming with divergence detection.

**`makeDelta(sessionId, stepId, providerId, fullText): { text, isReplace }`**

**Algorithm:**
1. First emission: send full text, isReplace: false
2. Standard append: send suffix only, isReplace: false
3. Divergence detected: send full text, isReplace: true (UI replaces, not appends)
4. No change: send empty string, isReplace: false

**Design:** Stateful tracking enables efficient delta-only streaming; divergence detection prevents stale artifacts.

### Persistence Coordinator (io/persistence-coordinator.ts)

IndexedDB writes + result aggregation.

**`persistProviderContexts(sessionId, updates, contextRole)`**

Synchronous IndexedDB writes to prevent service worker suspension.

**`buildPersistenceResultFromStepResults(steps, stepResults)`**

Transforms step results into persistence-ready payloads.

**Output:** { batchOutputs, mappingOutputs, singularityOutputs }

**`persistWorkflowResult(request, resolvedContext, result)`**

Delegates to sessionManager for full workflow persistence.

### Turn Emitter (io/turn-emitter.ts)

Turn finalization — result aggregation and immutable turn object construction.

**`emitTurnFinalized(context, steps, stepResults, resolvedContext, currentUserMessage)`**

**Gating conditions:**
- Skip on recompute (diagnostic only)
- Skip if no user message (turns require anchor)
- Skip if no AI responses (empty AI side has no value)

**Output:** Finalized turn structure:
```typescript
{
  type: 'TURN_FINALIZED',
  sessionId, userTurnId, aiTurnId,
  turn: {
    user: { id, type: 'user', text, createdAt, sessionId },
    ai: {
      id, type: 'ai', userTurnId, sessionId, threadId, createdAt,
      pipelineStatus, batch?, mapping?, singularity?, meta: { mapper, requestedFeatures }
    }
  }
}
```

**Design:** Turns are immutable after emission; structured to support history, replay, and UI display.

---

## Utilities

### LLM Runner (utils/llm-runner.ts)

**`executeGenericSingleStep(step, context, providerId, prompt, stepType, options, parseOutputFn)`**

Single-step LLM execution with 3-tier context resolution, partial recovery, output parsing, context persistence, health tracking, and auth fallback.

**Pipeline:**
1. Validate limits (prompt length)
2. Resolve provider context (3-tier)
3. Execute fanout → emit partial deltas
4. Partial recovery: use streamed text if final result empty
5. Parse output via parseOutputFn
6. Emit final delta
7. Persist context to IndexedDB
8. Auth fallback: retry with fallback provider on auth error

**Design:** Stateful recovery + health gating + auth fallback enable resilience.

### Geometry Runner (utils/geometry-runner.ts)

**`buildGeometryAsync(paragraphResult, shadowResult, indexedSourceData, payload, context, options, geometryDiagnostics, nowMs)`**

Async geometry pipeline: embeddings → substrate → pre-semantic interpretation → query relevance.

**Pipeline:**
1. Offscreen document setup
2. Parallel embeddings (query, paragraph, statement)
3. Dimension validation
4. Substrate construction (includes histogram pre-computation)
5. Pre-semantic interpretation (invokes basin inversion internally)
6. Query relevance scoring
7. Enrich statements/paragraphs with coordinates
8. Persist embeddings

**Output:** returns results object with substrate, preSemanticInterpretation (which contains basinInversion internally), geometryParagraphEmbeddings, etc.

**Design:** Isolated offscreen context, parallel generation within fail-safe boundaries, graceful degradation. Basin inversion is now computed inside interpret phase and accessed via preSemanticInterpretation result.

---

## Key Design Principles

**Deterministic Computation:** All derived fields computed identically in live and recompute paths from same inputs.

**Phase Discipline:** Each phase reads only from previous output; no backward references or cross-phase coupling.

**Collect-then-Construct:** All metrics derived before objects fully built (prevents partial state artifacts).

**Artifact Immutability:** Once assembled, artifacts are read-only snapshots suitable for storage.

**Context Priority:** Workflow-cached > historical/recompute > batch-step > persisted (recency wins).

**Streaming Statefulness:** Delta computation maintains stream state; divergence resets accumulation.

**Graceful Degradation:** All steps wrapped in try/catch; failures null-out specific results but pipeline continues.

**Health Gating:** Provider circuit breaker + auth fallback enable resilience across provider failures.

**Separation of Concerns:** Workflows handle orchestration, deterministic pipeline handles computation, I/O handles context/streaming/persistence, utilities handle LLM/geometry.

**Port Abstraction:** Messaging decoupled from concrete implementation (testable via mock ports).

---

## Integration Points

**Upstream (external systems providing input):**

- Batch responses → cached + shadow extracted
- Semantic mapper output → parsed into claims + edges
- Provider orchestrator → fanout execution + streaming
- SessionManager → context retrieval + persistence
- Geometry computation → embeddings + substrate
- Provider health tracker → circuit breaker status

**Downstream (consuming pipeline output):**

- UI → receives partial results + finalized turns
- Storage → IndexedDB persistence of contexts + turns
- Artifact consumers → receive immutable artifacts from turns
- Historical replay → consumes finalized turns for recovery

---

## Summary

**Execution System Architecture:**

Unified orchestration of foundation phases (batch → mapping → singularity) with deterministic computation and multi-stage I/O coordination:

1. **WorkflowEngine** — Orchestrates phase execution, manages context seeding, checks halt conditions, handles errors, and finalizes turns
2. **Deterministic Pipeline** — Single-source computation of all derived fields (provenance, routing, structure) ensuring identical artifacts in live and recompute paths
3. **Pipeline Phases** — Foundation phases (batch, mapping, singularity) + recompute handler with specialized LLM/geometry utilities
4. **I/O Coordination** — Context resolution (3-tier), streaming (delta-based), persistence (IndexedDB), turn finalization (immutable objects)
5. **Utilities** — LLM runner (provider execution + recovery) and geometry runner (async embeddings + substrate)

**Key Properties:**

- **Single Source of Truth** — New derived fields added to deterministic pipeline flow through both live and regen paths automatically
- **Resilient Execution** — Health gating + auth fallback + partial recovery enable graceful degradation
- **Deterministic Output** — Identical artifacts from identical inputs regardless of execution path
- **Immutable Artifacts** — Finalized artifacts are snapshots suitable for storage and replay
- **Streaming First** — Partial results emitted as computation progresses
- **Storage Agnostic** — SessionManager abstraction enables multiple backend options

**Entry Points:**

- **Workflow execution:** `WorkflowEngine.execute(request, resolvedContext)`
- **Artifact reconstruction:** `computePreSurveyPipeline(...)`
- **Continuation:** `WorkflowEngine.handleContinueCognitiveRequest(payload)`
- **Retry:** `WorkflowEngine.handleRetryRequest(message)`

**File Checklist:**

- Root: workflow-engine.js (orchestrator), deterministic-pipeline.js (deterministic computation)
- pipeline/: batch-phase.ts, mapping-phase.ts, singularity-phase.ts, recompute-handler.ts
- io/: context-manager.ts, streaming-manager.ts, persistence-coordinator.ts, turn-emitter.ts
- utils/: llm-runner.ts, geometry-runner.ts
- geometry/: measure.ts, interpret.ts, annotate.ts, engine.ts (see geometry/digest-geometry.md)

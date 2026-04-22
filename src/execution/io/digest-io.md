# execution/io — file digest (input/output coordination and provider context lifecycle)

---

## Architecture Overview

**I/O Coordination Pipeline:** The io module manages provider context resolution, result persistence, streaming output to the UI, and turn event emission. It serves as the bridge between the execution pipeline and external storage/UI communication.

```
Execution Pipeline
         ↓
[CONTEXT] — resolveProviderContext()
    ├─ Tier 1: Workflow cache context
    ├─ Tier 2: Historical/recompute context
    ├─ Tier 3: Batch step context
    └─ Fallback: Persisted context
         ↓
[STREAMING] — makeDelta() + postMessage()
    └─ Emits partial results to UI
         ↓
[PERSISTENCE] — persistProviderContexts()
    ├─ Updates IndexedDB batch
    └─ Saves session
         ↓
[TURNF] — emitTurnFinalized()
    └─ Aggregates all results into turn objects
         ↓
Turn Message
```

**File Organization:**

- `context-manager.ts` — **Context Resolution:** Three-tier provider context resolver; prioritizes workflow-local contexts over persisted state
- `streaming-manager.ts` — **Streaming I/O:** Delta computation and partial result streaming to UI via postMessage
- `persistence-coordinator.ts` — **Persistence Orchestration:** Wraps sessionManager for IndexedDB writes, builds persistence payloads from step results
- `turn-emitter.ts` — **Turn Aggregation:** Converts step results + context into finalized user/AI turn objects, emits via postMessage

**Key Invariants:**

- **Context priority**: Workflow-cached > historical/recompute > batch-step > persisted (recency wins)
- **Streaming stateless**: delta computation resets on divergence (isReplace flag)
- **Turn finalization**: gated on non-empty user message; skipped for recompute operations
- **Port abstraction**: StreamingManager + TurnEmitter decouple from concrete messaging (testable via mock ports)

---

## context-manager.ts

**Provider Context Resolution — Three-Tier Hierarchy**

Manages context availability across provider invocations with strict priority ranking.

**`resolveProviderContext(providerId, context, payload, workflowContexts, previousResults, resolvedContext, stepType): Record<string, { meta, continueThread }>`**

Resolves a single provider's context using three-tier fallback.

**Resolution pipeline:**

1. **Tier 1 (Workflow Cache — highest priority)** — contexts produced earlier in this workflow run
   - Checks `workflowContexts[providerId]`
   - Wrapped as `{ meta, continueThread: true }`
   - Used for multi-step workflows where provider state persists within a single execution

2. **Tier 2 (Historical/Recompute Context)** — for recompute operations re-reading historical state
   - Checks `resolvedContext.type === 'recompute'`
   - Reads `resolvedContext.providerContextsAtSourceTurn[providerId]`
   - Allows workflows to re-run from a prior snapshot without fetching from IndexedDB

3. **Tier 2b (Batch Step Context — backwards compatibility)** — context from prior batch step in same workflow
   - Checks `payload.continueFromBatchStep`
   - Reads `previousResults.get(batchStepId)`
   - Fallback for older workflow structures

4. **Tier 3 (Persisted Context — fallback)** — last-known provider state from IndexedDB
   - Calls `sessionManager.getProviderContexts(sessionId, threadId)`
   - May be stale across workflow runs
   - Only used if all higher-priority contexts absent

Output: `{ [providerId]: { meta: {...}, continueThread: true } }` or `{}` if no context found.

**Design**: Workflow-local contexts are preferred to avoid cross-execution state corruption; persistence used only as last resort.

---

## streaming-manager.ts

**Partial Result Streaming — Delta Computation and Emission**

Manages incremental streaming of provider responses to the UI, computing deltas to avoid redundant transmission.

**`constructor(port)`**

Initializes with a message port for sending PARTIAL_RESULT messages to the UI. Null/undefined port is tolerated (silent fallback).

**`setPort(port)`**

Updates the port (e.g., when a new connection is established).

**`makeDelta(sessionId, stepId, providerId, fullText): { text, isReplace }`**

Computes delta between previous state and new fullText.

**Algorithm:**

1. **First emission** (prev.length === 0, fullText.length > 0)
   - Send full text as-is, `isReplace: false`
   - Cache state

2. **Standard append** (fullText is exact prefix-continuation of prev)
   - Send only the new suffix, `isReplace: false`
   - Cache updated state

3. **Divergence detected** (fullText not a prefix-continuation)
   - Send full text, `isReplace: true` (signals UI to replace, not append)
   - Cache updated state

4. **No change** (fullText === prev)
   - Send empty string, `isReplace: false`
   - No cache update

**Internal State:**

- `streamStates: Map<string, StreamState>` — keyed by `"${sessionId}:${stepId}:${providerId}"`
- Tracks `text` (previous transmitted text), `lastWarn`, `warnCount`

**Emission:**

Caller receives `{ text, isReplace }` to construct `PartialResultMessage`:

```typescript
{
  type: 'PARTIAL_RESULT',
  sessionId,
  stepId,
  providerId,
  chunk: { text, isFinal: boolean, isReplace }
}
```

**Design**: Stateful tracking allows efficient delta-only streaming; divergence detection prevents stale-state artifacts.

---

## persistence-coordinator.ts

**Persistence Orchestration — IndexedDB Writes and Result Aggregation**

Wraps sessionManager with high-level persistence operations for the deterministic pipeline.

**`constructor(sessionManager)`**

Stores reference to sessionManager (likely provided by service worker or browser storage layer).

**`persistProviderContexts(sessionId, updates, contextRole)`**

Persists provider contexts synchronously to prevent Chrome service worker suspension.

- Calls `sessionManager.updateProviderContextsBatch(sessionId, updates, { contextRole })`
- Calls `sessionManager.saveSession(sessionId)` to finalize IndexedDB write
- **Note:** IndexedDB writes are fast; awaiting keeps service worker alive (negligible impact)

**`buildPersistenceResultFromStepResults(steps, stepResults): { batchOutputs, mappingOutputs, singularityOutputs }`**

Transforms executed step results into persistence-ready payloads.

**Aggregation logic:**

1. **Batch/prompt steps** → `batchOutputs[providerId]`
   - Extracts `text`, `status` ('completed'|'error'), `meta` from result
   - One output per provider per step

2. **Mapping steps** → `mappingOutputs[providerId]`
   - Extracts `text`, `status`, `meta`, and optional `artifact` (CognitiveArtifact)
   - One output per mapping provider

3. **Singularity steps** → `singularityOutputs[providerId]`
   - Extracts `text`, `status`, `meta`
   - One output per singularity provider

**Error handling:** If step.status === 'failed', populates output with error text in `meta.error`.

Output shape:

```typescript
{
  batchOutputs: { [providerId]: { text, status, meta } },
  mappingOutputs: { [providerId]: { providerId, text, status, meta, artifact? } },
  singularityOutputs: { [providerId]: { providerId, text, status, meta } }
}
```

**`persistWorkflowResult(request, resolvedContext, result)`**

Delegates to `sessionManager.persist()` for full workflow result persistence.

**`upsertProviderResponse(sessionId, aiTurnId, providerId, responseType, responseIndex, payload)`**

Delegates to `sessionManager.upsertProviderResponse()` to update provider response entries in an existing turn.

**`updateProviderContextsBatch(sessionId, updates, options)`**

Delegates to `sessionManager.updateProviderContextsBatch()` for batch context updates.

**Design**: Thin orchestration layer; all actual storage delegated to sessionManager. Enables clean separation of execution logic from persistence mechanics.

---

## turn-emitter.ts

**Turn Finalization — Result Aggregation and Emission**

Converts step results + execution context into finalized user/AI turn objects suitable for storage and UI consumption.

**`constructor(port)`**

Initializes with a message port for sending TURN_FINALIZED messages. Stores `lastFinalizedTurn` for debugging.

**`emitTurnFinalized(context, steps, stepResults, resolvedContext, currentUserMessage)`**

Main emission function. Aggregates batch/mapping/singularity results into a single AiTurn object paired with a UserTurn.

**Gating conditions:**

1. **Skip on recompute** — `resolvedContext.type === 'recompute'`
   - Recompute operations don't emit turns (diagnostic only)

2. **Skip if no user message** — userMessage is empty
   - Turns require a message anchor

3. **Skip if no AI responses** — no batch/mapping/singularity outputs collected
   - Empty AI side has no value to persist

**Aggregation pipeline:**

1. **Generate IDs** — userTurnId + aiTurnId (or use canonical IDs from context)
2. **Build UserTurn** — simple wrapper around userMessage + sessionId + timestamp
3. **Collect batch responses** — from all 'prompt'/'batch' step results
   - Keyed by providerId, aggregated across steps
   - Extract text, status, meta, modelIndex
4. **Collect mapping responses** — from all 'mapping' step results
   - Store mapping artifact if present
   - Track primary mapper (first mapping provider ID)
5. **Collect singularity responses** — from all 'singularity' step results
6. **Build AiTurn** — aggregate all responses + metadata
   - Batch phase: `{ responses: { [providerId]: { text, modelIndex, status, meta } } }`
   - Mapping phase: `{ artifact: CognitiveArtifact }`
   - Singularity phase: `{ prompt, output, timestamp }`
   - Meta: mapper name, requested features flags, workflow control

**Response structure (per provider per step type):**

```typescript
{
  providerId: string,
  text: string,
  status: 'completed' | 'error',
  createdAt: number,
  updatedAt: number,
  meta: Record<string, unknown>,
  artifact?: CognitiveArtifact // mapping only
}
```

**Finalized turn shape:**

```typescript
{
  type: 'TURN_FINALIZED',
  sessionId,
  userTurnId,
  aiTurnId,
  turn: {
    user: { id, type: 'user', text, createdAt, sessionId },
    ai: {
      id,
      type: 'ai',
      userTurnId,
      sessionId,
      threadId,
      createdAt,
      pipelineStatus,
      batch?: { responses: { [providerId]: ... } },
      mapping?: { artifact: CognitiveArtifact },
      singularity?: { prompt, output, timestamp },
      mappingResponses?: { [providerId]: ResponseEntry[] },
      meta: { mapper, requestedFeatures, workflowControl? }
    }
  }
}
```

**Post-emission cleanup:**

- If `pipelineStatus === 'complete'`, calls `cleanupPendingEmbeddingsBuffers()` to release clustering memory
- Stores turn in `lastFinalizedTurn` for debugging

**Error handling:** Wraps entire emission in try/catch; logs error to console but doesn't throw.

**Design**: Turns are immutable after emission; structured to support history, replay, and UI display without re-processing.

---

## Integration with Broader System

**Upstream (consumes):**

- `StepExecutor.js` — provides context, steps, step results, resolvedContext
- SessionManager — storage abstraction (IndexedDB, localStorage fallback)
- UI port — browser's MessagePort for postMessage communication
- Clustering layer — embeddings cleanup on turn finalization

**Downstream (consumed by):**

- Service worker — reads context from ContextManager before invoking providers
- IndexedDB storage — receives persistence payloads from PersistenceCoordinator
- UI — receives PARTIAL_RESULT and TURN_FINALIZED messages from StreamingManager + TurnEmitter
- History/persistence layer — consumes finalized turns for storage and retrieval

**Key Relationships:**

- **ContextManager + PersistenceCoordinator** — read/write cycle for provider metadata
- **StreamingManager** — non-blocking progress feedback during long operations
- **TurnEmitter** — immutable, final representation of a user-AI exchange
- **Port abstraction** — enables testability (mock ports) and decouples from browser APIs

---

## Summary

**I/O Coordination Layer:**

The execution/io module provides four-stage I/O coordination for the deterministic pipeline:

1. **Context Resolution** (context-manager.ts) — retrieve provider state with three-tier priority
2. **Streaming** (streaming-manager.ts) — emit partial results with delta optimization
3. **Persistence** (persistence-coordinator.ts) — write provider contexts and results to IndexedDB
4. **Turn Finalization** (turn-emitter.ts) — aggregate all step results into immutable turn objects

**Key Design Principles:**

- **Priority-driven context** — workflow-local state preferred over persisted
- **Streaming efficiency** — delta-based partial results with divergence detection
- **Storage abstraction** — sessionManager handles all persistence details
- **Port abstraction** — messaging decoupled from concrete implementation (testable)
- **Gating discipline** — turns only emitted on non-empty user message + non-recompute + non-empty AI responses
- **Immutability** — finalized turns are read-only snapshots suitable for storage

**Entry Points:**

- **Context resolution:** `contextManager.resolveProviderContext(...)`
- **Partial streaming:** `streamingManager.makeDelta(...)` + `port.postMessage(...)`
- **Persistence:** `persistenceCoordinator.persistProviderContexts(...)`
- **Turn finalization:** `turnEmitter.emitTurnFinalized(...)`

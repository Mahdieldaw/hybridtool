# @src/system — file digest (Chrome extension architecture & messaging)

---

## Overview

`@src/system` provides **low-level infrastructure for Chrome extension communication, service lifecycle management, and connection handling**. It implements the HTOS Bus protocol for inter-context messaging (background service worker, offscreen document, content scripts, iframes), a registry for service dependencies, and lifecycle tracking for keep-alive management.

The layer is organized into four semantic domains:

1. **BusController.js** — Universal messaging bridge (bg ↔ os ↔ oi ↔ content scripts)
2. **ServiceRegistry.js** — Singleton dependency container for global service instances
3. **LifecycleManager.js** — Activity tracking and inactivity detection
4. **ConnectionHandler.ts** — Workflow execution, probe queries, turn persistence orchestration

---

## BusController.js

Complete bus implementation for inter-context Chrome extension messaging. Supports three loci: background (bg), offscreen (os), and offscreen iframe (oi).

**Role:**

- Implements bidirectional messaging across Chrome extension contexts
- Serializes/deserializes complex objects (errors, structured data)
- Maintains request/response correlation via request IDs
- Routes messages through parent-child iframe boundaries with timeout protection
- Handles context-specific setup (listeners, port management)

**Environments (Loci):**

- **bg (background)** — Service worker context; routes to offscreen, content scripts, extension clients
- **os (offscreen)** — Offscreen document; bridges service worker ↔ iframe (oi) bidirectionally
- **oi (offscreen iframe)** — Child iframe in offscreen document; listens to parent (os)

**Key Capabilities:**

- **Event System** — `.on(eventName, handler)`, `.off(eventName, handler)`, `.once(eventName, handler)`
- **Messaging** — `.send(eventName, ...args)` (broadcasts), `.call(eventName, ...args)` (local handlers only)
- **Polling** — `.poll(eventName, ...args)` (retry until success; 100ms interval, 60s timeout)
- **Serialization** — JSON stringify/parse with Error reconstruction (errors → `bus.error.{message}` strings)
- **Request/Response** — Automatic UUID-based request tracking, 30s timeout per request
- **Proxy Registration** — `bus.proxy` event allows iframe to register handlers on parent; parent broadcasts to registered proxies

**Architecture:**

```
Service Worker (bg)
    ↓ (chrome.runtime.sendMessage)
Offscreen Document (os) ← listens for chrome.runtime.onMessage
    ↓ (postMessage with reqId/resId)
Child Iframe (oi) ← listens for window.message

Reverse: oi.postMessage(resId) → os listener clears pending map → responds to sw
```

**Public API:**

- `async init()` — Initialize context-specific listeners
- `async send(eventName, ...args)` — Route to extension API or local handlers
- `async call(eventName, ...args)` — Route to local handlers only (no extension API)
- `async poll(eventName, ...args)` — Retry until non-null response
- `on(eventName, handler, thisBinding?)` — Register event listener
- `off(eventName, handler?)` — Remove event listener
- `once(eventName, handler)` — One-shot listener

**Internal Methods:**

- `_setupBg()` — Register `chrome.runtime.onMessage` listener
- `_setupOs()` — Dual listeners (iframe postMessage + chrome.runtime.onMessage); pending response map with TTL
- `_setupOi()` — Listen to parent postMessage, reply with `resId: reqId`
- `_sendToExt(eventName, ...args)` — Chrome extension API sendMessage
- `_sendToIframe(eventName, ...args)` — postMessage to child iframe with request tracking
- `_sendToParent(eventName, ...args)` — postMessage to parent window with request tracking
- `_callHandlers(message, filterFn?)` — Execute registered handlers; pick first non-null result
- `_serialize(obj)` → JSON string (Errors → `bus.error.{msg}`)
- `_deserialize(str)` → object (reconstructs Errors)
- `_createBusMsg(payload)` → `{ $bus: true, appName: 'htos', ...payload }`

**Message Format:**

```typescript
{
  $bus: true,              // sentinel
  appName: 'htos',         // app identifier
  name: 'eventName',       // event name
  args?: [...],            // direct arguments (preferred)
  argsStr?: '...',         // serialized args (fallback for large payloads)
  reqId?: 'bus-...',       // request ID (triggers response)
  resId?: 'bus-...',       // response ID (matches incoming reqId)
  target?: tabId,          // optional: target tab for sendMessage
}
```

**Error Handling:**

- Extension context invalidated → returns null (swallowed)
- Port closed → returns null
- Serialization failure → JSON.parse returns null
- Handler error → logs error, returns error object
- Message timeout (30s) → rejects with timeout error

---

## ServiceRegistry.js

Singleton service container for dependency injection. Replaces global variables to avoid circular imports and pollution.

**Role:**

- Central repository for service instances (sessionManager, orchestrator, authManager, etc.)
- Provides quick accessors for common services
- Eliminates need for circular `import` statements

**API:**

- `static getInstance()` — Get singleton instance (auto-creates on first call)
- `register(name, instance)` — Store service by name; throws if invalid
- `get(name)` — Retrieve service by name; returns null if not found
- `has(name)` — Check if service exists
- `unregister(name)` — Remove service by name; returns true if existed
- **Quick Accessors:**
  - `sessionManager` — Session/turn persistence
  - `persistenceLayer` — Storage layer
  - `orchestrator` — Workflow orchestrator
  - `authManager` — Authentication/provider state

**Usage:**

```typescript
const services = ServiceRegistry.getInstance();
services.register('sessionManager', sessionManagerInstance);
const sessionManager = services.sessionManager; // Quick access
```

---

## LifecycleManager.js

Simple activity tracker for inactivity detection. Keep-alive is delegated to offscreen heartbeat.

**Role:**

- Record activity timestamps for business logic
- Detect idle periods (20-minute threshold)
- Support external keep-alive signaling

**API:**

- `recordActivity()` — Set `lastActivity = Date.now()`
- `isIdle()` — Returns true if idle > 20 minutes
- `getIdleTime()` — Return milliseconds since last activity
- `keepalive(enable)` — If true, call `recordActivity()`

**Lifecycle:**

- Extension starts → `lastActivity = Date.now()`
- User activity (send message, etc.) → `recordActivity()`
- Offscreen heartbeat → keeps extension alive (separate mechanism)
- Business logic checks `isIdle()` for optimization (e.g., skip expensive operations)

---

## ConnectionHandler.ts

Orchestrates workflow execution, probe queries, and turn persistence. Bridges port-based messaging from UI clients and the backend service.

**Role:**

- Handle port-based messaging from UI (WebSocket-like long-lived connection)
- Deserialize and route client messages to workflow engine
- Persist probe sessions, turn results, and embeddings
- Manage active recomputes to prevent concurrent duplicates
- Emit real-time updates (TURN_CREATED, TURN_FINALIZED, PROBE_CHUNK, etc.)

**Message Types (Inbound):**

- `EXECUTE_WORKFLOW` — Initialize, extend, or recompute workflow
- `RETRY_PROVIDERS` — Retry providers for batch or mapping
- `PROBE_QUERY` — Execute probe (search + fanout to providers)
- `CONTINUE_COGNITIVE_WORKFLOW` — Resume singularity recompute
- `reconnect` — Connection ACK/keepalive
- `KEEPALIVE_PING` — Heartbeat from client
- `abort` — Abort ongoing workflow

**Message Types (Outbound):**

- `HANDLER_READY` — Confirm handler initialization
- `TURN_CREATED` — New turn started (sessionId, userTurnId, aiTurnId, providers)
- `TURN_FINALIZED` — Turn complete with batch/mapping/singularity results
- `WORKFLOW_STEP_UPDATE` — Progress update (status, error, isRecompute, sourceTurnId)
- `WORKFLOW_COMPLETE` — Final completion (error or success)
- `PROBE_SESSION_START` — Probe session initiated (queryText, searchResults, probeCount)
- `PROBE_CHUNK` — Streaming chunk from probe provider
- `PROBE_COMPLETE` — Probe provider finished (result with text, paragraphs, embeddings)
- `PREFLIGHT_WARNINGS` — Authorization warnings (missing providers)
- `INITIALIZATION_FAILED` — Backend initialization error

**Key Capabilities:**

- **Idempotency** — Built from clientUserTurnId (initialize), (sessionId, clientUserTurnId) (extend), or (sessionId, sourceTurnId, stepType, targetProvider) (recompute)
- **Recompute Locking** — Prevent concurrent recomputes for same key
- **Probe Persistence Queue** — Serialize probe result writes per aiTurnId (prevent race conditions)
- **Turn Persistence** — Read from adapter, reconstruct batch responses, emit TURN_FINALIZED
- **Geometry Calculation** — Import and call `computeProbeGeometry()` for probe results
- **Preflight Validation** — Check auth status, apply smart defaults (cached 60s), report warnings

**Data Flow (EXECUTE_WORKFLOW):**

```
Client message { type: 'EXECUTE_WORKFLOW', payload: ExecuteRequest }
    ↓
Check idempotency key (early exit if duplicate)
    ↓
Resolve context (initialize/extend/recompute)
    ↓
Apply preflight smart defaults (check auth, cache providers)
    ↓
Compile request to workflow steps
    ↓
If new turn: generate aiTurnId, emit TURN_CREATED, write inflight metadata
    ↓
Execute workflow via WorkflowEngine
    ↓
Delete inflight metadata on completion
    ↓
Emit TURN_FINALIZED with all artifacts (batch/mapping/singularity)
```

**Data Flow (PROBE_QUERY):**

```
Client message { type: 'PROBE_QUERY', payload: { aiTurnId, queryText, enabledProviders, searchResults, nnParagraphs } }
    ↓
Filter providers to available ones
    ↓
Generate probeSessionId if not provided
    ↓
Determine next modelIndex per provider (avoid collisions)
    ↓
Build probe session record, emit PROBE_SESSION_START
    ↓
For each provider:
  ├─ Build prompt from queryText + nnParagraphs
  ├─ Call orchestrator.executeParallelFanout()
  ├─ Stream chunks → emit PROBE_CHUNK (delta only)
  ├─ On complete: compute geometry, persist result, update session
  ├─ Emit PROBE_COMPLETE (with text, paragraphs, embeddings)
```

**Probe Persistence (per-provider result):**

```
aiTurnId + probeSessionId + modelIndex → provider_responses table
                                       → embeddings table (binary)
                                       → metadata table (geo record)
                                       → update turn.probeSessions array
                                       → update turn.mapping.artifact.citationSourceOrder
```

**Helper Methods:**

- `_buildIdempotencyKey(request)` — Generate cache key for duplicate detection
- `_emitFinalizedFromPersistence(sessionId, aiTurnId)` — Reconstruct TURN_FINALIZED from adapter
- `_buildProbePrompt(queryText, nnParagraphs)` → prompt string
- `_buildProbeSessionRecord(...)` → ProbeSessionEntry
- `_nextProbeModelIndices(aiTurnId, providerIds)` → Map<providerId, nextIndex>
- `_persistProbeResult(...)` → Updates adapter tables + turn state
- `_upsertProbeSessionOnTurn(aiTurnId, probeSessionId, updater)` → Merge probe session into turn.probeSessions
- `_enqueueProbePersistence(aiTurnId, task)` → Serialize writes per turn
- `_applyPreflightSmartDefaults(request)` → Validate auth, set defaults

**Initialization:**

```typescript
const handler = new ConnectionHandler(port, servicesOrProvider);
await handler.init(); // Register listeners, validate backend
```

**Services Dependency:**

```typescript
interface Services {
  orchestrator: { executeParallelFanout(...): void; _abortRequest(...): void }
  sessionManager: { adapter: StorageAdapter }
  providerRegistry: { isAvailable(id: string): boolean; listProviders(): string[] }
  contextResolver: { resolve(req): Promise<ResolvedContext> }
  compiler: { compile(req, ctx): CompiledWorkflowRequest }
  lifecycleManager?: LifecycleManager | null
}
```

---

## Design Patterns & Architecture

### Messaging Reliability

- **Request/Response Correlation** — UUID-based reqId/resId pairs; 30s timeout
- **Serialization Safety** — Error objects → `bus.error.{msg}` strings; reconstructed on deserialization
- **Port Lifecycle** — Cleanup on disconnect; pending operations tracked via callbacks

### Probe Execution

- **Parallel Fanout** — All enabled providers run concurrently
- **Streaming Delta** — Only emit delta (new text) to reduce traffic
- **Geometry Embedding** — Compute embeddings post-probe for vector storage
- **Idempotent Modeling** — modelIndex assigned sequentially; persisted to avoid re-mapping

### Turn Persistence

- **Inflight Tracking** — Metadata table marks turns under execution (TTL cleanup on completion)
- **Idempotency Guard** — Early exit if duplicate request detected in metadata
- **Finalization Reconstruction** — On reconnect, rebuild TURN_FINALIZED from stored responses + artifacts

### Recompute Protection

- **Active Recompute Set** — Track key=`sessionId:sourceTurnId:stepType:targetProvider`
- **Duplicate Prevention** — Skip if already in set; remove on completion
- **Scope-Based Retry** — 'mapping' or 'batch' scope for RETRY_PROVIDERS

---

## Summary of Architecture

**System Layer Roles:**

- **BusController** — Universal messaging (any context → any context)
- **ServiceRegistry** — Dependency container (avoid globals, circular imports)
- **LifecycleManager** — Activity tracking for business logic (idle detection)
- **ConnectionHandler** — Workflow orchestration + probe execution + persistence bridge

**Key Contracts:**

- BusController message format: `{ $bus: true, appName, name, args/argsStr, reqId/resId }`
- ConnectionHandler input: port-based messages (ExecuteRequest, ProbeQuery, Retry, Abort)
- ConnectionHandler output: emits (TURN_CREATED, TURN_FINALIZED, PROBE_SESSION_START, PROBE_CHUNK, PROBE_COMPLETE)

**Extension Communication Model:**

```
UI Client (port connection)
    ↓ (postMessage)
ConnectionHandler (service worker)
    ↓ (calls orchestrator, uses adapter)
WorkflowEngine + SessionManager
    ↓ (result persistence)
StorageAdapter (IDB tables: turns, responses, embeddings, metadata)
    ↓ (back through adapter → ConnectionHandler)
UI Client (receives TURN_FINALIZED events)
```

**Entry Points:**

- **BusController**: `BusController.init()` — Initialize context-specific listeners
- **ServiceRegistry**: `ServiceRegistry.getInstance().register(name, instance)` — Register services
- **LifecycleManager**: `new LifecycleManager()` — Create tracker for background
- **ConnectionHandler**: `new ConnectionHandler(port, services).init()` — Bind to port

---

## Related Modules

- **@src/execution/workflow-engine.ts** — Executes compiled workflow steps
- **@src/persistence/session-manager.ts** — Turn/session storage abstraction
- **@src/providers/auth-manager.ts** — Provider authentication state
- **@src/execution/preflight-validator.ts** — Auth validation, smart defaults
- **@src/execution/deterministic-pipeline.js** — Geometry computation for probes
- **@shared/types/contract.ts** — ResolvedContext, PrimitiveWorkflowRequest types
- **@shared/messaging.js** — PROBE_SESSION_START constant

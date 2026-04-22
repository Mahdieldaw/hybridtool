# execution/utils — file digest (LLM execution and geometry pipeline utilities)

---

## Architecture Overview

**Execution Utilities:** The utils module provides two specialized executors that handle the compute-intensive work of the execution pipeline: LLM provider calls with recovery and streaming, and async geometry building (embeddings, substrate, basin inversion). These utilities are called by the pipeline phases and abstract away provider orchestration and geometric computation.

```
Execution Request
       ↓
[LLM-RUNNER] — executeGenericSingleStep()
    ├─ Provider context resolution (3-tier)
    ├─ Prompt validation (limit checks)
    ├─ Parallel fanout execution
    ├─ Partial recovery (from streamed text on error)
    ├─ Output parsing
    ├─ Context persistence
    └─ Auth fallback (on provider auth failure)
       ↓
[GEOMETRY-RUNNER] — buildGeometryAsync()
    ├─ Offscreen document setup
    ├─ Parallel embedding generation (query, paragraph, statement)
    ├─ Dimension mismatch detection
    ├─ Substrate construction
    ├─ Pre-semantic interpretation (computes Basin Inversion internally)
    ├─ Query relevance scoring
    └─ Embedding persistence
       ↓
Geometry Results (substrate, preSemantic, embeddings)
```

**File Organization:**

- `llm-runner.ts` — **LLM Execution:** Single-step LLM provider invocation with partial recovery, output parsing, context persistence, health tracking, and auth fallback
- `geometry-runner.ts` — **Geometry Pipeline:** Async geometry building from paragraph/shadow results, including embeddings, substrate, basin inversion, and pre-semantic interpretation

**Key Invariants:**

- **Provider context priority:** Explicit scoped context > explicit raw context > persisted context (recency wins)
- **Partial recovery:** Preserve any text transmitted to client before error; use recovered text for parsing if final result empty
- **Dimension consistency:** Embeddings must match expected dimensions; mismatch triggers graceful degradation
- **Offscreen lifecycle:** Offscreen document destroyed after embedding generation to release memory
- **Streaming statefulness:** Delta computation resets on divergence (isReplace flag)

---

## llm-runner.ts

**Generic Single-Step LLM Execution — Provider Context Resolution, Fanout, Recovery, Persistence**

Executes a single LLM provider call with limit validation, context resolution, partial recovery, output parsing, streaming, and auth fallback.

**`executeGenericSingleStep(step, context, providerId, prompt, stepType, options, parseOutputFn): Promise<{ providerId, text, status, meta, output? }>`**

Main execution function for batch, mapping, and singularity steps.

**Input:**
- `step` — workflow step with payload (providerContexts, useThinking, etc.)
- `context` — execution context (sessionId, userMessage, etc.)
- `providerId` — provider to invoke
- `prompt` — validated prompt text
- `stepType` — 'batch', 'mapping', or 'singularity' (for logging)
- `options` — shared services: streamingManager, persistenceCoordinator, sessionManager, orchestrator, healthTracker, contextRole
- `parseOutputFn` — custom parser for step-specific output formats

**Output:**
```typescript
{
  providerId: string,
  text: string,                 // final response text
  status: 'completed' | 'error',
  meta: Record<string, unknown>, // provider metadata
  output?: object,               // parsed output (step-specific)
  softError?: { message: string } // partial recovery marker
}
```

**Pipeline:**

1. **Validate input limits**
   - Check prompt length against PROVIDER_LIMITS
   - Throw INPUT_TOO_LONG if exceeded

2. **Resolve provider context (3-tier)**
   - Tier 1: Explicit scoped context (`providerContexts[providerId:contextRole]`)
   - Tier 2: Explicit raw context (`providerContexts[providerId]`)
   - Tier 3: Persisted context from sessionManager (`getProviderContexts` with contextRole isolation)
   - Extract `meta` + `continueThread` flag from matched entry

3. **Execute fanout**
   - Call `orchestrator.executeParallelFanout(prompt, [providerId], { providerContexts, useThinking, ... })`
   - Emit partial deltas via `streamingManager.dispatchPartialDelta` as chunks arrive
   - On error: collect error for recovery logic

4. **Partial recovery**
   - If final result empty but error occurred:
     - Retrieve recovered text from streamingManager (`getRecoveredText`)
     - If recovered text exists, use it + mark with `softError` flag
     - Otherwise reject with provider error

5. **Output parsing**
   - Call `parseOutputFn(finalResult.text)` to extract structured data
   - Catch parse errors but don't fail (warning logged)
   - Prefer cleaned text from outputData if available

6. **Emit final partial delta**
   - Send canonical text (from outputData or final result) as final emission
   - Signals UI of text completion (not intermediate chunks)

7. **Persist context**
   - Await `persistenceCoordinator.persistProviderContexts(sessionId, { [providerId]: finalResult }, contextRole)`
   - Ensures context in IndexedDB before resolve (critical for continuation)

8. **Auth fallback wrapper**
   - Try `runWithProviderHealth` (health-tracked execution)
   - On auth error, consult `errorHandler.fallbackStrategies['PROVIDER_AUTH_FAILED']`
   - If fallback provider available, retry with fallback
   - Otherwise propagate auth error

**Error Handling:**

- Prompt validation fails early (INPUT_TOO_LONG)
- Provider error + no recovered text → propagate error
- Provider error + recovered text → use recovered text + softError flag
- Parse error → log warning, continue with unparsed text
- Auth error → attempt fallback provider, then throw if fallback unavailable
- Persist error → log warning (non-blocking)

**Design:** Stateful streaming manager enables partial recovery without re-execution; health tracking + auth fallback provide resilience across provider failures.

---

## geometry-runner.ts

**Async Geometry Pipeline — Embeddings, Substrate, Basin Inversion, Pre-Semantic**

Builds complete geometry results from paragraph and shadow text, including embeddings, substrate construction, pre-semantic interpretation, and query relevance scoring.

**`buildGeometryAsync(paragraphResult, shadowResult, indexedSourceData, payload, context, options, geometryDiagnostics, nowMs): Promise<{ shadowStatements, shadowParagraphs, statementEmbeddings, paragraphEmbeddings, queryEmbedding, substrate, preSemantic, regions, geoRecord }>`**

Main geometry pipeline function, called during pre-survey pipeline.

**Input:**
- `paragraphResult` — extracted paragraphs with text content
- `shadowResult` — extracted statements + metadata
- `indexedSourceData` — source batch indexed by ID for context
- `payload` — step payload (query, embeddingDimensions, etc.)
- `context` — execution context (sessionId, userMessage, etc.)
- `options` — shared services: orchestrator, sessionManager, streamingManager, etc.
- `geometryDiagnostics` — mutable diagnostics object for status tracking
- `nowMs` — timestamp for diagnostics

**Output:**
```typescript
{
  shadowStatements: Statement[],       // enriched with geometricCoordinates
  shadowParagraphs: Paragraph[],       // enriched with geometricCoordinates
  statementEmbeddings: Embedding[],    // vector embeddings for statements
  paragraphEmbeddings: Embedding[],    // vector embeddings for paragraphs
  queryEmbedding: Embedding | null,    // query vector (null if query missing)
  substrate: Substrate,                // UMAP substrate with geometry
  preSemantic: PreSemantic,           // corpus mode, peripheral nodes, gating
  regions: Region[],                   // geographic regions from substrate
  geoRecord: object                    // packed embeddings for basin inversion
}
```

**Pipeline:**

1. **Offscreen document setup**
   - Create offscreen document for embedding computation (isolates DOM access)
   - Initialize embedding engine in offscreen context
   - Cleanup on exit (try/finally pattern)

2. **Parallel embedding generation (Group A)**
   - Query embedding (if queryText provided, required for later stages)
   - Paragraph embeddings (batch compute from paragraphResult.paragraphs)
   - Statement embeddings (batch compute from shadowResult.statements)
   - Run in parallel; all-or-nothing semantics (early exit on critical failure)

3. **Dimension validation**
   - Check all embeddings match expected dimensions from payload
   - Mismatch → graceful degradation (continue with degraded geometry)

4. **Substrate construction**
   - Call `buildGeometricSubstrate(paragraphEmbeddings, regions, payload)`
   - Constructs UMAP layout + attaches region membership
   - Catches failures but doesn't block downstream

5. **Pre-semantic interpretation**
   - Call `buildPreSemanticInterpretation(substrate, corpusMode)`
   - **Basin Inversion** is computed internally during interpretation reading from measured substrate
   - Identifies peripheral nodes, gating signals
   - Catches failures but doesn't block

7. **Query relevance scoring**
   - Call `scoreQueryRelevanceForStatements(queryEmbedding, statementEmbeddings, ...)`
   - Skipped if queryEmbedding unavailable
   - Produces relevance scores for statement-query similarity

8. **Enrich statements + paragraphs**
   - Attach geometricCoordinates from substrate to shadowStatements
   - Attach geometricCoordinates from substrate to shadowParagraphs

9. **Persist embeddings**
   - Call `sessionManager.persistEmbeddings(sessionId, { statements, paragraphs, claims })`
   - Non-blocking; failures logged but don't fail pipeline

**Error Handling:**

- Offscreen document creation fails → throw (critical for embeddings)
- Query embedding fails → skip query relevance (geometry continues)
- Paragraph embeddings fail → degrade (skip substrate)
- Statement embeddings fail → degrade (skip relevance + provenance)
- Dimension mismatch → log warning, degrade substrate
- Substrate build fails → degrade (skip regions)
- Pre-semantic fails → degrade (no gating signals)
- Persist fails → log warning (non-blocking)

**Diagnostics tracking:**

- `geometryDiagnostics.stages` — map of stage name → { status, duration, error }
- Each stage updates its own entry: 'queryEmbedding', 'paragraphEmbeddings', 'statementEmbeddings', 'substrate', 'preSemantic', 'queryRelevance'
- Tracks elapsed time per stage for performance monitoring

**Design:** Parallel embedding generation within fail-safe boundaries; offscreen document lifecycle prevents memory leaks; dimension validation gates downstream geometry steps; graceful degradation ensures partial results available even on failures.

---

## Integration with Broader System

**Upstream (consumes):**

- `batch-phase.ts` — calls executeGenericSingleStep for batch provider invocations
- `mapping-phase.ts` — calls executeGenericSingleStep for semantic mapper invocation
- `singularity-phase.ts` — calls executeGenericSingleStep for editorial model invocation
- `deterministic-pipeline.js` — calls buildGeometryAsync during pre-survey pipeline
- Provider orchestrator — fanout execution + streaming
- SessionManager — context retrieval + embedding persistence
- StreamingManager — partial result delta + recovered text tracking

**Downstream (consumed by):**

- Workflow phases — receive provider results and geometry results for continued execution
- Deterministic pipeline — uses geometry results for provenance + structural analysis
- Cognitive artifact builder — consumes geometry substrate + pre-semantic for artifact construction

**Key Relationships:**

- **llm-runner + streaming:** Seamless partial recovery enabled by streaming manager's internal state
- **llm-runner + persistence:** Context persisted before resolve ensures continuation integrity
- **geometry-runner + embeddings:** Persistent storage enables recompute path without re-embedding
- **health tracking:** Both runners use health tracker for provider circuit breaker + auth fallback

---

## Summary

**Execution Utilities Layer:**

Two specialized executors abstract compute-intensive operations:

1. **LLM Runner** — executes provider calls with 3-tier context resolution, partial recovery from streaming, output parsing, and auth fallback. Enables stateful recovery and seamless continuation across provider failures.

2. **Geometry Runner** — async pipeline building embeddings (query, paragraph, statement), substrate construction, basin inversion, pre-semantic interpretation, and query relevance. Isolated offscreen context for embedding computation; graceful degradation on failures.

**Key Design Principles:**

- **Stateful recovery** — streaming manager tracks transmitted text for use if response fails
- **Dimension safety** — validation gates downstream geometry steps
- **Async composition** — parallel embedding generation within bounded failure regions
- **Lifecycle management** — offscreen document cleanup, embedding persistence, context caching
- **Graceful degradation** — all steps wrapped in try/catch; failures null-out results but continue
- **Port abstraction** — streaming and messaging decoupled from concrete implementation

**Entry Points:**

- **LLM execution:** `executeGenericSingleStep(...)`
- **Geometry building:** `buildGeometryAsync(...)`

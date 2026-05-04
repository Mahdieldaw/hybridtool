# pipeline — file digest (execution workflow phases)

---

## Architecture Overview

**Pipeline Orchestration (Apr 2026):** The pipeline directory implements a **4-phase execution workflow** that transforms batch LLM responses into synthesized cognitive artifacts:

```
Batch Phase              Mapping Phase              Recompute Handler      Singularity Phase
(parallel LLM)     →     (semantic analysis)    ↔   (artifact rebuild)  →  (final synthesis)
  ├─ Multi-provider      ├─ Shadow extraction       ├─ Restore from       ├─ Concierge prompt
  ├─ Health gating       ├─ Geometry pipeline       │  persistence        ├─ Editorial AST
  ├─ Context injection   ├─ Semantic mapping       ├─ Rebuild artifacts  ├─ Handoff V2 signals
  └─ Streaming updates   ├─ Claim assembly         └─ Resume singularity └─ Provider threading
```

**File Organization:**

- `batch-phase.ts` — **Phase 1:** Parallel multi-provider LLM execution with health gating and streaming
- `mapping-phase.ts` — **Phase 2:** Full semantic pipeline (shadow → geometry → claims → editorial)
- `singularity-phase.ts` — **Phase 3:** Concierge service integration; synthesizes mapping artifacts into user responses
- `recompute-handler.ts` — **Interstitial:** Handles recompute requests; rebuilds artifacts from persisted embeddings and batch responses

**Design Pattern:** Each phase reads from prior outputs. Persistence coordinator bridges phases, enabling recomputation without re-running earlier steps.

---

## batch-phase.ts

**Phase 1: Parallel Multi-Provider Execution**

Executes the batch step — dispatches user prompt to multiple LLM providers in parallel.

**`executeBatchPhase(step, context, options): Promise<batchResults>`**

**Input:**
- `step.payload.prompt` — Enhanced user prompt (with reactive bridge + prior context if applicable)
- `step.payload.providers` — Array of provider IDs (e.g., ['claude', 'gpt4', 'gemini'])
- `step.payload.useThinking` — Enable extended thinking mode
- `step.payload.providerContexts` — Optional per-provider thread state (for continuations)

**Pipeline:**

1. **Reactive Bridge Injection (Priority 1)** — `buildReactiveBridge(prompt, previousAnalysis)`
   - Embeds latent model references from prior steps
   - Augments prompt with matched signals

2. **Prompt Enhancement** — `PROMPT_TEMPLATES.withBridgeAndPrior()` or variants
   - Integrates bridge context and historical continuations
   - Single enhanced prompt sent to all providers

3. **Provider Health Gating** — `healthTracker.shouldAttempt(providerId)`
   - Circuit-breaker pattern: skip providers with recent failures
   - Report `skipped` status with `retryAfterMs`

4. **Input Validation** — Check prompt length against `PROVIDER_LIMITS`
   - Skip providers with exceeded input capacity
   - Fail fast if all providers exceed limits

5. **Parallel Execution** — `orchestrator.executeParallelFanout(prompt, allowedProviders, {...})`
   - Fire all requests simultaneously
   - Stream partial deltas via `onPartial` callback
   - Track provider status (queued → streaming → completed/failed)

6. **Error Classification** — `classifyError(error)`
   - Detect retryable vs. permanent failures
   - Identify auth errors (require reauth)
   - Log retry events for observability

7. **Response Aggregation** — `onAllComplete`
   - Collect results from all providers
   - Process artifacts via `ArtifactProcessor`
   - **Persist contexts** — `persistenceCoordinator.persistProviderContexts()` (critical: ensures mapping step reads fresh thread state)
   - Build `formattedResults` with clean text, status, meta

**Output: `{ results, errors }`**

```javascript
{
  results: {
    claude: { providerId, text, status: 'completed', meta, artifacts },
    gpt4: { providerId, text, status: 'completed', meta, artifacts },
    gemini: { providerId, text, status: 'failed', status, meta: { error, retryable, ... } },
  },
  errors: Map<providerId, error>
}
```

**Key Features:**

- **Reactive Bridge:** Injects latent signals from previous analysis without prompt engineering
- **Health Gating:** Prevents cascading failures via circuit breaker
- **Streaming Feedback:** Partial deltas dispatched in real-time via `WORKFLOW_PROGRESS` messages
- **Artifact Extraction:** Parses code blocks, structured content (JSON, tables) from responses
- **Soft Errors:** Captured recoverable errors (e.g., partial responses with warnings)

---

## mapping-phase.ts

**Phase 2: Full Semantic Pipeline** (shadow → geometry → semantic mapping → editorial)

Transforms batch outputs into a structured cognitive artifact via a deterministic, multi-stage pipeline.

**`executeMappingPhase(step, context, stepResults, workflowContexts, options): Promise<mappingResult>`**

**Input:**
- `step.payload.originalPrompt` — User's original query
- `step.payload.mappingProvider` — Single provider designated for semantic mapping (e.g., 'claude')
- Batch results from prior step via `options.contextManager.resolveHistoricalSources()`

**Pipeline (happy path):**

1. **Source Data Resolution** — Deduplicates, validates batch responses
   - Requires ≥2 valid sources (providerId + text)
   - Canonical ordering: `canonicalCitationOrder(sourceData.map(s => s.providerId))`
   - Assigns `modelIndex` (1-based)

2. **Shadow Extraction** (mechanical)
   - `extractShadowStatements(indexedSourceData)` — Parse paragraphs, detect overlaps
   - `projectParagraphs(statements)` — Compute paragraph-level statistics (contested count, union)
   - Output: `ShadowStatement[]`, `ShadowParagraph[]`

3. **Geometry Pipeline** (async, graceful failure)
   - `buildGeometryAsync()` — Embeddings, pairwise graphs, basin inversion, periphery classification
   - Produces: substrate, interpretation, query relevance (if query provided)
   - Surfaces diagnostics if embedding backend fails

4. **Semantic Mapper (LLM)**
   - `buildSemanticMapperPrompt(originalPrompt, orderedSourceData)` — Construct structured prompt
   - Send to `mappingProvider` via orchestrator
   - Parse output: `parseSemanticMapperOutput(rawText, shadowStatements)`
   - Extracts claims, edges, narrative

5. **Pre-Survey Pipeline** (deterministic, shared with recompute-handler)
   - `computePreSurveyPipeline({...})` — Claims → embeddings → density → routing → conflict validation → refinement
   - Outputs: enrichedClaims, claimRouting, claimEmbeddings, claimDensityScores
   - **Persist Claim Embeddings** — `sessionManager.persistClaimEmbeddings()` (enables recompute without re-embedding)

6. **Post-Assembly** — Structural decoration
   - Attach paragraphProjection meta (contestant counts, etc.)
   - Attach substrate summary
   - Stamp sourceCoherence per claim (cosine similarity of source statement embeddings)

7. **Editorial Model Call** (non-blocking, mappingProvider)
   - Build passage index + unclaimed groups via `buildPassageIndex()`
   - Generate `_editorialLookupCache` from index for fast generic mapping resolution
   - Construct editorial prompt with passage summaries + corpus shape
   - Parse editorial AST: threads + annotations
   - **Persist editorial response** as provider response (same pattern as batch/mapping)

8. **Assembly & Export**
   - `assembleFromPreSurvey(preSurvey, ...)` → `mapperArtifact` + `cognitiveArtifact`
   - Attach citation source order
   - Embed raw mapping text in meta (for UI debug panel)

**Output: `{ providerId, text, status, meta, artifacts, mapping: { artifact: cognitiveArtifact } }`**

**Key Features:**

- **Deterministic Pipeline:** All embedding + graph computations reuse pre-computed values (geometry, query relevance)
- **Graceful Degradation:** Geometry failures don't block semantic mapping; embedding diagnostics captured
- **Claim Embedding Persistence:** Critical for recompute handler; enables artifact rebuild without re-running mapping
- **Editorial Non-Blocking:** Editorial failures don't fail the turn; artifact ships with or without AST
- **Provider Context Threading:** Semantic mapper context persisted for next extend turn

**Design Invariant:** Phase 2 reads only from Phase 1 outputs + persisted geometry/embeddings. No backward deps.

---

## singularity-phase.ts


Transforms mapping artifacts into natural language via concierge prompts + optional editorial AST.

**`executeSingularityPhase(request, context, stepResults, resolvedContext, currentUserMessage, options): Promise<singularityOutput>`**

Also exports: `runSingularityLLM(step, context, options)` for use by recompute-handler.

**Input:**
- `mappingArtifact` — From mapping phase (claims, edges, density, editorial AST)
- `userMessageForSingularity` — Original query
- `singularityProviderId` — Provider override or null (falls back to session concierge state)

**Concierge Service Integration:**

   - Turn 1 (fresh spawn): Standard `buildConciergePrompt(userMsg, evidenceSubstrate)`

2. **Fresh Instance Detection**
   - First concierge run for this session
   - Provider changed from last run
   - Triggers: `continueThread: false` (request new chatId/cursor)

3. **Evidence Substrate Building** (Turn 1 only)
   - Extracts editorial threads + claims from mapping artifact
   - Uses `_editorialLookupCache` attached during mapping for fast passage resolution (bypassing artifact AST traversal)
   - Builds natural-language-oriented evidence summary
   - Passed to concierge prompt builder as context

4. **Concierge Prompt Construction**
   - Embeds evidence substrate
   - Activates appropriate turn variant (1, 2, 3+)

5. **Provider Context Threading**
   - Fresh instances: `continueThread: false`
   - Continuation turns: use persisted provider context (cursor, chatId)
   - Enables multi-turn conversations with stateful providers

   - Detect COMMIT signal → next turn gets prior context
   - Update concierge phase state

7. **Concierge Phase State Persistence**
   - Idempotency guard: `lastProcessedTurnId` prevents double-processing

**Output: `singularityOutput`**

```javascript
{
  providerId,
  timestamp,
  leakageDetected,
  leakageViolations,
  pipeline: { userMessage, prompt, parsed: { signal, rawText } }
}
```

**Key Features:**

- **Evidence Synthesis:** Editorial AST + mapping claims embedded in concierge context
- **Provider Threading:** Maintains conversation state across turns via provider contexts
- **Idempotency:** `lastProcessedTurnId` guard prevents re-processing same turn if handler invoked twice

---

## recompute-handler.ts

**Interstitial: Artifact Reconstruction & Continuation**

Handles recompute requests — rebuilds mapping artifacts from persisted embeddings + batch responses, then resumes singularity phase.

**`handleRecompute(payload, options): Promise<void>`**

**Motivation:** User may request continuation (e.g., "refine this") without re-running batch + mapping. Recompute rebuilds artifacts from cache.

**Input:**
- `aiTurnId` — Target turn to recompute/extend
- `providerId` — Optional provider override for singularity
- `isRecompute` — Flag (used by UI to track recompute intent)

**Pipeline:**

1. **Fetch Turn & Context**
   - Load AI turn metadata (provider hints, timestamps)
   - Resolve effective session ID (safety check: session mismatch → fail)
   - Fetch concierge phase state (for provider defaults)

2. **Duplicate Detection** — `inflightContinuations` Set
   - Key: `${sessionId}:${aiTurnId}:${provider}`
   - Block concurrent recomputes for same turn/provider

3. **Gather Prior Responses**
   - Load all persisted provider responses (batch, mapping, singularity, editorial)
   - Latest mapping text + metadata

4. **Artifact Rebuild** (Tier 3: artifact is ephemeral)
   - Use `buildArtifactForProvider()` — single source of truth
   - Inputs: latest mapping text + persisted embeddings
   - Reconstruct: claims, edges, density, routing, conflict validation
   - Restore editorial AST from persisted editorial response

5. **Singularity Execution**
   - Create singularity step with reconstructed artifact
   - Call `runSingularityLLM()` with preferred provider
   - Build concierge prompt from evidence substrate

6. **Persist & Emit**
   - Store singularity response as provider response
   - Update turn metadata (batch + singularity phases)
   - Emit `TURN_FINALIZED` message (full turn shape)
   - Cleanup embedding buffers if turn complete

**Key Features:**

- **Embedding Cache:** Persisted statement/paragraph embeddings enable deterministic rebuilds
- **Non-Destructive:** Original turn untouched; new singularity response appended
- **Handoff V2 Support:** Restores frozen concierge prompt data for continuations
- **Idempotency:** Duplicate detection prevents overlapping recomputes

---

## Pipeline Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│ BATCH PHASE (executeBatchPhase)                                     │
├─────────────────────────────────────────────────────────────────────┤
│ • Reactive bridge injection                                         │
│ • Health gating per provider                                        │
│ • Parallel fanout → orchestrator.executeParallelFanout()            │
│ • Stream partial deltas                                             │
│ • Classify errors + persist contexts                                │
└────────────────┬────────────────────────────────────────────────────┘
                 │
                 ↓ (Batch Results)
┌─────────────────────────────────────────────────────────────────────┐
│ MAPPING PHASE (executeMappingPhase)                                 │
├─────────────────────────────────────────────────────────────────────┤
│ 1. Source deduplication + canonical ordering                        │
│ 2. Shadow extraction (extractShadowStatements)                      │
│ 3. Paragraph projection (contestation analysis)                     │
│ 4. Geometry pipeline (async, graceful failure)                      │
│    ├─ Embedding (statement + paragraph)                            │
│    ├─ Geometry (substrate, computation of basin inversion inside interpret)│
│    └─ Diagnostics on backend failures                              │
│ 5. Semantic Mapper LLM (parseSemanticMapperOutput)                 │
│ 6. Pre-survey deterministic pipeline (computePreSurveyPipeline)   │
│    ├─ Claims + edges assembly                                      │
│    ├─ Claim embeddings                                             │
│    ├─ Claim density + routing                                      │
│    └─ Persist claim embeddings (critical for recompute)            │
│ 7. Post-assembly decoration (sourceCoherence, substrate summary)   │
│ 8. Editorial Model LLM (non-blocking)                              │
│    ├─ Build passage index + unclaimed groups                       │
│    ├─ Parse editorial AST                                          │
│    └─ Persist editorial response                                   │
│ 9. Assembly (assembleFromPreSurvey) → CognitiveArtifact           │
└────────────────┬────────────────────────────────────────────────────┘
                 │
        ┌────────┴────────┐
        │                 │
        ↓                 ↓
┌──────────────────┐  ┌─────────────────────────────────────────────┐
│ SINGULARITY PHASE│  │ OR RECOMPUTE HANDLER (handleRecompute)      │
│ (executeSingul...) │  ├─────────────────────────────────────────────┤
├──────────────────┤  │ • Fetch prior responses from persistence    │
│ • Concierge      │  │ • Load persisted embeddings                 │
│   prompt build   │  │ • Rebuild artifact via buildArtifactForProvider│
│ • Handoff V2     │  │ • Restore editorial AST                     │
│   parsing        │  │ • Execute singularity (runSingularityLLM)   │
│ • Provider       │  │ • Emit TURN_FINALIZED                       │
│   context        │  └─────────────────────────────────────────────┘
│   threading      │
│ • Emit MAPPER    │
│   ARTIFACT READY │
└──────────────────┘
        │
        ↓ (Both paths converge)
    [User Response]
```

---

## Design Principles

**Phase Discipline:** Each phase reads only from prior outputs. No backward references.

**Persistence-Driven Recompute:** Embedding cache + batch responses enable artifact reconstruction without semantic re-analysis.

**Deterministic Rebuild:** `buildArtifactForProvider()` + pre-persisted embeddings ensure identical artifacts on recompute (Tier 3: artifact is ephemeral, but deterministic).

**Health Gating:** Circuit breaker + provider limits prevent cascading failures and wasted inference.

**Streaming Feedback:** Partial deltas and phase progress messages enable responsive UI throughout the pipeline.

**Graceful Degradation:** Geometry failures, editorial failures don't block turn completion; diagnostics captured in meta.


---

## Summary

The pipeline directory implements the **core execution workflow** for the singularity system:

1. **Batch Phase** — Parallel multi-provider LLM calls with health gating and reactive context injection
2. **Mapping Phase** — Full semantic pipeline: shadow extraction → geometry → semantic mapping → editorial synthesis
4. **Recompute Handler** — Non-destructive artifact rebuilds from persisted embeddings, enabling efficient continuations

**Key Artifacts:**

- **Embedding Cache:** Persisted statement/paragraph vectors enable deterministic recomputes
- **Cognitive Artifact:** Structured claims, edges, density, editorial AST — passed between phases via `mapping.artifact`
- **Provider Contexts:** Thread state (chatId, cursor) managed per provider per session

**Entry Points:**

- **Full workflow:** All phases run in sequence (batch → mapping → singularity)
- **Recompute:** Skip batch + mapping; rebuild artifact from cache, resume singularity
- **Test harness:** Individual phases can be invoked via test fixtures (see `StepExecutor.mapping.truth-harness.test.ts`)

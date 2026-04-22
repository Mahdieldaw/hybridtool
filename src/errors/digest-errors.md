# errors — file digest (unified error handling and retry orchestration)

---

## Architecture Overview

**Consolidated Error Handling Pipeline:** The errors module provides unified error classification, normalization, recovery strategies, and policy-driven retry orchestration across provider failures and internal system errors.

```
Upstream Error (unknown type)
         ↓
[CLASSIFY] → classifyError()
         ├─ Maps to ProviderErrorType (rate_limit, auth_expired, timeout, etc.)
         ├─ Extracts retry-after headers and timestamps
         └─ Returns ProviderError with type, message, retryable flag
         ↓
[NORMALIZE] → normalizeError()
         ├─ Wraps unknown errors in HTOSError
         ├─ Applies semantic classification (code, recoverable flag)
         └─ Attaches context for debugging
         ↓
[RETRY] → retryWithPolicy()
         ├─ Selects policy (COLD_START, NETWORK, NETWORK_CONSERVATIVE, RATE_LIMIT)
         ├─ Computes backoff (exponential + jitter)
         ├─ Logs retry events for telemetry
         └─ Honors retry-after from provider headers
         ↓
[RECOVER] → ErrorHandler.attemptRecovery()
         ├─ Applies recovery strategy if available
         ├─ Falls back to fallback mechanism
         └─ Escalates if exhausted
```

**File Organization:**

- `index.ts` — **Barrel export:** Re-exports all public APIs; consolidates classification, handler, and retry logic
- `classifier.ts` — **Phase 1 (CLASSIFY):** Error type detection, provider header parsing, message pattern matching
- `handler.ts` — **Phase 2–4 (NORMALIZE, RECOVER, FALLBACK):** ErrorHandler class, factory functions, provider config, recovery strategies
- `retry.ts` — **Phase 3 (RETRY):** Retry policies, backoff computation, retry orchestration, telemetry

**Key Invariants:**
- **Strict phase discipline**: Classify → Normalize → Retry → Recover (forward-only)
- **Policy-driven**: Retry behavior determined by error type + policy name, not ad-hoc
- **Provider-aware**: Respects provider-specific headers (retry-after), login URLs, input limits
- **Fallback-capable**: IndexedDB → localStorage, network failure → cache, service worker unavailable → direct operation
- **Telemetry-ready**: All retry attempts logged via `logRetryEvent()`

---

## classifier.ts

**Phase 1 — Error Classification**

Maps unknown errors to `ProviderErrorType` enum using status codes, error names, message patterns, and nested error structures.

**`classifyError(error): ProviderError`**

Main classification function. Returns structured ProviderError with type, retryability, and timing info.

**Classification sequence:**

1. **Structured error codes** (HTOSError.code, ProviderAuthError) — fast path
   - AUTH_REQUIRED, CIRCUIT_BREAKER_OPEN, INPUT_TOO_LONG, NETWORK_ERROR, TIMEOUT, RATE_LIMITED
2. **HTTP status codes** (status, statusCode, response.status)
   - 401 → auth_expired
   - 403 → unknown (forbidden, non-retryable)
   - 429 → rate_limit
   - 5xx → unknown (retryable)
3. **Nested error types** (error.type, details.error.type, context.originalError.error.type)
   - Detects rate_limit_error, tooManyRequests
4. **System error codes** (ETIMEDOUT, ESOCKETTIMEDOUT, ECONNREFUSED, ENOTFOUND, ENETUNREACH)
   - Maps to timeout, network
5. **Message pattern matching**
   - Regex patterns for auth, content filter, safety, blocked, timeout, network
6. **Fallback to unknown**
   - If none match, return { type: 'unknown', retryable: true }

**Rate Limit Retry-After Parsing:**

For 429 errors and rate_limit_errors:
- Parse `Retry-After` header (seconds or HTTP-date)
- Parse `resetsAt` / `resets_at` from details or nested error
- Parse multi-window rate limit windows (5h, 1h)
- Return `retryAfterMs` if available, else default 60000ms

Output: `ProviderError`:
- `type` — ProviderErrorType (rate_limit, auth_expired, timeout, circuit_open, content_filter, input_too_long, network, unknown)
- `message` — user-facing text (includes retry timing if applicable)
- `retryable` — boolean; if false, non-recoverable
- `retryAfterMs` — optional; milliseconds until retry available (rate limits only)
- `requiresReauth` — optional; if true, user must re-authenticate

**Boolean Predicates:**

- `isProviderAuthError(error): boolean` — true if 401, 403, or auth-pattern match
- `isDefinitiveAuthError(error): boolean` — true only if 401 or auth-pattern (403 excluded as ambiguous)
- `isRateLimitError(error): boolean` — true if classified as rate_limit
- `isNetworkError(error): boolean` — true if network or timeout

**Display Text:**

`ERROR_DISPLAY_TEXT` — Record keyed by ProviderErrorType, each with title, description, icon for UI rendering.

**Utility Functions:**

- `formatRetryAfter(ms): string` — human-readable duration (e.g., "5m 30s", "2h")

---

## handler.ts

**Phases 2–4 — Error Normalization, Recovery, Fallback**

ErrorHandler class orchestrates recovery strategies, fallback mechanisms, and provider-specific error handling.

**`normalizeError(error, context): HTOSError`**

Standalone function (also available as ErrorHandler instance method). Wraps any error in HTOSError with code and recoverable flag.

**Classification logic:**

1. **Already HTOSError** → return as-is
2. **Semantic classification** (via classifyError predicates)
   - Auth error → code='AUTH_REQUIRED', recoverable=false
   - Rate limit → code='RATE_LIMITED', recoverable=true
   - Network → code='NETWORK_ERROR', recoverable=true
3. **System error names** (QuotaExceededError, InvalidStateError, NotFoundError, TimeoutError)
4. **Message patterns** (IndexedDB, Service Worker, INPUT_TOO_LONG)
5. **Fallback** → code='UNKNOWN_ERROR', recoverable=true

Output: HTOSError with code, context, recoverable flag, timestamp, unique error ID.

**Provider Auth Factories:**

- `createProviderAuthError(providerId, originalError, context): ProviderAuthError`
  - Wraps auth failure with provider display name, login URL, original error
  
- `createMultiProviderAuthError(providerIds, context): HTOSError | null`
  - Multi-provider variant: generates message listing all login URLs

**Utility Functions:**

- `getErrorMessage(error): string` — extracts message from any error type

**Provider Configuration:**

`PROVIDER_CONFIG` — Record of provider ID → { displayName, loginUrl, maxInputChars } for all supported providers (claude, chatgpt, gemini, gemini-pro, gemini-exp, qwen, grok).

**ErrorHandler Class**

Instance manages recovery strategies, retry policies, error telemetry, and fallback mechanisms.

**Key Methods:**

- `handleError(error, context): Promise<unknown>` — main entry point; normalizes, records, attempts recovery
- `handleProviderError(error, providerId, context): Promise<unknown>` — provider-specific variant
- `attemptRecovery(error, context): Promise<unknown>` — finds recovery or fallback strategy
- `retryWithBackoff(operation, context, policyName): Promise<unknown>` — legacy retry loop (delegates to retry.ts)
- `getRecoveryStrategy(errorCode): RecoveryStrategy | undefined` — returns handler for error code
- `getFallbackStrategy(errorCode): FallbackStrategy | null` — maps error code to fallback mechanism

**Built-in Recovery Strategies:**

1. **AUTH_REQUIRED** — marks provider as unauthenticated (delegates to authManager)
2. **RATE_LIMITED** — retries with PROVIDER_RATE_LIMIT policy
3. **INDEXEDDB_ERROR** — reinitializes IndexedDB, retries operation
4. **TIMEOUT** — doubles timeout, retries with CONSERVATIVE policy

**Built-in Fallback Strategies:**

1. **PROVIDER_AUTH_FAILED** — checks alternative providers via authManager
2. **INDEXEDDB_UNAVAILABLE** → **localStorage** (save, load, delete, list operations)
3. **NETWORK_UNAVAILABLE** → **cache** (reads htos_cache_* localStorage keys)
4. **SERVICE_WORKER_UNAVAILABLE** → **direct operation** (persistence or session, not yet implemented)

**Telemetry:**

- `incrementErrorCount(errorCode)` — tracks occurrence frequency
- `getErrorStats()` — returns totalErrors + errorsByCode histogram
- `getProviderErrorStats(providerId)` — returns provider-scoped histogram
- `reset()` — clears counters

**localStorage Operations (Fallback):**

- `saveToLocalStorage(key, data)` — stores JSON-serialized data
- `loadFromLocalStorage(key)` — retrieves and parses
- `deleteFromLocalStorage(key)` — removes entry
- `listFromLocalStorage(prefix)` — enumerates keys matching prefix

**Global Instance:**

`errorHandler` — singleton instance, exported and attached to `globalThis.__HTOS_ERROR_HANDLER` for console debugging.

---

## retry.ts

**Phase 3 — Policy-Driven Retry Orchestration**

Provides retry policies, backoff computation, and orchestration for recoverable errors with pluggable delay strategies.

**`RetryPolicy` Interface**

Named retry policy with configurable parameters.

- `name` — RetryPolicyName (COLD_START, NETWORK, NETWORK_CONSERVATIVE, RATE_LIMIT)
- `maxAttempts` — total attempts before giving up
- `baseDelayMs` — initial delay for first retry
- `maxDelayMs` — cap on computed delay
- `multiplier` — exponential backoff base (e.g., 2.0 = double each attempt)
- `jitter` — boolean; if true, randomize delay by 50%–100%
- `delayOverrides` — optional stage-specific overrides (e.g., cold_event_window)
- `retryableTypes` — ProviderErrorType[] that this policy applies to
- `honorRetryAfter` — boolean; if true, use provider's Retry-After header
- `toLegacyShape()` — adapter for legacy ErrorHandler interface

**Policy Table (Predefined):**

1. **COLD_START** — for Gemini cold-start delays (env-configurable)
   - maxAttempts=6, baseDelay=750ms, maxDelay=5000ms, multiplier=2, jitter=true
   - retryableTypes: unknown, network, timeout
   - honors HTOS_GEMINI_COLD_START_* env overrides

2. **NETWORK** — standard transient failure retry
   - maxAttempts=4, baseDelay=1000ms, maxDelay=10000ms, multiplier=2, jitter=true
   - retryableTypes: network, timeout, unknown
   - honorRetryAfter=false (doesn't wait for provider header)

3. **NETWORK_CONSERVATIVE** — slower, more cautious retry
   - maxAttempts=3, baseDelay=2000ms, maxDelay=15000ms, multiplier=3, jitter=false
   - retryableTypes: network, timeout, unknown

4. **RATE_LIMIT** — rate-limit-specific, respects Retry-After
   - maxAttempts=3, baseDelay=5000ms, maxDelay=30000ms, multiplier=2, jitter=true
   - retryableTypes: rate_limit only
   - honorRetryAfter=true (uses provider's Retry-After if available)

**Policy Lookup:**

- `getPolicy(name): RetryPolicy` — returns named policy from table
- `policyForErrorType(type): RetryPolicy | null` — maps error type → policy
  - rate_limit → RATE_LIMIT
  - network, timeout, unknown → NETWORK
  - others → null (non-retryable)

**Backoff Computation:**

`computeBackoffMs(policy, attempt, retryAfterMs?, retryStage?): number`

1. **Stage override** — if delayOverrides[retryStage] exists, use it
2. **Retry-After header** — if honorRetryAfter=true and retryAfterMs > 0, use it
3. **Exponential backoff** — base × multiplier^(attempt-1), capped at maxDelay
4. **Jitter** — if enabled, randomize by 50%–100%

Returns delay in milliseconds.

**Retry Orchestration:**

`retryWithPolicy<T>(fn, context, policyName?): Promise<T>`

Retry loop orchestrator with AbortSignal support.

**Execution:**

1. **Attempt 1**: call fn() directly
2. **On error**: classify, check retryability
3. **Policy selection**: use policyName if provided, else derive from error type
4. **Delay computation**: use computeBackoffMs()
5. **Telemetry**: log via logRetryEvent()
6. **Sleep**: honor AbortSignal if provided
7. **Repeat**: until maxAttempts exhausted or non-retryable error

**RetryContext:**

- `providerId` — which provider (for telemetry)
- `stage` — operation stage (e.g., "batch", "mapping")
- `model` — optional model name
- `signal` — optional AbortSignal for cancellation

**RetryEvent (Telemetry):**

- `providerId`, `stage`, `attempt`, `max`, `errorType`, `elapsedMs`, `delayMs`, `model?`

`logRetryEvent(event)` — logs as console.warn('[retry]', JSON.stringify(event))

**Utility Functions:**

- `getRetryStage(error): string | undefined` — extracts stage from error.stage or error.details.stage
- `sleep(ms, signal): Promise<void>` — async delay with AbortSignal support

---

## index.ts

**Barrel Export**

Consolidated public API surface.

**Exports:**

1. **From classifier.ts**
   - `classifyError` — main classification function
   - `formatRetryAfter` — human-readable duration formatter
   - `ERROR_DISPLAY_TEXT` — UI display config
   - `isProviderAuthError`, `isDefinitiveAuthError`, `isRateLimitError`, `isNetworkError` — boolean predicates

2. **From handler.ts**
   - `errorHandler` — singleton ErrorHandler instance
   - `createProviderAuthError`, `createMultiProviderAuthError` — factory functions
   - `getErrorMessage`, `normalizeError` — utility functions
   - `ErrorHandler` — class (for testing or custom instances)
   - `PROVIDER_CONFIG` — provider metadata

3. **From shared/types/provider.ts** (re-export)
   - `HTOSError`, `ProviderAuthError` — error classes (live in shared to avoid circular imports)
   - `type HTOSErrorCode` — type (for consumers)

4. **From retry.ts**
   - `getPolicy`, `policyForErrorType` — policy lookup
   - `computeBackoffMs` — backoff computation
   - `retryWithPolicy` — main retry orchestrator
   - `logRetryEvent` — telemetry
   - `type RetryPolicy`, `type RetryPolicyName`, `type RetryContext`, `type RetryEvent` — types

---

## Integration with Broader System

**Upstream (consumes):**
- Unknown errors from anywhere in the codebase
- Provider HTTP responses (headers, status codes)
- Environment variables (HTOS_GEMINI_COLD_START_* for policy tuning)

**Downstream (consumed by):**
- `StepExecutor.js` — wraps batch/mapping/singularity calls in error handling
- `sw-entry.js` — uses error handler for REGENERATE_EMBEDDINGS failures
- Service worker — delegates IndexedDB errors to fallback strategies
- UI components — renders ERROR_DISPLAY_TEXT for user notification
- Recovery code — catches and logs errors via persistenceMonitor

**Key Relationships:**

- **classifier + handler** — synchronous error mapping; no retry yet
- **handler + retry** — async recovery with policy-driven backoff
- **ErrorHandler + fallback strategies** — storage and network cascading
- **ProviderAuthError** — special subclass for auth failures (lives in shared/types to decouple storage from core)

---

## Summary

**Unified Error Handling Pipeline:**

The errors module provides a **four-phase, forward-only pipeline** for handling any error in the system:

1. **Classify** (classifier.ts) — map unknown error to ProviderErrorType via status, codes, patterns
2. **Normalize** (handler.ts) — wrap in HTOSError with semantic code and recoverable flag
3. **Retry** (retry.ts) — apply policy-driven backoff with provider-aware Retry-After honor
4. **Recover** (handler.ts) — attempt recovery strategy or fallback (IndexedDB→localStorage, network→cache, etc.)

**Key Design Principles:**

- **Policy-driven**: Retry behavior determined by error type + named policy, not ad-hoc logic
- **Provider-aware**: Respects HTTP headers, provider limits, login URLs, custom error structures
- **Fallback-capable**: Graceful degradation (cache, localStorage) when preferred channel unavailable
- **Telemetry-ready**: All retry attempts logged; error frequency tracked per code
- **Type-safe**: Structured ProviderErrorType enum + HTOSErrorCode; no stringly-typed errors
- **Composable**: Individual functions (classifyError, normalizeError, retryWithPolicy) importable and testable independently

**Entry Points:**

- **One-shot classification**: `classifyError(error)` — returns ProviderError
- **Normalization + recovery**: `errorHandler.handleError(error, context)` — full pipeline
- **Provider-specific**: `errorHandler.handleProviderError(error, providerId, context)` — adds provider context
- **Retry orchestration**: `retryWithPolicy(fn, context)` — policy-driven retry loop
- **Direct predicates**: `isProviderAuthError()`, `isRateLimitError()`, `isNetworkError()` — thin wrappers over classify

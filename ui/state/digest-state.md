# @ui/state — file digest (current implementation)

---

## Overview

`@ui/state` is a Jotai-based state management layer that orchestrates global UI and workflow state across the application. It is organized into five semantic domains, each managing a distinct aspect of application state:

1. **chat.ts** — Turn storage and session management
2. **ui.ts** — Application phases, UI visibility, and global settings
3. **provider.ts** — Model selection, provider authentication, and feature configuration
4. **workflow.ts** — Provider isolation, streaming state, artifacts, and error tracking
5. **layout.ts** — Pane/panel layout and decision map visibility

The state layer uses **atomFamily** (per-ID atom caching) for performance isolation and **atomWithStorage** (browser persistence) for user preferences. Atoms follow a strict naming convention (`XxxAtom`, `xxxAtomFamily`) for discoverability.

---

## chat.ts

Manages turn storage, session persistence, and atomFamily cleanup.

**`turnsMapAtom`**

Central turn storage: `Map<turnId, TurnMessage>`. Provides O(1) lookups and surgical updates. Never mutated in place; updates via Immer.

**`turnIdsAtom`**

Ordered list of turn IDs. Changes only when turns are added/removed. Kept in sync with `turnsMapAtom` keys.

**`messagesAtom`** (derived)

Backward-compatible view: reads `turnIdsAtom` and `turnsMapAtom`, returns ordered `TurnMessage[]`. Read-only.

**`turnAtomFamily(turnId)`**

Per-turn atom cache. Returns single turn by ID with isolated subscriptions. Prefer over global `turnsMapAtom` when subscribing to individual turns (prevents re-renders of all turns on any update).

**`currentSessionIdAtom`**

Current session ID, persisted to localStorage. Used to resume sessions on page reload.

**`activeAiTurnIdAtom`**

ID of the currently-executing AI turn. Drives workflow progress, streaming state, and error tracking.

**`lastActivityAtAtom`**

Unix timestamp of last meaningful workflow event. Used by UI watchdogs to detect stalls.

**`historySessionsAtom`, `isHistoryLoadingAtom`**

Session history metadata and loading flag. Populated on mount; persisted sessions list for resumption.

**`cleanupTurnAtoms(turnIds, turnIdProviderPairs)`**

Removes atomFamily entries before bulk deletion (session clear). Prevents unbounded atom accumulation. Cleans:

- `turnAtomFamily`, `turnStreamingStateFamily`, `turnExpandedStateFamily`
- `workflowProgressForTurnFamily`, `providerErrorsForTurnFamily`
- `modelResponsePanelModeFamily`, `activeProbeDraftFamily` (from layout.ts)
- `providerEffectiveStateFamily`, `providerArtifactFamily` (from workflow.ts)

---

## ui.ts

Manages application-level state: phases, steps, visibility flags, and global UI settings.

**Phases & Steps**

- `isLoadingAtom` — true during batch execution, streaming, or inference
- `uiPhaseAtom` — enum (idle | thinking | streaming | complete | error)
- `currentAppStepAtom` — enum (initial | input | executing | results | error)

**Continuation Mode**

- `isContinuationModeAtom` (derived) — true iff there's an active session with ≥1 turn. Drives "new turn" vs "continue" UI modes.

**Exploration Mode**

- `explorationInputModeOverrideAtom` — 'probe' | 'new' | null; allows forcing specific input types
- `dismissedExplorationTurnIdAtom` — prevents re-showing exploration UI for a turn
- `activeExplorationTurnIdAtom` (derived) — current exploration context (gated by loading, dismissed, override)
- `latestCompletedAiTurnIdAtom` (derived) — searches `turnIds` in reverse for the last successfully-completed AI turn

**Visibility Flags (persisted)**

- `isHistoryPanelOpenAtom` — history sidebar visibility
- `isSettingsOpenAtom` — settings modal visibility
- `showWelcomeAtom` (derived) — true iff `turnIds.length === 0`
- `powerUserModeAtom` — enables advanced debugging UI
- `thinkOnChatGPTAtom` — ChatGPT extended thinking mode (for token counting)
- `isVisibleModeAtom` — hides/shows explanation panels
- `isReducedMotionAtom` — accessibility flag for animation disables

**Per-Turn Visibility**

- `turnExpandedStateFamily(turnId)` — collapse/expand state per turn

**Global Settings (persisted)**

- `chatInputValueAtom` — user's typed message (restored on reload)
- `toastAtom` — single global toast notification
- `chatInputHeightAtom` — dynamic input box height
- `alertTextAtom` — global alert banner text

**System State**

- `connectionStatusAtom` — WebSocket connection metadata: `{ isConnected, isReconnecting, hasEverConnected }`
- `isRoundActiveAtom` (derived) — alias for `isLoadingAtom`; used by streaming indicators

---

## provider.ts

Manages model selection, provider authentication, and feature toggles.

**Model & Feature Configuration (persisted)**

- `selectedModelsAtom` — `Record<modelId, boolean>`; which models are enabled
- `mappingEnabledAtom` — feature flag for semantic mapper
- `mappingProviderAtom` — which provider runs mapping (null = auto-select)
- `singularityProviderAtom` — which provider runs singularity/batch (null = auto-select)
- `probeProvidersEnabledAtom` — `{ gemini, qwen }` for exploration mode

**Runtime State**

- `providerAuthStatusAtom` — `Record<providerId, isAuthenticated>`
- `providerLocksAtom` — `{ mapping, singularity }` (boolean); prevents concurrent recomputes
- `providerContextsAtom` — arbitrary provider-specific data (Immer-backed for mutations)

**Provider Targeting**

- `activeProviderTargetAtom` — current active provider for UI focus: `{ aiTurnId, providerId }`
- `pinnedSingularityProvidersAtom` — `Record<turnId, preferredProviderId>`; persists user's provider selection across re-renders and streaming updates

---

## workflow.ts

Orchestrates provider-level workflow state: streaming, errors, progress, and artifacts.

**Helpers**

`getBatchResponses(aiTurn)` — extracts batch response array from turn.batch.responses, normalizing to `ProviderResponse[]` format.

**Provider Island Isolation**

`providerEffectiveStateFamily({ turnId, providerId })` (derived)

Computes stable, UI-optimized state per provider. Prevents expensive re-derivations during streaming.

Returns object with:
- `latestResponse` — most recent ProviderResponse
- `historyCount` — total responses for this provider
- `isEmpty` — boolean: no responses
- `allResponses` — full array for history expansion

**Tier 3: Ephemeral Artifacts**

`providerArtifactFamily({ turnId, providerId })`

Keyed by `turnId::providerId`. Stores mapper artifact (CognitiveArtifact or raw object) in memory. **Never persisted**; rebuilt on:
- Page load (via hydration)
- Mapper switch (new computation)
- Regenerate action (via buildArtifactForProvider)

Write points:
- usePortMessageHandler (MAPPER_ARTIFACT_READY, REGENERATE response)

Read points:
- useProviderArtifact hook → DecisionMapSheet, CognitiveOutputRenderer

**Recompute Targeting**

`activeRecomputeStateAtom` — tracks precise recompute context:

```typescript
{
  aiTurnId: string;
  stepType: 'mapping' | 'batch' | 'singularity';
  providerId: string;
}
```

Used by `workflowProgressForTurnFamily` and `providerErrorsForTurnFamily` to scope progress/errors to the active recompute.

**Mapping Configuration (per-round)**

- `mappingRecomputeSelectionByRoundAtom` — `Record<turnId, providerId | null>`; which mapping recompute target per turn
- `thinkMappingByRoundAtom` — `Record<turnId, boolean>`; extended thinking toggle per turn

**Workflow Progress**

`workflowProgressAtom`

Global progress state: `Record<providerId, { stage, progress?, error? }>`.

Stages: `idle | thinking | streaming | complete | error`

`workflowProgressForTurnFamily(turnId)` (derived)

Scoped progress: returns global progress if `turnId === activeAiTurnId && isLoading`, else empty object. Prevents non-active turns from seeing progress updates.

**Error Resilience**

`providerErrorsAtom`

Global error state: `Record<providerId, ProviderError>`.

`providerErrorsForTurnFamily(turnId)` (derived)

Scoped errors: returns global errors if `turnId === activeAiTurnId`, else empty object.

`workflowDegradedAtom`

Summary degradation status:
```typescript
{
  isDegraded: boolean;
  successCount: number;
  totalCount: number;
  failedProviders: string[];
}
```

**Streaming Performance Optimization**

`lastStreamingProviderAtom` — tracks which provider is currently streaming for granular indicators.

`globalStreamingStateAtom` (derived) — bundles `activeAiTurnId`, `isLoading`, `currentAppStep` for efficient global subscription.

`idleStreamingState` (shared) — reference-stable idle state object. All non-active turns reference this single object, preventing re-renders on streaming updates.

`turnStreamingStateFamily(turnId)` (derived)

Per-turn streaming state with active provider tracking:
```typescript
{ isLoading: boolean; appStep: AppStep; activeProviderId: string | null }
```

Logic:
- If `turnId === activeAiTurnId` and `isLoading`, returns new object with active provider (from `activeRecomputeStateAtom` or `lastStreamingProviderAtom`)
- Otherwise, returns shared `idleStreamingState` (reference-stable)

This ensures only the active turn's subscribers update on streaming; all others remain stable.

---

## layout.ts

Manages pane and panel layout state.

**Split Pane Layout**

- `activeSplitPanelAtom` — currently-open panel: `{ turnId, providerId } | null`
- `splitPaneRatioAtom` — left/right split ratio, persisted (default 55%)
- `splitPaneFullWidthAtom` — boolean: full-width decision map mode
- `isSplitOpenAtom` (derived) — `activeSplitPanelAtom !== null`; ChatView subscribes to this to avoid full-panel re-renders

**Panel Modes & Drafts**

`modelResponsePanelModeFamily(turnId)` — mode for response display: `'single' | 'all' | 'reading'`

`activeProbeDraftFamily(turnId)` — active exploration draft (ProbeSession) for this turn

**Decision Map**

- `isDecisionMapOpenAtom` — currently-open map: `{ turnId, tab? } | null`
- Supported tabs: `'graph' | 'narrative' | 'options' | 'space' | 'shadow' | 'json'`

**Auto-Open Tracking**

- `hasAutoOpenedPaneAtom` — turnId of most-recently auto-opened split pane; prevents repeated auto-opens for same turn

---

## index.ts

Public API barrel export. Re-exports all atoms from chat.ts, provider.ts, ui.ts, workflow.ts, and layout.ts.

---

## Design Patterns & Performance Optimizations

### AtomFamily for Render Isolation

- `turnAtomFamily`, `turnStreamingStateFamily`, `turnExpandedStateFamily` — each turn is an isolated subscription
- When turn N changes, only components subscribed to turn N re-render
- Critical at scale (50+ turns): without isolation, each turn update would trigger all turns to re-render

### Shared Idle State Objects

- `idleStreamingState`, `idleWorkflowProgress`, `idleProviderErrors` — reference-stable objects
- Non-active turns reference the **same object instance**, ensuring no re-render on updates to other turns
- Active turn gets a new object on every update (triggering re-render)

### Derived Atoms for Efficiency

- `isContinuationModeAtom`, `isSplitOpenAtom`, `isRoundActiveAtom` — prevent components from subscribing to multiple atoms
- `workflowProgressForTurnFamily`, `providerErrorsForTurnFamily` — scope global state to active turn, returning idle objects for others
- `turnStreamingStateFamily` — combines `globalStreamingStateAtom` with recompute context for granular streaming indicators

### Persistence (atomWithStorage)

- `currentSessionIdAtom`, `splitPaneRatioAtom`, `selectedModelsAtom`, etc. — persisted to localStorage
- Survives page reloads; enables session resumption and user preference retention

### Ephemeral Artifacts (providerArtifactFamily)

- Never persisted; in-memory only
- Rebuilt on demand (mapper switch, regenerate, hydration)
- Decoupled from turn/response storage; allows efficient artifact recomputation without affecting turn history

### Error Scoping

- Global `providerErrorsAtom` holds all errors for active turn
- `providerErrorsForTurnFamily` gates visibility to active turn only
- Prevents error UI from appearing for historical turns

---

## Summary of Architecture

**Atomization Strategy:**

- **Map-based turn storage** (turnsMapAtom) for surgical updates
- **Per-turn atom families** for render isolation (5–10× performance win at scale)
- **Shared idle objects** to prevent re-renders of inactive turns
- **Derived atoms** to collapse multi-atom subscriptions into single values

**State Domains:**

- **chat** — turn history, sessions, turn IDs
- **ui** — phases, steps, visibility, global settings
- **provider** — model selection, auth, feature flags
- **workflow** — streaming, errors, progress, provider artifacts
- **layout** — split pane, panel modes, decision map

**Tier System:**

- **Tier 1 (Persistent)** — localStorage atoms (models, pane ratio, user preferences)
- **Tier 2 (Session)** — session-scoped atoms (turn IDs, active turn, session ID)
- **Tier 3 (Ephemeral)** — in-memory atoms (artifacts, streaming state, progress)

All three tiers coexist; atomFamily cleanup ensures memory doesn't grow unbounded during session deletion.

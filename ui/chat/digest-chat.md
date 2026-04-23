# @ui/chat — file digest (current implementation)

---

## Overview

`@ui/chat` is the **primary conversation surface and turn orchestration layer** — an interactive interface for managing user-AI dialog flows, displaying turn messages, and coordinating provider output rendering. It orchestrates the display of user inputs, AI responses, streaming state, and cognitive artifacts through a **virtualized turn list** with memoized message rendering, lazy-loaded decision maps, and responsive layout handling.

The layer is organized into nine semantic domains:

1. **ChatView.tsx** — Main conversation container with virtualized turn list and layout management
2. **MessageRow.tsx** — Turn dispatcher routing user/AI turn types to appropriate blocks
3. **UserTurnBlock.tsx** — User input display with prompt history and metadata
4. **AiTurnBlock.tsx** — AI response container with probe sessions and cognitive output coordination
5. **TurnOutputRouter.tsx** — Cognitive output rendering orchestrator (metrics, structure, singularity responses)
6. **CouncilOrbs.tsx** — Provider selection orbs with streaming progress indicators and role management
7. **SingularityOutputView.tsx** — Singularity response display with provider selection and copy utilities
8. **WelcomeScreen.tsx** — Initial conversation entry point with session initialization
9. **CouncilOrbsVertical.tsx** — Vertical orb stack for narrow layouts and multi-column UI

---

## ChatView.tsx

Main conversation container orchestrating turn list, layout, and panel state.

**Role:**

- Manages virtual turn list rendering via Virtuoso for performance at scale
- Coordinates split-pane layout (chat + decision map) with resizable panels
- Handles ESC key for closing panels
- Persists chat input height and split pane dimensions
- Orchestrates session state and turn ordering

**Key Capabilities:**

- **Virtual List Rendering** — Uses Virtuoso for O(1) render performance (only visible turns render)
- **Message Routing** — Dispatches each turnId to MessageRow for type-aware rendering
- **Split Pane Orchestration** — Manages activeSplitPanelAtom and isDecisionMapOpenAtom
- **Responsive Layout** — ResizableSplitLayout handles drag-to-resize between chat and decision map
- **Lazy Loading** — CouncilOrbsVertical and DecisionMapSheet loaded on-demand via safeLazy
- **Auto-Scroll Management** — Virtuoso ref for programmatic scroll-to-bottom behavior
- **Keyboard Navigation** — ESC key handler for panel closing

**Atom Dependencies:**

- `turnIdsAtom` — Turn list order
- `showWelcomeAtom` — Shows welcome screen when no turns
- `currentSessionIdAtom` — Session context
- `isSplitOpenAtom`, `activeSplitPanelAtom` — Split pane state
- `isDecisionMapOpenAtom` — Decision map visibility
- `chatInputHeightAtom` — Input box height persistence
- `splitPaneRatioAtom` — Left/right split ratio
- `splitPaneFullWidthAtom` — Full-width decision map mode

**Data Flow:**

- Input: Turn IDs from state
- Input: Split pane and decision map state
- Output: Virtualized list of MessageRow components + ResizableSplitLayout with optional panels

---

## MessageRow.tsx

Turn dispatcher routing user/AI messages to type-appropriate rendering blocks.

**Role:**

- Retrieves turn data from turnsMapAtom by turnId
- Determines turn type (user vs. ai) and dispatches to appropriate block
- Applies visual active-turn styling for split-pane selection
- Provides DOM anchor (id, data attributes) for scroll targeting

**Key Capabilities:**

- **Type Routing** — Renders UserTurnBlock for user type, AiTurnBlock for ai type
- **Atom Lookup** — Uses selectAtom to isolate per-turn subscriptions
- **Active Turn Styling** — Applies active-turn CSS class when turn is selected in split pane
- **DOM Anchoring** — Assigns turn-\* ID and data attributes for JavaScript targeting
- **Memoization** — Wrapped in React.memo to prevent re-renders from parent list changes

**Atom Dependencies:**

- `turnsMapAtom` — Central turn storage
- `activeSplitPanelAtom` — Currently active turn in split pane

**Data Flow:**

- Input: turnId (from Virtuoso)
- Output: UserTurnBlock or AiTurnBlock with active-turn styling

---

## UserTurnBlock.tsx

User input display with prompt history and metadata.

**Role:**

- Renders user message text with optional metadata (timestamp, session context)
- Shows styled message bubble in conversation thread
- Displays associated context (user input value, model selections at time of query)

**Key Capabilities:**

- **Message Display** — Renders user prompt in styled container
- **Metadata** — Optional timestamp and session information
- **Styling** — User message bubble with distinct visual treatment

**Data Flow:**

- Input: UserTurn message object
- Output: Styled user message bubble

---

## AiTurnBlock.tsx

AI response container coordinating cognitive output and probe sessions.

**Role:**

- Renders AI turn with cognitive output and live probe session results
- Merges persisted probe sessions with active draft sessions
- Displays user prompt that generated the response
- Orchestrates CognitiveOutputRenderer for singularity/mapping display

**Key Capabilities:**

- **Probe Session Merging** — Combines persisted aiTurn.probeSessions with activeProbeDraftFamily (deduped by ID)
- **User Prompt Display** — Shows original prompt that generated the response
- **Cognitive Output Orchestration** — Renders CognitiveOutputRenderer with singularityState
- **Probe Sessions Display** — Renders ProbeSessionsPanel for exploration results

**Atom Dependencies:**

- `activeProbeDraftFamily(aiTurnId)` — Active exploration draft for this turn

**Hooks:**

- `useSingularityOutput(aiTurnId)` — Provides singularity state (batches, responses, progress)

**Data Flow:**

- Input: AiTurn message, singularityState
- Output: Cognitive output renderer + probe sessions panel

---

## TurnOutputRouter.tsx (CognitiveOutputRenderer)

Cognitive output rendering orchestrator coordinating metrics, structure, and singularity responses.

**Role:**

- Orchestrates complete AI response flow: streaming → mapping → singularity
- Manages provider-targeted recomputation (mapping/batch/singularity)
- Coordinates MetricsRibbon, StructureGlyph, and SingularityOutputView rendering
- Handles provider artifact loading and error states

**Key Capabilities:**

- **Multi-Stage Orchestration** — Routes through batch streaming → mapper artifact → singularity response
- **Provider Targeting** — Allows user to select which provider's mapping to view
- **Artifact Management** — Loads provider-specific artifacts via useProviderArtifact
- **Editorial Display** — Shows EditorialPreview for cognitive artifact summary
- **Error Handling** — Displays PipelineErrorBanner for errors
- **Copy Utilities** — formatFullTurn for copying complete AI turn output

**Atom Dependencies:**

- `selectedModelsAtom` — Active model selection
- `mappingProviderAtom` — User-selected mapping provider (null = auto-select)
- `singularityProviderAtom` — User-selected singularity provider (null = auto-select)
- `modelResponsePanelModeFamily(turnId)` — Display mode per turn
- `workflowProgressForTurnFamily(turnId)` — Streaming progress scoped to active turn
- `activeSplitPanelAtom` — Current split panel context
- `isDecisionMapOpenAtom` — Decision map visibility

**Hooks:**

- `useSingularityMode(aiTurnId)` — Triggers singularity recomputation
- `useProviderArtifact(aiTurnId, providerId)` — Loads/rebuilds provider artifact

**Data Flow:**

1. Input: aiTurn, singularityState (batches, responses)
2. Render CouncilOrbs for provider selection (batch phase)
3. Render MetricsRibbon + StructureGlyph (mapper artifact ready)
4. Render SingularityOutputView (singularity response ready)
5. Output: Complete cognitive artifact display

---

## CouncilOrbs.tsx

Provider selection orbs with streaming progress indicators and role management.

**Role:**

- Displays interactive orbs for each selected provider
- Shows streaming progress stage (idle/thinking/streaming/complete/error)
- Manages provider selection via crown orb (active voice)
- Supports tray expansion for extended provider view
- Coordinates provider authentication and model selection

**Key Capabilities:**

- **Orb Display** — Renders provider circles with logos and accent colors
- **Crown Orb** — Highlights active provider (synthesizer)
- **Progress Indicators** — Stage-specific visual feedback (spinner for thinking/streaming, checkmark for complete)
- **Tray Expansion** — Expands to show all providers on hover/interaction
- **Provider Locking** — Prevents concurrent recomputes via providerLocksAtom
- **Responsive Variants** — 'tray' | 'divider' | 'welcome' | 'historical' | 'active' modes
- **Gating** — forceGating option to hide orbs for historical turns

**Atom Dependencies:**

- `providerEffectiveStateFamily({ turnId, providerId })` — Per-provider response state
- `selectedModelsAtom` — Active model set
- `providerAuthStatusAtom` — Authentication status per provider
- `mappingProviderAtom`, `singularityProviderAtom` — User overrides
- `providerLocksAtom` — Recompute locks
- `isSplitOpenAtom` — Split pane visibility

**Props:**

- `turnId` — Optional; if provided, enables per-turn orchestration
- `providers` — Array of available LLM providers
- `voiceProviderId` — Currently active provider (crown position)
- `onOrbClick`, `onCrownMove` — Callbacks for provider selection
- `workflowProgress` — Record of { providerId → { stage, progress? } }
- `variant` — Layout variant (tray/divider/welcome/historical/active)
- `forceGating` — Strictly hide orbs for historical turns

**Data Flow:**

- Input: providers, voiceProviderId, workflowProgress
- Output: Interactive orb grid with progress indicators and provider selection

---

## SingularityOutputView.tsx

Singularity response display with provider selection and copy utilities.

**Role:**

- Renders final singularity response (concierge output)
- Shows provider crowns for provider selection
- Allows full-turn copy-to-clipboard
- Displays response structure and formatting

**Key Capabilities:**

- **Response Display** — Renders singularity response text
- **Provider Selection** — Crown orbs allow switching between provider outputs
- **Copy Utilities** — formatFullTurn for complete turn export
- **Error States** — Handles missing responses gracefully

**Data Flow:**

- Input: AiTurn, singularityState
- Output: Rendered singularity response with provider controls

---

## WelcomeScreen.tsx

Initial conversation entry point with session initialization.

**Role:**

- Displays welcome message when no turns exist
- Provides session initialization UI
- Guides users to start first conversation

**Data Flow:**

- Input: None (renders when turnIds.length === 0)
- Output: Welcome UI with first-turn prompt guidance

---

## CouncilOrbsVertical.tsx

Vertical layout variant of CouncilOrbs for split-pane right panel.

**Role:**

- Renders providers in vertical stack for decision map panel
- Maintains same provider selection and progress logic as horizontal variant
- Optimized for narrow right-panel width constraints

**Data Flow:**

- Same as CouncilOrbs, vertical layout variant

---

## Design Patterns & Performance Optimizations

### Virtual List Rendering

- Virtuoso in ChatView handles 50+ turns with O(1) render cost
- Only visible turns render; others are DOM-removed
- Ref-based scroll-to-bottom for smooth message arrival

### Lazy Loading

- CouncilOrbsVertical and DecisionMapSheet loaded on-demand via safeLazy
- Defers heavy components (orb machinery, decision map) for faster initial load
- Components error gracefully if lazy import fails

### Per-Turn Atom Isolation

- MessageRow uses selectAtom to subscribe only to its turnId
- Prevents re-renders of other turns when one turn changes
- Critical for performance at turn list scale

### Memoization

- MessageRow wrapped in React.memo to prevent re-renders from parent changes
- CouncilOrbs memoized to prevent re-renders during streaming updates
- useMemo for itemContent function to avoid recreating renderer on every render

### Split Pane State Management

- `activeSplitPanelAtom` stores { turnId, providerId }
- `isSplitOpenAtom` (derived) prevents full-list re-renders during split interaction
- ResizableSplitLayout manages drag-resize with ratio persistence

### Streaming Performance

- turnStreamingStateFamily provides reference-stable idle state for non-active turns
- Only active turn re-renders during streaming updates
- workflowProgressForTurnFamily scopes progress to active turn

### Error Boundaries

- PipelineErrorBanner for artifact generation errors
- Graceful fallbacks for missing turns or messages
- Type safety in message routing (user vs. ai discrimination)

---

## Summary of Architecture

**Turn Orchestration:**

- ChatView manages virtualized turn list via Virtuoso
- MessageRow dispatches to UserTurnBlock or AiTurnBlock based on type
- AiTurnBlock coordinates cognitive output rendering

**Output Rendering:**

- TurnOutputRouter (CognitiveOutputRenderer) orchestrates multi-stage display
- Batch streaming → MetricsRibbon → SingularityOutputView progression
- Provider selection via CouncilOrbs (mapping/singularity targets)

**State Management:**

- Turn history in turnsMapAtom (Map<turnId, TurnMessage>)
- Split pane state in activeSplitPanelAtom ({ turnId, providerId })
- Streaming progress in workflowProgressForTurnFamily(turnId)
- Provider selection in mappingProviderAtom, singularityProviderAtom

**Performance Strategies:**

- Virtual list rendering for scale (50+ turns)
- Per-turn atom families for render isolation
- Shared idle state objects for non-active turns
- Lazy loading of heavy components (orbs, decision map)
- Memoization of message renderers and orchestrators

---

## Entry Points

- **Main Chat View:** `<ChatView />` — Full conversation interface with split pane
- **Welcome Screen:** Renders when turnIds.length === 0
- **Decision Map Pane:** Lazily loaded DecisionMapSheet on split-pane open
- **Provider Orbs:** CouncilOrbs for provider orchestration (horizontal/vertical variants)
- **Singularity Output:** SingularityOutputView crowns the response flow

All components integrate via Jotai atoms for shared state (turn history, streaming, provider selection, panel layout) and hooks for provider/workflow orchestration (useProviderArtifact, useSingularityOutput).

---

## Related Modules

- **@ui/state** — Atom definitions (turns, streaming, provider, layout)
- **@ui/instrument** — MetricsRibbon, StructureGlyph, DecisionMapSheet
- **@ui/shell/layout** — ResizableSplitLayout, SplitPaneRightPanel
- **@ui/hooks** — useChat, useSingularityOutput, useProviderArtifact
- **@src/provenance** — Structure analysis and artifact generation

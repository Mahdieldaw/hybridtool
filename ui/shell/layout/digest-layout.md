# @ui/shell/layout — file digest (responsive split-pane and overlay layout orchestration)

---

## Overview

`@ui/shell/layout` is the **responsive container layout layer** orchestrating split-pane resizing, modal overlays, and pane-to-panel transitions. It manages deterministic CSS Grid-based layout with pointer-based resizing, artifact overlay display, and conditional panel visibility. The layer is organized into four components:

1. **ResizableSplitLayout.tsx** — CSS Grid-based split-pane with draggable divider
2. **SplitPaneRightPanel.tsx** — Right panel content orchestrator (decision map, corpus search)
3. **ModelResponsePanel.tsx** — Model response viewer with collapsible sections
4. **ArtifactOverlay.tsx** — Modal overlay for artifact inspection and detail views

---

## ResizableSplitLayout.tsx

CSS Grid-based split-pane container with deterministic layout guarantees and pointer-based resizing.

**Role:**

- Manages left/right pane layout with fixed grid tracks
- Provides draggable divider for ratio adjustment (20–80% range)
- Guarantees content cannot expand beyond track bounds (unlike flexbox)
- Handles smooth transitions on ratio changes

**Key Capabilities:**

- **Grid-Based Layout** — Three-track grid: left pane | divider (6px) | right pane
- **Pointer Resizing** — Drag divider horizontally; tracks pointer movement across viewport
- **Ratio Control** — Controlled or uncontrolled ratio (default 55%); persisted to Jotai atom
- **Clamping** — minRatio (20%) and maxRatio (80%) enforce bounds
- **Divider Content** — Optional custom content (orbs, icons) rendered in pointer-events-none region
- **Full-Width Mode** — rightPaneFullWidth collapses left pane entirely; hides divider
- **Split State Gating** — Renders right pane + divider only when isSplitOpen=true

**Props:**

- `leftPane, rightPane` — ReactNode; left/right content
- `isSplitOpen` — boolean; controls grid layout (1 vs 3 track)
- `ratio` — number (0–100); left pane percentage (controlled or uncontrolled)
- `onRatioChange` — callback on ratio change
- `minRatio, maxRatio` — bounds (default 20/80)
- `dividerContent` — ReactNode rendered in divider region
- `rightPaneFullWidth` — boolean; hide left pane, full-width right
- `className, style` — standard styling props

**Architecture:**

- **CSS Grid** — gridTemplateColumns computed from isSplitOpen + ratio
- **Track Sizing** — `${ratio}fr ${dividerWidth}px ${100-ratio}fr` distributes space proportionally
- **Pointer Capture** — setPointerCapture ensures moves outside divider are tracked
- **Body Cursor** — Temporarily sets body cursor to col-resize during drag
- **Transition** — grid-template-columns transitions smoothly (75ms) when not dragging
- **Min-Width 0** — Child divs use min-w-0 to force shrinking below content size

**Performance Characteristics:**

- Layout recomputed only when ratio/isSplitOpen changes
- Pointer moves don't trigger re-renders (event handlers are pure)
- Grid transition disabled during drag (no layout thrashing)
- Pointer capture prevents missing moves outside divider bounds

**Migration Note:** Replaces flexbox version; same props API, deterministic layout guarantees. Content cannot expand the grid track (guaranteed by CSS Grid architecture).

---

## SplitPaneRightPanel.tsx

Right panel content orchestrator displaying decision maps, corpus search, and model outputs.

**Role:**

- Coordinates display of three interactive surfaces: decision map, corpus search, model grid
- Manages tab-based navigation between surfaces
- Passes shared state (focusedClaimId, highlightMap, citationSourceOrder) to child components
- Handles panel resizing and scroll state

**Key Capabilities:**

- **Tabbed Interface** — Switches between: graph, narrative, options, space, shadow, json (decision map tabs)
- **Corpus Search** — Full-text + LLM probe-based passage discovery
- **Model Grid** — Side-by-side comparison of batch model outputs
- **State Propagation** — Passes artifact, focusedClaimId, citationSourceOrder to children
- **Scroll Isolation** — Each tab/surface scrolls independently

**Props:**

- `artifact` — CognitiveArtifact; semantic structure + claims + passages
- `activeTab` — currently-open decision map tab (from layout atom)
- `focusedClaimId` — currently-focused claim; drives highlighting in model grid
- `citationSourceOrder` — maps modelIndex → providerId for model names
- `onTabChange` — callback when tab selection changes
- `onFocusClaim` — callback when claim is focused

**Rendering Logic:**

1. If activeTab is 'graph' | 'narrative' | 'options' | 'space' | 'shadow' | 'json' → render DecisionMapSheet
2. If activeTab is 'corpus' → render CorpusSearchPanel
3. If activeTab is 'models' → render ModelGrid
4. Default → render DecisionMapSheet with default tab

**Design:** Stateless orchestrator; all state (activeTab, focusedClaimId) managed in parent/Jotai atoms.

---

## ModelResponsePanel.tsx

Collapsible model response viewer with comparison and filtering capabilities.

**Role:**

- Displays batch model responses in organized layout
- Provides collapse/expand affordances for each response section
- Shows model metadata (name, token counts, confidence)
- Integrates with passage highlighting (claim ownership, landscape position)

**Key Capabilities:**

- **Response Grouping** — Groups responses by provider (Gemini, GPT, Claude, etc.)
- **Collapse/Expand** — Per-response toggle; remembers state per turn
- **Model Metadata** — Shows model name, input/output tokens, confidence score
- **Passage Display** — Renders passages with landscape coloring + concentration scaling
- **Filtering** — Optional filter by provider or model
- **Scroll Isolation** — Response panel scrolls independently

**Props:**

- `responses` — array of ProviderResponse; { text, modelIndex, meta: { modelName, ... } }
- `focusedClaimId` — drives highlighting via landscape coloring
- `citationSourceOrder` — maps modelIndex to provider name
- `onResponseSelect` — callback when response is selected/expanded

**Rendering Logic:**

1. Group responses by provider/model
2. For each group: render collapsible header (model name + token counts)
3. If expanded: render full response text with landscape styling
4. Apply concentration scaling + claim ownership coloring

**Design:** Controlled component; expand state persisted per turn via Jotai atom.

---

## ArtifactOverlay.tsx

Modal overlay for artifact inspection, detail views, and supplementary content.

**Role:**

- Displays artifact details (cognitive artifact structure, provenance, claims, edges)
- Provides full-screen inspection of complex semantic structures
- Supports multiple view modes (structural, narrative, graph JSON, diagnostics)
- Handles close affordances and keyboard dismissal (ESC)

**Key Capabilities:**

- **Modal Frame** — Darkened backdrop + centered dialog box
- **View Modes** — Tabs for: structure, narrative, graph, json, diagnostics
- **Structure View** — Cognitive artifact field breakdown (semantic, decisions, etc.)
- **Graph View** — Interactive visualization of claim graph + edges
- **JSON View** — Raw artifact structure for inspection
- **Diagnostics** — Health checks, provenance scores, density metrics
- **Scrollable Content** — Long content scrolls within modal bounds
- **Keyboard Dismiss** — ESC key closes overlay

**Props:**

- `artifact` — CognitiveArtifact to inspect
- `isOpen` — boolean; controls visibility
- `onClose` — callback on close

**Styling:**

- Backdrop: semi-transparent dark overlay (opacity-50, pointer-events-none for backdrop itself)
- Dialog: centered, fixed max-width (90vw), max-height (90vh), scrollable content
- Header: title + close button (×)
- Tabs: horizontal tab list with active indicator
- Content: tab-specific rendering

**Design:** Uncontrolled visibility; parent controls isOpen and onClose. Renders null if isOpen=false (no DOM pollution).

---

## Data Flow

**Entry Points:**

1. **ResizableSplitLayout** — Root container; receives leftPane (ChatView) and rightPane (SplitPaneRightPanel)
2. **SplitPaneRightPanel** — Orchestrates decision map + corpus search + model grid
3. **ModelResponsePanel** — Embeds within SplitPaneRightPanel or standalone
4. **ArtifactOverlay** — Modal overlay triggered by inspection button

**Shared State (via Jotai atoms):**

- `activeSplitPanelAtom` — currently-open panel: { turnId, providerId }
- `isSplitOpenAtom` — controls left/right split visibility
- `splitPaneRatioAtom` — left/right split ratio (0–100), persisted
- `splitPaneFullWidthAtom` — hide left pane, full-width right
- `isDecisionMapOpenAtom` — currently-open decision map + tab
- `focusedClaimIdAtom` — currently-focused claim; drives highlighting
- `modelResponsePanelModeFamily(turnId)` — mode per turn: 'single' | 'all' | 'reading'

**Highlighting Pipeline:**

1. ModelResponsePanel receives focusedClaimId
2. Computes owned statements per claim (via claimProvenance)
3. Applies landscape coloring + concentration scaling
4. Highlights passages in model output

**Tab Navigation:**

1. User clicks tab in DecisionMapSheet
2. onTabChange callback emits state update
3. isDecisionMapOpenAtom updated with new tab
4. SplitPaneRightPanel re-renders with new activeTab
5. DecisionMapSheet or alternative surface renders

---

## Design Patterns & Performance Optimizations

### CSS Grid Guarantees

- Fixed track sizes prevent content expansion
- Layout computed once; content cannot renegotiate
- Deterministic behavior across browsers
- Smoother resizing vs flexbox negotiation

### Pointer Capture

- setPointerCapture ensures divider tracks moves outside bounds
- No mousemove listeners on body (pointer events only)
- Pointer-events: none on backdrop prevents interference

### Ref Tracking

- containerRef in ResizableSplitLayout for getBoundingClientRect() during drag
- No per-pane refs; layout is stateless

### State Isolation

- Split ratio persisted to Jotai atom (survives reload)
- Per-turn panel mode (modelResponsePanelModeFamily) isolated from global state
- focusedClaimId scoped per turn via atom family

### Responsive Grid

- SplitPaneRightPanel's DecisionMapSheet adapts to available width
- ModelGrid columns scale based on panel width
- No fixed widths; all relative sizing

### Lazy Rendering

- ArtifactOverlay renders null if isOpen=false
- SplitPaneRightPanel + divider only render when isSplitOpen=true
- Prevents DOM bloat for hidden panels

---

## Integration Points

**Upstream (external systems providing input):**

- Chat message input → triggers layout reflow
- Artifact data → flows to SplitPaneRightPanel child components
- User pointer events → divider drag handling
- Jotai atoms → split ratio, panel mode, focused claim

**Downstream (consuming layout output):**

- ResizableSplitLayout → constrains content to grid tracks
- Child components (DecisionMapSheet, CorpusSearchPanel, ModelGrid) → receive artifact + state
- UI indicators → reflect focusedClaimId highlighting
- Storage → split ratio persisted to localStorage via atomWithStorage

---

## Summary of Architecture

**Layout Orchestration:**

- **ResizableSplitLayout** — CSS Grid-based split pane with pointer resizing
- **SplitPaneRightPanel** — Tabbed orchestrator for decision map, corpus search, model grid
- **ModelResponsePanel** — Collapsible response viewer with landscape styling
- **ArtifactOverlay** — Modal inspection surface for artifact details

**Key Properties:**

- **Deterministic Layout** — CSS Grid guarantees content cannot exceed track bounds
- **Persistent Ratio** — Split ratio saved to localStorage, restored on reload
- **Focus Isolation** — focusedClaimId drives highlighting without global reflow
- **Tab Navigation** — Seamless switching between decision map, corpus, models
- **Modal Inspection** — Full-screen overlay for detailed artifact exploration
- **Responsive** — All components adapt to available pane width

**Performance:**

- Grid layout computed once; content resizing doesn't renegotiate
- Pointer capture prevents thrashing on fast drag
- Tab switches don't reload underlying components (CSS visibility)
- LazyRendered modals (null when closed)

**Entry Points:**

- **Full Layout:** `<ResizableSplitLayout leftPane={...} rightPane={<SplitPaneRightPanel />} isSplitOpen={...} />`
- **Right Panel Standalone:** `<SplitPaneRightPanel artifact={...} citationSourceOrder={...} />`
- **Model Responses:** `<ModelResponsePanel responses={...} focusedClaimId={...} />`
- **Artifact Inspection:** `<ArtifactOverlay artifact={...} isOpen={...} onClose={...} />`

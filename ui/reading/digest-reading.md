# @ui/reading — file digest (current implementation)

---

## Overview

`@ui/reading` is the **editorial reading surface and corpus exploration layer** — an interactive interface for exploring semantic mapper narrative output, statement passages, and structural provenance. It orchestrates the display of editorial threads (narrative segments organized by thematic intent), passage-claim mappings, model outputs, and corpus search capabilities through a **tabbed, multi-column surface** with synchronized highlight and focus state.

The layer is organized into five semantic domains:

1. **EditorialDocument.tsx** — Full editorial narrative UI with thread index and jump navigation
2. **EditorialPreview.tsx** — Collapsed preview of editorial narrative (expand affordance)
3. **Passage Rendering** — PassageBlock, ConflictPair, ContextCollapse for evidence display
4. **Model Output Grid** — ModelGrid, ModelColumn for side-by-side model response viewing
5. **Corpus Search & Navigation** — CorpusSearchPanel, ClaimRibbon for passage lookup and claim focus

---

## EditorialDocument.tsx

Main narrative container orchestrating full editorial reading surface.

**Role:**

- Manages editorial thread layout and navigation
- Parses EditorialAST (abstract syntax tree) and renders threads in order
- Handles arrow-key navigation between threads with smooth scrolling
- Serializes editorial document to plaintext for copying
- Coordinates claim focus and passage resolution

**Key Capabilities:**

- **Thread Ordering** — Reads `ast.thread_order` and sorts threads accordingly
- **Ref Tracking** — Maps thread IDs to DOM elements for jump-to-thread navigation
- **Keyboard Navigation** — Arrow keys move between threads, skip input/textarea targets
- **Document Serialization** — Builds plaintext copy including all passages and claims
- **Collapse/Close Affordances** — Switches between full and column layout; closes surface
- **Thread Index Integration** — ThreadIndex component with jump links and "start here" indicators

**Data Flow:**

- Input: `EditorialAST` (orientation, threads, thread_order, diagnostics)
- Input: `artifact` (semantic, claim, provenance, routing data)
- Input: `citationSourceOrder` (maps modelIndex to providerId)
- Output: Full editorial narrative with navigable threads and highlighted passages

---

## EditorialPreview.tsx

Collapsed preview of editorial narrative; serves as expand affordance.

**Role:**

- Shows orientation line and thread labels in compact form
- Indicates thread ordering with "start here" gold indicators
- Expands to full EditorialDocument on click

**Features:**

- **Orientation Display** — Shows narrative orientation line
- **Thread Labels** — Lists thread titles and "why_care" descriptions
- **Start-Here Indicators** — Gold dots on threads marked as entry points
- **Framer Motion Animation** — Fade-in effect on render

**Usage:** Collapsed editorial surface in responsive layouts; click to expand full view.

---

## PassageBlock.tsx

Renders a single passage (or unclaimed text block) with geometric and provenance styling.

**Role:**

- Displays model-sourced text with claim ownership context
- Applies landscape position coloring (northStar/mechanism/eastStar/floor)
- Visualizes concentration ratio via typography scaling
- Shows claim attribution and role labels

**Features:**

- **Role Labeling** — Shows role (anchor, support, context, reframe, alternative)
- **Landscape Coloring** — Left border color + text lightness based on landscape position
- **Concentration Scaling** — Font size and weight increase with concentration ratio
- **Multi-Paragraph Indicator** — Vertical line for passages spanning 3+ paragraphs
- **Claim Attribution** — Model name and claim label displayed below text
- **Unclaimed Variant** — Dashed border for passages not associated with claims

**Styling Strategy:**

- **Concentration (0–1)** mapped to:
  - Font size: 0.9375rem + 0.125rem * concentration
  - Font weight: 400 + 200 * concentration
  - Color lightness: 60% + 30% * concentration
- **Border colors** from `LANDSCAPE_STYLES` (amber/blue/violet/white)

---

## ConflictPair.tsx

Renders opposing passages (anchor + alternative) from same conflict cluster.

**Role:**

- Shows two alternative passages side-by-side for comparison
- Allows toggling to sequential view for narrower screens
- Pairs anchor with matching alternative via conflictClusterIndex

**Features:**

- **Responsive Layout** — Side-by-side on wide screens, stacked on narrow (md breakpoint)
- **View Toggle** — "View sequentially" button collapses to stacked layout
- **Local State** — Tracks collapsed/expanded with useState
- **PassageBlock Integration** — Uses PassageBlock for consistent styling

**Usage:** ThreadSection automatically pairs anchors with alternatives from same conflict cluster.

---

## ContextCollapse.tsx

Collapsible section for context passages, hides by default.

**Role:**

- Manages display of multiple context items (passages providing background)
- Hides context passages by default to reduce cognitive load
- Expands to show all items on demand with rotated chevron affordance

**Features:**

- **Expand/Collapse Toggle** — Button shows item count; rotates chevron on expand
- **Item Count Display** — "N additional passages provide context"
- **PassageBlock Integration** — Uses PassageBlock for consistency
- **Early Return** — Returns null if items.length === 0

**State:** Local expanded/collapsed toggle via useState.

---

## CorpusSearchPanel.tsx

Search interface for corpus retrieval and probe-based passage discovery.

**Role:**

- Provides full-text search over passage corpus (embedding NN)
- Triggers probe-based search using Gemini/Qwen (exploration mode)
- Displays corpus NN results with similarity scores
- Shows streaming probe responses in real-time

**Key Capabilities:**

- **Search Input** — Text field with query submission (enter key)
- **Provider Toggles** — Enable/disable Gemini and Qwen probe providers
- **Corpus NN Results** — Top-K nearest neighbor hits with similarity badges
- **Similarity Badging** — Color-coded based on normalized similarity (>0.75 emerald, >0.55 amber, default gray)
- **Probe Responses** — Streaming LLM responses from enabled providers
- **Model Name Resolution** — Uses citationSourceOrder to map modelIndex to provider name

**Hooks Used:**

- `useCorpusSearch(aiTurnId)` — Returns results, isSearching, error, search(), clear(), probeResults, isProbing
- `useAtom(probeProvidersEnabledAtom)` — Jotai atom for provider selection

**UI Flow:**

1. User types query and presses enter
2. Corpus NN search starts (synchronously or via embedding lookup)
3. Probe search starts if enabled providers exist (async LLM)
4. Results stream into separate panes: Probe Responses (top), Corpus NN Results (bottom)

---

## ModelGrid.tsx

Side-by-side grid layout of model outputs (batch responses).

**Role:**

- Displays paragraphs from multiple models in responsive grid layout
- Handles variable column counts (1–6 models)
- Delegates passage highlight state to ModelColumn
- Enables comparison of competing model outputs

**Key Capabilities:**

- **Dynamic Grid** — 1–6 columns based on modelIndices.length
- **Model Discovery** — Extracts unique modelIndex values from artifact.shadow.paragraphs
- **Provider Mapping** — Uses citationSourceOrder to resolve providerId from modelIndex
- **Focus Propagation** — Passes focusedClaimId and highlightMap to each column
- **Independent Scrolling** — Each column scrolls independently

**Data Flow:**

- Input: artifact (shadow.paragraphs with modelIndex)
- Input: focusedClaimId (from parent state)
- Input: highlightMap (Map<paragraphId, ParagraphHighlight> from usePassageHighlight)
- Output: Grid of ModelColumn components with fixed heights and independent scroll

---

## ModelColumn.tsx

Single model response column with statement-level highlighting.

**Role:**

- Renders all paragraphs for a specific model
- Highlights paragraphs matching focused claim
- Applies visual state (passage/dispersed/none) based on highlight map
- Scrolls to first matching passage when claim focus changes

**Key Capabilities:**

- **Paragraph Filtering** — Filters artifact.shadow.paragraphs by modelIndex
- **Statement Ownership Tracking** — Reads mixedProvenance.perClaim[claimId].canonicalStatementIds
- **Highlight State Integration** — Reads highlightMap to apply passage/dispersed/none styles
- **Auto-Scroll** — Smooth-scrolls to first passage when claim focus changes
- **Full Paragraph Display** — Prefers _fullParagraph (original model output) over statement stitching
- **Statement Fallback** — Stitches statements if _fullParagraph unavailable
- **Visual Receding** — Dims unrelated passages (opacity-40) when claim is focused

**Styling:**

- **Passage State** — Applies LANDSCAPE_STYLES colors + bold text
- **Dispersed State** — Lighter variant of landscape colors
- **None State** — Transparent border, full opacity
- **Owned Statements** — text-text-primary (bright) if claim-owned, else text-text-secondary (muted)

**Header:**

- Model name + paragraph count ("5p") + statement count ("27s")

---

## OrientationLine.tsx

Simple heading component displaying editorial orientation (narrative framing).

**Role:**

- Renders opening context/framing for editorial narrative
- Provides narrative entry point before threads

**Features:**

- Single-line text rendering (lg size, text-text-secondary)
- Padding and leading relaxed for readability

---

## ThreadIndex.tsx

Navigation index of editorial threads with jump links.

**Role:**

- Shows scannable list of threads with labels and descriptions
- Enables jump-to-thread navigation
- Marks "start here" threads with gold indicators

**Features:**

- **Thread Ordering** — Sorts threads by threadOrder
- **"Start Here" Indicators** — Gold dots for threads marked as entry points
- **Hover States** — Background highlight on hover
- **Jump Callback** — Calls onJumpToThread(threadId) on click

**Usage:** Rendered inside EditorialDocument as navigation sidebar/header.

---

## ThreadSection.tsx

Renders a single editorial thread with organized passage grouping.

**Role:**

- Displays all passages and claims for a thread
- Groups items by role (anchor, support, reframe, alternative, context)
- Automatically pairs conflict alternatives with anchors
- Collapses context passages by default

**Key Capabilities:**

- **Role Grouping** — Separates resolved items into role categories
- **Conflict Pair Detection** — Matches anchors with alternatives by conflictClusterIndex
- **Standalone Alternative Handling** — Renders alternatives without paired anchor
- **Context Collapse** — Passes context items to ContextCollapse for grouped display
- **Thread Metadata** — Displays thread number, label, "why_care", "start_here" indicator

**Rendering Order:**

1. Thread header (number, label, why_care, start_here indicator)
2. Anchors (PassageBlock, role=anchor)
3. Supporting passages (PassageBlock, role=support)
4. Conflict pairs (ConflictPair side-by-side or sequential)
5. Reframes + standalone alternatives (PassageBlock)
6. Context passages (ContextCollapse for grouping)

**Ref Forwarding:** Accepts ref to enable jump-to-thread scrolling in EditorialDocument.

---

## styles.ts

Central styling constants for landscape position coloring and typography.

**Types & Constants:**

- **LandscapePosition** — Union type: 'northStar' | 'eastStar' | 'mechanism' | 'floor'
- **LANDSCAPE_ORDER** — Canonical ordering [northStar, mechanism, eastStar, floor]
- **LANDSCAPE_LABEL** — Human-readable names for each position
- **LandscapeStyle** — Record with keys: chipBg, chipBorder, chipText, passageBg, passageBorder, dispersedBg, dispersedBorder

**Color Palette:**

- **northStar** — Amber (0.9375rem → 1.0625rem, 400→600 weight)
- **mechanism** — Blue (subdued blue tones)
- **eastStar** — Violet (purple/violet tones)
- **floor** — White/gray (muted, baseline)

**Usage:**

- ClaimRibbon uses styles for chip rendering
- PassageBlock uses styles for border + text coloring
- ModelColumn uses styles for highlight backgrounds
- All components apply styles via LANDSCAPE_STYLES[landscapePosition]

---

## index.ts (implied)

Public API barrel export. Re-exports all reading surface components:

```typescript
export { EditorialDocument, EditorialPreview } from './EditorialDocument';
export { PassageBlock } from './PassageBlock';
export { ConflictPair } from './ConflictPair';
export { ContextCollapse } from './ContextCollapse';
export { CorpusSearchPanel } from './CorpusSearchPanel';
export { ModelGrid, ModelColumn } from './ModelGrid';
export { ThreadIndex, ThreadSection } from './ThreadIndex';
export { ClaimRibbon } from './ClaimRibbon';
export { OrientationLine } from './OrientationLine';
export { LANDSCAPE_STYLES, LANDSCAPE_ORDER, LANDSCAPE_LABEL } from './styles';
```

---

## Data Flow

**Entry Points:**

1. **EditorialDocument** — Full narrative surface (EditorialAST + artifact)
2. **EditorialPreview** — Collapsed preview (EditorialAST only)
3. **CorpusSearchPanel** — Search interface (aiTurnId, citationSourceOrder)
4. **ModelGrid** — Output comparison grid (artifact, citationSourceOrder, focusedClaimId, highlightMap)

**Shared State:**

- `focusedClaimId` — Global claim focus; drives highlighting in ModelGrid/ModelColumn
- `highlightMap` — Map<paragraphId, ParagraphHighlight> with state (passage/dispersed/none) and landscapePosition
- `selectedThreadId` — Thread navigation state in EditorialDocument

**Resolution Flow:**

1. EditorialDocument calls usePassageResolver(artifact, citationSourceOrder)
2. Resolver.resolve(itemId) returns ResolvedPassage or ResolvedUnclaimedGroup
3. PassageBlock, ConflictPair, ContextCollapse consume resolved items
4. ModelColumn reads focusedClaimId to highlight owned statements

---

## Design Patterns & Performance Optimizations

### Memoization

- `sortedThreads` in EditorialDocument — recomputed only when ast.threads or ast.thread_order change
- `documentText` serialization — built once, used for copy-to-clipboard
- `paragraphs`, `modelIndices`, `ownedStatementIds` in ModelColumn/ModelGrid — memoized per artifact/claim

### Ref Tracking

- `threadRefs` in EditorialDocument — Map<threadId, HTMLElement> for jump navigation
- `paraRefs` in ModelColumn — Map<paragraphId, HTMLDivElement> for scroll-to-passage
- Callback refs keep DOM elements in sync with component state

### Auto-Scroll Behavior

- EditorialDocument: Arrow-key navigation triggers smooth scroll to thread
- ModelColumn: Claim focus change triggers auto-scroll to first matching passage
- Both use refs + scrollIntoView({ behavior: 'smooth' })

### Visual Hierarchy via Geometry

- **Concentration** → Font size + weight scaling (0–1 range)
- **Landscape Position** → Border colors (amber/blue/violet/white)
- **Claim Ownership** → Text color dimming (primary vs secondary)
- **Multi-Paragraph** → Vertical line indicator

### Focus Isolation

- Only ModelColumns under focused claim highlight passages
- Unfocused claims render in dim secondary color
- ContextCollapse hides items by default to reduce noise

### Responsive Grid Layout

- ModelGrid uses dynamic grid-cols-N based on model count
- ConflictPair uses md:flex-row (side-by-side on wide) vs flex-col (stacked on narrow)
- All components responsive within their parent constraints

---

## Summary of Architecture

**Narrative Organization:**

- EditorialAST defines threads, thread_order, orientation, and conflict metadata
- ThreadIndex provides jump navigation
- ThreadSection renders threads with grouped passages

**Passage Display:**

- PassageBlock renders single passages with landscape styling
- ConflictPair shows competing passages side-by-side
- ContextCollapse collapses supporting context to reduce clutter

**Output Comparison:**

- ModelGrid renders multiple model outputs in responsive grid
- ModelColumn filters paragraphs by modelIndex, highlights claim-owned statements
- Focus propagation via focusedClaimId + highlightMap

**Search & Discovery:**

- CorpusSearchPanel provides embedding-based search + LLM probe-based alternatives
- ClaimRibbon shows all claims sorted by landscape position and concentration
- Both feed into editorial reading surface for passage inspection

**Styling Strategy:**

- Landscape position (northStar/mechanism/eastStar/floor) maps to border colors
- Concentration ratio (0–1) maps to typography scaling
- Role (anchor/support/context) affects visual treatment (background, border style)
- All styles centralized in styles.ts for consistency

---

## Entry Points

- **Full Editorial Surface:** `<EditorialDocument ast={ast} artifact={artifact} citationSourceOrder={...} onCollapse={...} onClose={...} />`
- **Editorial Preview:** `<EditorialPreview ast={ast} onExpand={...} />`
- **Model Output Grid:** `<ModelGrid artifact={artifact} citationSourceOrder={...} focusedClaimId={...} highlightMap={...} />`
- **Corpus Search:** `<CorpusSearchPanel aiTurnId={aiTurnId} citationSourceOrder={...} />`
- **Claim Navigation:** `<ClaimRibbon artifact={artifact} focusedClaimId={...} onFocusClaim={...} />`

Components are composable; can be used independently or coordinated via shared state atoms (focusedClaimId, selectedThread, highlightMap).

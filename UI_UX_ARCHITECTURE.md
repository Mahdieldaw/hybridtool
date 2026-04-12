# Singularity UI/UX Architecture (Updated Apr 2026)

## Part I: The Computational Flow

**Pipeline → UI Rendering:**

1. **Batch Execution:** 6 AI models generate raw responses in parallel
2. **Semantic Mapping:** LLM extracts claims + edges from batch outputs
3. **Geometry:** Bayesian basin detection, periphery interpretation, density computation
4. **Singularity Phase:** Consolidates geometry + semantic structure into unified artifact
5. **Rendering:** Singularity response displayed in chat with optional editorial portal

---

## Part II: The Overlaying UI/UX

### The Chat as Spatial Interface

**The chat is one flowing timeline** (standard message scroll).

**Each AI response is a turn** containing multiple spatial layers.

---

### Layer 1: Side Panel (Council Orbs)

**Location:** Header of AI response  
**Trigger:** Click any model orb  
**Displays:** That model's raw batch response from this turn

**Purpose:**

- Access individual model perspectives
- See exact text each model contributed
- Compare model outputs directly

**Behavior:**

- Opens as slide-out panel
- Multiple orbs clickable (switch between models)
- Closes when clicking away or switching turns

---

### Layer 2: Main Panel (Singularity Response)

**Default display:** Synthesis/recommendations from singularity phase

**Contains:**

- Unified structural analysis (claims, edges, conditionals)
- Evidence citations (statement IDs with model attribution)
- Caveats and conditionals resolved by geometry

**Controls:**

- **[📖 Reading Surface] button:** Portal to editorial reading interface
  - Appears above singularity response
  - Launches full-screen or modal reading view
  - Triggered by user to explore evidence in depth

**Recompute capability:**

- **[Remap] button:** Triggers re-running semantic mapper on frozen batch outputs
  - Re-runs geometry + singularity phase
  - Generates new structural analysis
  - Creates sub-tab in response (preserves prior synthesis)

---

### Layer 3: Editorial Reading Surface (Portal)

**Trigger:** Click [📖 Reading Surface] button in main panel

**Layout:**

#### **Header: Editorial Arrangement**

- **Purpose:** Table of contents / thematic breadcrumb
- **Display:** LLM-arranged navigation through semantic threads
- **Function:** Allows user to jump between editorial themes/clusters
- **Data:** AST-based arrangement structure

#### **Main Grid: Claims & Evidence**

- **Layout:** 6-column × 2-row layout (high-information-throughput reading)
- **Content:** Claims with supporting evidence passages
- **Arrangement:** Organized by editorial threads (from header navigation)
- **Density:** Designed for comprehensive evidence review

**Interactions:**

- Click thread in header → grid updates to show claims for that thread
- Hover claim → show full text + citations
- Click evidence passage → highlight related claims
- Back button → returns to main chat

**Data Type:** editorial (AST-based arrangement of claims + passages)

**Behavior:**

- Slides up or opens as modal/new view
- Freezes at current singularity state (snapshot of that query's interpretation)
- Closeable (returns to main chat)

---

### Decision Map (Optional Visualization)

**Location:** Bottom of turn (optional layer)  
**Trigger:** Click decision map icon/button (if exposed)  
**Displays:** Force-directed graph of structural analysis

**Nodes:**

- Claims (sized by support)
- Color-coded by stance/type
- Positioned by relationships

**Edges:**

- Supports (green)
- Conflicts (red)
- Dependencies (yellow)
- Sequence (blue)

**Interactions:**

- Click node → highlight connected claims
- Hover → show claim text
- **Remap button:** Triggers remapping from current state

**Behavior:**

- Slides up from bottom (overlay, doesn't replace main panel)
- Closeable (slides back down)
- Graph frozen per turn (snapshot of that query's topology)

---

### Turn Structure in Chat

**Visual hierarchy:**

```
[User Message]
    ↓
┌────────────────────────────────────────┐
│ AI Response Header                     │
│ [○ Model1] [○ Model2] ... [○ Model6]  │ ← Council Orbs
├────────────────────────────────────────┤
│ Main Panel (Singularity Response)      │
│ ┌──────────────────────────────────┐   │
│ │ Synthesis + Structural Analysis  │   │
│ │                                  │   │
│ │ Evidence citations with model    │   │
│ │ attribution + resolved caveats   │   │
│ │                                  │   │
│ │ [📖 Reading Surface] [Remap]     │   │
│ │                                  │   │
│ │ Sub-tabs: [Main] [Alt 1] [Alt 2]│   │
│ └──────────────────────────────────┘   │
├────────────────────────────────────────┤
│ [📊 Decision Map] ← optional layer     │
└────────────────────────────────────────┘
    ↓
[Next User Message]
```

---

### Epistemic & Temporal Controls

**What the UI enables:**

1. **Depth control:** User decides how deep to explore (orbs → raw outputs, reading surface → evidence grid, map → topology)
2. **Thematic navigation:** Editorial arrangement acts as guided entry points into evidence structure
3. **Evidence throughput:** 6-column grid layout designed for comprehensive claim + passage review
4. **Non-destructive exploration:** Remap creates alt synthesis without losing original, accessible in sub-tabs
5. **Spatial reading:** Organized by editorial threads rather than arbitrary buckets

**What the UI prevents:**

1. **Topology inheritance:** Each new user message creates fresh turn with new substrate
2. **Hidden evidence:** Editorial reading surface exposes all claims + supporting passages
3. **Forced linearity:** User can jump between threads via header navigation

---

### The Compressed Experience

**From user perspective:**

You're chatting normally. Each AI response has:

- **Surface:** Synthesis/recommendations (main panel, default view)
- **Depth:** Click reading surface to explore evidence grid organized by themes
- **Raw:** Click orbs to see individual model outputs
- **Topology:** Click decision map to visualize structure (optional)
- **Time:** Remap button lets you re-run geometry + singularity without losing original
- **Control:** You decide when to go deeper, when to move forward

**The chat itself is the archive.**

Scroll up → prior turns intact with all layers.  
Scroll down → conversation flows naturally.

No separate "history view." No external tools. Just **epistemic controls embedded in conversational flow**.

---

### Design Principle

**Compress everything into a turn.**

UI-wise, you're participating in a scrolling chat.

Epistemically, you have:

- Access to raw evidence (orbs)
- Editorial guidance through thematic threads (reading surface header)
- High-throughput evidence review (6-column grid)
- Control over interpretation (remap button)
- Visibility into structure (decision map, optional)
- Branching syntheses (sub-tabs)
- Spatial navigation (tabs, panels, portals)

**It feels like chat.**  
**It behaves like a semantic reading workbench.**

---

## Implementation Notes

### Data Flow to UI

1. `singularityArtifact` generated by singularity phase
2. Rendered in main chat panel
3. Editorial button portal linked to `editorial` arrangement (AST structure)
4. Reading surface consumes editorial data to populate header + grid
5. Grid displays claims from `semantic.claims` with passages from corpus

### Key Components

- **Main Panel:** Singularity response rendering (synthesis layer)
- **Editorial Portal:** Button trigger in response header
- **Reading Surface:** Full-screen/modal with header (threads) + grid (claims × evidence)
- **Council Orbs:** Model selector (side panel, batch raw responses)
- **Decision Map:** Optional graph visualization (bottom of turn)

### Component Locations (estimated)

- Main response: `ui/components/SingularityResponse.tsx` (or within `ChatTurn.tsx`)
- Editorial portal button: Above/within main panel
- Reading surface: `ui/components/EditorialReadingSurface.tsx` or similar
- Grid layout: `ui/components/editorial/ClaimGrid.tsx` (6-column)
- Header/arrangement: `ui/components/editorial/EditorialHeader.tsx`

---

## AST-Based Editorial Arrangement

**Structure:**

```typescript
interface EditorialArrangement {
  threads: EditorialThread[];
  claimAssignments: Map<string, string[]>; // claimId → threadIds
  passageAssignments: Map<string, string[]>; // passageId → threadIds
}

interface EditorialThread {
  id: string;
  title: string;
  description: string;
  claimIds: string[];
  order: number;
}
```

**Purpose:**

- LLM organizes claims + passages into semantic threads
- Header displays threads as navigation breadcrumbs
- Grid filters/reorganizes based on selected thread
- User reads evidence organized by theme, not arbitrary order

---

That's the updated architecture.

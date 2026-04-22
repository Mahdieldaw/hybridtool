# @ui/instrument — file digest (current implementation)

---

## Overview

`@ui/instrument` is the **decision map and geometric instrumentation layer** — a rich, interactive diagnostic UI that renders multi-layered analysis of the pipeline's interpretation, provenance, geometry, and semantic mapper output. It orchestrates visualization of claims, statements, regions, and structural analysis through a **tabbed sheet interface** with synchronized state management.

The architecture is organized into **three layers**, each with distinct responsibilities:

1. **Layer 1: Instrumentation Cards** — Diagnostic cards measuring specific pipeline aspects (geometry, density, provenance, risk)
2. **Layer 2: Orchestration & Coordination** — DecisionMapSheet, state management, column systems, and evidence tables
3. **Layer 3: UI Display & Visualization** — Canvas, narrative panels, detail drawers, and interactive visualizations

---

# LAYER 1: INSTRUMENTATION CARDS

Diagnostic cards and structural display components that measure and visualize specific pipeline layers.

## CardBase.tsx

Reusable card wrapper: title bar, collapse/expand, tooltip legend, copy-to-clipboard.

**Features:**

- Collapsible header with icon and description
- Styled container with rounded borders and subtle shadows
- Legend row for metrics/categories
- Copy button for card content (markdown or raw data)

---

## Diagnostic Cards Subdirectory (cards/)

Ten visualization cards, each focusing on a specific pipeline layer or measurement. All exported from [cards/index.ts](cards/index.ts).

### SubstrateSnapshotCard.tsx

Comprehensive substrate and basin topology snapshot with geometry confidence gates.

**Content:**

- Substrate health: nodeCount, edgeCount, mutual rank distribution, participation rate
- Basin topology: basin count, largestBasinRatio, bayesian profile confidence
- Geometric gates: discriminationRange gate, bayesian gate, mutual participation gate
- Lens duality cross-tab: basin vs region cell coverage, dominant cell fraction
- Corpus mode classification (dominant-core | parallel-cores)

### GeometryCard.tsx

Pairwise similarity field analysis and mutual recognition graph topology.

**Content:**

- Pairwise similarity histogram with markers (μ, μ-σ, μ+σ, T_v threshold) and statistics (μ, σ, P10, P90, D discrimination range, T_v)
- Mutual recognition graph: edges count, participating nodes, component connectivity
- Per-node degree distribution histogram
- Components table: connected component sizes and percentages
- Per-node details: isolation score, mutual rank degree

### BayesianBasinCard.tsx

Bayesian change-point detection results for basin partition with per-node statistical profiles. Detects structural breaks in the pairwise similarity field and assigns nodes to basins with posterior concentration measurements.

**Content:**

- **Status Header** — Bayesian algorithm status (ok | no_basin_structure | diagnostic_mode) with color coding
- **Bayesian Summary** — Basins count, total node count, boundary ratio (% nodes with detected changepoint), median boundary similarity (T_v), mean concentration (posterior tightness), T_v threshold value
- **Basin Partition Table** — Per-basin metrics: ID, node count, trench depth (max cross-boundary similarity; lower = cleaner separation)
- **Per-Node Bayesian Profiles** — Detailed node-level statistics: Node ID, log Bayes Factor (evidence for boundary at node; >1 strong, >0 weak), boundary similarity (cross-boundary threshold), posterior concentration (tightness of in-group similarities)

### ClaimDensityCard.tsx

Gate diagnostics, per-claim density metrics, and passage routing classification. Measures how claim statements concentrate in passages and routes claims based on concentration/density gates.

**Content:**

- **Gate Diagnostics** — μ(conc) mean concentration ratio, σ(conc) concentration std dev, threshold (concentration gate μ−σ floored at 0.5), precondition pass count (claims passing majority paragraph filter)
- **Landscape Position Summary** — Count breakdown by position: northStar (both gates), mechanism (density only), eastStar (concentration only), floor (neither). Shows conflict clusters and passage-routed claim counts
- **Claim Density Table** — Per-claim metrics: label, paras (total paragraph count), maj (majority-owned paragraphs), pass# (passage count), maxLen (longest contiguous run), spread (distinct models), mPass (models with ≥2-para passages), stmts (total statements), μCovg (mean per-paragraph coverage), q_dist (query distance to user query)
- **Expandable Per-Claim Detail** — Passages breakdown table showing model, range (¶start–¶end / total), length; per-model summary (paragraph count, passage count, kind)
- **Passage Routing Classification Table** — Claim label, landscape position (northStar|mechanism|eastStar|floor), concentration% (ratio), density% (ratio), structural contributors (count), load-bearing flag, skip-survey status

### BlastRadiusCard.tsx

Multi-component risk analysis: blast surface risk vectors, mixed-parent resolution direction test, statement classification, triage engine (twin map), and routing classification for selected claims.

**Content:**

- **Blast Surface — Risk Vectors** — Per-claim risk analysis table with columns: K (canonical statement count; denominator for risk), RΣ (risk total = Del + Deg; exclusive statement count), Del (deletion risk; Type 2 non-orphan statements fully removed), Deg (degradation risk; Type 3 orphan statements skeletonized), Frag (cascade fragility; Σ 1/(parentCount−1) over shared statements), Iso (isolation; (Del+Deg)/K fraction), OC (orphan character; Deg/(Del+Deg) fraction), DD (deletion damage; twin gap sum), GD (degradation damage; noun loss sum), TD (total damage; DD+GD ranking value), 2a (certainty unconditional; twin unclassified), 2b (certainty conditional; twin shared multi-parent), 2c (certainty fragile; twin exclusive to host)
- **Mixed-Parent Resolution (Direction Test)** — Summary section with aggregate statistics (mixed total count, mixed ratio %, protection rate %), outcome breakdown (protected/removed/skeletonized counts), and stacked visualization; per-claim expandable sections showing statement-level direction test resolution with twin parent information
- **Statement Classification** — Stacked bar visualization and breakdown table showing claim coverage (primary single-claim / supporting multi-claim / unclaimed), total statements, and coverage percentage
- **Triage Engine (Twin Map)** — Statement fate counts (protected with surviving parents, untriaged unclaimed, skeletonized stranded no twin, removed stranded with surviving twin) plus twin map metadata (total statements processed, statements with twins, twin coverage ratio, mean similarity threshold τ)
- **Routing (Selected Claim)** — Category badge showing routing outcome (conflict/isolate/passthrough/unknown) with context-specific details: conflict clusters edges and cross-pool proximity, isolate metrics (total damage, support ratio, query distance), or passthrough consensus indicator
- **Survey Axes** — List of survey axes (if present) with ID, representative claim, and max blast radius value

### ClaimStatementsCard.tsx

Canonical roster of claim-statement assignments showing statement ownership, exclusivity, sharing, and twin relationships.

**Content:**

- **Summary** — Claims count, unique statements count, exclusive assignments (statements owned by only one claim), shared assignments (multi-parent statements), and coverage percentages
- **Claim Statement Roster** — Per-row (claim, statement) pair with columns: Claim (claim label), Statement (statement text), Excl (yes/no exclusivity flag), Shared (count of other claims owning this statement), Fate (primary single-claim / supporting multi-claim / unclaimed), Twin (twin statement text from blast surface), τ (twin similarity; cosine distance), Cert (2a unconditional unclassified / 2b conditional shared / 2c fragile exclusive), Twin Host (claim owning the twin statement or "unclassified" if orphan)

### PassageOwnershipCard.tsx

Per-model passage display with claim ownership highlighting. Shows which passages (paragraphs/text regions) contain statements owned by a selected claim.

**Content:**

- Claim selector dropdown (from claimDensity profiles)
- Per-model accordion panels showing paragraphs
- Coverage visualization: owned statements (blue), passage paragraphs (amber), covered paragraphs (gray)
- Statement ownership tracking from claimProvenance index
- Copy button for passage/claim ownership export

### RegionsCard.tsx

Topological regions from geometric pre-semantic segmentation showing connected components and coverage distribution.

**Content:**

- **Summary** — Total region count, aggregate coverage percentage (fraction of nodes assigned to regions)
- **Region Breakdown** — Per-region table with columns: Region (ID), Nodes (node count in region), % (percentage of total node count)

### StatementClassificationCard.tsx

Statement classification coverage and claim assignment distribution.

**Content:**

- Claimed vs unclaimed statement counts
- Unclaimed groups (statements not assigned to any claim)
- Per-claim statement roster with passage membership
- Passage vs non-passage split among claimed statements
- Multi-claim statements (statements assigned to multiple claims)

### PeripheralNodeCard.tsx

Peripheral node detection from passage routing with outlier classification and basin membership.

**Content:**

- Peripheral node IDs excluded from dominant-core routing
- Outlier classification: minority basin nodes, gap singletons, isolated nodes
- Basin/region membership per node
- Exhaustive outlier map: all potential periphery candidates with filtering
- Node-to-basin mapping from routing diagnostics

---

## Structural Display Components

Three tightly-focused components for rendering structural classification and health metrics. These are slightly separated visually as they form a cohesive diagnostic summary layer.

### MetricsRibbon.tsx

Displays dual-signal instrumentation comparing mapper analysis against geometric analysis. Shows conflicts, consensus, hub identification, and fragmentation—revealing agreement or divergence between structural inference (graph) and spatial geometry.

**Role in Three-Layer Architecture:**

- **Layer:** Display layer (UI visualization of Layer 1 data)
- **Reads From:** StructuralAnalysis (claims, patterns, graph topology) and MapperArtifact (passageRouting, conflict validation, geometry)
- **Consumed By:** Instrument panels; standalone metric display
- **Responsibility:** Synthesize mapper and geometry signals into scannable health indicators; reveal structural consensus or conflict

**Dual Signals Rendered:**

1. **Conflicts (Mapper vs Geometry)**
   - `structConflicts` — Conflicts labeled by mapper (patterns.conflicts + patterns.tradeoffs)
   - `geoConflicts` — Validated conflicts detected via geometry (validatedConflicts with validated=true)
   - `geoOnly`, `mapperOnly` — Exclusive detections (geometry finds what mapper missed, or vice versa)
   - `conflictsAgree` — Boolean: do both systems agree on conflict presence?

2. **Consensus Shape (Support Ratio vs Passage Spread)**
   - `highSupportPct` — Percentage of claims with high support (isHighSupport flag)
   - `passageBacked` — Claims in northStar or mechanism positions (strong passage routing)
   - `passageWeak` — Claims in eastStar or floor positions (weak passage routing)

3. **Hub / Load-Bearing Claim (Graph Topology vs Passage Concentration)**
   - `hubId`, `hubLabel`, `hubZ` — Graph hub claim (hubClaim from graph) with dominance score
   - `geoHubId`, `geoHubLabel`, `geoHubConcentration` — Passage-based hub (highest concentrationRatio)
   - `hubAgree` — Boolean: do mapper and geometry identify the same hub?

4. **Fragmentation (Graph Components vs Geometric Regions)**
   - `componentCount` — Number of connected components in claim graph
   - `regionCount` — Number of geometric regions (preSemantic.regions)

**Visual Design:**

- **DualRow Layout** — Label + two cells (mapper | geometry) with optional agreement indicator (✓ or ⚠)
- **DualCell Pairs** — Dimension label (dim) + value; metrics aligned side-by-side for easy comparison
- **Agreement Indicator** — Emerald ✓ when both systems agree; amber ⚠ when they diverge
- **Expandable Details** — Details button toggles full metric view (evidence, layers, paragraphs, substrate, dual-signal breakdown)

**Interactive Behaviors:**

- **Show/Hide Details** — Toggle button reveals structured evidence, layers, paragraph/substrate metadata, and detailed dual-signal breakdown
- **Hover Tooltips** — Dimension labels and values explain mapper vs geometry terms
- **Null Handling** — Displays "—" when geometry data unavailable (passageRouting not computed)

**Implementation Details:**

- `extractGeometric()` pulls passageRouting, validatedConflicts, and preSemantic from artifact via type assertion (auto-forwarded fields not typed)
- `computeDualSignals()` performs 4-pass analysis: conflicts, consensus, hub, fragmentation; returns null values when data missing
- `useMemo` caches dual signals keyed on analysis + artifact
- DualRow and DualCell are presentational components; MetricsRibbon handles all business logic

---

### StructuralSummary.tsx

Describes the structural shape and notable patterns of the analysis through natural-language summary lines. Renders primary layer shape, residual layer (if present), and secondary patterns (keystone, chain, conditional) using template-driven text generation.

**Role in Three-Layer Architecture:**

- **Layer:** Display layer (renders Layer 1 structural analysis data)
- **Reads From:** StructuralAnalysis (layers array, claimsWithLeverage, patterns), ProblemStructure (patterns)
- **Consumed By:** MetricsRibbon details, card sidebars, diagnostic panels
- **Responsibility:** Translate structural analysis layers and patterns into human-readable sentences that capture the shape and nuance of the problem structure

**Summary Lines Generated:**

1. **Primary Shape Line** (from layers[0])
   - **Convergent:** "X of Y models land on 'claim label'" (single convergent); "Convergence around 'X' — 'A' and 'B' alongside" (cluster)
   - **Forked:** "Models split N–M: 'claim A' over 'claim B'" (split ratio and preference)
   - **Constrained:** "'Claim A' rivals 'Claim B' — backing one undercuts the other" (tradeoff dynamic)
   - **Parallel:** "'Claim A' and 'Claim B' are unrelated besides all drawing support" (independent positions)
   - **Sparse:** "No dominant pattern. Attention spread thin across N positions." (fragmentation)

2. **Residual Layer Appended** (if layers[1] exists and is not 'sparse')
   - Reuses describeLayer with `isResidual=true` to generate "alongside" clause
   - Examples: "alongside" for convergent residual; "secondary split" for forked; "in tradeoff alongside" for constrained; "independent views alongside" for parallel

3. **Secondary Pattern Line** (from problemStructure.patterns or analysis.patterns, prioritized)
   - **Keystone:** "'Claim X' is a structural hub — N dependencies pass through it" (load-bearing role)
   - **Chain:** "N-step dependency chain [— M step(s) traced by only one model]" (causal sequence + weak link detection)
   - **Conditional:** "Context-dependent branches — answer depends on your specific situation" (branch logic)

**Visual Design:**

- **Summary Lines** — Array of objects (icon, text, color) rendered as flex rows with icon + colored text
- **Icons** — Shape-based: ✓ (convergent), ⚡ (forked), ⚖️ (constrained), ∥ (parallel), ○ (sparse), ◆ (keystone), → (chain), ⑂ (conditional)
- **Color Coding** — Shape color (emerald/red/orange/purple/gray/purple/blue/emerald) applied to text
- **Fallback Message** — "Models explored multiple angles — not enough signal for a clear shape." when no layers or patterns found

**Template Coverage:**

- `describeLayer()` — Maps layer type + claim labels + support counts → descriptive sentence
- `buildShapeLine()` — Chains primary + residual descriptions with semantic connector
- `buildPatternLine()` — Selects highest-priority secondary pattern and generates one-line summary
- Pattern priority: keystone (0) > chain (1) > conditional (2)

**Implementation Details:**

- All shape descriptions data-driven from layer.causalClaimIds, layer.involvedModelCount, layer.totalModelCount, claim labels
- `claimMap` memoized per analysis to avoid repeated lookups
- Template strings use conditional logic to handle 0/1/2/3+ claim lists (e.g., single claim quoted, two claims joined with "and", 3+ use commas + "more")
- Fallback values for missing claim labels: uses claimId directly
- No icon rendering or styling; component is pure text generation

---

### StructureGlyph.tsx

Interactive SVG visualization of primary structural shape and optional residual (secondary layer) shape. Renders abstract diagrams encoding convergence, forking, constraints, parallelism, or sparsity using positioned circles, lines, and arrows.

**Role in Three-Layer Architecture:**

- **Layer:** Display layer (visual encoding of Layer 1 structural shape)
- **Reads From:** PrimaryShape (convergent | forked | constrained | parallel | sparse), residualPattern (second layer shape, optional), claimCount
- **Consumed By:** Instrument UI, shape selection interfaces, diagnostic summary cards
- **Responsibility:** Provide O(1) visual shape lookup so structural topology is immediately recognizable without reading text

**Primary Shape Renderings:**

1. **Convergent**
   - Central hub circle + satellite circles around it at radius ~30% of canvas
   - Lines/arrows pointing from satellites → hub (convergence arrows, green)
   - Circle gradient/opacity shows hub prominence
   - Dashed circle overlay marks influence radius
   - Encodes: "multiple claims converging on central idea"

2. **Forked**
   - Left cluster (base ~25% x-axis) and right cluster (75% x-axis)
   - Circles distributed vertically in each cluster
   - Dashed line across center with bidirectional arrows (red)
   - Encodes: "two competing positions splitting attention"

3. **Constrained**
   - Left main node (20% x) and right main node (80% x) on baseline
   - Satellite nodes between them, positioned above (bulge/arc pattern)
   - Curved path from left → right (orange dashed)
   - Bidirectional arrows on connecting line
   - Encodes: "rival positions with tradeoff dynamic"

4. **Parallel**
   - 2–3 independent clusters arranged in 2D space (top-left, bottom-right, top-center)
   - Vertical/horizontal grid lines (faint) showing independence
   - Each cluster shown as circle collection with dashed boundary
   - Encodes: "multiple independent positions coexisting"

5. **Sparse**
   - Scattered nodes (7 positions), no clear clustering
   - Centered "?" glyph
   - Encodes: "no dominant pattern; fragmented attention"

**Residual Layer Mini-Shape:**

- If `residualPattern` provided, renders 32×32px mini shape in bottom-right corner
- Uses same shape vocabulary (convergent, forked, constrained, parallel, sparse) at reduced scale
- 2–3 simplified nodes per shape to maintain clarity
- "L2" label in top-left corner of mini box
- Encodes: "secondary structural layer alongside primary"

**Visual Design:**

- **Node Sizing:** Primary nodes 3–7px radius; hub nodes larger (7px); satellite/supporting smaller (3–4px)
- **Arrow Markers:** SVG marker definitions (blue, red, orange, green) point to/from nodes
- **Stroke Patterns:** Solid for main topology, dashed for influence/constraint areas
- **Color Palette:** Green (convergent), red (forked), orange (constrained), purple (parallel), gray (sparse)
- **Opacity Levels:** Active elements 0.7–0.9; background/influence 0.15–0.4

**Interactive Behaviors:**

- **Hover Overlay** — Gradient overlay appears on hover; "Click to explore →" message
- **Click Handler** — Calls `onClick` callback (parent can open detail drawer or navigate)
- **Title Tooltip** — SVG title attribute shows pattern name and residual (if present)
- **Responsive Sizing** — Default 120×80px; configurable via width/height props

**Implementation Details:**

- `renderPrimaryShape()` — Switch on pattern; generates `<g>` with circles, lines, markers
- `renderMiniShape()` — Simplified shape at 32px in transform group; placed at bottom-right offset
- Position generators (`getConvergentPositions`, `getForkedPositions`, etc.) compute node layout deterministically from claimCount
- visibleNodes capped to 6–8 depending on pattern (prevents clutter)
- Marker IDs use `React.useId()` with colon replacement for SVG safety
- SVG viewBox and overflow-visible allow larger shapes without layout shift

**Size & Scalability:**

- Default: 120px wide × 80px tall
- Scales linearly with width/height props
- Cluster radius and node spacing scale with canvas dimensions (% of width/height)
- VisibleNodes auto-capped based on claimCount to maintain clarity

---

# LAYER 2: ORCHESTRATION & COORDINATION

Master coordinator, state management, and data systems for evidence tables and column registry.

## DecisionMapSheet.tsx

Main orchestrator and tabbed decision map interface. Renders the modal/drawer that contains all diagnostic layers and manages all state coordination.

**Role:**

- Manages tab selection (`'graph' | 'narrative' | 'options' | 'space' | 'shadow' | 'json'`)
- Orchestrates card layout and state coordination
- Integrates evidence table, narrative panel, claim drawers, and context strips
- Handles column picker, view selector, and filtering UI

**Key Capabilities:**

- **Tab Router** — Switches between graph visualization, narrative, options panel, paragraph space, shadow/evidence table, and raw JSON
- **Evidence/Paragraph Tables** — Synced virtualized tables with sortable/filterable columns
- **Column Registry Integration** — Dynamic column picker and view presets (DEFAULT_VIEWS, PARAGRAPH_VIEWS)
- **Claim Interactions** — Claim detail drawer, centroid overlay, centrality-based filtering
- **Gesture Handling** — Pan, zoom, hover highlighting in paragraph space view
- **Context Strip** — Quick metadata summary (counts, densities, gate verdict)
- **State Hooks** — `useInstrumentState`, `useEvidenceRows`, `useParagraphRows`, `useClaimCentroids`

**Output:** Full diagnostic modal with synchronized table/map interactions.

---

## State Management

Hooks and utilities for tracking UI state, evidence derivation, and interactive selections.

### useInstrumentState

Central state hook managing:

- Current tab selection
- Visible columns and view presets
- Filter expressions and sorting state
- Hover highlights and selected claim
- Visualization toggles (mutual edges, claims, risk glyphs, basin zones, labels)
- Mapper provider selection

### useEvidenceRows / useParagraphRows

Derives table rows from artifact:

- **useEvidenceRows** — Flattens statements into evidence rows with all computed columns
- **useParagraphRows** — Groups statements per paragraph; computes paragraph-level metrics

Both apply column filters via expression engine and preserve sort state.

### useClaimCentroids

Memoized centroid calculations per claim for paragraph space visualization. Triggers re-layout only when claims or embeddings change.

---

## Column Systems & Expression Engine

Dynamic column definitions, safe expression evaluation, and view presets.

### column-registry.ts

Dynamic column system: definitions, formatters, and view presets.

**ColumnDef Interface:**

```typescript
{
  id: string;                    // unique column key
  label: string;                 // UI label
  accessor: (row) => any;        // value extractor
  type: 'number' | 'text' | 'category' | 'boolean';
  format?: (val) => string;      // optional formatter
  sortable: boolean;
  groupable: boolean;
  description?: string;          // tooltip
  source: 'built-in' | 'computed';
  category: 'identity' | 'geometry' | 'continuous' | 'mixed' | 'blast' | 'density' | 'metadata';
}
```

**Built-In Columns:**

- **Identity:** statementId, text, model, paragraphId, claimId
- **Geometry:** paragraphId, regionId, basinId, isolationScore, mutualRankDegree
- **Continuous:** querySimilarity, provenanceBulk, exclusivityRatio, blastRadius, claimDensity
- **Mixed:** zone (core/removed), fate (primary/supporting/peripheral), allegiance (tier)
- **Blast:** blastRadius, cascadeRisk, twinCount
- **Density:** statementsPerPassage, concentrationRatio, dominantModel
- **Metadata:** modelIndex, sourceStatementId

**View Presets:**

- `DEFAULT_VIEWS` — Pre-configured column sets (e.g., identity, all columns, geometry-focused, provenance-focused)
- `PARAGRAPH_VIEWS` — Per-paragraph row views
- `DEFAULT_VIEW_MAP`, `PARAGRAPH_VIEW_MAP` — Lookup for quick switching

**Formatters:**

- `fmtNum(digits)` — Fixed-point number formatter
- `getProviderAbbreviation(providerId)` — Model abbrev (e.g., 'gpt4' → 'G4')

---

### expression-engine.ts

Safe, sandboxed expression evaluator for column filtering and computed values.

**Supported Syntax:**

- **Literals:** Numbers (42, 3.14), strings ("hello"), booleans (true, false)
- **Operators:** +, -, *, /, %, >, <, >=, <=, ===, !==, &&, ||, !
- **Ternary:** `condition ? yes : no`
- **Functions:** sum(), min(), max(), avg(), count()
- **Column References:** `[columnId]` (e.g., `[querySimilarity] > 0.5`)

**No eval()** — Full tokenizer → parser → interpreter pattern. Safe to run untrusted expressions from UI.

**API:**

```typescript
evaluateExpression(expr: string, row: EvidenceRow): any
```

Used by EvidenceTable for threshold filters and computed column expressions.

---

### ColumnPicker.tsx

UI for selecting/deselecting columns and saving view presets.

**Features:**

- **Category Grouping** — Columns organized by identity, geometry, continuous, etc.
- **Checkbox Selection** — Toggle column visibility
- **View Presets** — Dropdown to apply pre-configured view sets
- **Custom View Save** — Save current selection as new view preset
- **Persistence** — View selection stored in instrument state (survives reload)

---

## Evidence & Paragraph Tables

High-performance virtualized table system with sorting, filtering, and grouping.

### EvidenceTable.tsx

High-performance virtualized table for evidence/statement display. Supports sorting, filtering, grouping, and custom column expressions.

**Features:**

- **Virtualization** — @tanstack/react-virtual for 1000+ rows at 60fps
- **Sorting** — Click column headers; preserve sort state across filters
- **Filtering** — Expression-based thresholds (>, <, >=, <=, ===, !==, contains, is-null, not-null)
- **Grouping** — Collapse/expand groups by category (e.g., model, zone, fate)
- **Column Expressions** — Safe evaluator (`expression-engine.ts`) for computed columns (e.g., `querySimilarity > 0.5 ? 'high' : 'low'`)
- **Color Zones** — Core (emerald), removed (rose), unclassified (gray)
- **Copy Integration** — Copy rows or entire table as markdown/TSV

**Input:**

- `rows` — Array of evidence rows (statements or paragraphs)
- `columns` — Column definitions with accessors and formatters
- `onRowHover` — Callback for hover highlighting
- `onPrimaryChange` — Callback when user marks a statement as primary

**Output:** Rendered table with sticky header, footer row count, and inline copy button.

---

### ToggleBar.tsx

Control panel for paragraph space visualization toggles.

**Toggles:**

- **Mutual** — Show mutual-rank edges (graph edges)
- **Claims** — Show claim centroids (diamond glyphs)
- **Risk Glyphs** — Show cascade risk indicators (disabled if claims hidden)
- **Basin** — Show basin zones (basin inversion topology)
- **Labels** — Show paragraph IDs on nodes

**Conditional Disabling:**

- Risk glyphs disabled if claims not shown
- Basin toggles disabled if no basin data available

---

# LAYER 3: UI DISPLAY & VISUALIZATION

Interactive visualizations, detail panels, and narrative rendering.

## Visualization Components

### ParagraphSpaceView.tsx

Interactive 2D visualization of paragraph embeddings and statement geometry.

**Features:**

- **Canvas Rendering** — UMAP layout coordinates with pan/zoom/hover
- **Node Glyphs** — Circles (paragraphs), diamonds (claims), zones (colors)
- **Edge Rendering** — Mutual-rank edges, claim centroids
- **Risk Visualization** — Cascade risk glyph system (size = depth, color = severity)
- **Hover State** — Highlight connected nodes and statements
- **Gesture Handlers** — Pan, zoom, click navigation

**Input:**

- `artifact` — Full cognitive artifact (geometry, claims, provenance)
- `instrumentState` — Visualization toggles (showMutualEdges, showClaimDiamonds, etc.)
- `selectedParagraphId` — Highlighted node

**Output:** Interactive canvas with hover callbacks and click handlers.

---

### CrossSignalComparePanel.tsx

Scatter plot comparing two metrics (e.g., provenanceBulk vs. blastRadius).

**Features:**

- **Axis Selection** — Dropdown to swap X/Y axes; layer-specific defaults
- **Scatter Rendering** — Claims plotted per selected axes
- **Pearson Correlation** — Computed on visible claims; displayed as subtitle
- **Hover Highlighting** — Show claim ID and metric values
- **Layer-Aware Defaults** — 'competitive-provenance', 'blast-radius', 'query-relevance' each have preset axis pairs

**Measures Available:**

- provenanceBulk, supportCount, exclusivityRatio, blastRadius, queryRelevance, cascadeRisk, modelCount, densityRatio

---

### ContextStrip.tsx

Quick metric summary bar above tables. Displays counts, densities, and gate verdict.

**Metrics Rendered:**

- Total evidence/paragraph count
- Gate verdict badge (with confidence)
- Claim count and claim density
- Basin count and largest basin ratio
- Region coverage (% of nodes in a region)
- Periphery ratio
- Mini histogram popovers (distribution of key metrics)

**Interactive:**

- Popover histograms for metric distributions
- Color-coded status (emerald for strong, orange for warning, rose for issue)
- Inline copy button for metric snapshot

---

## Detail & Narrative Panels

### NarrativePanel.tsx

Markdown view of semantic mapper narrative output with raw JSON debug toggle.

**Features:**

- **Markdown Rendering** — Formatted narrative text with syntax highlighting
- **Provider Badging** — Shows which provider (model) generated the narrative
- **Raw JSON Toggle** — Expand to show raw CognitiveArtifact JSON
- **Debug Serialization** — Converts Maps, Sets, BigInt to JSON-safe forms
- **Copy Integration** — Copy raw JSON or markdown to clipboard

**Input:**

- `narrativeText` — Formatted narrative markdown
- `artifact` — Full cognitive artifact for JSON export
- `activeMappingPid` — Active mapper provider (for color/badging)
- `rawMappingText` — Optional pre-computed JSON string

---

### ClaimDetailDrawer.tsx

Modal/drawer for detailed claim inspection with supporting evidence.

**Features:**

- **Claim Metadata** — Label, tier, allegiance, leverage score
- **Narrative Excerpt** — Surrounding narrative text (highlighted)
- **SupporterOrbs** — Visual network of supporting statements
- **Edge Classification** — Anchor, branch, challenger, supplement roles
- **Role-Based Coloring** — Color-coded edge types
- **Navigation** — Jump to related claims via onClaimNavigate callback

**Input:**

- `claim` — Claim object with metadata
- `artifact` — Full cognitive artifact for context
- `narrativeText` — Full narrative for excerpt extraction
- `onClose`, `onClaimNavigate` — Navigation callbacks

**Output:** Animated modal with claim details and related evidence.

---

### SupporterOrbs.tsx

Visual representation of claim supporters as orbiting orbs (supporting statements).

**Features:**

- **Orb Layout** — Radial arrangement of statement badges around claim
- **Orb Labels** — Statement text preview; click to open claim detail
- **Color Coding** — Role-based colors (anchor, branch, challenger, supplement)
- **Animation** — Framer Motion entry/exit and orbit animation
- **Hover States** — Highlight orb and parent claim on hover

---

## Utilities & Selectors

### ReferenceSection.tsx

Rendering of reference/source document snippets with metadata.

**Features:**

- **Document Display** — Markdown or plaintext reference snippets
- **Source Attribution** — Document ID, page number, section title
- **Relevance Badge** — Shows query relevance score if available
- **Copy Integration** — Copy reference text or metadata

---

### MapperSelector.tsx

Dropdown selector for choosing which mapper provider's output to view.

**Features:**

- **Provider List** — All available mapping providers with icons/colors
- **Selection State** — Highlights currently-selected provider
- **Conditional Disabling** — Grays out providers with no mapping output
- **Provider Config** — Pulls provider metadata from provider-helpers

---

## index.ts

Public API barrel export. Re-exports all card components and major UI elements.

```typescript
export { GeometryCard, BayesianBasinCard, BlastRadiusCard, ... } from './cards';
export { EvidenceTable } from './EvidenceTable';
export { DecisionMapSheet } from './DecisionMapSheet';
export { ColumnPicker } from './ColumnPicker';
// ... etc
```

---

## Design Patterns & Performance Optimizations

### Virtualization (react-virtual)

- Tables with 1000+ rows rendered in <200ms
- Only visible rows in DOM; off-screen rows unmounted
- Critical for evidence tables with full statement corpora

### Memoization

- Column definitions memoized by useCallback to prevent table re-renders
- Computed accessors cached via useMemo
- Card content memoized to avoid re-layout on state changes

### State Isolation

- `useInstrumentState` manages all UI toggles and selections
- Evidence/paragraph row caching to avoid re-derivation
- Claim centroid calculations memoized

### Expression Engine Caching

- Tokenizer results cached per expression string
- Parser tree reused across multiple row evaluations
- Prevents re-parsing identical filter expressions

### Color & Formatting Strategies

- Static color maps (ROLE_COLORS, ZONE_COLORS, FATE_COLORS) for O(1) lookups
- Formatter functions created once and reused
- CSV/TSV export built from table state (no re-render)

### Gesture Handling (paragraph space)

- Canvas-based rendering (not DOM nodes) for pan/zoom
- Debounced hover highlights to prevent jank
- Batch node position updates on zoom

---

## Data Flow

**Entry:**

1. User clicks "Decision Map" in chat or selects turn
2. `DecisionMapSheet` loads full `CognitiveArtifact` from provider artifact store
3. `useInstrumentState` initializes with defaults (chart tab, all columns, no filters)

**Interaction:**

1. User selects tab (graph, narrative, options, space, shadow, json)
2. Tab router renders corresponding card/table/visualization
3. Evidence/paragraph tables use `useEvidenceRows`/`useParagraphRows` hooks to derive rows
4. Column filters apply expressions via `expression-engine`
5. Claim hovering triggers centroid highlights via `useClaimCentroids`
6. Paragraph space renders interactive canvas with pan/zoom

**Output:**

- Table selections feed back to state (highlighted row, grouped-by category)
- Claim detail drawer opens on row click
- Narrative/JSON panels display via NarrativePanel

---

## Summary of Architecture

**Three-Layer Model:**

- **Layer 1: Instrumentation Cards** — Raw diagnostic measurements (geometry, density, provenance, risk, statements) plus structural display components (metrics ribbon, summary, glyphs)
- **Layer 2: Orchestration** — DecisionMapSheet, state hooks, column systems, expression engine, evidence tables, toggle controls
- **Layer 3: Display** — Canvas-based visualizations, detail drawers, narrative panels, scatter plots, utilities

**Orchestration:**

- DecisionMapSheet is the single entry point; coordinates all sub-components
- Tabbed interface switches between graph/narrative/space/shadow views
- Column registry defines what can be displayed; views define which columns to show

**Rendering Strategy:**

- **Cards** — Static diagnostic summaries (geometry, density, blast radius)
- **Tables** — Virtualized evidence/paragraph rows with dynamic columns
- **Canvas** — Interactive paragraph space (geometry visualization)
- **Markdown** — Narrative panel with raw JSON debug

**Performance:**

- Virtualization for tables
- Memoization for expensive derivations (centroids, row rows)
- Safe expression evaluation (no eval())
- Canvas-based paragraph space for smooth interactions

**Extensibility:**

- Column definitions added to `BUILT_IN_COLUMNS`; view presets added to `DEFAULT_VIEWS`
- New cards imported and rendered in DecisionMapSheet tab router
- Expression engine supports new functions/operators without core changes

---

## Entry Points

- **Full Decision Map:** `<DecisionMapSheet artifact={...} aiTurnId={...} />`
- **Evidence Table Only:** `<EvidenceTable rows={...} columns={...} />`
- **Narrative View Only:** `<NarrativePanel narrativeText={...} artifact={...} />`
- **Individual Card:** `<ClaimDensityCard interpretation={...} />`

All components accept a subset of props; composition is flexible for partial instrumentation UIs.

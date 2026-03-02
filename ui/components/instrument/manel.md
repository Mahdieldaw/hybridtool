# Evidence Console — First Principles Plan

## The Diagnosis

The previous 4-block plan (Pairwise / Claim Affinity / Query Affinity / Derived) was taxonomically correct but ergonomically wrong. It reorganized *instruments by measurement domain*. But your actual workflow isn't "let me look at pairwise geometry" → "now let me look at claim affinity." Your workflow is:

1. Pick a claim
2. See every statement's relationship to it — across every scoring method simultaneously
3. Notice where methods disagree
4. Hypothesize a threshold change
5. Want to see the consequence without rebuilding

That workflow has a natural shape: **a table**. Not a card. Not a histogram. Not a collapsible panel. A table of statements, with columns from every scoring method, sortable, groupable, filterable, and — critically — extensible with computed expressions at runtime.

The 13 tabs, the 4-block plan, the individual cards — they're all organized around *how the system computes*. What you need is organized around *what you're investigating*.

---

## Architecture: Three Layers

### Layer 1: Evidence Table (Primary Surface — 85% of your time)

A single, configurable table that is the instrument panel's main surface.

**Scope modes** (toggle, not tabs):

| Mode | Rows | What it answers |
|---|---|---|
| **Claim-focused** (default) | Statements in/near a selected claim | "What's in this claim's evidence pool and why?" |
| **Cross-claim** | All statements, showing allocation across all claims | "Where is the entropy? Which statements are contested?" |
| **Statement-focused** | Single statement, showing scores against all claims | "Why did this statement land here and not there?" |

When claim-focused (your primary mode), the table shows every statement that *any* method considered for the selected claim — competitive pool, continuous core, mixed candidates, and direct cosine top-N. Statements outside all pools are hidden by default but togglable.

**Column Registry**

Every score the system computes about a statement (globally or relative to a claim) gets registered as a column definition. The table can render any subset of them.

```
IDENTITY COLUMNS (always visible)
  text          — statement text (truncated, expandable)
  model         — model index / provider name
  paragraphId   — parent paragraph

DIRECT GEOMETRY (from artifact paths)
  sim_claim     — cos(stmt_emb, claim_centroid)          # the "Direct" control
  sim_query     — cos(stmt_emb, query_emb)               # query relevance raw

COMPETITIVE §1 (from statementAllocation)
  w_comp        — competitive weight w(S,C)
  excess_comp   — sim - τ_S (excess over threshold)
  τ_S           — per-statement threshold (μ_S + σ_S)
  claimCount    — number of claims this statement is assigned to

CONTINUOUS FIELD (from continuousField)
  z_claim       — (sim_claim - μ_claim) / σ_claim
  z_core        — standardized proximity to core set
  evidenceScore — z_claim + z_core

MIXED PROVENANCE (from mixedProvenance)
  globalSim     — cos(stmt_emb, claim_centroid) [mixed context]
  zone          — core | boundary-promoted | removed
  coreAffinity  — mean cos to core set
  corpusAffinity— mean cos to all statements
  differential  — coreAffinity - corpusAffinity
  paraOrigin    — competitive-only | claim-centric-only | both

METADATA
  fate          — primary | supporting | unaddressed | orphan | noise
  stance        — assertive | prescriptive | cautionary | ...
  isExclusive   — true if statement belongs to only this claim
```

That's ~20 built-in columns. The default view shows 6-8 of them. The rest are one click away in a column picker.

**Default View Configurations**

These are pre-built column+sort+group combinations that load instantly. They replace the current card-per-panel approach.

| View Name | Columns Shown | Grouped By | Sorted By | Replaces |
|---|---|---|---|---|
| **Provenance** (default) | text, model, sim_claim, w_comp, evidenceScore, zone | zone | sim_claim desc | Provenance + Compare cards |
| **Differential** | text, model, globalSim, zone, coreAffinity, corpusAffinity, differential | zone | differential asc | Mixed Provenance card |
| **Allocation** | text, model, claimCount, w_comp, isExclusive, sim_query | claimCount desc | w_comp desc | Competitive Provenance card |
| **Query Alignment** | text, model, sim_query, sim_claim, fate | fate | sim_query desc | Query Relevance card |

The user can modify any default view (add/remove columns, change sort/group), and the modification is session-temporary unless explicitly saved.

**Computed Columns (the Expression Engine)**

A small input field in the column picker where you type:

```
sim_claim - τ_S                    → "excess manual"
z_claim > 1.5 ? 'core' : 'edge'   → "custom zone"
w_comp * sim_query                 → "weighted relevance"
```

Implementation: safe eval over row data. No arbitrary JS — just arithmetic operators, comparisons, ternary, and column references. The expression is applied to every row and appears as a new sortable/groupable column.

This replaces the rebuild-redeploy cycle for testing hypotheses.

**Threshold Previews**

When a derived gate column is visible (zone, fate, claimCount), a small threshold slider appears in the column header. Dragging it live-recomputes the classification for display purposes only (doesn't change the artifact). This lets you answer "what if μ+σ were μ+0.5σ?" visually.

---

### Layer 2: Context Strip (Always Visible — Compact Health Dashboard)

A narrow horizontal bar above the evidence table. Not tabs, not cards — a fixed strip showing the 5-6 numbers that tell you whether the geometry is trustworthy.

```
┌─────────────────────────────────────────────────────────────────────┐
│ D=0.14 ● │ T_v=0.62 │ Part=34% │ Basins=3 │ Q_spread=0.18 │ ok  │
└─────────────────────────────────────────────────────────────────────┘
```

| Metric | Source | What it gates |
|---|---|---|
| **D** (discrimination range) | basinInversion.discriminationRange | < 0.05 = "geometry is noise, don't trust scores below" |
| **T_v** (valley threshold) | basinInversion.T_v | Natural separation between related/unrelated |
| **Participation** | % nodes with mutualDegree > 0 | < 5% = "no structure" |
| **Basins** | basinInversion.basinCount | Expected ~ claim count |
| **Q_spread** | P90-P10 of query relevance | Low = query isn't discriminating |
| **Status** | Pipeline gate verdict | ok / marginal / undifferentiated / skip |

Color-coded: green (healthy), amber (marginal), red (degraded). Clicking any metric opens a detail popover with the relevant histogram — NOT a full panel switch.

This replaces the Substrate, Mutual Graph, and Basin Inversion cards as primary surfaces. Those cards still exist (see Layer 3) but you only need them for rare deep investigation.

---

### Layer 3: Reference Shelf (Collapsible — 15% of your time)

Below the evidence table, a set of collapsible sections for mechanism-specific deep dives. These are the existing cards, minimally modified, but demoted from primary surface to reference material.

```
▸ Pairwise Geometry          (SubstrateCard + per-node isolation)
▸ Mutual Graph & Regions     (MutualGraphCard)
▸ Basin Inversion             (BasinInversionCard)
▸ Model Ordering              (ModelOrderingCard)
▸ Blast Radius                (BlastRadiusCard)
▸ Carrier Detection           (CarrierDetectionCard)
▸ Cross-Signal Scatter        (CrossSignalComparePanel)
▸ Alignment                   (AlignmentCard)
▸ Raw Artifacts               (JSON dump)
```

Each section renders its existing card component unchanged. The only modification is wrapping them in a collapsible container with a summary line.

---

## Layout

```
┌──────────────────────────────────────────────────────────────────────┐
│ CONTEXT STRIP                                                        │
│ D=0.14 ● │ T_v=0.62 │ Part=34% │ Basins=3 │ Q_spread=0.18 │ ok    │
├──────────────────────────────────────────────────────────────────────┤
│ ┌────────────────────────────────────────────────────┐               │
│ │ [Claim: "Use caching for read-heavy workloads" ▾]  │               │
│ │ [View: Provenance ▾] [Scope: Claim ▾]              │               │
│ │ [+ Column]  [Group: zone ▾]  [Filter...]           │               │
│ └────────────────────────────────────────────────────┘               │
│                                                                      │
│ ┌──────────────────────────────────────────────────────────────────┐ │
│ │ EVIDENCE TABLE                                                    │ │
│ │                                                                    │ │
│ │ ── core (12 statements) ──────────────────────────────────────── │ │
│ │ text              │ M │ sim   │ w_comp │ eScore │ zone          │ │
│ │ "Redis provides…" │ 3 │ 0.71  │ 0.23   │ 2.4    │ core          │ │
│ │ "For read-heavy…" │ 1 │ 0.69  │ 0.21   │ 2.1    │ core          │ │
│ │ "Caching layers…" │ 5 │ 0.68  │ 0.19   │ 1.9    │ core          │ │
│ │                                                                    │ │
│ │ ── boundary-promoted (4 statements) ─────────────────────────── │ │
│ │ "Consider CDN…"   │ 2 │ 0.54  │ 0.08   │ 0.6    │ boundary-pro  │ │
│ │                                                                    │ │
│ │ ── removed (8 statements) ───────────────────────────────────── │ │
│ │ "Database indexi…" │ 4 │ 0.41  │ —      │ -0.3   │ removed       │ │
│ │                                                                    │ │
│ └──────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│ ▸ Pairwise Geometry                                                  │
│ ▸ Basin Inversion                                                    │
│ ▸ Model Ordering                                                     │
│ ▸ Blast Radius                                                       │
│ ▸ Carrier Detection                                                  │
│ ▸ Cross-Signal Scatter                                               │
│ ▸ Raw Artifacts                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Data Model

### The Unified Row

Every statement in the corpus gets a unified row object computed once when the instrument panel opens (or when claim selection changes for claim-relative fields).

```typescript
interface EvidenceRow {
  // Identity
  statementId: string;
  text: string;
  modelIndex: number;
  paragraphId: string;
  
  // Direct geometry (claim-relative)
  sim_claim: number | null;        // cos(stmt, claim_centroid)
  
  // Query geometry (global)  
  sim_query: number | null;        // cos(stmt, query)
  
  // Competitive §1 (claim-relative)
  w_comp: number | null;           // competitive weight
  excess_comp: number | null;      // excess over threshold
  tau_S: number | null;            // per-statement threshold
  claimCount: number;              // how many claims own this statement
  
  // Continuous field (claim-relative)
  z_claim: number | null;
  z_core: number | null;
  evidenceScore: number | null;
  
  // Mixed provenance (claim-relative)
  globalSim: number | null;
  zone: 'core' | 'boundary-promoted' | 'removed' | null;
  coreAffinity: number | null;
  corpusAffinity: number | null;
  differential: number | null;
  paraOrigin: 'competitive-only' | 'claim-centric-only' | 'both' | null;
  
  // Metadata
  fate: string | null;
  stance: string | null;
  isExclusive: boolean;
  
  // Inclusion flags (which methods included this statement)
  inCompetitive: boolean;
  inContinuousCore: boolean;       // z_claim > 1.0
  inMixed: boolean;                // zone !== 'removed'
  inDirectTopN: boolean;           // sim_claim in top-N
}
```

This row is assembled from multiple artifact paths:

| Field group | Artifact source |
|---|---|
| sim_claim | `continuousField.perClaim[claimId].field[stmtId].sim_claim` |
| sim_query | `geometry.query.relevance.statementScores[stmtId].simRaw` |
| w_comp, excess, tau | `statementAllocation.perClaim[claimId].directStatementProvenance[stmtId]` |
| claimCount | `statementAllocation.assignmentCounts[stmtId]` |
| z_claim, z_core, evidenceScore | `continuousField.perClaim[claimId].field[stmtId]` |
| globalSim, zone, differential, etc. | `mixedProvenance.perClaim[claimId].statements[]` |
| fate | `completeness.statementFates[stmtId]` |
| stance | `shadow.statements[stmtId].stance` |

### Column Definition

```typescript
interface ColumnDef {
  id: string;
  label: string;
  accessor: (row: EvidenceRow) => string | number | boolean | null;
  type: 'number' | 'text' | 'category' | 'boolean';
  format?: (val: any) => string;        // e.g., 3 decimal places
  sortable: boolean;
  groupable: boolean;                    // only category/boolean columns
  description?: string;                  // tooltip
  source: 'built-in' | 'computed';
}
```

### View Configuration

```typescript
interface ViewConfig {
  id: string;
  label: string;
  columns: string[];              // column IDs to show
  sortBy: string;                 // column ID
  sortDir: 'asc' | 'desc';
  groupBy: string | null;         // column ID (must be groupable)
  filter?: FilterRule[];          // optional persistent filters
}
```

### Computed Column

```typescript
interface ComputedColumn {
  id: string;                     // auto-generated: 'custom_1', 'custom_2'
  label: string;                  // user-provided
  expression: string;             // e.g., 'sim_claim - tau_S'
  type: 'number' | 'category';   // inferred or specified
}
```

---

## What the Expression Engine Needs to Support

Not a full JS interpreter. A safe subset:

**Operators**: `+`, `-`, `*`, `/`, `%`, `>`, `<`, `>=`, `<=`, `===`, `!==`, `&&`, `||`, `!`

**Functions**: `Math.abs()`, `Math.max()`, `Math.min()`, `Math.round()`

**Ternary**: `condition ? valueA : valueB`

**Column references**: Any column ID used as a variable name resolves to `row[columnId]`

**Null handling**: Any expression involving a null column value returns null (propagating nulls, not crashing)

Implementation: parse expression into AST at definition time, evaluate per-row. No `eval()`. Libraries like `expr-eval` or `mathjs` handle this cleanly.

---

## What This Replaces and What Survives

### Replaced (as primary surfaces)

| Current Panel | Replaced By |
|---|---|
| Competitive Provenance card | "Provenance" default view + "Allocation" default view |
| Continuous Field card | "Provenance" default view (evidenceScore, z_claim columns) |
| Compare card (direct/comp/continuous) | "Provenance" default view shows all three side-by-side as columns |
| Mixed Provenance card | "Differential" default view |
| Query Relevance card | "Query Alignment" default view + context strip Q_spread |
| Substrate card | Context strip D/Participation + Reference Shelf |
| Basin Inversion card | Context strip T_v/Basins + Reference Shelf |

### Survives unchanged (in Reference Shelf)

| Card | Why it survives |
|---|---|
| MutualGraphCard | Graph topology is a different investigation (not row-based) |
| ModelOrderingCard | Per-model view, not per-statement — different unit |
| BlastRadiusCard | Per-claim composite, consumed by survey gating |
| CarrierDetectionCard | Post-traversal logic, different pipeline stage |
| CrossSignalComparePanel | Scatterplot — visual, not tabular |
| AlignmentCard | Region coverage — different unit |
| Raw Artifacts | JSON dump, always needed |

### New

| Component | What it does |
|---|---|
| Context Strip | Compact health bar replacing 3 cards as entry surfaces |
| Evidence Table | The main investigation surface |
| Column Picker | Drawer/popover to add/remove/compute columns |
| Threshold Preview | Interactive slider on derived-gate columns |
| View Switcher | Dropdown to switch between default view configurations |

---

## Implementation Sequence

### Phase 1: The Row Assembler (foundation — no UI changes yet)

Create `useEvidenceRows(artifact, selectedClaimId)` hook that:
1. Reads all artifact paths listed above
2. Assembles `EvidenceRow[]` for every statement in the shadow corpus
3. Fills claim-relative fields when a claim is selected (null otherwise)
4. Memoizes aggressively — only recomputes when claim selection changes

This is the data layer. It touches no UI. It can be tested independently by logging output.

**Files**: `ui/hooks/useEvidenceRows.ts` (new)

### Phase 2: Column Registry

Create the built-in column definitions as a static registry. Each column definition maps to an `EvidenceRow` field.

**Files**: `ui/components/instrument/columnRegistry.ts` (new)

Contains:
- `BUILT_IN_COLUMNS: ColumnDef[]` — the ~20 columns listed above
- `DEFAULT_VIEWS: ViewConfig[]` — the 4 default view configurations
- Helper: `getVisibleColumns(viewConfig, customColumns) → ColumnDef[]`

### Phase 3: Evidence Table Component

The core table renderer.

**Files**: `ui/components/instrument/EvidenceTable.tsx` (new)

Props:
- `rows: EvidenceRow[]`
- `columns: ColumnDef[]`
- `viewConfig: ViewConfig`
- `onSort`, `onGroup`, `onFilter`

Features:
- Virtualized rows (the corpus can be 200+ statements)
- Group headers with counts
- Sortable column headers
- Sticky header row
- Cell formatting per column type
- Row expansion to show full statement text
- Null-value rendering (dash, not zero)

Start with read-only rendering. No expression engine yet. No threshold sliders. Just the table with built-in columns, sorting, and grouping.

### Phase 4: Context Strip

**Files**: `ui/components/instrument/ContextStrip.tsx` (new)

A horizontal bar component that reads:
- `artifact.geometry.basinInversion` → D, T_v, basins, status
- `artifact.geometry.substrate` → participation rate (% mutualDegree > 0)
- `artifact.geometry.query.relevance` → query spread (P90-P10)

Renders as compact metric pills with color coding. Click any pill → popover with the relevant histogram (reuse existing `BinHistogram` component).

### Phase 5: Wire Into DecisionMapSheet

Replace the current layer tab system with:

```
Context Strip (always visible)
─────────────────────────────
Claim Selector + View Switcher + Scope Toggle
─────────────────────────────
Evidence Table (takes remaining height)
─────────────────────────────
▸ Reference Shelf (collapsible sections containing existing cards)
```

The existing `LAYERS` constant, the layer tab bar, and the card-rendering switch statement are removed. The instrument state simplifies from `selectedLayer: PipelineLayer` to `selectedView: string` + `selectedClaimId: string | null`.

**Changes to**: `DecisionMapSheet.tsx`, `useInstrumentState.ts`

**No changes to**: `LayerCards.tsx` (existing cards remain, just rendered inside collapsible Reference Shelf sections)

### Phase 6: Column Picker + View Customization

A drawer or popover triggered by the `[+ Column]` button:
- Shows all registered columns with checkboxes
- Drag to reorder
- Each column shows its description tooltip
- "Reset to default" button per view

**Files**: `ui/components/instrument/ColumnPicker.tsx` (new)

### Phase 7: Expression Engine

The computed column system.

**Files**: `ui/components/instrument/ExpressionEngine.ts` (new)

- Parse expressions into safe AST (use `expr-eval` library or minimal custom parser)
- Register computed columns into the column registry at runtime
- Evaluate per-row, propagate nulls
- UI: text input in column picker, with autocomplete for column names

### Phase 8: Threshold Preview

For columns that represent derived gates (zone, fate, custom boolean expressions):
- A small range slider appears in the column header
- Dragging it recomputes the categorical value for display only
- The actual artifact data is never modified
- Visual diff highlighting shows which rows changed classification

This is the "what-if" tool that replaces the rebuild cycle.

---

## What Gets Deleted

| Current thing | Status |
|---|---|
| 13 pipeline-stage tabs | Removed |
| `LAYERS` constant + tab rendering loop | Removed |
| Layer card switch statement in DecisionMapSheet | Removed (replaced by Evidence Table + Reference Shelf) |
| `selectedLayer: PipelineLayer` in instrument state | Replaced by `selectedView` + `selectedClaimId` |
| Separate rendering of Provenance, Continuous, Compare, Mixed cards as primary surfaces | Subsumed by Evidence Table columns |

## What Does NOT Get Deleted

| Current thing | Status |
|---|---|
| All existing card components in LayerCards.tsx | Kept — rendered in Reference Shelf |
| ParagraphSpaceView (canvas) | Kept — independent of instrument panel restructure |
| ClaimDetailDrawer | Kept — but now also links to "show this claim in Evidence Table" |
| CrossSignalComparePanel | Kept in Reference Shelf |
| ToggleBar | Kept — controls canvas, not instrument panel |
| `getLayerCopyText` utility | Adapted to export evidence table data |

---

## Why This Design and Not the 4-Block Plan

The 4-block plan (Pairwise / Claim Affinity / Query Affinity / Derived) made a category error: it organized by *what's being measured* instead of *what you're investigating*. Your investigation is always claim-centric. You don't think "let me look at pairwise geometry" — you think "why is this statement in this claim's pool?" The pairwise geometry is context for that question, not a separate investigation.

The evidence table puts the investigation unit (statement × claim × scores) at the center. The context strip gives you geometry health. The reference shelf gives you deep mechanism inspection. Three layers, clear hierarchy, one primary surface.

The 4-block plan also kept cards as the primary rendering unit. Cards are the wrong primitive for comparative investigation. You can't sort a card. You can't add a computed column to a card. You can't group card entries by a different field. Tables can do all of this.

The expression engine is the piece that eliminates the rebuild cycle. It's Phase 7 — not Phase 1 — because the table needs to work well with built-in columns before custom columns matter. But it's the piece that changes the instrument from a dashboard to a console.

---

## Verification Criteria

| Phase | Test |
|---|---|
| 1 | `useEvidenceRows` returns correct row count matching shadow statement count. Claim-relative fields populate when claim selected. |
| 2 | Column registry exports 20+ built-in columns. Default views reference valid column IDs. |
| 3 | Evidence table renders 200+ rows without scroll lag. Sorting works on all numeric columns. Grouping by zone shows correct counts. |
| 4 | Context strip shows D, T_v, participation, basins, Q_spread. Color coding responds to thresholds. Click opens histogram popover. |
| 5 | DecisionMapSheet renders new layout. No 13-tab bar. Evidence table takes primary space. Reference shelf expands to show existing cards. |
| 6 | Column picker adds/removes columns. View modifications are session-temporary. Reset restores defaults. |
| 7 | Expression `sim_claim - tau_S` creates new column. Column is sortable. Null propagation works (null input → null output). |
| 8 | Threshold slider on zone column live-reclassifies rows. Changed rows are highlighted. Slider release reverts to actual data. |

---

## The Hard Truth This Design Encodes

Your instrument panel was designed as a scientific dashboard — organized by what the pipeline produces.

You use it as a forensic console — organized by what you're trying to understand.

Those are different tools. The evidence table is the forensic console. The context strip is the dashboard compressed to its minimum useful form. The reference shelf is the deep mechanism library you consult occasionally.

The hierarchy is: investigate first, calibrate second, deep-dive rarely.

That matches your actual behavior: provenance, mixed, continuous, compare — all claim-centric investigation — 85% of the time. Substrate, basin, model ordering — calibration — 10%. Blast radius, carrier, alignment — mechanism audit — 5%.

The design should match the behavior, not the pipeline topology.
# DecisionMapSheet v3 — The Geometric Instrument

## The Insight That Unifies Everything

The force-directed claim graph positions claims by **mapper interpretation** (which claims conflict, support, trade off). That's L2 layout — aesthetically useful, geometrically false. Two claims can be adjacent on the graph because the mapper said they conflict, even though their evidence lives in opposite basins.

The UMAP paragraph space positions nodes by **actual embedding similarity**. When claim centroids are superimposed as diamonds, their position IS their geometric reality. You see which paragraphs cluster around each claim, which basins they span, how far apart claims really are in the substrate.

**The paragraph space with claim diamonds is the topology map.** The force-directed graph becomes a toggleable overlay — mapper edges drawn between diamonds on the spatial field.

This gives you both: the geometric truth of where evidence lives AND the mapper's structural interpretation of how claims relate. But the spatial truth is primary. The mapper's edges are an annotation, not the canvas.

---

## What Dies (confirmed, no changes from v2)

| Killed | Why |
|--------|-----|
| KNN edges, `knnDegree`, `avgTopKSim` | Mutual recognition replaced this. |
| Strong graph, `strongDegree`, `softThreshold` | Dead. Overridden by clamp on every query. |
| Stance coloring, stance filters, `dominantStance`, `contested` | L2 labels. Geometry doesn't read text. |
| Shape classifications (Forked/Convergent/etc.) | L3 labels. Pipeline gate verdict replaces them. |
| `confidence` / `patternStrength` | Misnamed L2. Not geometric. |
| `signals` (sequence/tension/conditional flags) | L2 regex flags. Not for geometry instrument. |
| `(cos+1)/2` normalized display | Legacy scale. Raw cosine is canonical. |
| Peak/Hill/Floor labels | L3. The raw numbers are the measurement. |
| Options tab (themed claim groupings) | L3 derived view. Narrative replaces this. |
| `AdaptiveLens` outputs | Consumer is dead. |
| Force-directed graph as primary canvas | Replaced by paragraph space. Mapper edges survive as overlay. |
| Entity profiles as a top-level panel | Data absorbed into measurement cards and claim detail. |

---

## Layout

```
┌──────────────────────────────────────────────────────────────────────┐
│                          FIELD HEALTH BAR                            │
│  D=0.147 │ T_v=0.412 │ 3 basins │ 47 mutual │ ✓ geometry active    │
└──────────────────────────────────────────────────────────────────────┘
┌──────────────────────────────┬───────────────────────────────────────┐
│                              │                                       │
│    GEOMETRIC FIELD           │  [🔬 Instrument ▾]  [📄 Narrative]   │
│    (paragraph space)         │  ────────────────────────────────     │
│                              │                                       │
│    ·  ·  ·                   │  (right panel content)                │
│   · ◆· · ·  ·               │                                       │
│    ·  · · ·◆ ·  ·           │  Layer cards / narrative /            │
│      · ·· ·  · ·            │  claim detail drawer                  │
│    · ·  ◆  · ·              │                                       │
│      ·  · · ·               │                                       │
│                              │                                       │
│  · = paragraph  ◆ = claim    │                                       │
│  ── = mutual edges           │                                       │
│  ╌╌ = mapper edges (toggle)  │                                       │
│                              │                                       │
│  [Toggles bar at bottom]     │                                       │
└──────────────────────────────┴───────────────────────────────────────┘
```

Three zones, same as v2. What changed: Zone 2 (left) is now the paragraph space, not the force-directed graph.

---

## Zone 1: Field Health Bar

Unchanged from v2. One line, always visible, L1 metrics only.

| Slot | Value | Source |
|------|-------|--------|
| D (discrimination range) | `P90 − P10` | `extendedSimilarityStats` |
| T_v (valley threshold) | Value or "—" | `basinResult` |
| Basin count | Integer | `basinResult.basinCount` |
| Mutual edge count | Integer | `mutualEdges.length` |
| Participation rate | `%` nodes with ≥1 mutual edge | Computed |
| Pipeline verdict | Badge | `pipelineGate.verdict` |

Color: green ≥ 0.10, amber marginal, red skip.

---

## Zone 2: The Geometric Field (Left Panel, ~40% width)

This is `ParagraphSpaceView` promoted from secondary toggle to primary canvas, with three additions: claim diamonds, mapper edge overlay, and claim-scoped highlighting.

### Base Layer (always on)

Paragraphs plotted at their UMAP (x, y) positions. Colored by **basin membership** (from `basinResult.basinByNodeId`). This replaces the old stance-based coloring. Each paragraph dot's color tells you which basin it belongs to — the most geometrically honest coloring available.

If basin inversion didn't produce basins (undifferentiated field), fall back to region membership coloring from mutual recognition components.

If no structure at all, uniform muted color with a degradation notice.

### Mutual Edges (toggle, default ON)

Lines between paragraphs that mutually recognize each other (from `substrate.mutualEdges`). Thin, low-opacity. These are the L1 structural connections. This is the only edge type drawn by default.

### Claim Diamonds (toggle, default ON)

Claim centroids plotted as diamonds (◆) on the paragraph field. Position computed from the claim's centroid embedding projected into the same UMAP space.

Each diamond:
- Sized by **provenance bulk** (L1 evidence mass, not supporter count)
- Labeled with a short claim label (truncated, full on hover)
- Colored with a distinct hue per claim (not basin color — needs to stand out)
- **Clickable** — selects the claim, triggers detail drawer + highlighting

### Mapper Edge Overlay (toggle, default OFF)

When enabled, draws the mapper's edges (supports/conflicts/tradeoffs/dependencies) as lines between claim diamonds. These are L2 interpretation overlaid on the L1 substrate.

| Edge type | Visual |
|-----------|--------|
| supports | Green dashed |
| conflicts | Red dashed |
| tradeoff | Amber dashed |
| dependency | Blue dashed |

Dashed to distinguish from the solid mutual edges. With a reason tooltip on hover (from `edge.reason`).

This is the force-directed graph's information, but spatially grounded in geometric truth. Two claims that "conflict" according to the mapper but sit right next to each other in the field — you can see that. Two claims that "support" each other but are on opposite sides — that's a mapper quality signal.

### Region Hulls (toggle, default OFF)

Convex hulls around mutual recognition components (regions). Uses the existing hull computation from `ParagraphSpaceView`. Useful for seeing the macro structure of the field but can clutter, so off by default.

### Toggles Bar

A compact bar at the bottom of the field:

```
[✓ Mutual Edges] [✓ Claims] [○ Mapper Edges] [○ Region Hulls] [○ Basin Rects]
```

Simple checkboxes. No dropdowns, no sub-menus.

### Claim Selection Highlighting

When a claim diamond is clicked, the field transitions to show that claim's evidence footprint. This is the key interaction that makes the spatial view an instrument, not just a picture.

**Three highlight layers, each independently toggleable:**

1. **Source paragraphs** (default ON): Paragraphs in the claim's competitive provenance pool glow brighter. All other paragraphs dim to ~20% opacity. You immediately see the claim's evidence footprint — is it tight or scattered? Does it span basins?

2. **Mutual edges within pool** (default ON): Mutual edges connecting source paragraphs are highlighted (thicker, brighter). Shows internal connectivity of the claim's evidence. A claim with many internal mutual edges has coherent evidence. A claim with scattered, unconnected source paragraphs has low `sourceCoherence` — and you can see why.

3. **Region hulls spanned** (default ON when regions exist): Hulls for regions that contain at least one source paragraph highlight. Shows `regionSpan` visually. A claim spanning 1 region is focused. A claim spanning 4 regions is either a genuine synthesis or a mapper error — and the geometry can't distinguish those, but showing the user lets them decide.

**Non-source paragraphs**: Dimmed but still visible. Their mutual edges fade. Basin coloring remains so you can still see the field structure underneath the highlight.

---

## Zone 3: Right Panel (~60% width)

Two mode buttons at the top: **Instrument** and **Narrative**. Plus a detail drawer that overlays when a claim is selected.

### Mode: Instrument

Exactly as v2 specified: layer dropdown + measurement cards + cross-signal compare. But with the card enrichments from v2.1:

**Layer dropdown:**
```
[Layer ▾]
├── Substrate
├── Mutual Graph
├── Basin Inversion
├── Query Relevance
├── Competitive Provenance
├── Continuous Field (Phase 2)
├── Carrier Detection
├── Model Ordering
├── Blast Radius
├── Alignment
└── Raw Artifacts
```

**Every card gets:**

1. **Interpretive callout** — one sentence reading the L1 numbers. Not L3 interpretation. The pipeline gate already makes these decisions; the card states it. Examples:
   - Substrate: "47 paragraphs, discrimination range 0.147 — above 0.10 floor. Geometry is meaningful."
   - Basin: "3 basins detected. Valley at T_v=0.412 with depth 1.8σ. Thresholds will discriminate."
   - Mutual Graph: "89% participation. 3 components, largest 62%. Structure present."
   - Query Relevance: "Per-model spread 0.08 — modest. α=0.12."
   - Blast Radius: "2 axes from 5 claims. 1 suppressed (composite < 0.20)."

2. **Zone-colored histograms** — bars colored by basin zone (high/valley/low) instead of uniform accent.

3. **Visual bars for comparisons** — horizontal bar charts for per-model scores, per-claim blast radius components, per-claim provenance bulk. Tables for detail, bars for comparison.

4. **Hover tooltips on IDs** — hovering any statement or paragraph ID shows the actual text + model attribution. The escape hatch from geometry back to semantics.

**"Not available" cards show interim content:**

- **Competitive Provenance**: Show existing paragraph-based provenance (`claimProvenance`). Per-claim pool size, exclusivity ratio, source statement IDs. Labeled: "paragraph-based (Phase 1 pending)."
- **Carrier Detection**: Show current thresholds (`max(μ+σ, P75)`) and statement fate distribution. Labeled: "interim — audit data after skeletonization runs."
- **Continuous Field**: Show "Phase 2 — not yet implemented" with a brief description of what it will measure.

### Mode: Narrative

The mapper's narrative output, scrollable, with citation links.

| Element | Source |
|---------|--------|
| Mapper narrative (markdown) | `mappingText` via `MarkdownDisplay` |
| Citation links `[1]`, `[2]` | Click opens source provider in split panel |
| Mapper provider badge | `activeMappingPid` → provider name + color dot |

Simple. Just restore what the old Narrative tab was.

### Claim Detail Drawer (overlays either mode)

When a claim diamond is clicked (in Zone 2), the detail drawer slides in from the top of the right panel or pushes the current content down. It has two sections.

**Section A: Claim Identity (the face)**

```
┌──────────────────────────────────────────────────────┐
│  ← Back to field                               ✕    │
│                                                      │
│  Privacy-First Architecture                          │
│  ════════════════════════════                         │
│                                                      │
│  ┌────────────────────────────────────────┐          │
│  │ ⬤ Claude  ⬤ GPT-4  ⬤ Gemini  ⬤ Llama │ 4/6     │
│  └────────────────────────────────────────┘          │
│                                                      │
│  conflicts → Cost Optimization                       │
│  supports  → Data Minimization                       │
│  tradeoff  ↔ Performance                             │
│                                                      │
│  ─── From the Narrative ───                          │
│  "Models broadly agree that data ownership should    │
│  rest with the individual, though the practical      │
│  implications for cross-border operations..."        │
│                                                      │
└──────────────────────────────────────────────────────┘
```

| Element | Source | Notes |
|---------|--------|-------|
| Claim label | `claim.label` | Large, prominent |
| Supporter Orbs | `claim.supporters` → `getProviderColor` / `getProviderConfig` | Colored circles with 2-3 letter model initials. Large enough to read (32-40px). |
| Support fraction | `supporters.length / totalModels` | "4/6" |
| Connected edges | `semantic.edges` filtered to this claim | Type + target label. Clicking target selects that claim. |
| Narrative excerpt | `extractNarrativeExcerpt(claimId, mappingText)` | The paragraph from the mapper narrative about this claim. |

**Section B: Geometric Profile (stacked measurements)**

All of this claim's numbers across measurement layers, stacked vertically. You don't switch the layer dropdown — you see everything at once for this one claim.

```
┌──────────────────────────────────────────────────────┐
│  ─── Provenance ───                                  │
│  Bulk: 8.3  ████████░░ (max across claims: 12.1)    │
│  Exclusivity: 42%  ████░░░░░░                        │
│  Pool: 14 statements │ Regions: 2                    │
│  Model trace: 4/6 (mapper agrees ✓)                  │
│                                                      │
│  ─── Query Relevance ───                             │
│  Mean: 0.38 raw cosine │ Range: 0.22 – 0.51         │
│  ██████████░░░░░░░░░░░░░░░░ (relative to field)     │
│                                                      │
│  ─── Blast Radius ───                                │
│  Composite: 0.72                                     │
│  cascade     ████████░░  0.80                        │
│  exclusive   ████░░░░░░  0.42                        │
│  leverage    ████████░░  0.85                        │
│  queryRel    ████░░░░░░  0.38                        │
│  articulate  ██░░░░░░░░  0.15                        │
│                                                      │
│  ─── Alignment ───                                   │
│  sourceCoherence: 0.71 │ embeddingSpread: 0.09       │
│  regionSpan: 2 │ crossesBoundary: 2/3 edges          │
│  Model diversity: 4 geometric vs 4 mapper ✓          │
│                                                      │
└──────────────────────────────────────────────────────┘
```

Each measurement block:
- Uses horizontal bar charts relative to field max (so you can see where this claim sits compared to others)
- Flags mismatches: "⚠ mapper claims 4 supporters, geometry traces to 2"
- Uses L1/L2 badges on headers

---

## Interaction Flow

### Default state (no selection)
- Field shows all paragraphs (basin-colored), mutual edges, claim diamonds
- Right panel: Instrument mode, Substrate card (field-level distributions)

### Click a claim diamond
1. Field: source paragraphs highlight, others dim, internal mutual edges brighten, spanned region hulls show
2. Right panel: Detail drawer slides in with claim identity + geometric profile
3. Layer dropdown (if visible) updates to show claim-scoped card

### Back / deselect
1. Field: highlighting clears, all paragraphs return to full opacity
2. Right panel: detail drawer closes, returns to instrument or narrative

### Switch to Narrative mode
- Right panel shows mapper narrative, scrollable
- Field stays as-is (claim selection highlighting persists if a claim is selected)
- Clicking a citation in the narrative opens the source provider in the split panel

### Toggle mapper edges
- Dashed lines appear between claim diamonds
- Useful for comparing: "mapper says these two conflict — but look, their evidence is in the same basin"

---

## ParagraphSpaceView Refactor

The current `ParagraphSpaceView` needs these changes to become the primary canvas:

### Remove
- KNN edge rendering (already dead)
- Strong edge rendering (already dead)
- Stance-based coloring (`dominantStance` → color)
- `contested` badge
- `showKnnEdges`, `showStrongEdges` toggles
- Model filter by index (filtering by geometric properties instead)
- Fate-based dimming (was coupled to traversal, which is downstream)

### Keep
- UMAP (x, y) layout
- Mutual edge rendering
- Region hull computation + rendering
- Basin coloring (from `basinResult.basinByNodeId`)
- Basin rectangles toggle (from existing `showBasinView`)
- Pan/zoom if it exists (or add)

### Add
- **Claim diamond overlay**: Plot claim centroids as diamonds. Sized by provenance bulk. Labeled. Clickable.
- **Mapper edge overlay**: Draw edges between claim diamonds. Toggle on/off. Dashed, color-coded by type.
- **Claim selection highlighting**: Source paragraphs brighten + internal mutual edges thicken + spanned hulls show. Three toggleable sub-layers.
- **Hover tooltip on paragraphs**: Show paragraph ID, model index, top1Sim, mutualDegree, basin membership. Keep it compact.
- **Hover tooltip on claim diamonds**: Show claim label, provenance bulk, exclusivity, supporter count.

### Props

```typescript
interface ParagraphSpaceViewProps {
  graph: PipelineSubstrateGraph | null;
  mutualEdges: PipelineSubstrateEdge[] | null;
  regions: PipelineRegion[] | null;
  basinResult: BasinInversionResult | null;

  // NEW: claim overlay data
  claims: Array<{
    id: string;
    label: string;
    centroidX: number;     // UMAP-projected centroid position
    centroidY: number;
    provenanceBulk: number;
    sourceStatementIds: string[];
    sourceParagraphIds: string[];
    supporters: (string | number)[];
  }> | null;

  // NEW: mapper edges between claims
  mapperEdges: Array<{
    from: string;  // claim ID
    to: string;
    type: string;  // supports/conflicts/tradeoff/dependency
    reason?: string;
  }> | null;

  // NEW: selection state
  selectedClaimId: string | null;
  onClaimSelect: (claimId: string | null) => void;

  disabled?: boolean;
}
```

### Claim Centroid Projection

The claim centroid is an embedding vector. To plot it in the paragraph UMAP space, it needs to be projected through the same UMAP transform. Two options:

**Option A (recommended)**: Compute claim centroid position as the weighted average of its source paragraphs' (x, y) positions, weighted by competitive provenance weight. This is geometrically honest — the centroid sits at the center of mass of its evidence.

```typescript
function claimPosition(claim, paragraphPositions, weights) {
  let sumX = 0, sumY = 0, sumW = 0;
  for (const pid of claim.sourceParagraphIds) {
    const pos = paragraphPositions.get(pid);
    const w = weights.get(pid) ?? 1;
    if (pos) { sumX += pos.x * w; sumY += pos.y * w; sumW += w; }
  }
  return sumW > 0 ? { x: sumX / sumW, y: sumY / sumW } : null;
}
```

**Option B**: Run the claim centroid embedding through UMAP transform (if the UMAP model is available for out-of-sample projection). More geometrically pure but computationally heavier and UMAP out-of-sample projection isn't always stable.

Start with Option A. It's sufficient and doesn't require UMAP infrastructure changes.

---

## State Model

```typescript
interface InstrumentState {
  // Right panel
  rightPanelMode: 'instrument' | 'narrative';
  selectedLayer: PipelineLayer;
  compareMode: {
    enabled: boolean;
    measurementA: MeasurementKey;
    measurementB: MeasurementKey;
    level: 'claim' | 'statement';
  };

  // Entity selection (drives both field highlighting and detail drawer)
  selectedClaimId: string | null;

  // Field toggles
  showMutualEdges: boolean;     // default: true
  showClaimDiamonds: boolean;   // default: true
  showMapperEdges: boolean;     // default: false
  showRegionHulls: boolean;     // default: false
  showBasinRects: boolean;      // default: false

  // Claim selection sub-layers (only visible when a claim is selected)
  highlightSourceParagraphs: boolean;    // default: true
  highlightInternalEdges: boolean;       // default: true
  highlightSpannedHulls: boolean;        // default: true
}
```

No tab state. No sub-tab state. Field toggles + one selection + one layer dropdown + one panel mode toggle. Total interactive state: ~12 booleans and 3 enum values. The old sheet had 5 tab states, 5 sub-tab states, and dozens of filter combinations.

---

## Migration From Current Implementation

### DecisionMapSheet.tsx

| Current | Change |
|---------|--------|
| `DecisionMapGraph` as primary canvas in Zone 2 | **Replace** with `ParagraphSpaceView` (enhanced) |
| `ParagraphSpaceView` behind "Open Spatial" toggle | **Promote** to primary canvas. Remove toggle. |
| `selectedLayer` dropdown | Keep, unchanged |
| `LayerCards` components | Keep, add enrichments per v2.1 |
| `CrossSignalComparePanel` | Keep, add statement-level mode |
| `selectedEntity` state | Simplify to `selectedClaimId: string \| null` |
| `spatialViewOpen` toggle | **Remove** — spatial view is always the primary |

### ParagraphSpaceView.tsx

| Current | Change |
|---------|--------|
| `showMutual` toggle | Keep |
| `showHulls` toggle | Keep |
| `showBasins` toggle | Keep |
| KNN/Strong edge rendering | **Remove** |
| Basin coloring on nodes | Keep as default coloring |
| Claim diamonds | **Add** — new overlay |
| Mapper edge overlay | **Add** — new overlay |
| Claim selection highlighting | **Add** — new interaction |
| Paragraph hover tooltip | **Add** — ID + model + measurements |

### LayerCards.tsx

| Current | Change |
|---------|--------|
| All existing cards | Keep structure, add enrichments |
| `SubstrateCard` | Add interpretive callout, zone-colored histogram |
| `BasinInversionCard` | Add peak detection metadata in callout |
| `MutualGraphCard` | Add region profiles summary |
| `QueryRelevanceCard` | Add per-model horizontal bars, α callout |
| `CompetitiveProvenanceCard` | Show interim paragraph-based provenance data |
| `CarrierDetectionCard` | Show current thresholds + fate distribution |
| `ContinuousFieldCard` | Keep stub, label as Phase 2 |
| `BlastRadiusCard` | Add per-claim stacked bars, axis clustering viz |
| `ModelOrderingCard` | Add horizontal bar chart, spread headline |
| `AlignmentCard` | Add sourceCoherence, regionSpan, model diversity check |
| All cards | Add hover tooltips on statement/paragraph IDs |

### Removed Components

| Component | Status |
|-----------|--------|
| `DecisionMapGraph` (force-directed SVG) | **Keep file** but no longer rendered in DecisionMapSheet. Mapper edges data still used for overlay. |
| Old `DetailView` | **Replaced** by claim detail drawer in right panel |
| `EntityProfilesPanel` | **Removed** from sheet. Data absorbed into measurement cards. Component may survive for standalone use. |
| `ShadowAuditView` | **Removed** from sheet. Data in Alignment card or Raw Artifacts. |

### New Components Needed

| Component | Purpose |
|-----------|---------|
| `ClaimDetailDrawer` | Right-panel overlay: claim identity (orbs, edges, narrative excerpt) + stacked geometric profile |
| `NarrativePanel` | Simple: `MarkdownDisplay` on `mappingText` with citation handler and provider badge |
| `MapperEdgeOverlay` | SVG layer in ParagraphSpaceView: dashed lines between claim diamond positions |
| `ClaimHighlightLayer` | SVG layer in ParagraphSpaceView: dims non-source nodes, brightens source, thickens internal edges |

---

## What This Achieves

| Dimension | Old Sheet | v3 |
|-----------|----------|-----|
| Primary canvas | Force-directed graph (L2 layout) | Paragraph space (L1 embedding layout) |
| Claim position | Arbitrary (aesthetic) | Center of evidence mass (geometric truth) |
| "This claim spans 3 basins" | Table in alignment card | **Visible** — source paragraphs colored across basins |
| "These claims conflict" | Edge on force-directed graph | Mapper edge overlay on spatial field — you see both the claimed relationship AND the geometric distance |
| "This claim's evidence is incoherent" | `sourceCoherence` number in diagnostics | **Visible** — source paragraphs scattered across field |
| Navigation | 5 tabs × 4 sub-tabs | 1 field + 1 dropdown + 1 toggle |
| Claim detail | Lost in v2, tables in old sheet | Detail drawer: orbs + edges + narrative excerpt + stacked measurements |
| Narrative | Lost in v2, full tab in old sheet | Right panel toggle, always 1 click away |
| Measurements | Separate diagnostic panels | Layer cards with callouts, bars, tooltips |
| Mapper edges | Primary display surface | Optional overlay — L2 annotation on L1 substrate |
| Phase 1 readiness | Would need restructuring | Add one card template + claim centroid → diamond positions |
| The question being answered | "What did the mapper find?" | "What does the field look like, and does the mapper's interpretation match?" |
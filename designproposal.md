# DecisionMapSheet Redesign v2 — Geometric Instrument Panel

## The Problem With v1

The first redesign shuffled furniture. It took the existing 5 tabs worth of UI noise and reorganized them into 3 tabs. That's a layout change, not a conceptual change. The fundamental issue is that the current sheet is organized around *UI categories* (Evidence, Landscape, Partition, Synthesis, Entities) when it should be organized around *measurement layers and their decision surfaces*.

You're not browsing a dashboard. You're instrumenting a pipeline. The question is never "show me the evidence tab" — it's "is this measurement discriminating, and should it feed this consumer?"

## Design Principle

**The sheet is a geometric instrument, not a data browser.**

Every pixel earns its place by answering one of three questions:
1. What does the field look like? (substrate health)
2. Who owns what? (competitive allocation)
3. Where would a decision go wrong? (fault lines)

L1 measurements are first-class citizens with full distributions. L2 measurements are flagged and present. L3 labels are gone from the primary surface entirely.

---

## What Dies

These are not "pushed deeper." They are removed from the sheet. Some may survive in a collapsed raw-JSON dump for emergencies, but they are no longer designed-for.

| Killed | Why |
|--------|-----|
| KNN edges, `knnDegree`, `avgTopKSim` | Fixed k=5 is a relic. Mutual recognition replaced this. No consumer uses KNN degrees. |
| Strong graph, `strongDegree`, `softThreshold` | Overridden by clamp on every query. Dead. |
| `dominantStance`, `contested`, stance filters | L2 pattern-match labels. Geometry doesn't read text. The mapper can annotate; geometry doesn't display it. |
| Shape classifications (Forked/Convergent/etc.) | L3 labels derived from unstable thresholds. Still being calibrated. Not display-worthy. |
| `fragmentationScore`, `bimodalityScore`, `parallelScore` | Shape inputs. Same problem. Diagnostic at best. |
| Force-directed (x,y) as meaningful data | Aesthetic. Layout algorithm output, not measurement. The graph keeps spatial arrangement for navigation, but positions are never displayed as numbers or used in any panel. |
| `confidence` (pattern match count) | Misnamed. It's `patternStrength`. L2. Not geometric. |
| `signals` (sequence/tension/conditional flags) | L2 regex flags. Advisory only. Not for the geometry instrument. |
| `evidenceStanceFilter`, `evidenceRefFilter`, stance-based filtering | Geometry doesn't filter by stance. You filter by weight, allocation, similarity. |
| `(cos+1)/2` normalized display | Legacy scale. Raw cosine is canonical. Don't show both. |
| Peak/Hill/Floor labels | L3 classification of support levels. The raw `supportRatio` or provenance bulk is the measurement. The label adds nothing. |
| Theme groupings from `parseOptionsIntoThemes` | Mapper-level semantic organization. Not geometry. |
| `AdaptiveLens` outputs | Consumer is dead (HAC removed, strong graph dying). Diagnostic-only. |
| Narrative excerpts on default view | Text interpretation. Belongs in mapper/synthesis view, not geometry instrument. |

---

## What Lives

Organized by the pipeline layers from the North Star, filtered to measurements that either (a) actively feed a consumer decision, or (b) you need to see to decide whether they *should* feed a consumer.

### Layer 1: Substrate Primitives (L1)

| Measurement | What It Tells You | Consumer |
|-------------|-------------------|----------|
| Full pairwise distribution (histogram) | Shape of the similarity field — is there structure at all? | Everything downstream |
| `μ`, `σ`, P10, P25, P50, P75, P80, P90, P95 | Distribution landmarks | Per-consumer threshold calibration |
| Discrimination range: P90 − P10 | How much useful spread exists | Pipeline gate (≥ 0.10 or skip geometry) |
| `top1Sim` per node | Nearest-neighbor distance | Isolation detection |
| `isolationScore` (1 − top1Sim) | How alone is this paragraph? | Substrate quality |

### Layer 2: Mutual Recognition Graph (L1)

| Measurement | What It Tells You | Consumer |
|-------------|-------------------|----------|
| Mutual edge count | Real structure exists? | Pipeline gate |
| Participation rate | % of nodes with ≥1 mutual edge | Pipeline gate (> 5%) |
| `mutualDegree` per node | Local connectivity in the real graph | Region membership, isolation |
| Connected components | How fragmented is the field? | Regionization |

### Layer 2b: Basin Inversion (L1)

| Measurement | What It Tells You | Consumer |
|-------------|-------------------|----------|
| T_v (valley threshold) | Where the field naturally separates | Replaces all soft thresholds |
| T_low, T_high (μ±σ) | Distribution-relative bounds | Comparison with T_v |
| Basin count, sizes, trench depths | Topology of the similarity field | Diagnostic — how many natural clusters? |
| Bridge pairs (near T_v) | Edges at the structural fault line | Where basins are barely connected |
| pctHigh / pctLow / pctValleyZone | Zone population | Field balance |

### Layer 3: Query Relevance (L1)

| Measurement | What It Tells You | Consumer |
|-------------|-------------------|----------|
| Raw cosine (query, statement) | How relevant is each statement to the question? | Fate tracking, model ordering, blast radius, recovery |
| Per-distribution stats | Is query relevance discriminating? | Threshold calibration |
| Per-model mean query relevance | Which models are on-topic? | Model ordering (adaptive alpha) |

### Layer 4: Claim Centroids (L2 — flagged)

| Measurement | What It Tells You | Consumer |
|-------------|-------------------|----------|
| Claim centroid vectors | Where claims sit in embedding space (from claim text, not from evidence) | Provenance, carrier detection, alignment |
| Inter-centroid similarities | How close are claims to each other geometrically? | Axis clustering (Jaccard), deduplication |

### Layer 5: Competitive Provenance (L1 on L2 seed)

| Measurement | What It Tells You | Consumer |
|-------------|-------------------|----------|
| Statement × Claim similarity matrix | Full allocation landscape | Everything in provenance |
| Per-statement threshold τ_S (μ+σ across claims) | Competitive cutoff per statement | Assignment decisions |
| Competitive assignment count per statement | Decisive (1) vs ambiguous (many) — the entropy | Allocation quality |
| `weight(S, C)` per assigned pair | How much of this statement belongs to this claim | Blast radius, carrier detection, pruning |
| `provenanceBulk` per claim | Total evidence mass | Claim strength (replaces raw supporter count) |
| `exclusivityRatio` per claim | What fraction of evidence is exclusively owned | Blast radius (key input) |
| Statement Jaccard between claim pairs | Evidence overlap | Axis clustering, mapper quality |

### Layer 5b: Continuous Field (Phase 2 — upcoming)

| Measurement | What It Tells You | Consumer |
|-------------|-------------------|----------|
| `z_claim(S)` | Standardized similarity to claim centroid | Continuous evidence depth |
| `z_core(S)` | Standardized similarity to claim's core cluster | Within-claim density |
| `evidenceScore(S)` = z_claim + z_core | Composite continuous signal | Pruning integration (optional) |
| Disagreement matrix | Where competitive allocation and continuous field diverge | Structural fault lines — pruning danger zones |

### Layer 6: Carrier Detection (L1)

| Measurement | What It Tells You | Consumer |
|-------------|-------------------|----------|
| Carrier candidates per pruned statement | Who can carry this evidence if the claim dies? | Skeletonization |
| `weight(S, C_surviving)` vs `weight(S, C_pruned)` | Strong/weak/no carrier classification | Pruning safety |

### Layer 8: Model Ordering (L1)

| Measurement | What It Tells You | Consumer |
|-------------|-------------------|----------|
| Irreplaceability per model | Would losing this model lose unique terrain? | Mapper prompt ordering |
| Per-model region contributions | Which regions does each model occupy? | Irreplaceability computation |
| 22x spread | Is model ordering actually differentiating? | Pipeline health |

### Layer 10: Blast Radius (L2 policy blend)

| Measurement | What It Tells You | Consumer |
|-------------|-------------------|----------|
| Per-claim composite score | Question-worthiness | Survey gating |
| Component weights (0.30/0.25/0.20/0.15/0.10) | Policy, not data — visible and tunable | Composite |
| cascadeBreadth, exclusiveEvidence, leverage, queryRelevance, articulationPoint | Individual L1 inputs to the blend | Each independently inspectable |

### Layer 12-13: Alignment (L1 checks on L2 groupings)

| Measurement | What It Tells You | Consumer |
|-------------|-------------------|----------|
| `sourceCoherence` per claim | Did mapper staple unrelated content? | Diagnostic only (vetoed for promotion) |
| `regionSpan` per claim | How many regions does this claim's evidence span? | Traversal (future), mapper quality |
| `sourceModelDiversity` vs mapper `supporters[]` | Does mapper's claimed support match geometric sourcing? | Blast radius (hallucination check) |
| `crossesRegionBoundary` per edge | Are connected claims in different geometric regions? | Hold — meaningful only with discrimination |

---

## The Instrument Layout

Three zones. Not tabs — zones that can coexist or be focused.

```
┌─────────────────────────────────────────────────────────────────────┐
│                         FIELD HEALTH BAR                            │
│  D=0.147 │ T_v=0.412 │ 3 basins │ 47 mutual edges │ 89% particip │
│  [▰▰▰▰▰▰▰▰░░] discrimination          Pipeline: ✓ geometry active │
└─────────────────────────────────────────────────────────────────────┘
┌────────────────────────┬────────────────────────────────────────────┐
│                        │                                            │
│    TOPOLOGY MAP        │         MEASUREMENT INSPECTOR              │
│    (compact graph)     │                                            │
│                        │  ┌─ [Layer ▾] ──────────────────────────┐  │
│    ◆───◆               │  │                                      │  │
│   / \   \              │  │  Distribution / Table / Matrix       │  │
│  ◆   ◆───◆             │  │  (content changes by layer + sel)    │  │
│       \                │  │                                      │  │
│        ◆               │  │                                      │  │
│                        │  └──────────────────────────────────────┘  │
│  click = select entity │                                            │
│  L1 sizing only        │  ┌─ CROSS-SIGNAL ──────────────────────┐  │
│  (provenance bulk)     │  │  correlation / divergence view       │  │
│                        │  │  (when comparing two measurements)   │  │
│  ○○○○○○ model orbs     │  └──────────────────────────────────────┘  │
│  per selected claim    │                                            │
└────────────────────────┴────────────────────────────────────────────┘
```

### Zone 1: Field Health Bar (always visible, one line)

This replaces the shape ribbon. No L3 labels. Only L1 health metrics for the substrate.

| Slot | Value | Source |
|------|-------|--------|
| Discrimination range | `D = P90 − P10` | `extendedSimilarityStats` |
| Valley threshold | `T_v` (or "—" if undifferentiated) | `basinResult` |
| Basin count | Integer | `basinResult.basinCount` |
| Mutual edge count | Integer | `mutualEdges.length` |
| Participation rate | % nodes with ≥1 mutual edge | Computed from mutual graph |
| Pipeline verdict | `geometry_active` / `undifferentiated_field` / `skip_geometry` | `pipelineGate.verdict` |

Color-coded: green if discrimination ≥ 0.10, amber if marginal, red if skip.

**Nothing else.** No claim counts, no pattern labels, no shape names.

### Zone 2: Topology Map (left panel, ~30% width)

The claim graph, but stripped to pure geometric information. This is navigation, not analysis.

**Node sizing**: `provenanceBulk` (L1 evidence mass). NOT supporter count.

**Node color**: Region membership (same color = same geometric region). NOT stance.

**Edge display**: Mapper edges remain (supports/conflicts/tradeoffs) as thin lines — they're L2 but useful for orientation. No decorations.

**On node click**: Selects that claim as the active entity. All panels in Zone 3 update to show that claim's measurements.

**On empty click**: Deselects. Zone 3 reverts to field-level distributions.

**NOT displayed on the graph**:
- x,y coordinates as numbers
- KNN edges
- Strong edges
- Keystone/dissent/fragile decorations
- Narrative text
- Shape labels

**Displayed on request** (toggle):
- Region hulls (from mutual recognition components)
- Claim centroid diamonds (reinstated)
- Model orbs for selected claim (inline below graph)

### Zone 3: Measurement Inspector (right panel, ~70% width)

This is the core instrument. It answers: *"For the selected entity (or the whole field), what do the L1 measurements say?"*

#### Layer Selector

A dropdown (not tabs) that selects which pipeline layer's measurements to display:

```
[Layer ▾]
├── Substrate (L1)
├── Mutual Graph (L1)
├── Basin Inversion (L1)
├── Query Relevance (L1/L3)
├── Competitive Provenance (L1 on L2)  ← Phase 1
├── Continuous Field (L1 on L2)        ← Phase 2
├── Carrier Detection (L1)
├── Model Ordering (L1)
├── Blast Radius (L2 policy)
├── Alignment (L1 on L2)
└── Raw Artifacts (JSON dump)
```

Each layer selection renders a **measurement card** appropriate to that layer's data shape. The display adapts based on whether an entity is selected or not.

#### Measurement Cards by Layer

**Substrate (nothing selected)**:
```
┌────────────────────────────────────────────────────┐
│  PAIRWISE SIMILARITY DISTRIBUTION          L1      │
│                                                    │
│  ▁▂▃▅▇█▇▅▃▂▁  histogram (all pairs)               │
│  │    ↑μ  ↑T_v   ↑P90                             │
│                                                    │
│  μ=0.342  σ=0.089  D=0.147                         │
│  P10=0.271  P50=0.338  P90=0.418                   │
│                                                    │
│  Nodes: 52  Pairs: 1326  Isolated: 3               │
└────────────────────────────────────────────────────┘
```

**Substrate (claim selected)**:
```
┌────────────────────────────────────────────────────┐
│  CLAIM: "Privacy-First Architecture"       L2 seed │
│                                                    │
│  Source statement similarities to centroid:         │
│  ▁▃▅▇█▇▅▃  (per-statement, this claim only)       │
│  │  ↑μ_C  ↑μ_C+σ_C                                │
│                                                    │
│  Pool: 14 stmts │ Bulk: 8.3 │ Exclusivity: 42%    │
│  Regions spanned: 2 │ Model diversity: 4/6         │
│                                                    │
│  Source model mismatch: mapper says 4, geometry     │
│  traces to 4 ✓ (no hallucination flag)             │
└────────────────────────────────────────────────────┘
```

**Basin Inversion (nothing selected)**:
```
┌────────────────────────────────────────────────────┐
│  BASIN TOPOLOGY                            L1      │
│                                                    │
│  ▁▂▃▅▇█▇▅▃▂▁  histogram with zone coloring        │
│  │←low→│←valley→│←high→│                           │
│       ↑T_low  ↑T_v  ↑T_high                       │
│                                                    │
│  Basins: 3  │ Largest: 58%  │ Bridges: 7           │
│  Valley zone: 12% of pairs                         │
│                                                    │
│  ─── Bridge Inspector ───                          │
│  Para_A    Para_B    Sim     Δ from T_v            │
│  p-014     p-031     0.4118  -0.0002  ← tightest   │
│  p-007     p-042     0.4125  +0.0005               │
│  ...                                               │
└────────────────────────────────────────────────────┘
```

**Competitive Provenance (nothing selected)** — Phase 1:
```
┌────────────────────────────────────────────────────┐
│  COMPETITIVE ALLOCATION                    L1/L2   │
│                                                    │
│  ─── Entropy Distribution ───                      │
│  Stmts assigned to 1 claim: 23 (44%)  ← decisive  │
│  Stmts assigned to 2 claims: 18 (35%)             │
│  Stmts assigned to 3+ claims: 11 (21%) ← ambig    │
│                                                    │
│  ─── Per-Claim Provenance ───                      │
│  Claim              Bulk   Excl%  Pool  Regions    │
│  Privacy-First      8.3    42%    14    2          │
│  Cost Optimization  5.1    18%    21    3          │
│  Data Minimization  3.7    55%    9     1          │
│  ...                                               │
│                                                    │
│  ⚠ Dual coordinate system active (Phase 1):       │
│  Provenance uses claim-text embeddings.             │
│  Pruning uses statement-derived centroids.          │
└────────────────────────────────────────────────────┘
```

**Competitive Provenance (claim selected)** — Phase 1:
```
┌────────────────────────────────────────────────────┐
│  CLAIM: "Privacy-First Architecture"               │
│                                                    │
│  ─── Statement Allocation Detail ───               │
│  Stmt    sim(S,C)  τ_S    excess   weight   other  │
│  s-014   0.72      0.48   0.24     0.38     2 cls  │
│  s-027   0.65      0.51   0.14     0.22     1 cl   │
│  s-031   0.58      0.55   0.03     0.05     3 cls  │
│  ...                                               │
│                                                    │
│  Bulk: 8.3 │ Pool: 14 │ Exclusive: 6 (42%)        │
│                                                    │
│  ─── Geometry Correlation ───                      │
│  weight(S,C) vs old pruning relevance: r=0.74      │
│  (instrumentation point 1)                         │
└────────────────────────────────────────────────────┘
```

**Continuous Field (claim selected)** — Phase 2:
```
┌────────────────────────────────────────────────────┐
│  CLAIM: "Privacy-First Architecture"               │
│                                                    │
│  ─── Evidence Depth Profile ───                    │
│  Stmt    z_claim  z_core   evidenceScore           │
│  s-014   +1.8     +2.1     3.9   ← deep core      │
│  s-027   +1.2     +0.8     2.0                     │
│  s-031   +0.3     -0.2     0.1   ← periphery      │
│  ...                                               │
│                                                    │
│  Core set (z_claim > 1.0): 6 statements            │
│                                                    │
│  ─── DISAGREEMENT ───                              │
│  s-031: competitive → Privacy-First (w=0.05)       │
│         continuous  → Cost Optimization (eS=2.4)   │
│  ⚠ Structural fault line                           │
└────────────────────────────────────────────────────┘
```

**Model Ordering (nothing selected)**:
```
┌────────────────────────────────────────────────────┐
│  MODEL ORDERING                            L1      │
│                                                    │
│  Model          Irrepl.  Regions  QueryRel  Order  │
│  ○ Claude       0.42     4/5      0.38      1st    │
│  ○ GPT-4        0.31     3/5      0.41      2nd    │
│  ○ Gemini       0.19     2/5      0.35      3rd    │
│  ○ Llama        0.02     1/5      0.29      6th    │
│  ...                                               │
│                                                    │
│  Spread: 21x (0.42 / 0.02)                         │
│  Adaptive α: 0.12 (query relevance spread: 0.04)   │
└────────────────────────────────────────────────────┘
```

**Blast Radius (nothing selected)**:
```
┌────────────────────────────────────────────────────┐
│  BLAST RADIUS                              L2 ⚑    │
│                                                    │
│  Claim              Comp   Casc  Excl  Levg  QRel  │
│  Privacy-First      0.72   0.8   0.42  0.85  0.38  │
│  Cost Optimization  0.45   0.3   0.18  0.62  0.41  │
│  Data Minimization  0.38   0.2   0.55  0.31  0.22  │
│                                                    │
│  Policy weights: cascade 0.30 │ exclusive 0.25 │    │
│  leverage 0.20 │ queryRel 0.15 │ articulation 0.10  │
│  ⚑ These weights are policy, not data.             │
│                                                    │
│  Suppressed: 1 claim (composite < 0.20)            │
│  Axes: 2 (Jaccard clustering reduced 5 → 2)        │
└────────────────────────────────────────────────────┘
```

#### Cross-Signal Comparison (bottom of Zone 3)

When you want to compare two measurements against each other. Select any two from a dropdown pair:

```
Compare: [weight(S,C) ▾]  vs  [old pruning relevance ▾]
```

Renders a scatter plot of the two values for every relevant entity (statement, claim, etc.), with:
- Pearson correlation coefficient
- Highlighted outliers (entities where the two signals disagree by > 1σ)
- Color-coded by which claim they belong to

This is the direct implementation of **Instrumentation Point 1** from Phase 1 — but generalized to any pair of measurements.

Useful comparisons:
- `weight(S,C)` vs old pruning relevance → geometry correlation
- `provenanceBulk` vs raw supporter count → does competitive allocation agree with mapper?
- `exclusivityRatio` vs `regionSpan` → do exclusive claims come from concentrated geometry?
- `z_claim` vs `z_core` → do claim centroids agree with core clusters?
- `competitive assignment` vs `continuous evidenceScore` → the disagreement matrix

---

## The Selection Model

Everything is driven by entity selection. The selected entity type determines what each measurement card shows.

| Selected | Substrate shows | Provenance shows | Blast Radius shows |
|----------|----------------|------------------|--------------------|
| Nothing | Full pairwise distribution | Entropy distribution + per-claim summary | All claims ranked |
| Claim | Source statement similarities | Statement allocation detail for that claim | That claim's component breakdown |
| Statement | That statement's similarity to all others | That statement's competitive weights across claims | N/A (statements don't have blast radius) |
| Region | Intra-region similarity distribution | Claims drawing from this region | N/A |

Selection can come from:
1. Clicking a node in the topology map (Zone 2)
2. Clicking a row in any table in the measurement inspector
3. A future search/filter (by statement ID, claim label, etc.)

**Cross-panel highlighting**: When a statement is selected, it highlights in every card that mentions it. When a claim is selected, its source statements highlight in substrate cards.

---

## What About Text?

The geometry instrument doesn't show text by default. But sometimes you need to verify what a statement actually says to understand why it's geometrically where it is.

**Hover tooltip**: Hovering any statement ID (in any table) shows a compact tooltip with the statement text and model attribution. This is the only text surface in the geometry instrument.

**"Open in text view" link**: If you need full paragraph context, a link opens the text in a separate popover or pane. This is the escape hatch from geometry into semantics. It's one click, not zero.

---

## What About the Claim Graph's Mapper Edges?

Mapper edges (supports/conflicts/tradeoffs/dependencies) are L2 — they're the mapper's interpretation, not geometric fact. They stay on the topology map as thin orientation lines, but they're not displayed in any measurement card.

The alignment layer (Layer 13) is where mapper structure gets checked against geometry: `crossesRegionBoundary`, `centroidSimilarity`, split/merge alerts. That's where mapper faithfulness lives, and it has its own measurement card in the inspector.

---

## Handling Phase 1 Integration

Phase 1 adds competitive provenance. The design is ready for this:

1. **New layer in the dropdown**: "Competitive Provenance" appears alongside existing layers
2. **Statement × Claim matrix**: The heatmap visualization is the primary display for field-level view
3. **Instrumentation points surface naturally**:
   - Point 1 (geometry correlation): Lives in the cross-signal comparison tool
   - Point 2 (dual coordinate flag): Banner in the provenance card
   - Point 3 (competitive entropy): The entropy distribution is the default provenance view
   - Point 4 (old vs new comparison): Cross-signal comparison of old paragraph pool sizes vs new statement-derived aggregation

4. **No restructuring needed**: Adding a layer is adding a card template to the inspector. The topology map, field health bar, and selection model don't change.

## Handling Phase 2 Integration

Phase 2 adds the continuous field and disagreement matrix:

1. **New layer**: "Continuous Field" in the dropdown
2. **Disagreement matrix**: Gets its own visualization mode — a table of statements where competitive and continuous signals point to different claims, sorted by divergence magnitude
3. **Cross-signal comparison**: `competitive weight` vs `evidenceScore` becomes a canonical comparison pair

---

## Migration From Current Sheet

### Killed surfaces (no migration, just delete)

- Landscape tab (ParagraphSpaceView with KNN/strong edge toggles, stance coloring)
- Evidence tab stance filters
- Shape classification badges
- Narrative excerpts in default view
- Theme/options parsing display
- Signal filters (sequence/tension/conditional)

### Absorbed into measurement cards

| Old Surface | New Home |
|-------------|----------|
| `EmbeddingDistributionPanel` | Substrate layer card |
| `InversionValleyPanel` | Basin Inversion layer card |
| `QueryRelevancePanel` | Query Relevance layer card |
| `ProvenancePanel` | Competitive Provenance layer card |
| `BlastRadiusPanel` | Blast Radius layer card |
| `SkeletonizationPanel` | Carrier Detection layer card |
| `StructuralAnalysisPanel` | Separate from geometry instrument (this is claim-graph analysis, not substrate geometry) |

### Preserved but relocated

| Surface | New Location |
|---------|-------------|
| Claim graph canvas | Topology Map (Zone 2), stripped to L1 sizing |
| Model orbs per claim | Below topology map, on claim selection |
| Copy/export controls | Action bar below field health bar |
| Full JSON artifacts | "Raw Artifacts" layer in dropdown (last item, collapsed) |
| Entity profiles (claims/statements/paragraphs/models/regions/edges/substrate tables) | Accessible via a "Table View" toggle on each measurement card, replacing the EntityProfilesPanel megacomponent |

### ParagraphSpaceView — special case

The landscape visualization (paragraph scatter) could survive in a modified form IF it's re-grounded in geometry:

- **Remove**: KNN edges, stance coloring, (x,y) as data, strong edges
- **Keep**: Mutual recognition edges only, region hulls from mutual components, claim centroid diamonds, basin coloring (paragraphs colored by basin membership)
- **Relocate**: Accessible via a "Spatial View" toggle on the Mutual Graph or Basin Inversion layer card — it becomes a visualization of those layers, not its own tab

Whether to do this now or defer is a judgment call. The measurement cards are the primary analytical surface. The spatial view is supplementary.

---

## State Model

```typescript
// The entire state for the redesigned sheet
interface InstrumentState {
  selectedLayer: PipelineLayer;      // which measurement card is showing
  selectedEntity: SelectedEntity | null;  // claim | statement | region | null
  compareMode: {
    enabled: boolean;
    measurementA: MeasurementKey;
    measurementB: MeasurementKey;
  };
  spatialViewOpen: boolean;          // toggle for mutual graph spatial viz
  regionHullsVisible: boolean;
  claimCentroidsVisible: boolean;
}

type PipelineLayer =
  | 'substrate'
  | 'mutual-graph'
  | 'basin-inversion'
  | 'query-relevance'
  | 'competitive-provenance'   // Phase 1
  | 'continuous-field'         // Phase 2
  | 'carrier-detection'
  | 'model-ordering'
  | 'blast-radius'
  | 'alignment'
  | 'raw-artifacts';

type SelectedEntity =
  | { type: 'claim'; id: string }
  | { type: 'statement'; id: string }
  | { type: 'region'; id: number }
  | { type: 'model'; index: number };
```

No tab state. No sub-tab state. One dropdown, one selection, one optional comparison mode. The complexity is in the measurement cards, not in navigation.

---

## L1/L2/L3 Visual Treatment

Every measurement card carries a confidence badge:

| Badge | Meaning | Visual |
|-------|---------|--------|
| `L1` | Pure geometry — computed from embeddings alone | Solid border, no decoration |
| `L2 ⚑` | Uses mapper-derived inputs (claim centroids, supporter lists) | Dashed border, flag icon, label: "depends on mapper output" |
| `L2 policy ⚑⚑` | Contains explicit policy weights (blast radius, question ceiling) | Double-dashed border, "policy weights visible below" |

L3 measurements don't appear on any card. If you need them, they're in Raw Artifacts.

---

## Summary: What Changed

| Dimension | Current Sheet | Redesigned Instrument |
|-----------|--------------|----------------------|
| Organizing principle | UI categories (Evidence, Landscape, etc.) | Pipeline measurement layers |
| Primary display | Claim graph + text | Measurement distributions + tables |
| Navigation | 5 tabs × 4 sub-tabs | 1 dropdown × entity selection |
| Node sizing | Supporter count (L3) | Provenance bulk (L1) |
| Node coloring | Stance (L2) | Region membership (L1) |
| L3 labels | Prominent (shape badges, peak labels) | Absent |
| Text | Everywhere | Hover tooltips only |
| KNN/Strong edges | Displayed | Deleted |
| Stances | Filter + display | Deleted |
| Cross-signal comparison | Not possible | First-class feature |
| Phase 1 readiness | Would need restructuring | Add one dropdown option + card template |
| Question being answered | "What's in the data?" | "Is this measurement discriminating, and should it feed this consumer?" |





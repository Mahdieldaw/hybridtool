Claude’s Plan
DecisionMapSheet v2 — Implementation Plan
Context
The DecisionMapSheet is currently organized around UI categories (5 tabs × 4 sub-tabs). The v2 redesign reorients it around measurement layers and a unified entity selection model. The sheet becomes an instrument: one layer dropdown, one selected entity, one inspector pane that updates coherently. This plan covers Phase P0 (ParagraphSpace cleanup) and Phase 1 (skeleton layout), with Phases 2–5 described at a high level for orientation.

Phase P0: ParagraphSpace v2 — Strip to L1 Adapter
File: ui/components/ParagraphSpaceView.tsx

This is isolated and can be done first. The component currently renders KNN edges, strong edges, stance coloring, and fate-based styles — none of which are L1. Strip it to a pure visualization adapter.

Props to remove (stop passing from DecisionMapSheet, stop reading internally)
Prop	Reason
strongEdges	Not L1 — stop rendering strong edge overlays
queryRelevance	L2/L3 signal — remove all query-relevance coloring
traversalState	Semantic/traversal state — remove fate-based node dim/highlight
preSemantic	Only used for non-L1 shape signals in the view
embeddingStatus	Informational only, not needed in spatial view
completeness	Not used in view
shape	L3 classification — gone
batchResponses	Only needed for model-stance coloring
Rendering to strip
KNN edge loop: graph.edges rendering (white rgba(255,255,255,0.10) lines) — delete
Strong edges loop: strongEdges rendering — delete
All stance-based node fill logic (references to dominantStance) — delete
All fate-based dimming/highlighting (references to traversalState) — delete
Claim-hover edge coloring (KNN edges highlighted on claim hover) — delete
Rendering to keep / change
Node circles: keep. Change sizing from arbitrary to node.mutualDegree (L1 — already on PipelineSubstrateNode). Uniform minimum size so isolated nodes are still visible.
Mutual edges: keep (already rendered green)
Region hulls: keep (already rendered from component-kind regions)
Basin coloring: keep (already implemented via basinByNodeId)
Claim centroid markers: keep the existing diamond markers (optional toggle)
Add
disabled?: boolean prop — when geometry is skipped (D < 0.10 or basinResult.status !== 'ok'), render a centered overlay: "Spatial view unavailable — field undifferentiated" instead of a broken canvas
Not yet
ParagraphSpace remains a tab for now. Converting it to a toggle on the Mutual Graph / Basin Inversion cards happens in Phase 2 when those cards are built.

Phase 1: Skeleton Layout
Goal: Prove the selection model works. No detailed measurement cards. Just layout + wiring.

Files modified:

ui/components/DecisionMapSheet.tsx — major
1a. New Types
Add near the top of DecisionMapSheet.tsx (or extract to ui/types/instrument.ts):


type PipelineLayer =
  | 'substrate'
  | 'mutual-graph'
  | 'basin-inversion'
  | 'query-relevance'
  | 'competitive-provenance'
  | 'continuous-field'
  | 'carrier-detection'
  | 'model-ordering'
  | 'blast-radius'
  | 'alignment'
  | 'raw-artifacts';

type SelectedEntity =
  | { type: 'claim'; id: string; label?: string }
  | { type: 'statement'; id: string }
  | { type: 'region'; id: string }
  | { type: 'model'; index: number }
  | null;
1b. State Changes
Replace the 5-tab state cluster with InstrumentState:

Remove:


// These go away entirely
const [activeTab, setActiveTab] = useState<...>('partition');
const [evidenceSubTab, ...] = useState<...>('statements');
const [landscapeSubTab, ...] = useState<...>('space');
const [partitionSubTab, ...] = useState<...>('graph');
const [synthesisSubTab, ...] = useState<...>('output');
// Also remove: evidenceStanceFilter, evidenceRefFilter, evidenceModelFilter,
// evidenceSignalFilters, evidenceContestedOnly, traversalSubTab, narrativeMode
Add:


const [selectedLayer, setSelectedLayer] = useState<PipelineLayer>('substrate');
const [selectedEntity, setSelectedEntity] = useState<SelectedEntity>(null);
const [spatialViewOpen, setSpatialViewOpen] = useState(false);
const [regionHullsVisible, setRegionHullsVisible] = useState(true);
const [claimCentroidsVisible, setClaimCentroidsVisible] = useState(false);
Keep (still needed):


const [selectedNode, ...] // Keep temporarily, wire to selectedEntity
const [sheetHeightRatio, ...] // Keep — sheet resize handle
1c. FieldHealthBar
New small component inline in DecisionMapSheet (or ui/components/FieldHealthBar.tsx).

Data sources (all already accessible in DecisionMapSheet scope):


const basinResult = (mappingArtifact as any)?.geometry?.basinInversion;
const substrate = (mappingArtifact as any)?.geometry?.substrate;
const mutualEdges = substrate?.mutualEdges || [];
const D = basinResult?.discriminationRange ?? null;
const T_v = basinResult?.T_v ?? null;
const basinCount = basinResult?.basinCount ?? null;
const mutualEdgeCount = mutualEdges.length;
const totalNodes = substrate?.nodes?.length ?? 0;
const participatingNodes = substrate?.nodes?.filter((n: any) => (n.mutualDegree ?? 0) > 0).length ?? 0;
const participationRate = totalNodes > 0 ? participatingNodes / totalNodes : null;
const pipelineVerdict = basinResult?.status ?? 'unknown';
Render (single horizontal bar, always visible at top of sheet):


D=0.147  T_v=0.412  3 basins  47 mutual edges  89% particip  ✓ geometry active
Color rule: D ≥ 0.10 → green text, 0.05 ≤ D < 0.10 → amber, D < 0.05 or status !== 'ok' → red/muted.

1d. Layout — Two Zones
Replace the tab-nav + tab-content structure with a two-zone horizontal split:


┌──────────────────────────────────────────────────────────┐
│  FieldHealthBar (always visible, full width, one line)   │
├────────────────────┬─────────────────────────────────────┤
│  Topology Map      │  Measurement Inspector               │
│  (~30% width)      │  (~70% width)                        │
│                    │                                      │
│  [existing         │  [Layer ▾] dropdown                  │
│   DecisionMapGraph]│  placeholder card content            │
│                    │                                      │
│  [Spatial ↗ toggle]│  (shows selected layer + entity)     │
└────────────────────┴─────────────────────────────────────┘
Keep existing sheetHeightRatio drag-resize for the sheet itself.

1e. Topology Map (Zone 2)
Reuse existing DecisionMapGraph. Wire selection:


const handleNodeClick = useCallback((node: any) => {
  setSelectedEntity({ type: 'claim', id: node.id, label: node.label });
}, []);
Add an onBackgroundClick callback (or click-away handler) → setSelectedEntity(null).

Add a small "Spatial ↗" toggle button below/overlaid on the map → setSpatialViewOpen(v => !v).
When spatialViewOpen: swap DecisionMapGraph out for the stripped ParagraphSpaceView in Zone 2.

ParagraphSpaceView in this mode receives only the L1 props it now accepts after P0 cleanup:


<ParagraphSpaceView
  graph={substrate}
  mutualEdges={mutualEdges}
  regions={preSemanticRegions}
  basinResult={basinResult}
  regionHullsVisible={regionHullsVisible}
  claimCentroidsVisible={claimCentroidsVisible}
  disabled={D == null || D < 0.05}
/>
1f. Measurement Inspector Shell (Zone 3)
Layer dropdown:


<select value={selectedLayer} onChange={e => setSelectedLayer(e.target.value as PipelineLayer)}>
  <option value="substrate">Substrate (L1)</option>
  <option value="mutual-graph">Mutual Graph (L1)</option>
  <option value="basin-inversion">Basin Inversion (L1)</option>
  <option value="query-relevance">Query Relevance (L1)</option>
  <option value="competitive-provenance" disabled>Competitive Provenance (Phase 1)</option>
  <option value="continuous-field" disabled>Continuous Field (Phase 2)</option>
  <option value="carrier-detection">Carrier Detection (L1)</option>
  <option value="model-ordering">Model Ordering (L1)</option>
  <option value="blast-radius">Blast Radius (L2 policy)</option>
  <option value="alignment">Alignment</option>
  <option value="raw-artifacts">Raw Artifacts</option>
</select>
Content area — Phase 1 renders a placeholder that proves selection is wired:


<div>
  <div>Layer: {selectedLayer}</div>
  <div>Entity: {selectedEntity ? `${selectedEntity.type} ${selectedEntity.id}` : 'Field (nothing selected)'}</div>
  {/* Temporarily host old panel content here for non-regression */}
</div>
The old tab system is removed entirely. Old panel content that has no Phase 1 card yet becomes temporarily inaccessible until Phase 2 migrates it — this is intentional. The mental model shift is immediate. Only Raw Artifacts (JSON dump) is the emergency escape hatch for anything not yet migrated.

Phase 2: L1 Layer Cards (after Phase 1)
Build measurement card components and migrate old panels into them. Delete old panel code as each migrates.

Layer	Card Component	Old Source	Delete After
Substrate	SubstrateCard	EmbeddingDistributionPanel + geometry subtab stats	Landscape > Geometry subtab (shape signals die here)
Mutual Graph	MutualGraphCard	Landscape > Regions subtab	Landscape > Regions
Basin Inversion	BasinInversionCard	InversionValleyPanel (in EntityProfilesPanel > Diagnostics)	InversionValleyPanel usage in Diagnostics
Query Relevance	QueryRelevanceCard	Landscape > Query subtab	Landscape > Query subtab
Blast Radius	BlastRadiusCard	Partition > Gates subtab (as-is, no restructure)	Gates subtab
BasinInversionCard note: InversionValleyPanel currently fetches its own embeddings via Chrome message and computes basin inversion itself. The new card reads from already-computed mappingArtifact.geometry.basinInversion — no fetch needed. Build fresh from artifact data.

ParagraphSpace becomes a toggle on MutualGraphCard and BasinInversionCard in this phase (a "Spatial View" button on those cards that sets spatialViewOpen).

EntityProfilesPanel → the design proposes a "Table View" toggle on each measurement card replacing the megacomponent. Phase 2 begins that migration (Claims and Statements tables are the first candidates, wired into SubstrateCard and Provenance card respectively).

Phases 3–5 (High-Level, Not Detailed Now)
Phase 3 — Competitive Provenance:

New CompetitiveProvenanceCard for layer competitive-provenance
Entropy distribution, per-claim bulk table, statement allocation detail
Cross-signal comparison panel (first instance): weight(S,C) vs old pruning relevance
Phase 4 — Cross-Signal Compare as primitive:

Generic comparison panel: any numeric measurement vs any other
Scatter plot + Pearson r + outlier highlighting
Lives at bottom of Zone 3
Phase 5 — Continuous Field:

New ContinuousFieldCard for layer continuous-field
z_claim, z_core, evidenceScore per statement
Disagreement matrix vs competitive allocation
Blast Radius restructure: Deferred. Migrate as-is in Phase 2 (BlastRadiusCard), evaluate later.

Data Paths Reference
All accessed via mappingArtifact = sheetData.mappingArtifact in DecisionMapSheet scope:

Data	Path
Basin result	mappingArtifact?.geometry?.basinInversion
Substrate graph	mappingArtifact?.geometry?.substrate
Mutual edges	mappingArtifact?.geometry?.substrate?.mutualEdges
Query relevance	mappingArtifact?.geometry?.query?.relevance
Blast radius filter	mappingArtifact?.blastRadiusFilter
Survey gates	mappingArtifact?.surveyGates
Pre-semantic	mappingArtifact?.geometry?.preSemantic
Shadow statements	mappingArtifact?.shadow?.statements
Not yet present in artifact (needed for Phase 2+):

provenanceBulk — in src/ConciergeService/claimAssembly.ts only, needs to be surfaced to artifact
extendedSimilarityStats — design refers to this; verify field name in artifact before building SubstrateCard
Critical Files
ui/components/DecisionMapSheet.tsx — primary target (5000+ lines, restructure)
ui/components/ParagraphSpaceView.tsx — P0 cleanup (1278 lines)
ui/components/entity-profiles/audit/InversionValleyPanel.tsx — superseded by BasinInversionCard in Phase 2
ui/components/entity-profiles/audit/EmbeddingDistributionPanel.tsx — superseded by SubstrateCard in Phase 2
ui/components/entity-profiles/EntityProfilesPanel.tsx — partially superseded in Phase 2
shared/contract.ts — type reference (BasinInversionResult, PipelineSubstrateGraph, etc.)
Verification
After P0:

ParagraphSpaceView renders without KNN edges, strong edges, or stance coloring
Basin coloring and region hulls still work
Disabled state shows overlay when basinResult.status !== 'ok'
After Phase 1:

Sheet opens to FieldHealthBar + two-zone layout (no old tab bar)
Clicking a claim node sets selectedEntity and the inspector heading updates
Clicking the background clears selection
Spatial toggle swaps between DecisionMapGraph and ParagraphSpaceView
Layer dropdown updates the inspector heading (content is placeholder)
Nothing is broken: old panel content accessible somewhere (e.g., Raw Artifacts or temporary passthrough)
After Phase 2:

Can operate the full system using only the layer dropdown + entity selection
Old tabs are completely gone
Basin Inversion card shows histogram, T_v, bridge table from artifact (no fetch)
Substrate card shows pairwise distribution stats
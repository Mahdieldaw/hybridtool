Here is Claude's plan:
╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
 Entity Profiles — Consolidated Measurement Surface

 Context

 Measurements are scattered across the pipeline: claim-level metrics in diagnostics.ts, per-statement scores in queryRelevance.ts, region profiles in profiles.ts, model ordering in modelOrdering.ts,
 provenance in claimProvenance.ts. Each was built for its immediate consumer, but there's no single surface where all measurements are visible, organized by what they measure.

 Additionally, DecisionMapObservabilityRow.tsx (1748 lines) was built as a parallel debug UI with 12 category tabs — but it is completely unwired: exported from its file, never imported by any component.
 Meanwhile, DecisionMapSheet has its own ad-hoc measurement displays scattered across sub-tabs.

 This creates the Entity Profiles panel: a 5th top-level tab in DecisionMapSheet that consolidates all pipeline measurements into 6 entity-oriented sub-tabs (Claims, Statements, Models, Regions, Edges,
 Substrate). Every measurement shows its Level (L1/L2/HEURISTIC), its pipeline origin, and its current consumer status.

 ---
 Architecture

 New files

 ┌───────────────────────────────────────────────────────┬────────────────────────────────────────────────────────────────────────────────────┐
 │                         File                          │                                      Purpose                                       │
 ├───────────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────┤
 │ ui/components/entity-profiles/EntityProfilesPanel.tsx │ Root: 6 sub-tabs, receives artifact + structuralAnalysis, delegates to entity tabs │
 ├───────────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────┤
 │ ui/components/entity-profiles/ClaimProfileTab.tsx     │ Claim entity table                                                                 │
 ├───────────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────┤
 │ ui/components/entity-profiles/StatementProfileTab.tsx │ Statement entity table                                                             │
 ├───────────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────┤
 │ ui/components/entity-profiles/ModelProfileTab.tsx     │ Model entity table                                                                 │
 ├───────────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────┤
 │ ui/components/entity-profiles/RegionProfileTab.tsx    │ Region entity table                                                                │
 ├───────────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────┤
 │ ui/components/entity-profiles/EdgeProfileTab.tsx      │ Edge entity table                                                                  │
 ├───────────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────┤
 │ ui/components/entity-profiles/SubstrateProfileTab.tsx │ Run-level globals (summary cards, not per-entity table)                            │
 ├───────────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────┤
 │ ui/components/entity-profiles/entity-utils.ts         │ Shared utilities extracted from DecisionMapObservabilityRow                        │
 └───────────────────────────────────────────────────────┴────────────────────────────────────────────────────────────────────────────────────┘

 Modified files

 ┌───────────────────────────────────────────────┬─────────────────────────────────────────────────────────────────────────────────────┐
 │                     File                      │                                       Change                                        │
 ├───────────────────────────────────────────────┼─────────────────────────────────────────────────────────────────────────────────────┤
 │ ui/components/DecisionMapSheet.tsx            │ Add 'entities' to tab union, add to tabConfig, import + render EntityProfilesPanel  │
 ├───────────────────────────────────────────────┼─────────────────────────────────────────────────────────────────────────────────────┤
 │ ui/components/DecisionMapObservabilityRow.tsx │ Replace inline utility definitions with imports from entity-utils.ts                │
 ├───────────────────────────────────────────────┼─────────────────────────────────────────────────────────────────────────────────────┤
 │ shared/cognitive-artifact.ts                  │ Thread claimProvenance, completeness, substrateSummary through to CognitiveArtifact │
 ├───────────────────────────────────────────────┼─────────────────────────────────────────────────────────────────────────────────────┤
 │ ui/styles/input.css                           │ Add decision-tab-active-entities CSS class                                          │
 └───────────────────────────────────────────────┴─────────────────────────────────────────────────────────────────────────────────────┘

 ---
 Step 1: Extract shared utilities

 From: ui/components/DecisionMapObservabilityRow.tsx (lines 30-207)
 To: ui/components/entity-profiles/entity-utils.ts

 Extract these (no behavior change):
 - Types: SummaryCard, Column<Row>, TableSpec<Row>
 - Pure functions: clamp01, safeNum, safeStr, safeArr, formatPct, formatNum, formatInt, badgeClass, compareNullable
 - Components: SummaryCardsRow, DataTable

 Then update DecisionMapObservabilityRow.tsx to import from ./entity-profiles/entity-utils.

 ---
 Step 2: Thread missing data through cognitive artifact

 File: shared/cognitive-artifact.ts

 The buildCognitiveArtifact function currently drops three data sources needed by entity profiles. Add at the end of the returned object (before closing }):

 // Entity profile data (passthrough from mapper artifact)
 claimProvenance: mapper?.claimProvenance ?? undefined,
 completeness: mapper?.completeness ?? undefined,
 substrateSummary: mapper?.substrate ?? undefined,

 These fields are already populated on the mapper artifact by StepExecutor.js (lines 1425-1438, 1486-1492). No existing code reads them from the cognitive artifact, so zero breakage risk. If the mapper
 doesn't have them (older runs), they resolve to undefined.

 ---
 Step 3: Add CSS for the Entities tab

 File: ui/styles/input.css — after the decision-tab-active-options block (~line 1265)

 Add decision-tab-active-entities using teal/cyan (doesn't conflict with existing violet/amber/emerald):

 .decision-tab-active-entities {
     background: rgba(6, 182, 212, 0.2);
     border-color: rgba(6, 182, 212, 0.5);
     color: #22d3ee;
     box-shadow: 0 0 20px rgba(6, 182, 212, 0.25), inset 0 0 12px rgba(6, 182, 212, 0.1);
 }

 ---
 Step 4: Create per-entity tab components

 Each tab follows the same pattern: receive artifact + structuralAnalysis as props, build summary cards + DataTable from available data, show "—" for missing values (safe accessors throughout).

 4a. ClaimProfileTab.tsx

 Data sources:
 - structuralAnalysis.claimsWithLeverage → EnrichedClaim[] (leverage, keystoneScore, all is* flags)
 - artifact.geometry.diagnostics.measurements.claimMeasurements → sourceCoherence, embeddingSpread, regionSpan, sourceModelDiversity
 - artifact.claimProvenance.claimExclusivity → exclusivityRatio per claim
 - artifact.claimProvenance.claimOverlap → pairwise Jaccard entries
 - artifact.geometry.query.relevance.statementScores → joined with sourceStatementIds to compute mean querySimilarity per claim

 Summary cards: Total claims, keystones, contested, isolated, avg leverage, avg coherence

 Main table columns (one row per claim):

 ┌───────────────────────┬───────┬────────────────────────────────────────┐
 │        Column         │ Level │                 Source                 │
 ├───────────────────────┼───────┼────────────────────────────────────────┤
 │ ID, Label             │ —     │ claim identity                         │
 ├───────────────────────┼───────┼────────────────────────────────────────┤
 │ supportRatio          │ L1    │ EnrichedClaim                          │
 ├───────────────────────┼───────┼────────────────────────────────────────┤
 │ exclusivityRatio      │ L1    │ claimProvenance                        │
 ├───────────────────────┼───────┼────────────────────────────────────────┤
 │ sourceCoherence       │ L1    │ diagnostics                            │
 ├───────────────────────┼───────┼────────────────────────────────────────┤
 │ embeddingSpread       │ L1    │ diagnostics                            │
 ├───────────────────────┼───────┼────────────────────────────────────────┤
 │ regionSpan            │ L1    │ diagnostics                            │
 ├───────────────────────┼───────┼────────────────────────────────────────┤
 │ sourceModelDiversity  │ L1    │ diagnostics                            │
 ├───────────────────────┼───────┼────────────────────────────────────────┤
 │ meanQuerySimilarity   │ L1    │ computed: avg querySim of source stmts │
 ├───────────────────────┼───────┼────────────────────────────────────────┤
 │ leverage              │ H     │ SA engine                              │
 ├───────────────────────┼───────┼────────────────────────────────────────┤
 │ keystoneScore         │ H     │ SA engine                              │
 ├───────────────────────┼───────┼────────────────────────────────────────┤
 │ Flags (K/C/Ch/I/Cond) │ H     │ SA engine                              │
 └───────────────────────┴───────┴────────────────────────────────────────┘

 Secondary table: Claim overlap (claimA, claimB, jaccard) — from claimProvenance.claimOverlap

 4b. StatementProfileTab.tsx

 Data sources:
 - artifact.shadow.statements → base statements with stance, signals, geometricCoordinates
 - artifact.geometry.query.relevance.statementScores → querySimilarity, recusant
 - artifact.claimProvenance.statementOwnership → which claims cite each
 - artifact.completeness.statementFates → fate classification

 Summary cards: Total, in-claims, orphaned, unaddressed, noise, avg querySimilarity

 Table columns (one row per statement):

 ┌───────────────────────┬───────┬──────────────────────┐
 │        Column         │ Level │        Source        │
 ├───────────────────────┼───────┼──────────────────────┤
 │ ID                    │ —     │ statement identity   │
 ├───────────────────────┼───────┼──────────────────────┤
 │ Model                 │ L1    │ shadow               │
 ├───────────────────────┼───────┼──────────────────────┤
 │ Region                │ L1    │ geometricCoordinates │
 ├───────────────────────┼───────┼──────────────────────┤
 │ querySimilarity       │ L1    │ queryRelevance       │
 ├───────────────────────┼───────┼──────────────────────┤
 │ isolationScore        │ L1    │ geometricCoordinates │
 ├───────────────────────┼───────┼──────────────────────┤
 │ Citing claims (count) │ L1    │ claimProvenance      │
 ├───────────────────────┼───────┼──────────────────────┤
 │ Fate                  │ L1    │ completeness         │
 ├───────────────────────┼───────┼──────────────────────┤
 │ Stance                │ L2    │ shadow               │
 ├───────────────────────┼───────┼──────────────────────┤
 │ Signals (S/T/C)       │ L2    │ shadow               │
 └───────────────────────┴───────┴──────────────────────┘

 4c. ModelProfileTab.tsx

 Data sources:
 - artifact.geometry.preSemantic.modelOrdering.scores → irreplaceability, breakdown

 Summary cards: Total models, max irreplaceability, sole carrier count

 Table columns (one row per model):

 ┌──────────────────────────┬───────┬──────────────────────────────────┐
 │          Column          │ Level │              Source              │
 ├──────────────────────────┼───────┼──────────────────────────────────┤
 │ Model Index              │ —     │ identity                         │
 ├──────────────────────────┼───────┼──────────────────────────────────┤
 │ irreplaceability         │ L1    │ modelOrdering                    │
 ├──────────────────────────┼───────┼──────────────────────────────────┤
 │ soloCarrierRegions       │ L1    │ modelOrdering breakdown          │
 ├──────────────────────────┼───────┼──────────────────────────────────┤
 │ lowDiversityContribution │ L1    │ modelOrdering breakdown          │
 ├──────────────────────────┼───────┼──────────────────────────────────┤
 │ totalParagraphsInRegions │ L1    │ modelOrdering breakdown          │
 ├──────────────────────────┼───────┼──────────────────────────────────┤
 │ queryRelevanceBoost      │ L1    │ modelOrdering (if query present) │
 └──────────────────────────┴───────┴──────────────────────────────────┘

 4d. RegionProfileTab.tsx

 Data sources:
 - artifact.geometry.preSemantic.regionProfiles → RegionProfile[]
 - artifact.geometry.preSemantic.regionization.regions → node membership

 Summary cards: Total regions, avg modelDiversity, avg internalDensity

 Table columns (one row per region):

 ┌──────────────────────────┬───────┬───────────────┐
 │          Column          │ Level │    Source     │
 ├──────────────────────────┼───────┼───────────────┤
 │ Region ID                │ —     │ identity      │
 ├──────────────────────────┼───────┼───────────────┤
 │ nodeCount                │ L1    │ regionization │
 ├──────────────────────────┼───────┼───────────────┤
 │ modelDiversity           │ L1    │ profiles      │
 ├──────────────────────────┼───────┼───────────────┤
 │ modelDiversityRatio      │ L1    │ profiles      │
 ├──────────────────────────┼───────┼───────────────┤
 │ internalDensity          │ L1    │ profiles      │
 ├──────────────────────────┼───────┼───────────────┤
 │ avgInternalSimilarity    │ L1    │ profiles      │
 ├──────────────────────────┼───────┼───────────────┤
 │ isolation                │ L1    │ profiles      │
 ├──────────────────────────┼───────┼───────────────┤
 │ nearestCarrierSimilarity │ L1    │ profiles      │
 └──────────────────────────┴───────┴───────────────┘

 4e. EdgeProfileTab.tsx

 Data sources:
 - artifact.geometry.diagnostics.measurements.edgeMeasurements → per-edge geometric measurements
 - artifact.semantic.edges → edge type labels

 Summary cards: Total edges, cross-region count, avg centroidSimilarity

 Table columns (one row per edge):

 ┌───────────────────────┬───────┬───────────────┐
 │        Column         │ Level │    Source     │
 ├───────────────────────┼───────┼───────────────┤
 │ Edge (from → to)      │ —     │ identity      │
 ├───────────────────────┼───────┼───────────────┤
 │ Type                  │ —     │ semantic edge │
 ├───────────────────────┼───────┼───────────────┤
 │ crossesRegionBoundary │ L1    │ diagnostics   │
 ├───────────────────────┼───────┼───────────────┤
 │ centroidSimilarity    │ L1    │ diagnostics   │
 ├───────────────────────┼───────┼───────────────┤
 │ fromRegion / toRegion │ L1    │ diagnostics   │
 └───────────────────────┴───────┴───────────────┘

 4f. SubstrateProfileTab.tsx

 Data sources:
 - artifact.substrateSummary → topology, shape (threaded in Step 2)
 - artifact.completeness.report → coverage ratios (threaded in Step 2)
 - artifact.geometry.preSemantic.pipelineGate → gate verdict

 Display: Summary cards only (this is run-level, not per-entity). Two sections:

 Topology cards: componentCount, largestComponentRatio, isolationRatio, globalStrongDensity

 Shape cards: fragmentationScore, bimodalityScore, parallelScore, prior (L2), confidence

 Coverage cards: Statement coverageRatio, region coverageRatio, unaddressed count

 Pipeline cards: Gate verdict, gate confidence

 ---
 Step 5: Create EntityProfilesPanel.tsx (root)

 interface EntityProfilesPanelProps {
   artifact: any;
   structuralAnalysis: StructuralAnalysis | null;
 }

 - State: activeEntityTab: 'claims' | 'statements' | 'models' | 'regions' | 'edges' | 'substrate'
 - Renders pill-tab row (same pattern as DecisionMapSheet sub-tabs) + delegates to the active entity tab component
 - Default tab: 'claims'

 ---
 Step 6: Wire into DecisionMapSheet.tsx

 File: ui/components/DecisionMapSheet.tsx

 1. Import EntityProfilesPanel from ./entity-profiles/EntityProfilesPanel
 2. Line 807 — extend tab union:
 useState<'evidence' | 'landscape' | 'partition' | 'synthesis' | 'entities'>('partition')
 3. Lines 1613-1618 — add to tabConfig:
 { key: 'entities' as const, label: 'Entities', activeClass: 'decision-tab-active-entities' },
 4. After the {activeTab === 'synthesis' && (...)} render block, add:
 {activeTab === 'entities' && (
   <EntityProfilesPanel
     artifact={mappingArtifact}
     structuralAnalysis={structuralAnalysis}
   />
 )}

 Both mappingArtifact and structuralAnalysis are already computed in DecisionMapSheet (lines 918-923 and 1090-1100).

 ---
 Data access paths (verified)

 ┌─────────────────────┬──────────────────────────────────────────────────────────────────────────────────────────────┐
 │        Data         │                     Access path from mappingArtifact (CognitiveArtifact)                     │
 ├─────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────┤
 │ Claims (raw)        │ artifact.semantic.claims                                                                     │
 ├─────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────┤
 │ Edges               │ artifact.semantic.edges                                                                      │
 ├─────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────┤
 │ Statements          │ artifact.shadow.statements                                                                   │
 ├─────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────┤
 │ Query relevance     │ artifact.geometry.query.relevance.statementScores                                            │
 ├─────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────┤
 │ Region profiles     │ artifact.geometry.preSemantic.regionProfiles                                                 │
 ├─────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────┤
 │ Regionization       │ artifact.geometry.preSemantic.regionization.regions OR artifact.geometry.preSemantic.regions │
 ├─────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────┤
 │ Model ordering      │ artifact.geometry.preSemantic.modelOrdering                                                  │
 ├─────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────┤
 │ Claim diagnostics   │ artifact.geometry.diagnostics.measurements.claimMeasurements                                 │
 ├─────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────┤
 │ Edge diagnostics    │ artifact.geometry.diagnostics.measurements.edgeMeasurements                                  │
 ├─────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────┤
 │ Pipeline gate       │ artifact.geometry.preSemantic.pipelineGate                                                   │
 ├─────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────┤
 │ Claim provenance    │ artifact.claimProvenance (after Step 2 threading)                                            │
 ├─────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────┤
 │ Statement fates     │ artifact.completeness.statementFates (after Step 2 threading)                                │
 ├─────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────┤
 │ Completeness report │ artifact.completeness.report (after Step 2 threading)                                        │
 ├─────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────┤
 │ Substrate summary   │ artifact.substrateSummary (after Step 2 threading)                                           │
 ├─────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────┤
 │ SA enriched claims  │ structuralAnalysis.claimsWithLeverage (computed client-side)                                 │
 └─────────────────────┴──────────────────────────────────────────────────────────────────────────────────────────────┘

 ---
 Verification

 1. npx tsc --noEmit — zero errors after all changes
 2. Open DecisionMapSheet, click "Entities" tab — all 6 sub-tabs render
 3. Each sub-tab shows summary cards + DataTable with measurements
 4. Missing data (older artifacts without diagnostics/provenance) shows "—" gracefully
 5. Existing tabs (Evidence, Landscape, Partition, Synthesis) unchanged
 6. DecisionMapObservabilityRow still compiles (now imports from entity-utils)

 ---
 Implementation order

 1. Extract entity-utils.ts + update DecisionMapObservabilityRow.tsx imports
 2. Thread data in shared/cognitive-artifact.ts (3 lines)
 3. Add CSS class in input.css
 4. Create entity tab components: SubstrateProfileTab → RegionProfileTab → ModelProfileTab → EdgeProfileTab → StatementProfileTab → ClaimProfileTab (simplest to most complex)
 5. Create EntityProfilesPanel.tsx
 6. Wire into DecisionMapSheet.tsx
 7. Verify with npx tsc --noEmit
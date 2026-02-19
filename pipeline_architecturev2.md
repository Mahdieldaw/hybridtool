# Disruption-First Pipeline: Architecture

Status markers throughout:
  ✅ IMPLEMENTED — code exists and runs
  🔲 PLANNED — architectural decision made, not yet built
  🔁 TRANSITIONAL — old system still runs, new system will replace

---

## 1. Full Phase Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ PHASE 1: SHADOW EXTRACTION  ✅ Unchanged                                    │
└─────────────────────────────────────────────────────────────────────────────┘

   BATCH RESPONSES (6 models) + User Query
         │
         ├─→ Pass 1: Mechanical Extraction
         │       │
         │       ├─→ Split → paragraphs → sentences → substantiveness filter
         │       └─→ Bare ShadowStatement[] (s_0...s_N)
         │             • text, stable ID, provenance (modelIndex, paragraphIndex)
         │             • placeholder stance + signals
         │
         └─→ Pass 2: Enrichment
                 │
                 ├─→ Embedding path: argmax stance over 6 labels, signal thresholds
                 ├─→ Regex fallback: pattern banks for stance + signals
                 └─→ Enriched ShadowStatement[]
                       ✓ OUTPUT: statements with stance (6 types), signals (3 flags),
                                 confidence, provenance
                       ✓ FULL INVENTORY — nothing dropped, nothing filtered

   Files: ShadowExtractor.ts, StatementTypes.ts, ExclusionRules.ts
   Stances: prescriptive|cautionary|prerequisite|dependent|assertive|uncertain
   Signals: conditional|sequence|tension (boolean flags, weight 3|2|1)


┌─────────────────────────────────────────────────────────────────────────────┐
│ PHASE 2: EMBEDDING  ✅ Unchanged                                            │
└─────────────────────────────────────────────────────────────────────────────┘

   ShadowStatement[]
         │
         ├─→ Statement Embeddings
         │     • Each statement text → vector via offscreen model (bge-base-en-v1.5)
         │     • Model runs in offscreen document, communicates via chrome.runtime
         │     • Backend tracked as webgpu|wasm|none at runtime
         │     ✓ OUTPUT: Map<statementId, Float32Array>
         │
         ├─→ Query Embedding
         │     • User query → single vector
         │     ✓ OUTPUT: Float32Array
         │
         └─→ Label Embeddings (cached, frozen)
               • 3 variants × (6 stances + 3 signals + 3 relationships) = 36 vectors
               • Validated via pairwise cosine separation
               ✓ OUTPUT: frozen label vectors for enrichment

   Files: embeddings.ts, distance.ts, EmbeddingController.js
   Transfer: large batches use IndexedDB binary transfer (Float32Array buffers)

   NOTE: The embedding model ONLY produces vectors. It does not cluster.
   Clustering is a separate algorithm (Phase 4a) that consumes these vectors.


┌─────────────────────────────────────────────────────────────────────────────┐
│ PHASE 3: QUERY RELEVANCE SCORING  ✅ Ranking-only (no filtering)            │
└─────────────────────────────────────────────────────────────────────────────┘

   All ShadowStatement[] + Query Embedding
         │
         ├─→ Per-statement: cosineSim(statementEmbed, queryEmbed)
         │
         ├─→ Scores attached to each statement
         │     • high / medium / low relevance tiers
         │     ✓ OUTPUT: relevance scores on every statement
         │
         ├─→ NO FILTERING — all statements proceed to geometry
         │     • Full landscape participates in substrate construction
         │     • No "condensed set" / no "parked set"
         │     • Relevance scores feed disruption scoring as a boost signal
         │
         └─→ UI FILTER (SpaceGraph only)  ✅
               • Dropdown: "All evidence" / "Query-relevant"
               • Filters display to high+medium relevance paragraphs
               • Disables when no relevance data exists
               • For tuning visibility — see what filtering would exclude

   Files: queryRelevance.ts, ParagraphSpaceView.tsx (L142-L222, L434-L451)
   Wiring: DecisionMapSheet.tsx (L2835-L2857)

   WHY RANKING-ONLY:
   The value of multi-model synthesis is precisely that models bring
   perspectives the user didn't anticipate. Pre-filtering by query
   relevance optimizes for confirming the user's frame rather than
   expanding it. The content most valuable to surface — the thing the
   user never would have asked about — has the lowest query similarity.
   Ranking preserves noise-reduction benefits (disruption scoring
   downranks low-relevance positions) without excluding structural
   participation.


┌─────────────────────────────────────────────────────────────────────────────┐
│ PHASE 4: GEOMETRY + CLUSTERING  ✅ Full landscape (no input narrowing)      │
└─────────────────────────────────────────────────────────────────────────────┘

   ALL Statements → projectParagraphs() → ALL Paragraphs
         │
         │  Two parallel tracks, both consuming paragraph embeddings:
         │
         ├─→ 4a. CLUSTERING (Hierarchical Agglomerative)  ✅
         │     │
         │     │  File: engine.ts (buildClusters → hierarchicalCluster)
         │     │
         │     ├─→ Input: paragraph embeddings + mutual kNN graph
         │     │     • Embeddings provide distance metric
         │     │     • Mutual graph guides merge decisions
         │     ├─→ Algorithm: HAC with adaptive merge threshold
         │     └─→ Output: Cluster[] (paragraph groupings by semantic similarity)
         │           • Fed into interpretation for region construction
         │           • NOT an embedding model output — a separate algorithm
         │
         └─→ 4b. SUBSTRATE CONSTRUCTION  ✅
               │
               │  File: substrate.ts (buildGeometricSubstrate)
               │
               ├─→ Pool paragraph embeddings (weighted mean of child statements)
               │     • Weights: confidence × signalBoosts
               │       (tension 1.3×, conditional 1.2×, sequence 1.1×)
               │     • L2-normalized after pooling
               │
               ├─→ kNN Graph (K=5, symmetric)
               │     • Always-on connectivity field
               │
               ├─→ Mutual Graph (bidirectional edges only)
               │     • High-precision backbone
               │     • K=5 mutual-kNN by default (substrate.ts:L30-L35)
               │
               ├─→ Strong Graph (above soft threshold)
               │     • Most conservative view
               │
               ├─→ Topology: connected components, density, isolation ratio
               │
               └─→ Shape Prior: fragmented | convergent_core | bimodal_fork
                     | parallel_components
                     │
                     └─→ GeometricSubstrate
                           ✓ OUTPUT: 3 graph layers + topology + node stats
                                     + shape prior + similarity statistics

   Files: substrate.ts, knn.ts, threshold.ts, topology.ts, nodes.ts, shape.ts
   Orchestration: StepExecutor.js (L578-L776 embeddings+substrate,
                                   L848-L856 clustering)


┌─────────────────────────────────────────────────────────────────────────────┐
│ PHASE 5: INTERPRETATION  ✅ + nearestCarrierSimilarity added               │
└─────────────────────────────────────────────────────────────────────────────┘

   GeometricSubstrate + ALL Paragraphs + Clusters (from 4a)
         │
         │  Orchestrator: buildPreSemanticInterpretation()
         │  File: interpretation/index.ts (L45-L55)
         │
         ├─→ Lens: adaptive regime detection (deriveLens)
         │     • convergent_core | bimodal_fork | parallel_components | fragmented
         │     • Determines whether clustering should run, merge thresholds
         │
         ├─→ Regions: built in layers (buildRegions)
         │     │
         │     │  File: regions.ts (L90-L179)
         │     │
         │     ├─→ Layer 1: Clusters → Region (kind: "cluster")
         │     │     • When lens allows clustering AND clusters produced
         │     │     • Multi-paragraph clusters become first-class regions
         │     │     (regions.ts:L103-L112)
         │     │
         │     ├─→ Layer 2: Uncovered strong-components → Region (kind: "component")
         │     │     • Paragraphs not covered by any cluster
         │     │     • Grouped by connected components in strong graph
         │     │     (regions.ts:L113-L123)
         │     │
         │     └─→ Layer 3: Remaining → mutual-neighborhood patches (kind: "patch")
         │           • Paragraphs still uncovered after layers 1-2
         │           • Grouped by mutual-kNN neighborhood proximity
         │           (regions.ts:L125-L146)
         │
         ├─→ Profiles: per-region tier + purity + geometry (profileRegions)
         │     • Tier: peak (high model diversity + density) / hill / floor
         │     • Purity: dominant stance, unanimity, contested ratio, stance variety
         │     • Geometry: internal density, isolation, avg internal similarity
         │     • ✅ NEW: nearestCarrierSimilarity per region
         │       (profiles.ts:L123-L149, types.ts:L40-L63)
         │       Max mutual-edge similarity from any node in this region
         │       to any node in another region. Measures redundancy —
         │       high value = this region's content is echoed elsewhere.
         │
         ├─→ Oppositions: region pairs with stance inversion (detectOppositions)
         │
         └─→ Inter-Region Signals: conflict|support|tradeoff|independent
               (detectInterRegionSignals)
               │
               └─→ PreSemanticInterpretation
                     ✓ OUTPUT: lens, regions[], profiles[] (with carrier similarity),
                               oppositions[], interRegionSignals[]
                     ✓ Feeds → Disruption Scoring, Jury Construction,
                               Conditional Gate Scanning, UI visualization

   Files: interpretation/lens.ts, regions.ts, profiles.ts, opposition.ts,
          guidance.ts, validation.ts, index.ts, types.ts
   Wiring: StepExecutor.js (L888-L894)


┌─────────────────────────────────────────────────────────────────────────────┐
│ PHASE 5.5: CONDITIONAL GATE SCANNING  ✅ Existing (conditionalFinder)       │
└─────────────────────────────────────────────────────────────────────────────┘

   Regions + Shadow Statements + Statement Embeddings
         │
         │  Catches: situational dependencies where all models AGREE on advice
         │  but ASSUME different contexts. No opposition in the landscape —
         │  just silently divergent assumptions.
         │
         ├─→ Clause extraction: regex-first patterns (if/when/unless/etc)
         │     (conditionalFinder.ts:L71-L163)
         │
         ├─→ Clause clustering: embedding similarity (≥0.8) or normalized
         │     string equality — groups duplicate conditions
         │
         ├─→ Impact ranking: by affected claim/statement population
         │     (conditionalFinder.ts:L427-L590)
         │
         └─→ ConditionalGate[]
               ✓ OUTPUT: gates with source provenance, affected populations,
                         templated questions from conditional clauses
               ✓ These are NOT partition-type forks — they are context checks
               ✓ "Do you have X?" not "Which approach do you prefer?"

   Files: conditionalFinder.ts, deriveConditionalGates.ts

   RELATIONSHIP TO PARTITIONS:
   Partitions (from mapper, Phase 8) find binary forks — mutually exclusive
   positions where the user must choose.
   Conditional gates find contextual dependencies — positions that all agree
   but assume facts about the user's situation.
   These are complementary, not redundant. Both produce traversal questions.
   Both feed the same traversal interface. Both prune when answered.

  Current state:
  - The legacy conditionalFinder path still runs inside buildMechanicalTraversal().
  - The disruption-first path also derives region-based conditional gates from
    gate-candidate regions (routing + regionGates).
  - Question merge can combine emitted mapper partitions + region gates into a
    unified TraversalQuestion[] list, but the UI is still transitional.


┌─────────────────────────────────────────────────────────────────────────────┐
│ PHASE 6: DISRUPTION SCORING  ✅ Uniqueness-based (not consensus-based)      │
└─────────────────────────────────────────────────────────────────────────────┘

   ALL Statements + Substrate + Interpretation (with carrier similarity)
         │
         │  Core insight: "disruption" means "what happens to the output if
         │  this position disappears" — NOT "how much evidence supports it."
         │  Consensus has LOW disruption (remove it, carriers survive).
         │  Unique minority positions have HIGH disruption (remove it, gone).
         │
         ├─→ Per-region scoring:
         │     │
         │     ├─→ uniqueness = 1 / (1 + nearestCarrierSimilarity)  ✅
         │     │     • nearestCarrierSimilarity: max mutual-edge similarity
         │     │       from any node in this region to any node in another region
         │     │     • High uniqueness = nothing else in the landscape
         │     │       carries this position. Removing it loses the insight.
         │     │     • Low uniqueness = echoed by nearby regions. Redundant.
         │     │     (index.ts:L269-L292)
         │     │
         │     ├─→ modelDiversity: distinct models in region
         │     │     • BOOST, not multiplier: × (1 + modelDiversity × 0.1)
         │     │     • Unique position from 1 model still scores high
         │     │     • Same position from 3 models scores slightly higher
         │     │       (less likely to be hallucination)
         │     │
         │     ├─→ stanceWeight: priority-based [0.5, 1.0]
         │     │     • prescriptive/cautionary: high (action-driving)
         │     │     • assertive: low (contextual, not pruning-relevant)
         │     │
         ├─→ disruption = uniqueness × stanceWeight × (1 + modelDiversity × 0.1)
         │
         └─→ Ranked Statements (by disruption composite)
               ✓ OUTPUT: per-statement disruption scores + ranked list
               ✓ Used downstream for worklist selection, routing, and ordering
               ✓ Uniqueness-first: outliers and minority positions score HIGH
               ✓ Consensus positions score LOW (carriers everywhere)

   WHAT CHANGED FROM ORIGINAL PLAN:
   Original: disruption = clusterSize × modelDiversity × stanceWeight × isolation
   Problem:  strongly favored large, model-diverse clusters (= consensus)
   Now:      disruption = uniqueness × stanceWeight × (1 + modelDiversity × 0.1)
   Effect:   small unique clusters outrank large redundant ones


┌─────────────────────────────────────────────────────────────────────────────┐
│ PHASE 6.5: ROUTING + REGION GATES  ✅ Implemented                            │
└─────────────────────────────────────────────────────────────────────────────┘

   PreSemanticInterpretation + Disruption scores
         │
         ├─→ routeRegions():
         │     • Partition candidates: regions participating in opposition pairs
         │       and/or conflict/tradeoff inter-region signals
         │     • Gate candidates: conditional density above threshold AND
         │       disruption above the P25 disruption threshold
         │
         └─→ deriveRegionConditionalGates():
               ✓ OUTPUT: RegionConditionalGate[] for gate-candidate regions
               ✓ These are merged with mapper partitions downstream


┌─────────────────────────────────────────────────────────────────────────────┐
│ PHASE 7: JURY CONSTRUCTION  ✅ Implemented                                   │
└─────────────────────────────────────────────────────────────────────────────┘

   Focal Statements (from worklist) + Regions + ALL Statements
         │
         └─→ Per focal statement, assemble jury:
               │
               ├─→ 1 centroid per major region (closest to own region center)
               │     + 1 high-signal peripheral if region ≥ 5 statements
               │     Major region: ≥ 3 statements or ≥ 2 models
               │
               ├─→ 1 outlier (most geometrically isolated, not in major region)
               │
               └─→ 1 dissenter (stance-opposed, topic-close, query-relevance-differential)
               │     • weighted pick: 0.60*cosSim + 0.25*pickScore + 0.15*|ΔqueryRel|
               │     • cosine floor: ~0.35 (drops to ~0.25 if pool too small)
               │
               └─→ Worklist: Array<{ focal, disruptionScore, jury[] }>
                     ✓ OUTPUT: 5-8 entries, each with focal + 8-15 jury members
                     ✓ Jury members carry: text, ID, region, stance, selection reason
                     ✓ Same statement may appear in multiple juries (intentional)
                     ✓ Every major region appears at least once across all juries


┌─────────────────────────────────────────────────────────────────────────────┐
│ PHASE 8: MAPPER  ✅ Implemented (annotation mandate, not extraction)         │
└─────────────────────────────────────────────────────────────────────────────┘

   Worklist + User Query
         │
         └─→ Single LLM Call
               │
               ├─→ INPUT FORMAT (disruption-first path):
               │     User Query: [text]
               │     --- Focal 1 (highest impact) ---
               │     [s_42] statement text — Model 3
               │     Jury:
               │       [s_07] centroid region A — Model 1
               │       [s_19] centroid region B — Model 2
               │       [s_31] high-signal region B — Model 4
               │       [s_55] outlier — Model 6
               │       [s_12] dissenter — Model 1
               │     --- Focal 2 ---
               │     ...
               │
               ├─→ TASK: For each focal-jury pair:
               │     1. Identify genuinely incompatible positions
               │     2. Name the factual hinge (binary, about user's reality)
               │     3. Assign default side
               │     Questions must be answerable by someone who has never
               │     encountered the technical terms in the statements.
               │
               ├─→ PRIMARY OUTPUT:
               │     partitions[]: {
               │       focalId, sides: [{ statementIds[], label }],
               │       hingeQuestion, defaultSide
               │     }
               │     • Statement IDs referenced explicitly ([s_42]) — parser
               │       maps back to inventory by ID, not text matching
               │     • Binary only for v1. Three-way → "what binary question
               │       eliminates the most material?"
               │
               └─→ EMERGENT OUTPUT (end of response):
                     emergentForks[]: {
                       statementIds: [sideA[], sideB[]],
                       description, hingeQuestion
                     }
                     • Cross-cutting tensions between jury members
                     • Not focal-centric — mapper's reading comprehension bonus
                     • Lower confidence, validated same as primaries
                     • Retroactive disruption impact_score computed from involved
                       statements' existing disruption scores (StepExecutor)


┌─────────────────────────────────────────────────────────────────────────────┐
│ PHASE 9: ADVOCACY VALIDATION  ✅ Implemented                                 │
└─────────────────────────────────────────────────────────────────────────────┘

   Mapper Partitions + Substrate + Statement Embeddings
         │
         ├─→ Per partition:
         │     ├─→ Topical alignment: sides in related but distinct neighborhoods?
         │     ├─→ Stance consistency: statements on each side compatible stances?
         │     └─→ Directional differential: sim(sideA, focalA) > sim(sideA, focalB)?
         │
         ├─→ Advocacy Expansion:
         │     • Similarity-threshold recruitment (default ≈0.72 cosine) using
         │       statement embeddings, with a small region-alignment boost
         │     • Contested statements are deconflicted so partitions stay disjoint
         │
         └─→ Validated Partitions
               ✓ OUTPUT: partitions with confidence scores + expanded side populations
               ✓ Low-confidence partitions downranked or excluded

   Build the interface first. Implement when mapper outputs are available
   for evaluation. May not be needed if mapper reliability is high enough.


┌─────────────────────────────────────────────────────────────────────────────┐
│ PHASE 10: TRAVERSAL  🔁 Transitional                                        │
│ (pipeline emits TraversalQuestion[]; UI still renders legacy paths)          │
└─────────────────────────────────────────────────────────────────────────────┘

   Partition Questions (from mapper) + Region Conditional Gates (from Phase 6.5)
         │
         ├─→ Unified question ordering (questionMerge):
         │     • Priority sort using disruption-derived scoring, with a partition-type boost
         │     • blockedBy computed from region-centroid cosine proximity
   │     • Auto-resolution: conditional questions can be auto-resolved when
   │       ≥80% of their affected statements are already pruned (implemented,
   │       currently depends on traversal/UI passing pruned statement IDs)
         │
         ├─→ Cap: max 4-5 questions total across both types
         │
         ├─→ Present to user:
         │     • Binary or forced-choice
         │     • About user's reality, not technical preferences
         │     • Skip option always available
         │     • Question source type invisible to user (partitions and
         │       conditions feel the same — both are reality checks)
         │
         └─→ TraversalState
               ✓ OUTPUT: resolved partitions + selected sides
                         + resolved conditionals + gate answers
               ✓ OR: user skipped → all statements PROTECTED

   Currently running:
   - questionMerge can emit TraversalQuestion[] onto the artifact (pipeline-side)
   - UI remains transitional (ForcingPoint[] traversal + separate partition widget)
   - buildMechanicalTraversal() remains the fallback when mapper partitions are not emitted


┌─────────────────────────────────────────────────────────────────────────────┐
│ PHASE 11: PRUNING  🔁 Transitional                                          │
│ (dual-regime pruning exists; region-index pruning is still planned)         │
└─────────────────────────────────────────────────────────────────────────────┘

   TraversalState + Full Statement Inventory + Regions
         │
         ├─→ REGIME 1: Partition-Based Pruning  ✅
         │     (fork-participating statements only)
         │     │
         │     ├─→ For each resolved partition where user chose side A:
         │     │     ├─→ Side B advocacy (region-mates with aligned stance) → REMOVE
         │     │     ├─→ Side B counterevidence supporting A → PROTECTED
         │     │     └─→ Side B non-advocacy context → PROTECTED
         │     │
         │     └─→ Precedence: partition decisions override all other triage
         │
         ├─→ REGIME 2: Claim-Based Skeletonization + Passthrough  ✅
         │     │
         │     │  Uses claimStatuses as the pruning index today; regions-as-claims remains planned
         │     │
   │     ├─→ Claims marked pruned in traversalState are pruning targets
   │     │     (skeletonization cascade decides REMOVE vs SKELETONIZE vs PROTECTED)
   │     │
   │     └─→ Statements not linked to any pruning target pass through intact
         │
         ├─→ CONDITIONAL GATE PRUNING  ✅
         │     │
         │     ├─→ For each resolved conditional where user answered NO:
   │     │     └─→ Each affected statement becomes a pseudo-claim pruning target
   │     │         (then the normal skeletonization cascade decides REMOVE/SKELETONIZE)
         │     │
         │     └─→ Same conservative cascade as skeletonization
         │
         └─→ Merge all regimes → single TriageResult
               │
               └─→ reconstructSubstrate()
                     ├─→ PROTECTED / UNTRIAGED → intact text
                     ├─→ SKELETONIZE → compressed (nouns, numbers, names)
                     ├─→ REMOVE → omitted
                     └─→ Empty paragraphs → [...] markers
                           │
                           └─→ ChewedSubstrate
                                 ✓ OUTPUT: per-model reconstructed text

   Files (existing): TriageEngine.ts, CarrierDetector.ts, Skeletonizer.ts,
                     SubstrateReconstructor.ts


┌─────────────────────────────────────────────────────────────────────────────┐
│ PHASE 12: SYNTHESIS  ✅ Unchanged (V8 inversion holds)                      │
└─────────────────────────────────────────────────────────────────────────────┘

   ChewedSubstrate + User Context
         │
         └─→ Concierge LLM Call
               │
               ├─→ INPUT: chewed text (not claim labels, not abstractions)
               ├─→ Original model outputs carved by user's reality
               ├─→ Cannot resurrect pruned material
               ├─→ Cannot blend eliminated paths
               │
               └─→ Final Synthesis
                     ✓ OUTPUT: recommendation grounded in surviving evidence
```

---

## 2. Dependency Graph

```
User Query ──────────────────────────────────────────────┐
                                                         │
Batch Responses ──→ [1.SHADOW] ──→ Full Statements       │
                                       │                 │
                                       v                 │
                                  [2.EMBED] ─────────────┤
                                       │                 │
                              Statement Embeddings       │
                              Query Embedding            │
                                       │                 │
                                  [3.SCORE]              │
                                       │                 │
                              Statements + relevance     │
                              scores (nothing removed)   │
                                       │                 │
                         ┌─────────────┤                 │
                         │             │                 │
                    [4.CLUSTER]   [4.SUBSTRATE]          │
                    (HAC on        (kNN, mutual,         │
                     embeddings     strong graphs,       │
                     + mutual       topology,            │
                     graph)         shape prior)         │
                         │             │                 │
                         └──────┬──────┘                 │
                                │                        │
                         [5.INTERPRET]                   │
                                │                        │
                    Regions + Profiles (with              │
                    nearestCarrierSimilarity)             │
                    + Oppositions                        │
                    + Inter-Region Signals               │
                                │                        │
                    ┌───────────┼───────────┐            │
                    │           │           │            │
              [5.5.COND]  [6.DISRUPT] [viz data]        │
              conditional  uniqueness-   (for UI)       │
              gate scan    based ranking                │
                    │           │                        │
                    │      [7.JURY]                      │
                    │           │                        │
                    │      Worklist                      │
                    │      (focal+jury)                  │
                    │           │                        │
                    │      [8.MAPPER] ←─────────────────┘
                    │           │       (uses query)
                    │      Partitions
                    │           │
                    │      [9.VALIDATE]
                    │           │
                    │      Validated Partitions
                    │           │
                    └─────┬─────┘
                          │
                    [10.TRAVERSE]  ←─── USER ANSWERS
                          │
                    TraversalState
                    (partition resolutions
                     + conditional resolutions)
                          │
                    [11.PRUNE]
                          │
                    ChewedSubstrate
                          │
                    [12.SYNTHESIZE] ←── User Query
                          │
                    Final Output
```

---

## 3. Regions as Claims (Planned Transition)  🔲

```
THE PROBLEM:
The claim system served two functions the refactored pipeline still needs:
  1. PRUNING INDEX — claims determined which statements survived or were pruned
  2. UI SEMANTIC LAYER — decision map, force graph, structural analysis all
     render claims as nodes

The refactored mapper produces partition annotations, not claims.
Partitions give pruning handles for fork-participating statements.
But statements outside any partition have no pruning handle.

THE RESOLUTION:
Regions become the new claims.

┌─────────────────────────────────────────────────────────────────────┐
│                                                                     │
│   CLAIMS (current)                REGIONS (planned replacement)     │
│                                                                     │
│   LLM-extracted positions         Geometrically-derived clusters   │
│   Mapper decides what positions   Embedding space decides where    │
│   exist (lossy — missed = gone)   clusters form (complete — every  │
│                                   statement belongs somewhere)     │
│                                                                     │
│   sourceStatementIds on each      Member paragraphs/statements     │
│   claim → pruning index           per region → pruning index       │
│                                                                     │
│   Rendered as nodes in force      Rendered as nodes in force       │
│   graph + decision map            graph + decision map             │
│                                                                     │
│   Structural analysis enriches    Region profiles already provide  │
│   claims with leverage, keystones tier, purity, stance, geometry   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘

WHAT REGIONS PROVIDE THAT CLAIMS DIDN'T:
  • Deterministic: same embeddings → same regions (no LLM variance)
  • Complete: every statement belongs to a region or is explicitly an outlier
  • Auditable: you can see exactly why two statements are in different regions
    (their embeddings were distant) vs trusting mapper grouping judgment

WHAT'S LOST:
  • Mapper's ability to group geometrically distant statements that make the
    same point in different language. This is bounded by embedding quality —
    good embeddings track content similarity closely enough that geometric
    groupings approximate semantic groupings.

HOW PRUNING CHANGES:
  • Partition resolved (user chose side A):
    Side B's region members with aligned stance → REMOVE (Regime 1)
  • Region mapper-evaluated but user skipped:
    Region members remain eligible for the skeletonization cascade (Regime 2)
  • Region never evaluated by mapper:
    All members UNTRIAGED — pass through intact (conservative default)
  • Conditional gate resolved (user answered NO):
    Affected region members become pruning targets; cascade decides REMOVE/SKELETONIZE

HOW UI CHANGES:
  • Force graph: regions as nodes, inter-region signals as edges
  • Decision map: partition assignments as region coloring
  • Space graph: already works with regions (geometric)
  • Centroid statement represents region in labels/tooltips
```

---

## 4. Collapsed Module Architecture (4 Modules)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│   MODULE 1: EVIDENCE                                                        │
│   "Turn raw text into addressable, scored evidence"                         │
│                                                                             │
│   Absorbs: Shadow (P1) + Embedding (P2) + Query Relevance Scoring (P3)     │
│                                                                             │
│   ┌───────────────────────────────────────────────────────────────────┐     │
│   │ INPUT                                                             │     │
│   │   • rawResponses: Array<{ modelIndex, content }>                  │     │
│   │   • userQuery: string                                             │     │
│   │                                                                   │     │
│   │ INTERNAL (hidden)                                                 │     │
│   │   • sentence splitting, stance classification, signal detection   │     │
│   │   • embedding generation (statements, query, labels)              │     │
│   │   • query relevance scoring (cosine sim, no filtering)            │     │
│   │                                                                   │     │
│   │ OUTPUT                                                            │     │
│   │   • evidence: {                                                   │     │
│   │       statements: ShadowStatement[],   ← ALL statements, scored  │     │
│   │       paragraphs: ShadowParagraph[],   ← ALL paragraphs          │     │
│   │       embeddings: {                                               │     │
│   │         statements: Map<id, Float32Array>,                        │     │
│   │         paragraphs: Map<id, Float32Array>,                        │     │
│   │         query: Float32Array                                       │     │
│   │       },                                                          │     │
│   │       queryRelevance: Map<id, number>  ← scores, not filters     │     │
│   │     }                                                             │     │
│   └───────────────────────────────────────────────────────────────────┘     │
│                                                                             │
│   No "condensed" / "parked" distinction. One inventory, fully scored.       │
│                                                                             │
└────────────────────────────────┬────────────────────────────────────────────┘
                                 │
                                 │  evidence (full inventory + embeddings + scores)
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│   MODULE 2: LANDSCAPE                                                       │
│   "Measure the terrain, find where it splits, flag what's conditional"      │
│                                                                             │
│   Absorbs: Clustering (P4a) + Substrate (P4b) + Interpretation (P5) +      │
│            Conditional Scanning (P5.5) + Disruption (P6) +                  │
│            Jury Construction (P7)                                           │
│                                                                             │
│   ┌───────────────────────────────────────────────────────────────────┐     │
│   │ INPUT                                                             │     │
│   │   • evidence (from Module 1)                                      │     │
│   │                                                                   │     │
│   │ INTERNAL (hidden)                                                 │     │
│   │   • HAC clustering on paragraph embeddings + mutual graph         │     │
│   │   • kNN / mutual / strong graph construction                      │     │
│   │   • UMAP layout for visualization                                 │     │
│   │   • lens → regions (cluster|component|patch) → profiles           │     │
│   │   • nearestCarrierSimilarity per region                           │     │
│   │   • opposition + inter-region signal detection                    │     │
│   │   • conditional gate scanning (regex clause extraction,           │     │
│   │     embedding clustering, impact ranking)                         │     │
│   │   • uniqueness-based disruption scoring                           │     │
│   │   • jury assembly (centroids, outliers, dissenters)               │     │
│   │                                                                   │     │
│   │ OUTPUT                                                            │     │
│   │   • worklist: Array<{                  ← for mapper              │     │
│   │       focal: { id, text, disruptionScore },                       │     │
│   │       jury: Array<{ id, text, region, stance, role }>             │     │
│   │     }>                                                            │     │
│   │   • conditionalGates: Array<{          ← for traversal           │     │
│   │       question: string,                                           │     │
│   │       affectedStatementIds: string[],                             │     │
│   │       sourceProvenance,                                           │     │
│   │       impactScore: number                                         │     │
│   │     }>                                                            │     │
│   │   • regions: Region[]                  ← pruning index (planned) │     │
│   │   • visualization: {                   ← for UI only             │     │
│   │       substrate: GeometricSubstrate,                              │     │
│   │       regions: Region[],                                          │     │
│   │       profiles: RegionProfile[]                                   │     │
│   │     }                                                             │     │
│   └───────────────────────────────────────────────────────────────────┘     │
│                                                                             │
│   THREE OUTPUTS for three consumers:                                        │
│     worklist → Partition module (mapper's input)                            │
│     conditionalGates → Partition module (interleaved with partitions)       │
│     visualization → UI (Space Graph, Decision Map)                          │
│     regions → Synthesis module (pruning index, once regions-as-claims)      │
│                                                                             │
│   UMAP is the most expensive computation here and is NOT on the critical   │
│   path — the mapper doesn't need 2D coordinates. Can be computed lazily    │
│   or in parallel with disruption scoring for a latency win.                │
│                                                                             │
└────────────────────────────────┬────────────────────────────────────────────┘
                                 │
                                 │  worklist + conditionalGates
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│   MODULE 3: PARTITION                                                       │
│   "Find the genuine forks, validate, merge with conditionals, present"      │
│                                                                             │
│   Absorbs: Mapper (P8) + Advocacy Validation (P9) + Traversal (P10)        │
│                                                                             │
│   ┌───────────────────────────────────────────────────────────────────┐     │
│   │ INPUT                                                             │     │
│   │   • worklist (from Module 2)                                      │     │
│   │   • conditionalGates (from Module 2)                              │     │
│   │   • userQuery: string                                             │     │
│   │   • evidence.embeddings (for validation)                          │     │
│   │                                                                   │     │
│   │ INTERNAL (hidden)                                                 │     │
│   │   • LLM call: annotate focal-jury pairs for incompatibilities     │     │
│   │   • parse partitions + emergent forks                             │     │
│   │   • mechanical plausibility check (if implemented)                │     │
│   │   • advocacy expansion (jury members recruit region-mates)        │     │
│   │   • unified question ordering:                                    │     │
│   │     1. Mapper partitions (by disruption score)                    │     │
│   │     2. Conditional gates (by impact score)                        │     │
│   │     3. Emergent forks (retroactive disruption)                    │     │
│   │   • Cap: max 4-5 questions total                                  │     │
│   │                                                                   │     │
│   │ OUTPUT                                                            │     │
│   │   • questions: Array<{                  ← for UI to present       │     │
│   │       id: string,                                                 │     │
│   │       hingeQuestion: string,                                      │     │
│   │       type: 'partition' | 'conditional' | 'emergent',             │     │
│   │       sides?: [{ label, statementIds[] }],  (partitions)          │     │
│   │       affectedStatementIds?: string[],      (conditionals)        │     │
│   │       defaultSide?: number,                                       │     │
│   │       confidence: number,                                         │     │
│   │     }>                                                            │     │
│   │   • resolve(answers): TraversalState    ← called after user acts  │     │
│   │                                                                   │     │
│   │ FALLBACK                                                          │     │
│   │   • If mapper returns 0 partitions + high-opposition exists:      │     │
│   │     → fall back to existing gate derivation system                │     │
│   │     → adapter converts TraversalAnalysis → unified question fmt   │     │
│   └───────────────────────────────────────────────────────────────────┘     │
│                                                                             │
│   Question source type is invisible to the user. Partitions and             │
│   conditionals feel the same — both are reality checks. The user            │
│   sees "Do you have a large team?" regardless of whether it came            │
│   from the mapper (partition) or conditionalFinder (gate).                  │
│                                                                             │
└────────────────────────────────┬────────────────────────────────────────────┘
                                 │
                                 │  TraversalState
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│   MODULE 4: SYNTHESIS                                                       │
│   "Carve the evidence and write the answer"                                 │
│                                                                             │
│   Absorbs: Pruning (P11) + Concierge (P12)                                 │
│                                                                             │
│   ┌───────────────────────────────────────────────────────────────────┐     │
│   │ INPUT                                                             │     │
│   │   • traversalState (from Module 3)                                │     │
│   │   • evidence (from Module 1) — full statements + embeddings       │     │
│   │   • regions (from Module 2) — pruning index                       │     │
│   │   • questions (from Module 3) — partition + conditional details    │     │
│   │   • rawResponses — original model text for reconstruction         │     │
│   │   • userQuery                                                     │     │
│   │                                                                   │     │
│   │ INTERNAL (hidden)                                                 │     │
│   │   • partition-based pruning: losing side's advocacy → REMOVE      │     │
│   │   • conditional gate pruning: NO-answered gates' affected          │     │
│   │     statements → REMOVE/SKELETONIZE                               │     │
│   │   • region-based triage for unevaluated regions → UNTRIAGED       │     │
│   │   • skeletonization cascade for skipped questions                  │     │
│   │   • merge all regimes → single TriageResult                       │     │
│   │   • reconstructSubstrate() → ChewedSubstrate                     │     │
│   │   • concierge LLM call on chewed text                             │     │
│   │                                                                   │     │
│   │ OUTPUT                                                            │     │
│   │   • synthesis: string          ← final recommendation             │     │
│   │   • debug?: {                                                     │     │
│   │       chewedSubstrate,                                            │     │
│   │       triageResult,                                               │     │
│   │       regionFates: Map<regionId, 'resolved'|'skipped'|'unseen'>   │     │
│   │     }                                                             │     │
│   └───────────────────────────────────────────────────────────────────┘     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 5. The Four-Module Pipeline (Clean View)

```
    Batch Responses + User Query
              │
              ▼
    ┌──────────────────┐
    │                  │
    │    EVIDENCE      │   "What was said?"
    │                  │
    │  Shadow+Embed    │   Extract → embed → score relevance (no filtering)
    │  +Relevance      │
    │                  │   OUT: full inventory + embeddings + relevance scores
    └────────┬─────────┘
             │
             ▼
    ┌──────────────────┐
    │                  │
    │   LANDSCAPE      │   "Where does it split? What's conditional?"
    │                  │
    │  Cluster+Geom    │   HAC → substrate → regions → disruption → jury
    │  +Interpret      │   + conditional gate scanning
    │  +Disruption     │
    │  +Conditionals   │   OUT: worklist + conditional gates + viz data
    │  +Jury           │        + regions (pruning index)
    └────────┬─────────┘
             │
             ▼
    ┌──────────────────┐
    │                  │           ┌─────────┐
    │   PARTITION      │   ◄──────│  USER   │
    │                  │   ──────►│ ANSWERS │
    │  Mapper+Validate │          └─────────┘
    │  +Conditionals   │
    │  +Traverse       │   OUT: traversal state (partitions + conditionals)
    └────────┬─────────┘
             │
             ▼
    ┌──────────────────┐
    │                  │
    │   SYNTHESIS      │   "What survives your reality?"
    │                  │
    │  Prune+Concierge │   Dual-regime carving → chewed text → final answer
    │                  │
    │                  │   OUT: recommendation from surviving evidence
    └──────────────────┘
```

---

## 6. Module API Contracts (TypeScript)

```typescript
// ─── MODULE 1: EVIDENCE ─────────────────────────────────────────────

interface EvidenceInput {
  rawResponses: Array<{ modelIndex: number; content: string }>;
  userQuery: string;
}

interface EvidenceOutput {
  statements: ShadowStatement[];        // ALL — nothing filtered
  paragraphs: ShadowParagraph[];        // ALL — nothing filtered
  embeddings: {
    statements: Map<string, Float32Array>;
    paragraphs: Map<string, Float32Array>;
    query: Float32Array;
  };
  queryRelevance: Map<string, number>;  // scores, not filters
}

declare function buildEvidence(input: EvidenceInput): Promise<EvidenceOutput>;


// ─── MODULE 2: LANDSCAPE ────────────────────────────────────────────

interface LandscapeInput {
  evidence: EvidenceOutput;
}

interface WorklistEntry {
  focal: { id: string; text: string; disruptionScore: number };
  jury: Array<{
    id: string; text: string; regionId: string;
    stance: string; role: 'centroid' | 'high-signal' | 'outlier' | 'dissenter';
  }>;
}

interface ConditionalGate {
  id: string;
  question: string;
  affectedStatementIds: string[];
  impactScore: number;
  sourceProvenance: { clauseText: string; statementIds: string[] };
}

interface LandscapeOutput {
  worklist: WorklistEntry[];
  conditionalGates: ConditionalGate[];
  regions: Region[];                    // pruning index (planned)
  visualization: {                      // secondary, for UI only
    substrate: GeometricSubstrate;
    regions: Region[];
    profiles: RegionProfile[];
  };
}

declare function buildLandscape(input: LandscapeInput): LandscapeOutput;


// ─── MODULE 3: PARTITION ────────────────────────────────────────────

interface PartitionInput {
  worklist: WorklistEntry[];
  conditionalGates: ConditionalGate[];
  userQuery: string;
  embeddings: EvidenceOutput['embeddings'];
}

interface TraversalQuestion {
  id: string;
  hingeQuestion: string;
  type: 'partition' | 'conditional' | 'emergent';
  // For partitions/emergent:
  sides?: Array<{ label: string; statementIds: string[] }>;
  defaultSide?: number;
  // For conditionals:
  affectedStatementIds?: string[];
  // Shared:
  confidence: number;
}

interface PartitionOutput {
  questions: TraversalQuestion[];
  resolve(answers: Map<string, number | boolean>): TraversalState;
  // number for partition side selection, boolean for conditional gates
}

declare function buildPartitions(input: PartitionInput): Promise<PartitionOutput>;


// ─── MODULE 4: SYNTHESIS ────────────────────────────────────────────

interface SynthesisInput {
  traversalState: TraversalState;
  evidence: EvidenceOutput;
  regions: Region[];
  questions: TraversalQuestion[];       // for pruning regime determination
  rawResponses: Array<{ modelIndex: number; content: string }>;
  userQuery: string;
}

interface SynthesisOutput {
  text: string;
  debug?: {
    chewedSubstrate: ChewedSubstrate;
    triageResult: TriageResult;
    regionFates: Map<string, 'resolved' | 'skipped' | 'unseen'>;
  };
}

declare function synthesize(input: SynthesisInput): Promise<SynthesisOutput>;
```

---

## 7. Code Truth vs Architecture (Mismatch Awareness)

```
┌──────────────────────────┬──────────────────────────┬────────────────────┐
│ TOPIC                    │ ARCHITECTURE SAYS        │ CODE DOES TODAY    │
├──────────────────────────┼──────────────────────────┼────────────────────┤
│ Query relevance          │ Ranking-only, no filter  │ ✅ Implemented     │
│                          │                          │ StepExecutor.js    │
│                          │                          │ L935-L975          │
├──────────────────────────┼──────────────────────────┼────────────────────┤
│ Disruption scoring       │ uniqueness = 1 / (1 +    │ ✅ Implemented     │
│                          │ nearestCarrierSimilarity)│ interpretation     │
│                          │                          │ index.ts L240-L262 │
├──────────────────────────┼──────────────────────────┼────────────────────┤
│ SpaceGraph filter toggle │ "All / Query-relevant"   │ ✅ Implemented     │
│                          │ dropdown, display only   │ ParagraphSpaceView │
│                          │                          │ L142-L222          │
├──────────────────────────┼──────────────────────────┼────────────────────┤
│ Region construction      │ Clusters → components    │ ✅ Already works   │
│                          │ → patches (3 layers)     │ regions.ts         │
│                          │                          │ L90-L179           │
├──────────────────────────┼──────────────────────────┼────────────────────┤
│ nearestCarrierSimilarity │ Per-region, max mutual   │ ✅ Implemented     │
│                          │ edge to other region     │ profiles.ts        │
│                          │                          │ types.ts L40-L63   │
├──────────────────────────┼──────────────────────────┼────────────────────┤
│ Conditional gates        │ Coexist with partitions  │ ✅ Implemented     │
│                          │ in unified traversal     │ routing.ts +       │
│                          │                          │ regionGates +      │
│                          │                          │ questionMerge      │
│                          │                          │ 🔁 UI transitional │
├──────────────────────────┼──────────────────────────┼────────────────────┤
│ Clustering               │ HAC on embeddings,       │ ✅ engine.ts       │
│                          │ separate from embedding  │ buildClusters →    │
│                          │ model                    │ hierarchicalCluster│
│                          │                          │ Threaded through   │
│                          │                          │ StepExecutor into  │
│                          │                          │ interpretation     │
├──────────────────────────┼──────────────────────────┼────────────────────┤
│ Regions as claims        │ Regions replace claims   │ 🔲 Planned         │
│ (pruning index)          │ as pruning index + UI    │ Claims still       │
│                          │ semantic layer           │ primary in current │
│                          │                          │ code               │
├──────────────────────────┼──────────────────────────┼────────────────────┤
│ Jury construction        │ Centroid + outlier +     │ ✅ Implemented     │
│                          │ dissenter per focal      │ interpretation     │
│                          │                          │ index.ts +         │
│                          │                          │ StepExecutor.js    │
├──────────────────────────┼──────────────────────────┼────────────────────┤
│ Mapper as annotator      │ Annotate focal-jury      │ ✅ Implemented     │
│                          │ pairs, not extract       │ semanticMapper.ts  │
│                          │ full claim graph         │ 🔁 legacy prompt   │
├──────────────────────────┼──────────────────────────┼────────────────────┤
│ Partition-based pruning  │ Dual regime: partitions  │ ✅ Implemented     │
│                          │ + skeletonization        │ skeletonization +  │
│                          │                          │ traversalEngine    │
├──────────────────────────┼──────────────────────────┼────────────────────┤
│ Mapper prompt includes   │ Worklist/jury is the     │ 🔁 Transitional    │
│ geometric hints          │ mapper input; hints are  │ Worklist/jury used │
│                          │ optional observability   │ in disruption-first│
│                          │ signals                 │ legacy prompt still│
└──────────────────────────┴──────────────────────────┴────────────────────┘
```

---

## 8. Key Architectural Decisions (Rationale Log)

**Query relevance: ranking, not filtering.**
Models bring perspectives the user didn't anticipate. The most valuable
content to surface has the lowest query similarity. Ranking preserves
noise-reduction benefits via disruption scoring downranking without
excluding structural participation.

**Disruption scoring: uniqueness, not consensus.**
`disruption = uniqueness × stanceWeight × (1 + modelDiversity × 0.1)`
Consensus has low disruption (remove it, carriers survive elsewhere).
Unique minority positions have high disruption (remove it, gone forever).
This is the opposite of the consensus-favoring formula that every helper
and framework defaults to. The architecture has been fighting this
tendency since Phase 3.

**Conditional gates: complementary to partitions, not redundant.**
Partitions find binary forks (mutually exclusive positions).
Conditional gates find contextual dependencies (all agree, different
assumptions). Both produce traversal questions. Both prune when answered.
Different mechanisms, same user interface.

**hasOpposition: partition filter, not capability filter.**
Opposition absent doesn't mean the position is uninteresting. It means
it's not a fork — it's consensus or context. It feeds the conditional
gate system instead of the partition system. The user still gets asked
about it if the evidence has conditional signal density.

**Regions as claims: deterministic, complete, auditable.**
Claims were LLM-extracted (lossy, variable). Regions are geometry-derived
(complete, stable). Every statement belongs to a region. The mapper's
role narrows from "extract all positions" to "annotate which regions
are genuinely incompatible." Planned transition.

**Mapper writes hinge questions; mechanical layers don't.**
The mapper is the best question author in the pipeline. Mechanical
templates produce stilted, overly technical questions. The risk (vague
or abstract questions) is addressable via prompt engineering. The real
protection is the pipeline leading up to the mapper: mechanical layers
identify logical fault lines, the mapper names the hinge.

**V8 inversion holds through all changes.**
Claims were the pruning index. Partitions + regions are now the pruning
index. Text remains the output. The synthesizer reads evidence, not
abstractions. This principle survived every architectural iteration.

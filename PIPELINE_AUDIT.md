# Pipeline Architecture Audit — Geometry to Provenance
**Date:** 2026-04-16 | **Status:** Post-Refactor Review  
**Scope:** Real code paths from batch execution through geometry convergence at provenance  

---

## Quick Map vs. Code Reality

| Stage | Real Location | Simplified? | Notes |
|-------|---------------|-------------|-------|
| **Batch Execution** | `src/execution/pipeline/batch-phase.ts` | ✓ Simple | 6 AI models in parallel fanout |
| **Shadow Extraction** | `src/shadow/shadow-extractor.ts` | ✓ Yes | Pure pattern matching, no LLM |
| **Paragraph Projection** | `src/shadow/shadow-paragraph-projector.ts` | ✓ Yes | Contested/shared tracking |
| **Geometry Pipeline** | `src/geometry/engine.ts` | ✓ **Heavily refactored** | Was ~2000 lines, now thin orchestrator |
| **Semantic Mapper** | `src/provenance/semantic-mapper.ts` | ✓ Yes | Cross-read reframe (v5), parallel with geometry |
| **Provenance Unification** | `src/provenance/engine.ts` | ✗ Complex | 5-phase orchestrator, unified at measure |

---

## 1. Execution Entry Point → Mapping Phase

### Real Flow (batch-phase.ts)

```
executeBatchPhase()
  ├─ Parallel fanout: 6 AI models (allowedProviders)
  ├─ Await all responses (providers send text back)
  └─ Return indexedSourceData[] with modelIndex + text
```

**Key state:** `indexedSourceData = [{ providerId, modelIndex, text }, ...]`  
**Canonical ordering:** Via `canonicalCitationOrder()` from `shared/provider-config.js`

---

## 2. Mapping Phase — Where Geometry & Semantic Paths Diverge

### Entry (executeMappingPhase, mapping-phase.ts, lines 91–200)

```typescript
// Input: indexedSourceData[] from batch
// Canonical assignment already done (modelIndex ∈ [1..n])

// ─────────────────────────────────────────────────
// PHASE 2A: Shadow Extraction (Mechanical)
// ─────────────────────────────────────────────────
const shadowInput = indexedSourceData.map((s) => ({
  modelIndex: s.modelIndex,   // canonical, deterministic
  content: s.text,
}));

const shadowResult = extractShadowStatements(shadowInput);
// → shadowResult.statements[] (each has modelIndex, text, stance, etc.)

const paragraphResult = projectParagraphs(shadowResult.statements);
// → paragraphResult.paragraphs[] (contested/shared tracking)
// → shadowResult also has embedded metadata (modelOwnership, etc.)
```

**Exit state:**
- `shadowResult.statements`: ShadowStatement[] with provenance signals (modelIndex, stance)
- `paragraphResult.paragraphs`: ShadowParagraph[] with regionIds populated
- Both fully deterministic (no RNG, no external state)

---

## 3. Parallel Split: Geometry (L1) & Semantic Mapper (L2–L3)

### 3a. Geometry Path (mapping-phase.ts, lines 193–200+)

```typescript
// ─────────────────────────────────────────────────
// PHASE 2.6: GEOMETRY PIPELINE (async, may fail gracefully)
// ─────────────────────────────────────────────────
const geometryResults = await buildGeometryAsync(
  paragraphResult,         // ShadowParagraph[], regionIds loaded
  shadowResult,            // ShadowStatement[] with modelIndex
  indexedSourceData,       // Canonical provider/modelIndex mapping
  payload,                 // Contains embedding backend hint
  context,
  // ... (more context)
);

// geometryResults = {
//   substrate: MeasuredSubstrate | DegenerateSubstrate
//   interpretation: SubstrateInterpretation (regions, regionality)
//   queryRelevance: QueryRelevanceResult | null
// }
```

#### Geometry Implementation Detail (src/geometry/engine.ts)

**3-phase compose:**

```
Phase 1: Measure (geometry/measure.ts)
  Input:  paragraphs[], embeddings Map
  Output: MeasuredSubstrate {
    pairwiseField, 
    stats (μ, σ, quantiles),
    mutualRankGraph,
    nodeStats,
    health check
  }

Phase 2: Interpret (geometry/interpret.ts)
  Input:  substrate, paragraphs, basinInversion
  Output: SubstrateInterpretation {
    regions[],      // MeasuredRegion w/ nodeIds
    regionality,    // per-paragraph region assignment
    centerPoints    // UMAP layout (side-computation)
  }

Phase 3: Annotate (geometry/annotate.ts)
  Input:  statements, paragraphs, substrate, regions
  Output: Enriched statements with:
    regionId,
    structuralIndex,
    periphery assignment
  + QueryRelevance (cosine(query, statement embedding))
```

**L1 Certification:**
- ✓ All math on embeddings & pairwise similarities
- ✓ No labeled signals (stance, modelIndex) read
- ✓ No semantic interpretation
- ✓ Pure geometry: "Could you compute this from embeddings alone?" → **YES**

---

### 3b. Semantic Mapper Path (mapping-phase.ts, parallel)

```typescript
// ─────────────────────────────────────────────────
// PHASE 2.7: SEMANTIC MAPPER (parallel with geometry)
// ─────────────────────────────────────────────────
const { buildSemanticMapperPrompt, parseSemanticMapperOutput } =
  await import('../../../provenance/semantic-mapper.js');

const semanticPrompt = buildSemanticMapperPrompt(
  userQuery,
  indexedSourceData.map(s => ({ modelIndex: s.modelIndex, content: s.text }))
);

// Semantic mapper LLM call (parallel with geometry)
// Input: All 6 responses read together
// Output: MapperOutput {
//   narrative: string,
//   map: {
//     claims: MapperClaim[],
//     edges: Edge[]
//   }
// }
```

**Key architectural shift (v5):**
- Mapper reads responses *together*, not through them
- Claims are **relational** (convergence/tension/singular), not positional
- No synthesis; bring back map intact
- Citation markers `[Label|claim_id]` embedded in narrative

---

## 4. Convergence at Provenance: Mixed-Method Merge

### Entry (mapping-phase.ts, after both paths complete)

```typescript
// Geometry ready: geometryResults {substrate, interpretation, queryRelevance}
// Semantic ready: mapper {claims[], edges[]} from LLM

// ─────────────────────────────────────────────────
// PHASE 3: CLAIM ASSEMBLY & PROVENANCE PIPELINE
// ─────────────────────────────────────────────────

// Build enriched claims (table cell allocation, geometry annotation)
const enrichedClaims = /* process mapper claims + geometry + shadow */;

// Unified provenance input
const provenanceInput = {
  mapperClaims: mapper.claims,           // Semantic claims
  enrichedClaims,                        // Annotated with geometry
  edges: mapper.edges,                   // Semantic edges
  shadowStatements: shadowResult.statements,
  shadowParagraphs: paragraphResult.paragraphs,
  paragraphEmbeddings,                   // From clustering phase
  regions: geometryResults.interpretation.regions,
  totalModelCount: indexedSourceData.length,
  periphery: geometryResults.interpretation.periphery,
  queryEmbedding,
  queryRelevanceScores: geometryResults.queryRelevance,
  // ... more
};

const provenanceOutput = await buildProvenancePipeline(provenanceInput);
```

---

## 5. Provenance 5-Phase Pipeline (src/provenance/engine.ts)

### Phase 1: Measure (provenance/measure.ts)

**Inputs consumed:**
- `mapperClaims` (from semantic mapper)
- `shadowStatements` (from shadow extractor, includes modelIndex + stance)
- `regions` (from geometry interpretation)
- `paragraphEmbeddings` (from clustering, maps para → vector)

**Single-pass Collect-then-Construct:**

```typescript
// 1. Build shared lookups (statementsById, paragraphById, region mappings)
// 2. Assign shadowStatements → mapperClaims via embedding cosine similarity
// 3. Competitive assignment (best-match semantics)
// 4. Mixed-method merge: geometry + semantics → canonical ownership
// 5. Claim density profiling (majority paragraphs, passages)
// 6. Compute claim embeddings
```

**Key output:** `ownershipMap: Map<claimId, Set<shadowStatementId>>`

### Phase 2: Validate (provenance/validate.ts)

- **Input:** enrichedClaims, edges, ownershipMap
- **Computation:** Triangle metric for conflicts, allegiance refinement
- **Output:** validatedConflicts[], provenanceRefinement (primary claim per joint)

### Phase 3: Surface (provenance/surface.ts)

- **Passage Routing** (L1 arithmetic on claimDensity fields)
  - `concentration ≥ μ+σ` OR `maxLen ≥ 2` → load-bearing
  - Positions: northStar, eastStar, mechanism, floor
  - **No embedding access** (pure arithmetic on already-computed stats)

- **Blast Surface** (composite score + twin map)
  - Twin map: per-claim alternative claims (used by passage pruning)
  - Routing layer: calls `buildClaimRoutingFromPassage()`

### Phase 4: Structure (provenance/structure.ts)

- **Structural Analysis:**
  - Claims with leverage (geometry intersection + density)
  - Cascade risks (conflict cascades)
  - Graph topology (paths, cycles, branching)

### Phase 5: Classify (provenance/classify.ts)

- **Statement Classification:** Strict ownershipMap via phase-1 assignment

---

## 6. What Actually Changed (Post-Refactor)

### Abstraction Removals

| Old | New | Why |
|-----|-----|-----|
| `StepExecutor.js` (~2000 lines, monolithic) | `batch-phase.ts` + `mapping-phase.ts` + pipeline modules | Clear phase separation, easier to reason about |
| Blended geometry logic | `geometry/engine.ts` (thin orchestrator) | Measure/Interpret/Annotate now modular |
| Ad-hoc provenance assembly | `provenance/engine.ts` (5-phase pipeline) | Explicit phases, collect-then-construct |
| Mixed shadow + semantic | Separate modules, converge at measure | Shadow is mechanical, semantic is LLM — distinct concerns |

### Key Insight: Geometry is Now Skinny

```
Old: geometry logic spread across StepExecutor + other files
New: geometry/engine.ts = 84 lines (orchestrator) calling:
     - measureSubstrate() → pairwise field, graph, health
     - interpretSubstrate() → regions, regionality
     - enrichStatementsWithGeometry() → per-statement annotation
     - computeQueryRelevance() → (optional, query vector only)
```

**Result:** Easy to verify L1 discipline, no hidden semantic operations.

---

## 7. Architecture Diagram (Updated Mermaid)

```
BATCH PHASE (Parallel, 6 providers)
  │
  ├──→ Model 1..N responses (indexedSourceData[])
  │
  ▼
MAPPING PHASE (Synchronous orchestrator)
  │
  ├─┬─ GEOMETRY PATH (L1, parallel) ──────────────┐
  │ │                                            │
  │ ├─ Shadow Extraction (mechanical) ──┐       │
  │ │  └─ statements[], paragraphs[]     │       │
  │ │                                    │       │
  │ ├─ Geometry Pipeline ────────────────┼───────┤
  │ │  ├─ Measure (pairwise field, graph)│       │
  │ │  ├─ Interpret (regions)            │       │
  │ │  └─ Annotate (per-statement)       │       │
  │ │     Output: substrate, regions     │       │
  │ │                                    │       │
  │ └─ Embeddings Clustering ────────────┘       │
  │                                              │
  ├─┬─ SEMANTIC PATH (L2–L3, parallel) ─────────┐
  │ │                                           │
  │ └─ Semantic Mapper (LLM) ───────────────────┤
  │    ├─ Cross-read reframe                    │
  │    └─ Output: MapperClaim[], Edge[]         │
  │                                             │
  └──▶ PROVENANCE MERGE (Sequential) ◀──────────┘
      │
      ├─ Phase 1: Measure
      │  └─ Assign statements → claims (embedding cosine)
      │  └─ Mixed-method merge
      │  └─ Output: ownershipMap, claimDensity
      │
      ├─ Phase 2: Validate
      │  └─ Triangle metric, allegiance refinement
      │
      ├─ Phase 3: Surface
      │  ├─ Passage Routing (L1 arithmetic on density)
      │  └─ Blast Surface (twin map, routing assembly)
      │
      ├─ Phase 4: Structure
      │  └─ Claims with leverage, cascade risks
      │
      └─ Phase 5: Classify
         └─ Statement classification (ownershipMap-driven)
```

---

## 8. Critical Path & Bottlenecks

### Parallel Stages
- **Batch phase**: 6 provider calls (network-bound)
- **Geometry + Semantic in mapping**: Both can run simultaneously
  - Geometry: embedding lookups, matrix ops (CPU-bound)
  - Semantic: LLM inference (network-bound)

### Sequential Stages
1. Batch (wait for all 6 responses)
2. Shadow extraction (fast, mechanical)
3. Parallel: {Geometry, Semantic Mapper}
4. Provenance 5-phase (single-threaded, all phases depend on measure output)

### Actual Bottleneck
- **Provenance Phase 3 (Surface):** Passage Routing does L1 arithmetic on *per-claim* density stats
  - For large claimsets, this is O(claims × passages) arithmetic
  - But still < 100ms for typical graphs

---

## 9. Type Bridges (How Geometry & Semantic Meet)

### At Measure Input (provenance/measure.ts)

```typescript
export interface MeasurePhaseInput {
  mapperClaims: MapperClaim[];           // From semantic mapper
  enrichedClaims: EnrichedClaim[];       // From claim assembly (geometry-annotated)
  regions: MeasuredRegion[];             // From geometry.interpretation
  totalModelCount: number;               // From batch phase
  paragraphEmbeddings: Map<...>;         // From clustering
  shadowStatements: ShadowStatement[];   // From shadow extractor
  // ... etc
}
```

### Key Assignment (Mixed-Method Merge)

```typescript
// Inside measureProvenance():
for (const claim of claims) {
  // Competitive assignment: shadowStatements → claim
  // Uses embedding cosine(claim embedding, statement embedding)
  const candidates = shadowStatements.filter(stmt => similarity > threshold);
  
  // Mixed-method: geometry + stance signals
  // ownership[claimId] = Set of shadowStatementIds
}
```

---

## 10. Epistemic Discipline Verification

### Geometry (L1) ✓
- **Read only:** embeddings, pairwise similarities, graph topology
- **Never read:** stance, modelIndex, semantic labels
- **Inversion:** "Compute from embeddings alone?" → YES

### Semantic Mapper (L2–L3) ✓
- **Reads:** All 6 responses together
- **Semantic:** Cross-read reframe, convergence/tension
- **No embeddings used** (reads raw text)

### Provenance Measure (L1 + Mixed) ✓
- **Phase 1 uses:** Geometry (regions) + Semantic (claims) + Stance (L2 signal)
- **Flagged:** Stance is L2 signal, explicitly captured in sourceStatementIds
- **No synthesis:** Deterministic assignment, not interpretive

---

## 11. Open Questions for Mermaid Update

1. **Passage Pruning** (memory notes mention as "planned")
   - Status: Not yet implemented
   - Expected location: `src/core/provenance/passage-pruning.ts` (directory doesn't exist yet)
   - Would run: Post-surface, pre-structure

2. **Twin Map Lifecycle**
   - Built: In Phase 3 Surface (blast surface)
   - Consumed: Would be consumed by passage pruning
   - Current: Instrumentation only, not used for routing (replaced by passage routing)

3. **Claim Embeddings**
   - Computed: In Phase 1 Measure
   - Used: In Phase 2 Validate (triangle metric), Phase 3 Surface (routing)
   - Role: Semantic similarity for conflict validation

4. **Query Relevance**
   - Computed: In Geometry (side-computation if queryEmbedding provided)
   - Consumed: In Phase 3 Surface (optional input)
   - Role: Ranks statements by similarity to user query

---

## 12. Summary: New Mental Model

**The geometry pipeline is now truly skinny:**
- 84 lines of orchestration
- 3 phases: Measure → Interpret → Annotate
- Pure L1: embeddings only, no semantic context
- Parallelizable with semantic mapper

**Provenance is the heavyweight:**
- 5 phases that must run sequentially
- Phase 1 (Measure) is the convergence point
- Assigns shadow statements to semantic claims via embedding similarity
- Downstream phases validate, route, and classify

**Architecture is much cleaner post-refactor:**
- No monolithic StepExecutor
- Clear phase boundaries
- Separation of concerns: mechanical (shadow) vs. semantic (mapper) vs. geometric (substrate)
- Everything converges at measure input, not scattered throughout


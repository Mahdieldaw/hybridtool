# deterministic-pipeline.js — file digest (shared semantic pipeline)

---

## Purpose

**Extracted Deterministic Pipeline:** Centralized computation of all derived fields (claims, embeddings, density, routing, conflict validation, structural analysis) used by both the **live execution path** (`StepExecutor.js`) and the **regeneration path** (`sw-entry.js REGENERATE_EMBEDDINGS`).

**Key Design:** Single source of truth ensures both paths produce identical artifacts when given the same embeddings and semantic output. New field computations added here automatically flow through both pathways.

---

## Architecture Overview

```
Pre-Survey Pipeline (parse → shadow → geometry → embeddings → provenance → assembly)

    Parse Mapping Text (or reuse parsed)
         ↓
    Shadow Reconstruction (extract statements, project paragraphs)
         ↓
    Geometry Pipeline (substrate, regions, query relevance)
         ↓
    Embeddings (paragraph, statement, query, claim)
         ↓
    Compute Derived Fields
         ├─ Query Relevance Scoring
         ├─ Basin Inversion (topography)
         ├─ 5-Phase Provenance Pipeline
         │  ├─ Phase 1: Measure (canonical provenance, ownership, density)
         │  ├─ Phase 2: Validate (conflict validation, allegiance)
         │  ├─ Phase 3: Surface (passage routing, blast surface)
         │  ├─ Phase 4: Structure (graph topology, cascade risks)
         │  └─ Phase 5: Classify (statement routing)
         └─ Structural Analysis (graph metrics, convergences, tradeoffs)
         ↓
    Assembly (mapper artifact → cognitive artifact)
```

---

## `computeDerivedFields(input): Promise<object>`

**Shared deterministic pipeline:** Computes all derived metrics from embeddings + semantic output.

**Input:**
- `enrichedClaims` — claims enriched with canonical sourceStatementIds
- `mapperClaimsForProvenance` — mapper claims for Phase 1
- `parsedEdges, parsedConditionals` — semantic graph structure
- `shadowStatements, shadowParagraphs` — extracted text structure
- `statementEmbeddings, paragraphEmbeddings, claimEmbeddings, queryEmbedding` — pre-computed vectors
- `substrate, preSemantic, regions` — geometry results
- `geoRecord` — packed embeddings for basin inversion
- `modelCount, queryText` — context

**Output: Complete derived fields object**

```javascript
{
  claimProvenance,                // { statementOwnership, claimExclusivity }
  claimProvenanceExclusivity,     // per-claim exclusivity ratios
  statementOwnership,             // statement → Set<claimId> map
  cachedStructuralAnalysis,       // graph metrics + patterns
  blastSurfaceResult,             // twin map, risk vectors
  mixedProvenanceResult,          // Phase 1 canonical structures
  basinInversion,                 // topographic analysis
  bayesianBasinInversion,         // Bayesian variant
  queryRelevance,                 // statement scores vs. query
  semanticEdges,                  // normalized edge types
  derivedSupportEdges,            // inferred from conditionals
  passageRoutingResult,           // load-bearing claims, landscape
  claimDensityResult,             // per-claim passage metrics
  provenanceRefinement,           // joint statement disambiguation
  statementClassification,        // claimed/unclaimable/routing
}
```

**Pipeline:**

1. **Group A (Parallel — independent):**
   - Query relevance scoring (if queryEmbedding + substrate exist)
   - Basin inversion (Bayesian, from geoRecord or pre-computed)

2. **Semantic edge normalization (sync):**
   - Canonicalize edge types: `supports | conflicts | prerequisite | tradeoff`
   - Filter to valid types only
   - Generate derived support edges from conditionals (if no explicit supports)

3. **Periphery resolution:**
   - Extract from preSemantic (corpusMode, peripheralNodeIds)
   - Fallback to identifyPeriphery() + no-geometry if unavailable

4. **5-Phase Provenance Pipeline** (`buildProvenancePipeline`)
   - Measure → Validate → Surface → Structure → Classify
   - Outputs: density, routing, conflict validation, statement classification, blast surface

5. **Structural Analysis** (sync, independent)
   - Graph topology: hubs, articulation points, chains
   - Convergences, tradeoffs, cascade risks
   - Per-claim degree + position annotations

**Error handling:** All steps wrapped in try/catch; failures null-out results but don't block pipeline.

---

## `computePreSurveyPipeline(input): Promise<object>`

**Full pre-survey workflow:** Parse → shadow → geometry → embeddings → Phase 1 → derived → ready for assembly.

Returned object shapes the interface between semantic mapping and artifact assembly.

**Input:**
- `mappingText` — raw semantic mapper response (or skip if parsedMappingResult provided)
- `parsedMappingResult` — pre-parsed { claims, edges, narrative } (reuse if available)
- `shadowStatements, shadowParagraphs` — pre-extracted (or reconstruct from batchSources)
- `statementEmbeddings, paragraphEmbeddings, queryEmbedding` — pre-computed vectors (required)
- `preBuiltSubstrate, preBuiltPreSemantic` — skip geometry rebuild if provided
- `modelCount, queryText, turn` — context

**Output:**
```javascript
{
  parsedClaims, parsedEdges, parsedNarrative, parsedConditionals,
  enrichedClaims,                 // canonical sourceStatementIds from Phase 1
  claimEmbeddings,                // from Phase 1
  shadowStatements, shadowParagraphs, substrate, preSemantic, queryRelevance, regions,
  // All derived fields from computeDerivedFields():
  claimProvenance, blastSurfaceResult, mixedProvenanceResult,
  passageRoutingResult, claimDensityResult, provenanceRefinement,
  statementClassification, cachedStructuralAnalysis,
  // Shortcuts:
  claimRouting: passageRoutingResult,
  claimDensityScores: claimDensityResult,
  derived: { /* all of above */ },
  mapperClaimsForProvenance,
  citationSourceOrder,
}
```

**Pipeline:**

1. **Parse mapping text** (unless parsedMappingResult provided)
   - `parseSemanticMapperOutput(mappingText)` → claims, edges, narrative

2. **Shadow reconstruction** (unless provided)
   - `extractShadowStatements(batchSources)` → statements
   - `projectParagraphs(statements)` → paragraphs

3. **Geometry build/reuse**
   - Reuse preBuiltSubstrate/preSemantic if available (StepExecutor path)
   - Otherwise: buildGeometricSubstrate + buildPreSemanticInterpretation + basin inversion
   - Extract regions; enrich statements with geometricCoordinates

4. **Phase 1 bootstrap** (`measureProvenance`)
   - Builds canonical sourceStatementIds + claim embeddings
   - Outputs enrichedClaims for Phase 2–5

5. **Compute derived fields** (via `computeDerivedFields`)
   - Full 5-phase provenance + structural analysis

6. **Return complete pre-survey state** for assembly step

---

## `buildSubstrateGraph({ substrate, regions }): object | null`

**UI-facing substrate visualization:** Converts geometry to 2D node/edge graph.

**Output:**
```javascript
{
  nodes: [ {
    paragraphId, modelIndex, dominantStance, contested, statementIds,
    mutualRankDegree, isolationScore, regionId, x, y
  } ],
  mutualEdges: [ { source, target, similarity } ]
}
```

Maps paragraphs → UMAP 2D coordinates; attaches region membership + geometric signals.

---

## `assembleMapperArtifact(derived, enrichedClaims, ...): object`

**Mapper artifact assembly:** Wraps derived fields + parsed output into immutable artifact.

**Output:**
```javascript
{
  id,                    // artifact-${uuid}
  query, timestamp, model_count,
  claims, edges, narrative, conditionals,
  shadow: { statements },
  // Optionally attach:
  blastSurface, claimProvenance, basinInversion, mixedProvenance,
  passageRouting, claimDensity, provenanceRefinement, statementClassification
}
```

**No logic:** Pure assembly. Artifact is immutable after creation.

---

## `assembleFromPreSurvey(preSurvey, opts): Promise<object>`

**Post-semantic assembly:** Mapper artifact → CognitiveArtifact.

**Input:** preSurvey from `computePreSurveyPipeline`

**Output:**
```javascript
{
  cognitiveArtifact,      // buildCognitiveArtifact(mapperArtifact, ...)
  mapperArtifact,         // from assembleMapperArtifact()
  enrichedClaims,
  claimEmbeddings,
  cachedStructuralAnalysis,
}
```

**Pipeline:**

1. Assemble mapper artifact from pre-survey
2. Build substrate graph (UMAP 2D + regions)
3. Construct CognitiveArtifact via `buildCognitiveArtifact(mapperArtifact, { substrate: { graph }, shadow, query, ...})`
4. Attach citationSourceOrder if available

**Design:** CognitiveArtifact auto-forwards unknown mapper keys (passthrough pattern).

---

## `buildArtifactForProvider(options): Promise<object>`

**Thin wrapper:** `computePreSurveyPipeline → assembleFromPreSurvey`

Single entry point for artifact reconstruction (recompute path).

**Returns:** Full artifact + parsed fields + intermediate state (shadow, substrate, etc.)

---

## `computeProbeGeometry({ modelIndex, content }): Promise<object>`

**Single-source geometry:** Extract + embed + build geometry for a single text source.

Used for standalone geometry analysis (not tied to full pipeline).

**Returns:** shadowStatements, shadowParagraphs, embeddings, substrate, preSemantic.

---

## Key Design Principles

**Deterministic:** All fields computed from embeddings + semantic output; no external state.

**Reusable:** Both StepExecutor (live) and sw-entry.js (regen) call `computePreSurveyPipeline` → `assembleFromPreSurvey`.

**Graceful degradation:** All steps wrapped in try/catch; failures null-out fields but don't halt pipeline.

**Phase discipline:** Each pipeline stage reads only from previous output; no backward references.

**New field checklist:** Add computation to `computeDerivedFields` → both live + regen paths get it automatically.

---

## Integration Points

**Upstream (consumes):**
- Semantic mapper output (parsed claims + edges)
- Batch responses (shadow statements/paragraphs)
- Embeddings (paragraph, statement, claim, query)
- Geometry (substrate, regions, basin inversion)

**Downstream (consumed by):**
- `StepExecutor.js` — maps artifact into session/turn for UI
- `mapping-phase.ts` — calls `computePreSurveyPipeline` on live path
- `recompute-handler.ts` — calls `buildArtifactForProvider` on regen path
- `buildCognitiveArtifact` — wraps mapper artifact into CognitiveArtifact shape

---

## Summary

**deterministic-pipeline.js** is the **unified semantic pipeline** — single-source computation of all derived fields (provenance, routing, structure, query relevance) ensuring StepExecutor (live) and sw-entry.js (regen) produce identical artifacts from the same inputs. No LLM calls; all math + orchestration.

**Entry points:**

- **Full workflow:** `computePreSurveyPipeline(...)` → `assembleFromPreSurvey(...)`
- **Direct artifact build:** `buildArtifactForProvider(...)`
- **Field computation:** `computeDerivedFields(...)`
- **Geometry-only:** `computeProbeGeometry(...)`

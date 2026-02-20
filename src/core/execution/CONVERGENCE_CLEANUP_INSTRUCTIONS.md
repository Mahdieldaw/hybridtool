# StepExecutor Convergence Cleanup & Diagnostics Expansion

## Guiding Principle

The convergence block in StepExecutor attempted to answer "did geometry and mapper agree?" — which is epistemically incoherent because you cannot use one uncertain system to validate another without ground truth. The block consumed signals (oppositions, interRegionSignals, hints) that have been removed from the geometry layer. It currently runs but produces hollow output: all signal-dependent metrics are zero.

Replace with honest, Level 1 geometric measurements that each stand on their own. Measurements go into the diagnostics system. Only `sourceCoherence` gets stamped on individual claims for UI display. Everything else lives in the diagnostics debug panel.

**What is Level 1:** A direct mathematical measurement on embeddings or topology with no semantic claim. Cosine similarity, counts, set membership, standard deviation, centroid computation. If the number can be computed without understanding what any text means, it's Level 1.

---

## Part 1: Expand Diagnostics Types

**File:** `src/geometry/interpretation/types.ts`

Add these types alongside the existing `GeometricObservation` and `DiagnosticsResult`:

```typescript
/** Per-claim geometric measurements. All Level 1. */
export interface ClaimGeometricMeasurement {
    claimId: string;

    /**
     * Mean pairwise cosine similarity of source statement embeddings.
     * Measures semantic tightness: are the statements backing this claim
     * actually about the same thing in embedding space?
     * High (>0.8) = tightly focused claim. Low (<0.5) = possibly over-merged.
     * null if fewer than 2 source statements have embeddings.
     */
    sourceCoherence: number | null;

    /**
     * Standard deviation of pairwise cosine similarities among source statements.
     * Complements sourceCoherence (mean vs variance).
     * Low spread + high coherence = uniformly tight cluster.
     * High spread + moderate coherence = tight core with outlier statements.
     * null if fewer than 3 source statements have embeddings.
     */
    embeddingSpread: number | null;

    /**
     * How many distinct geometric regions the source statements come from.
     * 1 = claim drew from a single concentrated area.
     * 3+ = claim drew broadly across the geometric landscape.
     * Coarser, structural complement to sourceCoherence.
     */
    regionSpan: number;

    /**
     * How many distinct models (by modelIndex) authored the source statements for this claim.
     * Exact: traces each sourceStatementId → its parent paragraph → paragraph.modelIndex.
     * Different from semantic support_count (which is the mapper's assessment of supporters).
     * This counts which models' actual text was used as source material.
     */
    sourceModelDiversity: number;

    /** Total source statements for this claim. */
    sourceStatementCount: number;

    /** Region containing the most source statements for this claim. */
    dominantRegionId: string | null;

    /** Tier of the dominant region (from region profiles). */
    dominantRegionTier: 'peak' | 'hill' | 'floor' | null;

    /** Model diversity of the dominant region (from region profiles). */
    dominantRegionModelDiversity: number | null;
}

/** Per-edge geometric measurements. All Level 1. */
export interface EdgeGeographicMeasurement {
    /** Format: "{from}->{to}" */
    edgeId: string;
    from: string;
    to: string;
    edgeType: string;

    /**
     * Whether the two claims' dominant regions are different.
     * true = the tension/relationship spans a structural boundary in embedding space.
     * false = both claims sit in the same geometric neighborhood.
     */
    crossesRegionBoundary: boolean;

    /**
     * Cosine similarity between centroids of claim A's and claim B's source statement embeddings.
     * Direct geometric distance between the claims.
     * crossesRegionBoundary is the boolean threshold version; this is the continuous measurement.
     * null if either claim lacks embeddings.
     */
    centroidSimilarity: number | null;

    fromRegionId: string | null;
    toRegionId: string | null;
}

/** All geometric measurements computed post-mapper. */
export interface DiagnosticMeasurements {
    claimMeasurements: ClaimGeometricMeasurement[];
    edgeMeasurements: EdgeGeographicMeasurement[];
}
```

Update `DiagnosticsResult` to include the measurements block:

```typescript
export interface DiagnosticsResult {
    observations: GeometricObservation[];
    measurements: DiagnosticMeasurements;
    summary: string;
    meta: {
        regionCount: number;
        claimCount: number;
        processingTimeMs: number;
    };
}
```

---

## Part 2: Expand `diagnostics.ts`

**File:** `src/geometry/interpretation/diagnostics.ts`

### 2.1 Update signature

```typescript
export function computeDiagnostics(
    preSemantic: PreSemanticInterpretation,
    postSemantic: StructuralAnalysis,
    substrate?: GeometricSubstrate | null,
    statementEmbeddings?: Map<string, Float32Array> | null,
    paragraphs?: Array<{ id: string; modelIndex: number; statementIds: string[] }> | null
): DiagnosticsResult
```

### 2.2 Add helper: cosine similarity

```typescript
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
    const n = Math.min(a.length, b.length);
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < n; i++) {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    if (na <= 0 || nb <= 0) return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
```

### 2.3 Add helper: mean pairwise similarity + spread

```typescript
function pairwiseStats(
    vectors: Float32Array[]
): { mean: number | null; stddev: number | null } {
    if (vectors.length < 2) return { mean: null, stddev: null };
    const sims: number[] = [];
    for (let i = 0; i < vectors.length; i++) {
        for (let j = i + 1; j < vectors.length; j++) {
            sims.push(cosineSimilarity(vectors[i], vectors[j]));
        }
    }
    if (sims.length === 0) return { mean: null, stddev: null };
    const mean = sims.reduce((s, x) => s + x, 0) / sims.length;
    if (sims.length < 2) return { mean, stddev: null };
    const variance = sims.reduce((s, x) => s + (x - mean) ** 2, 0) / sims.length;
    return { mean, stddev: Math.sqrt(variance) };
}
```

### 2.4 Add helper: centroid

```typescript
function computeCentroid(vectors: Float32Array[]): Float32Array | null {
    if (vectors.length === 0) return null;
    const dim = vectors[0].length;
    const centroid = new Float32Array(dim);
    for (const v of vectors) {
        for (let i = 0; i < dim; i++) centroid[i] += v[i];
    }
    for (let i = 0; i < dim; i++) centroid[i] /= vectors.length;
    return centroid;
}
```

### 2.5 Add helper: dominant region for a set of statement IDs

This reuses the `buildRegionStatementSets` already in the file, but inverted — we need statement→region mapping:

```typescript
function buildStatementToRegionMap(regions: Region[]): Map<string, string> {
    const map = new Map<string, string>();
    for (const r of regions) {
        const regionId = String(r?.id || '').trim();
        if (!regionId) continue;
        for (const sidRaw of r.statementIds ?? []) {
            const sid = String(sidRaw || '').trim();
            if (sid && !map.has(sid)) map.set(sid, regionId);
        }
    }
    return map;
}

function computeDominantRegion(
    statementIds: string[],
    statementToRegion: Map<string, string>
): { regionId: string | null; regionSpan: number } {
    const counts = new Map<string, number>();
    for (const sid of statementIds) {
        const rid = statementToRegion.get(sid);
        if (rid) counts.set(rid, (counts.get(rid) ?? 0) + 1);
    }
    if (counts.size === 0) return { regionId: null, regionSpan: 0 };
    let bestId: string | null = null;
    let bestCount = 0;
    for (const [rid, c] of counts) {
        if (c > bestCount) { bestId = rid; bestCount = c; }
    }
    return { regionId: bestId, regionSpan: counts.size };
}
```

### 2.6 Add helper: statement-to-model mapping

Paragraphs carry `modelIndex` and `statementIds`. The `paragraphs` parameter (ShadowParagraph[]) is available in StepExecutor scope as `paragraphResult.paragraphs`. Build a direct `statementId → modelIndex` map for exact model attribution:

```typescript
function buildStatementToModelIndex(
    paragraphs: Array<{ id: string; modelIndex: number; statementIds: string[] }>
): Map<string, number> {
    const map = new Map<string, number>();
    for (const para of paragraphs) {
        for (const sid of para.statementIds) {
            if (sid && !map.has(sid)) map.set(sid, para.modelIndex);
        }
    }
    return map;
}
```

Then per-claim:

```typescript
function computeSourceModelDiversity(
    statementIds: string[],
    statementToModelIndex: Map<string, number>
): number {
    const models = new Set<number>();
    for (const sid of statementIds) {
        const mi = statementToModelIndex.get(sid);
        if (mi !== undefined) models.add(mi);
    }
    return models.size;
}
```

This is exact: which specific models authored the specific statements that back this claim. No region-level approximation.

### 2.7 Compute claim measurements

After the existing observations block, before the return statement, add:

```typescript
// --- Claim geometric measurements ---
const statementToRegion = buildStatementToRegionMap(regions);
const statementToModelIndex = paragraphs ? buildStatementToModelIndex(paragraphs) : new Map<string, number>();
const claimMeasurements: ClaimGeometricMeasurement[] = [];

for (const c of claims as any[]) {
    const claimId = String(c?.id ?? '').trim();
    if (!claimId) continue;
    const sids = claimStatementIds(c);
    const { regionId: dominantRegionId, regionSpan } = computeDominantRegion(sids, statementToRegion);
    const profile = dominantRegionId ? profileByRegionId.get(dominantRegionId) : null;

    // Source coherence & spread
    let sourceCoherence: number | null = null;
    let embeddingSpread: number | null = null;
    if (statementEmbeddings) {
        const vecs: Float32Array[] = [];
        for (const sid of sids) {
            const v = statementEmbeddings.get(sid);
            if (v) vecs.push(v);
        }
        const stats = pairwiseStats(vecs);
        sourceCoherence = stats.mean;
        embeddingSpread = stats.stddev;
    }

    claimMeasurements.push({
        claimId,
        sourceCoherence,
        embeddingSpread,
        regionSpan,
        sourceModelDiversity: computeSourceModelDiversity(sids, statementToModelIndex),
        sourceStatementCount: sids.length,
        dominantRegionId,
        dominantRegionTier: profile?.tier ?? null,
        dominantRegionModelDiversity: profile?.mass?.modelDiversity ?? null,
    });
}
```

### 2.8 Compute edge measurements

```typescript
// --- Edge geographic measurements ---
const edges = Array.isArray(postSemantic.edges) ? postSemantic.edges : [];
const claimDominantRegion = new Map<string, string | null>(
    claimMeasurements.map(m => [m.claimId, m.dominantRegionId])
);

// Build claim centroids for centroidSimilarity
const claimCentroids = new Map<string, Float32Array | null>();
if (statementEmbeddings) {
    for (const c of claims as any[]) {
        const claimId = String(c?.id ?? '').trim();
        if (!claimId) continue;
        const sids = claimStatementIds(c);
        const vecs: Float32Array[] = [];
        for (const sid of sids) {
            const v = statementEmbeddings.get(sid);
            if (v) vecs.push(v);
        }
        claimCentroids.set(claimId, computeCentroid(vecs));
    }
}

const edgeMeasurements: EdgeGeographicMeasurement[] = [];
for (const e of edges as any[]) {
    const from = String(e?.from ?? '').trim();
    const to = String(e?.to ?? '').trim();
    const edgeType = String(e?.type ?? '').trim();
    if (!from || !to) continue;

    const fromRegion = claimDominantRegion.get(from) ?? null;
    const toRegion = claimDominantRegion.get(to) ?? null;
    const crossesRegionBoundary = !!(fromRegion && toRegion && fromRegion !== toRegion);

    let centroidSimilarity: number | null = null;
    const cA = claimCentroids.get(from);
    const cB = claimCentroids.get(to);
    if (cA && cB) {
        centroidSimilarity = cosineSimilarity(cA, cB);
    }

    edgeMeasurements.push({
        edgeId: `${from}->${to}`,
        from,
        to,
        edgeType,
        crossesRegionBoundary,
        centroidSimilarity,
        fromRegionId: fromRegion,
        toRegionId: toRegion,
    });
}
```

### 2.9 Update return

```typescript
return {
    observations,
    measurements: {
        claimMeasurements,
        edgeMeasurements,
    },
    summary,
    meta: {
        regionCount: regions.length,
        claimCount: claims.length,
        processingTimeMs: Date.now() - startedAt,
    },
};
```

---

## Part 3: Update `validation.ts` wrapper

**File:** `src/geometry/interpretation/validation.ts`

The compatibility wrapper needs to pass through the new parameters:

```typescript
import type { StructuralAnalysis } from '../../../shared/contract';
import type { GeometricSubstrate } from '../types';
import type { DiagnosticsResult, PreSemanticInterpretation } from './types';
import { computeDiagnostics } from './diagnostics';

export function validateStructuralMapping(
    preSemantic: PreSemanticInterpretation,
    postSemantic: StructuralAnalysis,
    substrate?: GeometricSubstrate | null,
    statementEmbeddings?: Map<string, Float32Array> | null,
    paragraphs?: Array<{ id: string; modelIndex: number; statementIds: string[] }> | null
): DiagnosticsResult {
    return computeDiagnostics(preSemantic, postSemantic, substrate, statementEmbeddings, paragraphs);
}
```

---

## Part 3.5: Activate Query Relevance → Model Ordering Integration

The `computeModelOrdering` function already accepts `queryRelevanceBoost?: Map<number, number>` but immediately `void`s it. The scaffolding exists. This part activates it.

**Problem:** `computeQueryRelevance` runs after `buildPreSemanticInterpretation` because it needs region data. But model ordering runs inside `buildPreSemanticInterpretation`. Circular dependency.

**Solution:** The per-model boost only needs `querySimilarity` (cosine of statement embedding vs query embedding) — no regions needed. Compute a lightweight per-model relevance score before pre-semantic runs, pass it through.

### 3.5.1 Add helper function in `src/geometry/interpretation/modelOrdering.ts`

Add at the top of the file, exported:

```typescript
import { cosineSimilarity } from '../../clustering/distance';

/**
 * Compute per-model mean query similarity from statement embeddings.
 * Lightweight — only needs embeddings and paragraph→model mapping, no regions.
 * Returns Map<modelIndex, meanQuerySimilarity>.
 * Meant to be computed before buildPreSemanticInterpretation and passed in.
 */
export function computePerModelQueryRelevance(
    queryEmbedding: Float32Array,
    statementEmbeddings: Map<string, Float32Array>,
    paragraphs: Array<{ id: string; modelIndex: number; statementIds: string[] }>
): Map<number, number> {
    // Build statement → modelIndex
    const stmtToModel = new Map<string, number>();
    for (const para of paragraphs) {
        for (const sid of para.statementIds) {
            if (sid) stmtToModel.set(sid, para.modelIndex);
        }
    }

    // Accumulate similarities per model
    const sums = new Map<number, number>();
    const counts = new Map<number, number>();
    for (const [sid, emb] of statementEmbeddings) {
        const mi = stmtToModel.get(sid);
        if (mi === undefined) continue;
        const sim = cosineSimilarity(queryEmbedding, emb);
        sums.set(mi, (sums.get(mi) ?? 0) + sim);
        counts.set(mi, (counts.get(mi) ?? 0) + 1);
    }

    const result = new Map<number, number>();
    for (const [mi, sum] of sums) {
        const count = counts.get(mi) ?? 1;
        result.set(mi, sum / count);
    }
    return result;
}
```

### 3.5.2 Activate the boost in `computeModelOrdering`

In `src/geometry/interpretation/modelOrdering.ts`, remove the `void queryRelevanceBoost;` line.

After the irreplaceability scoring loop (after `for (const region of regions) { ... }`), add the blend:

```typescript
    // Blend query relevance boost into final score
    // Only changes ordering when models differ in query relevance.
    // If all models have similar relevance, this is a no-op.
    if (queryRelevanceBoost && queryRelevanceBoost.size > 0) {
        // Normalize boost to 0..1 range relative to max
        let maxBoost = 0;
        for (const v of queryRelevanceBoost.values()) {
            if (v > maxBoost) maxBoost = v;
        }

        if (maxBoost > 0) {
            // Scale factor: query relevance contributes proportionally to irreplaceability range
            // This ensures it breaks ties and nudges order without dominating
            let maxIrr = 0;
            for (const s of scoreByModelIndex.values()) {
                if (s.irreplaceability > maxIrr) maxIrr = s.irreplaceability;
            }
            // Query boost adds up to 25% of the irreplaceability range
            const alpha = maxIrr > 0 ? (maxIrr * 0.25) / maxBoost : 0.1 / maxBoost;

            for (const [mi, boost] of queryRelevanceBoost) {
                const s = scoreByModelIndex.get(mi);
                if (s) {
                    s.irreplaceability += boost * alpha;
                }
            }
        }
    }
```

**Why 25%:** Query relevance should nudge ordering, not dominate it. A model that's geometrically irreplaceable should still rank high even if slightly less relevant. But among models with similar irreplaceability, the most relevant one should win. 25% of the irreplaceability range is enough to break ties without overriding geometric signal. This can be tuned later.

### 3.5.3 Update `buildPreSemanticInterpretation` signature

In `src/geometry/interpretation/index.ts`, add the parameter:

```typescript
export function buildPreSemanticInterpretation(
    substrate: GeometricSubstrate,
    paragraphs: ShadowParagraph[],
    clusters?: ParagraphCluster[],
    paragraphEmbeddings?: Map<string, Float32Array> | null,
    queryRelevanceBoost?: Map<number, number>
): PreSemanticInterpretation {
```

And pass it through to `computeModelOrdering`:

Change:
```typescript
    const modelOrdering =
        pipelineGate.verdict === 'insufficient_structure'
            ? buildDefaultModelOrdering(substrate, regionization.regions.length)
            : computeModelOrdering(regionization.regions, regionProfiles, substrate);
```

To:
```typescript
    const modelOrdering =
        pipelineGate.verdict === 'insufficient_structure'
            ? buildDefaultModelOrdering(substrate, regionization.regions.length)
            : computeModelOrdering(regionization.regions, regionProfiles, substrate, queryRelevanceBoost);
```

### 3.5.4 Compute the boost in StepExecutor before pre-semantic

In `src/core/execution/StepExecutor.js`, after the substrate is built and degenerate check is done (approximately line ~715), and before `buildPreSemanticInterpretation` is called (approximately line ~755):

```js
        // Compute per-model query relevance boost (lightweight, no regions needed)
        let perModelQueryRelevance = undefined;
        if (queryEmbedding && statementEmbeddingResult?.embeddings && paragraphResult?.paragraphs) {
            try {
                const { computePerModelQueryRelevance } = await import('../../geometry/interpretation/modelOrdering');
                perModelQueryRelevance = computePerModelQueryRelevance(
                    queryEmbedding,
                    statementEmbeddingResult.embeddings,
                    paragraphResult.paragraphs
                );
            } catch (err) {
                console.warn('[StepExecutor] Per-model query relevance failed:', getErrorMessage(err));
            }
        }
```

Then update the `buildPreSemanticInterpretation` call to pass it:

```js
            preSemanticInterpretation = buildPreSemanticInterpretation(
              substrate,
              paragraphResult.paragraphs,
              Array.isArray(clusteringResult?.clusters) ? clusteringResult.clusters : undefined,
              geometryParagraphEmbeddings,
              perModelQueryRelevance  // add: query relevance boost for model ordering
            );
```

### 3.5.5 Export the new function

In `src/geometry/interpretation/index.ts`, add to exports:

```typescript
export { computeModelOrdering, computePerModelQueryRelevance } from './modelOrdering';
```

---

## Part 4: Delete StepExecutor Convergence Block

**File:** `src/core/execution/StepExecutor.js`

### 4.1 Locate the block

The convergence block starts at approximately line 1490:
```js
if (mapperArtifact) {
    mapperArtifact.structuralValidation = structuralValidation;
    try {
        // 1. Setup & Helpers
        const pre = preSemanticInterpretation || null;
```

And ends at approximately line 1972:
```js
    } catch (err) {
        console.error('[StepExecutor] Convergence: Artifact construction failed', err);
    }
}
```

### 4.2 Replace the entire block

Delete everything from `if (mapperArtifact) {` through its closing `}` (the try/catch and all seven sub-blocks).

Replace with:

```js
if (mapperArtifact) {
    // Store structural diagnostics (replaces old convergence block)
    try {
        // Import computeDiagnostics — it returns observations + measurements
        // The function is already imported at the top of the mapping step
        // as validateStructuralMapping (which is a wrapper around computeDiagnostics)
        const diagnostics = structuralValidation; // already computed above as validateStructuralMapping result
        mapperArtifact.structuralValidation = diagnostics;

        // Stamp per-claim sourceCoherence for UI display
        const claimMeasurements = diagnostics?.measurements?.claimMeasurements;
        if (Array.isArray(claimMeasurements)) {
            const coherenceById = new Map(
                claimMeasurements.map(m => [m.claimId, m])
            );
            for (const c of (mapperArtifact.claims ?? [])) {
                const m = coherenceById.get(c?.id);
                if (m && typeof m.sourceCoherence === 'number') {
                    c.sourceCoherence = m.sourceCoherence;
                }
            }
        }

        // No convergence object — replaced by diagnostics.measurements
        // Remove mapperArtifact.convergence entirely
    } catch (err) {
        console.error('[StepExecutor] Diagnostics stamp failed', err);
    }
}
```

### 4.3 Update the validateStructuralMapping call

Find where `structuralValidation` is computed (should be earlier in the mapping step, approximately lines 1480-1488). It currently calls `validateStructuralMapping(preSemanticInterpretation, structuralAnalysis)`. Update to pass the new parameters:

```js
const structuralValidation = validateStructuralMapping(
    preSemanticInterpretation,
    structuralAnalysis,
    substrate,                                    // add: GeometricSubstrate
    statementEmbeddingResult?.embeddings ?? null,  // add: statement embeddings
    paragraphResult?.paragraphs ?? null             // add: ShadowParagraph[] for exact model attribution
);
```

Verify that `substrate` is available in scope at this point. It should be — it's the geometric substrate built earlier in the mapping step. If the variable name is different (e.g., `geometricSubstrate` or `substrateResult?.substrate`), use the correct reference.

### 4.4 Remove convergenceConfidence from claims/edges

Search the StepExecutor for any remaining code that sets `convergenceConfidence` on claims or edges. After deleting the convergence block, there should be none. Verify.

### 4.5 Remove mapperArtifact.convergence

Search for `mapperArtifact.convergence` — the old block assigned to it. After deleting the convergence block, this assignment is gone. Verify no other code sets it.

---

## Part 5: Update `shared/contract.ts`

**File:** `shared/contract.ts`

### 5.1 Update Claim interface

Remove `convergenceConfidence`, add `sourceCoherence`:

```typescript
export interface Claim {
    id: string;
    label: string;
    role: 'anchor' | 'branch' | 'challenger' | 'supplement';
    challenges: string | null;
    quote?: string;
    support_count?: number;
    sourceStatementIds?: string[];
    sourceCoherence?: number | null;  // replaces convergenceConfidence
}
```

### 5.2 Update Edge interface

Remove `convergenceConfidence`:

```typescript
export interface Edge {
    from: string;
    to: string;
    type: 'supports' | 'conflicts' | 'tradeoff' | 'prerequisite';
    // convergenceConfidence removed — edge measurements live in diagnostics
}
```

### 5.3 Update PreSemanticInterpretation

Replace the old interface with one matching the runtime type:

```typescript
export interface PreSemanticInterpretation {
    lens: PipelineAdaptiveLens;
    regionization: PipelineRegionizationResult;
    regionProfiles: PipelineRegionProfile[];
    pipelineGate?: PipelineGateResult;
    modelOrdering?: ModelOrderingResult;
}
```

Note: `pipelineGate` and `modelOrdering` are optional in the contract because the contract is also used for cognitive artifacts which may have been serialized before these fields existed. Runtime code should check for their presence.

Add the corresponding Pipeline types for `PipelineGateResult` and `ModelOrderingResult`. These should mirror the types in `src/geometry/interpretation/types.ts` but with `Pipeline` prefix for contract consistency:

```typescript
export type PipelineGateVerdict = 'proceed' | 'skip_geometry' | 'trivial_convergence' | 'insufficient_structure';

export interface PipelineGateResult {
    verdict: PipelineGateVerdict;
    confidence: number;
    evidence: string[];
    measurements?: {
        isDegenerate: boolean;
        largestComponentRatio: number;
        largestComponentModelDiversityRatio: number;
        isolationRatio: number;
        maxComponentSize: number;
        nodeCount: number;
    };
}

export interface PipelineModelScore {
    modelIndex: number;
    irreplaceability: number;
    breakdown?: {
        soloCarrierRegions: number;
        lowDiversityContribution: number;
        totalParagraphsInRegions: number;
    };
}

export interface ModelOrderingResult {
    orderedModelIndices: number[];
    scores: PipelineModelScore[];
    meta?: {
        totalModels: number;
        regionCount: number;
        processingTimeMs: number;
    };
}
```

### 5.4 Remove dead types

Remove these types entirely from the contract:

- `PipelineOppositionPair`
- `PipelineInterRegionSignal`
- `PipelineInterRegionRelationship`
- `PipelineMapperGeometricHints`
- `PipelineShapePrediction`
- `StructuralViolation`
- `StructuralValidation`

### 5.5 Update structuralValidation field type

In the `CognitiveArtifact` geometry block (approximately line 1335-1340) and the `StructuralAnalysis` interface (approximately line 790-795), `structuralValidation` currently references `StructuralValidation` type. Change to `any` with a comment:

```typescript
geometry: {
    embeddingStatus: "computed" | "failed";
    substrate: PipelineSubstrateGraph;
    preSemantic?: PreSemanticInterpretation | CognitivePreSemantic | null;
    structuralValidation?: any;  // DiagnosticsResult — typed as any for backward compat with old artifacts
};
```

### 5.6 Update StructuralAnalysis summary block

The `StructuralAnalysis` interface has a `summary` block (approximately line 1934-1940) with a `convergenceScore` field. If this field was populated from the old convergence block, it will now be undefined. Mark it optional if not already:

```typescript
summary: {
    // ... existing fields ...
    convergenceScore?: number | null;  // deprecated, no longer computed
};
```

---

## Part 6: Update `shared/cognitive-artifact.ts`

**File:** `shared/cognitive-artifact.ts`

### 6.1 Fix stale lens.shape reference

Line ~45: `hint: pipeline.preSemantic.lens?.shape ?? 'sparse'`

`AdaptiveLens` has no `shape` field. Replace with:

```js
hint: pipeline.preSemantic.lens?.regime ?? 'fragmented',
```

### 6.2 Update convergence → diagnostics

Line ~49: `convergence: mapper?.convergence ?? undefined`

Replace with:

```js
diagnostics: mapper?.diagnostics ?? mapper?.structuralValidation ?? undefined,
```

Keep `convergence` as well for backward compatibility with old artifacts that may be loaded:

```js
convergence: mapper?.convergence ?? undefined,  // deprecated, kept for old artifact compat
diagnostics: mapper?.diagnostics ?? mapper?.structuralValidation ?? undefined,
```

---

## Part 7: Update UI

### 7.1 DecisionMapSheet — Replace convergenceConfidence badge

**File:** `ui/components/DecisionMapSheet.tsx`

In `handleNodeClick` (approximately line 1170-1189), `convergenceConfidence` is read from the semantic claim and stored on `selectedNode`. Replace with `sourceCoherence`:

Find:
```tsx
const convergenceConfidence =
    typeof (fromSemantic as any)?.convergenceConfidence === "number"
        ? (fromSemantic as any).convergenceConfidence
        : typeof node?.convergenceConfidence === "number"
            ? node.convergenceConfidence
            : undefined;

setSelectedNode({
    id: node.id,
    label: node.label,
    supporters: node.supporters || [],
    theme: node.type || node.theme,
    convergenceConfidence,
});
```

Replace with:
```tsx
const sourceCoherence =
    typeof (fromSemantic as any)?.sourceCoherence === "number"
        ? (fromSemantic as any).sourceCoherence
        : undefined;

setSelectedNode({
    id: node.id,
    label: node.label,
    supporters: node.supporters || [],
    theme: node.type || node.theme,
    sourceCoherence,
});
```

In the DetailView component (approximately line 560-565), update the interface and display:

Find:
```tsx
convergenceConfidence?: number;
```

Replace with:
```tsx
sourceCoherence?: number;
```

Find the badge display (approximately line 665-668):
```tsx
{typeof node.convergenceConfidence === "number" && (
    <span ...>
        Convergence {(Number(node.convergenceConfidence || 0) * 100).toFixed(0)}%
    </span>
)}
```

Replace with:
```tsx
{typeof node.sourceCoherence === "number" && (
    <span className="mt-3 text-[11px] px-2 py-1 rounded-full border font-semibold bg-surface-highlight/10 border-border-subtle text-text-muted">
        Coherence {node.sourceCoherence.toFixed(2)}
    </span>
)}
```

### 7.2 DecisionMapObservabilityRow — Replace convergence cards

**File:** `ui/components/DecisionMapObservabilityRow.tsx`

Find the convergence cards block (approximately lines 677-691) that reads `convergence?.mechanicalConflictConvergence` and `convergence?.relationshipConvergence`:

```tsx
if (convergence && typeof convergence === "object") {
    const conflictRatio = safeNum(convergence?.mechanicalConflictConvergence?.confirmationRatio);
    const agreementRatio = safeNum(convergence?.relationshipConvergence?.agreementRatio);
    cards.push({ label: "Conv conflict", ... });
    cards.push({ label: "Conv edges", ... });
}
```

Remove this block entirely. These metrics no longer exist.

Find the partition convergence cards block (approximately lines 695-710) that reads `partitionConv?.oppositionCoverageRatio`, etc.:

Remove the `oppositions`-related lines. Keep `partitionConv?.sideSeparatedRatio` if it exists — that's the honest part. Or remove the whole block if cleaner.

Find the claim table column for convergenceConfidence (approximately line 1075):

```tsx
{ key: "convergence", header: "Conv", ... }
```

Replace with:

```tsx
{ key: "sourceCoherence", header: "Coherence", className: "whitespace-nowrap",
  cell: (r) => typeof r.sourceCoherence === "number" ? r.sourceCoherence.toFixed(2) : "—",
  sortValue: (r) => r.sourceCoherence ?? null },
```

Update the claim row data (approximately line 1026) to read `sourceCoherence` instead of `convergenceConfidence`:

Find: `const convergence = safeNum(c?.convergenceConfidence);`
Replace with: `const sourceCoherence = safeNum(c?.sourceCoherence);`

And update the row object to include `sourceCoherence` instead of `convergence`.

Find the edge table row (approximately line 1090) that reads `.convergenceConfidence`:

Replace with reading edge measurements from diagnostics, or simply remove the convergence column from the edge table.

### 7.3 DecisionMapObservabilityRow — Add diagnostics measurements table

Add a new collapsible section (in the debug/observability area, not the main view) that displays the full diagnostics measurements:

**Claim measurements table** — columns: claimId, sourceCoherence, embeddingSpread, regionSpan, sourceModelDiversity, dominantRegionId, dominantRegionTier

**Edge measurements table** — columns: edgeId, edgeType, crossesRegionBoundary, centroidSimilarity, fromRegionId, toRegionId

**Observations list** — the existing observations from diagnostics, displayed as text

These should be in a collapsible/secondary section. The existing cards row (Regions, Profiles, Regime, Gate) stays at the top as the primary summary.

The diagnostics data should be read from the artifact at: `artifact?.structural?.diagnostics ?? artifact?.structural?.structuralValidation ?? artifact?.diagnostics`

---

## Part 8: Verification Checklist

After all changes:

1. **Compile check:** `tsc --noEmit` — verify no type errors from removed types or changed interfaces.

2. **Search for orphan `convergenceConfidence`:** Grep the entire codebase for `convergenceConfidence`. It should appear nowhere except possibly in deprecated `oldstep.js` / `oldinterpreindex.ts` files.

3. **Search for orphan convergence consumers:** Grep for `mapperArtifact.convergence` — should be removed or migrated to `mapperArtifact.diagnostics`.

4. **Search for stale contract types:** Grep for `PipelineOppositionPair`, `PipelineInterRegionSignal`, `PipelineInterRegionRelationship`, `PipelineMapperGeometricHints`, `PipelineShapePrediction`, `StructuralViolation`, `StructuralValidation` — should appear nowhere except deprecated files.

5. **Search for `pre.oppositions`, `pre.interRegionSignals`, `pre.hints`:** Should appear nowhere in active code.

6. **Test:** Run `npm test` — all tests should pass.

7. **Verify `structuralValidation` call site in StepExecutor:** Confirm it now passes substrate and statementEmbeddings.

8. **Verify diagnostics result shape:** After running the pipeline, check that `mapperArtifact.structuralValidation` contains both `observations` and `measurements` blocks.

9. **Verify query relevance → model ordering integration:** Confirm that `computePerModelQueryRelevance` is called before `buildPreSemanticInterpretation` in StepExecutor. Confirm `void queryRelevanceBoost` is removed from `computeModelOrdering`. Confirm the boost parameter flows through `buildPreSemanticInterpretation` → `computeModelOrdering`.

---

## Execution Order

1. Update `src/geometry/interpretation/types.ts` — add new measurement types, update DiagnosticsResult
2. Rewrite `src/geometry/interpretation/diagnostics.ts` — add measurement computation
3. Update `src/geometry/interpretation/validation.ts` — pass through new params
3.5. Activate query relevance → model ordering:
   a. Add `computePerModelQueryRelevance` to `modelOrdering.ts`
   b. Remove `void queryRelevanceBoost`, add blend logic in `computeModelOrdering`
   c. Update `buildPreSemanticInterpretation` in `index.ts` to accept and forward boost
   d. Add boost computation in StepExecutor before `buildPreSemanticInterpretation` call
   e. Export new function from `index.ts`
4. Update `src/core/execution/StepExecutor.js` — delete convergence block, update validateStructuralMapping call, stamp sourceCoherence
5. Update `shared/contract.ts` — remove dead types, update interfaces
6. Update `shared/cognitive-artifact.ts` — fix stale references
7. Update `ui/components/DecisionMapSheet.tsx` — swap badge
8. Update `ui/components/DecisionMapObservabilityRow.tsx` — swap cards and tables
9. Compile check + test
10. Orphan search verification + query relevance integration verification

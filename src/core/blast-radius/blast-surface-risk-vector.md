# Blast Surface: Scalar Composite → Risk Vector

## Motivation

The current vernal composite (`structuralMass + queryTilt`) adds orphan counts + cascade exposure + scaled cosine — three different units measuring three categorically different risks. First-principles analysis of what actually happens to statements when a claim is pruned reveals the composite conflates risks with fundamentally different downstream guarantees.

## The Canonical Fate Table

When a single claim C is pruned (all others survive), every canonical statement falls into exactly one of three types:

| Type | Definition | Fate on prune | Information loss | Conservation floor |
|------|-----------|---------------|-----------------|-------------------|
| **Type 1: Non-exclusive** | Shared with ≥1 surviving claim | **PROTECTED** (living parents) | Zero — full text survives | Guaranteed safe |
| **Type 2: Exclusive non-orphan** | Exclusive to C, has semantic twin elsewhere | **REMOVE** (≥2 carriers) or **SKELETONIZE** (1 carrier) | Lossy substitution — twin carries approximate idea, original articulation lost | None — can be fully deleted |
| **Type 3: Exclusive orphan** | Exclusive to C, no twin anywhere | **SKELETONIZE** only | Degradation — entities survive, relational framing stripped | Conservation law: last instance cannot be removed |

**Key insight**: Type 2 (exclusive non-orphans) are the *highest removal risk* — the only statements that can reach REMOVE fate. Type 3 (orphans) are *irrecoverable* but *cannot be deleted* — they always skeletonize. The current composite treats orphan count as primary vulnerability, but orphans have the strongest conservation guarantee.

## Architecture: Three Orthogonal Risk Axes

### Axis 1: `deletionRisk` (Type 2 mass)
- **Counts**: Exclusive non-orphan statements (= `layerB.absorbableCount`, already computed)
- **Meaning**: Text that will be entirely erased from the corpus on prune
- **Danger**: "Entity Wipeout" — synthesizer forced to rely on geometric twins that may lack specific nouns/numbers of the original

### Axis 2: `degradationRisk` (Type 3 mass)
- **Counts**: Exclusive orphan statements (= `layerB.orphanCount`, already computed)
- **Meaning**: Text that will be stripped to entity-only skeletons
- **Danger**: "Argument Collapse" — entities guaranteed to survive, but synthesizer must guess how they relate to surviving claims

### Axis 3: `cascadeFragility` (Type 1 continuous protection-depth measure)
- **Measures**: Sum of `1 / (parentCount - 1)` over all non-exclusive statements in the claim's canonical set
- **Meaning**: How much shared evidence becomes structurally exposed if this claim is pruned, weighted by protection depth
- **Danger**: "Future Fragility" — compounding risk with no conservation floor on subsequent prunes

**Why continuous, not binary**: A statement with 2 parents contributes 1.0 (becomes fully exclusive on prune). A statement with 3 parents contributes 0.5 (still shared, but thinner). A statement with 10 parents contributes 0.1 (barely affected). This scales proportionally rather than discarding all statements with >2 parents. The sum is dimensionally compatible with deletionRisk and degradationRisk (statement-count scale).

**Distribution diagnostics**: The per-statement `1/(parentCount-1)` values form a distribution. Its μ and σ tell you whether the claim's shared evidence is uniformly well-protected (low σ, low μ) or has a mixture of thin and thick protection (high σ). These are surfaced for inspection.

### Simplex constraint
Type1 + Type2 + Type3 = canonicalCount (always). The three type counts live on a 2D simplex. Two derived ratios capture the shape:
- `isolation` = (Type2 + Type3) / canonicalCount — fraction of evidence that's exclusive
- `orphanCharacter` = Type3 / (Type2 + Type3) — within exclusives, fraction that are orphans (0 = all twinned, 1 = all orphaned)

---

## File-by-File Implementation

### File 1: `shared/contract.ts`

**Add** new interface (place directly after `BlastSurfaceVernalScore`):

```typescript
/** Risk vector: three orthogonal axes of pruning damage, derived from the canonical fate table. */
export interface BlastSurfaceRiskVector {
  /** Type 2 count: exclusive non-orphan statements. These are REMOVED on prune. Highest removal risk. */
  deletionRisk: number;
  /** Type 2 statement IDs for drilldown */
  deletionStatementIds: string[];

  /** Type 3 count: exclusive orphan statements. These are SKELETONIZED on prune. Irrecoverable but never deleted. */
  degradationRisk: number;
  /** Type 3 statement IDs for drilldown */
  degradationStatementIds: string[];

  /** Continuous protection-depth: sum of 1/(parentCount-1) over non-exclusive statements. Dimensionally compatible with statement counts. */
  cascadeFragility: number;
  /** Per-statement fragility contributions for drilldown: { statementId, parentCount, fragility } */
  cascadeFragilityDetails: Array<{ statementId: string; parentCount: number; fragility: number }>;
  /** Distribution stats of per-statement fragility values */
  cascadeFragilityMu: number;
  cascadeFragilitySigma: number;

  /** Derived: (Type2 + Type3) / canonicalCount. 0 = fully shared, 1 = fully isolated. */
  isolation: number;
  /** Derived: Type3 / (Type2 + Type3). 0 = all twinned, 1 = all orphaned. NaN-safe: 0 when no exclusives. */
  orphanCharacter: number;

  /** Simplex coordinates for visualization: [type1Frac, type2Frac, type3Frac] summing to 1.0 */
  simplex: [number, number, number];
}
```

**Modify** `BlastSurfaceClaimScore` — add the risk vector field:

```typescript
export interface BlastSurfaceClaimScore {
  claimId: string;
  claimLabel: string;
  layerB: ClaimAbsorptionProfile;
  layerC: BlastSurfaceLayerC;
  layerD: BlastSurfaceLayerD;
  vernal?: BlastSurfaceVernalScore;
  riskVector?: BlastSurfaceRiskVector;  // ← ADD
}
```

**Modify** `BlastSurfaceLayerC` — add the three type counts alongside the existing canonicalCount:

```typescript
export interface BlastSurfaceLayerC {
  canonicalCount: number;
  /** Non-exclusive statements (Type 1) — protected by living parents on single prune */
  nonExclusiveCount: number;   // ← ADD
  /** Exclusive non-orphan statements (Type 2) — removable on prune */
  exclusiveNonOrphanCount: number;  // ← ADD
  /** Exclusive orphan statements (Type 3) — skeletonized on prune, never removed */
  exclusiveOrphanCount: number;     // ← ADD
}
```

These are backward-compatible additions. No existing fields removed.

---

### File 2: `src/core/blast-radius/blastSurface.ts`

#### Step 1: Compute Type counts in Layer C

In the per-claim loop (around line 130), after `layerB` is computed and before the existing `layerC` assignment:

```typescript
// Layer B already gives us:
//   layerB.orphanCount       = Type 3 count
//   layerB.absorbableCount   = Type 2 count  (exclusiveCount - orphanCount)
//   layerB.exclusiveCount    = Type 2 + Type 3

const type1Count = canonicalSet.size - exclusiveIds.length;  // non-exclusive
const type2Count = layerB.absorbableCount;                   // exclusive non-orphan
const type3Count = layerB.orphanCount;                       // exclusive orphan

const layerC: BlastSurfaceLayerC = {
  canonicalCount: canonicalSet.size,
  nonExclusiveCount: type1Count,
  exclusiveNonOrphanCount: type2Count,
  exclusiveOrphanCount: type3Count,
};
```

This replaces the existing single-line `layerC` assignment. No new computation needed — the values are already available from `layerB` and the existing `exclusiveIds`.

#### Step 2: Compute cascadeFragility (continuous protection-depth)

Add this inside the per-claim loop, after canonicalSet is available:

```typescript
// Continuous cascade fragility: for each non-exclusive statement,
// compute 1/(parentCount - 1) — how exposed it becomes if THIS claim is pruned.
// parent=2 → 1.0 (becomes exclusive), parent=3 → 0.5, parent=10 → 0.1
const cascadeFragilityDetails: Array<{ statementId: string; parentCount: number; fragility: number }> = [];
let cascadeFragilitySum = 0;
for (const sid of canonicalSet) {
  const ownerCount = canonicalOwnerCounts.get(sid) ?? 0;
  if (ownerCount >= 2) {  // non-exclusive: owned by this claim + at least one other
    const fragility = 1 / (ownerCount - 1);
    cascadeFragilityDetails.push({ statementId: sid, parentCount: ownerCount, fragility });
    cascadeFragilitySum += fragility;
  }
}
// Distribution stats for diagnostic surface
const fragValues = cascadeFragilityDetails.map(d => d.fragility);
const cascadeFragilityMu = fragValues.length > 0
  ? fragValues.reduce((a, b) => a + b, 0) / fragValues.length : 0;
const cascadeFragilitySigma = fragValues.length > 0
  ? Math.sqrt(fragValues.reduce((s, v) => s + (v - cascadeFragilityMu) ** 2, 0) / fragValues.length) : 0;
```

#### Step 3: Assemble the risk vector

After layerB, layerC, and the thin-protection computation, build the risk vector:

```typescript
// Deletion risk IDs = exclusive non-orphan statement IDs
const deletionStatementIds = layerB.statements
  .filter(s => !s.orphan)
  .map(s => s.statementId);

// Degradation risk IDs = orphan statement IDs
const degradationStatementIds = layerB.statements
  .filter(s => s.orphan)
  .map(s => s.statementId);

const K = canonicalSet.size;
const exclusiveTotal = type2Count + type3Count;
const isolation = K > 0 ? exclusiveTotal / K : 0;
const orphanCharacter = exclusiveTotal > 0 ? type3Count / exclusiveTotal : 0;

const type1Frac = K > 0 ? type1Count / K : 0;
const type2Frac = K > 0 ? type2Count / K : 0;
const type3Frac = K > 0 ? type3Count / K : 0;

const riskVector: BlastSurfaceRiskVector = {
  deletionRisk: type2Count,
  deletionStatementIds,
  degradationRisk: type3Count,
  degradationStatementIds,
  cascadeFragility: cascadeFragilitySum,
  cascadeFragilityDetails,
  cascadeFragilityMu,
  cascadeFragilitySigma,
  isolation,
  orphanCharacter,
  simplex: [type1Frac, type2Frac, type3Frac],
};
```

#### Step 4: Attach to the score object

In the `scores.push(...)` call (around line 150), add `riskVector`:

```typescript
scores.push({
  claimId,
  claimLabel,
  layerB,
  layerC,
  layerD,
  vernal: { /* ... existing ... */ },
  riskVector,   // ← ADD
});
```

#### Step 5: Keep the vernal composite intact (additive philosophy)

Do NOT remove the existing vernal composite computation. It continues to work as before. The risk vector is an additive layer. Once consumers migrate to reading the vector, the composite can be deprecated.

---

### File 3: `src/core/blast-radius/questionSelection.ts`

The existing consumer reads `score.vernal.compositeScore` in two places:

1. **Damage banding** (around line 200-230): Ranks claims by composite for band assignment.
2. **Isolate candidate ranking** (around line 514): Sorts isolate candidates by composite.

**For now: no changes required.** The risk vector is additive. The composite continues to drive question selection until you validate the vector produces better signal. The vector is surfaced in the instrument panel for comparison.

**Future migration** (do NOT implement yet, just noting the design):
- Damage banding should primarily sort by `deletionRisk` (Type 2) since these are the statements that actually leave the corpus
- Isolate detection should check `isolation` ratio instead of just `orphanRatio` — a claim can be highly isolated with low orphan ratio (all exclusives are twinned) which is still dangerous
- Cascade-aware question ordering should weight `cascadeFragility` to prefer pruning claims that don't create thin-protection problems for neighbors

---

### File 4: `ui/components/instrument/LayerCards.tsx`

**Modify the VernalRow type** (around line 1334) to include risk vector fields:

```typescript
type VernalRow = {
  id: string; label: string;
  compositeScore: number | null;
  structuralMass: number | null;
  vulnerableCount: number;
  cascadeExposure: number | null;
  destroyedQueryMean: number | null;
  queryTilt: number | null;
  // Risk vector additions:
  deletionRisk: number | null;
  degradationRisk: number | null;
  cascadeFragility: number | null;
  isolation: number | null;
  orphanCharacter: number | null;
};
```

**In the rows mapping** (around line 1345), extract risk vector fields:

```typescript
const rv = s?.riskVector;
return {
  // ... existing fields ...
  deletionRisk: typeof rv?.deletionRisk === 'number' ? rv.deletionRisk : null,
  degradationRisk: typeof rv?.degradationRisk === 'number' ? rv.degradationRisk : null,
  cascadeFragility: typeof rv?.cascadeFragility === 'number' ? rv.cascadeFragility : null,
  isolation: typeof rv?.isolation === 'number' ? rv.isolation : null,
  orphanCharacter: typeof rv?.orphanCharacter === 'number' ? rv.orphanCharacter : null,
};
```

**Add columns to the SortableTable** (around line 1414). Insert after the existing "Tilt" column:

```typescript
{ key: "deletionRisk", header: "Del", sortValue: (r) => r.deletionRisk,
  cell: (r) => <span className="font-mono text-[10px] text-red-400">{r.deletionRisk ?? "–"}</span> },
{ key: "degradationRisk", header: "Deg", sortValue: (r) => r.degradationRisk,
  cell: (r) => <span className="font-mono text-[10px] text-amber-400">{r.degradationRisk ?? "–"}</span> },
{ key: "cascadeFragility", header: "Frag", sortValue: (r) => r.cascadeFragility,
  cell: (r) => <span className="font-mono text-[10px] text-blue-400">{r.cascadeFragility !== null ? r.cascadeFragility.toFixed(1) : "–"}</span> },
{ key: "isolation", header: "Iso", sortValue: (r) => r.isolation,
  cell: (r) => <span className="font-mono text-[10px]">{r.isolation !== null ? r.isolation.toFixed(2) : "–"}</span> },
{ key: "orphanCharacter", header: "OC", sortValue: (r) => r.orphanCharacter,
  cell: (r) => <span className="font-mono text-[10px]">{r.orphanCharacter !== null ? r.orphanCharacter.toFixed(2) : "–"}</span> },
```

Color coding: red for deletion (highest actual risk), amber for degradation (bounded), blue for cascade (future risk).

---

### File 5: `ui/components/ParagraphSpaceView.tsx` — ALREADY IMPLEMENTED (update only)

**Existing implementation** (already working, DO NOT rewrite):
- Local `RiskVector` type (line ~77) with type1/type2/type3/total/isolation/orphanCharacter
- `RISK_COLORS` constants: deletion=#ef4444, degradation=#f59e0b, shared=#3b82f6
- `riskVectorMap` useMemo (line ~233) deriving vectors from `blastSurface.scores` layerB/layerC
- `donutArc()` SVG helper for rendering donut segments on claim diamonds
- Full donut glyph rendering when `showRiskGlyphs=true` (line ~623)
- Risk legend overlay (line ~399)
- Props: `blastSurface?: BlastSurfaceResult`, `showRiskGlyphs?: boolean`
- Hover labels: `D:{type2} S:{type3} P:{type1}`

**What to change when pipeline outputs `riskVector`:**

Once `blastSurface.ts` populates `riskVector` on each score, update the `riskVectorMap` useMemo to read from it instead of deriving locally:

```typescript
// BEFORE (current — view-time derivation):
const type1 = Math.max(0, canonicalCount - exclusiveCount);
const type2 = absorbableCount;
const type3 = orphanCount;

// AFTER (read pipeline output, add cascadeFragility):
const rv = s.riskVector;
if (rv) {
  m.set(id, {
    claimId: id,
    type1: rv.simplex[0] * (rv.deletionRisk + rv.degradationRisk + /* derive type1 count */),
    // OR simpler: just read the layerC type counts directly
    type1: s.layerC?.nonExclusiveCount ?? 0,
    type2: rv.deletionRisk,
    type3: rv.degradationRisk,
    total: s.layerC?.canonicalCount ?? 0,
    isolation: rv.isolation,
    orphanCharacter: rv.orphanCharacter,
    cascadeFragility: rv.cascadeFragility,
    cascadeFragilityMu: rv.cascadeFragilityMu,
    cascadeFragilitySigma: rv.cascadeFragilitySigma,
  });
}
```

**Also update the local `RiskVector` type** to include the new fields:

```typescript
type RiskVector = {
  claimId: string;
  type1: number;
  type2: number;
  type3: number;
  total: number;
  isolation: number;
  orphanCharacter: number;
  cascadeFragility?: number;      // ← ADD
  cascadeFragilityMu?: number;    // ← ADD
  cascadeFragilitySigma?: number; // ← ADD
};
```

**Update hover label** to include fragility when available:

```typescript
// Current:
{`D:${rv.type2} S:${rv.type3} P:${rv.type1}`}
// Updated:
{`D:${rv.type2} S:${rv.type3} P:${rv.type1}${rv.cascadeFragility != null ? ` F:${rv.cascadeFragility.toFixed(1)}` : ''}`}
```

---

## Verification Checklist

After implementation, run a pipeline and check:

1. **Simplex sums to 1**: For every claim, verify `simplex[0] + simplex[1] + simplex[2] ≈ 1.0`
2. **Type counts sum to canonical**: `nonExclusiveCount + exclusiveNonOrphanCount + exclusiveOrphanCount === canonicalCount`
3. **Existing values unchanged**: `layerB.orphanCount` should equal `riskVector.degradationRisk`. `layerB.absorbableCount` should equal `riskVector.deletionRisk`. The vernal composite should be identical to before.
4. **cascadeFragility range check**: Should be ≤ nonExclusiveCount (maximum when all non-exclusives have parent=2, each contributing 1.0). For well-connected corpora, expect cascadeFragility << nonExclusiveCount.
5. **Isolation × canonicalCount should equal exclusiveCount**: `riskVector.isolation * layerC.canonicalCount ≈ layerB.exclusiveCount`

## What This Does NOT Change

- The vernal composite is preserved as-is. No consumer changes.
- Layer D cascade echo computation is unchanged.
- Layer B twin detection is unchanged.
- questionSelection.ts continues reading compositeScore.
- No schema migration needed — `riskVector` is optional on `BlastSurfaceClaimScore`.

## Design Notes

**Why cascadeFragility is continuous, not binary**: A binary parent=2 count discards signal from the rest of the protection-depth distribution. A statement with 3 parents (fragility=0.5) is less protected than one with 10 (fragility=0.1), but the old binary gate would treat both as "safe." The continuous sum `Σ 1/(parentCount-1)` naturally weights thin protection more heavily and is dimensionally compatible with statement counts (a claim with 10 parent=2 statements has cascadeFragility=10.0, same scale as "10 statements at risk"). The μ and σ of the per-statement fragility distribution reveal whether shared evidence is uniformly well-protected or has a dangerous thin tail.

**Why vector, not scalar**: Different consumers need different axes. Survey question selection should weight deletionRisk (where actual corpus loss happens). Structural routing should weight cascadeFragility (where compounding risk lives). The completeness reporter should weight degradationRisk (where the synthesizer's reconstruction burden is highest). Keeping the vector decomposed moves the policy question from the blast surface (hidden inside the formula) to the consumer (visible, auditable weighting choice).

**Why the simplex matters**: The ternary simplex visualization (triangle plot where each claim is a dot positioned by its Type 1/2/3 proportions) immediately shows the landscape's character. A corpus where all claims cluster near the "all shared" corner has very different pruning dynamics than one where claims scatter across the triangle. This is a shape you cannot see from scalar composites.

---

## Paragraph Space View Integration

The risk vector is not orthogonal to the paragraph space — it projects directly onto it. Statements live inside paragraphs, and paragraphs are the nodes on the canvas. The risk vector tells you WHAT would happen to each statement; the paragraph space shows you WHERE that evidence lives geometrically.

### Claim-selected fate overlay (deferred — design only, do NOT implement yet)

When a claim is selected in the paragraph space view, source paragraph nodes could show fate-type coloring:

- **Red** nodes: contain ≥1 Type 2 statement (deletion risk — these paragraphs contribute text that will be erased)
- **Amber** nodes: contain Type 3 statements but no Type 2 (degradation risk — these paragraphs will be skeletonized)
- **Blue** nodes: contain only Type 1 statements (protected — these paragraphs are safe regardless)

This shows the spatial distribution of vulnerability. Clustered red nodes in one region = localized deletion damage. Scattered red nodes = diffuse damage. Red nodes at the periphery of the mutual graph = isolated vulnerable evidence.

### Fragile-share edges (deferred — design only, do NOT implement yet)

For non-exclusive statements with parent=2 (fragility=1.0), the two parent claims can be connected by a "fragile-share edge" on the canvas — drawn between claim diamonds, distinct from mapper edges. A claim diamond surrounded by many fragile-share edges is a cascade hub. This would be a toggle (`showFragileShareEdges`) alongside the existing `showMutualEdges` and `showMapperEdges`.

### Simplex badge in claim detail drawer (deferred — design only, do NOT implement yet)

The claim detail drawer (right overlay) already shows provenance and blast radius profiles. The simplex `[type1Frac, type2Frac, type3Frac]` could render as a small ternary triangle glyph — one shape that communicates the claim's evidence character at a glance. The existing `blastRadiusFilter.scores[]` lookup pattern extends naturally to `blastSurface.scores[].riskVector`.

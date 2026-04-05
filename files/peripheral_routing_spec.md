# Peripheral-Aware Passage Routing

## The Finding

NorthStar classification was fragile for claim_2 because its high CONC% depended on sole-source axiom paragraphs that geometry identified as peripheral. The technical grounding (blast radius, carriers) lived in shared core passages with lower concentration. After conceptual peripheral removal, claim_2's CONC% would drop and claim_3 (genuinely sole-source, zero peripheral losses) would dominate.

**Root cause:** passage scoring operates on all paragraphs indiscriminately. Peripheral paragraphs — geometrically marginal, short, declarative — inflate concentration for claims whose real evidence lives in shared core territory.

**Fix:** score passages on the structural core only. Peripheral evidence doesn't vote.

---

## Rules

### Rule 1: Core identification via largest basin

```
largestBasinRatio = largest basin node count / total node count

IF largestBasinRatio > 0.5  → dominant core exists
IF largestBasinRatio ≤ 0.5  → no dominant core (parallel cores)
IF no basin data            → graceful degradation (score everything)
```

The 0.5 threshold is the majority boundary. A core that isn't the majority isn't a core. Same self-interpreting threshold as a coin flip.

### Rule 2: Periphery = union of basin non-majority + gap singletons

```
periphery = {nodes NOT in the largest basin}
           ∪ {nodes in gap regions with exactly 1 node that aren't in the core}
(deduplicated)
```

Both signals available as inputs to the deterministic pipeline:
- `basinInversion.basins` → basin membership
- `preSemantic.regionization.regions` → gap singletons

### Rule 3: Filter before scoring, not after

When `corpusMode = 'dominant-core'`:
- Filter `paragraphCoverage` entries to **exclude** peripheral paragraph IDs
- Compute MAJ counts, concentration ratio, density ratio on **surviving core entries only**
- Passage contiguity recalculated: removing a peripheral node from mid-passage splits it into sub-runs; longest surviving sub-run is the new passage length

### Rule 4: Parallel-cores mode

When `corpusMode = 'parallel-cores'` (largestBasinRatio ≤ 0.5):
- No filtering — score full corpus
- Annotate each paragraph with basin membership
- Editorial model arranges by basin (parallel topic cores) rather than by priority within a single core
- Basin annotations propagate via `PassageRoutingResult.basinAnnotations`

### Rule 5: Number to watch is nodes, not basins

A corpus with basins [28, 3, 1, 1, 1] has 3 singleton basins but is NOT fragmented — 82% of nodes are in one basin. The metric is `largestBasinRatio` (node fraction), never "how many basins are small."

---

## Files Changed

### 1. `shared/contract.ts`

Add to `PassageClaimRouting.diagnostics`:

```typescript
corpusMode: 'dominant-core' | 'parallel-cores' | 'no-geometry';
peripheralNodeIds: string[];
peripheralRatio: number;
largestBasinRatio: number | null;
```

Add to `PassageRoutingResult`:

```typescript
basinAnnotations?: Record<string, number>;  // paragraphId → basinId
```

### 2. `src/core/passageRouting.ts`

**New input fields:**
```typescript
basinInversion?: BasinInversionResult | null;
regions?: MinimalRegion[];  // { kind: 'basin' | 'gap'; nodeIds: string[] }
```

**New function `identifyPeriphery()`:** reads basin data + gap regions, returns:
- `corpusMode` — which mode we're in
- `peripheralNodeIds` — Set of paragraph IDs to exclude
- `peripheralRatio` — fraction excluded
- `basinByNodeId` — for downstream annotation

**Modified Section A (per-claim profiles):**
```typescript
// Filter paragraphCoverage to core-only when in dominant-core mode
const activeCoverage = filterPeripheral
  ? profile.paragraphCoverage.filter(pc => !periphery.peripheralNodeIds.has(pc.paragraphId))
  : profile.paragraphCoverage;

// All downstream computation (majByModel, structuralContributors,
// dominantModel, concentrationRatio, densityRatio) operates on activeCoverage
```

**New function `countCorePassageLength()`:** handles passage fragmentation when peripheral nodes are removed from mid-passage. Finds longest surviving contiguous sub-run rather than naive (length - removed).

**Diagnostics enriched** with `corpusMode`, `peripheralNodeIds`, `peripheralRatio`, `largestBasinRatio`.

### 3. `src/core/execution/deterministicPipeline.js`

Wire two new fields into the `computePassageRouting` call:

```javascript
result.passageRoutingResult = computePassageRouting({
  claimDensityResult: result.claimDensityResult,
  enrichedClaims,
  validatedConflicts,
  modelCount,
  basinInversion: result.basinInversion ?? null,           // ← NEW
  regions: preSemantic?.regionization?.regions ?? [],       // ← NEW
});
```

Both already available at call time:
- `result.basinInversion` computed in Group A (step 11)
- `preSemantic` passed in as parameter to `computeDerivedFields`

---

## What Doesn't Change

- **Claim density computation** (`claimDensity.ts`) — untouched. Still counts all paragraphs and passages. The filtering happens in passage routing, not in density measurement.
- **Editorial mapper** — reads `landscapePosition` and `concentrationRatio` from routing result, which now reflect core-only scoring. No API change.
- **Statement classification** — reads routing positions. Automatically gets corrected values.
- **Instrument panel** — `ClaimDensityCard` shows raw density (all paragraphs); passage routing diagnostics now additionally show `corpusMode` and `peripheralRatio` so you can see both the raw and the filtered view.

---

## Instrumentation

After this change, the instrument panel should show:

| Field | What it tells you |
|---|---|
| `corpusMode` | Whether peripheral filtering was applied |
| `peripheralRatio` | What fraction of the corpus was excluded |
| `peripheralNodeIds` | Which specific paragraphs were excluded |
| `largestBasinRatio` | The basin ratio that drove the decision |

The convergence/divergence between raw density profiles (all paragraphs) and filtered routing positions (core only) is itself a diagnostic signal. A claim that's NorthStar on raw data but Mechanism after filtering had its importance built on peripheral emphasis — exactly the fragility this fixes.

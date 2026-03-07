# Known Issues

## Edge Type Default in Semantic Mapper Parser

**Location:** `shared/parsing-utils.ts` lines 685-690
**Severity:** Moderate — affects structural analysis accuracy
**Status:** Needs contract change

### Problem

When parsing semantic mapper output, unknown `rawType` values on edges default to `'supports'`:

```typescript
let type: Edge['type'] = 'supports';
if (/^(conflicts?)$/.test(rawType)) type = 'conflicts';
else if (rawType.includes('trade')) type = 'tradeoff';
else if (rawType.includes('prerequisite')) type = 'prerequisite';
```

`'supports'` is **not a neutral edge type**. Throughout structural analysis, `supports` is consistently grouped with `prerequisite` as a "reinforcing/positive" edge — the opposite pole from `conflicts`/`tradeoff` ("adversarial/tension"):

| Consumer | How `supports` is used |
|---|---|
| `metrics.ts` (computeCoreRatios) | `supports` + `prerequisite` = "reinforcingEdges" for alignment ratio |
| `patterns.ts` (detectLeverageInversions) | Dissent voice targets: `prerequisite` or `supports` edges |
| `patterns.ts` (detectConvergencePoints) | Convergence detection: only `prerequisite` or `supports` |
| `graph.ts` (computeLongestChain) | Longest chain outDegree: only `supports` or `prerequisite` |
| `graph.ts` (analyzeGraph) | Cluster cohesion: only `supports` or `prerequisite` |
| `classification.ts` (detectPrimaryShape) | Peak supports: `supports` + `prerequisite` |
| `builders.ts` (buildKeystonePatternData) | Keystone dependencies: `prerequisite` or `supports` |

Defaulting unknown edges to `supports` inflates alignment, cohesion, convergence, and reinforcement metrics. Two conflicting claims with an unknown edge type would be counted as reinforcing each other.

### Proposed Fix

Add a `'related'` edge type to `Edge['type']` in `shared/contract.ts`. A `'related'` edge would:

- Count toward raw `edgeCount` and `degree` (connection exists)
- **Not** count as reinforcing (no alignment/cohesion inflation)
- **Not** count as adversarial (no tension inflation)
- Effectively neutral — "these claims are connected but we don't know how"

Changes required:
1. Add `'related'` to `Edge['type']` union in `shared/contract.ts`
2. Change default in `parsing-utils.ts` from `'supports'` to `'related'`
3. Audit any exhaustive switch/if-else on edge types to ensure `'related'` is handled (most code filters for specific types, so unmatched `'related'` edges would naturally be excluded)

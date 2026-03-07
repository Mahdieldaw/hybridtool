# Structural Analysis — Refactor Decision Map

Each file is summarised by what it actually does today, followed by items that are either **unambiguous cuts** (both rounds of analysis agreed) or **resolved decisions** (former removal candidates where a geometry-layer replacement was identified and confirmed as the right architectural path).

**Architectural principle that resolves most decisions:** the geometry layer was built to own positional truth so other layers don't have to approximate it. Every place structural analysis was approximating positional measurements locally — using invented weights or arbitrary thresholds — is a place to read from geometry instead. Cross-layer reads are the intended information flow, not a coupling risk.

**One prerequisite before implementing:** establish a formal interface between the geometry layer and structural analysis rather than having structural analysis reach directly into geometry internals. The dependency direction is correct; the mechanism should be explicit.

---

## engine.ts

**What it does:** Single entry point — `computeStructuralAnalysis` — that sequences the whole pipeline. Pulls raw claims and edges, calls every detection and scoring step, assembles the final `StructuralAnalysis` object. It is wiring, not logic, except for one place it isn't.

---

**✂️ Cut — unanimous**

No direct cuts in engine.ts. Items that contaminated it are addressed in metrics.ts and patterns.ts below. Engine becomes clean when its inputs do.

---

**✅ Resolved — Surface silent reclassification as a diagnostic observation**

Two silent fallbacks currently exist: when `forked` classification produces no extractable conflicts it returns `buildConvergentData`; when `parallel` has fewer than two components it also returns `buildConvergentData`. Both cases leave `shape.primary` saying one thing and `shape.data` saying another with no indication of the mismatch.

**Resolution:** Emit a `classification_mismatch` diagnostic using the same pattern the geometry layer already uses for `topology_mapper_divergence`. The fallback construction can stay; the mismatch must be explicit. A system built on making structure legible cannot hide its own internal contradictions.

---

## classification.ts

**What it does:** Reads the peak landscape — which claims have high multi-model support — and classifies the overall structure as convergent, forked, constrained, parallel, or sparse. Also detects secondary patterns (dissent, keystone, chain, etc.) and computes peak-pair relationships.

---

**Keep — both rounds agreed**

The primary shape classifications are clean. They read conflict, tradeoff, support, and prerequisite edges between high-support claims and classify accordingly. This logic predates the geometry layer and still works correctly against the four edge types the semantic mapper now outputs. No changes needed to the classification logic itself.

---

**✅ Resolved — Replace `floorStrength` thresholds with geometry-derived percentiles**

The 0.6 / 0.4 thresholds were calibrated against mapper-role distributions (roles, branches, anchors) that no longer exist. They are floating cutoffs with no data anchor, and they contradict the system's core architectural commitment to distributional thresholds over hardcoded constants.

**Resolution:** Derive from `pairwiseField.stats` percentiles. The cross-layer read is worth it — having hardcoded thresholds inside the classification layer is a direct contradiction of the same distributional philosophy that drives `μ+σ` gating, competitive assignment, and `discriminationRange` throughout the rest of the pipeline.

---

## patterns.ts

**What it does:** Houses every individual pattern detector — leverage inversions, cascade risks, conflict clusters, tradeoffs, orphaned claims, conditional branches, dissent voices, keystone candidates. These feed into classification.ts.

---

**✂️ Cut — unanimous**

`isOutlier` — computed, stored, never rendered, depends entirely on `supportSkew` which is also cut. Remove both together.

`detectOrphanedSecondary` — five lines of detection with no consumer in `StructureGlyph` or `DecisionMapGraph`. Wire it or remove it; both rounds flagged this. If no near-term rendering plan exists, cut now.

---

**✅ Resolved — Rewrite leverage inversion detection against geometry `isolationScore`**

`detectLeverageInversion` currently depends on the `leverage` composite score, which is being removed. The concept — a claim with low evidential support but high structural position — is valid. The operationalisation was approximating what the geometry layer now measures directly.

**Resolution:** A claim that is isolated in the mutual recognition graph (`isolationScore` from geometry `profiles.ts`) but involved in conflict edges is the honest signal for leverage inversion. Read `isolationScore` from the geometry layer via the formal interface. This is exactly the information flow the geometry layer was built for.

**Rendering impact:** `isLeverageInversion` remains a boolean flag at the render boundary. `StructureGlyph` and `DecisionMapGraph` see the same interface. What changes is the derivation upstream. Check both components for any place that reads the raw `leverage` composite as a number (tooltips, sort orders, debug panels) — those break because the composite is being removed entirely, not replaced with another composite.

---

**✅ Resolved — Replace dissent `insightScore` with geometry `isolationScore`**

`insightScore = leverage * (1 - supportRatio) * 2` — leverage is contaminated, the multiplier compounds it.

**Resolution:** Outsider models are better identified by their mutual recognition isolation (`isolationScore`) than by a contaminated composite. `unique_perspective` detection — models that don't support any consensus position — can remain computed from supporter sets alone; only `leverage_inversion` dissent needs updating to use isolation score. The binary dissent condition becomes: flag when a model is mutually recognition-isolated AND uniquely opposes consensus.

---

## builders.ts

**What it does:** Given a classified shape, builds the rich data payload — `SettledShapeData`, `ContestedShapeData`, `TradeoffShapeData`, etc. Generates human-readable strings like `whyItMatters` and `transferQuestion`. Per inline audit comments, most nested sub-structure is computed but not rendered.

---

**Keep — both rounds agreed**

The builder functions are honest constructors. The strings they generate are legitimate outputs. Much of the nested sub-structure is currently decorative but is retained as placeholders pending rendering work. The silent reclassification behaviour that flows through here is addressed in engine.ts above.

No changes needed here until rendering is connected.

---

## graph.ts

**What it does:** Pure graph algorithms — connected components, longest dependency chain, articulation points, hub dominance, cluster cohesion. No domain semantics.

---

**✂️ Cut — unanimous**

`clusterCohesion` as currently implemented duplicates `internalDensity` in the geometry layer's `profiles.ts`. Both compute actual edges divided by possible edges per component. Consolidate into a single shared utility. Remove the duplicate.

---

**✅ Resolved — Expose `hubDominance` as a continuous value; derive threshold distributionally**

`hubDominance = topOutDegree / secondOutDegree` — the ratio is a sound shape. The hardcoded 1.5 threshold is doing hidden work: silently determining whether keystones get detected at all, with no data anchor.

**Resolution:** Expose `hubDominance` as a raw continuous value. Remove the binary hub flag derived from the 1.5 threshold. When a consumer needs a threshold — for keystone detection in metrics.ts — derive it distributionally (`μ+σ` across hub ratios in the component), consistent with how `mutualRankDegree` is thresholded in the geometry layer. Continuous value now, data-derived threshold at the consumer.

---

## metrics.ts

**What it does:** Claim-level scoring. Computes `supportRatio`, `leverage`, `keystoneScore`, and percentile flags for each claim. Also computes landscape-level metrics and five core ratios (concentration, alignment, tension, fragmentation, depth).

This is where most of the contamination lives. Built when the semantic mapper outputted roles, branches, and anchors that fed these formulas directly. Those fields no longer exist; the weights became hollow but the scaffolding stayed.

---

**✂️ Cut — unanimous**

`supportSkew = maxFromSingleModel / supporters.length` — only feeds `isOutlier`, which nothing renders. Remove.

`evidenceGapScore = cascadeDependents / supporters.length` — divides two structurally unrelated counts. Not rendered. Remove. If evidence tightness is needed later, `sourceCoherence` from the geometry layer's `diagnostics.ts` is the honest measurement.

`leverage` composite — `supportRatio × 2 + prereqOut × 2 + conflictEdges × 1.5 + degree × 0.25`. The multipliers approximated signal the mapper used to provide via roles. That signal is gone. Remove the composite. The raw inputs (`supportRatio`, `prerequisiteOutDegree`, `conflictEdgeCount`) are retained as separate fields — they feed the patterns.ts rewrite above.

`isLeverageInversion` as currently written — depends on the composite. Remove. The concept is retained in patterns.ts via the geometry rewrite above.

---

**✅ Resolved — Replace `keystoneScore` with `hubDominance` plus honest conditions**

`keystoneScore = outDegree × supporters.length` equates structurally opposite situations — high outDegree with low support versus low outDegree with high support can score identically. This is a conceptual error, not a calibration problem. The product formula was approximating what graph topology now measures directly.

**Resolution:** Keystone candidate condition becomes `outDegree >= 2 AND isHighSupport AND hubDominance >= [μ+σ threshold from graph.ts]`. Three separate honest measurements replacing one misleading product. `isKeystone` remains a boolean flag at the render boundary — `StructureGlyph` and `DecisionMapGraph` see the same interface.

---

**Core ratios (concentration, alignment, tension, fragmentation, depth) — keep as documented placeholders**

These are five honest ratios. Neither round flagged them for removal. They are not currently rendered or consumed anywhere, so nothing breaks when adjacent metrics change. Note that `fragmentation` will overlap with the geometry layer's `isolationScore` if these are ever wired up — deduplicate at that point rather than now.

The synthesis layer is the natural future consumer of `tension`, `depth`, and `fragmentation` — they characterise what survived a traversal in exactly the terms synthesis needs. Wire them when the synthesis layer has a concrete consumer. Until then, add an explicit comment marking them as staged for synthesis integration so future readers don't assume they're dead code.

---

## utils.ts

**What it does:** Stateless math primitives — percentile thresholds, top-N counts, `computeSignalStrength`, `isHubLoadBearing`, `determineTensionDynamics`.

---

**✂️ Cut — unanimous**

`computeSignalStrength` with its `(0.4 / 0.3 / 0.3)` weights and `variance × 5` amplifier. Not rendered anywhere. The amplifier is a theory, not a measurement. Both rounds agreed.

---

**✅ Resolved — Replace with a read of `discriminationRange` from the geometry layer**

`discriminationRange` already gates the geometry pipeline at < 0.10. It's L1, it's computed, it measures the same concept — how much discriminating structure exists in the artifact — with no magic weights. Having a separate `computeSignalStrength` function with invented weights measuring the same concept less honestly is noise that contradicts the system's core measurement philosophy.

**Resolution:** Remove `computeSignalStrength`. Add a single read from `pairwiseField.stats.discriminationRange` via the geometry interface at any point a signal-quality measure is needed. The read is three lines. The invented weights are a liability.

---

`isHubLoadBearing` — keep as-is. Honest binary check.

`determineTensionDynamics` — keep as-is. Reads edge type counts directly.

---

## Summary of unambiguous cuts

| Item | File | Action |
|---|---|---|
| `supportSkew` | metrics.ts | Remove |
| `isOutlier` | metrics.ts / patterns.ts | Remove |
| `evidenceGapScore` | metrics.ts | Remove |
| `leverage` composite | metrics.ts | Remove; keep raw inputs as separate fields |
| `isLeverageInversion` (composite-dependent) | metrics.ts | Remove; replaced in patterns.ts |
| `computeSignalStrength` | utils.ts | Remove; replaced with `discriminationRange` read |
| `clusterCohesion` duplication | graph.ts | Consolidate with geometry layer's `internalDensity` |
| `detectOrphanedSecondary` | patterns.ts | Wire to renderer or remove |

## Summary of resolved decisions

| Item | Resolution |
|---|---|
| Silent reclassification fallbacks | Emit `classification_mismatch` diagnostic, same pattern as `topology_mapper_divergence` |
| `floorStrength` thresholds 0.6 / 0.4 | Derive from `pairwiseField.stats` percentiles |
| Leverage inversion replacement | Read `isolationScore` from geometry layer |
| Dissent `insightScore` replacement | Read `isolationScore`; `unique_perspective` stays on supporter sets |
| `keystoneScore` replacement | `outDegree >= 2 AND isHighSupport AND hubDominance >= [μ+σ]` |
| `hubDominance` threshold 1.5 | Expose as continuous value; threshold derived distributionally at consumer |
| Core ratios surfacing | Keep as placeholders; explicitly comment as staged for synthesis integration |
| `computeSignalStrength` replacement | Remove; read `discriminationRange` from geometry layer at point of need |

## Rendering impact

Rendered components (`StructureGlyph`, `DecisionMapGraph`) consume boolean flags, not raw scores. The flags `isKeystone` and `isLeverageInversion` survive as booleans with cleaner derivations — no structural change to the render layer.

**One check required:** audit both components for any direct reads of the raw `leverage` composite as a number (tooltips, sort orders, debug panels). Those break because the composite is removed entirely, not replaced with another composite.



# Agent Directive: Verification and Fixes

## Operating Rules for This Pass

For each finding below, read the current code at the specified location before making any change. If the code already handles the issue correctly (the finding is stale or was already fixed), skip it and note that it was verified as not needed. If the issue exists as described, apply the fix. If the issue exists but the suggested fix doesn't match the current code structure, adapt the fix to the actual code while preserving the intent.

Do not add comments explaining the fixes. Do not refactor surrounding code. Make the minimum change that resolves each issue.

After all fixes, run `npm test`, `npx tsc -p tsconfig.json --noEmit`, and `npm run build:dev`. All three must pass.

---

## Fix 1: Label embedding in-flight promise leak

**Status:** Applied

**File:** `src/clustering/embeddings.ts`, around the `initializeLabelEmbeddings` function.

**Issue:** If `generateTextEmbeddings` or any subsequent code throws during the async initialization, `_labelEmbeddingsInFlight` remains set to the rejected promise. Future calls to `initializeLabelEmbeddings` will `await` this rejected promise instead of retrying.

**Verification:** Read the `initializeLabelEmbeddings` function. Check whether the async IIFE (or promise chain) that calls `generateTextEmbeddings` has error handling that clears `_labelEmbeddingsInFlight` on failure. If it already has a `try/catch/finally` or `.catch` that sets `_labelEmbeddingsInFlight = null` before rethrowing, this fix is not needed.

**Fix if needed:** Wrap the async body in `try/catch/finally`. In the `finally` block (or in the `catch` before rethrowing), set `_labelEmbeddingsInFlight = null`. The success path (setting `_labelEmbeddings` to the computed result) remains unchanged. The error path clears the in-flight promise so the next call will retry initialization.

---

## Fix 2: partitionRegionMapping many-to-many assignment

**Status:** Applied

**File:** `src/core/execution/StepExecutor.js`, around lines 2061-2072.

**Issue:** The code builds `partitionRegionMapping` by iterating `routingResult.partitionCandidates` in a nested loop over `emittedPartitions`, pushing every candidate's `regionId` into every partition's mapping. This creates a many-to-many association that loses which region belongs to which partition.

**Verification:** Read the loop structure. Check whether `partitionCandidates` entries carry a field that identifies which partition they correspond to (e.g., a `focalId`, `partitionId`, or `statementIds` that can be matched to an emitted partition's focal or statement IDs). Also check whether `emittedPartitions` entries carry a `focalId` or region reference.

**Fix if needed:** The mapping should be one-to-one or one-to-few: each partition gets only the regions whose focal statements or jury members participated in that partition. The most reliable approach:

For each emitted partition, collect the statement IDs it references (focal + side A + side B). For each routing partition candidate, check whether any of its region's member statement IDs overlap with the partition's statement IDs. If they overlap, associate that region with that partition. If no statement-level matching is possible because the data structures don't carry enough provenance, fall back to: assign each partition candidate's region to the partition whose focal statement is closest in embedding space to the region's centroid. Build the mapping from these associations instead of the nested loop.

---

## Fix 3: Embedding failure observability timestamp

**Status:** Applied

**File:** `src/core/execution/StepExecutor.js`, around lines 597-607.

**Issue:** The catch block for embedding generation failure records `startedAtMs = nowMs()` at catch time instead of the actual start time of the embedding operation.

**Verification:** Check whether a start timestamp is captured before the embedding call begins. If there's already a variable like `embeddingStartMs` or equivalent that records the start time, check whether the catch block uses it. If the catch block already uses the correct start time, this fix is not needed.

**Fix if needed:** Before the embedding try block begins, capture `const embeddingStartMs = nowMs()`. In the catch block, use `embeddingStartMs` instead of `nowMs()` for `observability.stages.statementEmbeddingsFailure.startedAtMs`.

---

## Fix 4: Conditional clause extraction splitting on URLs and time strings

**Status:** Applied

**File:** `src/core/traversal/deriveConditionalGates.ts`, around lines 106-121 (or wherever `extractConditionalClause` is defined — it may also be in `src/geometry/interpretation/regionGates.ts` if the function was duplicated or moved).

**Issue:** `tail.split(/[.;:!?]+/)[0]` splits on punctuation inside URLs (e.g., `http://example.com`) and time strings (e.g., `10:30`).

**Verification:** Read the `extractConditionalClause` function (or equivalent clause extraction logic). Check the split pattern. If it already handles URLs and time strings (e.g., by using a lookbehind or pre-processing step), this fix is not needed.

**Fix if needed:** Replace the split with a pattern that only breaks on sentence-ending punctuation followed by whitespace or end-of-string, excluding cases where the punctuation is part of a URL (`://`) or a time pattern (digit-colon-digit). A safe replacement:

```javascript
const rest = tail.split(/(?<![:/])(?<!\d)[.;:!?]+(?=\s|$)/)[0]
```

If the regex engine doesn't support lookbehinds (check the build target), use a two-step approach: replace `://` with a placeholder before splitting, then restore after. Keep the rest of the clause construction unchanged.

---

## Fix 5: Stale blockedBy references after question cap

**Status:** Applied

**File:** `src/core/traversal/questionMerge.ts`, around lines 186-204.

**Issue:** When the merged question list is capped at `MAX_QUESTIONS`, questions that are removed might still be referenced in other questions' `blockedBy` arrays.

**Verification:** Read the capping and ID reassignment logic. Check whether `blockedBy` arrays are filtered to only include IDs that survived the cap, and whether the old-to-new ID mapping is applied to `blockedBy` references. If both steps are already present, this fix is not needed.

**Fix if needed:** After capping the list to `MAX_QUESTIONS`:

1. Collect the set of old IDs that survived: `const keptOldIds = new Set(finalQuestions.map(q => q.oldId || q.id))`.
2. For each surviving question, filter its `blockedBy` to only include IDs in `keptOldIds`: `q.blockedBy = q.blockedBy.filter(id => keptOldIds.has(id))`.
3. Perform the sequential ID reassignment (`q_0`, `q_1`, ...) and build a mapping from old IDs to new IDs.
4. For each question, replace `blockedBy` entries using the mapping: `q.blockedBy = q.blockedBy.map(id => idMapping.get(id) || id)`.

---

## Fix 6: Region gate clause selection — first element vs mode

**Status:** Applied

**File:** `src/geometry/interpretation/regionGates.ts`, around lines 156-158.

**Issue:** The code picks the first clause (`const best = conditionalClauses[0]`) instead of the most common clause.

**Verification:** Read the clause selection logic. If the code already computes a frequency count or mode, this fix is not needed.

**Fix if needed:** Replace the first-element selection with a mode computation:

```typescript
const clauseCounts = new Map<string, number>();
for (const clause of conditionalClauses) {
  clauseCounts.set(clause, (clauseCounts.get(clause) || 0) + 1);
}
let best = conditionalClauses[0];
let bestCount = 0;
for (const [clause, count] of clauseCounts) {
  if (count > bestCount) {
    bestCount = count;
    best = clause;
  }
}
```

---

## Fix 7: Empty disruption scores allowing all regions through

**Status:** Applied

**File:** `src/geometry/interpretation/routing.ts`, around lines 135-136.

**Issue:** When `disruptionScores.ranked` is empty, `computePercentile([], 0.25)` returns 0, which means every region's disruption score is above the threshold. This allows gate candidates with zero disruption.

**Verification:** Read how `disruptionP25` is computed and how it's used in the gate candidate check. If there's already a guard for empty data, this fix is not needed.

**Fix if needed:** Add a guard: if `disruptionScores.ranked` is empty (or has length 0), set `aboveDisruptionThreshold = false` for all regions. Only compute and compare `disruptionP25` when there's actual disruption data:

```typescript
const disruptionP25 = disruptionScores.ranked.length > 0
  ? computePercentile(disruptionScores.ranked, 0.25)
  : Infinity;  // nothing passes
```

---

## Fix 8: Shadow extractor placeholder values

**Status:** Applied

**File:** `src/shadow/ShadowExtractor.ts`, around lines 243-245.

**Issue:** The two-pass architecture (extract then enrich) means statements are created before classification. The placeholders (`stance: 'assertive'`, `confidence: 0`, `signals: { sequence: false, tension: false, conditional: false }`) look like real classification results, making it impossible for downstream consumers to distinguish "classified as assertive with zero confidence" from "not yet classified."

**Verification:** Read the statement creation code. Check whether the placeholders are already set to distinguishable values (e.g., `stance: 'unclassified'`). Check whether the `Stance` type or `ShadowStatement` interface allows `'unclassified'` as a value. If the types don't allow it, check whether a comment or documentation makes the placeholder nature clear.

**Fix if needed — preferred approach:** If the type system allows adding `'unclassified'` to the `Stance` union type without breaking downstream consumers, do so. Set placeholders to `stance: 'unclassified'`, `confidence: 0`, `signals: { sequence: false, tension: false, conditional: false }`. The `'unclassified'` stance value makes it obvious that enrichment hasn't run yet. Downstream consumers that switch on stance values will need a default/fallback case for `'unclassified'` — check that existing switch statements have default cases.

**Fix if needed — alternative approach:** If adding `'unclassified'` to the type would cascade too many changes, add a boolean field `enriched: false` to the statement at creation time, set to `true` by the enrichment pass. Keep the existing placeholder values but add the `enriched` flag so consumers can check.

Either approach is acceptable. The goal is that code reading a statement can tell whether its stance/signals are real classifications or placeholders.

---

## Fix 9: isOpposingStance case sensitivity

**Status:** Applied

**File:** `src/skeletonization/TriageEngine.ts`, around lines 12-20.

**Issue:** The `isOpposingStance` function converts inputs to strings but doesn't normalize case or whitespace. Values like `" Prescriptive "` or `"PRESCRIPTIVE"` won't match.

**Verification:** Read the function. Check whether inputs are already normalized. Also check how stance values actually arrive at this function — if they always come from the shadow extractor (which assigns lowercase string literals), the casing issue may never occur in practice. If the function is only ever called with values from the shadow extractor's controlled vocabulary, this fix is low priority but still worth applying for robustness.

**Fix if needed:**

```typescript
const sa = String(a || '').trim().toLowerCase();
const sb = String(b || '').trim().toLowerCase();
```

Then compare against lowercase literals in the existing equality checks.

---

## Fix 10: Carrier detection logic using wrong count

**Status:** Applied

**File:** `src/skeletonization/TriageEngine.ts`, around lines 201-257.

**Issue:** The triage logic uses `carriersSkeletonized.length` (the count of carriers that were actually processed/skeletonized in this pass) to decide removal and sole-carrier status. But `carriersSkeletonized` might be smaller than `carrierResult.carriers.length` if some carriers were skipped (e.g., due to stance compatibility checks from Task 6). This makes `isSoleCarrier` incorrectly true when carriers exist but were skipped.

**Verification:** Read the triage logic flow. Check whether `carriersSkeletonized` is always equal to `carrierResult.carriers` in length, or whether filtering/skipping can cause them to differ. If they're always equal (no filtering between carrier detection and skeletonization), this fix is not needed.

**Fix if needed:** Compute `const totalCarriers = carrierResult.carriers.length`. Use `totalCarriers > 0` for the `canRemove` condition. Use `totalCarriers === 0` for the `isSoleCarrier` determination. Keep `carriersSkeletonized` as the list of IDs that were actually marked SKELETONIZE in this pass — that list is still needed for the triage result, but it shouldn't drive the removal/sole-carrier logic.

---

## Fix 11: Silent error swallowing in debug panel

**Status:** Applied

**File:** `ui/components/DecisionMapObservabilityRow.tsx`, around lines 229-234.

**Issue:** The catch block around `computeStructuralAnalysis` silently swallows errors.

**Verification:** Read the catch block. If it already logs the error (even conditionally), this fix is not needed.

**Fix if needed:** In the catch block, after setting `structural = null`, add:

```typescript
if (process.env.NODE_ENV !== 'production') {
  console.error('[DecisionMap] structuralAnalysis failed:', err);
}
```

If the codebase uses a different pattern for dev-only logging (e.g., a debug utility or a `__DEV__` flag), use that pattern instead.

---

## Fix 12: React list key collision

**Status:** Applied

**File:** `ui/components/DecisionMapObservabilityRow.tsx`, around lines 98-100.

**Issue:** `cards.map` uses `key={c.label}` which can collide if labels repeat.

**Verification:** Check whether card labels are guaranteed unique. If they are (e.g., each card has a distinct label by construction), this fix is not needed.

**Fix if needed:** Change the key to include the index: `key={\`${c.label}-${i}\`}` where `i` is the map index parameter. If the card objects have a unique `id` field, prefer `key={c.id}`.

---

## Fixes from Architecture Assessment

These are the issues identified in the assessment of the agent's Tasks 1-4 implementation. Apply the same verification rule: check the current code first, only fix if needed.

## Fix 13: Conditional gate "no" answer bypassing triage cascade

**Status:** Applied

**File:** `src/skeletonization/index.ts`, wherever conditional gate answer processing was added.

**Issue:** The agent's summary says conditional gate answers of "no" result in REMOVE for affected statements. The architecture requires these statements to go through the existing triage cascade (carrier detection, paraphrase expansion, sole-carrier protection) rather than being directly marked REMOVE.

**Verification:** Read the conditional gate processing in `buildChewedSubstrate`. Check whether affected statements are directly assigned REMOVE, or whether they're fed into the triage engine as pruning candidates that go through carrier detection.

**Fix if needed:** Do not directly assign REMOVE to conditional gate affected statements. Instead, treat them the same way pruned claim statements are treated in the existing triage flow:

1. Collect the affected statement IDs from conditional gates answered "no."
2. For each affected statement, check whether it's already PROTECTED (linked to a surviving partition side). If so, skip — partition decisions take precedence.
3. For non-protected affected statements, run carrier detection. If carriers exist elsewhere in the substrate, mark the affected statement REMOVE and the carriers SKELETONIZE. If no carriers exist (sole carrier), mark the affected statement SKELETONIZE, not REMOVE.
4. Run cross-model paraphrase expansion for affected statements, same as the existing paraphrase loop.

This ensures conditional gate pruning respects the same invariant as all other pruning: nothing is fully erased if it's the sole expression of an idea.

---

## Fix 14: Auto-resolution timing

**Status:** Applied

**File:** `src/core/traversal/questionMerge.ts` (static pass) and the traversal engine (dynamic pass).

**Issue:** The auto-resolution logic (if ≥ 80% of a gate's affected statements are already pruned, auto-resolve the gate) may only run at merge time. It also needs to run dynamically in the traversal engine after each user resolution.

**Verification:** Check two locations:

1. In `questionMerge.ts`: is there an auto-resolution pass? If so, what does it check — are statements already pruned at this point in the pipeline, or is this before any user interaction? At merge time, no user resolutions have happened yet, so the only auto-resolution that makes sense here is for statements that were mechanically pruned before traversal (which is rare). This static pass is acceptable but low-value.

2. In the traversal engine (likely `traversalEngine.ts` or `useTraversal.ts`): after a resolution is recorded, is there a pass that checks whether remaining conditional gates have had their affected statements pruned by the resolution? If not, this is the missing piece.

**Fix if needed:** In the traversal engine's resolution handler (the function called when the user answers a question), after recording the resolution and updating statement/claim statuses:

1. Collect all statement IDs that were just pruned by this resolution.
2. For each remaining unresolved conditional gate, compute what fraction of its `affectedStatementIds` are now pruned (by this resolution or any prior).
3. If ≥ 80% are pruned, auto-resolve the gate as side 0 ("yes, applies" — which prunes nothing), mark it resolved with `reason: 'auto_resolved_by_prior_pruning'`, and remove it from the live set.
4. Log the auto-resolution in the traversal path steps.

---

## Fix 15: Priority ordering sensitivity to disruption scores

**Status:** Applied

**File:** `src/core/traversal/questionMerge.ts`, wherever priority scores are assigned.

**Issue:** The current priority assignment (`100 - N` for partitions, `50 - N` for conditionals where N is the rank within type) makes all partitions rank above all conditionals regardless of disruption scores. The decisions document states conditional gates should rank after partitions "unless their score exceeds the lowest primary."

**Verification:** Read how `priorityScore` is assigned to each question type. Check whether disruption scores feed into the priority calculation at all.

**Fix if needed:** Change the priority formula so disruption scores can promote high-disruption conditional gates above low-disruption partitions:

```
partition priorityScore = disruptionScore + TYPE_BOOST
conditional priorityScore = disruptionScore
```

Where `TYPE_BOOST` is a constant (e.g., 0.3 or 0.5) that gives partitions a baseline advantage but doesn't make disruption scores irrelevant. A conditional gate with disruption score 0.9 should rank above a partition with disruption score 0.2 (0.9 > 0.2 + 0.3 = 0.5). A conditional gate with disruption score 0.4 should rank below a partition with disruption score 0.4 (0.4 < 0.4 + 0.3 = 0.7).

Normalize disruption scores to [0, 1] range before applying the boost (divide each score by the maximum disruption score across all regions) so the TYPE_BOOST has consistent effect regardless of the absolute disruption scale.

---

## Fix 16: Clause deduplication comparing wrong vectors

**Status:** Applied

**File:** `src/geometry/interpretation/regionGates.ts`, wherever clause deduplication happens.

**Issue:** The agent's summary says clauses are deduplicated by cosine ≥ 0.85 on region centroids. Clause deduplication should compare clause texts to each other, not region centroids.

**Verification:** Read the deduplication logic. Check what vectors are being compared — clause text embeddings, or region centroid embeddings.

**Fix if needed:** If the dedup compares region centroids, it's wrong. Two different regions might produce identical conditional clauses. The dedup should compare the extracted clause strings for exact match (after lowercasing and trimming), or if embedding-based dedup is desired, embed the clause texts and compare those vectors. Since clause texts are short and embedding them adds computational cost, prefer exact string match with normalization:

```typescript
const seen = new Set<string>();
const dedupedClauses = conditionalClauses.filter(clause => {
  const normalized = clause.trim().toLowerCase();
  if (seen.has(normalized)) return false;
  seen.add(normalized);
  return true;
});
```

---

## Fix 17: Dead partitionRelevance code

**Status:** Applied

**File:** `src/geometry/interpretation/index.ts` (or wherever disruption scoring lives).

**Issue:** The agent confirmed `partitionRelevance` is "hardcoded to 1, not used in scoring." Dead code that multiplies by 1 should be removed.

**Verification:** Find `partitionRelevance` in the disruption scoring code. If it's defined, set to 1, and multiplied into the disruption score, it's dead code.

**Fix if needed:** Remove the `partitionRelevance` variable definition and any multiplication by it. The disruption formula should be `uniqueness × stanceWeight × (1 + modelDiversity × 0.1)` with no other terms.

---

## Execution Order

Apply fixes in numerical order. Fixes 1-12 are independent of each other. Fixes 13-17 may overlap with fixes 1-12 in the same files — apply the earlier fix first, then the later fix on top.

After all fixes, run the verification suite:
1. `npm test` — all tests pass
2. `npx tsc -p tsconfig.json --noEmit` — no type errors
3. `npm run build:dev` — builds successfully

Report which fixes were applied and which were verified as not needed.

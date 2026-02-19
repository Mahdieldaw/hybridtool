# Gap Plan (Current Codebase)

This plan lists the remaining gaps between the current running system and the intended disruption-first architecture, and lays out the concrete work to close them. It assumes the architecture docs have already been updated to match code truth.

---

## Current Gap Inventory (Truth-Based)

### P0 (Blocks Core UX)

1. **Unified traversal UI is still transitional**
   - The pipeline can emit `TraversalQuestion[]` (question merge) and attaches it to `mapperArtifact.traversalQuestions` (and also to `preSemantic.questionMerge.questions`), but the UI still renders through legacy `ForcingPoint[]` plus a separate partition widget.
   - Impact: unified ordering + `blockedBy` + consistent auto-resolution behavior is not guaranteed end-to-end.

2. **Reactive conditional auto-resolution after partition answers is not consistently end-to-end**
   - The correct logic is statement-level: “are ≥80% of a gate’s affected statements now pruned?”
   - Some bridging exists, but not uniformly across both the unified-question path and any remaining legacy path.

### P2 (Observability / Debuggability)

3. **Disruption scoring breakdown is not surfaced in the UI debug panel**
   - The data exists (preSemantic disruption top list + breakdown), but the UI doesn’t expose it as a dedicated view.

4. **Query relevance distribution summary is not surfaced**
   - Per-statement rows exist, but distribution stats (min/max/mean/p25/p50/p75) are not shown.

### P3 (Quality / Safety Net / Persistence)

5. **Regression harness coverage is thin**
   - There is a mapping truth harness, but it is not yet a multi-fixture baseline with stable metric snapshots.

6. **Partition answer persistence across refresh/session restore is incomplete**
   - In-flight state may be lost on refresh depending on the current state storage strategy.

7. **Partition-vs-mechanical convergence report is incomplete**
   - Convergence exists, but it does not fully answer “did mechanical oppositions become partitions?” and “are partitions aligned with regions?”

---

## Already Closed (No Work Needed)

These were gaps in older plans but are implemented in the current codebase:

- **Emergent fork retroactive disruption impact score** is assigned during mapping (post-parse).
- **Fallback trigger checks mechanical opposition signals** (disruption quartile / conflict signals / opposition pairs).
- **Shadow delta audit includes partition participation statement IDs** (claims + partition side/advocacy IDs are added to referenced set).

---

## Implementation Plan (Ordered)

### Step 1 — Unify traversal UI on `TraversalQuestion[]` (P0)

**Goal:** UI consumes `TraversalQuestion[]` as the single question source, with correct ordering and `blockedBy` behavior.

**Work:**
- Read `mapperArtifact.traversalQuestions` (canonical) and render a single ordered list.
- Implement a unified interaction model:
  - Partition questions write to `partitionAnswers`.
  - Conditional questions write to `conditionalGateAnswers` (or the equivalent traversal field).
- Enforce `blockedBy`:
  - Do not show blocked questions until their blockers are resolved (or show disabled with an explicit blocked state).
- Ensure the continuation endpoint receives the unified traversal state.

**Acceptance criteria:**
- Partitions and conditionals appear in one list with a consistent UX.
- Blocked questions cannot be answered early.
- Skip/unsure behavior is conservative (does not prune).

**Primary files:**
- `ui/components/traversal/TraversalGraphView.tsx`
- `ui/hooks/useTraversal.ts` (or a dedicated hook for questions)
- `shared/contract` traversal state types (if needed)

---

### Step 2 — Make conditional auto-resolution reliably reactive after partition answers (P0)

**Goal:** After a partition answer prunes statements, any conditional gate whose affected statements are now mostly pruned auto-resolves.

**Work:**
- After updating `partitionAnswers`, compute pruned statement IDs from partitions and current answers.
- Evaluate each pending conditional question:
  - If `prunedCount / affectedCount >= 0.8`, mark it resolved (and record why).
- Apply the same logic regardless of whether questions originated from the unified question path or legacy traversal artifacts.

**Acceptance criteria:**
- A conditional question that became redundant due to pruning disappears or shows as auto-resolved.
- Auto-resolution never fires based on claim IDs alone; it uses statement-level overlap.

**Primary files:**
- `ui/hooks/useTraversal.ts` (or the unified traversal hook)
- `src/utils/cognitive/traversalEngine.ts` (shared utilities, if centralized)

---

### Step 3 — Add Disruption debug view (P2)

**Goal:** Surface the disruption breakdown data already produced by the pipeline.

**Work:**
- Add a “Disruption” view/tab in observability UI.
- Render top disruption statements with breakdown columns.

**Acceptance criteria:**
- You can inspect uniqueness, nearestCarrierSimilarity, stanceWeight, modelDiversity, raw score, composite score for top items.

**Primary files:**
- `ui/components/DecisionMapObservabilityRow.tsx` (or relevant observability component)

---

### Step 4 — Add query relevance distribution summary (P2)

**Goal:** Provide quick distribution insight for query relevance per turn.

**Work:**
- Extend query relevance metadata to include distribution stats.
- Render those stats above the per-statement list.

**Acceptance criteria:**
- UI shows min/max/mean/p25/p50/p75 for relevance.

**Primary files:**
- `src/geometry/queryRelevance.ts`
- `ui/components/DecisionMapObservabilityRow.tsx`

---

### Step 5 — Expand regression harness into fixture-driven baselines (P3)

**Goal:** Detect regressions in pipeline outputs using stored fixtures and stable metrics.

**Work:**
- Add several stored fixture turns (inputs + expected invariant metrics).
- Add invariant assertions and metric snapshot comparisons.

**Acceptance criteria:**
- A CI/test run fails when key pipeline invariants drift on the same fixture input.

Primary files:
- `src/core/execution/StepExecutor.mapping.truth-harness.test.ts`

---

### Step 6 — Persist partition answers robustly (P3)

**Goal:** In-flight partition answers survive refresh/session restore.

**Work:**
- Persist partition answers using the same persistence mechanism as traversal state (or a parallel persisted atom/store).
- Ensure rehydration logic merges persisted in-flight answers with any completed traversal state safely.

**Acceptance criteria:**
- Refresh preserves in-progress answers and doesn’t corrupt the traversal state.

---

### Step 7 — Add partition-vs-mechanical convergence dimension (P3)

**Goal:** Convergence reporting answers whether mechanical signals matched emitted partitions.

**Work:**
- Compare validated partitions to preSemantic oppositions/conflict signals and region neighborhoods.
- Surface summary counts/ratios in observability.

**Acceptance criteria:**
- Report includes “mechanical oppositions confirmed by partitions” and “partitions with mechanical support.”

---

## Verification Checklist (Runbook)

- Answer a partition question; confirm losing-side advocacy statements are pruned in chewed substrate output.
- Confirm conditional questions that became redundant auto-resolve after partition pruning.
- Confirm skipping/unsure produces conservative behavior (no unexpected removal).
- Confirm debug views render without breaking existing observability tabs.

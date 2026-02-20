# Deferred Concepts — Worth Revisiting

Concepts identified during audit that have genuine value but no clean home yet.
Build when the consumer layer is being designed, not before.

---

## 1. Stance-Weighted Pruning Prediction (`analyzeClaimStances`)

**Source:** Was in `src/core/traversal/conditionalFinder.ts` (deleted)

**What it does:** Given a claim's `sourceStatementIds` and the full statement inventory, counts stances across those statements and predicts whether pruning this claim would lose meaningful evidence.

**Logic:**
- Stances that are situational/conditional (prescriptive, prerequisite, dependent, uncertain) → `prunable`
- Stances that are context-independent (cautionary, assertive) → `keepable`
- Verdict: `would_prune` | `would_keep` | `no_evidence`
- Reason string explaining the stance breakdown

**Where it belongs:** Synthesis / triage layer — specifically alongside `TriageEngine.ts` when deciding how aggressively to skeletonize a pruned claim's evidence. A claim with `would_keep` evidence surviving in it needs more care than one that's pure prescriptive advice.

**Dependencies:** `claim.sourceStatementIds`, `ShadowStatement.stance` — both already in memory at triage time.

---

## 2. Auto-Resolution of Conditional Gates (`checkAutoResolution`)

**Source:** Was in `src/core/traversal/questionMerge.ts` (deleted)

**What it does:** Given a set of traversal questions and the current set of already-pruned statement IDs, auto-resolves conditional gates where ≥80% of their affected statements are already pruned by earlier decisions.

**Logic:**
- For each conditional question: count how many of its `affectedStatementIds` are in `prunedStatementIds`
- If ratio ≥ 0.80: mark as `auto_resolved`, set `answer = 'yes'`, record reason
- Return count of auto-resolved gates

**Where it belongs:** Traversal engine — between conflict resolutions, or at the start of each traversal step, to collapse conditional gates that have become redundant due to upstream pruning decisions.

**Dependencies:** `question.affectedStatementIds`, `traversalState` pruned set — both available in the traversal engine at resolution time.

---

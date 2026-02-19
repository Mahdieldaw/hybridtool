# Pipeline Refactor: Full Implementation Plan (Disruption‑First Mapper Architecture)

This document is the execution plan for the design in [pipeline_refactor_plan.md](file:///C:/Users/Mahdi/Desktop/hybrid/pipeline_refactor_plan.md). It describes (1) the current pipeline as it actually exists in code, (2) the end resolution state we are refactoring toward, and (3) the concrete steps to get from A → B without breaking working behavior.

---

## 1) Scope and “Done” Definition

### 1.1 Goals

- Route “truth” through the mechanical layers first (shadow → embeddings → geometry → relevance), and constrain the mapper to a ranked, representative worklist instead of raw full-text outputs.
- Produce fewer, higher-impact traversal questions whose answers deterministically prune only advocacy (not context/counterevidence).
- Preserve a conservative safety net: when the new path yields zero usable partitions or is low-confidence, fall back to the current traversal/gate path.
- Keep the synthesizer grounded: synthesis reads only the chewed evidence substrate produced by pruning, not an abstract claim list.

### 1.2 Non‑Goals (for the first refactor-complete milestone)

- Rewriting or removing the existing traversal graph system and gate derivation code immediately. Those remain as fallback until the new path demonstrates reliability.
- Perfecting disruption scoring weights up front. The first version must be observable and calibratable.
- Achieving statement-level geometry as a hard requirement. We can start by deriving statement signals from the existing paragraph substrate, then iterate.

### 1.3 End‑State Acceptance Criteria (hard)

- Mapping step produces a stable “worklist + partitions” artifact every run when embeddings are available.
- Traversal UI can render and resolve these partitions (max 4–5 questions) and continue the pipeline.
- Partition-based pruning removes only statements in the losing side’s advocacy set; non-participating statements continue through the existing skeletonization regime unchanged.
- When the mapper yields zero partitions but mechanical opposition signals indicate forks exist, the pipeline automatically falls back to the current gate derivation path.
- All new behaviors are behind an explicit feature flag and are fully reversible per-turn (no destructive migration).

---

## 2) Current State (Code‑Truth)

### 2.1 Orchestration and Artifact Flow

- Pipeline orchestration runs mapping, then pauses for traversal if forcing points exist, then runs Singularity (Concierge): [CognitivePipelineHandler.js](file:///C:/Users/Mahdi/Desktop/hybrid/src/core/execution/CognitivePipelineHandler.js#L40-L170) and [workflow-engine.js](file:///C:/Users/Mahdi/Desktop/hybrid/src/core/workflow-engine.js#L374-L409).
- The pipeline pause is triggered when `mappingArtifact.traversal.graph` exists and there are forcing points: [CognitivePipelineHandler.js](file:///C:/Users/Mahdi/Desktop/hybrid/src/core/execution/CognitivePipelineHandler.js#L54-L168).
- Traversal continuation builds a chewed evidence substrate from `traversalState` + current claims and original statements/paragraphs, then runs Singularity: [CognitivePipelineHandler.js](file:///C:/Users/Mahdi/Desktop/hybrid/src/core/execution/CognitivePipelineHandler.js#L660-L835).

### 2.2 Mapping Step (What Actually Happens Today)

Mapping is executed in [StepExecutor.js](file:///C:/Users/Mahdi/Desktop/hybrid/src/core/execution/StepExecutor.js#L402-L1350). The current core flow is:

1. Shadow extraction produces atomic statements with stable IDs and stance classification:
   - Shadow extraction: [StepExecutor.js](file:///C:/Users/Mahdi/Desktop/hybrid/src/core/execution/StepExecutor.js#L474-L509)
   - Paragraph projection from shadow statements: [StepExecutor.js](file:///C:/Users/Mahdi/Desktop/hybrid/src/core/execution/StepExecutor.js#L627-L642)
2. Embedding + geometry is computed (best-effort; failure is tolerated):
   - Statement embeddings: [StepExecutor.js](file:///C:/Users/Mahdi/Desktop/hybrid/src/core/execution/StepExecutor.js#L529-L563)
   - Query embedding: [StepExecutor.js](file:///C:/Users/Mahdi/Desktop/hybrid/src/core/execution/StepExecutor.js#L653-L675)
   - Paragraph pooling and substrate: [StepExecutor.js](file:///C:/Users/Mahdi/Desktop/hybrid/src/core/execution/StepExecutor.js#L676-L723)
   - Pre-semantic interpretation: [StepExecutor.js](file:///C:/Users/Mahdi/Desktop/hybrid/src/core/execution/StepExecutor.js#L832-L852)
   - Query relevance scoring exists and is persisted as an artifact, but it is not used to actually filter the evidence that reaches the mapper: [StepExecutor.js](file:///C:/Users/Mahdi/Desktop/hybrid/src/core/execution/StepExecutor.js#L853-L883)
3. The mapper prompt is built primarily from the raw model texts (not a condensed, query-shaped evidence set): [semanticMapper.ts](file:///C:/Users/Mahdi/Desktop/hybrid/src/ConciergeService/semanticMapper.ts#L38-L170) and wired here: [StepExecutor.js](file:///C:/Users/Mahdi/Desktop/hybrid/src/core/execution/StepExecutor.js#L1036-L1056).
4. Mapper output is parsed into claims/edges/conditionals. Provenance reconstruction links claims back to shadow statements. Gate derivation may override mapper conditionals:
   - Provenance reconstruction: [StepExecutor.js](file:///C:/Users/Mahdi/Desktop/hybrid/src/core/execution/StepExecutor.js#L1142-L1159)
   - Gate derivation: [StepExecutor.js](file:///C:/Users/Mahdi/Desktop/hybrid/src/core/execution/StepExecutor.js#L1161-L1210)
5. Traversal analysis is optionally computed using the current traversal engine: [buildMechanicalTraversal.ts](file:///C:/Users/Mahdi/Desktop/hybrid/src/core/traversal/buildMechanicalTraversal.ts#L516-L548).
6. The mapping artifact is normalized into the “cognitive artifact” shape consumed by the UI and downstream pipeline: [cognitive-artifact.ts](file:///C:/Users/Mahdi/Desktop/hybrid/shared/cognitive-artifact.ts#L1-L92).

### 2.3 Pruning and Chewed Evidence

- Pruning for traversal continuation currently flows through claim statuses (active/pruned) and then statement triage and reconstruction:
  - Chewed substrate builder: [src/skeletonization/index.ts](file:///C:/Users/Mahdi/Desktop/hybrid/src/skeletonization/index.ts#L12-L52)
  - Triage engine (claim-centric, statement actions PROTECTED/UNTRIAGED/SKELETONIZE/REMOVE): [TriageEngine.ts](file:///C:/Users/Mahdi/Desktop/hybrid/src/skeletonization/TriageEngine.ts#L78-L230)
  - Substrate reconstruction (carves original text by statement actions): [SubstrateReconstructor.ts](file:///C:/Users/Mahdi/Desktop/hybrid/src/skeletonization/SubstrateReconstructor.ts#L16-L175)

### 2.4 Known Gaps vs Refactor Target

This is consistent with the gap analysis in [theroot.md](file:///C:/Users/Mahdi/Desktop/hybrid/theroot.md#L6-L67):

- The mechanical layers compute useful signals (relevance, regions, oppositions), but those signals do not currently dictate what the mapper reads.
- Gate questions are derived via heuristics and conditional density rather than being ranked by “output delta” / disruption.
- Pruning is claim-status driven; we do not yet have a first-class “advocacy set” contract separating advocacy from context/counterevidence for each fork side.

---

## 3) End Resolution State (Target)

### 3.1 New Primary Contract: “Worklist → Partitions → Deterministic Pruning”

When embeddings/geometry are available, the mapping step produces:

- A condensed evidence set (query-shaped, conservative noise gate).
- A disruption-ranked worklist of focal statements (top N).
- For each focal statement, a representative jury sampled across the entire evidence landscape.
- Mapper output that is *not* a free-form claim graph mandate. It is a set of partitions with hinge questions and default sides, plus optional secondary claim graph output for UI.
- Advocacy sets expanded mechanically from exemplars (jury members) into full neighborhood sets for each partition side.
- Traversal questions ordered directly by disruption score (max 4–5), with fallbacks to the current traversal/gate system when needed.

### 3.2 High-Level Phase Ordering (Refactor-Complete)

This is the “done” pipeline ordering, aligned to [pipeline_refactor_plan.md](file:///C:/Users/Mahdi/Desktop/hybrid/pipeline_refactor_plan.md):

1. Shadow extraction (unchanged)
2. Statement embeddings (existing)
3. Query relevance filter (new behavior: actually filters)
4. Paragraph projection + geometry + interpretation (existing, operating on condensed set)
5. Disruption scoring (new)
6. Jury construction (new)
7. Mapper worklist annotation (refactored prompt + parser)
8. Advocacy validation (optional; interface present in v1)
9. Traversal question ordering (new primary path)
10. Pruning:
    - Partition-based pruning for fork-participating statement populations
    - Existing skeletonization for everything else
11. Synthesis from chewed substrate (existing integration point)

### 3.3 End‑State Data Model (Minimal Additions)

We keep the existing `CognitiveArtifact` stable for the UI while adding additive fields for the new path:

- `semantic.partitions[]` (new): confirmed partitions with hinge questions and side assignments (statement IDs).
- `traversal.partitionsGraph` or `traversal.partitions[]` (new): traversal-ready partition questions, each with:
  - question text
  - default side
  - impact score (disruption)
  - affected statement IDs per side (expanded advocacy sets)
- `geometry.query.condensedStatementIds[]` (new): the “condensed set” membership and threshold metadata for audit.

The old fields remain:

- `semantic.claims[]/edges[]` (optional in end state; preserved during migration)
- `traversal.graph/forcingPoints` (fallback path; preserved)

---

## 4) Migration Strategy (How We Avoid Breaking Working Truth)

### 4.1 Additive, Flagged, and Reversible

- Introduce a single feature flag (e.g., `DISRUPTION_FIRST_MAPPER`) scoped per turn.
- When enabled, compute the new artifacts in parallel with the old ones first (shadow mode).
- Only switch traversal/pruning to consume partitions after:
  - partitions exist in sufficient quality for real runs
  - observability shows low false partition rate
- Keep fallback behavior automatic and explicit.

### 4.2 Compatibility Rules

- Never remove or rename existing fields consumed by the UI during the migration window.
- The mapping step may produce both:
  - `semantic.claims/edges` (legacy) and
  - `semantic.partitions` (new)
  until the UI and pruning paths are fully switched.

### 4.3 Primary Touchpoints (Where Code Changes Concentrate)

- Mapping pipeline and artifacts:
  - [StepExecutor.js](file:///C:/Users/Mahdi/Desktop/hybrid/src/core/execution/StepExecutor.js)
  - [semanticMapper.ts](file:///C:/Users/Mahdi/Desktop/hybrid/src/ConciergeService/semanticMapper.ts)
  - [contract.ts](file:///C:/Users/Mahdi/Desktop/hybrid/shared/contract.ts)
  - [cognitive-artifact.ts](file:///C:/Users/Mahdi/Desktop/hybrid/shared/cognitive-artifact.ts)
- Traversal pause/continue and persistence:
  - [CognitivePipelineHandler.js](file:///C:/Users/Mahdi/Desktop/hybrid/src/core/execution/CognitivePipelineHandler.js)
  - [workflow-compiler.js](file:///C:/Users/Mahdi/Desktop/hybrid/src/core/workflow-compiler.js)
- Traversal UI:
  - [TraversalGraphView.tsx](file:///C:/Users/Mahdi/Desktop/hybrid/ui/components/traversal/TraversalGraphView.tsx)
  - [TraversalForcingPointCard.tsx](file:///C:/Users/Mahdi/Desktop/hybrid/ui/components/traversal/TraversalForcingPointCard.tsx)
  - [DecisionMapObservabilityRow.tsx](file:///C:/Users/Mahdi/Desktop/hybrid/ui/components/DecisionMapObservabilityRow.tsx)
- Chewed substrate and skeletonization:
  - [src/skeletonization/index.ts](file:///C:/Users/Mahdi/Desktop/hybrid/src/skeletonization/index.ts)
  - [TriageEngine.ts](file:///C:/Users/Mahdi/Desktop/hybrid/src/skeletonization/TriageEngine.ts)
  - [SubstrateReconstructor.ts](file:///C:/Users/Mahdi/Desktop/hybrid/src/skeletonization/SubstrateReconstructor.ts)

---

## 5) Implementation Plan (Milestones)

### Milestone 0 — Baseline Harness and Invariants

**Deliverables**
- A small “truth harness” that can run mapping step on stored sample turns and emit:
  - statement counts
  - region counts and oppositions
  - query relevance distributions
  - traversal question counts
- A set of invariant checks (runtime asserts / validation functions) for:
  - stable statement IDs
  - modelIndex alignment across shadow/paragraph/sourceData
  - no pruning when traversal state is empty

**Acceptance**
- We can compare “before vs after” on the same stored inputs and see exactly what changed.

---

### Milestone 1 — Condensed Evidence Set (Real Filter, Conservative)

**Deliverables**
- A deterministic builder that produces `condensedStatementIds[]` using existing query embedding + statement embeddings.
- Persist filter metadata (threshold used, counts kept/dropped, examples) into the mapping artifact observability.
- Conservative preservation mechanism: statements are filtered from the condensed set, not deleted from the run.

**Implementation notes**
- Today we already compute query relevance but do not filter what reaches geometry/mapper: [StepExecutor.js](file:///C:/Users/Mahdi/Desktop/hybrid/src/core/execution/StepExecutor.js#L853-L883).
- The first step is to make condensed membership explicit, then progressively route downstream steps to consume it.

**Conservative statement preservation (mechanism)**
- The condensed set is represented as an ID subset (e.g., `condensedStatementIds[]`) plus metadata (threshold, score distribution summary).
- The full statement inventory remains unchanged in the artifact (`shadow.statements` stays complete); statements not in the condensed set are marked as “excluded from condensed evidence flow” (flagged) rather than removed.
- Downstream routing rules:
  - Geometry + interpretation + disruption scoring + jury selection consume only the condensed population.
  - Skeletonization safety net continues to have access to the full statement inventory via `shadow.statements` and can preserve/use these statements if they remain linked to surviving content.

**Integration points**
- Compute and persist condensed membership inside the mapping step (same phase that currently computes query relevance): [StepExecutor.js](file:///C:/Users/Mahdi/Desktop/hybrid/src/core/execution/StepExecutor.js#L653-L883).
- Attach the result to the cognitive artifact via the normalizer: [cognitive-artifact.ts](file:///C:/Users/Mahdi/Desktop/hybrid/shared/cognitive-artifact.ts#L1-L92).

**Acceptance**
- On real runs, condensed set removes obvious fluff while preserving all plausible signal (no catastrophic drops).

**Backout**
- Disable flag → system returns to current behavior.

---

### Milestone 2 — Route Geometry Through Condensed Evidence

**Deliverables**
- Paragraph projection and paragraph embedding pooling use only condensed statements.
- Substrate nodes/regions reflect condensed evidence (paragraphs with zero condensed statements excluded).

**Integration points**
- Paragraph projection currently consumes all statements: [StepExecutor.js](file:///C:/Users/Mahdi/Desktop/hybrid/src/core/execution/StepExecutor.js#L627-L642). This becomes “project paragraphs from condensed statements”.
- Paragraph pooling currently pools from all statements: [StepExecutor.js](file:///C:/Users/Mahdi/Desktop/hybrid/src/core/execution/StepExecutor.js#L676-L689). This becomes “pool embeddings from condensed statements only”.

**Acceptance**
- Geometry still builds reliably; node counts decrease; region structure becomes tighter; no crashes in UI graph rendering.

---

### Milestone 3 — Disruption Scoring (Mechanical Ranking)

**Deliverables**
- `computeDisruptionScores()` that ranks candidate focal statements by a calibrated composite score (cluster size, model diversity, stance weight, isolation, opposition presence).
- A capped worklist builder: pick top N focal statements with non-zero partition relevance.

**Acceptance**
- Top N focal statements are plausibly “where the solution actually forks” in a human spot-check across sample queries.

---

### Milestone 4 — Jury Construction (Representative Cross‑Section)

**Deliverables**
- `constructJury(focal, regions, substrate, condensedStatements)` producing an ordered jury with selection rationale:
  - region centroid reps
  - high-signal reps for large regions
  - outlier
  - dissenter
- Worklist artifact: `(focalStatement, disruptionScore, jury[])[]`.

**Acceptance**
- Every major region is represented per focal entry; jury size stays bounded and consistent.

---

### Milestone 5 — Mapper Prompt Refactor + Output Schema (Partitions)

**Deliverables**
- A new mapper prompt builder that accepts the worklist + jury format (instead of raw full texts).
- A parser and schema for:
  - confirmed partitions per focal
  - hinge question per partition
  - default side
  - emergent forks (separate section)
- A mapper output deduplication strategy (partitions found across multiple focal statements collapse to one canonical partition).
- Update shared contract types additively (no breaking changes).

**Integration points**
- The mapper prompt is currently built from raw text: [StepExecutor.js](file:///C:/Users/Mahdi/Desktop/hybrid/src/core/execution/StepExecutor.js#L1036-L1056). Replace (under flag) with a worklist-based prompt builder.
- Persist the worklist + partitions into the mapping artifact, then into the cognitive artifact: [cognitive-artifact.ts](file:///C:/Users/Mahdi/Desktop/hybrid/shared/cognitive-artifact.ts#L1-L92).

**Mapper failure modes (taxonomy)**
- False negatives (missed partitions): safe failure; both sides survive into synthesis and the user sees mixed guidance.
- False positives (fake partitions): dangerous failure; leads to incorrect pruning. Mitigated by validation and conservative defaults (exclude low-confidence partitions from traversal).
- Bad hinge questions: localized failure; question quality can be iterated without rewriting the whole pipeline because each hinge is anchored to specific statement IDs.

**Deduplication (deliverable details)**
- Define a partition “signature” and merge rule:
  - signature inputs: involved statement IDs (both sides), focal statement ID, hinge question text, and side exemplar IDs.
  - dedup heuristics: overlap on involved statement IDs (Jaccard), plus hinge-question similarity (string similarity, optionally embedding similarity if available).
  - merge behavior: choose a canonical partition record; merge involved statement IDs by union; keep the highest disruption score and record provenance of which focal(s) surfaced it.

**Acceptance**
- Mapper output is parseable >95% on a representative test set.
- Mapper produces zero or more partitions without hallucinating claim IDs that do not exist.
- False positive control: validation excludes or downranks partitions that are geometrically implausible or internally inconsistent.
- Hinge question quality gate: questions are factual, answerable, and map to deterministic side selection without requiring domain expertise.

---

### Milestone 5.5 — Emergent Fork Capture

**Deliverables**
- Prompt structure includes an explicit “emergent forks” section after focal worklist annotation, where the mapper can report cross-cutting tensions observed between jury members (not necessarily involving the focal statement).
- Emergent fork schema includes:
  - statement IDs in tension (2+)
  - incompatibility description
  - hinge question
  - default side (or “unknown” if no safe default)

**Capture mechanism (prompt contract)**
- The mapper prompt ends with a dedicated section like:
  - “Were there any other incompatibilities you noticed between jury members across any entries above, independent of the focal statements? If none, return an empty list.”
- Requirements for each reported emergent fork:
  - Must reference concrete statement IDs from the provided worklist/juries.
  - Must describe the incompatibility in terms of a user situation fact (what makes A apply vs B apply).
  - Must provide a hinge question that is binary or forced-choice and answerable without domain expertise.
- Output shape (recommended):
  - `emergent_forks: [{ fork_id, sideA_statement_ids, sideB_statement_ids, incompatibility, hinge_question, default_side }]`

**Parsing and normalization**
- Emergent forks are parsed into the same internal partition type as focal-derived partitions, with:
  - `source: 'emergent'`
  - `focalStatementId: null`
  - `triggeringFocalIds: []` optionally populated if we can attribute the observation to specific worklist entries.
- Deduplicate emergent forks against focal-derived partitions using the same signature+merge rules as Milestone 5, so we never ask the same underlying fork twice.

**Validation approach**
- Apply the same validation gates as focal-derived partitions before allowing traversal questions:
  - topical plausibility (sides live in related but meaningfully distinct neighborhoods)
  - stance plausibility (each side internally consistent; sides not trivially identical)
  - directional differential (sideA closer to sideA exemplars than sideB exemplars and vice versa)
- If validation is low confidence:
  - keep the fork as a diagnostic artifact (for calibration) but do not emit it as a traversal question.

**Retroactive disruption estimation**
- Because emergent forks are not anchored to a single disruption-ranked focal statement, compute an emergent fork impact score by:
  - selecting a representative “anchor statement” per side (e.g., the highest disruption statement among the involved IDs on that side if available; otherwise the most central/high-signal)
  - estimating disruption using the same signals as focal ranking (cluster size, model diversity, isolation, opposition presence, stance weight)
  - defining fork impact as `max(disruption(anchorA), disruption(anchorB))` (v1 default) and persisting the full breakdown for calibration

**Ranking strategy relative to focal-derived partitions**
- v1 ordering policy:
  - Always present focal-derived partitions first (sorted by focal disruption).
  - Present validated emergent forks afterward, sorted by emergent impact score.
- Persist both:
  - `emergentImpactScore`
  - `orderingPolicy: 'append' | 'interleave'` (set to `append` in v1)
  so we can later revisit whether emergent forks can outrank focal-derived partitions based on observed value.

**Acceptance**
- Emergent forks parse cleanly and do not destabilize traversal ordering.
- Unsafe emergent forks are filtered out by validation rather than emitted as questions.
- A cross-cutting tension between jury members can be surfaced even when no focal statement directly participates in that fork.

---

### Milestone 6 — Advocacy Expansion + Optional Validation

**Deliverables**
- Advocacy expansion: map from exemplar statements (jury members on side A/B) to expanded advocacy sets using geometric neighborhood + stance alignment.
- Optional validation interface: produce a confidence score per partition and filter low-confidence questions out of traversal.

**Acceptance**
- Expanded advocacy sets look semantically consistent when spot-checked; low-confidence partitions are visibly marked and not forced on users.

---

### Milestone 7 — Traversal UI + Continuation (Partitions Path)

**Deliverables**
- Render partition questions (hinge questions) in the traversal UI, preserving the existing “pause pipeline” model.
- Persist traversal state for partitions (side selections, skips) in the turn record similarly to existing traversal state.

**State shape (recommended)**
- Store a new `partitionAnswers` map keyed by `partitionId` with values `{ choice: 'A' | 'B' | 'unsure', userInput?: string }`.
- Keep existing `TraversalState` claimStatuses in parallel during migration so skeletonization remains stable.

**Acceptance**
- Users can answer 1–5 partition questions and continue to Singularity without regressions.

---

### Milestone 8 — Dual-Regime Pruning Integration

**Deliverables**
- Partition-based pruning for fork-participating statements (advocacy-only removal).
- Existing skeletonization remains the default for everything else:
  - If a statement is not in any partition side, it flows through current triage/skeletonization rules unchanged.
- Chewed substrate construction uses the combined fates to carve source texts.

**Integration points**
- Traversal continuation already builds chewed substrate from traversal state: [CognitivePipelineHandler.js](file:///C:/Users/Mahdi/Desktop/hybrid/src/core/execution/CognitivePipelineHandler.js#L660-L735).
- Skeletonization is currently claim-centric: [src/skeletonization/index.ts](file:///C:/Users/Mahdi/Desktop/hybrid/src/skeletonization/index.ts#L12-L52). For partitions:
  - compute statement fates directly for partition populations, then
  - apply existing triage/skeletonization only to the non-participating population.

**Acceptance**
- Partition answers visibly change the evidence substrate and final synthesis.
- Non-partition content is preserved conservatively (no surprise deletions).

---

### Milestone 8.5 — Observability Integration

**Deliverables**
- Shadow delta audit (completeness monitoring):
  - wire `computeShadowDelta()` as a retained side-path artifact so we can report “high-relevance, unpartitioned” statements the new path missed
  - surface “top unreferenced” candidates for debugging and calibration (not for pruning)
- Convergence validation (diagnostics):
  - persist a convergence report comparing mechanical predictions (regions/oppositions) vs mapper partitions
  - use it as a calibration tool for disruption weights, jury selection, and mapper prompt tuning
- Structural analysis (UI graph visualization):
  - keep structural analysis available for UI visualization, but ensure it does not affect the happy path
  - if any structural analysis computations currently influence gating/pruning/traversal, move those computations to a side path; otherwise leave as-is

**Integration points**
- The cognitive artifact already has slots for structural validation/convergence/alignment metadata: [cognitive-artifact.ts](file:///C:/Users/Mahdi/Desktop/hybrid/shared/cognitive-artifact.ts#L1-L92).
- Observability UI already reads traversal/mechanical gating diagnostics: [DecisionMapObservabilityRow.tsx](file:///C:/Users/Mahdi/Desktop/hybrid/ui/components/DecisionMapObservabilityRow.tsx#L865-L930).

**Acceptance**
- Diagnostics are available without changing pruning outcomes.
- We can quickly distinguish: “no forks exist” vs “forks exist but mapper missed them” vs “forks exist but validation suppressed them”.

---

### Milestone 9 — Fallback Wiring and Rollout Criteria

**Deliverables**
- Auto-fallback rule:
  - If partitions are empty OR all low-confidence AND disruption scoring indicates opposition exists, fall back to current gate/traversal system.
- Observability:
  - log counts of partitions emitted, partitions answered, fallback triggers, and outcome deltas.

**Acceptance**
- No regression in “pipeline completes successfully” rate.
- When partitions fail, users still get traversal via fallback rather than dead ends.

---

## 6) Validation Plan

### 6.1 What We Measure Every Run (Required)

- Shadow: statement count, stance distribution, exclusion counts.
- Condensed: kept vs dropped counts; threshold used; percent of statements kept.
- Geometry: node/region counts; degenerate substrate rate.
- Worklist: top N focal statements and scores.
- Mapper: partitions count; parse success; emergent forks count.
- Traversal: questions shown; questions answered; continuation success.
- Pruning: protected/skeletonized/removed counts; per-model surviving char counts.

### 6.2 Regression Scenarios (Must Not Break)

- Embeddings unavailable → pipeline still maps and synthesizes via current behavior.
- Mapper parse failure → pipeline still returns a usable mapping artifact and does not deadlock.
- Traversal skipped by user → pipeline synthesizes from unpruned substrate as today.

---

## 7) Key Decisions (Default Positions for v1)

### 7.1 Emergent Fork Ranking

- Default for v1: emergent forks are appended after focal-derived partitions and never outrank them.
- Still compute a retroactive disruption estimate for emergent forks using the same signals, but treat it as a secondary sort key.
- Revisit once we have data on how often emergent forks are high-value.

### 7.2 Mapper Secondary Output (Claims Graph)

- Default for v1: keep claims graph as a secondary output to avoid breaking UI graph features while partitions mature.
- Once partitions are reliable, decide whether to:
  - keep claims indefinitely for visualization only, or
  - deprecate claims and adapt the UI to partition structures.

---

## 8) What “Refactor Complete” Looks Like Operationally

- The mapper reads a bounded, mechanically-ranked worklist and produces partitions with hinge questions.
- Traversal asks only the highest-disruption forks (max 4–5) and prunes advocacy deterministically.
- The chewed substrate is the single source of truth for synthesis, and synthesis cannot resurrect pruned branches.
- The old gate/traversal system remains available as fallback until partitions prove consistently reliable across real usage.

---

## Appendix A: Open Design Decisions

This section tracks the open questions from [pipeline_refactor_plan.md](file:///C:/Users/Mahdi/Desktop/hybrid/pipeline_refactor_plan.md) as explicit decision points, with the milestone where each must be resolved and what “resolution” means.

1. Query relevance threshold calibration
   - Must resolve by: Milestone 1–2
   - Resolution criteria: a threshold policy that is conservative by default, observable (distributions logged), and does not produce catastrophic false negatives on a representative test set.
2. Jury representative selection criteria
   - Must resolve by: Milestone 4
   - Resolution criteria: jury composition consistently represents major regions and yields partitions that align with observed forks in human spot-checks.
3. Mapper secondary output decision (claims graph)
   - Must resolve by: Milestone 8.5 (with UI impact understood)
   - Resolution criteria: decide whether claims remain a UI-only secondary output, are deprecated, or are replaced by partition-native visualization.
4. Deduplication strategy (same partition found multiple times)
   - Must resolve by: Milestone 5
   - Resolution criteria: a deterministic merge policy that prevents redundant questions while preserving provenance and impact ranking.
5. Disruption scoring formula weights
   - Must resolve by: Milestone 3–4 (initial), refine continuously
   - Resolution criteria: disruption ordering correlates with “output delta” in observed runs and produces high-value traversal ordering under the 4–5 question cap.
6. Emergent fork ranking policy
   - Must resolve by: Milestone 5.5
   - Resolution criteria: explicit ordering rule (append vs interleave), plus a retroactive disruption estimate and validation for emergent forks.

## Appendix B: Observability & Diagnostic Layers

These layers are explicitly retained “on the side” and must remain available for debugging, calibration, and UI support, without affecting the happy path.

### B.1 Shadow Delta Audit (Completeness Monitoring)

- Purpose: identify substantive statements that did not participate in any partition/worklist path (“what partitions missed”).
- Input: full `shadow.statements` inventory + partition participation metadata + query relevance.
- Output: a report surfaced in observability UI, highlighting:
  - high-query-relevance statements not referenced by any partition
  - region coverage gaps (if any) where major regions never appear in juries/worklist
- Integration: persisted into the cognitive artifact as observability metadata; never used to prune.

### B.2 Convergence Validation (Mechanical vs Semantic Alignment)

- Purpose: compare mechanical structure predictions (regions/oppositions) against mapper-derived partitions and detect systematic mismatch.
- Input: pre-semantic interpretation (regions/oppositions), disruption scoring outputs, mapper partitions, validation results.
- Output: a convergence report that answers:
  - were predicted oppositions actually surfaced as partitions?
  - are partitions aligned with geometry neighborhoods or are they cross-cutting artifacts?
- Integration: persisted into cognitive artifact; used for calibration and fallback decisions, not for pruning decisions directly.

### B.3 Structural Analysis (UI Graph Visualization)

- Purpose: power decision map visualization and structural insight panels.
- Contract: it must not be load-bearing for traversal selection, pruning, or synthesis.
- Policy: keep structural analysis; if any structural computations influence happy path behaviors, move those computations into a side path and keep the happy path deterministic without them.

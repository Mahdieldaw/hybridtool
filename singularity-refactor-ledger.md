# Singularity Refactor Master Ledger
*Consolidated from clustering audit (A2), stage-contract pass (A3), orchestration audit (A1), triage classification, architectural decisions, v2 footprint sprint, and ledger patch (doc 8). Reflects current codebase state.*

---

## Status Key
`DONE` - removed or implemented. `DECIDED` - architectural call made, not yet implemented. `PLANNED` - queued for implementation. `HOLD` - blocked on concordance or a pending decision. `OPEN` - unresolved.

---

## I. Completed Work

### HANDOFF_V2 - DONE
Entire V2 handoff mechanism removed: disabled prompt branches (Turn 2 / Turn 3+), `parseConciergeOutput`, `pendingHandoff`, `commitPending`, and the `needsFreshInstance` flag condition. `singularity-phase.ts` fresh-instance logic is now a clean binary: `firstRun || providerChanged`. Concept archived externally.

---

### V2 Claim Footprint - DONE
**Sprint completed on main. No migration. No DB writes. Old artifacts require rebuild or guarded UI fallback.**

#### What landed
| File | Change |
|---|---|
| `shared/types/contract.ts:354` | V2 footprint schema: statement-atom based with paragraph, model, and claim rollups |
| `src/provenance/measure.ts:118` | Footprint builder rewritten around atoms |
| `src/provenance/surface.ts:283` | Surface layer reads rollups, not paragraph vectors |
| `src/execution/deterministic-pipeline.ts:426` | `artifactSchemaVersion: 2` stamped; `claimConcordance` present as diagnostic/foundational |

#### Schema shape (v2)
- **Footprint unit:** statement atom (not paragraph vector)
- **`sharedTerritorialMass`:** direct sum of `ownershipShare` over shared atoms
- **`paragraphPresenceCount`:** paragraphs this claim appears in
- **`contestedParagraphCount`:** paragraphs where at least one other claim is also present (co-presence, not atom-sharing)
- **`dominantParagraphCount`:** paragraphs where this claim is the sole present claim
- **`sharedStatementCount`:** atom-sharing ledger, distinct from contested co-presence

#### Key distinction locked by regression test
Two claims in the same paragraph on different statements -> paragraph is **contested** but creates **no shared atom mass**. Schema-level distinction, not buried in a count.

#### Artifact policy
- `artifactSchemaVersion: 2` persisted in `deterministicPipeline`
- No DB migration path; old v1 artifacts require rebuild or guarded UI fallback
- `claimConcordance`: foundational/diagnostic field; no active consumers yet (see §VI)

#### Verification state
- Focused suite: **5 suites, 27 tests - all passing**
- Typecheck: clean (only pre-existing `scratch/test-json-repair.ts` failures)
- Full Jest: pre-existing unrelated failures only - none from footprint code
- Ribbon ordering: unchanged

#### Open item
Confirm `deterministic-pipeline.artifact-schema.test.tsx` is tracked in git.

---

## II. Architectural Decisions Made

### 1. Live vs Regenerate Equivalence - DECIDED
Artifact-equivalent, not byte-equivalent. Given same immutable inputs under same pipeline/model/registry/config, regenerate must reproduce every field in the persisted cognitive artifact or downstream reading/synthesis contract. Timings, message order, cache keys, and progress events are exempt.

**Implication for `sourceCoherence`:** Must move into `deterministicPipeline`. Currently live-path only. Non-optional. Status: **PLANNED** (SR-5, must precede SR-3).

### 2. Paragraph Embeddings - DECIDED
Independent paragraph vectors remain canonical. Mean-pooling from statement centroids rejected. Statement-derived centroid overlay is a valid second-order measurement only. Separate `generateEmbeddings` pass stays.

### 3. Concordance and Routing Labels - DECIDED
Routing labels (`northStar`, `eastStar`, `mechanism`, `floor`) no longer serve as final ordering authority. Survive as legacy diagnostics until concordance replaces them. Ordering happens after the concordance matrix emits a visibility profile.

### 4. Tables in the Reading Layer - DECIDED (split)
- **Policy:** Tables are eligible reading evidence, not automatic reading evidence.
- **Table-context contract:** Can be specified and written before concordance lands. *[Reclassified from post-concordance -> pre-concordance work.]*
- **Table-driven ordering/visibility:** Waits for concordance.

### 5. Persistence Patterns - DECIDED
*[Reclassified from CB-4 open bug -> decided pattern.]*

Two legitimate persistence paths coexist by design:
- **`PersistenceCoordinator`-persisted responses:** participate in witness gating and the deterministic pipeline.
- **Direct `adapter.put()` responses (e.g., editorial):** reading-layer outputs persisted alongside their phase.

Do not unify. Task is documentation and verification of the boundary only.

### 6. ID Stability - DECIDED (split)
*[Reclassified from single open question -> resolved + open.]*

- **Resolved:** Shadow statement IDs (`s_N`) and embeddings are canonical stable immutables. These do not change across re-extractions under the same model/config.
- **Open:** `modelIndex`, paragraph IDs (`p_N`), and derived IDs across retried turns and re-extractions. Contract not yet specified. Concordance depends on this.

### 7. HANDOFF_V2 - DONE (see §I)

---

## III. Contract Bugs

### CB-1 · Embedding Timeout Mismatch - OPEN -> PLANNED
SW proxy: 45s (`sw-entry.ts:893`). Offscreen controller: 5 minutes (`embedding-controller.js:24`). Large batches time out at the SW boundary while the offscreen worker is mid-flight - orphaned job, unread IndexedDB buffer, downstream geometry continuing with stale/missing vectors.

**Next action:** Single-source timeout constant + explicit cancellation semantics. Do not change either value until that contract is written.

### CB-2 · Dual `SEMANTIC_ARTIFACT_READY` - PLANNED (with UI merge guard)
*[Reclassified from "pure event rename" -> "planned, requires UI merge guard."]*

Two emissions, same message name: 1 after `buildCognitiveArtifact` (no editorial AST), 2 after editorial AST attached. UI consumers cannot distinguish shape without inspecting payload.

**Direction:** Rename 2 to `EDITORIAL_AST_READY`. Second message sends `{ type, ast }` only, not the full artifact. This requires a UI merge contract: consumers of 1 must be able to receive 2 and integrate `editorialAST` without a full re-render. Mark any implementation of this as blocked on that guard being specified first.

**Immediate action:** Document emission ladder only. No code change yet.

### CB-3 · `WORKFLOW_COMPLETE` Before `TURN_FINALIZED` - OPEN
UI consumers treating `WORKFLOW_COMPLETE` as authoritative may read pre-finalized state.

**Next action:** Inventory which listeners react to which event. Declare: "compute done" vs "turn finalized."

### CB-4 · Editorial Persistence Bypass - DECIDED (see §II Decision 5)
*[Removed from open contract bugs. Reclassified as a decided persistence pattern.]*

Task remaining: write a concise doc confirming the boundary between coordinator-path and direct-path responses. Do not unify.

### CB-5 · Provider-Context Persistence Before Witness Gate - OPEN
On `insufficient_witnesses` halt, partial provider-context rows are already persisted. Regenerate and debug paths may see ghost rows.

**Next action:** Confirm whether regenerate/debug read these rows on halt turns. Decide: intentional crash-recovery or sequencing bug.

### CB-6 · `cosineSimilarity` Silent Dimension Truncation - PLANNED (two phases)
`distance.ts:9` uses `Math.min(a.length, b.length)`. Model/cache version skew produces quietly-wrong scalars across geometry, conflict validation, basin inversion, query relevance.

- **Phase 1 (safe now):** Add dimension-mismatch counter/log - non-throwing.
- **Phase 2 (harness-required):** Strict-mode switch after mismatches confirmed zero in real corpora.

### CB-7 · `enrichStatementsWithGeometry` - PATH-TRACE REQUIRED
*[Reclassified from "known divergent output" -> "path-trace required."]*

Earlier evidence suggested this was skipped on the `geometry-runner.ts` path, producing different statement-level geometry on live vs regenerate. Later evidence suggests `executeArtifactPipeline -> EnrichStmts` may re-apply enrichment on both branches, resolving the divergence.

**Next action:** Trace both paths explicitly. Produce a bytes-equal assertion or name the divergence. Do not treat as a known bug until the trace is done.

---

## IV. Safe Refactor Candidates

**Sequencing note on SR-3 and SR-5:** SR-5 (`sourceCoherence` relocation) must land before SR-3 (`mapping-phase` extraction). The live-path `stampSourceCoherence` helper should not be extracted as a stable helper before it is moved into `deterministicPipeline`. Extract after relocation, not before.

### SR-1 · Extract `text-prep.ts` - PLANNED
`stripInlineMarkdown` + `structuredTruncate` -> `shared/text-prep.ts`. Precondition: confirm no embedding-specific normalization precondition.

### SR-2 · Fix Boundary Imports - PLANNED (follows SR-1)
- `shadow-extractor.ts:15` -> fix after SR-1
- `WelcomeScreen.tsx:4` -> `shared/embedding-models.ts`

### SR-3 · `mapping-phase.ts` onAllComplete Extraction - PLANNED (after SR-5, with snapshot guard)
Extract `assembleMappingArtifact()`, `runEditorialPhase()`. Note: `stampSourceCoherence()` is not extracted here - it is first relocated to `deterministicPipeline` via SR-5, then the extraction in SR-3 works against the already-moved version. Requires H-1 + H-6 snapshots.

**Rule:** Extract, do not redesign. Same await order, message order, persistence order.

### SR-4 · Parallelize Embedding Awaits - PLANNED (low semantic risk, not zero)
*[Reclassified from "zero semantic risk" -> "low semantic risk."]*

`geometry-runner.ts:292-294`: replace sequential awaits with `Promise.all`. Before landing: confirm error-order behavior, telemetry/progress event ordering, and output equivalence are unaffected.

### SR-5 · `sourceCoherence` Relocation - PLANNED (precedes SR-3)
Move from live-path-only stamping into `deterministicPipeline` near `claimStructuralFingerprints`. Required by artifact-equivalence decision. Requires H-1 deterministic-pipeline fixture first.

### SR-6 · `computeProbeGeometry` Relocation - PLANNED
`deterministic-pipeline.ts:788-878` -> `src/execution/utils/probe-geometry.ts`.

### SR-7 · `computeDerivedFields` Vestigial `Promise.all` - PLANNED
Unwrap one async op + one sync passthrough from `Promise.all`. ~25 lines removed.

### SR-8 · `resolveProviderContexts` Extraction - PLANNED
Extract 4-tier provider-context resolution to `execution/io/context-manager.ts` alongside `resolveHistoricalSources`.

### SR-9 · `executeArtifactPipeline` Dead `geoRecord` Parameter - PLANNED
Rename to `embeddingBackendHint?: 'webgpu' | 'wasm'`.

---

## V. Evaluation Harness Required Before Touching

| # | Fixture needed | Gates |
|---|---|---|
| H-1 | Deterministic-pipeline output (live + regenerate, both branches) | SR-5 / SR-3 / CB-7 |
| H-2 | Conflict-validation golden output on fixed corpus | CB-6 / paragraph embedding decision |
| H-3 | Query-relevance similarity distribution snapshot | Anything touching query path or prefix |
| H-4 | Probe geometry snapshot | Follows H-1 |
| H-5 | EditorialAST snapshot against fixed `claimDensity`/`passageRouting` | Guards §VI shims |
| H-6 | Resolution-order instrumentation in `mapping-phase` onAllComplete | Before SR-3 |
| H-7 | Corpus-search top-k tie-break fixture | Before heap/quickselect switch |
| H-8 | `cosineSimilarity` mismatch counter live in production | Before Phase 2 strict switch |
| H-9 | Embedding-buffer reader inventory | Before any GC policy |

---

## VI. Concordance-Blocked - Do Not Touch

- Routing labels: `northStar`, `eastStar`, `mechanism`, `floor`
- `claimDensity` / `passageRouting` / `statementClassification` shape
- Ribbon sort order
- Blast surface / twin map / risk Type 1-2-3 / speculative fates (`PROTECTED`/`REMOVE`/`SKELETONIZE`)
- Editorial `concentrationRatio` / `landscapePosition` compatibility shims
- `claimConcordance` consumers - field exists in v2 artifact; concordance defines what reads it

---

## VII. Open Architectural Questions

1. **Witness gate + provider-context persistence (CB-5):** Intentional crash-recovery or sequencing bug?
2. **`WORKFLOW_COMPLETE` contract (CB-3):** "Compute done" or "turn finalized"?
3. **`modelIndex` / paragraph ID stability across retries (§II Decision 6):** Contract not yet specified. Concordance depends on this.
4. **Table-context preservation contract:** Policy decided; implementation spec not yet written. Pre-concordance work.
5. **CB-2 UI merge guard:** Before `EDITORIAL_AST_READY` rename can land, the UI merge contract must be specified.

---

## VIII. Immediate Next Batch

1. Confirm `deterministic-pipeline.artifact-schema.test.tsx` is tracked in git.
2. Triage pre-existing failing suites - separate stale fixtures from live regressions.
3. **Patch ledger docs** - write concise contract notes for: event emission ladder (CB-2), persistence split (CB-4 pattern), architecture decisions, legacy/retired items.
4. **Add cosine dimension mismatch logging** - non-throwing counter only. (CB-6 Phase 1)
5. **Path-trace `enrichStatementsWithGeometry`** on both branches. (CB-7)
6. **Build H-1 deterministic-pipeline fixture** - prerequisite for SR-5.
7. **Move `sourceCoherence` into `deterministicPipeline`** once H-1 is in place. (SR-5)
8. **Extract `text-prep.ts`** and fix boundary imports. (SR-1, SR-2)
9. **Parallelize embedding awaits** only after confirming error/telemetry guard. (SR-4)
10. **Diff editorial `adapter.put()` vs `PersistenceCoordinator`** - document the intentional split only. (CB-4)
11. **Write table-context preservation contract** - pre-concordance, independent of ordering work.

---

## IX. Contract Notes Added In This Patch

### CB-2 Event Emission Ladder
Current runtime sends `SEMANTIC_ARTIFACT_READY` twice from the mapping phase. The first emission carries the cognitive artifact before `editorialAST`; the second carries the artifact after `editorialAST` is attached. The documented ladder is:

1. `SEMANTIC_ARTIFACT_READY` with cognitive artifact, no editorial AST.
2. `SEMANTIC_ARTIFACT_READY` with editorial AST attached.
3. `WORKFLOW_COMPLETE` meaning compute completed, not turn persistence finalized.
4. `TURN_FINALIZED` meaning turn persistence finalized.

No rename lands until the UI merge guard is specified. The target shape remains `EDITORIAL_AST_READY` with `{ type, ast }` only.

### CB-4 Persistence Split
`PersistenceCoordinator` writes provider responses that participate in witness gating, deterministic pipeline inputs, and phase progression. Direct `adapter.put()` writes are allowed for reading-layer/editorial outputs that are persisted alongside their phase and do not define witness eligibility. This is an intentional split, not a bypass to consolidate in this batch.

#### CB-4 Write-Shape Diff
- Coordinator path (`PersistenceCoordinator.buildPersistenceResultFromStepResults` -> `SessionManager.persist` / `upsertProviderResponse`) handles `batch`, `mapping`, and `singularity` response types. It receives workflow step results, normalizes status/meta, participates in phase finalization, and for mapping may retain only the persisted artifact subset required by deterministic rebuild/debug surfaces.
- Editorial direct path (`executeMappingPhase` direct `adapter.put('provider_responses', ...)`) writes `responseType: 'editorial'`, `responseIndex: 0`, raw editorial text, provider meta, and created/updated/completed timestamps. It is non-blocking, occurs after the editorial AST parse attempt, and is read later by recompute to restore `editorialAST`.
- Boundary: editorial persistence is a reading-layer sidecar for AST restoration, not a witness-gated provider response and not a deterministic pipeline input. Do not route it through the coordinator unless a later contract makes editorial a phase participant.

### Architecture Decisions
The ledger decisions are authoritative for this refactor pass: artifact-equivalence over byte-equivalence, independent paragraph embeddings, routing labels as legacy diagnostics only, tables as eligible but not automatic reading evidence, split persistence paths, and split ID-stability policy.

### Table-Context Preservation Contract
Tables are preserved for editorial evidence selection, not promoted into automatic reading evidence. The pre-concordance contract is preservation-only:

1. Shadow extraction keeps table cells as statement records with `isTableCell`, `tableMeta`, source `modelIndex`, paragraph/sentence location, raw text, clean text, and full paragraph/table context when available.
2. Geometry and prose measurement may continue to filter pure table-cell paragraphs from routing/scoring surfaces. This does not authorize deletion of the table statements from corpus, claim ownership, lookup caches, or editorial substrate construction.
3. Editorial inputs may receive table context as eligible evidence with row header, column header, value, source model, nearby prose/full paragraph, owning or nearest claim, and query relevance if available.
4. No pre-concordance table work may change `claimDensity`, `passageRouting`, `statementClassification`, ribbon ordering, routing-label semantics, or concordance consumers.
5. Table-driven ordering and visibility wait for concordance. Until then, table context is a sidecar that helps the editorial model choose evidence without changing deterministic ordering policy.

### Legacy And Retired Items
`HANDOFF_V2` is retired and must not be reintroduced. V1 footprint artifacts have no migration path and require rebuild or guarded fallback. Routing labels and editorial compatibility shims remain only as legacy diagnostics until concordance defines replacements. `claimConcordance` remains diagnostic/foundational with no consumers.

### CB-7 Path Trace
Static trace result: no live/regenerate statement-geometry enrichment divergence is named from the current source path. The live mapping path starts `buildGeometryAsync` in `src/execution/pipeline/mapping-phase.ts`, then converges through `executeArtifactPipeline` with prebuilt substrate and preSemantic. `buildGeometryAsync` itself does not call `enrichStatementsWithGeometry`; the deterministic convergence point does.

Regenerate paths (`src/sw-entry.ts` on-demand/preemptive regenerate and `src/execution/pipeline/recompute-handler.ts`) call `buildArtifactForProvider`, whose only body is a call to `executeArtifactPipeline`. `executeArtifactPipeline` calls `enrichStatementsWithGeometry` after resolving either prebuilt geometry (live branch) or locally rebuilt geometry (regenerate branch). Therefore both artifact branches pass through the same enrichment call. H-1 remains the required bytes-equal guard before any CB-7 remediation or consolidation decision.

---

*Last updated: post-HANDOFF_V2 removal · post-five-decision pass · post-v2 footprint sprint · post-ledger patch (doc 8). Next update: after pre-existing test suite triage and immediate next batch.*

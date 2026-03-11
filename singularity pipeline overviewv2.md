# Singularity — Pipeline Overview

  

Singularity is a multi-model AI synthesis system. It queries multiple AI models simultaneously with the same question, then processes their outputs through a geometric and semantic pipeline to produce a synthesis constrained to the user's actual reality. The core principle is constraint resolution rather than consensus-building: finding what your reality forces to be true by eliminating reasoning branches that don't apply to your situation.

  

The user's value proposition: you don't need to be a domain expert. You don't evaluate which model is right. You describe your reality through simple observable-fact questions — things you can answer from direct knowledge of your own situation — and the system mechanically constrains the evidence to what applies. The golden thread — the one insight one model produced that the others missed — survives because it was never conditional on anything the user doesn't have.

  

---

  

## 1. Fan-Out and Shadow Extraction

  

The user's query fans out to multiple models (currently 6). Their raw responses are preserved as the evidence substrate — the full text is the primary output, never discarded.

  

A shadow extractor (mechanical NLP via compromise.js, not an LLM) splits every model response into paragraphs and sentences. These become the shadow corpus: every statement from every response, tagged by model index and paragraph of origin. This is the ground-truth text layer that all downstream computation operates on.

  

Each sentence is filtered for substantiveness — minimum word count, exclusion of markdown headers, table rows, bold-only lines, and meta-commentary patterns ("Let me summarize..."). Each surviving sentence is classified by epistemic stance (prescriptive, cautionary, prerequisite, etc.) and tagged with signals (sequence, tension, conditional).

  

Known limitation: Tables and structured markdown are currently split into rows that lose their column-relationship structure when treated as independent statements. This is a recognized extraction weakness — table rows that become standalone statements pollute the embedding space with fragments that lack the relational context that made the table meaningful.

  

Every paragraph and statement is embedded (BGE-base). The paragraph embeddings produce a geometric substrate: a pairwise similarity space showing where the models agree, diverge, and say the same thing in different words. Key measurements at this stage include discrimination range (P90−P10 of pairwise similarities), mutual recognition edges, and isolation scores — these determine whether the embedding space has enough structure for downstream operations to produce meaningful signal.

  

---

  

## 2. Semantic Mapping (LLM)

  

An LLM (the semantic mapper) reads the raw model outputs and extracts a structured graph: named claims (the key positions across the batch), edges between them (supports, conflicts, qualifies), and a narrative. This is the one LLM-dependent step in the pipeline — everything after this is geometric or mechanical.

  

The mapper's output is treated as a lossy index, not as ground truth. Claims serve as a pruning index while the original text remains the primary output. The system does not rely on the mapper to perfectly capture every insight — it uses claims as structural handles for the geometry to operate on, and the text survives regardless.

  

---

  

## 3. Provenance Reconstruction

  

The mapper does not output provenance links. It produces claims and edges — the semantic structure — but does not attribute which evidence supports which claim. That reconstruction is handled entirely by the geometry layer through two independent methods, then merged.

  

**Competitive allocation** — paragraphs choose claims. For each paragraph, the system computes its similarity to every claim centroid, then derives that paragraph's own μ and σ across all claims. A claim owns a paragraph only if its similarity stands out from the field — exceeds that paragraph's μ + σ (or μ for two-candidate competitions). A paragraph that's equally close to everything gets assigned to nothing. The evidence landscape, not the mapper, determines ownership.

  

The mechanism is distribution-relative rather than threshold-based. A statement with cosine 0.62 to a claim is assigned if that statement's average is 0.51 with σ of 0.08 — because 0.62 is notably above its own baseline. A statement with cosine 0.72 to a claim is *not* assigned if that statement's average is 0.68 — because 0.72 is unremarkable in its own context. The noise in the embedding model shifts all scores together; the relative structure survives.

  

**Claim-centric scoring** — claims seek paragraphs. Each claim's embedding scans the full paragraph corpus to find paragraphs that match its specific profile, using a μ+σ threshold for inclusion. This catches evidence the competitive method might miss because the paragraph was closer to a different claim in the global competition but still carries relevant content.

  

**Mixed-method merge.** The two pools are unioned — preservation-by-default — then a μ_global floor filter removes individual statements whose cosine similarity to the claim falls below the corpus-wide mean. For each claim, the system computes the mean similarity of *all* statements in the corpus to that claim; only statements from the merged paragraph pool that exceed this floor are kept as canonical. Competitive allocation alone causes the orphan assignment problem — statements assigned to claims simply because no other claim wants them more. Claim-centric alone can be too permissive. The union captures coverage from both methods; the global mean floor removes the weakest matches.

  

---



## 4. Blast Surface (Damage Assessment)

  

Once provenance is reconstructed, the blast surface scores each claim by the structural damage caused if that claim were removed. This is pure L1 math — cosine similarities and set membership on provenance outputs, no semantic interpretation.

  

**Layer B — Exclusive Vulnerability (Twin Detection):** For each claim, identifies its exclusive statements (statements assigned only to this claim, not shared with others). For each exclusive statement, searches the entire cross-claim corpus for a "twin" — a near-duplicate that would preserve the information if this claim were pruned. Twin detection uses a dual-gate architecture: Gate 1 checks similarity against a distribution-relative threshold (μ+2σ of cross-claim candidate similarities); Gate 2 verifies reciprocal best-match (the candidate's nearest neighbor in the claim's exclusive set must be the original statement). Statements that have no twin anywhere are "orphans" — if the claim is pruned, this information is lost.

  

**Layer C — Evidence Mass:** The canonical statement count, plus a three-way type split: non-exclusive statements shared with other claims (Type 1: protected), exclusive statements with a surviving twin (Type 2: removable), and exclusive orphan statements with no twin (Type 3: skeletonized-only). The three counts sum to canonical count. Two derived ratios surface the claim's evidence character: `isolation` = (Type 2 + Type 3) / canonical (fraction of exclusive evidence), `orphanCharacter` = Type 3 / (Type 2 + Type 3) (within exclusives, fraction that are true orphans).

  

**Layer D — Cascade Echo:** Measures how much of other claims' evidence would be destabilized if this claim were pruned. For each other claim that shares canonical statements with the target, calculates the overlap fraction weighted by the other claim's exclusivity ratio. High cascade echo means the claim acts as a structural anchor for other ideas.

  

**Vernal Composite:** Combines the measurements into a single damage score per claim:

structuralMass = orphanCount + cascadeExposure

queryTilt = lambda × destroyedQueryMean

compositeScore = structuralMass + queryTilt

Where cascadeExposure is the vernal-specific cross-claim propagation: for each other claim that shares canonical statements, sums (overlapFraction × otherClaim's orphanCount). destroyedQueryMean is the mean cosine similarity between orphaned statements and the query embedding (normalized to [0,1]). lambda = structuralStep × adaptiveAccelerator, where structuralStep = σ_M and adaptiveAccelerator = min(1.0, σ_Q / 0.25)

**Risk Vector:** The blast surface produces a risk vector per claim alongside the vernal composite — three orthogonal axes, each tracking a distinct failure mode on prune. 

`deletionRisk` — Type 2 count. Exclusive non-orphan statements that would be entirely  erased. The idea survives in a twin; the original text, entities, and articulation do not.

`degradationRisk` — Type 3 count. Exclusive orphan statements that would be skeletonized. The conservation law holds — these can never be fully removed — but the synthesizer inherits entity fragments, not statements.

`cascadeFragility` — Continuous protection-depth sum over non-exclusive statements: Σ 1/(parentCount − 1). A statement with two parents contributes 1.0; one with ten parents contributes 0.1. Dimensionally compatible with statement counts. Distribution stats (μ, σ of per-statement values) indicate whether shared evidence is uniformly protected or has a thin-protection tail.
The vernal composite is preserved as-is. `riskVector` is an additive optional field — no consumer changes.

**Statement Twin Map:** The blast surface now emits a corpus-wide twin adjacency map. For every statement, the map records its reciprocal best-match twin if one exists — same algorithm as Layer B (μ+2σ gate, forward pass, reciprocal backward pass), extended from exclusive statements to all statements. The candidate pool also expands to include unclassified statements (not owned by any claim). For statements already in Layer B's scope, results should be identical — this is a validation check during implementation. Survival filtering does not happen here; the map records all geometric twins. Attaches to `BlastSurfaceResult` as an optional field for backward compatibility. 

Caveat: The equation adds statement-counts to a scaled cosine similarity. The 0.25 denominator in the adaptive accelerator is a hardcoded assumption about the typical spread of query-relevance scores. If actual σ_Q is consistently much smaller than 0.25, queryTilt effectively vanishes and the composite reduces to pure structural mass. This should be instrumented across runs to verify the balance matches intent.

  

---

  

## 5. Structural Routing and Routed Prompts

  

The system has mapped the terrain. It has not reduced it. Every branch is live. Every redundancy is present. The map is maximally informative precisely because it hasn't collapsed.

  

The user collapses it — but only where the geometry identifies a structural reason to ask.

  

### Structural Routing

  

Before any LLM generates questions, the geometry classifies claims into three categories. This classification is the gate — it determines *whether* a question is asked, not what the question says.

  

**Conflict clusters.** Claims connected by validated conflict edges. A conflict edge is validated when the centroid similarity between two claims the mapper labeled as conflicting falls below the mean inter-claim similarity — meaning they occupy genuinely different positions in the embedding space, not just surface-level disagreement. Connected components of validated conflict edges form clusters. Each cluster is a fork: the user's situation determines which branch applies.

  

**Isolate candidates.** Claims that meet three criteria simultaneously: (1) sole-source — supported by exactly one model; (2) high orphan ratio — a distribution-relative proportion of their exclusive statements have no twins in the corpus; (3) query-distant — the claim's centroid is far from the query embedding (below μ−σ of the claim-query similarity distribution), meaning it introduces concepts the user didn't mention. This is the golden-thread signature: irreplaceable evidence from a single model, bringing in something from left field. Worth protecting, but must check for unsurfaced preconditions.

  

**Passthrough.** Everything else — consensus claims and structurally redundant sole-source claims — passes through without touching the survey mapper. Silence is architectural, not prompt-engineered.

  

If convergence is high and no conflicts or isolates are detected, the survey is skipped entirely. No LLM call is made.

  

Open question: The skip logic does not currently check whether minority-supported claims (those below the 50% consensus threshold but not sole-source) represent structurally interesting alternatives to the consensus. A claim supported by 2 of 6 models with low orphan ratio falls through as passthrough without being questioned. The most valuable gate may be precisely between the consensus recommendation and a minority position — this routing gap is under review.

  

### Routed Prompts

  

The survey mapper receives targeted tasks matched to the structural category, not an open-ended landscape to evaluate.

  

**Fork articulation** — for conflict clusters. The geometry has already confirmed these claims occupy genuinely different positions. The mapper's job is narrow: translate the geometrically-confirmed tension into a single natural-language yes/no question that distinguishes the branches for this user. It asks about the observable real-world condition that makes one branch applicable and the other inapplicable.

  

**Misleadingness test** — for isolate candidates. The mapper runs a two-sentence filter: (1) "This claim would mislead the user if they [describe wasted action] because it silently requires that they [state condition]." (2) "The user can verify this with: '[yes/no question]?''' If sentence 1 cannot be written truthfully from what the claim actually says, the claim passes without a gate. This tests for false affordances — the illusion of a door where there's a wall.

  

The completion trap — the LLM's pathological need to generate a question for every claim it sees — is broken by design. The LLM never sees "assess all claims." It sees one pre-selected structural feature and writes one targeted response. Most claims never reach the LLM at all.

  

Each binary answer is one bit of user information entering the system. Each bit does maximal work because the forcing points are selected where the geometry identified genuine structural consequence. The user doesn't need to understand the geometry. They answer questions about their reality — things they can answer from direct observation in under five seconds — and the space contracts around their answers.

  

---

  

## 6. Pruning and Skeletonization

  
The user answers the gate questions. Claims that fail are pruned. The triage engine determines the fate of every statement as a pure set operation on the blast surface's pre-computed twin map — no embedding computation at traversal time.

 **Survival pool.** Any statement with at least one surviving parent claim, plus any unclassified statement (not owned by any claim). Unclassified statements are never stranded — they were never conditional on any claim's survival.

 **Fates.** Every statement receives exactly one:
 - `PROTECTED` — in the survival pool. Survives as full text.
 - `REMOVE` — stranded, twin map contains a surviving twin in the survival pool. Geometry confirms the idea has a living carrier; original text is removed.
 - `SKELETONIZE` — stranded, no surviving twin. Stripped to noun-only skeleton via compromise.js part-of-speech extraction. Entities survive; relational framing does not.

 If `blastSurface.twinMap` is missing (older cached artifacts), all stranded statements fall back to SKELETONIZE. Conservative — never removes without twin evidence. Logs warning.

 **CarrierDetector deleted.** The previous triage path used Layer B for exclusives and fell back to CarrierDetector.ts for everything else — a separate algorithm with different thresholds. The twin map extends Layer B's algorithm to all statements, making CarrierDetector redundant. The cross-model paraphrase pass (0.85 cosine + Jaccard) is absorbed into the twin map's reciprocal best-match. `residualFallbackCount` is deprecated — no fallback path exists.

 Performance: triage drops from O(n × m) embedding computations at traversal time to O(n) map lookups. All geometric work is pre-computed at blast surface time, which runs once per pipeline execution.
  

---

  

## 7. Synthesis

  

The chewed substrate goes to a synthesizer that reads the actual text, not claim summaries. The synthesizer operates on the evidence — the original model language, pruned to the user's reality. Claims serve as structural context (what the models were arguing about) but the synthesizer's primary input is the text itself.

  

The system's architectural principle throughout: claims are a pruning index, text is the output. The V8 inversion — claims serve as an index while text remains the primary output — ensures the synthesizer reads evidence rather than abstractions.

  

---

  

## Pipeline Summary

  

```

User Query

    ↓

Fan-Out → 6 models respond in parallel

    ↓

Shadow Extraction → paragraphs + statements (mechanical NLP)

    ↓

Embedding → paragraph + statement vectors (BGE-base)

    ↓

Geometric Substrate → pairwise similarities, mutual edges, isolation

    ↓

Semantic Mapper → claims + edges + narrative (LLM, lossy index)

    ↓

Provenance Reconstruction → competitive + claim-centric + mixed-method merge

    ↓

Blast Surface → risk vector + statement twin map; Layer B: exclusive twins → vernal composite

    ↓

Structural Routing → conflict clusters | isolate candidates | passthrough

    ↓

Survey Mapper → fork articulation | misleadingness test | skip (routed LLM)

    ↓

User answers gates (yes/no)

    ↓

Pruning + Skeletonization → chewed substrate

    ↓

Synthesis → reads text, not claims

    ↓

User-constrained output

```

---
 
 ## Stored Primitives
 
 The pipeline stores four categories of data. Everything else is derived at view-time from these primitives. If you change a derivation function, reload, and navigate to any historical turn, the new function's output appears without recompute.
 
 **Batch text responses** — raw text from each model, keyed by `(turn_id, model_id)`, frozen on creation, never invalidated. Downstream: shadow extraction.
 
 **Embeddings** — Float32Array per statement and paragraph, keyed by `(turn_id, embedding_model_id)`. Invalidated on embedding model change. Downstream: every geometric computation.
 
 **Mapper output** — raw mapper text parsed into claims and edges, keyed by `(turn_id, mapper_model_id)`. Invalidated on mapper model change. Downstream: claim centroids, provenance, synthesis.
 
 **Claim embeddings** — Float32Array per claim centroid, keyed by `(turn_id, mapper_provider_id)`. Invalidated on mapper model change. This is the L2 bridge: generated once by `generateClaimEmbeddings`, consumed by provenance reconstruction and all downstream L1 computations.
 
 These four primitives are sufficient to derive the complete geometry and provenance layers. Geometry is never recomputed — it derives at view-time from cached embeddings. Mapping reruns on model change or explicit request. Synthesis reruns on synthesis model change or explicit request.

## Key Architectural Principles

  

**No magic numbers.** All thresholds self-calibrate to the actual geometric landscape using distribution-relative measurements (μ+σ, μ−σ, natural gaps, empirical ceilings) rather than hardcoded values.

  

**Epistemic layer boundaries.** The geometry layer (L1) produces only measurements computable from embeddings and set membership. No semantic interpretation. The "inversion test" enforces this: could you compute this from embeddings alone?

  

**Additive philosophy.** New approaches are built alongside existing ones. Redundancy is trimmed only after the new system proves effective. The old monolithic survey prompt exists as a fallback behind the routed architecture.

  

**Claims are an index, text is the output.** The V8 inversion. Claims serve as structural handles for the geometry to operate on. The synthesizer reads evidence, not abstractions.

  

**Disruption over agreement.** Uniqueness is measured by what happens if a position disappears (irreplaceability via orphan detection and cascade echo), not by how many models agree. Consensus-favoring algorithms are explicitly avoided — the system surfaces outliers and minority positions.

  

**Progressive refinement.** Cast wide with paragraphs, refine with statements, discriminate with differentials. Applied consistently across provenance reconstruction, twin detection, and routing.

  
 **The embedding model doesn't define the space.** Semantic relationships between pieces of text exist before any model encodes them. Two paragraphs describing the same mechanism in different words are related as a property of the texts, not of the encoder. The embedding model translates pre-existing relationships into a form the system can measure. The translation is lossy, but the structure that survives the projection is real structure, not an artifact of the instrument.


 **Skeletonization is adversarial, not archival.** Skeletons are not degraded evidence waiting to be reconstructed — they are entity-rich fragments deliberately released into the surviving corpus without their original relational framing. The user rejected a claim's argumentative structure, not the entities it referenced. Nouns are references to things that exist independent of the argument that introduced them. If those entities genuinely constrain the solution space, they reassert during synthesis in recombinations the mapper never identified. The conservation law: the last instance of an idea cannot be removed from the system.
---



## The complete information flow:

  

One sentence of user intent → fanned to N models → hundreds of independent statements → embedded into a measured geometric landscape → mapped into claims with provenance reconstructed geometrically → risk vector measured per claim, statement twin map pre-computed across full corpus → claims routed by geometry into conflicts, isolates, or passthrough → targeted questions generated only for structurally flagged claims → user collapses the space through binary decisions → stranded evidence triaged against pre-computed twin map: removed where twins survive, skeletonized where they don't → synthesizer reads the surviving corpus blind → output reflects what the user's reality forces to be true.

  

The pipeline is the codec, not the codebook. The corpus didn't exist before the user asked. The landscape is measured in real time. What's pre-built is the measurement apparatus — the sequence of distributional methods, competitive assignments, global-floor filtering, twin detection gates, and skeletonization rules that extract structural truth from noisy measurement. That apparatus works on any corpus the same way Shannon's error-correcting codes work on any message: not by knowing the content, but by knowing the structure of the noise.

  

The distributional methods — μ+σ thresholds, competitive assignment, the μ_global floor — treat the embedding model as a noisy instrument and extract signal that the noise obscures but doesn't destroy. Standard semantic search uses absolute values: is 0.62 a good score? Singularity uses relative structure: is 0.62 notable for *this* statement against *this* field? The noise shifts all scores together. The relative structure survives. This is why a compact embedding model produces usable results through the pipeline and unreliable results through standard retrieval — same instrument, different signal processing.

---
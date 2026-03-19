# Singularity

### What information looks like when you stop averaging it

---

## The Problem No One Names

Ask five experts the same question. You get five answers. The standard move — in AI, in committees, in life — is to blend them. Find the center. Build consensus. Ship the average.

The average is a lie. Not because any single expert was wrong, but because averaging destroys the structure of disagreement. It tells you what most people think. It can't tell you what *your situation* forces to be true. A startup founder and a Fortune 500 CFO might both answer "how should I approach pricing?" correctly for their contexts and produce answers that are mutually exclusive. The average of their answers applies to no one.

Singularity doesn't average. It eliminates.

The system queries multiple AI models simultaneously, decomposes their outputs into atomic evidence, measures the geometric structure of agreement and disagreement across that evidence, and then asks the user — through a sequence of precisely targeted binary questions — which branches of the evidence landscape apply to their actual reality. What survives that elimination is the answer the user's constraints force to be true. Not a blend. Not a summary. A consequence.

---

## The Architecture in One Sentence

One question produces an information explosion; a geometric pipeline maps that explosion into navigable terrain; the user collapses the terrain through binary decisions; a synthesizer reads what survived.

Everything else is implementation. Here's how the implementation works.

---

## Stage 1: The Explosion

The user asks a question. The system fans that question to N language models — each responding independently, with no knowledge of the others' outputs. A single model is sufficient. Multiple models enrich the landscape by introducing independent reasoning paths, different framings, and genuine disagreement where it exists.

Each model's response is decomposed deterministically into **shadow statements** — atomic evidence units, one sentence or clause each — grouped into **shadow paragraphs**. These are the raw material. Every downstream operation traces back to these units. Nothing is discarded; nothing is paraphrased. The original text survives as the primary output. Claims, scores, and geometric structures are indexing mechanisms. The text is the payload.

Each statement and paragraph is embedded — placed as a point in a high-dimensional vector space by a language model trained to position semantically similar content nearby. This embedding is the system's instrument: imperfect, lossy, and consistent enough that structural signal survives the projection.

A critical clarification: the embedding model does not define the space. Semantic relationships between pieces of text exist before any model encodes them. Two paragraphs describing the same mechanism in different words are related as a property of the texts, not of the encoder. The embedding model translates those pre-existing relationships into a form the system can measure. The translation is lossy — it collapses many axes of similarity into a single distance — but the structure that survives the projection is real structure, not an artifact of the instrument.

---

## Stage 2: The Substrate

The moment embeddings exist, the system has a substrate — even from a single model's output. The substrate is not the geometry. The substrate is **handles on the corpus**: points the user can grip and steer without having to pick up the full weight of every output. The geometry measures the relationships between those handles.

The foundational measurement is the **full pairwise similarity field** — the N×N matrix of cosine distances between every pair of paragraph embeddings. This matrix is computed once, stored, and never modified by anything downstream. It is the complete terrain: every point's relationship to every other point.

Before the system builds any structure on this terrain, it asks a prior question: *does the terrain have enough variation to be meaningful?* The **discrimination range** D = P90 − P10 measures the usable spread in the similarity distribution. If D < 0.10, the landscape is effectively flat — all points equidistant — and the system reports a degenerate field. It will not fabricate structure where none exists.

When the terrain has meaningful variation, structure is derived — never imposed.

### Regionalization

Most systems cluster by choosing a threshold and drawing boundaries. Singularity does neither. The primary regionalization algorithm — **Dual-Gap Regionalization** — reads structure from the shape of each node's own similarity distribution rather than from any global parameter.

For each paragraph, the system sorts its similarity scores to every other paragraph descending and measures the gap distribution across consecutive differences. A top-down scan identifies the first gap that exceeds μ+σ of those gaps — that is the upper boundary; everything above it is the node's *upper zone*. A symmetric bottom-up scan identifies the lower boundary. Two paragraphs form a **reciprocal-upper pair** only when each independently places the other in its own upper zone — both sides must clear a threshold derived from their own gap distribution. Reciprocal-upper pairs are connected by Union-Find into **core regions**. Nodes that fall outside any core region are allocated by vote: the fraction of core members that place the candidate in their upper zone determines assignment; strict winner takes the node; ties and zero-vote nodes become singletons.

This is parameter-free. No cluster count to specify, no global threshold to tune. In a uniform field, no reciprocal-upper edges form — the system honestly reports no structure. In a structured field, the cores self-assemble from the data's own gap geometry.

If gap regionalization produces no multi-node regions, the system falls back: basin inversion (KDE landscape peaks) → mutual recognition components → patch groupings from shared mutual neighborhoods. The fallback chain preserves behavior for degenerate or very small corpora. Mutual recognition edges — where each paragraph considers the other notable by its own μ+σ threshold — remain available as a fallback structural primitive and for independent diagnostics.

### What the Geometry Measures (and What It Doesn't)

Every geometric measurement is classified by epistemic tier:

**L1** — pure math on vectors and graphs. Computable without reading any text. The pairwise field, mutual recognition, regions, isolation scores, discrimination range. These are honest measurements. The geometry layer enforces this boundary exclusively.

**L2** — uses labeled signals: stance annotations, model identity, claim assignments. Permitted with explicit flagging. These are interpretive annotations, never hard gates.

**L3** — semantic interpretation masquerading as geometry. Not permitted in the geometry layer. Full stop.

The test is simple: *could you compute this from embeddings alone, without knowing what any text says?* If no, it's L2 or higher and must be flagged. Geometry doesn't validate meaning — proximity doesn't imply agreement — but it **falsifies structure**. Geometrically distant points cannot be honestly grouped. That veto power is the geometry's contribution.

---

## Stage 3: The Map

A separate language model — the **mapper** — reads the evidence (ordered by geometric irreplaceability) and produces **claims** and **edges**: the semantic structure laid over the geometric substrate. Claims are abstractions — "Model A and Model C both argue that X is preferable to Y" — that organize the evidence into navigable positions.

Claims are not the output. Claims are the **index**. They give the user (and the system) a way to reference clusters of evidence without reading every statement. The original text remains the primary deliverable. This is the V8 inversion: claims serve as addresses; text is the payload.

### Provenance Reconstruction

The mapper does not output provenance links. It produces claims and edges — the semantic structure — but does not attribute which evidence supports which claim. That reconstruction is handled entirely by the geometry layer through two independent methods, then merged.

**Competitive allocation** — paragraphs choose claims. For each paragraph, the system computes its similarity to every claim centroid, then derives that paragraph's own μ and σ across all claims. A claim owns a paragraph only if its similarity stands out from the field — exceeds that paragraph's μ + σ (or μ for two-candidate competitions). A paragraph that's equally close to everything gets assigned to nothing. The evidence landscape, not the mapper, determines ownership.

The mechanism is distribution-relative rather than threshold-based. A statement with cosine 0.62 to a claim is assigned if that statement's average is 0.51 with σ of 0.08 — because 0.62 is notably above its own baseline. A statement with cosine 0.72 to a claim is *not* assigned if that statement's average is 0.68 — because 0.72 is unremarkable in its own context. The noise in the embedding model shifts all scores together; the relative structure survives.

**Claim-centric scoring** — claims seek paragraphs. Each claim's embedding scans the full paragraph corpus to find paragraphs that match its specific profile, using a μ+σ threshold for inclusion. This catches evidence the competitive method might miss because the paragraph was closer to a different claim in the global competition but still carries relevant content.

**Mixed-method merge.** The two pools are unioned — preservation-by-default — then a μ_global floor filter removes individual statements whose cosine similarity to the claim falls below the corpus-wide mean. For each claim, the system computes the mean similarity of *all* statements in the corpus to that claim; only statements from the merged paragraph pool that exceed this floor are kept as canonical. Competitive allocation alone causes the orphan assignment problem — statements assigned to claims simply because no other claim wants them more. Claim-centric alone can be too permissive. The union captures coverage from both methods; the global mean floor removes the weakest matches.

---

## Stage 4: The Measurement

With claims mapped and provenance reconstructed, the system computes a structural measurement over the claim landscape: the **blast surface**.

The blast surface asks one question per claim: _what exactly happens to this claim's evidence if it's pruned?_ It is not a filter. It does not change what the mapper sees. It measures — the same way model ordering uses geometric irreplaceability to sequence which evidence the mapper reads first: an L1-derived measurement that informs decisions without making them.

But the answer to that question turns out to be three answers, not one. When a claim is pruned, its statements don't all face the same fate. A statement shared with surviving claims survives untouched, protected by living parents. A statement exclusive to the pruned claim but with a semantic twin elsewhere loses its text — the idea carries forward, the original articulation doesn't. A genuine orphan — exclusive, twinless — cannot be removed at all; it gets skeletonized, stripped to entities and numbers, present in the surviving corpus but robbed of its relational framing.

These fates are categorically different. The previous measurement collapsed them into a **vernal score** — a variance-bounded composite of orphan count, cascade exposure, and query tilt. That composite could tell you whether a claim was structurally important. It couldn't tell you what type of damage removing it would actually cause.

The measurement now produces a **risk vector** — three orthogonal axes, each tracking a distinct failure mode:

**Deletion risk** counts the exclusive statements with surviving twins. These would be entirely erased from the corpus on prune. The idea survives in a different carrier; the specific text — named entities, precise numbers, original articulation — does not. This is where actual corpus loss is concentrated.

**Degradation risk** counts the true orphans. These can never be fully removed — the conservation law holds — but they lose their relational framing. Entities and quantities survive as skeletons; the argument that gave them context does not. The synthesizer inherits fragments, not statements.

**Cascade fragility** measures the downstream exposure that pruning would create in shared evidence. Every statement this claim shares with others loses one parent on prune. A statement left with only one remaining parent is now exclusively that claim's — the next pruning that touches it completes the damage. Cascade fragility is continuous, not binary: a statement with two parents contributes more than one with ten, weighted proportionally. It measures not what breaks now but what becomes more brittle next.

The risk vector goes further than counting what breaks. It also measures _how badly_ each category actually hurts.

For deletion, the question isn't only how many statements disappear — it's how much of what they said survives in their twins. A twin that covers the same broad topic but uses different entities and numbers is a lossy substitute. A twin that closely mirrors the original articulation is nearly lossless. The **deletion damage** signal measures this: for each exclusive statement with a twin, it records the gap between the original and its carrier. Low gap means the idea transfers cleanly. High gap means the corpus loses something the twin can't fully reconstruct.

For degradation, the question is how much of each orphaned statement actually survives skeletonization. A statement built primarily from named entities and quantities loses very little — most of it is tokens the skeleton preserves. A statement whose meaning lives in its relational framing loses almost everything — the nouns remain, but the claim they were making does not. The **degradation damage** signal measures this per orphan, quantifying how much context destruction the skeleton represents rather than treating all orphans as equally costly.

The combined **total damage** score — deletion damage plus degradation damage — becomes the primary signal for question priority. A claim that would erase ten statements matters more if those statements' twins are poor matches than if they're near-perfect substitutes. Counts alone can't surface that distinction.

There is one more layer. Deletion assumes the twin holds. But not all twins are equally stable. A twin that's an unclassified statement — not owned by any claim — is in the survival pool by definition; that deletion is unconditional. A twin that belongs to another claim with multiple parents is safe under the current prune but contingent on future decisions. A twin that's exclusive to its host claim is fragile: if the host claim is pruned in any later decision, the twin disappears and what was logged as a removal becomes an irrecoverable loss. The risk vector tracks this **deletion certainty** decomposition across all three grades. A claim whose deletion statements are backed by fragile twins is structurally more precarious than its deletion count alone suggests — the risk is deferred, not absent.

These axes stay decomposed rather than collapsing into a score. Different parts of the system need different signals. Structural routing reads total damage to identify which non-consensus claims deserve a user question — that's where the user's attention does the most work. Cascade fragility surfaces where compounding risk lives. The synthesizer's reconstruction burden shows up in degradation. Keeping the axes separate keeps the policy question visible and auditable, rather than dissolved inside a formula.

---


## Stage 5: The Collapse

The system has mapped the terrain. It has not reduced it. Every branch is live. Every redundancy is present. The map is maximally informative precisely because it hasn't collapsed.

The user collapses it — but only where the geometry identifies a structural reason to ask.

### Structural Routing

Before any LLM generates questions, the geometry classifies claims into three categories. This classification is the gate — it determines *whether* a question is asked, not what the question says.

**Conflict clusters.** Claims connected by validated conflict edges. The candidate set is the mapper's conflict edges — only pairs the mapper labeled as conflicting are eligible for validation. Each is tested geometrically via **cross-pool proximity**: for every statement exclusive to claim A (not in B's canonical set), find the maximum cosine similarity to any statement in B's full canonical pool, and average to get meanA→B. Repeat in the other direction for meanB→A. The pair's cross-pool proximity is min(meanA→B, meanB→A) — the weaker directional reach, ensuring both sides' unique evidence genuinely intrudes into the other's territory. A mapper-labeled conflict is validated when this proximity exceeds the mean across all mapper-conflict pair proximities. Connected components of validated edges form clusters. Each cluster is a fork: the user's situation determines which branch applies.

**Damage outliers.** Non-consensus claims (supported by half the models or fewer) not already in a conflict cluster, whose structural damage — measured by the risk vector's totalDamage — exceeds the field's μ+σ. TotalDamage captures not just how many statements would break on prune, but how lossy the surviving twins are and how much context skeletonization destroys. This catches sole-source golden threads, minority positions with irreplaceable evidence, and any claim whose removal would disproportionately degrade the corpus. Consensus claims are never outliers — their evidence is well-distributed and survives pruning without intervention. Worth protecting, but must check for unsurfaced preconditions.

**Passthrough.** Everything else — consensus claims and non-consensus claims below the damage threshold — passes through without touching the survey mapper. Silence is architectural, not prompt-engineered.

If no conflicts validate and no damage outliers are detected, the survey is skipped entirely. No LLM call is made.

### Routed Prompts

The survey mapper receives only the routed claims — those in validated conflict clusters or identified as damage outliers. Each gets a targeted task matched to its structural category, not an open-ended landscape to evaluate.

**Fork articulation** — for conflict clusters. The geometry has already confirmed these claims occupy genuinely different positions. The mapper's job is narrow: translate the geometrically-confirmed tension into a single natural-language yes/no question that distinguishes the branches for this user. It asks about the observable real-world condition that makes one branch applicable and the other inapplicable.

**Misleadingness test** — for damage outliers. The mapper runs a two-sentence filter: (1) "This claim would mislead the user if they [describe wasted action] because it silently requires that they [state condition]." (2) "The user can verify this with: '[yes/no question]?''' If sentence 1 cannot be written truthfully from what the claim actually says, the claim passes without a gate. This tests for false affordances — the illusion of a door where there's a wall.

The completion trap — the LLM's pathological need to generate a question for every claim it sees — is broken by design. The LLM never sees "assess all claims." It sees one pre-selected structural feature and writes one targeted response. Most claims never reach the LLM at all.

Each binary answer is one bit of user information entering the system. Each bit does maximal work because the forcing points are selected where the geometry identified genuine structural consequence. The user doesn't need to understand the geometry. They answer questions about their reality — things they can answer from direct observation in under five seconds — and the space contracts around their answers.

---

## Stage 6: The Defense

When a claim is pruned — the user decided it doesn't apply — the blast surface's risk vector becomes operational. The three types of evidence it measured now have three fates. The system's default is still survival. Removal still requires proof.

**Survival pool.** Any statement with at least one surviving parent claim is protected. It stays as full text. The multi-assignment that provenance reconstruction produces isn't redundancy — it's the primary protection mechanism. The more parents a statement has, the harder it is to strand.

**Stranded, but twinned.** Statements whose only parent was the pruned claim become removal candidates — but only if the geometry can prove the idea has a living carrier. The system must locate a semantic twin in the surviving evidence: a statement that demonstrably carries the same content. When the twin exists and survives, the original is removed. This is the conservation law applied as a gate: **the last instance of an idea cannot be removed from the system.** Removal is only possible when the last instance is demonstrably not the last instance.

**Stranded, orphaned.** True orphans — statements with no surviving parent and no twin anywhere in the surviving corpus — are not removed. They are **skeletonized**: stripped to their irreducible informational content.

### The Mechanism of Skeletonization

The principle: named entities and quantities are tokens — specific, unrepeatable referents that cannot be derived from context. "Henry," "$47M," "Shanghai" carry information that would be lost if removed. Relational words — "sold," "reported," "increased" — are types that the surrounding claim structure can reconstruct. Skeletonization preserves what's irreplaceable and discards what's derivable.

### The Adversarial Function of Skeletons

Skeletons are not degraded evidence waiting to be reconstructed. They are **entity-rich fragments deliberately released into the surviving corpus without their original relational framing.**

The user rejected a claim — a specific argumentative structure. They did not reject the entities that claim referenced. If those entities genuinely constrain the solution space, they will reassert themselves during synthesis, potentially in a novel recombination the mapper never identified. If they don't matter, the synthesizer ignores them as incoherent fragments.

This is the system's immune response to premature closure. The user can reject any argument. They cannot eject the nouns, because nouns are references to things that exist independent of the argument that introduced them. The skeletons ensure the user is held accountable to their own rejected evidence — stripped of everything except the parts that can't be argued away.

---

## Stage 7: The Synthesis

The synthesizer receives the final corpus **blind**. It does not know what was pruned. It does not know which statements are skeletons of rejected claims and which are first-class evidence. It reads everything it's given — the full surviving statements, the skeletal fragments, all of it — and produces the most honest output the information supports.

The synthesis is not tailored to the user's choices. It is the precise answer that the surviving information demands. If a skeleton's entities raise a genuine problem for the solution space, the synthesizer will surface it — not because it knows the user rejected something, but because the entities are present and the problem is real. The system gives the user what the information requires, not what their preferences indicate they want.

---

## The Channel

The complete information flow:

One sentence of user intent → fanned to N models → hundreds of independent statements → embedded into a measured geometric landscape → mapped into claims with provenance reconstructed geometrically → risk vector measured per claim → claims routed by geometry into conflicts, damage outliers, or passthrough → targeted questions generated only for structurally flagged claims → user collapses the space through binary decisions → stranded evidence triaged by fate: protected, removed, or skeletonized, never discarded without proof → synthesizer reads the surviving corpus blind → output reflects what the user's reality forces to be true.

The pipeline is the codec, not the codebook. The corpus didn't exist before the user asked. The landscape is measured in real time. What's pre-built is the measurement apparatus — the sequence of distributional methods, competitive assignments, global-floor filtering, twin detection gates, and skeletonization rules that extract structural truth from noisy measurement. That apparatus works on any corpus the same way Shannon's error-correcting codes work on any message: not by knowing the content, but by knowing the structure of the noise.

The distributional methods — μ+σ thresholds, competitive assignment, the μ_global floor — treat the embedding model as a noisy instrument and extract signal that the noise obscures but doesn't destroy. Standard semantic search uses absolute values: is 0.62 a good score? Singularity uses relative structure: is 0.62 notable for *this* statement against *this* field? The noise shifts all scores together. The relative structure survives. This is why a compact embedding model produces usable results through the pipeline and unreliable results through standard retrieval — same instrument, different signal processing.

The system degrades gracefully where standard approaches degrade catastrophically. And it answers questions — specificity, competitive ownership, irreplaceability, structural cost — that standard retrieval doesn't ask at any model quality.

---

## What It Is

Singularity is not a search engine. It doesn't find the best existing answer. It's not a summarizer. It doesn't compress multiple answers into one. It's not a chatbot. It doesn't converse.

It is a constraint resolution engine. It takes the full landscape of what multiple models independently believe, measures that landscape geometrically, asks the user the minimum set of questions whose answers eliminate what doesn't apply, and delivers the synthesis that the surviving evidence demands — including evidence the user tried to reject, if that evidence is genuinely load-bearing.

The system's deepest commitment: the user's attention is finite, and the bottleneck of synthesis has always been overload against that finite attention. You either average away — mixing signal with noise — or you miss signal entirely. Both reduce available useful information. Singularity's answer is structural: give the user the full text they need, skeletons of what they rejected, and nothing else. The fifty statements that matter arrive as full text. The hundred and fifty fragments from pruned branches arrive as entity-only skeletons — present if the synthesizer needs them, invisible if it doesn't. The user's attention goes to what their reality requires. The rest is there, skeletal and watchful, in case reality disagrees with the user's assumptions.

The strongest answer isn't the one that agrees with you. It's the one that survives everything you threw at it.
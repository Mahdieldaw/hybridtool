# Hybrid Pipeline Architecture (Current Implementation)

This document is a high-level, code-grounded walkthrough of the hybrid pipeline, organized into four broad modules. The guiding rule is: **code behavior is the specification.**

---

## 0. Four-Module Mental Model

The pipeline flows through four modules with a clean unidirectional dependency:

text

```
    Batch Responses + User Query
              │
    ┌─────────▼────────┐
    │                   │
    │    EVIDENCE       │   "What was said?"
    │                   │
    │  Shadow + Embed   │   Extract → embed → project paragraphs
    │                   │
    │                   │   OUT: full statement inventory + paragraph
    │                   │        projections + embeddings
    └────────┬──────────┘
             │
    ┌────────▼──────────┐
    │                   │
    │   LANDSCAPE       │   "What does the terrain look like?"
    │                   │
    │  Cluster + Geom   │   HAC clustering → geometric substrate →
    │  + Interpret      │   regions → profiles → shape prior
    │                   │
    │                   │   OUT: substrate + regions + profiles +
    │                   │        shape + geometric hints
    └────────┬──────────┘
             │
    ┌────────▼──────────┐          ┌────────┐
    │                   │   ◄──────│  USER  │
    │   PARTITION       │   ──────►│ANSWERS │
    │                   │          └────────┘
    │  Mapper + Traverse│
    │                   │   Mapper finds claims + traversal graph;
    │                   │   user resolves forcing points
    │                   │
    │                   │   OUT: traversal state (claim statuses)
    └────────┬──────────┘
             │
    ┌────────▼──────────┐
    │                   │
    │   SYNTHESIS       │   "What survives your reality?"
    │                   │
    │  Prune + Concierge│   Dual-regime carving → chewed text →
    │                   │   final answer from surviving evidence
    │                   │
    │                   │   OUT: recommendation grounded in
    │                   │        surviving evidence
    └───────────────────┘
```

### Main Path

The mapper LLM is the single authority for claim identification and traversal question generation. Geometric hints from the Landscape module inform the mapper's context but do not mechanically generate gates or forcing points. The pipeline pauses for user interaction only when the mapper emits a traversal graph with forcing points.

### Auxiliary Calculations

Four supplementary computations exist alongside the main path. They are derived from evidence and landscape data but **do not gate or drive** the main flow. Each is its own cleanly separated object with defined inputs and outputs:

|Auxiliary|What it computes|Where it lives|Relationship to main path|
|---|---|---|---|
|**Query Relevance**|Per-statement cosine similarity to user query; tiered scoring|`queryRelevance.ts`|Ranking/UI filtering signal; available as boost factor for downstream scoring. Does not filter evidence.|
|**Conditional Finder**|Conditional clauses (if/when/unless) extracted from statements; clustered and impact-ranked|`conditionalFinder.ts`, `deriveConditionalGates.ts`|Supplements mapper context; available for enrichment but mapper generates its own conditional forcing points.|
|**Conflict Deriver**|Opposition pairs between regions based on stance conflicts and geometric proximity|`interpretation/opposition.ts`|Supplements mapper context; available for validation but mapper identifies its own conflicts.|
|**Inter-Regional Analysis**|Signals between region pairs (conflict/support/tradeoff/independent) + region profiles|`interpretation/profiles.ts`, `interpretation/guidance.ts`|Supplements mapper context; powers UI visualization; available for structural validation.|

These calculations can be consumed by the main path (e.g., the mapper can see geometric hints that include opposition data) but they do not **replace** the mapper's claim-finding and question-generation responsibilities. There are no mechanical gates.

---

## 1. Evidence Module

**"Turn raw text into addressable, embedded evidence."**

The Evidence module is the purely mechanical layer that turns raw provider text into addressable evidence units (shadow statements), reassembles those evidence units into paragraph objects (shadow paragraphs), and produces numeric representations (embeddings) for downstream geometry and semantic mapping.

---

### 1.1 Shadow Extraction

Primary implementations:

- [ShadowExtractor.ts](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)
- [StatementTypes.ts](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)
- [ExclusionRules.ts](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)
- [ShadowParagraphProjector.ts](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)
- [shadow/index.ts](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)

#### 1.1.1 Inputs and identity model

The extractor consumes an array of model outputs:

TypeScript

```
extractShadowStatements(responses: Array<{ modelIndex: number; content: string }>)
```

- `modelIndex` is the 1-indexed "source identity" for the producing model in the mapping batch.
- `content` is that model's raw output text.

The extractor assigns stable, local IDs to extracted statements:

- `s_0`, `s_1`, … in extraction order across all provided model outputs.

#### 1.1.2 What a ShadowStatement is (what you can examine)

Each extracted unit is a `ShadowStatement` ([ShadowExtractor.ts](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)):

- `id`: `"s_N"` stable per extraction run
- `modelIndex`: source model identity for provenance
- `text`: the sentence/clause extracted from the model output
- `stance`: 1 of 6 stance classes (see §1.1.6)
- `confidence`: numeric score derived from stance-pattern match count (see §1.1.6)
- `signals`: 3 boolean relationship flags (see §1.1.8)
    - `sequence`
    - `tension`
    - `conditional`
- `location`: where it came from in the raw content
    - `paragraphIndex`: which paragraph (0-based) after splitting
    - `sentenceIndex`: which sentence (0-based) within that paragraph after splitting
- `fullParagraph`: the original paragraph text (context / evidence surface)
- `geometricCoordinates?`: optional enrichment field populated later by geometry

In the UI you can surface, filter, and audit statements by:

- stance
- signal flags
- modelIndex
- referenced/unreferenced (computed later via shadow delta)

#### 1.1.3 Paragraph splitting (raw text → paragraphs)

For each model response, the extractor splits the raw text into paragraphs by blank lines:

- `response.content.split(/\n\n+/)`
- trims each paragraph and removes empty paragraphs
- This creates a paragraph index space per model output, used later for:
    - statement location metadata (`location.paragraphIndex`)
    - paragraph reconstruction via `projectParagraphs()` (§1.1.11)

#### 1.1.4 Sentence splitting (paragraph → sentences)

Each paragraph is split into sentences via `splitIntoSentences(paragraph)`:

1. It protects common abbreviations and decimals by temporarily replacing `.` with `|||`:
    - abbreviations: `Mr, Mrs, Ms, Dr, Prof, Inc, Ltd, vs, etc, e.g, i.e` (case-insensitive)
    - decimals / numeric periods: `(\d+)\.`
2. It splits on punctuation boundaries followed by whitespace:
    - `.split(/(?<=[.!?])\s+/)`
3. It restores protected periods and trims/filter empties.

Result: a list of candidate sentences per paragraph, still in original order.

#### 1.1.5 Substantiveness filter (candidate sentence → candidate statement)

Before any stance logic runs, each candidate sentence must pass `isSubstantive(sentence)`:

Hard filters:

- Must have at least 5 words.
- Reject markdown headings: `^#{1,6}\s`
- Reject lines that are just bold/underline wrappers:
    - `^\*{2}[^*]+\*{2}$`
    - `^__[^_]+__$`
- Reject simple table rows:
    - `^\|.*\|$` (with more than 2 `|`)
    - `^[\|\s\-:]+$` (table separators)
- Reject empty bullet items:
    - `^[-*+]\s*$`
    - `^\d+\.\s*$`

Meta-commentary filters (examples of what gets dropped):

- Starts with conversational fillers: `sure`, `okay`, `yes`, `no`, `well`, `so`, `now`
- Starts with "process narration": `let me`, `I'll`, `I will`, `I can`, `I would`
- Starts with summary framing: `here's a summary`, `this is an overview`, etc.
- Contains references like: `as I mentioned`, `as discussed`, `as noted`
- Starts with: `to summarize`, `in summary`, `in conclusion`

Only candidates that pass this filter proceed into stance classification and exclusion filtering.

#### 1.1.6 Stance classification (WHAT the statement is)

Stance is determined by pattern matching in [StatementTypes.ts](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d):

Stances (6):

- `prescriptive`: "do X / ensure Y / recommend Z"
- `cautionary`: "don't do X / risk / warning"
- `prerequisite`: "before / requires / must happen first"
- `dependent`: "after / once / in the next step"
- `assertive`: factual/default state language (copula/verbs)
- `uncertain`: hedges and epistemic uncertainty ("might/may/depends")

Priority order is fixed (structural > action > factual):

TypeScript

```
export const STANCE_PRIORITY = [
  'prerequisite',
  'dependent',
  'cautionary',
  'prescriptive',
  'uncertain',
  'assertive',
];
```

Classification algorithm (`classifyStance(text)`):

- For each stance in `STANCE_PRIORITY`, count how many of that stance's regex patterns match the text.
- If one or more patterns match, compute a priority score via `getStancePriority(stance)`; higher wins.
- The "best" stance is the matching stance with the highest priority.
- If nothing matches, stance defaults to `assertive`.

Confidence:

- Based on number of matched patterns for the chosen stance:
    - 1 match → `0.65`
    - 2 matches → `0.80`
    - 3 matches → `0.95`
- Implemented as: `Math.min(1.0, 0.5 + (matchCount * 0.15))`

This means stance is not "semantic understanding"; it is a deterministic regex-driven label used to:

- support downstream audit/debugging
- seed later clustering/geometry interpretations
- power fast UI filtering

#### 1.1.7 Exclusion rules (disqualify false positives)

After stance classification, extraction applies a second pass: `isExcluded(sentence, stance)` from [ExclusionRules.ts](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d).

Key properties:

- Exclusions are stance-scoped (rules declare `appliesTo: Stance[]`).
- Rules have `severity: 'hard' | 'soft'`.
- Current behavior: only `'hard'` exclusions actually remove candidates; `'soft'` is defined but not implemented as a confidence penalty yet.

Examples of universal hard exclusions:

- Ends with `?` (question, not statement)
- Very short (`^.{0,15}$`)
- Meta-framing ("let me…", "note that…", "keep in mind…", etc.)
- Fully quoted material lines

There are also stance-specific exclusions. Examples:

- Prescriptive:
    - reject epistemic "should be obvious/clear" (not a true prescription)
    - reject prescriptive questions ("should you/we…?")
- Prerequisite:
    - reject narrative "long before / shortly before" (temporal narration)
- Dependent:
    - reject narrative time passage ("after a long time…", "once upon a time…")
- Uncertain:
    - reject rhetorical uncertainty ("who knows", etc.)

Net effect:

- Stance patterns are intentionally broad.
- Exclusion rules carve away common false positives so the output is more evidence-like and less conversational.

#### 1.1.8 Signal detection (WHAT the statement implies)

Signals are orthogonal to stance; they are separate boolean flags computed by `detectSignals(text)` in [StatementTypes.ts](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d).

Signals (3):

- `sequence`: ordering/dependency language (before/after/then/next, etc.)
- `tension`: contrast/tradeoff language (but/however/vs/tradeoff, etc.)
- `conditional`: gating/context language (if/when/unless/assuming, etc.)

Each signal is true if _any_ regex in that signal family matches the text:

TypeScript

```
{
  sequence: SIGNAL_PATTERNS.sequence.some(p => p.test(text)),
  tension: SIGNAL_PATTERNS.tension.some(p => p.test(text)),
  conditional: SIGNAL_PATTERNS.conditional.some(p => p.test(text)),
}
```

These signals are used in multiple places:

- UI filtering/labels (SEQ / TENS / COND)
- Shadow delta ranking (high-signal orphan statements are prioritized)
- Downstream analysis as "mechanical hints" about structure

#### 1.1.9 Extraction limits and early termination

The extractor has hard caps for safety/performance ([ShadowExtractor.ts](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)):

- `SENTENCE_LIMIT = 2000` total sentences processed across all models
- `CANDIDATE_LIMIT = 2000` total extracted statements

Behavior:

- If sentence limit is exceeded, extraction stops early and logs a warning.
- If candidate limit is hit, extraction stops early and logs a warning.

#### 1.1.10 Extraction output metadata

`extractShadowStatements()` returns:

- `statements: ShadowStatement[]`
- `meta`:
    - `totalStatements`
    - `byModel: Record<number, number>`
    - `byStance: Record<Stance, number>`
    - `bySignal: { sequence, tension, conditional }`
    - `processingTimeMs`
    - diagnostics:
        - `candidatesProcessed`
        - `candidatesExcluded`
        - `sentencesProcessed`

This meta is used as a quick health check:

- Did extraction find enough evidence?
- Did one stance dominate unexpectedly?
- Are there many conditionals/sequence signals (suggesting traversal gates)?

#### 1.1.11 Paragraph projection (ShadowStatement[] → ShadowParagraph[])

Paragraph projection reconstructs paragraph-level objects from extracted statements:

- Implementation: [ShadowParagraphProjector.ts](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)
- Entry point: `projectParagraphs(statements)`

The core idea:

- During statement extraction, each statement carries `location.paragraphIndex` and `modelIndex`.
- Projection groups statements by `(modelIndex, paragraphIndex)` and yields one `ShadowParagraph` per group.

**Grouping and ordering**

Grouping key:

- `key = \`stmt.modelIndex:stmt.modelIndex:{paragraphIndex}``

Within each group:

- statements are sorted by:
    1. `sentenceIndex` (from statement location)
    2. original encounter order in the input array
    3. statement id as a final tie-breaker

Paragraphs are emitted in a stable order by sorting keys:

1. `modelIndex` ascending
2. `paragraphIndex` ascending

Paragraph IDs are assigned sequentially in that emitted order:

- `p_0`, `p_1`, …

**Paragraph fields (what you can examine)**

Each `ShadowParagraph` contains:

- identity and provenance:
    - `id: "p_N"`
    - `modelIndex`
    - `paragraphIndex`
    - `statementIds: string[]` (the included `s_*` IDs)
- stance summarization:
    - `dominantStance: Stance`
    - `stanceHints: Stance[]` (which stances appear, ordered by `STANCE_PRIORITY`)
    - `contested: boolean`
    - `confidence: number` (max statement confidence in that paragraph)
- signal aggregation:
    - `signals: { sequence, tension, conditional }` where each is an OR across statements
- surface list (UI-friendly mini statements):
    - `statements: [{ id, text, stance, signals: string[] }]`
    - `text` is clipped to 320 chars for display
    - signal codes are: `SEQ`, `TENS`, `COND`
- `_fullParagraph`: the original paragraph string (taken from the first statement's `fullParagraph`)

**How "contested" is computed**

Contest is intentionally narrow and based on polarity pairs:

TypeScript

```
const contested =
  (stanceSet.has('prescriptive') && stanceSet.has('cautionary')) ||
  (stanceSet.has('assertive') && stanceSet.has('uncertain'));
```

Meaning:

- A paragraph is "contested" if it mixes "do" and "don't", or mixes "is" and "might".
- Prerequisite/dependent mixes do not mark a paragraph contested by themselves.

If contested:

- `dominantStance` is chosen by precedence (`STANCE_PRIORITY`) among the stances present.

If not contested:

- It sums statement confidences per stance and chooses the highest total weight.
- Ties are broken by stance precedence, then lexicographic order.

**Paragraph projection metadata**

`projectParagraphs()` returns:

- `paragraphs: ShadowParagraph[]`
- `meta`:
    - `totalParagraphs`
    - `byModel`
    - `contestedCount`
    - `processingTimeMs`

#### 1.1.12 Guardrail: pattern freezing on import

The shadow module auto-initializes and freezes its pattern definitions on import:

- [shadow/index.ts](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)

It freezes:

- `STANCE_PATTERNS`
- `SIGNAL_PATTERNS`
- `EXCLUSION_RULES`
- plus their nested arrays/objects

This is a runtime guardrail to prevent accidental mutation of extraction behavior after startup.

---

### 1.2 Embedding Generation

Primary sources:

- [embeddings.ts](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)
- [distance.ts](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)
- [config.ts](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)

#### 1.2.1 Why embeddings exist here

Shadow extraction produces discrete evidence primitives:

- `ShadowStatement` = "atomic" stance-bearing claims with signals + confidence
- `ShadowParagraph` = paragraph-shaped bundles of those statements with dominant stance + contested + signals

Clustering/geometry can't operate on those categories directly; it needs a numeric space where:

- "close" means semantically similar
- distances are deterministic enough to be audited and re-run

#### 1.2.2 Embedding runtime model (service-worker → offscreen document)

All embedding inference is delegated to a Chrome Offscreen Document:

- `ensureOffscreen()` checks for an existing OFFSCREEN_DOCUMENT context and creates one if missing.
- embedding requests are sent via `chrome.runtime.sendMessage()` with type `GENERATE_EMBEDDINGS`.
- embedding backend selection (WebGPU vs WASM) is reported by `getEmbeddingStatus()`.

Key behavior: if `chrome.offscreen` is unavailable, embedding generation fails fast with:

- `Error('Chrome offscreen API not available')`

Sources:

- `ensureOffscreen()` and message flow: [embeddings.ts](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)
- status surface: [getEmbeddingStatus](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)

#### 1.2.3 The embedding text contract (what exactly gets embedded)

There is an explicit choice to embed _unclipped statement text_, not UI-clipped paragraph text.

For paragraph embeddings generated from paragraphs:

- build a `statementsById` map from the original `ShadowStatement[]`
- for each paragraph, concatenate the underlying statement texts in `paragraph.statementIds` order
- ignore empty-missing lookups (`''`) and join with spaces

This avoids two common distortions:

- embedding `_fullParagraph` (which may include narrative framing or uninteresting glue)
- embedding `paragraph.statements[].text` (which is clipped for display)

Source: [generateEmbeddings](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d) and [toClusterableItems](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)

#### 1.2.4 Determinism rules for embeddings

Embeddings are made deterministic enough for downstream thresholding via two mechanisms:

1. Truncation (MRL / Matryoshka-style)

- response vectors may be longer than `config.embeddingDimensions`
- truncate to `embeddingDimensions` by slicing the prefix

2. Renormalization after truncation

- vectors are L2-normalized after truncation via `normalizeEmbedding(vec)`
- this is explicitly called out as "critical for determinism"

Source: [normalizeEmbedding + truncation](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)

#### 1.2.5 Two embedding paths (paragraph-direct vs statement→paragraph pooling)

There are two compatible ways to get `Map<paragraphId, Float32Array>`:

**Paragraph-direct embeddings**

`generateEmbeddings(paragraphs, shadowStatements, config)`:

- builds one text per paragraph by concatenating statement texts
- calls offscreen inference once for the paragraph batch
- rehydrates `Float32Array` from JSON-serialized `number[]`
- truncates → renormalizes → stores in `Map<paragraphId, Float32Array>`

Failure behavior:

- if a response entry is missing/malformed: reject with `Missing or malformed embedding for paragraph p_*`

Source: [generateEmbeddings](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)

**Statement embeddings + pooled paragraph embeddings**

This route makes the embedding space more "evidence-shaped" by letting high-signal statements contribute more.

Step A: embed statements

`generateStatementEmbeddings(statements, config)` returns:

- `embeddings: Map<statementId, Float32Array>`
- `dimensions`
- `statementCount`
- `timeMs`

Step B: pool into paragraph vectors

`poolToParagraphEmbeddings(paragraphs, statements, statementEmbeddings, dimensions)`:

- for each paragraph, collect the statement vectors that exist
- compute a weighted mean vector
- normalize the pooled vector

Weights:

- base weight is statement confidence with a floor: `weight = max(0.1, stmt.confidence)`
- signal boosts:
    - `tension` → ×1.3
    - `conditional` → ×1.2
    - `sequence` → ×1.1

If a paragraph has zero embeddable statements:

- it is assigned a zero vector, which stays zero after normalization
- this makes it "geometrically isolated" downstream

Sources:

- [generateStatementEmbeddings](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)
- [poolToParagraphEmbeddings](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)

#### 1.2.6 Similarity and distance (what "close" means)

Everything downstream of embeddings relies on cosine similarity of normalized vectors.

Quantization:

- similarities are quantized to 1e-6 via `quantizeSimilarity(sim)`
- this prevents drift from small backend differences (e.g., GPU variance)

Distance matrix:

- HAC consumes distances where `distance = 1 - similarity`
- missing embeddings are encoded as `Infinity` distances
- warnings are emitted once per missing id

Optional similarity shaping using paragraph meta:

- opposing stances get discounted: (`prescriptive` vs `cautionary`) and (`assertive` vs `uncertain`) → ×0.6
- same stance is mildly boosted → ×1.1
- prerequisite↔dependent is mildly boosted → ×1.05
- cross-model agreement can be boosted when baseSim > 0.55 → ×1.15

Source: [buildDistanceMatrix](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)

### 1.3 Evidence Module Output Contract

The Evidence module produces the complete inventory that all downstream modules consume:

TypeScript

```
// What the Evidence module delivers
{
  statements: ShadowStatement[];           // ALL — nothing filtered
  paragraphs: ShadowParagraph[];           // ALL — nothing filtered
  embeddings: {
    statements: Map<string, Float32Array>; // per-statement vectors
    paragraphs: Map<string, Float32Array>; // per-paragraph vectors (pooled or direct)
  };
  meta: {
    extraction: ExtractionMeta;            // statement/paragraph counts, diagnostics
    embedding: EmbeddingMeta;              // dimensions, timing, backend
  };
}
```

No "condensed" / "parked" distinction. One inventory, fully embedded.

---

## 2. Landscape Module

**"Measure the terrain — cluster, regionize, interpret."**

This module takes the embedded evidence from Module 1 and produces:

- paragraph clusters (HAC) for compression and "what belongs together"
- a geometric substrate (kNN / mutual / strong graphs, topology, shape prior)
- an interpretation layer (regions, profiles, oppositions, mapper hints)

---

### 2.1 Clustering (HAC)

Primary sources:

- [hac.ts](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)
- [engine.ts](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)
- [types.ts](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)

#### 2.1.1 HAC clustering (cluster count is emergent)

Clustering is hierarchical agglomerative clustering (average linkage) with a threshold stop:

- start with each paragraph as its own cluster
- repeatedly merge the closest pair (lowest average inter-cluster distance)
- stop when the best available merge exceeds the threshold

Thresholding:

- `distanceThreshold = 1 - config.similarityThreshold`
- default threshold is `similarityThreshold = 0.72` ([DEFAULT_CONFIG](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d))

Determinism:

- candidate cluster pairs are evaluated in stable order
- ties break by lower index pair

Safety cap behavior:

- `maxClusters` is a warning/sanity signal only; it does not force merges
- if data is fragmented at the chosen threshold, the output stays fragmented

Optional geometry-aware bias (mutual kNN graph):

- if any paragraph pair across two clusters has a mutual-kNN edge, the inter-cluster distance is reduced by ×0.9
- this makes "mutual neighbor backbone" act as a prior for merges

Source: [hierarchicalCluster](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)

#### 2.1.2 Cluster materialization (centroid, cohesion, uncertainty, expansion)

`buildClusters(paragraphs, shadowStatements, embeddings, config, mutualGraph?)` produces `ParagraphCluster[]`.

Edge cases:

- if too few paragraphs (`< minParagraphsForClustering`) → all singleton clusters, cohesion=1
- if embeddings map is empty → all singleton clusters (clustering skipped)

Centroid selection:

- compute mean embedding of members (average of vectors, then normalize)
- pick the member paragraph closest to that mean (cosine sim), quantized
- ties break lexicographically by paragraph id

Quality metrics:

- `cohesion`: average similarity to centroid (excluding centroid itself)
- `pairwiseCohesion`: average similarity over all member pairs

Uncertainty detection (deterministic order of checks):

- `low_cohesion`: cohesion < `lowCohesionThreshold`
- `dumbbell_cluster`: size≥4, cohesion high but pairwise low, with a ≥0.10 gap
- `oversized`: size > `maxClusterSize`
- `stance_diversity`: unique dominant stances ≥ `stanceDiversityThreshold`
- `high_contested_ratio`: contested paragraphs ratio > `contestedRatioThreshold`
- `conflicting_signals`: both `tension` and `conditional` appear in the cluster

Expansion payload (only when uncertain):

- selects centroid + the most distant members from centroid
- uses raw `_fullParagraph` (not statement text) and clips to `maxMemberTextChars`
- respects `maxExpansionMembers` and a total char budget `maxExpansionCharsTotal`

Sources:

- [buildClusters](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)
- [detectUncertainty](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)
- [buildExpansion](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)

#### 2.1.3 Clustering output contract

`ClusteringResult`:

- `clusters`: sorted with uncertain clusters first, then by size descending, then re-numbered `pc_0...`
- `meta`: counts, compression ratio, and timing fields

Source: [types.ts](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d) and [buildClusters meta](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)

---

### 2.2 Geometric Substrate

Primary sources:

- [types.ts](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)
- [substrate.ts](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)
- [knn.ts](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)
- [threshold.ts](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)
- [topology.ts](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)
- [shape.ts](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)
- [layout.ts](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)
- [nodes.ts](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)

#### 2.2.1 The substrate contract (what gets built)

`GeometricSubstrate` (high-level):

- `nodes: NodeLocalStats[]` (one entry per paragraph `p_*`)
- `graphs`:
    - `knn`: symmetric union of top-K neighbor edges
    - `mutual`: edges that are mutual top-K (precision backbone)
    - `strong`: mutual edges filtered by a soft threshold (for components/topology)
- `topology`: components + global metrics computed on `strong`
- `shape`: a coarse classification + recommendations
- `layout2d?`: a deterministic 2D UMAP projection (when possible)
- `meta`: similarity stats, edge counts, determinism proof, timings

Source: [GeometricSubstrate](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)

#### 2.2.2 Determinism rules in geometry

Geometry makes determinism explicit and repeated:

- similarities are quantized to 1e-6 (`quantize()` in kNN builder)
- tie-breaking between equal similarities is lexicographic by target ID
- component ids are assigned after deterministic sorting
- UMAP uses a seeded PRNG (`seed=42` by default) and outputs are rescaled to [-1, 1]

Sources:

- quantization + stable tie-break: [knn.ts](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)
- component ordering + renumber: [topology.ts](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)
- seeded UMAP: [layout.ts](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)

#### 2.2.3 Two-graph build (kNN field + mutual backbone)

`buildTwoGraphs(paragraphIds, embeddings, k=5)`:

Step 1: for each node:

- compute cosine similarity to all others (skipping missing embeddings)
- quantize similarities
- sort neighbors by (similarity desc, lex id asc)
- take top-K with ranks 1..K
- record:
    - `top1Sims[node]`
    - `topKSims[node]` (array of K similarities)

Step 2: build kNN graph by symmetric union:

- if A→B exists, include B→A as well (even if B didn't choose A)
- edges are canonicalized and stored with adjacency in both directions

Step 3: build mutual kNN graph:

- include an edge only if A is in B's top-K and B is in A's top-K
- rank is `min(rankInA, rankInB)` to be symmetric

Source: [buildTwoGraphs](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)

#### 2.2.4 Soft threshold and strong graph

The "strong graph" is not a clustering merge; it is a _structural cutoff_ applied to the mutual backbone.

Compute soft threshold:

- derive a threshold from the distribution of `top1Sims`:
    - method `p80_top1` (default) uses the 80th percentile
    - method `p75_top1` uses the 75th percentile
    - method `fixed` uses `fixedValue` (default 0.65)
- clamp into `[clampMin, clampMax]` (default [0.55, 0.78])
- quantize to 1e-6

Build strong graph:

- filter mutual edges where `edge.similarity >= softThreshold`
- preserve adjacency in both directions

Source: [computeSoftThreshold + buildStrongGraph](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)

#### 2.2.5 Topology (components on the strong graph)

`computeTopology(strong, paragraphIds)`:

- uses union-find to find connected components
- counts internal edges for each component and computes `internalDensity`
- sorts components deterministically by (size desc, lex-min nodeId asc)
- assigns ids `comp_0...` after sorting

Global metrics:

- `largestComponentRatio`
- `isolationRatio` (nodes with zero strong edges / total)
- `globalStrongDensity` (strong edges / max possible edges)

Source: [computeTopology](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)

#### 2.2.6 Shape prior (coarse global classification)

`classifyShape(topology, nodeCount)` converts topology metrics into a coarse prior:

- `fragmented` (high isolation / low density)
- `convergent_core` (one dominant component with decent density)
- `bimodal_fork` (two major components)
- `parallel_components` (several independent tracks)

It produces:

- `prior` and `confidence`
- signal scores: `fragmentationScore` / `bimodalityScore` / `parallelScore`
- "convergent" is not a separate signal score; `convergent_core` is chosen when `largestComponentRatio` is high and `globalStrongDensity` is decent, and its `confidence` is effectively driven by `largestComponentRatio`
- a recommendation surface:
    - expected cluster count range
    - whether to expect conflicts/dissent

Source: [classifyShape](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)

#### 2.2.7 2D projection (UMAP)

`computeUmapLayout(paragraphIds, embeddings, seed=42)`:

- extracts vectors for ids that have embeddings
- if fewer than 2 vectors exist: returns all coordinates at [0, 0]
- runs UMAP with:
    - `nNeighbors = min(15, vectors.length - 1)`
    - `minDist = 0.1`
    - seeded randomness for repeatability
- rescales results to the box [-1, 1] × [-1, 1]
- assigns [0, 0] to any ids missing embeddings

Source: [computeUmapLayout](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)

#### 2.2.8 Per-node local stats (what each paragraph carries forward)

`computeNodeStats(paragraphs, knn, mutual, strong, top1Sims, topKSims)` computes `NodeLocalStats[]`:

- provenance:
    - `paragraphId`, `modelIndex`, `dominantStance`, `contested`, `statementIds`
- similarity stats:
    - `top1Sim` (best neighbor similarity)
    - `avgTopKSim`
- connectivity stats:
    - `knnDegree`, `mutualDegree`, `strongDegree`
- derived:
    - `isolationScore = quantize(1 - top1Sim)`
    - `mutualNeighborhoodPatch = [self + mutual neighbors]` sorted

Source: [computeNodeStats](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)

#### 2.2.9 Degenerate substrates (the pipeline never returns null)

`buildGeometricSubstrate()` guarantees a substrate-shaped return, but may mark it degenerate:

- `insufficient_paragraphs`: fewer than `config.minParagraphs`
- `embedding_failure`: embeddings are null/empty
- `all_embeddings_identical`: all top-K similarities collapse to one value (typically 1.0)

This is error/edge handling for geometry construction, not a "low similarity" mode:

- low similarity still produces a non-degenerate substrate (often sparse/fragmented), and the code emits warnings via similarity stats; degenerate is reserved for cases where embedding inputs are missing/invalid or collapse to a trivial space.

In degenerate mode:

- all graphs are empty
- every node is isolated with `isolationScore=1`
- every paragraph becomes its own component (`comp_*`)

Source: [buildGeometricSubstrate + buildDegenerateSubstrate](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d) and [degenerate builder](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)

---

### 2.3 Pre-Semantic Interpretation

Once the substrate exists, the interpretation layer converts raw geometry into mapper-facing expectations and audit surfaces.

Entry point:

- `buildPreSemanticInterpretation(substrate, paragraphs, clusters?)` in [interpretation/index.ts](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)

It produces a `PreSemanticInterpretation` bundle ([types.ts](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)):

- `lens`: an adaptive "regime" + whether clustering should be used
- `regionization`: a partition of nodes into named regions (`r_*`)
- `regionProfiles`: tiering + purity/geometry summaries per region
- `oppositions`: high-similarity region pairs with stance conflict signals
- `hints`: mapper guidance (expected claim count, conflicts, dissent, attention regions)

This is where "sparse / convergent / forked / parallel" semantics become explicit for downstream prompts:

- substrate prior uses `fragmented / convergent_core / bimodal_fork / parallel_components` ([shape.ts](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d))
- mapper-facing shape uses `sparse / convergent / forked / parallel` via a mapping step ([guidance.ts](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d))

#### 2.3.1 Adaptive lens (regime + clustering decision)

`deriveLens(substrate)` ([lens.ts](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)) converts substrate topology + similarity stats into an `AdaptiveLens`:

- `regime`: directly mapped from `substrate.shape.prior`
- `hardMergeThreshold`: `clamp(p95 - 0.03, 0.65, 0.85)` (a suggested strict threshold for merges/claims)
- `shouldRunClustering`: true only if geometry looks structurally meaningful:
    - `globalStrongDensity >= 0.1`
    - `isolationRatio < 0.7`
    - `nodeCount >= 3`
    - `shape.confidence >= 0.35`
- `confidence`: `clamp(0.35 + 0.6 * shape.confidence, 0.35, 0.95)`
- `evidence[]`: string breadcrumbs (prior/confidence/density/isolation/p95, plus skip reason if clustering is skipped)

Important: this lens is not building graphs; it's deciding how much we should trust the geometry, and whether cluster-based region naming is appropriate.

#### 2.3.2 Regionization (naming regions as r_*)

`buildRegions(substrate, paragraphs, lens, clusters?)` ([regions.ts](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)) builds a set of `Region` objects:

- `Region.kind` is one of:
    - `cluster`: derived from paragraph clusters
    - `component`: derived from strong-graph components for uncovered nodes
    - `patch`: derived from each node's mutual-neighborhood "patch" for still-uncovered nodes
- each region has:
    - `nodeIds: string[]` paragraph ids
    - `statementIds: string[]` provenance union (stable order, no duplicates)
    - `modelIndices: number[]` unique sorted indices present in the region
    - `sourceId`: the original cluster/component/patch identity for traceability

Construction order (and why it matters):

1. **Cluster regions** (only if `lens.shouldRunClustering` and there are usable clusters)
    - usable cluster = `paragraphIds.length >= 2`
    - each multi-member cluster becomes a region
2. **Component regions** (fallback coverage)
    - for each strong component, take uncovered nodes within that component
    - only emits a component region if uncovered set has size ≥ 2
3. **Patch regions** (last resort to avoid leaving nodes ungrouped)
    - remaining uncovered nodes are grouped by identical `mutualNeighborhoodPatch` signatures

Finally:

- regions are sorted deterministically (kind order cluster→component→patch, then size desc) and renumbered `r_0..r_n`
- `RegionizationResult.meta` records `kindCounts` and whether fallback was used:
    - `fallbackUsed = kindCounts.cluster === 0`
    - `fallbackReason = clustering_skipped_by_lens | no_multi_member_clusters`

#### 2.3.3 Region profiling (peak / hill / floor)

`profileRegions(regions, substrate, paragraphs)` ([profiles.ts](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)) produces a `RegionProfile` per region with three major blocks:

Mass:

- `nodeCount`
- `modelDiversity` (unique `modelIndex` values in the region)
- `modelDiversityRatio` relative to observed model count across the whole substrate

Purity (stance + contestation):

- per-node stance counts from `NodeLocalStats.dominantStance`
- `dominantStance`, `stanceUnanimity`, `contestedRatio`, `stanceVariety`

Geometry:

- `internalDensity`: computed from strong edges internal to the region (edges/maxPossible)
- `avgInternalSimilarity`: average similarity of internal edges (prefers strong edges, falls back to mutual edges)
- `isolation`: mean node `isolationScore` inside the region

Tier assignment:

- thresholds are deterministic and depend on:
    - model diversity (absolute and ratio)
    - internal density
- tiers:
    - `peak` = high cross-model coverage and dense enough internally
    - `hill` = moderate cross-model coverage and moderate density
    - `floor` = everything else

The profile also produces a coarse prediction surface:

- `predicted.likelyClaims` is a heuristic: contested-heavy or stance-diverse regions tend to imply more than one claim.

#### 2.3.4 Mapper geometric hints (expected claim counts, dissent, attention)

`buildMapperGeometricHints(substrate, regions, profiles, oppositions)` ([guidance.ts](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)) converts region profiles into a mapper-facing expectation surface:

Predicted shape:

- maps `substrate.shape.prior` → `PrimaryShape`:
    - `fragmented` → `sparse`
    - `convergent_core` → `convergent`
    - `bimodal_fork` → `forked`
    - `parallel_components` → `parallel`
- carries `confidence = substrate.shape.confidence` and evidence strings (counts of peaks/hills, oppositions, high isolation)

Expected claim count:

- min = `max(1, peaks.length)`
- max = `peaks.length + hills.length + contestedRegions`

Expected conflicts + dissent:

- `expectedConflicts = ceil(oppositions.length / 2)`
- `expectedDissent` is true when a `hill` region is opposed to a `peak` region (dissent pattern)

Attention regions (what to focus on):

- emits up to 8 `attentionRegions`, prioritized high→medium→low
- reasons are categorical: `stance_inversion`, `semantic_opposition`, `high_isolation`, `uncertain`, `low_cohesion`
- each includes a short `guidance` string intended to steer the semantic mapper

#### 2.3.5 Structural validation (compare geometry expectations to semantic output)

After semantic mapping runs, `validateStructuralMapping(preSemantic, postSemantic)` ([validation.ts](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)) checks fidelity between:

- what geometry "predicted" (`preSemantic.hints`)
- what semantics actually produced (`postSemantic` structural analysis)

It emits a `StructuralValidation` summary with:

- `shapeMatch`, `tierAlignmentScore`, conflict precision/recall, `overallFidelity`
- `violations[]` such as:
    - `shape_mismatch`
    - `claim_count_mismatch` (too few/too many)
    - `missed_conflict` (geometry expected conflicts, semantics created none)
    - `embedding_quality_suspect` (notably: predicted `sparse` but semantic shape is `convergent`)

This is the "truth check" layer that turns geometry into a measurable contract with the mapper.

#### 2.3.6 Coverage + fate tracking (did the mapper use the evidence?)

These utilities live in `src/geometry/interpretation/*` but operate as post-hoc audits using `sourceStatementIds` provenance and statement geometric coordinates.

**Statement fate tracking:**

- `buildStatementFates(statements, claims)` assigns each statement:
    - `primary` / `supporting` if referenced by claim provenance
    - `orphan` if geometrically placed (region/component) but referenced by no claim
    - `noise` if isolated or has no geometric coordinates
- "high-signal orphans" are prioritized by `signalWeight` (conditional>sequence>tension)
- source: [fateTracking.ts](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)

**Unattended region audit:**

- `findUnattendedRegions(substrate, paragraphs, claims, regions, statements)` finds regions with zero claimed paragraphs and tags why they might hide missed claims:
    - stance diversity, high connectivity, bridge regions, isolated noise
- it also reports which existing claims the region "bridges to" via mutual neighbors
- source: [coverageAudit.ts](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)

**Completeness report:**

- `buildCompletenessReport(statementFates, unattendedRegions, statements, totalRegions)` computes statement/region coverage ratios and a verdict:
    - complete if statement coverage > 0.85 AND region coverage > 0.8
    - estimates missed claims from unattended likely-claim regions + high-signal orphans
- source: [completenessReport.ts](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)

### 2.4 Landscape Module Output Contract

The Landscape module produces the geometric and interpretive substrate consumed by the Partition module and UI:

TypeScript

```
// What the Landscape module delivers
{
  substrate: GeometricSubstrate;          // graphs, topology, shape, node stats, layout2d
  clusters: ClusteringResult;             // paragraph clusters with centroids, cohesion, uncertainty
  interpretation: PreSemanticInterpretation; // lens, regions, profiles, oppositions, hints
  meta: {
    clustering: ClusteringMeta;
    substrate: SubstrateMeta;
    interpretation: InterpretationMeta;
  };
}
```

The `interpretation.hints` object is the primary interface to Module 3: it carries the mapper's geometric context (expected claim counts, attention regions, predicted shape, expected conflicts).

---

## 3. Partition Module

**"Find what needs resolution, ask the user."**

The mapper LLM is the single authority for claim identification and traversal question generation. It consumes geometric hints from the Landscape module and the user query, produces claims and a traversal graph, and the traversal engine processes that graph into forcing points for user resolution.

There are no mechanical gates. The mapper's questions are the questions.

---

### 3.1 Semantic Mapping (Mapper Finds Claims)

The mapper is responsible for:

- Identifying semantic positions (claims) across the multi-model evidence
- Producing a traversal graph with forcing points (conditionals and conflicts)
- Generating questions that the user can answer to resolve ambiguity

The mapper receives geometric hints from the Landscape module's `PreSemanticInterpretation.hints`, which provide:

- expected claim count range
- expected shape (sparse / convergent / forked / parallel)
- attention regions with guidance strings
- expected conflicts and dissent signals

These hints inform but do not constrain the mapper. The mapper may identify claims, conflicts, and conditionals that geometry did not predict, and may also decline to create claims where geometry expected them.

### 3.2 Traversal (Mapper-Driven)

Traversal is optional. The pipeline only pauses when the mapper artifact contains traversal _and_ it contains forcing points.

#### 3.2.1 Traversal gating (when the pipeline pauses)

Gate condition (backend):

- `hasTraversal = !!mappingArtifact.traversal.graph`
- `hasForcingPoints = traversal.forcingPoints.length > 0`
- if both are true and this is not a continuation run, the pipeline stops with `awaiting_traversal`
- source: [orchestrateSingularityPhase](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)

When paused, the handler:

- writes `pipelineStatus='awaiting_traversal'` to the AI turn in storage
- posts `MAPPER_ARTIFACT_READY` and a `TURN_FINALIZED` update so the UI can render traversal immediately
- source: [CognitivePipelineHandler.js](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)

No conflict, no traversal:

- if there are no forcing points (or no traversal graph), the pipeline does **not** pause; Singularity runs automatically.

#### 3.2.2 Traversal engine (forcing points → user decisions → claim pruning)

The traversal engine is a "single source of truth" reducer over `TraversalState`:

- it extracts forcing points from a `TraversalGraph`
- it stores resolutions
- it mutates claim statuses (`active` vs `pruned`)
- it provides "live" forcing points based on remaining active claims and gate ordering
- source: [traversalEngine.ts](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)

**Normalization (survives evolving mapper shapes)**

The graph is normalized so traversal stays robust as the mapper schema changes:

- claims are normalized from `graph.claims[]` into `{ id, label, text?, sourceStatementIds? }`
- conflicts are normalized either from explicit `graph.edges[]` or reconstructed from:
    - `graph.tensions[]` (preferred; also carries `blockedByGates`)
    - per-claim `claim.conflicts[]` (legacy)
- conditionals are normalized from either:
    - `graph.conditionals[]` (if it already has `affectedClaims`)
    - or `graph.tiers[].gates[]` where `gate.type==='conditional'` and `gate.blockedClaims` exist
- dedup rules:
    - conditional definitions merge by `id` and union `affectedClaims`
    - conflicts dedupe per unordered pair `a::b`
- sources: [normalizeClaims](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d), [normalizeConditionals](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d), [normalizeEdges](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)

**Forcing point extraction (what gets asked)**

`extractForcingPoints(graph)` emits two forcing point types ([traversalEngine.ts](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)):

Tier 0: conditionals (pruners)

- each conditional produces a forcing point:
    - `question`: the user-facing prompt (fallbacks to "Is this applicable to your situation?" if placeholder)
    - `condition`: a concise summary used in the path log
    - `affectedClaims[]`: claim ids to prune if the conditional is not satisfied
- `sourceStatementIds` are derived by unioning `sourceStatementIds` across all affected claims, so the conditional is traceable to evidence provenance

Tier 1+: conflicts (crucibles)

- conflicts are emitted per conflict edge between two claims
- each conflict forcing point has:
    - `question`: edge question if provided, else `Choose between: A vs B`
    - `options`: two options with `claimId`, `label`, `text`
    - `blockedByGateIds[]`: optional gating; conflicts don't become "live" until required gates are satisfied
- conflict provenance unions:
    - `sourceStatementIds` from both claims
    - plus any `edge.sourceStatementIds` when present

**State transitions (what pruning actually means)**

TraversalState is small and intentionally stable:

- `claimStatuses: Map<claimId, 'active'|'pruned'>`
- `resolutions: Map<forcingPointId, Resolution>`
- `pathSteps: string[]` (human-readable audit trail)
- `conditionalGateAnswers?: Record<string, 'yes'|'no'|'unsure'>` (optional; gate-level answers driving a parallel pruning channel in skeletonization — distinct from `claimStatuses` but same end effect)
- source: [TraversalState](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)

Conditional resolution:

- `resolveConditional(state, fpId, fp, satisfied, userInput?)` records a resolution
- if `satisfied === false`: it sets all `affectedClaims` to `pruned`
- it appends a path step either as a ✓ (kept) or ✗ (pruned) entry
- source: [resolveConditional](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)

Conflict resolution:

- `resolveConflict(state, fpId, fp, selectedClaimId, selectedLabel)` records a resolution
- it prunes the _rejected_ option(s) in that forcing point
- it appends a path step like `→ Chose "X" over "Y"`
- source: [resolveConflict](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)

Live forcing point logic (interaction ordering):

- unresolved conditionals are always surfaced first
- conflicts only become live when:
    - there are no live conditionals remaining
    - all `blockedByGateIds` are satisfied (if present)
    - there are still at least 2 active options remaining (pruning may collapse a conflict)
- source: [getLiveForcingPoints](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)

#### 3.2.3 Traversal UI (asking questions and persisting decisions)

The traversal UI is a thin wrapper around the traversal engine.

Hook:

- `useTraversal(graph, claims, initialStateOverride?)`:
    - computes forcing points from the graph
    - initializes `TraversalState` from the claim list
    - exposes `resolveGate` (conditional) and `resolveForcingPoint` (conflict)
    - exposes `liveForcingPoints`, `isComplete`, `activeClaims`, and a text `pathSummary`
- source: [useTraversal.ts](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)

View orchestration:

- the "Traverse" view is shown when:
    - the AI turn is `pipelineStatus === 'awaiting_traversal'`
    - a traversal graph exists in the mapping artifact
    - the UI has a `sessionId`
- the "Response" view is shown when:
    - the pipeline is complete and a Singularity output exists (or is loading/error)
- source: [CognitiveOutputRenderer](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)

TraversalGraphView responsibilities:

- de-corrupts certain graph fields (defensive: if `graph.claims` or `graph.conditionals` are string arrays, it falls back to canonical `claims`/`conditionals` passed as props)
- hydrates prior traversal state either from:
    - `aiTurn.singularity.traversalState` (completed state from backend), or
    - local persisted jotai state `traversalStateByTurnAtom`
- persists traversal progress locally:
    - serializes `Map` values as arrays of entries for storage in jotai
- source: [TraversalGraphView](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)

Forcing point cards:

- conditionals are rendered as a yes/no gate with optional "your context" text
- conflicts are rendered as an exclusive choice between two options with a confirm step
- source: [TraversalForcingPointCard](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)

#### 3.2.4 Continuation handoff (sending decisions back to the pipeline)

Once all live forcing points are resolved (`isComplete === true`), the UI can continue the pipeline.

Submission payload:

- message type: `CONTINUE_COGNITIVE_WORKFLOW`
- includes:
    - `sessionId`, `aiTurnId`, and the original user query as `userMessage`
    - `providerId` (selected Singularity provider)
    - `isTraversalContinuation: true`
    - `traversalState.claimStatuses` as a plain object (from the `Map`)
- source: [handleSubmitToConcierge](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)

Reliability mechanics:

- waits for an ACK (`CONTINUATION_ACK`) and monitors workflow updates
- retries up to 3 times (port disconnect and no-ACK are "retry immediately")
- source: [TraversalGraphView](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)

### 3.3 Structural Analysis (Post-Mapper)

Structural analysis is a post-mapper summarization pass that turns the mapper's semantic graph (claims + edges) into:

- per-claim derived metrics and flags ("leverage" fields)
- a small set of detected tension patterns (conflicts, tradeoffs)
- a coarse `ProblemStructure` shape label with evidence strings

Implementation entry:

- `computeStructuralAnalysis(artifact)` in [structural-analysis/engine.ts](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)
- re-exported from [PromptMethods.ts](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)

UI usage:

- `CognitiveOutputRenderer` computes structural analysis from the mapping artifact to drive the MetricsRibbon/StructureGlyph layer
- source: [CognitiveOutputRenderer.tsx](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)

#### 3.3.1 Inputs and outputs

Input:

- `CognitiveArtifact` (specifically `artifact.semantic.claims[]` and `artifact.semantic.edges[]`)
- types: [StructuralAnalysis](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d), [ProblemStructure](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)

Output: `StructuralAnalysis`:

- `landscape`: global distribution metrics (types/roles/modelCount/convergenceRatio)
- `claimsWithLeverage`: claims enriched with ratios + flags (`supportRatio`, degrees, isHighSupport, isContested, isConditional, isChallenger, isIsolated)
- `patterns`: normalized pair lists of `conflicts[]` and `tradeoffs[]`
- `shape`: `{ primary, confidence, evidence[] }` as a coarse structure label

#### 3.3.2 Landscape metrics (global summary)

`computeLandscapeMetrics(artifact)` computes:

- `typeDistribution` and `dominantType` from claim `type`
- `roleDistribution` and `dominantRole` from claim `role` (note: roles may later be overridden by derived roles)
- `modelCount`:
    - prefers `artifact.meta.modelCount` when present
    - else derives from the union of numeric `claim.supporters[]` indices
- `convergenceRatio`:
    - defines the "top support level" as the support size of the top 30% claim (by supporters count)
    - convergence ratio = fraction of claims at or above that level
- source: [structural-analysis/metrics.ts](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)

#### 3.3.3 Derived roles (computed, schema-stable heuristics)

Before adding flags, the engine rewrites claim `role` (and `challenges`) using only stable graph signals:

- consensus set = claims with `supporterCount / modelCount >= 0.5`
- challenger:
    - if there is a `conflicts` edge between a consensus claim and a non-consensus claim
    - the non-consensus claim becomes `role='challenger'` and `challenges=<consensusClaimId>`
- branch:
    - any claim id that appears in `semantic.conditionals[].affectedClaims`
- anchor:
    - any claim with >= 2 outgoing `supports` edges
- else supplement
- source: [applyComputedRoles](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)

This keeps the "structural story" stable even if upstream role labels change, because it recomputes roles from supporters, conditionals, and edge types.

#### 3.3.4 Claim ratios + leverage flags

Ratios:

- `computeClaimRatios(claim, edges, modelCount)` adds:
    - `supportRatio = supporters.length / modelCount`
    - `inDegree` / `outDegree` from raw `edges`
- source: [computeClaimRatios](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)

Top-claim cutoff:

- `topClaimIds` = top 30% of claims by `supportRatio` (at least 1 claim)
- source: [getTopNCount](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d) and selection logic in [engine.ts](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)

Flags:

- `assignPercentileFlags` sets:
    - `isHighSupport`: in `topClaimIds`
    - `isContested`: participates in any `conflicts` edge
    - `isConditional`: `claim.type === 'conditional'`
    - `isChallenger`: `claim.role === 'challenger'` (derived role)
    - `isIsolated`: claim id not present in any edge endpoint
- source: [assignPercentileFlags](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)

#### 3.3.5 Pattern extraction (conflicts and tradeoffs)

The engine builds pair lists directly from semantic edges:

- only `e.type === 'conflicts'` and `e.type === 'tradeoff'` are considered
- pairs are deduped by unordered key `min(a,b)|max(a,b)|type`

Conflict pair payload:

- `isBothConsensus`: both endpoints are in `topClaimIds`
- `dynamics`: `symmetric` vs `asymmetric` based on support ratio gap (< 0.15)
- source: [determineTensionDynamics](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d) and conflict build loop in [engine.ts](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)

Tradeoff pair payload:

- `symmetry`: `both_consensus | both_singular | asymmetric` based on whether endpoints are in `topClaimIds`
- source: [engine.ts](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)

#### 3.3.6 Shape classification (ProblemStructure.primary)

The current shape classifier is intentionally simple and deterministic.

Step 1: component counting

- build connected components over claim ids using all edges (treating the graph as undirected)
- source: [buildConnectedComponents](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)

Step 2: classify `primary`

- inputs: claimCount, edgeCount, componentCount, conflictCount, tradeoffCount, `landscape.convergenceRatio`
- current rules:
    - `sparse` when claimCount < 3 or edgeCount < 2
    - `parallel` when components >= 3
    - when components == 2: `forked` if any conflicts else `parallel`
    - `constrained` when tradeoffs exist and tradeoffs >= conflicts
    - `forked` when conflicts exist
    - `convergent` when convergenceRatio >= 0.25
    - else `sparse`
- output also carries `confidence` and `evidence[]` strings
- source: [classifyShape](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)

---

## 4. Synthesis Module

**"Carve the evidence and write the answer."**

The Synthesis module takes the traversal decisions from Module 3 and applies them to the evidence substrate, producing a pruned "chewed" version of the multi-model outputs that is then sent to the concierge LLM for final synthesis.

---

### 4.1 Skeletonization (Pruning the Evidence Substrate)

The traversal decision does not "delete claims". It drives _evidence pruning_ across the batch outputs. This is what lets Concierge synthesize only the parts of the multi-model substrate consistent with the user's choices.

Entry:

- `buildChewedSubstrate(input)` in [skeletonization/index.ts](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)

Short-circuit:

- if `prunedCount === 0`, the system returns a passthrough substrate (no evidence changes)
- source: [buildChewedSubstrate](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)

Inputs (key idea):

- `statements[]` + `paragraphs[]` are the shared "shadow" substrate extracted from batch outputs
- `claims[]` are the semantic positions from the mapper (their schema can evolve; only `id` and `sourceStatementIds` matter here)
- `traversalState.claimStatuses` tells what was pruned
- `sourceData[]` is the raw per-provider batch text, plus stable `modelIndex` alignment
- source: [SkeletonizationInput](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d), [getSourceData](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)

#### 4.1.1 Statement triage (PROTECTED / SKELETONIZE / REMOVE)

`triageStatements(input)` decides what to preserve vs chew ([TriageEngine.ts](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)):

1. Split claims by traversal decision:

- surviving if `claimStatuses.get(claim.id) !== 'pruned'`
- pruned if `=== 'pruned'`

2. Protect everything referenced by surviving claims:

- `protectedStatementIds = union(survivingClaims[].sourceStatementIds)`

3. For each pruned claim, process its source statements:

- if that statement is protected already, it is skipped (surviving claims win)
- else determine whether it's safe to remove or should be skeletonized:
    - run carrier detection to see if other statements carry the same semantic load

Carrier detection:

- `detectCarriers(prunedClaim, sourceStatementId, …)` scans _other unprotected statements_ and scores them against:
    - similarity to the pruned claim embedding
    - similarity to the pruned claim's source statement embedding
- if any candidates pass thresholds (default 0.6/0.6):
    - source becomes `REMOVE`
    - carriers become `SKELETONIZE`
- else:
    - source becomes `SKELETONIZE` as "sole carrier"
- source: [CarrierDetector.ts](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d), [DEFAULT_THRESHOLDS](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)

Cross-model paraphrase expansion:

- after initial triage, each pruning target triggers a paraphrase scan across statements
- any unprotected statement with cosine similarity ≥ 0.85 to a pruning target is also skeletonized
- this is what actually enforces pruning "across the council" instead of only in the origin model
- source: [TriageEngine.ts](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)

Skeletonization transform:

- `skeletonize(text)` removes verbs/adverbs/adjectives/function words via `compromise` and returns a reduced "noun skeleton"
- failure/empty falls back to `···`
- source: [Skeletonizer.ts](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)

#### 4.1.2 Reconstructing per-provider outputs (the "chewed substrate")

`reconstructSubstrate(input, triageResult)`:

- reconstructs each provider's output by walking the shadow paragraphs for that `modelIndex`
- statement-level actions:
    - `PROTECTED` → keep original text
    - `SKELETONIZE` → replace with skeletonized text
    - `REMOVE` → omit entirely
- adds weak "visual scars" to make heavy chewing obvious:
    - empty paragraph becomes `[...]`
    - very low intact paragraphs are wrapped in `--- … ---`
- includes fallback if modelIndex alignment is off by ±1 and if reconstruction produced empty text
- source: [SubstrateReconstructor.ts](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)

For prompt injection, the substrate can be formatted as a single evidence block:

- includes summary stats and the `pathSteps` audit trail
- then prints each source as `### Source {modelIndex} ({providerId})`
- source: [formatSubstrateForPrompt](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)

---

### 4.2 Concierge Handoff (Injecting Constrained Evidence into Singularity)

When traversal continuation is received, the backend:

- rebuilds a stable `sourceData[]` list from stored batch responses and citation order
- builds `chewedSubstrate` using the mapper artifact's shadow substrate + semantic claims + traversal state
- attaches `chewedSubstrate` to the Singularity step payload
- sources: [handleContinueRequest (chewed substrate build)](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)

Singularity prompt injection:

- `StepExecutor.executeSingularityStep()` checks for `payload.chewedSubstrate`
- if present, it formats an `evidenceSubstrate` string and calls `ConciergeService.buildConciergePrompt(userMessage, { …promptSeed, evidenceSubstrate })`
- this ensures the concierge sees the _user-constrained_ council substrate even during recompute flows
- source: [executeSingularityStep](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)

### 4.3 Singularity Output Selection + Rendering (UI)

The UI renders the concierge output using a small selection layer that supports multiple providers and pinning.

Provider selection state:

- `useSingularityOutput(aiTurnId, forcedProviderId?)`:
    - reads the turn from `turnsMapAtom`
    - resolves a "requested provider" (pinned per-turn, or forced by parent, or inferred from turn meta)
    - returns the active output if present, otherwise falls back to legacy `singularityResponses`
- source: [useSingularityOutput.ts](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)

Rendering:

- `CognitiveOutputRenderer` chooses between traverse/response views and forwards `onRecompute` + state
- source: [CognitiveOutputRenderer.tsx](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)
- `SingularityOutputView`:
    - renders the concierge text as markdown
    - exposes a provider switcher that either pins a usable existing response or triggers a recompute
    - shows pipeline errors via `PipelineErrorBanner`
- source: [SingularityOutputView.tsx](https://arena.ai/c/019c740f-a0bc-77c6-9674-a9646687c87d)

---

## 5. Auxiliary Calculations

These four computations exist in the codebase and produce cleanly separated objects. They are **not on the main happy path** — the pipeline completes without them. They are available for:

- Supplementing the mapper's context
- Enriching UI visualization and filtering
- Post-hoc validation and auditing
- Future scoring or ranking functions

Each is its own object with defined inputs and outputs. They do not generate mechanical gates or forcing points.

---

### 5.1 Query Relevance

**What it computes:** Per-statement cosine similarity between statement embeddings and the user query embedding. Produces tiered relevance scores (high / medium / low).

**Inputs:**

- `statements: ShadowStatement[]`
- `statementEmbeddings: Map<string, Float32Array>`
- `queryEmbedding: Float32Array`

**Output:** `Map<statementId, number>` — relevance scores on every statement. No filtering; all statements proceed to geometry regardless of relevance score.

**How it relates to the main path:**

- Available as a ranking signal for downstream consumers (e.g., the mapper can see which statements are most query-relevant)
- Powers UI filtering in SpaceGraph (dropdown: "All evidence" / "Query-relevant")
- Does NOT exclude evidence from the landscape or mapper
- The value of multi-model synthesis is precisely that
models bring perspectives the user didn't anticipate. The content most valuable to surface — the thing the user never would have asked about — has the lowest query similarity. Ranking preserves noise-reduction benefits without excluding structural participation.

**Implementation:** `queryRelevance.ts`

**UI surface:** `ParagraphSpaceView.tsx` — dropdown toggles between "All evidence" and "Query-relevant" for display filtering. Disables when no relevance data exists.

---

### 5.2 Conditional Finder

**What it computes:** Conditional clauses (if/when/unless/etc.) extracted from shadow statements via regex-first pattern matching, then clustered by embedding similarity or normalized string equality, and impact-ranked by affected statement population.

**Inputs:**

- `statements: ShadowStatement[]`
- `statementEmbeddings: Map<string, Float32Array>`
- `regions: Region[]` (for population impact scoring)

**Output:** `ConditionalGate[]` — gates with source provenance, affected populations, and templated questions derived from conditional clauses.

**How it relates to the main path:**

- These are context checks ("Do you have X?"), not partition-type forks ("Which approach do you prefer?")
- The mapper generates its own conditional forcing points as part of the traversal graph
- Conditional finder output is available as supplementary context — the mapper may see these signals in geometric hints, but they do not mechanically generate forcing points or gates on the main path


**Implementation:** `conditionalFinder.ts`, `deriveConditionalGates.ts`

---

### 5.3 Conflict Deriver

**What it computes:** Opposition pairs between regions based on stance conflicts and geometric proximity. Searches for region pairs that are close in mutual-kNN space but may be semantically opposed or internally conflicted.

**Inputs:**

- `regions: Region[]`
- `regionProfiles: RegionProfile[]`
- `substrate: GeometricSubstrate` (for mutual-edge similarities between regions)

**Output:** `OppositionPair[]` — `{ regionA, regionB, similarity, stanceConflict, reason }`

**Mechanics:**

- Compute inter-region similarity as the maximum mutual-edge similarity crossing two regions
- Evaluate only the top 10 most similar region pairs
- Emit an opposition when:
    - The regions' dominant stances are an opposite pair (`prescriptive` vs `cautionary`, `assertive` vs `uncertain`), OR
    - Either region has high contested ratio, OR
    - Either region has high stance variety

**How it relates to the main path:**

- Opposition data feeds into `PreSemanticInterpretation.hints` which the mapper receives as geometric context
- The mapper decides independently whether these constitute real conflicts worth surfacing as forcing points
- Opposition pairs do not mechanically generate traversal questions or gates
- Available for post-hoc structural validation (comparing geometry predictions to mapper output)

**Implementation:** `interpretation/opposition.ts`

---

### 5.4 Inter-Regional Analysis

**What it computes:** Signals between region pairs (conflict / support / tradeoff / independent) and per-region profiles including tier assignment (peak / hill / floor), purity metrics, and geometry summaries.

**Inputs:**

- `regions: Region[]`
- `substrate: GeometricSubstrate`
- `paragraphs: ShadowParagraph[]`

**Output:**

- `RegionProfile[]` — per-region tier, purity (stance unanimity, contested ratio, stance variety), geometry (internal density, avg internal similarity, isolation), and `nearestCarrierSimilarity` (max mutual-edge similarity from any node in this region to any node in another region)
- Inter-region signals characterizing relationships between region pairs

**How it relates to the main path:**

- Region profiles and inter-region signals feed into `PreSemanticInterpretation.hints` for mapper context
- `nearestCarrierSimilarity` is available for disruption-style scoring if downstream consumers want to rank by uniqueness
- Powers UI visualization (Space Graph region coloring, Decision Map edges)
- Available for structural validation (tier alignment between geometry predictions and mapper output)
- Does not gate or drive the main traversal flow

**Implementation:** `interpretation/profiles.ts`, `interpretation/guidance.ts`, `interpretation/types.ts`

---

## 6. Planned Transitions

### 6.1 Regions as Claims (Pruning Index)

The current pruning index uses mapper-produced claims (`sourceStatementIds` on each claim determine which statements survive or are pruned). Regions are a planned replacement for this index.

**Current state:** Claims are the pruning index. The mapper extracts claims, traversal prunes claims, skeletonization acts on claim-linked statements.

**Planned state:** Regions become the pruning index.

||Claims (current)|Regions (planned)|
|---|---|---|
|Source|LLM-extracted positions|Geometrically-derived clusters|
|Completeness|Lossy — missed = gone|Complete — every statement belongs somewhere|
|Determinism|LLM variance across runs|Same embeddings → same regions|
|Auditability|Trust mapper grouping judgment|Visible why statements are grouped (embedding distance)|
|Pruning|`sourceStatementIds` per claim|Member paragraphs/statements per region|

**What changes:**

- Partition resolved (user chose side A): Side B's region members with aligned stance → REMOVE
- Region evaluated but user skipped: Region members remain eligible for skeletonization cascade
- Region never evaluated by mapper: All members UNTRIAGED — pass through intact (conservative default)
- Conditional gate resolved (user answered NO): Affected region members become pruning targets

**What's lost:**

- Mapper's ability to group geometrically distant statements that make the same point in different language. This is bounded by embedding quality — good embeddings track content similarity closely enough that geometric groupings approximate semantic groupings.

---

## 7. Key Architectural Decisions

**The mapper is the question author.**  
The mapper LLM is the single authority for claim identification and traversal question generation. Mechanical layers (geometry, conditional finder, conflict deriver) identify structural features and fault lines. The mapper names the hinge and writes the question. There are no mechanical gates on the main path.

**Query relevance ranks, never filters.**  
Models bring perspectives the user didn't anticipate. The content most valuable to surface — the thing the user never would have asked about — has the lowest query similarity. Ranking preserves noise-reduction benefits (downstream scoring can downrank low-relevance positions) without excluding structural participation.

**Auxiliary calculations inform, never drive.**  
Query relevance, conditional finder, conflict deriver, and inter-regional analysis are cleanly separated objects. They supplement the mapper's context and power UI visualization, but do not generate forcing points, gates, or pruning decisions on the main path. The mapper sees their outputs as hints and decides independently what matters.

**V8 inversion holds through all changes.**  
Claims (or regions, when transitioned) are the pruning index. Text remains the output. The synthesizer reads evidence, not abstractions. The concierge cannot resurrect pruned material or blend eliminated paths. This principle survived every architectural iteration.

**Conditional gates and partition forks are complementary.**  
Partitions find binary forks — mutually exclusive positions where the user must choose. Conditional gates find contextual dependencies — positions where all models agree but assume different facts about the user's situation. Both can produce traversal questions. Both can prune when answered. Different mechanisms, same user interface. Currently, the mapper is responsible for generating both types as part of its traversal graph.
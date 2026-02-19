# Stance Labelling with Embeddings (Play-by-Play)

This document explains, at a high level but with the core algorithmic details, how this codebase assigns stance labels to extracted statements using the embeddings model.

The relevant implementation lives primarily in:
- [embeddings.ts](file:///c:/Users/Mahdi/Desktop/hybrid/src/clustering/embeddings.ts) (embedding generation + label prototype embeddings)
- [ShadowExtractor.ts](file:///c:/Users/Mahdi/Desktop/hybrid/src/shadow/ShadowExtractor.ts) (the actual stance classification from embeddings)
- [StepExecutor.js](file:///c:/Users/Mahdi/Desktop/hybrid/src/core/execution/StepExecutor.js) (orchestration: generate statement embeddings → initialize label embeddings → enrich statements)

## What “stance labeling” means here

A “stance” is one of these types (plus a fallback):
- prescriptive, cautionary, prerequisite, dependent, assertive, uncertain
- unclassified (used when the embedding evidence is too weak)

The stance is assigned per statement (sentence/clause) first. Later, paragraph-level stance is derived from its member statements, not directly from the embedding classifier.

## End-to-end flow (from text to stance)

### 1) We extract candidate statements (pre-stance)

Earlier in the pipeline, the “shadow extraction” step produces `ShadowStatement` objects with:
- `id`, `text`, `modelIndex`, and location metadata
- an initial regex-based stance/signals guess (because the extractor always has to output something)

At this stage, stance may later be replaced by the embedding-based result.

Embedding-based stance classification happens during enrichment:
- [enrichShadowExtraction](file:///c:/Users/Mahdi/Desktop/hybrid/src/shadow/ShadowExtractor.ts#L287-L500)

### 2) We generate statement embeddings (the model side)

When we have at least one extracted statement, we ask the embedding subsystem to produce a vector per statement:
- [generateStatementEmbeddings](file:///c:/Users/Mahdi/Desktop/hybrid/src/clustering/embeddings.ts#L361-L417)

Play-by-play:
1. The service worker ensures an offscreen document exists for running the embedding model:
   - [ensureOffscreen](file:///c:/Users/Mahdi/Desktop/hybrid/src/clustering/embeddings.ts#L25-L42)
2. For each statement text, inline markdown is stripped (to reduce formatting noise):
   - [stripInlineMarkdown](file:///c:/Users/Mahdi/Desktop/hybrid/src/clustering/embeddings.ts#L63-L86)
3. The code sends a `GENERATE_EMBEDDINGS` message to the offscreen worker, specifying:
   - `modelId` (default: `bge-base-en-v1.5`)
   - `dimensions` (default: `768`)
   - `binary: true` (results may be stored as a binary buffer)
4. The response is decoded into a `Map<statementId, Float32Array>`:
   - [decodeEmbeddingsResultAsync](file:///c:/Users/Mahdi/Desktop/hybrid/src/clustering/embeddings.ts#L175-L229)
5. Every returned vector is L2-normalized (important because cosine similarity assumes normalized vectors):
   - [normalizeEmbedding](file:///c:/Users/Mahdi/Desktop/hybrid/src/clustering/embeddings.ts#L47-L61)

Normalization + quantization are used throughout to make comparisons deterministic across runs, even if the embedding backend introduces small floating-point variation.

### 3) We build “label prototype embeddings” for each stance (the label side)

The classifier does not train a supervised model. Instead, it creates prototype embeddings from short natural-language definitions of each label.

This is done once (cached), using the same embedding model as the statements:
- [initializeLabelEmbeddings](file:///c:/Users/Mahdi/Desktop/hybrid/src/clustering/embeddings.ts#L847-L964)

Play-by-play:
1. For each stance label (prescriptive, cautionary, …), we define 3 textual variants describing that label:
   - [STANCE_LABEL_VARIANTS](file:///c:/Users/Mahdi/Desktop/hybrid/src/clustering/embeddings.ts#L605-L636)
2. We embed every variant text with the embedding model:
   - [generateTextEmbeddings](file:///c:/Users/Mahdi/Desktop/hybrid/src/clustering/embeddings.ts#L301-L349)
3. For each stance label, we store a triple of vectors (one per variant):
   - `labels.stances[stance] = [v0, v1, v2]`
4. We validate that these label vectors are reasonably separated:
   - stance-vs-stance max similarity must stay below `0.6` (otherwise it’s flagged)
   - stance-vs-signal max similarity must stay below `0.7` (otherwise it’s flagged as cross-taxonomy)
   - [validateSeparation](file:///c:/Users/Mahdi/Desktop/hybrid/src/clustering/embeddings.ts#L717-L845)
5. The validation produces a severity: `ok`, `warn`, or `critical`.
   - If severity is `critical`, embedding-based classification is disabled and we fall back to regex.

This separation check exists to prevent a “broken prototype set” from silently producing nonsense classifications.

### 4) We decide whether embedding-based classification is allowed

During enrichment, we only use embeddings if both of these are true:
- statement embeddings are available and non-empty
- label embeddings exist AND their validation severity is not `critical`

That logic is here:
- [enrichShadowExtraction](file:///c:/Users/Mahdi/Desktop/hybrid/src/shadow/ShadowExtractor.ts#L297-L313)

If embeddings are not allowed, the system keeps the regex-based stance classification.

### 5) For each statement, we compute stance scores via cosine similarity

If embedding classification is allowed and we have the statement’s embedding vector:
- we compute how similar the statement is to each stance label
- we pick the stance with the highest score

This is the core stance classifier:
- [classifyByEmbedding](file:///c:/Users/Mahdi/Desktop/hybrid/src/shadow/ShadowExtractor.ts#L352-L390)

The scoring rule is:
1. Each stance label has 3 variant vectors (3 prototype descriptions).
2. For a given stance label, compute cosine similarity to each variant and take the maximum.
   - [scoreMaxVariant](file:///c:/Users/Mahdi/Desktop/hybrid/src/shadow/ShadowExtractor.ts#L343-L350)
3. Similarities are quantized to 1e-6 precision for determinism:
   - [quantizeSimilarity](file:///c:/Users/Mahdi/Desktop/hybrid/src/clustering/distance.ts#L12-L14)
4. After scoring all stances, sort descending by score.

Because everything is L2-normalized, cosine similarity is just a dot product:
- [cosineSimilarity](file:///c:/Users/Mahdi/Desktop/hybrid/src/clustering/distance.ts#L20-L27)

### 6) We apply thresholds: “unclassified” and “ambiguous”

After we pick the best stance and the second-best stance, we compute:
- `bestSim` = best stance score
- `secondSim` = second-best stance score
- `margin` = quantized(bestSim - secondSim)

Then we interpret those numbers with thresholds:
- If `bestSim < stanceMinSimilarity` (default `0.28`), we refuse to classify:
  - stance becomes `unclassified`
  - confidence becomes `0`
- Otherwise, we classify as the best stance, and assign a confidence from the margin:
  - base confidence is `0.55`
  - if margin ≥ `0.04` → `0.75`
  - if margin ≥ `0.08` → `0.9`
- Ambiguity is tracked separately:
  - `ambiguous = (margin < ambiguousMargin)` (default `0.04`)

These defaults are set here:
- [enrichShadowExtraction](file:///c:/Users/Mahdi/Desktop/hybrid/src/shadow/ShadowExtractor.ts#L297-L300)

Important nuance: a statement can be “classified” (passes `stanceMinSimilarity`) but still marked ambiguous if it barely beats the runner-up.

### 7) We optionally compute “signals” via the same prototype trick

In the same enrichment pass, we also compute boolean signal flags from embeddings:
- sequence, tension, conditional

The algorithm is the same pattern:
- embed 3 textual variants per signal label (stored in label embeddings)
- score max cosine similarity across variants
- fire the boolean if the score is ≥ `signalSimilarity` (default `0.32`)

Implementation:
- [signalsByEmbedding](file:///c:/Users/Mahdi/Desktop/hybrid/src/shadow/ShadowExtractor.ts#L392-L414)

Signals are used elsewhere (including affecting paragraph embedding pooling weights), but they are distinct from stance labels.

### 8) If embeddings are unavailable, we fall back to regex stance classification

Whether because:
- statement embeddings failed to generate
- label embeddings failed to initialize
- label validation severity is `critical`
- the statement doesn’t have an embedding entry

…we keep the regex-based stance/signals for that statement:
- [classifyStance / detectSignals](file:///c:/Users/Mahdi/Desktop/hybrid/src/shadow/StatementTypes.ts)

The enrichment step also records fallback diagnostics and can optionally attach per-statement classification metadata for debugging.

## Where paragraph-level stance comes from (after statement stance)

Once every statement has a stance + confidence, paragraphs are projected and assigned a `dominantStance`.

That paragraph stance is computed from the set of statement stances in the paragraph:
- if we have a contested pair (prescriptive vs cautionary, or assertive vs uncertain), the paragraph is marked `contested` and the dominant stance is chosen by precedence
- otherwise, the dominant stance is the stance with the highest accumulated weight (confidence), with precedence-based tie-breaking

Implementation:
- [computeDominantStance](file:///c:/Users/Mahdi/Desktop/hybrid/src/shadow/ShadowParagraphProjector.ts#L58-L100)

## Summary: the core algorithm in one sentence

We embed (1) each statement’s text and (2) short natural-language descriptions of each stance label with the same embedding model, then assign the stance whose label-prototype embedding has the highest (quantized) cosine similarity to the statement embedding—subject to minimum-similarity and ambiguity-margin thresholds, with a regex fallback when embeddings aren’t trustworthy.


# Query Relevance with Embeddings (Play-by-Play)

This document explains where and how the system uses embeddings to score “query relevance” for extracted statements.

The main implementation is:
- [StepExecutor.js](file:///c:/Users/Mahdi/Desktop/hybrid/src/core/execution/StepExecutor.js) (computes the query embedding and calls relevance scoring)
- [queryRelevance.ts](file:///c:/Users/Mahdi/Desktop/hybrid/src/geometry/queryRelevance.ts) (scores each statement for relevance)

## High-level intent

Given:
- a user query (prompt)
- a set of extracted `ShadowStatement`s (with embeddings)
- a geometric substrate built from pooled paragraph embeddings

…we compute, per statement:
- how semantically similar it is to the query (embedding similarity)
- how “novel” it is relative to dense consensus regions (geometry-based)
- whether it has “sub-consensus corroboration” across models (geometry + region signals)

Then we produce:
- a normalized `compositeRelevance` in `[0, 1]` per statement
- a simple tiering into high/medium/low buckets

## Step-by-step pipeline wiring

### 1) Compute the query embedding

Inside the execution pipeline, we embed the query text using the same embedding model as statements:
- [StepExecutor.js](file:///c:/Users/Mahdi/Desktop/hybrid/src/core/execution/StepExecutor.js#L707-L732)

Play-by-play:
1. Choose the raw query string:
   - `payload.originalPrompt` if available, otherwise `context.userMessage`
2. Clean the query by stripping inline markdown:
   - [stripInlineMarkdown](file:///c:/Users/Mahdi/Desktop/hybrid/src/clustering/embeddings.ts#L63-L86)
3. Call `generateTextEmbeddings([cleanedQuery])` and take id `"0"`:
   - [generateTextEmbeddings](file:///c:/Users/Mahdi/Desktop/hybrid/src/clustering/embeddings.ts#L301-L349)
4. Validate the embedding exists and matches `DEFAULT_CONFIG.embeddingDimensions` (default 768):
   - [config.ts](file:///c:/Users/Mahdi/Desktop/hybrid/src/clustering/config.ts#L32-L56)

### 2) Ensure we have paragraph embeddings + build the substrate

Query relevance scoring also uses “geometry” signals derived from the substrate graph, which is built from paragraph embeddings.

In this codebase, paragraph embeddings are pooled from statement embeddings:
- [poolToParagraphEmbeddings](file:///c:/Users/Mahdi/Desktop/hybrid/src/clustering/embeddings.ts#L428-L479)

Then the geometric substrate is built:
- [StepExecutor.js](file:///c:/Users/Mahdi/Desktop/hybrid/src/core/execution/StepExecutor.js#L734-L788)

### 3) Call query relevance scoring (only when it’s safe)

Relevance scoring runs only when:
- `queryEmbedding` exists
- `substrate` exists and is not degenerate

Call site:
- [StepExecutor.js](file:///c:/Users/Mahdi/Desktop/hybrid/src/core/execution/StepExecutor.js#L914-L939)

The result is stored as JSON-safe data on the pipeline artifacts:
- [toJsonSafeQueryRelevance](file:///c:/Users/Mahdi/Desktop/hybrid/src/geometry/queryRelevance.ts#L266-L276)
- [StepExecutor.js](file:///c:/Users/Mahdi/Desktop/hybrid/src/core/execution/StepExecutor.js#L977-L980)

## The core scoring algorithm (computeQueryRelevance)

Implementation:
- [computeQueryRelevance](file:///c:/Users/Mahdi/Desktop/hybrid/src/geometry/queryRelevance.ts#L64-L264)

For each statement, the score is built from three parts.

### A) Query similarity (embeddings)

For each statement `st`, we choose an embedding vector:
- prefer the statement’s own embedding: `statementEmbeddings.get(st.id)`
- otherwise fall back to the embedding of its parent paragraph: `paragraphEmbeddings.get(paragraphId)`

That choice is here:
- [queryRelevance.ts](file:///c:/Users/Mahdi/Desktop/hybrid/src/geometry/queryRelevance.ts#L152-L158)

Then we compute cosine similarity between the query embedding and that vector:
- [cosineSimilarity](file:///c:/Users/Mahdi/Desktop/hybrid/src/clustering/distance.ts#L20-L27)

Finally we map cosine from `[-1, 1]` into `[0, 1]`:
- `querySimilarity = clamp01((cosine + 1) / 2)`
- [queryRelevance.ts](file:///c:/Users/Mahdi/Desktop/hybrid/src/geometry/queryRelevance.ts#L159-L165)

### B) Novelty (geometry / density)

Each statement is assigned a “degree” based on its paragraph’s node in the substrate graph:
- specifically `node.mutualDegree`

We normalize degrees across the whole set, and define:
- higher degree → denser consensus neighborhood → lower novelty
- lower degree → more isolated → higher novelty

The novelty calculation is:
- `normalizedDensity = (degree - minDegree) / (maxDegree - minDegree)`
- `novelty = 1 - normalizedDensity`
- [queryRelevance.ts](file:///c:/Users/Mahdi/Desktop/hybrid/src/geometry/queryRelevance.ts#L162-L165)

### C) Sub-consensus corroboration (cross-model + non-peak)

This is a binary “bonus” signal intended to reward statements that:
- have corroboration across multiple models
- but are not part of the strongest peak consensus cluster

First, we estimate `modelCount` per statement by looking at the paragraph node’s neighborhood patch and counting distinct model indices:
- [queryRelevance.ts](file:///c:/Users/Mahdi/Desktop/hybrid/src/geometry/queryRelevance.ts#L118-L137)

Then we detect “peak regions” using the 80th percentile cutoff on mutual degree:
- [queryRelevance.ts](file:///c:/Users/Mahdi/Desktop/hybrid/src/geometry/queryRelevance.ts#L96-L99)

There are two modes:

1) Degree-only mode (no region data available):
- `subConsensusCorroboration = 1` if `modelCount >= 2 && !peakByDegree`, else `0`
- [computeSubConsensus](file:///c:/Users/Mahdi/Desktop/hybrid/src/geometry/queryRelevance.ts#L291-L303)

2) Region-profile mode (regionization + regionProfiles available):
- We require coherent regions (stance unanimity high, contested ratio low)
- We require a non-peak tier (or low tier confidence)
- `subConsensusCorroboration = 1` if `modelCount >= 2 && nonPeakTier && coherent`, else `0`
- [computeSubConsensus](file:///c:/Users/Mahdi/Desktop/hybrid/src/geometry/queryRelevance.ts#L304-L321)

Region data is supplied by the pre-semantic interpretation step:
- [StepExecutor.js](file:///c:/Users/Mahdi/Desktop/hybrid/src/core/execution/StepExecutor.js#L892-L913)

### D) Composite score and normalization

The raw composite is a weighted sum:
- `0.5 * querySimilarity`
- `0.3 * novelty`
- plus `0.2` if sub-consensus fires (otherwise +0)

Weights are defined here:
- [queryRelevance.ts](file:///c:/Users/Mahdi/Desktop/hybrid/src/geometry/queryRelevance.ts#L85-L88)

Then scores are normalized by dividing by the max across statements so the top statement becomes 1.0:
- [queryRelevance.ts](file:///c:/Users/Mahdi/Desktop/hybrid/src/geometry/queryRelevance.ts#L210-L213)

Note: the file computes “adaptive weights” based on substrate shape priors, but currently keeps `adaptiveWeightsActive = false`, so the fixed weights above are always used:
- [getAdaptiveWeights](file:///c:/Users/Mahdi/Desktop/hybrid/src/geometry/queryRelevance.ts#L278-L289)

### E) Tiering into high/medium/low

Statements are sorted by composite relevance (desc), with a lexicographic tie-breaker on statement id:
- [queryRelevance.ts](file:///c:/Users/Mahdi/Desktop/hybrid/src/geometry/queryRelevance.ts#L226-L234)

Then:
- top 20% → `high`
- next 40% → `medium`
- remaining 40% → `low`
- [queryRelevance.ts](file:///c:/Users/Mahdi/Desktop/hybrid/src/geometry/queryRelevance.ts#L236-L244)

## Where query relevance is used next

After scoring, the relevance result is:
- recorded in observability (so you can inspect it in devtools)
- stored in `pipelineArtifacts.query.relevance`
- used downstream (when enabled) to compute disruption scores and build worklists

Examples of downstream wiring:
- [StepExecutor.js](file:///c:/Users/Mahdi/Desktop/hybrid/src/core/execution/StepExecutor.js#L983-L999)


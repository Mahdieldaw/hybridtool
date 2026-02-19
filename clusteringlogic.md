# Clustering Logic (Play-by-Play)

This report explains how clustering works in `src/clustering/`, from embeddings → distances → hierarchical clustering → cluster quality/uncertainty output.

Key files:
- [index.ts](file:///c:/Users/Mahdi/Desktop/hybrid/src/clustering/index.ts) (public API)
- [engine.ts](file:///c:/Users/Mahdi/Desktop/hybrid/src/clustering/engine.ts) (main orchestration)
- [distance.ts](file:///c:/Users/Mahdi/Desktop/hybrid/src/clustering/distance.ts) (cosine, quantization, distance matrix, cohesion)
- [hac.ts](file:///c:/Users/Mahdi/Desktop/hybrid/src/clustering/hac.ts) (hierarchical agglomerative clustering)
- [config.ts](file:///c:/Users/Mahdi/Desktop/hybrid/src/clustering/config.ts) (thresholds + safety limits)
- [embeddings.ts](file:///c:/Users/Mahdi/Desktop/hybrid/src/clustering/embeddings.ts) (embedding generation + pooling)
- [types.ts](file:///c:/Users/Mahdi/Desktop/hybrid/src/clustering/types.ts) (cluster output contract)

## What we cluster

We cluster **paragraphs**, not raw statements, but the paragraph embedding is ultimately derived from statement embeddings depending on which pipeline path calls clustering.

The output cluster type is [ParagraphCluster](file:///c:/Users/Mahdi/Desktop/hybrid/src/clustering/types.ts#L22-L45):
- `paragraphIds` (members)
- `representativeParagraphId` (centroid-like representative)
- cohesion metrics (`cohesion`, `pairwiseCohesion`)
- uncertainty flags (`uncertain`, `uncertaintyReasons`)
- optional `expansion` payload when uncertain

## High-level “cluster paragraphs end-to-end”

There is a convenience API:
- [clusterParagraphs](file:///c:/Users/Mahdi/Desktop/hybrid/src/clustering/index.ts#L62-L85)

Flow:
1. Merge a partial config into [DEFAULT_CONFIG](file:///c:/Users/Mahdi/Desktop/hybrid/src/clustering/config.ts#L32-L56).
2. If there are too few paragraphs, skip and return singletons.
3. Otherwise:
   - generate paragraph embeddings via [generateEmbeddings](file:///c:/Users/Mahdi/Desktop/hybrid/src/clustering/embeddings.ts#L237-L299)
   - cluster via [buildClusters](file:///c:/Users/Mahdi/Desktop/hybrid/src/clustering/engine.ts#L236-L448)
   - attach embedding timing into the final meta

In the main execution pipeline you’re also using a second path:
- embed statements → pool to paragraph embeddings → build clusters (this keeps paragraph vectors aligned with statement vectors used elsewhere).

## Step 1: Build embeddings

### A) Paragraph embeddings directly (paragraph text embedding)

[generateEmbeddings](file:///c:/Users/Mahdi/Desktop/hybrid/src/clustering/embeddings.ts#L237-L299) creates one embedding per paragraph by:
- building the paragraph text from **unclipped statement text** (concatenated)
- sending texts to the offscreen embedding worker
- decoding results into `Map<paragraphId, Float32Array>`
- L2-normalizing each vector for cosine determinism

### B) Statement embeddings then pooled to paragraph embeddings (weighted mean)

[generateStatementEmbeddings](file:///c:/Users/Mahdi/Desktop/hybrid/src/clustering/embeddings.ts#L361-L417) creates vectors per statement.

[poolToParagraphEmbeddings](file:///c:/Users/Mahdi/Desktop/hybrid/src/clustering/embeddings.ts#L428-L479) then aggregates statements into a paragraph vector as a **weighted mean**:
- base weight comes from statement confidence (min 0.1)
- weights are boosted if the statement’s `signals` include:
  - tension → ×1.3
  - conditional → ×1.2
  - sequence → ×1.1
- pooled vector is re-normalized (L2) so cosine similarity stays meaningful

This pooling step is designed so downstream geometry + clustering can operate on paragraph embeddings without changing its interfaces.

## Step 2: Convert embeddings into a distance matrix

Clustering operates on a full pairwise distance matrix built from embeddings:
- [buildDistanceMatrix](file:///c:/Users/Mahdi/Desktop/hybrid/src/clustering/distance.ts#L69-L126)

Core idea:
- embeddings are assumed normalized
- similarity is cosine (dot product)
- distance is `1 - quantizedSimilarity`
- quantization (`1e-6`) is used to reduce run-to-run drift:
  - [quantizeSimilarity](file:///c:/Users/Mahdi/Desktop/hybrid/src/clustering/distance.ts#L12-L14)

### Optional: stance-aware similarity adjustment

When paragraph metadata is available (it is passed by default from `engine.ts`), similarity is adjusted before being converted into distance:
- opposing stance pairs are downweighted (`×0.6`):
  - prescriptive vs cautionary
  - assertive vs uncertain
- same stance is slightly upweighted (`×1.1`)
- prerequisite/dependent pairs get a small boost (`×1.05`)

Implementation:
- [stanceAdjustedSimilarity](file:///c:/Users/Mahdi/Desktop/hybrid/src/clustering/distance.ts#L29-L56)

### Optional: model-diversity adjustment

If two paragraphs come from different models, and their base similarity is already fairly high (>0.55), it gets a small boost:
- [modelDiversityWeight](file:///c:/Users/Mahdi/Desktop/hybrid/src/clustering/distance.ts#L58-L62)

Net effect: agreement across different models is slightly “stickier” during clustering.

## Step 3: Hierarchical Agglomerative Clustering (HAC)

The clustering algorithm is classic hierarchical agglomerative clustering with **average linkage**:
- [hierarchicalCluster](file:///c:/Users/Mahdi/Desktop/hybrid/src/clustering/hac.ts#L46-L154)

### How HAC works here

1. Start with every paragraph as its own cluster.
2. Repeatedly find the pair of clusters with the smallest distance under average linkage:
   - average linkage = mean distance across all cross-cluster pairs
   - [averageLinkage](file:///c:/Users/Mahdi/Desktop/hybrid/src/clustering/hac.ts#L13-L29)
3. Stop when the best candidate merge would exceed the configured threshold.

The stopping threshold is derived from configuration:
- `distanceThreshold = 1 - similarityThreshold`
- [config.ts](file:///c:/Users/Mahdi/Desktop/hybrid/src/clustering/config.ts#L32-L56)
- [hac.ts](file:///c:/Users/Mahdi/Desktop/hybrid/src/clustering/hac.ts#L73-L75)

### Determinism

Several tie-breakers and ordering rules exist to make clustering deterministic:
- active clusters are iterated in stable sorted order
- distance is quantized
- ties prefer lower cluster indices

### Mutual kNN “bonus” (optional)

If a mutual kNN graph is provided, merges that have at least one mutual edge between any member pair get their distance reduced:
- distance is multiplied by `0.9` when a mutual edge exists
- [hac.ts](file:///c:/Users/Mahdi/Desktop/hybrid/src/clustering/hac.ts#L59-L110)

This nudges HAC to respect strong neighborhood structure discovered by the geometry layer, without forcing merges that violate the similarity threshold.

### Max clusters is a warning, not a force

If the final cluster count is high, HAC logs warnings, but it does not force merges that exceed the threshold:
- [hac.ts](file:///c:/Users/Mahdi/Desktop/hybrid/src/clustering/hac.ts#L142-L148)

## Step 4: Turn index clusters into ParagraphCluster objects

After HAC returns clusters as lists of indices, the engine builds `ParagraphCluster` objects:
- [buildClusters](file:///c:/Users/Mahdi/Desktop/hybrid/src/clustering/engine.ts#L236-L448)

For each cluster:

### A) Choose a representative paragraph (centroid-like)

The representative is defined as the member closest to the cluster mean embedding:
- compute mean of member vectors
- normalize mean
- pick the member with maximum cosine to mean (tie-break by lexicographic id)
- [findCentroid](file:///c:/Users/Mahdi/Desktop/hybrid/src/clustering/engine.ts#L27-L94)

### B) Compute cohesion metrics

Two metrics are computed:
- `cohesion`: average similarity to centroid (excluding self)
  - [computeCohesion](file:///c:/Users/Mahdi/Desktop/hybrid/src/clustering/distance.ts#L133-L159)
- `pairwiseCohesion`: average similarity across all member pairs
  - [pairwiseCohesion](file:///c:/Users/Mahdi/Desktop/hybrid/src/clustering/distance.ts#L161-L185)

### C) Detect “uncertain” clusters

Clusters are flagged as uncertain if any of these conditions fire:
- low cohesion: `cohesion < lowCohesionThreshold`
- “dumbbell” pattern: cohesion looks fine, but pairwise cohesion is low (gap ≥ 0.10)
- oversized: member count exceeds `maxClusterSize`
- stance diversity: unique stance count ≥ `stanceDiversityThreshold`
- contested ratio: contested paragraphs / total > `contestedRatioThreshold`
- conflicting signals: both tension and conditional are present somewhere in the cluster (and size > 1)

Implementation:
- [detectUncertainty](file:///c:/Users/Mahdi/Desktop/hybrid/src/clustering/engine.ts#L100-L168)
- thresholds live in [config.ts](file:///c:/Users/Mahdi/Desktop/hybrid/src/clustering/config.ts#L32-L56)

### D) Build an “expansion” payload for uncertain clusters

If `uncertain === true`, the engine creates an expansion bundle intended for downstream clarification/inspection:
- includes centroid plus the most distant members from the centroid
- respects a max member count and a total character budget
- uses raw `_fullParagraph` text, clipped to a per-member cap

Implementation:
- [buildExpansion](file:///c:/Users/Mahdi/Desktop/hybrid/src/clustering/engine.ts#L176-L225)

### E) Stable output ordering

After building clusters:
- uncertain clusters are sorted first, then by size descending
- cluster ids are renumbered after sorting for stable ordering
- [engine.ts](file:///c:/Users/Mahdi/Desktop/hybrid/src/clustering/engine.ts#L417-L427)

## What the clustering configuration controls

The clustering behavior is mostly shaped by:
- `similarityThreshold`: how strict merges are (higher → more singletons)
- `maxClusters`: warning-only safety limit (does not force merges)
- uncertainty thresholds:
  - `lowCohesionThreshold`
  - `maxClusterSize`
  - `stanceDiversityThreshold`
  - `contestedRatioThreshold`

Defaults:
- [DEFAULT_CONFIG](file:///c:/Users/Mahdi/Desktop/hybrid/src/clustering/config.ts#L32-L56)


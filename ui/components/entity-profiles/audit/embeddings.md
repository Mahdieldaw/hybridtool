# Stage 1 — Embeddings: Current Measurement Configuration (Code Truth)

This document is a code-derived snapshot of the embedding and similarity measurements currently used by the pipeline, with the concrete configuration values and the exact figures computed from them.

Scope: paragraph + statement embeddings, cosine similarity, kNN/mutual/strong graphs, per-node stats, per-run distribution stats, and what reaches the UI artifact.

---

## 1) Embedding vectors

### 1.1 Model + dimensions (defaults)

Source of defaults: `src/clustering/config.ts`

| Item | Value |
|---|---|
| `modelId` | `nomic-embed-text-v1.5` |
| `embeddingDimensions` | `768` |

The geometry substrate is built over paragraph embeddings (per paragraph id).

### 1.2 Backends

Source: `src/offscreen/embedding-worker.js`

- Primary backend: WebGPU (when supported).
- Fallback backend: WASM.
- Exposed backend label: `backend` reported by the embedding worker status (`'webgpu'` or `'wasm'`).

### 1.3 Inference pooling + normalization

Source: `src/offscreen/embedding-worker.js`

For each batch, the offscreen embedder is called with:

- `pooling: 'mean'`
- `normalize: true`
- Batch size: `32`

Source: `src/clustering/embeddings.ts`

After decoding results, the service worker re-normalizes every vector with explicit L2 normalization (`normalizeEmbedding(vec)`), for determinism.

### 1.4 Input text construction (paragraph vs statement)

Source: `src/clustering/embeddings.ts`

Paragraph embedding text (one text per paragraph) is constructed by concatenating the paragraph’s original statement texts:

- For each paragraph: `statementIds.map(statement.text).join(' ')`
- No inline-markdown stripping is applied for paragraph embedding text.

Statement embedding text is constructed from each statement with inline markdown stripped (`stripInlineMarkdown`).

### 1.5 Safety/size limits on embedding requests

Source: `src/offscreen/embedding-worker.js`

| Limit | Value |
|---|---|
| Max texts per request | `4096` |
| Max chars per text | `50000` |
| Max total chars per request | `4,000,000` |
| Max dimensions accepted | `2048` |
| Max output floats (`MAX_TEXTS * MAX_DIMENSIONS`) | `4096 * 2048` |

The service worker requests yielding between batches when `texts.length > 64`.

---

## 2) Similarity measure

### 2.1 Similarity definition

Source: `src/geometry/knn.ts`

- Similarity is cosine similarity between L2-normalized vectors.
- Implemented as a dot product: `dot(a, b)` (since vectors are assumed normalized).

### 2.2 Quantization (determinism)

Source: `src/geometry/knn.ts`

- All similarities used by substrate graphs are quantized to 1e-6:
  - `quantize(value) = round(value * 1e6) / 1e6`

This quantized similarity is what propagates into edge lists, per-node stats, and distribution stats.

### 2.3 Tie-breaking

Source: `src/geometry/knn.ts`

Neighbor ranking is deterministic:

- Sort by similarity descending.
- For equal similarity, lexicographically smaller id wins.

---

## 3) Substrate graphs (kNN → mutual → strong)

### 3.1 Global substrate build config (defaults)

Source: `src/geometry/substrate.ts`

| Item | Value |
|---|---|
| `k` | `5` |
| `minParagraphs` | `3` |

Degenerate reasons returned (still produces a valid substrate shape):

- `insufficient_paragraphs` (n < 3)
- `embedding_failure` (no embeddings)
- `all_embeddings_identical` (all similarities identical and non-empty)

### 3.2 kNN graph (symmetric union)

Source: `src/geometry/knn.ts`

Per node:

- Compute similarity to every other node with an embedding.
- Quantize similarity to 1e-6.
- Take top-K neighbors, assign `rank = 1..K`.

Graph construction:

- Edges are canonicalized by `(minId|maxId)` so there is one stored edge per unordered pair.
- Adjacency is stored in both directions for lookup.

Outputs:

- `graphs.knn.edges[]`: each `{ source, target, similarity, rank }`
- `top1Sims[node]`: best neighbor similarity (or 0 if missing)
- `topKSims[node]`: array of K similarities (or empty if missing)

### 3.3 Mutual kNN graph (precision backbone)

Source: `src/geometry/knn.ts`

An edge is included iff:

- A selected B in A’s top-K, and
- B selected A in B’s top-K.

Mutual edge rank:

- `rank = min(rankInA, rankInB)`

Outputs:

- `graphs.mutual.edges[]`: each `{ source, target, similarity, rank }`

### 3.4 Soft threshold + strong graph (structural cutoff)

Sources: `src/geometry/threshold.ts`, `src/geometry/substrate.ts`

Default threshold config:

| Item | Value |
|---|---|
| `method` | `p80_top1` |
| `clampMin` | `0.55` |
| `clampMax` | `0.78` |
| `fixedValue` (only for `method: 'fixed'`) | `0.65` (fallback) |

Soft threshold computation:

- Collect all `top1Sims` values where `sim > 0`
- Sort ascending
- Choose percentile:
  - `p80_top1` → 0.80
  - `p75_top1` → 0.75
- Index rule: `idx = floor(count * percentile)`
- `rawThreshold = sims[min(idx, count - 1)]`
- Clamp into `[clampMin, clampMax]`
- Quantize to 1e-6

Strong graph construction:

- Filter mutual edges where `edge.similarity >= softThreshold`
- `graphs.strong.thresholdMethod` stores the method string
- `graphs.strong.softThreshold` stores the computed value

---

## 4) Per-node measurements (NodeLocalStats)

Source: `src/geometry/nodes.ts`, type: `src/geometry/types.ts`

For each paragraph node:

- `top1Sim`: `top1Sims.get(id) ?? 0`
- `avgTopKSim`: mean(topK) quantized to 1e-6 (or 0 if no neighbors)
- Degrees:
  - `knnDegree = knn.adjacency.get(id)?.length ?? 0`
  - `mutualDegree = mutual.adjacency.get(id)?.length ?? 0`
  - `strongDegree = strong.adjacency.get(id)?.length ?? 0`
- `isolationScore = quantize(1 - top1Sim)`
- `mutualNeighborhoodPatch`: sorted `[self + mutual neighbors]`

Note: node ordering is deterministic: sorted by `paragraphId` lexicographically.

---

## 5) Per-run distribution measurements (similarity stats)

Source: `src/geometry/threshold.ts`, stored in `src/geometry/substrate.ts` under `substrate.meta`

All distribution stats are computed over a flattened list:

- `allSims = flatten(topKSims.values())`

### 5.1 `similarityStats` (always present in non-degenerate substrates)

Fields:

- `max`, `p95`, `p80`, `p50`, `mean`

Percentile rule:

- Sort ascending
- `idx = floor(count * p)`
- `percentile(p) = sims[min(idx, count - 1)]`

### 5.2 `extendedSimilarityStats` (present in non-degenerate substrates)

Fields:

- `count`, `min`, `p10`, `p25`, `p50`, `p75`, `p80`, `p90`, `p95`, `max`, `mean`, `stddev`

Stddev:

- Population variance: `variance = mean((x - mean)^2)`
- `stddev = sqrt(variance)`

### 5.3 Built-in warnings (console)

Source: `src/geometry/substrate.ts`

The substrate builder emits warnings when:

- `similarityStats.p95 < softThreshold` (sparse regime vs cutoff)
- `similarityStats.max < 0.7` (very low max similarity)
- `similarityStats.mean < 0.4` (low mean similarity)

---

## 6) What reaches the UI artifact (geometry.substrate)

Serialization sources:

- `src/core/execution/StepExecutor.js` (builds `substrateGraph`)
- `shared/cognitive-artifact.ts` (passes into `artifact.geometry.substrate`)

The UI-facing substrate block contains:

- `nodes[]` with:
  - identity/provenance: `paragraphId`, `modelIndex`, `dominantStance`, `contested`, `statementIds`
  - measurements: `top1Sim`, `avgTopKSim`, `mutualDegree`, `strongDegree`, `isolationScore`
  - layout/assignment: `componentId`, `regionId`, `x`, `y`
- `edges[]` (kNN): `{ source, target, similarity, rank }`
- `mutualEdges[]`: `{ source, target, similarity, rank }`
- `strongEdges[]`: `{ source, target, similarity, rank }`
- `softThreshold`
- `similarityStats`
- `extendedSimilarityStats`

If layout2d or substrate is unavailable/degenerate, `substrateGraph` may be `null`, and the artifact will surface empty fallbacks.

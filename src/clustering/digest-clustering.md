# clustering — file digest (embedding and similarity service)

---

## config.ts

Configuration container for embedding model parameters.

**`EmbeddingConfig` interface:**

- `embeddingDimensions` — vector dimensionality (default 768)
- `modelId` — model identifier for inference backend (default 'bge-base-en-v1.5')

**`DEFAULT_CONFIG`** provides baseline production settings.

---

## distance.ts

Similarity computation utilities for normalized vectors.

**`cosineSimilarity(a, b)`**

Dot product of two Float32Array vectors. Assumes pre-normalized embeddings (L2 norm = 1).

Cost: O(min(a.length, b.length)) per pair.

---

## embeddings.ts

Main embedding generation service communicating with Chrome offscreen worker for model inference.

### Configuration & Status

**`getEmbeddingStatus()`**

Queries offscreen worker for service readiness, backend type ('webgpu' | 'wasm'), and loaded model ID.

Returns `{ ready, backend, modelId }`.

### Paragraph Embeddings

**`generateEmbeddings(paragraphs, shadowStatements, config?)`**

Main entry point for embedding corpus paragraphs.

- Builds paragraph text by joining constituent statement texts (original, unclipped)
- Communicates with offscreen document via `chrome.runtime.sendMessage`
- Decodes binary or JSON embedding arrays from response
- Normalizes embeddings after pooling (L2 norm per vector)
- Returns `EmbeddingResult`:
  - `embeddings` — Map<paragraphId, Float32Array>
  - `dimensions` — embedding vector size
  - `timeMs` — wall-clock generation time

**Text Truncation for Query Relevance:**

**`structuredTruncate(text, maxChars)`**

Intelligently truncates long text while preserving high-signal content:

1. **Structural extraction** — identify bullets, numbered lists, headers, directives
   - Cap structural content at 60% of budget
2. **Head/tail split** — remaining 40% split 50/50 between opening (framing) and closing (instructions)
3. **Merge overlaps** — deduplicate ranges, reassemble in document order
4. **Final trim** — if assembled length exceeds budget, hard-cut at boundary

Returns truncated text preserving local coherence.

**Markdown Stripping:**

**`stripInlineMarkdown(text)`**

Removes inline markdown formatting (code backticks, bold, italics) while preserving semantic content. Handles edge cases: word boundaries, nested markers, empty emphasis.

### Statement-Level Embeddings

**`generateStatementEmbeddings(statements, config?)`**

Embed individual statements for statement→paragraph pooling pipeline.

- Strips inline markdown from statement text before encoding
- Returns `StatementEmbeddingResult`:
  - `embeddings` — Map<statementId, Float32Array>
  - `dimensions` — vector size
  - `statementCount` — number of statements
  - `timeMs` — generation time

### Text Embeddings

**`generateTextEmbeddings(texts, config?)`**

Generic embedding for arbitrary text strings (e.g., query strings, user input).

- Maps input text array to numeric IDs (0-indexed)
- Returns `TextEmbeddingResult`:
  - `embeddings` — Map<indexString, Float32Array>

### IndexedDB Caching

**`openEmbeddingsDb()`**

Opens or creates 'htos-embeddings' IndexedDB database with 'buffers' object store for persisting large embedding buffers.

Timeout: 8 seconds.

**`getEmbeddingsBuffer(key)`**

Retrieves ArrayBuffer from IndexedDB for a given key (used when embeddings are stored in binary format to reduce response payload).

**`cleanupPendingEmbeddingsBuffers()`**

Deletes all IndexedDB keys from the pending set (called to reclaim storage after processing embeddings).

### Decoding & Normalization

**`decodeEmbeddingsResultAsync(result, ids, expectedDims, label)`**

Rehydrates embeddings from either:

1. **Binary path** — ArrayBuffer from IndexedDB (via embeddingsKey):
   - Validates count matches ids.length
   - Checks buffer size sufficient for count × dimensions
   - Extracts and normalizes each row
2. **JSON path** — result.embeddings array (fallback):
   - Validates each entry exists and has sufficient dimensions
   - Truncates to expectedDims
   - Normalizes per-row

Returns Map<id, Float32Array> with all vectors L2-normalized.

**`normalizeEmbedding(vec)`**

L2 normalization in-place. Divides all elements by Euclidean norm.

### Offscreen Document Management

**`ensureOffscreen()`**

Creates Chrome offscreen document if not present. Reasons: 'WORKERS' (embedding inference).

---

## index.ts

Public API surface exporting configuration, similarity, and embedding functions.

**Exports:**

- **Config**: `EmbeddingConfig`, `DEFAULT_CONFIG`
- **Similarity**: `cosineSimilarity`
- **Embeddings**: `generateEmbeddings`, `generateStatementEmbeddings`, `generateTextEmbeddings`
- **Status**: `getEmbeddingStatus`, `cleanupPendingEmbeddingsBuffers`
- **Text Processing**: `stripInlineMarkdown`, `structuredTruncate`

---

## Summary of Architecture

**Clustering Module Flow:**

```
Input (paragraphs, statements, or text)
         ↓
[Text Truncation] — structuredTruncate() for long inputs (query path)
         ↓
[Markdown Stripping] — stripInlineMarkdown() for statement text
         ↓
[Offscreen Communication] — chrome.runtime.sendMessage to embedding worker
         ↓
[Binary/JSON Decoding] — decodeEmbeddingsResultAsync() rehydrates from IndexedDB or JSON
         ↓
[Normalization] — L2 norm applied per vector
         ↓
[Similarity Computation] — cosineSimilarity() dot product on normalized pairs
         ↓
[Caching] — Optional IndexedDB cleanup via cleanupPendingEmbeddingsBuffers()
```

**Design Principles:**

- **Chrome extension integration**: Offscreen document isolates embedding inference from content script blocking
- **Binary efficiency**: Large embeddings persisted in IndexedDB as ArrayBuffer to reduce JSON payload
- **Deterministic normalization**: All embeddings L2-normalized to ensure cosine similarity consistency
- **Smart text processing**: Structured truncation preserves signal (headers, bullets, directives) while staying within token budget
- **Batch inference**: Yields between batches for large embedding sets (>64 items) to avoid blocking
- **Fallback robustness**: JSON decoding as fallback if binary key unavailable

**Integration Points:**

- Downstream: `geometry/` layer consumes paragraph embeddings → `knn.ts` builds pairwise field
- Downstream: statement embeddings flow to `geometry/queryRelevance.ts` for relevance scoring
- Upstream: Called from `StepExecutor.js` during deterministic pipeline execution (embeddings phase)

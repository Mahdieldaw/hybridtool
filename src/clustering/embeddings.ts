// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// EMBEDDING CLIENT - SERVICE WORKER SIDE
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//
// Communicates with offscreen document for embedding generation.
//
// Key features:
// - Accepts shadowStatements to build embedding text from unclipped sources
// - Rehydrates Float32Array from JSON-serialized number[][]
// - Renormalizes embeddings after pooling for determinism
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

import type { ShadowParagraph } from '../shadow/shadow-paragraph-projector';
import type { ShadowStatement } from '../shadow/shadow-extractor';
import { EmbeddingConfig, DEFAULT_CONFIG } from './config';
import { logInfraError } from '../errors';
import { stripInlineMarkdown } from '../../shared/text-prep';
export { stripInlineMarkdown, structuredTruncate } from '../../shared/text-prep';

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// EMBEDDING RESULT TYPES
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

export interface EmbeddingResult {
  embeddings: Map<string, Float32Array>; // paragraphId -> embedding
  dimensions: number;
  timeMs: number;
}

export interface StatementEmbeddingResult {
  embeddings: Map<string, Float32Array>; // statementId -> embedding
  dimensions: number;
  statementCount: number;
  timeMs: number;
}

export interface TextEmbeddingResult {
  embeddings: Map<string, Float32Array>;
}

/**
 * Ensure offscreen document exists for embedding inference.
 */
async function ensureOffscreen(): Promise<void> {
  // Check if chrome.offscreen is available (may not be in all contexts)
  if (typeof chrome === 'undefined' || !chrome.offscreen) {
    throw new Error('Chrome offscreen API not available');
  }

  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT' as chrome.runtime.ContextType],
  });

  if (existingContexts.length > 0) return;

  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: [chrome.offscreen.Reason.WORKERS],
    justification: 'Embedding model inference for semantic clustering',
  });
}

/**
 * Normalize embedding vector (L2 norm).
 */
function normalizeEmbedding(vec: Float32Array): Float32Array {
  let norm = 0;
  for (let i = 0; i < vec.length; i++) {
    norm += vec[i] * vec[i];
  }
  norm = Math.sqrt(norm);

  if (norm > 0) {
    for (let i = 0; i < vec.length; i++) {
      vec[i] /= norm;
    }
  }

  return vec;
}

function openEmbeddingsDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open('htos-embeddings', 1);
      let settled = false;
      const timeoutMs = 8000;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error(`IndexedDB open timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      const finalizeResolve = (db: IDBDatabase) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(db);
      };
      const finalizeReject = (err: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      };

      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('buffers')) {
          db.createObjectStore('buffers');
        }
      };
      req.onblocked = () => finalizeReject(new Error('IndexedDB open blocked by other connection'));
      req.onsuccess = () => finalizeResolve(req.result);
      req.onerror = () => finalizeReject(req.error || new Error('IndexedDB open failed'));
    } catch (e) {
      reject(e);
    }
  });
}

const pendingEmbeddingsKeys = new Set<string>();

async function getEmbeddingsBuffer(key: string): Promise<ArrayBuffer> {
  const db = await openEmbeddingsDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('buffers', 'readonly');
      tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed'));
      const store = tx.objectStore('buffers');
      const getReq = store.get(key);
      getReq.onerror = () => reject(getReq.error || new Error('IndexedDB get failed'));
      getReq.onsuccess = () => {
        const val = getReq.result;
        const buf = val && typeof val === 'object' && 'buffer' in val ? (val as any).buffer : null;
        if (!(buf instanceof ArrayBuffer)) {
          reject(new Error(`Missing embeddings buffer for key ${key}`));
          return;
        }
        resolve(buf);
      };
    });
  } finally {
    try {
      db.close();
    } catch (err) {
      logInfraError('clustering/getEmbeddingsBuffer/db-close', err);
    }
  }
}

export async function cleanupPendingEmbeddingsBuffers(): Promise<void> {
  const keys = Array.from(pendingEmbeddingsKeys);
  if (keys.length === 0) return;

  const db = await openEmbeddingsDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('buffers', 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed'));
      const store = tx.objectStore('buffers');
      for (const key of keys) {
        store.delete(key);
      }
    });
    pendingEmbeddingsKeys.clear();
  } finally {
    try {
      db.close();
    } catch (err) {
      logInfraError('clustering/cleanupPendingEmbeddingsBuffers/db-close', err);
    }
  }
}

async function decodeEmbeddingsResultAsync(
  result: any,
  ids: string[],
  expectedDims: number,
  label: string
): Promise<Map<string, Float32Array>> {
  const dims = Number(result?.dimensions) || expectedDims;
  if (dims < expectedDims) {
    throw new Error(`Embedding dimension mismatch: expected at least ${expectedDims}, got ${dims}`);
  }

  const key = result?.embeddingsKey;
  if (typeof key === 'string' && key.length > 0) {
    pendingEmbeddingsKeys.add(key);
    const buf = await getEmbeddingsBuffer(key);
    const floats = new Float32Array(buf);
    const responseCount = Number(result?.count);
    if (Number.isFinite(responseCount) && responseCount !== ids.length) {
      throw new Error(
        `Embedding response count mismatch: count=${responseCount} ids=${ids.length} dims=${dims} floats=${floats.length}. Refusing to decode embeddingsKey=${key} to avoid misaligned embeddings; normalizeEmbedding(view) is applied per-row.`
      );
    }
    const count = ids.length;
    const needed = count * dims;
    if (floats.length < needed) {
      throw new Error(
        `Malformed embeddings buffer: count=${count} ids=${ids.length} dims=${dims} expectedFloats=${needed} gotFloats=${floats.length} embeddingsKey=${key}`
      );
    }

    const embeddings = new Map<string, Float32Array>();
    for (let i = 0; i < ids.length; i++) {
      const start = i * dims;
      const end = start + expectedDims;
      const row = new Float32Array(expectedDims);
      row.set(floats.subarray(start, end));
      embeddings.set(ids[i], normalizeEmbedding(row) as Float32Array<ArrayBuffer>);
    }
    return embeddings;
  }

  const embeddings = new Map<string, Float32Array>();
  for (let i = 0; i < ids.length; i++) {
    const rawEntry = result?.embeddings?.[i];
    if (!rawEntry || !Array.isArray(rawEntry) || rawEntry.length === 0) {
      throw new Error(`Missing or malformed embedding for ${label} ${ids[i]}`);
    }

    const rawData = rawEntry as number[];
    if (rawData.length < expectedDims) {
      throw new Error(
        `Embedding dimension mismatch for ${label} ${ids[i]}: expected at least ${expectedDims}, got ${rawData.length}`
      );
    }

    const truncatedData = rawData.slice(0, expectedDims);
    const emb = new Float32Array(truncatedData);
    embeddings.set(ids[i], normalizeEmbedding(emb) as Float32Array<ArrayBuffer>);
  }
  return embeddings;
}

/**
 * Request embeddings from offscreen worker.
 *
 * Builds text from original ShadowStatement texts (unclipped),
 * rehydrates Float32Array, and renormalizes after pooling.
 */
export async function generateEmbeddings(
  paragraphs: ShadowParagraph[],
  shadowStatements: ShadowStatement[],
  config: EmbeddingConfig = DEFAULT_CONFIG
): Promise<EmbeddingResult> {
  await ensureOffscreen();

  // Build texts from original statement texts (NOT _fullParagraph)
  const statementsById = new Map(shadowStatements.map((s) => [s.id, s]));
  const texts = paragraphs.map((p) =>
    p.statementIds
      .map((sid) => statementsById.get(sid)?.text || '')
      .filter((t) => t.length > 0)
      .join(' ')
  );
  const ids = paragraphs.map((p) => p.id);

  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        type: 'GENERATE_EMBEDDINGS',
        payload: {
          texts,
          dimensions: config.embeddingDimensions,
          modelId: config.modelId,
          binary: true,
          yieldBetweenBatches: texts.length > 64,
        },
      },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        if (!response?.success) {
          reject(new Error(response?.error || 'Embedding generation failed'));
          return;
        }

        (async () => {
          try {
            const expectedDims = config.embeddingDimensions;
            const embeddings = await decodeEmbeddingsResultAsync(
              response.result,
              ids,
              expectedDims,
              'paragraph'
            );
            resolve({
              embeddings,
              dimensions: expectedDims,
              timeMs: response.result.timeMs,
            });
          } catch (e) {
            reject(e instanceof Error ? e : new Error(String(e)));
          }
        })();
      }
    );
  });
}

export async function generateTextEmbeddings(
  texts: string[],
  config: EmbeddingConfig = DEFAULT_CONFIG
): Promise<TextEmbeddingResult> {
  await ensureOffscreen();

  const ids = texts.map((_, idx) => String(idx));

  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        type: 'GENERATE_EMBEDDINGS',
        payload: {
          texts,
          dimensions: config.embeddingDimensions,
          modelId: config.modelId,
          binary: true,
          yieldBetweenBatches: texts.length > 64,
        },
      },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        if (!response?.success) {
          reject(new Error(response?.error || 'Embedding generation failed'));
          return;
        }

        (async () => {
          try {
            const expectedDims = config.embeddingDimensions;
            const embeddings = await decodeEmbeddingsResultAsync(
              response.result,
              ids,
              expectedDims,
              'text'
            );
            resolve({ embeddings });
          } catch (e) {
            reject(e instanceof Error ? e : new Error(String(e)));
          }
        })();
      }
    );
  });
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// STATEMENT-LEVEL EMBEDDINGS + PARAGRAPH POOLING
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

/**
 * Embed individual statements and return a map keyed by statement ID.
 *
 * This is the foundation for the statementâ†’paragraph pooling pipeline:
 *   embed(statements) â†’ pool into paragraph reps â†’ geometry/substrate
 */
export async function generateStatementEmbeddings(
  statements: ShadowStatement[],
  config: EmbeddingConfig = DEFAULT_CONFIG
): Promise<StatementEmbeddingResult> {
  await ensureOffscreen();

  const startTime = performance.now();
  const texts = statements.map((s) => stripInlineMarkdown(s.text));
  const ids = statements.map((s) => s.id);

  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        type: 'GENERATE_EMBEDDINGS',
        payload: {
          texts,
          dimensions: config.embeddingDimensions,
          modelId: config.modelId,
          binary: true,
          yieldBetweenBatches: texts.length > 64,
        },
      },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        if (!response?.success) {
          reject(new Error(response?.error || 'Statement embedding generation failed'));
          return;
        }

        (async () => {
          try {
            const expectedDims = config.embeddingDimensions;
            const embeddings = await decodeEmbeddingsResultAsync(
              response.result,
              ids,
              expectedDims,
              'statement'
            );
            resolve({
              embeddings,
              dimensions: expectedDims,
              statementCount: ids.length,
              timeMs: performance.now() - startTime,
            });
          } catch (e) {
            reject(e instanceof Error ? e : new Error(String(e)));
          }
        })();
      }
    );
  });
}

/**
 * Check embedding service status.
 */
export async function getEmbeddingStatus(): Promise<{
  ready: boolean;
  backend: 'webgpu' | 'wasm' | null;
  modelId: string | null;
}> {
  await ensureOffscreen();

  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'EMBEDDING_STATUS' }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (response?.success) {
        resolve(response.result);
      } else {
        reject(new Error(response?.error || 'Status check failed'));
      }
    });
  });
}

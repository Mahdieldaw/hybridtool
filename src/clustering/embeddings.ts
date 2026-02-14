// ═══════════════════════════════════════════════════════════════════════════
// EMBEDDING CLIENT - SERVICE WORKER SIDE
// ═══════════════════════════════════════════════════════════════════════════
//
// Communicates with offscreen document for embedding generation.
// 
// Key features:
// - Accepts shadowStatements to build embedding text from unclipped sources
// - Rehydrates Float32Array from JSON-serialized number[][]
// - Renormalizes embeddings after pooling for determinism
// ═══════════════════════════════════════════════════════════════════════════

import type { ShadowParagraph } from '../shadow/ShadowParagraphProjector';
import type { ShadowStatement } from '../shadow/ShadowExtractor';
import type { EmbeddingResult, StatementEmbeddingResult } from './types';
import { ClusteringConfig, DEFAULT_CONFIG } from './config';

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
            const req = indexedDB.open("htos-embeddings", 1);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains("buffers")) {
                    db.createObjectStore("buffers");
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error || new Error("IndexedDB open failed"));
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
            const tx = db.transaction("buffers", "readonly");
            tx.onerror = () => reject(tx.error || new Error("IndexedDB transaction failed"));
            const store = tx.objectStore("buffers");
            const getReq = store.get(key);
            getReq.onerror = () => reject(getReq.error || new Error("IndexedDB get failed"));
            getReq.onsuccess = () => {
                const val = getReq.result;
                const buf = val && typeof val === "object" && "buffer" in val ? (val as any).buffer : null;
                if (!(buf instanceof ArrayBuffer)) {
                    reject(new Error(`Missing embeddings buffer for key ${key}`));
                    return;
                }
                resolve(buf);
            };
        });
    } finally {
        try { db.close(); } catch (_) { }
    }
}

export async function cleanupPendingEmbeddingsBuffers(): Promise<void> {
    const keys = Array.from(pendingEmbeddingsKeys);
    if (keys.length === 0) return;

    const db = await openEmbeddingsDb();
    try {
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction("buffers", "readwrite");
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error || new Error("IndexedDB transaction failed"));
            const store = tx.objectStore("buffers");
            for (const key of keys) {
                store.delete(key);
            }
        });
        pendingEmbeddingsKeys.clear();
    } finally {
        try { db.close(); } catch (_) { }
    }
}

async function decodeEmbeddingsResultAsync(
    result: any,
    ids: string[],
    expectedDims: number,
    label: string
): Promise<Map<string, Float32Array>> {
    const dims = Number(result?.dimensions) || expectedDims;
    if (dims !== expectedDims) {
        throw new Error(`Embedding dimension mismatch: expected ${expectedDims}, got ${dims}`);
    }

    const key = result?.embeddingsKey;
    if (typeof key === "string" && key.length > 0) {
        pendingEmbeddingsKeys.add(key);
        const buf = await getEmbeddingsBuffer(key);
        const floats = new Float32Array(buf);
        const count = Number(result?.count) || ids.length;
        const needed = count * dims;
        if (floats.length < needed) {
            throw new Error(`Malformed embeddings buffer: expected ${needed} floats, got ${floats.length}`);
        }

        const embeddings = new Map<string, Float32Array>();
        for (let i = 0; i < ids.length; i++) {
            const start = i * dims;
            const end = start + dims;
            const view = floats.subarray(start, end);
            embeddings.set(ids[i], normalizeEmbedding(view) as Float32Array<ArrayBuffer>);
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
        if (rawData.length !== expectedDims) {
            throw new Error(`Embedding dimension mismatch for ${label} ${ids[i]}: expected ${expectedDims}, got ${rawData.length}`);
        }

        const emb = new Float32Array(rawData);
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
    config: ClusteringConfig = DEFAULT_CONFIG
): Promise<EmbeddingResult> {
    await ensureOffscreen();

    // Build texts from original statement texts (NOT _fullParagraph)
    const statementsById = new Map(shadowStatements.map(s => [s.id, s]));
    const texts = paragraphs.map(p =>
        p.statementIds
            .map(sid => statementsById.get(sid)?.text || '')
            .filter(t => t.length > 0)
            .join(' ')
    );
    const ids = paragraphs.map(p => p.id);

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

                const expectedDims = config.embeddingDimensions;
                const actualDims = Number(response.result?.dimensions) || expectedDims;
                if (actualDims !== expectedDims) {
                    reject(new Error(`Embedding dimension mismatch: expected ${expectedDims}, got ${actualDims}`));
                    return;
                }

                (async () => {
                    try {
                        const embeddings = await decodeEmbeddingsResultAsync(response.result, ids, expectedDims, 'paragraph');
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
    config: ClusteringConfig = DEFAULT_CONFIG
): Promise<Map<string, Float32Array>> {
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

                const expectedDims = config.embeddingDimensions;
                const actualDims = Number(response.result?.dimensions) || expectedDims;
                if (actualDims !== expectedDims) {
                    reject(new Error(`Embedding dimension mismatch: expected ${expectedDims}, got ${actualDims}`));
                    return;
                }

                (async () => {
                    try {
                        resolve(await decodeEmbeddingsResultAsync(response.result, ids, expectedDims, 'text'));
                    } catch (e) {
                        reject(e instanceof Error ? e : new Error(String(e)));
                    }
                })();
            }
        );
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// STATEMENT-LEVEL EMBEDDINGS + PARAGRAPH POOLING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Embed individual statements and return a map keyed by statement ID.
 *
 * This is the foundation for the statement→paragraph pooling pipeline:
 *   embed(statements) → pool into paragraph reps → geometry/substrate
 */
export async function generateStatementEmbeddings(
    statements: ShadowStatement[],
    config: ClusteringConfig = DEFAULT_CONFIG
): Promise<StatementEmbeddingResult> {
    await ensureOffscreen();

    const startTime = performance.now();
    const texts = statements.map(s => s.text);
    const ids = statements.map(s => s.id);

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

                const expectedDims = config.embeddingDimensions;
                const actualDims = Number(response.result?.dimensions) || expectedDims;
                if (actualDims !== expectedDims) {
                    reject(new Error(`Embedding dimension mismatch: expected ${expectedDims}, got ${actualDims}`));
                    return;
                }

                (async () => {
                    try {
                        const embeddings = await decodeEmbeddingsResultAsync(response.result, ids, expectedDims, 'statement');
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
 * Pool statement embeddings into paragraph representations.
 *
 * Strategy: weighted mean of statement vectors within each paragraph.
 * Weights combine statement confidence with stance-based signal boosts.
 *
 * Returns paragraph embeddings in the same Map<paragraphId, Float32Array>
 * format as generateEmbeddings(), so downstream (substrate, knn) is unchanged.
 */
export function poolToParagraphEmbeddings(
    paragraphs: ShadowParagraph[],
    statements: ShadowStatement[],
    statementEmbeddings: Map<string, Float32Array>,
    dimensions: number
): Map<string, Float32Array> {
    const statementsById = new Map(statements.map(s => [s.id, s]));
    const result = new Map<string, Float32Array>();

    for (const para of paragraphs) {
        const vecs: Array<{ vec: Float32Array; weight: number }> = [];

        for (const sid of para.statementIds) {
            const vec = statementEmbeddings.get(sid);
            if (!vec) continue;
            const stmt = statementsById.get(sid);
            if (!stmt) continue;

            // Weight: base confidence + signal boosts
            let weight = Math.max(0.1, stmt.confidence);
            if (stmt.signals.tension) weight *= 1.3;
            if (stmt.signals.conditional) weight *= 1.2;
            if (stmt.signals.sequence) weight *= 1.1;

            vecs.push({ vec, weight });
        }

        if (vecs.length === 0) {
            // No embeddable statements — zero vector (will appear isolated in substrate)
            result.set(para.id, normalizeEmbedding(new Float32Array(dimensions)) as Float32Array<ArrayBuffer>);
            continue;
        }

        // Weighted mean
        const pooled = new Float32Array(dimensions);
        let totalWeight = 0;
        for (const { vec, weight } of vecs) {
            for (let d = 0; d < dimensions; d++) {
                pooled[d] += vec[d] * weight;
            }
            totalWeight += weight;
        }
        if (totalWeight > 0) {
            for (let d = 0; d < dimensions; d++) {
                pooled[d] /= totalWeight;
            }
        }

        result.set(para.id, normalizeEmbedding(pooled) as Float32Array<ArrayBuffer>);
    }

    return result;
}

/**
 * Preload embedding model (call during idle time).
 */
export async function preloadModel(config: ClusteringConfig = DEFAULT_CONFIG): Promise<void> {
    await ensureOffscreen();

    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
            {
                type: 'PRELOAD_MODEL',
                payload: { modelId: config.modelId }
            },
            (response) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                } else if (response?.success) {
                    resolve();
                } else {
                    reject(new Error(response?.error || 'Model preload failed'));
                }
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
        chrome.runtime.sendMessage(
            { type: 'EMBEDDING_STATUS' },
            (response) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                } else if (response?.success) {
                    resolve(response.result);
                } else {
                    reject(new Error(response?.error || 'Status check failed'));
                }
            }
        );
    });
}

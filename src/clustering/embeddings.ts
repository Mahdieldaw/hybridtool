// ═══════════════════════════════════════════════════════════════════════════
// EMBEDDING CLIENT - SERVICE WORKER SIDE
// ═══════════════════════════════════════════════════════════════════════════
//
// Communicates with offscreen document for embedding generation.
// 
// Key features:
// - Accepts shadowStatements to build embedding text from unclipped sources
// - Rehydrates Float32Array from JSON-serialized number[][]
// - Renormalizes embeddings after truncation for determinism
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
 * Critical for determinism after truncation.
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

/**
 * Request embeddings from offscreen worker.
 * 
 * Builds text from original ShadowStatement texts (unclipped),
 * rehydrates Float32Array, and renormalizes after truncation.
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

                // Rehydrate Float32Array and renormalize
                const embeddings = new Map<string, Float32Array>();
                for (let i = 0; i < ids.length; i++) {
                    // Defensive check: ensure embedding entry exists and is valid array
                    const rawEntry = response.result.embeddings?.[i];
                    if (!rawEntry || !Array.isArray(rawEntry) || rawEntry.length === 0) {
                        reject(new Error(`Missing or malformed embedding for paragraph ${ids[i]}`));
                        return;
                    }

                    const rawData = rawEntry as number[];

                    // Truncate if needed (MRL - Matryoshka Representation Learning)
                    const truncatedData = rawData.length > config.embeddingDimensions
                        ? rawData.slice(0, config.embeddingDimensions)
                        : rawData;

                    const emb = new Float32Array(truncatedData);

                    // Renormalize after truncation (critical for determinism)
                    // Type assertion needed for TS 5.x Float32Array<ArrayBuffer> compatibility
                    embeddings.set(ids[i], normalizeEmbedding(emb) as Float32Array<ArrayBuffer>);
                }

                resolve({
                    embeddings,
                    dimensions: config.embeddingDimensions,
                    timeMs: response.result.timeMs,
                });
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

                const embeddings = new Map<string, Float32Array>();
                for (let i = 0; i < ids.length; i++) {
                    const rawEntry = response.result.embeddings?.[i];
                    if (!rawEntry || !Array.isArray(rawEntry) || rawEntry.length === 0) {
                        reject(new Error(`Missing or malformed embedding for text ${ids[i]}`));
                        return;
                    }

                    const rawData = rawEntry as number[];
                    const truncatedData = rawData.length > config.embeddingDimensions
                        ? rawData.slice(0, config.embeddingDimensions)
                        : rawData;

                    const emb = new Float32Array(truncatedData);
                    embeddings.set(ids[i], normalizeEmbedding(emb) as Float32Array<ArrayBuffer>);
                }

                resolve(embeddings);
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

                const embeddings = new Map<string, Float32Array>();
                for (let i = 0; i < ids.length; i++) {
                    const rawEntry = response.result.embeddings?.[i];
                    if (!rawEntry || !Array.isArray(rawEntry) || rawEntry.length === 0) {
                        reject(new Error(`Missing or malformed embedding for statement ${ids[i]}`));
                        return;
                    }

                    const rawData = rawEntry as number[];
                    const truncatedData = rawData.length > config.embeddingDimensions
                        ? rawData.slice(0, config.embeddingDimensions)
                        : rawData;

                    const emb = new Float32Array(truncatedData);
                    embeddings.set(ids[i], normalizeEmbedding(emb) as Float32Array<ArrayBuffer>);
                }

                resolve({
                    embeddings,
                    dimensions: config.embeddingDimensions,
                    statementCount: ids.length,
                    timeMs: performance.now() - startTime,
                });
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

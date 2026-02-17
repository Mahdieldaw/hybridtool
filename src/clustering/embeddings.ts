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
import type { Stance } from '../shadow/StatementTypes';
import type { EmbeddingResult, StatementEmbeddingResult } from './types';
import { ClusteringConfig, DEFAULT_CONFIG } from './config';
import { cosineSimilarity } from './distance';

export type StanceLabel = Exclude<Stance, 'unclassified'>;

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

export function stripInlineMarkdown(text: string): string {
    let out = text;

    out = out.replace(/`{1,3}([^`]+?)`{1,3}/g, '$1');

    for (let i = 0; i < 3; i++) {
        const prev = out;
        out = out.replace(/(\*\*|__)([^\n]+?)\1/g, '$2');
        out = out.replace(/(\*|_)([^\n]+?)\1/g, (match, marker: string, inner: string, offset: number, full: string) => {
            const before = offset > 0 ? full[offset - 1] : '';
            const afterIndex = offset + match.length;
            const after = afterIndex < full.length ? full[afterIndex] : '';
            const beforeOk = before === '' || /[\s([{"'.,;:!?]/.test(before);
            const afterOk = after === '' || /[\s)\]}'".,;:!?]/.test(after);
            if (!beforeOk || !afterOk) return match;
            if (inner.trim().length === 0) return match;
            if (marker === '_' && /[A-Za-z0-9]$/.test(before) && /^[A-Za-z0-9]/.test(after)) return match;
            return inner;
        });
        if (out === prev) break;
    }

    return out.replace(/\s{2,}/g, ' ').trim();
}

function openEmbeddingsDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        try {
            const req = indexedDB.open("htos-embeddings", 1);
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
                if (!db.objectStoreNames.contains("buffers")) {
                    db.createObjectStore("buffers");
                }
            };
            req.onblocked = () => finalizeReject(new Error("IndexedDB open blocked by other connection"));
            req.onsuccess = () => finalizeResolve(req.result);
            req.onerror = () => finalizeReject(req.error || new Error("IndexedDB open failed"));
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
        const responseCount = Number(result?.count);
        if (Number.isFinite(responseCount) && responseCount !== ids.length) {
            throw new Error(
                `Embedding response count mismatch: count=${responseCount} ids=${ids.length} dims=${dims} floats=${floats.length}. Refusing to decode embeddingsKey=${key} to avoid misaligned embeddings; normalizeEmbedding(view) is applied per-row.`
            );
        }
        const count = ids.length;
        const needed = count * dims;
        if (floats.length < needed) {
            throw new Error(`Malformed embeddings buffer: count=${count} ids=${ids.length} dims=${dims} expectedFloats=${needed} gotFloats=${floats.length} embeddingsKey=${key}`);
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
    const texts = statements.map(s => stripInlineMarkdown(s.text));
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

export type SignalLabel = 'tension' | 'conditional' | 'sequence';
export type RelationshipLabel = 'conflict' | 'support' | 'tradeoff';

export type LabelVariantEmbeddings = [Float32Array, Float32Array, Float32Array];

export type LabelEmbeddings = {
    stances: Record<StanceLabel, LabelVariantEmbeddings>;
    signals: Record<SignalLabel, LabelVariantEmbeddings>;
    relationships: Record<RelationshipLabel, LabelVariantEmbeddings>;
    meta: {
        modelId: string;
        dimensions: number;
        createdAtMs: number;
        validation: {
            severity: 'ok' | 'warn' | 'critical';
            ok: boolean;
            violations: Array<{ category: 'stance' | 'signal' | 'relationship' | 'cross_taxonomy'; a: string; b: string; cosine: number }>;
            lowestStancePairs: Array<{ a: string; b: string; cosine: number }>;
            distributions: {
                stancePairs: {
                    count: number;
                    min: number;
                    p10: number;
                    p50: number;
                    p90: number;
                    p95: number;
                    max: number;
                    mean: number;
                    buckets: Array<{ start: number; end: number; count: number }>;
                };
                signalPairs: {
                    count: number;
                    min: number;
                    p10: number;
                    p50: number;
                    p90: number;
                    p95: number;
                    max: number;
                    mean: number;
                    buckets: Array<{ start: number; end: number; count: number }>;
                };
                relationshipPairs: {
                    count: number;
                    min: number;
                    p10: number;
                    p50: number;
                    p90: number;
                    p95: number;
                    max: number;
                    mean: number;
                    buckets: Array<{ start: number; end: number; count: number }>;
                };
                crossTaxonomyPairs: {
                    count: number;
                    min: number;
                    p10: number;
                    p50: number;
                    p90: number;
                    p95: number;
                    max: number;
                    mean: number;
                    buckets: Array<{ start: number; end: number; count: number }>;
                };
            };
            polarityRanks: {
                prescriptiveCautionary: number;
                assertiveUncertain: number;
            };
        };
    };
};

const STANCE_LABEL_VARIANTS: Record<StanceLabel, [string, string, string]> = {
    prescriptive: [
        'A recommendation, instruction, or directive telling someone what to do, what approach to take, or what to implement',
        'A statement that advises an action: it tells the reader to choose, use, adopt, build, or implement something specific',
        'Guidance that proposes a concrete course of action, best practice, or implementation step to follow',
    ],
    cautionary: [
        'A warning about risks, pitfalls, or failure modes — it warns, cautions, or advises against something',
        'A statement urging caution: avoid this approach, watch out for this problem, or be aware of this danger',
        'A statement highlighting what could go wrong, what to be wary of, or what downsides accompany a choice',
    ],
    prerequisite: [
        'A statement about something that must be in place first — a requirement, dependency, or precondition before proceeding',
        'A statement that points backward to a necessary precondition: something must already be true or completed before the next step',
        'A requirement or foundation that must exist before an action can be taken — necessary groundwork or prior setup',
    ],
    dependent: [
        'A statement about what comes next, what follows from a prior step, or what becomes possible after something else is complete',
        'A statement that points forward: once a prior step is done, this next action, phase, or outcome becomes available',
        'A follow-on step, subsequent phase, or downstream consequence that depends on earlier work being finished',
    ],
    assertive: [
        'A factual statement, observation, or description of how something works, what something is, or what a situation looks like',
        'A confident, direct claim about reality — it states what is true, explains a mechanism, or describes current behavior without hedging',
        'A declarative statement presenting information as fact: it explains, defines, or describes rather than recommending or warning',
    ],
    uncertain: [
        'A hedged or qualified statement expressing that something might or might not apply, that outcomes are variable, or that it depends on circumstances',
        'A statement that uses caveats, hedging, or qualifiers — words like might, perhaps, generally, it depends, or in some cases',
        'A qualified claim that avoids committing to a definitive position, noting that results may vary or that the answer is context-dependent',
    ],
};

const SIGNAL_LABEL_VARIANTS: Record<SignalLabel, [string, string, string]> = {
    tension: [
        'A statement that presents a tradeoff, a contrasting consideration, or acknowledges that two valid concerns pull in different directions',
        'A passage that weighs pros against cons, notes a downside to an otherwise positive recommendation, or balances competing priorities',
        'A statement containing internal opposition — it acknowledges merit on both sides of a choice, or qualifies a recommendation with however or but',
    ],
    conditional: [
        "A statement whose applicability depends on a specific situation, context, or assumption about the user's environment",
        "Advice that applies only when certain facts about the user's situation hold — such as team size, budget, timeline, platform, or regulatory environment",
        'A recommendation qualified by if, when, or unless — it works in some contexts but not others, and the statement says or implies which',
    ],
    sequence: [
        'A statement about ordering, steps, phases, or temporal dependency between actions or events',
        'A passage describing what should happen in what order — first do this, then do that, or one thing must precede another',
        'A statement establishing a workflow, timeline, or progression where the order of steps matters',
    ],
};

const RELATIONSHIP_LABEL_VARIANTS: Record<RelationshipLabel, [string, string, string]> = {
    conflict: [
        'Two recommendations that contradict each other — they propose incompatible solutions, and following both is impossible',
        'Two passages where accepting one requires rejecting the other — they make claims that cannot coexist',
        'Mutually exclusive positions — implementing one approach rules out the other because they address the same problem in incompatible ways',
    ],
    support: [
        'Two passages that agree, reinforce the same point, or provide complementary evidence for the same conclusion',
        'Two statements that are aligned — they recommend the same approach, describe the same reality, or build on each other',
        'Passages that corroborate each other, offering the same recommendation from different angles or with different supporting evidence',
    ],
    tradeoff: [
        'Two approaches that are both valid but in tension — choosing one means accepting downsides that the other avoids',
        'Two viable paths where gains in one area come at a cost in another — neither is wrong, but they optimize for different priorities',
        'A pair of recommendations that each solve the same problem but with different strengths and weaknesses, requiring a preference to decide',
    ],
};

let _labelEmbeddings: LabelEmbeddings | null = null;
let _labelEmbeddingsInFlight: Promise<LabelEmbeddings> | null = null;

function freezeLabelEmbeddings(obj: LabelEmbeddings): LabelEmbeddings {
    const safeFreeze = <T extends object>(v: T): T => {
        try {
            return Object.freeze(v);
        } catch {
            return v;
        }
    };
    for (const vs of Object.values(obj.stances)) {
        for (const v of vs) safeFreeze(v as unknown as object);
        safeFreeze(vs);
    }
    for (const vs of Object.values(obj.signals)) {
        for (const v of vs) safeFreeze(v as unknown as object);
        safeFreeze(vs);
    }
    for (const vs of Object.values(obj.relationships)) {
        for (const v of vs) safeFreeze(v as unknown as object);
        safeFreeze(vs);
    }
    safeFreeze(obj.stances);
    safeFreeze(obj.signals);
    safeFreeze(obj.relationships);
    safeFreeze(obj.meta.validation.violations);
    safeFreeze(obj.meta.validation.lowestStancePairs);
    safeFreeze(obj.meta.validation.distributions.stancePairs.buckets);
    safeFreeze(obj.meta.validation.distributions.signalPairs.buckets);
    safeFreeze(obj.meta.validation.distributions.relationshipPairs.buckets);
    safeFreeze(obj.meta.validation.distributions.crossTaxonomyPairs.buckets);
    safeFreeze(obj.meta.validation.distributions.stancePairs);
    safeFreeze(obj.meta.validation.distributions.signalPairs);
    safeFreeze(obj.meta.validation.distributions.relationshipPairs);
    safeFreeze(obj.meta.validation.distributions.crossTaxonomyPairs);
    safeFreeze(obj.meta.validation.distributions);
    safeFreeze(obj.meta.validation.polarityRanks);
    safeFreeze(obj.meta.validation);
    safeFreeze(obj.meta);
    return safeFreeze(obj);
}

function validateSeparation(
    stances: Record<StanceLabel, LabelVariantEmbeddings>,
    signals: Record<SignalLabel, LabelVariantEmbeddings>,
    relationships: Record<RelationshipLabel, LabelVariantEmbeddings>
): LabelEmbeddings['meta']['validation'] {
    const violations: LabelEmbeddings['meta']['validation']['violations'] = [];

    const maxCrossVariantCosine = (a: LabelVariantEmbeddings, b: LabelVariantEmbeddings): number => {
        let best = -Infinity;
        for (let i = 0; i < a.length; i++) {
            for (let j = 0; j < b.length; j++) {
                const c = cosineSimilarity(a[i], b[j]);
                if (c > best) best = c;
            }
        }
        return best;
    };

    const summarizeCosines = (values: number[]) => {
        const sorted = [...values].filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
        const count = sorted.length;
        const pick = (p: number): number => {
            if (count === 0) return 0;
            const idx = Math.min(count - 1, Math.max(0, Math.round((count - 1) * p)));
            return sorted[idx];
        };
        let mean = 0;
        for (const v of sorted) mean += v;
        mean = count > 0 ? mean / count : 0;
        const bucketCount = 10;
        const buckets: Array<{ start: number; end: number; count: number }> = [];
        for (let i = 0; i < bucketCount; i++) {
            buckets.push({ start: i / bucketCount, end: (i + 1) / bucketCount, count: 0 });
        }
        for (const v of sorted) {
            const idx = Math.min(bucketCount - 1, Math.max(0, Math.floor(v * bucketCount)));
            buckets[idx].count += 1;
        }
        return {
            count,
            min: count ? sorted[0] : 0,
            p10: pick(0.1),
            p50: pick(0.5),
            p90: pick(0.9),
            p95: pick(0.95),
            max: count ? sorted[count - 1] : 0,
            mean,
            buckets,
        };
    };

    const stanceKeys = Object.keys(stances) as StanceLabel[];
    const stancePairs: Array<{ a: string; b: string; cosine: number }> = [];
    for (let i = 0; i < stanceKeys.length; i++) {
        for (let j = i + 1; j < stanceKeys.length; j++) {
            const a = stanceKeys[i];
            const b = stanceKeys[j];
            const cosine = maxCrossVariantCosine(stances[a], stances[b]);
            stancePairs.push({ a, b, cosine });
            if (cosine >= 0.6) violations.push({ category: 'stance', a, b, cosine });
        }
    }
    const stanceSorted = [...stancePairs].sort((x, y) => x.cosine - y.cosine);
    const lowestStancePairs = stanceSorted.slice(0, 5);
    const findRank = (x: string, y: string): number => {
        const idx = stanceSorted.findIndex(p => (p.a === x && p.b === y) || (p.a === y && p.b === x));
        return idx >= 0 ? idx + 1 : stanceSorted.length + 1;
    };
    const polarityRanks = {
        prescriptiveCautionary: findRank('prescriptive', 'cautionary'),
        assertiveUncertain: findRank('assertive', 'uncertain'),
    };

    const signalKeys = Object.keys(signals) as SignalLabel[];
    const signalCosines: number[] = [];
    for (let i = 0; i < signalKeys.length; i++) {
        for (let j = i + 1; j < signalKeys.length; j++) {
            const a = signalKeys[i];
            const b = signalKeys[j];
            const cosine = maxCrossVariantCosine(signals[a], signals[b]);
            signalCosines.push(cosine);
            if (cosine >= 0.6) violations.push({ category: 'signal', a, b, cosine });
        }
    }

    const relKeys = Object.keys(relationships) as RelationshipLabel[];
    const relationshipCosines: number[] = [];
    for (let i = 0; i < relKeys.length; i++) {
        for (let j = i + 1; j < relKeys.length; j++) {
            const a = relKeys[i];
            const b = relKeys[j];
            const cosine = maxCrossVariantCosine(relationships[a], relationships[b]);
            relationshipCosines.push(cosine);
            if (cosine >= 0.6) violations.push({ category: 'relationship', a, b, cosine });
        }
    }

    const crossTaxonomyCosines: number[] = [];
    for (const s of stanceKeys) {
        for (const g of signalKeys) {
            const cosine = maxCrossVariantCosine(stances[s], signals[g]);
            crossTaxonomyCosines.push(cosine);
            if (cosine >= 0.7) violations.push({ category: 'cross_taxonomy', a: s, b: g, cosine });
        }
    }

    const ok = violations.length === 0;
    const highestViolation = violations.reduce((acc, v) => Math.max(acc, v.cosine), -Infinity);
    const severity =
        ok
            ? 'ok'
            : violations.some((v) => v.category === 'cross_taxonomy') || (Number.isFinite(highestViolation) && highestViolation >= 0.85)
                ? 'critical'
                : 'warn';

    return {
        severity,
        ok,
        violations,
        lowestStancePairs,
        distributions: {
            stancePairs: summarizeCosines(stancePairs.map((p) => p.cosine)),
            signalPairs: summarizeCosines(signalCosines),
            relationshipPairs: summarizeCosines(relationshipCosines),
            crossTaxonomyPairs: summarizeCosines(crossTaxonomyCosines),
        },
        polarityRanks
    };
}

export async function initializeLabelEmbeddings(config: ClusteringConfig = DEFAULT_CONFIG): Promise<LabelEmbeddings> {
    if (_labelEmbeddings) return _labelEmbeddings;
    if (_labelEmbeddingsInFlight) return _labelEmbeddingsInFlight;

    _labelEmbeddingsInFlight = (async () => {
        const stanceKeys = Object.keys(STANCE_LABEL_VARIANTS) as StanceLabel[];
        const signalKeys = Object.keys(SIGNAL_LABEL_VARIANTS) as SignalLabel[];
        const relationshipKeys = Object.keys(RELATIONSHIP_LABEL_VARIANTS) as RelationshipLabel[];

        const texts: string[] = [];
        const stanceIndex: Record<StanceLabel, number[]> = {} as Record<StanceLabel, number[]>;
        for (const s of stanceKeys) {
            stanceIndex[s] = [];
            const variants = STANCE_LABEL_VARIANTS[s];
            for (const t of variants) {
                stanceIndex[s].push(texts.length);
                texts.push(t);
            }
        }

        const signalIndex: Record<SignalLabel, number[]> = {} as Record<SignalLabel, number[]>;
        for (const g of signalKeys) {
            signalIndex[g] = [];
            const variants = SIGNAL_LABEL_VARIANTS[g];
            for (const t of variants) {
                signalIndex[g].push(texts.length);
                texts.push(t);
            }
        }

        const relationshipIndex: Record<RelationshipLabel, number[]> = {} as Record<RelationshipLabel, number[]>;
        for (const r of relationshipKeys) {
            relationshipIndex[r] = [];
            const variants = RELATIONSHIP_LABEL_VARIANTS[r];
            for (const t of variants) {
                relationshipIndex[r].push(texts.length);
                texts.push(t);
            }
        }

        const embedded = await generateTextEmbeddings(texts, config);
        const dimensions = config.embeddingDimensions;

        const stances = {} as Record<StanceLabel, LabelVariantEmbeddings>;
        for (const s of stanceKeys) {
            const vectors: Float32Array[] = [];
            for (const idx of stanceIndex[s]) {
                const v = embedded.get(String(idx));
                if (v) vectors.push(v);
            }
            const out: LabelVariantEmbeddings = [
                vectors[0] ? normalizeEmbedding(new Float32Array(vectors[0])) as Float32Array<ArrayBuffer> : normalizeEmbedding(new Float32Array(dimensions)) as Float32Array<ArrayBuffer>,
                vectors[1] ? normalizeEmbedding(new Float32Array(vectors[1])) as Float32Array<ArrayBuffer> : normalizeEmbedding(new Float32Array(dimensions)) as Float32Array<ArrayBuffer>,
                vectors[2] ? normalizeEmbedding(new Float32Array(vectors[2])) as Float32Array<ArrayBuffer> : normalizeEmbedding(new Float32Array(dimensions)) as Float32Array<ArrayBuffer>,
            ];
            stances[s] = out;
        }

        const signals = {} as Record<SignalLabel, LabelVariantEmbeddings>;
        for (const g of signalKeys) {
            const idxs = signalIndex[g];
            const vectors: Float32Array[] = [];
            for (const idx of idxs) {
                const v = embedded.get(String(idx));
                if (v) vectors.push(v);
            }
            const out: LabelVariantEmbeddings = [
                vectors[0] ? normalizeEmbedding(new Float32Array(vectors[0])) as Float32Array<ArrayBuffer> : normalizeEmbedding(new Float32Array(dimensions)) as Float32Array<ArrayBuffer>,
                vectors[1] ? normalizeEmbedding(new Float32Array(vectors[1])) as Float32Array<ArrayBuffer> : normalizeEmbedding(new Float32Array(dimensions)) as Float32Array<ArrayBuffer>,
                vectors[2] ? normalizeEmbedding(new Float32Array(vectors[2])) as Float32Array<ArrayBuffer> : normalizeEmbedding(new Float32Array(dimensions)) as Float32Array<ArrayBuffer>,
            ];
            signals[g] = out;
        }

        const relationships = {} as Record<RelationshipLabel, LabelVariantEmbeddings>;
        for (const r of relationshipKeys) {
            const idxs = relationshipIndex[r];
            const vectors: Float32Array[] = [];
            for (const idx of idxs) {
                const v = embedded.get(String(idx));
                if (v) vectors.push(v);
            }
            const out: LabelVariantEmbeddings = [
                vectors[0] ? normalizeEmbedding(new Float32Array(vectors[0])) as Float32Array<ArrayBuffer> : normalizeEmbedding(new Float32Array(dimensions)) as Float32Array<ArrayBuffer>,
                vectors[1] ? normalizeEmbedding(new Float32Array(vectors[1])) as Float32Array<ArrayBuffer> : normalizeEmbedding(new Float32Array(dimensions)) as Float32Array<ArrayBuffer>,
                vectors[2] ? normalizeEmbedding(new Float32Array(vectors[2])) as Float32Array<ArrayBuffer> : normalizeEmbedding(new Float32Array(dimensions)) as Float32Array<ArrayBuffer>,
            ];
            relationships[r] = out;
        }

        const validation = validateSeparation(stances, signals, relationships);
        if (!validation.ok) {
            console.warn('[LabelEmbeddings] Validation failed', validation.violations);
        }

        const modelId = config.modelId || 'bge-base-en-v1.5';
        const built: LabelEmbeddings = freezeLabelEmbeddings({
            stances,
            signals,
            relationships,
            meta: {
                modelId,
                dimensions,
                createdAtMs: typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now(),
                validation,
            },
        });

        _labelEmbeddings = built;
        _labelEmbeddingsInFlight = null;
        return built;
    })();

    return _labelEmbeddingsInFlight;
}

export function getCachedLabelEmbeddings(): LabelEmbeddings | null {
    return _labelEmbeddings;
}

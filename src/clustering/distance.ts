// ═══════════════════════════════════════════════════════════════════════════
// DISTANCE & SIMILARITY CALCULATIONS
// ═══════════════════════════════════════════════════════════════════════════

import type { ShadowParagraph } from '../shadow/ShadowParagraphProjector';
import type { Stance } from '../shadow/StatementTypes';

/**
 * Quantize similarity for deterministic comparisons.
 * Prevents floating-point drift across runs (GPU may vary slightly).
 */
export function quantizeSimilarity(sim: number): number {
    return Math.round(sim * 1e6) / 1e6;
}

/**
 * Cosine similarity between two normalized vectors.
 * Assumes vectors are already L2 normalized.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
    let dot = 0;
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
        dot += a[i] * b[i];
    }
    return dot;
}

function stanceAdjustedSimilarity(
    baseSim: number,
    stanceA: Stance,
    stanceB: Stance
): number {
    const opposing: Array<[Stance, Stance]> = [
        ['prescriptive', 'cautionary'],
        ['assertive', 'uncertain'],
    ];

    const isOpposing = opposing.some(([x, y]) => (stanceA === x && stanceB === y) || (stanceA === y && stanceB === x));
    if (isOpposing) {
        return baseSim * 0.6;
    }

    if (stanceA === stanceB) {
        return baseSim * 1.1;
    }

    const isSequencePair =
        (stanceA === 'prerequisite' && stanceB === 'dependent') ||
        (stanceA === 'dependent' && stanceB === 'prerequisite');
    if (isSequencePair) {
        return baseSim * 1.05;
    }

    return baseSim;
}

function modelDiversityWeight(baseSim: number, modelA: number, modelB: number): number {
    if (modelA === modelB) return 1.0;
    return baseSim > 0.55 ? 1.15 : 1.0;
}

/**
 * Build distance matrix from embeddings.
 * Returns distances (1 - similarity) for HAC algorithm.
 * 
 * Uses quantized similarities for determinism.
 */
export function buildDistanceMatrix(
    ids: string[],
    embeddings: Map<string, Float32Array>,
    paragraphs?: ShadowParagraph[]
): number[][] {
    const n = ids.length;
    const distances: number[][] = Array(n).fill(null).map(() => Array(n).fill(0));
    const warnedIds = new Set<string>();

    const paragraphMetaById = new Map<string, ShadowParagraph>();
    if (paragraphs) {
        for (const p of paragraphs) {
            paragraphMetaById.set(p.id, p);
        }
    }

    for (let i = 0; i < n; i++) {
        const embA = embeddings.get(ids[i]);

        for (let j = i + 1; j < n; j++) {
            const embB = embeddings.get(ids[j]);

            // Handle missing embeddings with Infinity sentinel
            if (!embA || !embB) {
                distances[i][j] = Infinity;
                distances[j][i] = Infinity;

                // Warn once per missing id
                if (!embA && !warnedIds.has(ids[i])) {
                    warnedIds.add(ids[i]);
                    console.warn(`[distance] Missing embedding for id: ${ids[i]}`);
                }
                if (!embB && !warnedIds.has(ids[j])) {
                    warnedIds.add(ids[j]);
                    console.warn(`[distance] Missing embedding for id: ${ids[j]}`);
                }
                continue;
            }

            let sim = cosineSimilarity(embA, embB);

            const metaA = paragraphMetaById.get(ids[i]);
            const metaB = paragraphMetaById.get(ids[j]);
            if (metaA && metaB) {
                sim = stanceAdjustedSimilarity(sim, metaA.dominantStance, metaB.dominantStance);
                sim *= modelDiversityWeight(sim, metaA.modelIndex, metaB.modelIndex);
                sim = Math.max(-1, Math.min(1, sim));
            }

            const simQ = quantizeSimilarity(sim);
            const dist = 1 - simQ;
            distances[i][j] = dist;
            distances[j][i] = dist;
        }
    }

    return distances;
}

/**
 * Compute cluster cohesion (average similarity to centroid).
 * 
 * Uses quantized similarities.
 */
export function computeCohesion(
    memberIds: string[],
    centroidId: string,
    embeddings: Map<string, Float32Array>
): number {
    if (memberIds.length <= 1) return 1.0;

    const centroidEmb = embeddings.get(centroidId);
    if (!centroidEmb) return 0;

    let totalSim = 0;
    let count = 0;

    for (const id of memberIds) {
        // Skip centroid to avoid biasing average with 1.0
        if (id === centroidId) continue;

        const emb = embeddings.get(id);
        if (!emb) continue;

        const sim = cosineSimilarity(emb, centroidEmb);
        totalSim += quantizeSimilarity(sim);
        count++;
    }

    return count > 0 ? totalSim / count : 0;
}

export function pairwiseCohesion(
    memberIds: string[],
    embeddings: Map<string, Float32Array>
): number {
    if (memberIds.length <= 1) return 1.0;

    let totalSim = 0;
    let count = 0;

    for (let i = 0; i < memberIds.length; i++) {
        const embA = embeddings.get(memberIds[i]);
        if (!embA) continue;

        for (let j = i + 1; j < memberIds.length; j++) {
            const embB = embeddings.get(memberIds[j]);
            if (!embB) continue;

            const sim = cosineSimilarity(embA, embB);
            totalSim += quantizeSimilarity(sim);
            count++;
        }
    }

    return count > 0 ? totalSim / count : 0;
}

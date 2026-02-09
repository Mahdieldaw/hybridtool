// ═══════════════════════════════════════════════════════════════════════════
// CLUSTERING ENGINE - MAIN ORCHESTRATION
// ═══════════════════════════════════════════════════════════════════════════

import type { ShadowParagraph } from '../shadow/ShadowParagraphProjector';
import type { ShadowStatement } from '../shadow/ShadowExtractor';
import type { ParagraphCluster, ClusteringResult } from './types';
import { ClusteringConfig, DEFAULT_CONFIG } from './config';
import { buildDistanceMatrix, cosineSimilarity, computeCohesion, pairwiseCohesion, quantizeSimilarity } from './distance';
import { hierarchicalCluster } from './hac';
import type { MutualKnnGraph } from '../geometry/types';

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function clipText(text: string, maxChars: number): string {
    if (text.length <= maxChars) return text;
    return text.slice(0, maxChars).trim() + '...';
}

/**
 * Find centroid: paragraph closest to cluster mean embedding.
 * 
 * Includes stable tie-breaker for determinism.
 */
function findCentroid(
    memberIds: string[],
    embeddings: Map<string, Float32Array>
): { id: string; similarity: number } {
    if (memberIds.length === 1) {
        return { id: memberIds[0], similarity: 1.0 };
    }

    // Compute mean embedding
    const firstEmb = embeddings.get(memberIds[0]);
    if (!firstEmb) {
        return { id: memberIds[0], similarity: 0 };
    }

    const dim = firstEmb.length;
    const mean = new Float32Array(dim);

    let validCount = 0;
    for (const id of memberIds) {
        const emb = embeddings.get(id);
        if (!emb) continue;
        for (let i = 0; i < dim; i++) {
            mean[i] += emb[i];
        }
        validCount++;
    }

    if (validCount === 0) {
        return { id: memberIds[0], similarity: 0 };
    }

    // Normalize mean
    let norm = 0;
    for (let i = 0; i < dim; i++) {
        mean[i] /= validCount;
        norm += mean[i] * mean[i];
    }
    norm = Math.sqrt(norm);
    if (norm > 0) {
        for (let i = 0; i < dim; i++) {
            mean[i] /= norm;
        }
    }

    // Find member closest to mean
    // Stable tie-breaker by lexicographic ID
    let bestId = memberIds[0];
    let bestSim = -Infinity;

    for (const id of memberIds) {
        const emb = embeddings.get(id);
        if (!emb) continue;

        let sim = 0;
        for (let i = 0; i < dim; i++) {
            sim += emb[i] * mean[i];
        }
        const simQ = quantizeSimilarity(sim);

        // Tie-breaker: lexicographically smallest ID
        if (simQ > bestSim || (simQ === bestSim && id < bestId)) {
            bestSim = simQ;
            bestId = id;
        }
    }

    return { id: bestId, similarity: bestSim };
}

/**
 * Detect uncertainty reasons for a cluster.
 * Checks multiple conditions in deterministic order.
 */
function detectUncertainty(
    paragraphIds: string[],
    paragraphsById: Map<string, ShadowParagraph>,
    cohesion: number,
    pairwiseCohesionScore: number,
    config: ClusteringConfig
): { uncertain: boolean; reasons: string[] } {
    const reasons: string[] = [];

    // Check in fixed order for determinism

    // 1. Low cohesion
    if (cohesion < config.lowCohesionThreshold) {
        reasons.push('low_cohesion');
    }

    const dumbbellGap = 0.10;
    if (
        paragraphIds.length >= 4 &&
        cohesion >= config.lowCohesionThreshold &&
        pairwiseCohesionScore < config.lowCohesionThreshold &&
        cohesion - pairwiseCohesionScore >= dumbbellGap
    ) {
        reasons.push('dumbbell_cluster');
    }

    // 2. Oversized
    if (paragraphIds.length > config.maxClusterSize) {
        reasons.push('oversized');
    }

    // 3. Stance diversity
    const uniqueStances = new Set<string>();
    for (const pid of paragraphIds) {
        const p = paragraphsById.get(pid);
        if (p) uniqueStances.add(p.dominantStance);
    }
    if (uniqueStances.size >= config.stanceDiversityThreshold) {
        reasons.push('stance_diversity');
    }

    // 4. Contested ratio
    let contestedCount = 0;
    for (const pid of paragraphIds) {
        const p = paragraphsById.get(pid);
        if (p?.contested) contestedCount++;
    }
    const contestedRatio = paragraphIds.length > 0 ? contestedCount / paragraphIds.length : 0;
    if (contestedRatio > config.contestedRatioThreshold) {
        reasons.push('high_contested_ratio');
    }

    // 5. Conflicting signals (tension + conditional both present)
    let hasTension = false;
    let hasConditional = false;
    for (const pid of paragraphIds) {
        const p = paragraphsById.get(pid);
        if (p?.signals.tension) hasTension = true;
        if (p?.signals.conditional) hasConditional = true;
    }
    if (hasTension && hasConditional && paragraphIds.length > 1) {
        reasons.push('conflicting_signals');
    }

    return {
        uncertain: reasons.length > 0,
        reasons,
    };
}

/**
 * Build expansion payload for uncertain clusters.
 * 
 * Deterministic selection with stable ordering.
 * Uses _fullParagraph (raw text), not extracted statements.
 */
function buildExpansion(
    paragraphIds: string[],
    centroidId: string,
    paragraphsById: Map<string, ShadowParagraph>,
    embeddings: Map<string, Float32Array>,
    config: ClusteringConfig
): ParagraphCluster['expansion'] {
    const centroidEmb = embeddings.get(centroidId);
    if (!centroidEmb) {
        return { members: [] };
    }

    // Find most distant members from centroid
    const memberSims = paragraphIds
        .map(pid => {
            const emb = embeddings.get(pid);
            const sim = emb ? quantizeSimilarity(cosineSimilarity(emb, centroidEmb)) : 0;
            return { pid, sim };
        })
        .sort((a, b) => a.sim - b.sim || a.pid.localeCompare(b.pid));  // Tie-break by ID

    // Select: centroid + most distant + fill to limit
    const selected = new Set<string>([centroidId]);
    for (const { pid } of memberSims) {
        if (selected.size >= config.maxExpansionMembers) break;
        selected.add(pid);
    }

    // Build expansion with char budget
    const members: Array<{ paragraphId: string; text: string }> = [];
    let charBudget = config.maxExpansionCharsTotal;

    // Centroid first, then by similarity order (distant first)
    for (const pid of [centroidId, ...memberSims.map(m => m.pid)]) {
        if (!selected.has(pid)) continue;
        selected.delete(pid);  // Don't add twice

        const p = paragraphsById.get(pid);
        if (!p) continue;

        // Use raw _fullParagraph for expansion (not extracted statements)
        const text = clipText(p._fullParagraph || '', config.maxMemberTextChars);
        if (charBudget - text.length < 0) break;

        charBudget -= text.length;
        members.push({ paragraphId: pid, text });
    }

    return { members };
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN FUNCTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Build paragraph clusters from paragraphs and embeddings.
 * 
 * Accepts shadowStatements for building embedding text correctly.
 */
export function buildClusters(
    paragraphs: ShadowParagraph[],
    _shadowStatements: ShadowStatement[],
    embeddings: Map<string, Float32Array>,
    config: ClusteringConfig = DEFAULT_CONFIG,
    mutualGraph?: MutualKnnGraph,
    options?: {
        adjustDistanceByParagraphMeta?: boolean;
    }
): ClusteringResult {
    const startTime = performance.now();

    // Build lookup maps
    const paragraphsById = new Map(paragraphs.map(p => [p.id, p]));
    const paragraphIds = paragraphs.map(p => p.id);

    // Edge case: too few paragraphs
    if (paragraphs.length < config.minParagraphsForClustering) {
        const clusters: ParagraphCluster[] = paragraphs.map((p, idx) => ({
            id: `pc_${idx}`,
            paragraphIds: [p.id],
            statementIds: [...p.statementIds],
            representativeParagraphId: p.id,
            cohesion: 1.0,
            pairwiseCohesion: 1.0,
            uncertain: false,
            uncertaintyReasons: [],
        }));

        return {
            clusters,
            meta: {
                totalClusters: clusters.length,
                singletonCount: clusters.length,
                uncertainCount: 0,
                avgClusterSize: 1,
                maxClusterSize: 1,
                compressionRatio: 1,
                embeddingTimeMs: 0,
                clusteringTimeMs: performance.now() - startTime,
                totalTimeMs: performance.now() - startTime,
            },
        };
    }

    // Edge case: no embeddings (skip clustering)
    if (embeddings.size === 0) {
        const clusters: ParagraphCluster[] = paragraphs.map((p, idx) => ({
            id: `pc_${idx}`,
            paragraphIds: [p.id],
            statementIds: [...p.statementIds],
            representativeParagraphId: p.id,
            cohesion: 1.0,
            pairwiseCohesion: 1.0,
            uncertain: false,
            uncertaintyReasons: [],
        }));

        return {
            clusters,
            meta: {
                totalClusters: clusters.length,
                singletonCount: clusters.length,
                uncertainCount: 0,
                avgClusterSize: 1,
                maxClusterSize: 1,
                compressionRatio: 1,
                embeddingTimeMs: 0,
                clusteringTimeMs: performance.now() - startTime,
                totalTimeMs: performance.now() - startTime,
            },
        };
    }

    // Build distance matrix
    const distances = buildDistanceMatrix(
        paragraphIds,
        embeddings,
        options?.adjustDistanceByParagraphMeta === false ? undefined : paragraphs
    );

    let maxSim = -Infinity;
    let validPairCount = 0;
    let pairsAboveThreshold = 0;
    const topPairs: Array<{ i: string; j: string; sim: number }> = [];

    for (let i = 0; i < paragraphIds.length; i++) {
        for (let j = i + 1; j < paragraphIds.length; j++) {
            const dist = distances[i][j];
            if (!Number.isFinite(dist)) continue;

            const sim = 1 - dist;
            validPairCount++;

            if (sim > maxSim) maxSim = sim;
            if (sim >= config.similarityThreshold) pairsAboveThreshold++;

            if (topPairs.length < 5) {
                topPairs.push({ i: paragraphIds[i], j: paragraphIds[j], sim });
                topPairs.sort((a, b) => b.sim - a.sim);
            } else if (sim > topPairs[topPairs.length - 1].sim) {
                topPairs[topPairs.length - 1] = { i: paragraphIds[i], j: paragraphIds[j], sim };
                topPairs.sort((a, b) => b.sim - a.sim);
            }
        }
    }

    const maxSimSafe = Number.isFinite(maxSim) ? maxSim : 0;
    console.log(`[Clustering] Similarity distribution:`);
    console.log(`  - Max: ${maxSimSafe.toFixed(3)}`);
    console.log(`  - Threshold: ${config.similarityThreshold}`);
    console.log(`  - Pairs above threshold: ${pairsAboveThreshold}/${validPairCount}`);
    console.log(`  - Top pairs:`, topPairs.map(s => `${s.i}-${s.j}: ${s.sim.toFixed(3)}`));
    if (validPairCount > 0 && maxSimSafe < config.similarityThreshold) {
        console.warn(
            `[Clustering] WARNING: Max similarity ${maxSimSafe.toFixed(3)} is below threshold ${config.similarityThreshold} - all singletons expected`
        );
    }

    // Run HAC
    const clusterIndices = hierarchicalCluster(paragraphIds, distances, config, mutualGraph);

    // Build ParagraphCluster objects
    const clusters: ParagraphCluster[] = [];
    let uncertainCount = 0;

    for (let i = 0; i < clusterIndices.length; i++) {
        const indices = clusterIndices[i];
        const memberIds = indices.map(idx => paragraphIds[idx]);

        // Find centroid
        const centroid = findCentroid(memberIds, embeddings);

        // Compute cohesion
        const cohesion = computeCohesion(memberIds, centroid.id, embeddings);
        const pairwiseCohesionScore = pairwiseCohesion(memberIds, embeddings);

        // Detect uncertainty
        const uncertainty = detectUncertainty(memberIds, paragraphsById, cohesion, pairwiseCohesionScore, config);
        if (uncertainty.uncertain) uncertainCount++;

        // Collect statement IDs (stable order, no duplicates)
        const statementIds: string[] = [];
        const seenStatements = new Set<string>();
        for (const pid of memberIds) {
            const p = paragraphsById.get(pid);
            if (p) {
                for (const sid of p.statementIds) {
                    if (!seenStatements.has(sid)) {
                        seenStatements.add(sid);
                        statementIds.push(sid);
                    }
                }
            }
        }

        const cluster: ParagraphCluster = {
            id: `pc_${i}`,
            paragraphIds: memberIds,
            statementIds,
            representativeParagraphId: centroid.id,
            cohesion,
            pairwiseCohesion: pairwiseCohesionScore,
            uncertain: uncertainty.uncertain,
            uncertaintyReasons: uncertainty.reasons,
        };

        // Add expansion if uncertain
        if (uncertainty.uncertain) {
            cluster.expansion = buildExpansion(
                memberIds,
                centroid.id,
                paragraphsById,
                embeddings,
                config
            );
        }

        clusters.push(cluster);
    }

    // Sort: uncertain first, then by size descending
    clusters.sort((a, b) => {
        if (a.uncertain && !b.uncertain) return -1;
        if (!a.uncertain && b.uncertain) return 1;
        return b.paragraphIds.length - a.paragraphIds.length;
    });

    // Renumber IDs after sort for consistent ordering
    clusters.forEach((c, idx) => {
        c.id = `pc_${idx}`;
    });

    // Compute meta
    const clusteringTimeMs = performance.now() - startTime;
    const singletonCount = clusters.filter(c => c.paragraphIds.length === 1).length;
    const sizes = clusters.map(c => c.paragraphIds.length);

    return {
        clusters,
        meta: {
            totalClusters: clusters.length,
            singletonCount,
            uncertainCount,
            avgClusterSize: sizes.length > 0 ? sizes.reduce((a, b) => a + b, 0) / sizes.length : 0,
            maxClusterSize: sizes.length > 0 ? Math.max(...sizes) : 0,
            compressionRatio: paragraphs.length > 0 ? clusters.length / paragraphs.length : 1,
            embeddingTimeMs: 0,  // Set by caller
            clusteringTimeMs,
            totalTimeMs: clusteringTimeMs,
        },
    };
}

/**
 * Convert ShadowParagraph to ClusterableItem.
 * 
 * Build embedding text from original ShadowStatement texts,
 * NOT from _fullParagraph or prompt-clipped paragraph.statements[].text
 */
export function toClusterableItems(
    paragraphs: ShadowParagraph[],
    shadowStatements: ShadowStatement[]
): Array<{ id: string; text: string }> {
    const statementsById = new Map(shadowStatements.map(s => [s.id, s]));

    return paragraphs.map(p => ({
        id: p.id,
        // Build from unclipped statement texts in order
        text: p.statementIds
            .map(sid => statementsById.get(sid)?.text || '')
            .filter(t => t.length > 0)
            .join(' '),
    }));
}

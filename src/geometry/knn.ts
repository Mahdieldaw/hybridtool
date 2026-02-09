// ═══════════════════════════════════════════════════════════════════════════
// TWO-GRAPH BUILDER: kNN + Mutual kNN
// ═══════════════════════════════════════════════════════════════════════════

import type { KnnEdge, MutualKnnEdge, KnnGraph, MutualKnnGraph } from './types';

const QUANTIZATION = 1e6;

/**
 * Quantize similarity for deterministic comparisons.
 */
export function quantize(value: number): number {
    return Math.round(value * QUANTIZATION) / QUANTIZATION;
}

/**
 * Cosine similarity between two normalized vectors.
 */
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
    let dot = 0;
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
        dot += a[i] * b[i];
    }
    return dot;
}

/**
 * Stable tie-breaker: lexicographically smaller ID wins.
 */
function stableTieBreak(idA: string, idB: string, simA: number, simB: number): number {
    if (simA !== simB) return simB - simA; // Higher similarity first
    return idA.localeCompare(idB);          // Lex order for ties
}

/**
 * Build the two-graph substrate: kNN (symmetric union) + Mutual kNN.
 * 
 * kNN: For each node, include edges to its top-K neighbors.
 *      Symmetric union: if A→B exists, B→A also exists.
 * 
 * Mutual: Edge exists only if A is in B's top-K AND B is in A's top-K.
 *         This is the "high-precision backbone" for topology.
 */
export function buildTwoGraphs(
    paragraphIds: string[],
    embeddings: Map<string, Float32Array>,
    k: number = 5
): { knn: KnnGraph; mutual: MutualKnnGraph; top1Sims: Map<string, number>; topKSims: Map<string, number[]> } {
    const n = paragraphIds.length;

    // Step 1: For each node, compute ranked neighbors
    // Map: nodeId → sorted array of { targetId, similarity, rank }
    const rankedNeighbors = new Map<string, Array<{ targetId: string; similarity: number; rank: number }>>();
    const top1Sims = new Map<string, number>();
    const topKSims = new Map<string, number[]>();

    for (let i = 0; i < n; i++) {
        const nodeId = paragraphIds[i];
        const embI = embeddings.get(nodeId);

        if (!embI) {
            rankedNeighbors.set(nodeId, []);
            top1Sims.set(nodeId, 0);
            topKSims.set(nodeId, []);
            continue;
        }

        // Compute similarity to all other nodes
        const sims: Array<{ targetId: string; similarity: number }> = [];

        for (let j = 0; j < n; j++) {
            if (i === j) continue;
            const targetId = paragraphIds[j];
            const embJ = embeddings.get(targetId);
            if (!embJ) continue;

            const sim = quantize(cosineSimilarity(embI, embJ));
            sims.push({ targetId, similarity: sim });
        }

        // Sort by similarity desc, then lex for ties (deterministic)
        sims.sort((a, b) => stableTieBreak(a.targetId, b.targetId, a.similarity, b.similarity));

        // Take top-K and assign ranks
        const topK = sims.slice(0, k).map((s, idx) => ({
            targetId: s.targetId,
            similarity: s.similarity,
            rank: idx + 1,  // 1-indexed
        }));

        rankedNeighbors.set(nodeId, topK);
        top1Sims.set(nodeId, topK[0]?.similarity ?? 0);
        topKSims.set(nodeId, topK.map(t => t.similarity));
    }

    // Step 2: Build kNN graph (symmetric union)
    const knnEdgeMap = new Map<string, KnnEdge>(); // canonical key → edge
    const knnAdjacency = new Map<string, KnnEdge[]>();

    // Initialize adjacency
    for (const id of paragraphIds) {
        knnAdjacency.set(id, []);
    }

    for (const [sourceId, neighbors] of rankedNeighbors) {
        for (const { targetId, similarity, rank } of neighbors) {
            // Canonical edge key (smaller id first)
            const key = sourceId < targetId ? `${sourceId}|${targetId}` : `${targetId}|${sourceId}`;

            if (!knnEdgeMap.has(key)) {
                // Create edge (use source's perspective for rank)
                const edge: KnnEdge = {
                    source: sourceId,
                    target: targetId,
                    similarity,
                    rank,
                };
                knnEdgeMap.set(key, edge);

                // Add to both directions in adjacency
                knnAdjacency.get(sourceId)!.push(edge);
                knnAdjacency.get(targetId)!.push({
                    source: targetId,
                    target: sourceId,
                    similarity,
                    rank, // Note: rank from source's perspective
                });
            }
        }
    }

    // Step 3: Build mutual kNN graph
    const mutualEdges: MutualKnnEdge[] = [];
    const mutualAdjacency = new Map<string, MutualKnnEdge[]>();

    for (const id of paragraphIds) {
        mutualAdjacency.set(id, []);
    }

    // Check each kNN edge for mutuality
    for (const edge of knnEdgeMap.values()) {
        const sourceNeighbors = rankedNeighbors.get(edge.source) ?? [];
        const targetNeighbors = rankedNeighbors.get(edge.target) ?? [];

        // Check if source is in target's top-K
        const sourceInTarget = targetNeighbors.find(n => n.targetId === edge.source);
        // Check if target is in source's top-K
        const targetInSource = sourceNeighbors.find(n => n.targetId === edge.target);

        if (sourceInTarget && targetInSource) {
            // Mutual edge! Use min rank for symmetry
            const mutualRank = Math.min(sourceInTarget.rank, targetInSource.rank);

            const mutualEdge: MutualKnnEdge = {
                source: edge.source,
                target: edge.target,
                similarity: edge.similarity,
                rank: mutualRank,
            };

            mutualEdges.push(mutualEdge);
            mutualAdjacency.get(edge.source)!.push(mutualEdge);
            mutualAdjacency.get(edge.target)!.push({
                source: edge.target,
                target: edge.source,
                similarity: edge.similarity,
                rank: mutualRank,
            });
        }
    }

    // Sort edges deterministically
    const sortEdges = <T extends KnnEdge>(edges: T[]): T[] => {
        return edges.sort((a, b) => {
            const keyA = a.source < a.target ? `${a.source}|${a.target}` : `${a.target}|${a.source}`;
            const keyB = b.source < b.target ? `${b.source}|${b.target}` : `${b.target}|${b.source}`;
            return keyA.localeCompare(keyB);
        });
    };

    return {
        knn: {
            k,
            edges: sortEdges(Array.from(knnEdgeMap.values())),
            adjacency: knnAdjacency,
        },
        mutual: {
            k,
            edges: sortEdges(mutualEdges),
            adjacency: mutualAdjacency,
        },
        top1Sims,
        topKSims,
    };
}

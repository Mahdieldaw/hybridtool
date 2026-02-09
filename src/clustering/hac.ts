// ═══════════════════════════════════════════════════════════════════════════
// HIERARCHICAL AGGLOMERATIVE CLUSTERING
// ═══════════════════════════════════════════════════════════════════════════

import { ClusteringConfig } from './config';
import { quantizeSimilarity } from './distance';
import type { MutualKnnGraph } from '../geometry/types';

/**
 * Average linkage: mean distance between all pairs across clusters.
 * This is generally best for semantic clustering.
 */
function averageLinkage(
    clusterA: Set<number>,
    clusterB: Set<number>,
    distances: number[][]
): number {
    let sum = 0;
    let count = 0;

    for (const i of clusterA) {
        for (const j of clusterB) {
            sum += distances[i][j];
            count++;
        }
    }

    return count > 0 ? sum / count : Infinity;
}

/**
 * Hierarchical Agglomerative Clustering with threshold-based stopping.
 * 
 * Includes stable tie-breakers and max clusters safety limit.
 * 
 * Key behavior:
 * - Cluster count is EMERGENT from data, not forced
 * - Algorithm stops when nothing is similar enough to merge
 * - If cluster count exceeds maxClusters, warns but respects threshold (no forced merges)
 * 
 * @param paragraphIds - Array of paragraph IDs in stable order
 * @param distances - Distance matrix (pre-computed, quantized)
 * @param config - Clustering configuration
 * @returns Array of clusters, each cluster is array of paragraph indices
 */
export function hierarchicalCluster(
    paragraphIds: string[],
    distances: number[][],
    config: ClusteringConfig,
    mutualGraph?: MutualKnnGraph
): number[][] {
    const n = paragraphIds.length;

    // Edge case: too few items
    if (n < config.minParagraphsForClustering) {
        return Array.from({ length: n }, (_, i) => [i]);
    }

    const mutualEdges = new Set<string>();
    if (mutualGraph) {
        for (const edge of mutualGraph.edges) {
            const key = edge.source < edge.target
                ? `${edge.source}|${edge.target}`
                : `${edge.target}|${edge.source}`;
            mutualEdges.add(key);
        }
    }

    // Initialize: each item is its own cluster with stable IDs
    const clusters: Set<number>[] = Array.from({ length: n }, (_, i) => new Set([i]));
    const active = new Set(Array.from({ length: n }, (_, i) => i));

    // Convert similarity threshold to distance threshold
    const distanceThreshold = 1 - config.similarityThreshold;

    // Merge loop
    while (active.size > 1) {
        // Find closest pair with stable ordering for tie-breaking
        let minDist = Infinity;
        let minI = -1;
        let minJ = -1;

        // Stable order for determinism
        const activeArray = Array.from(active).sort((a, b) => a - b);

        for (let ai = 0; ai < activeArray.length; ai++) {
            for (let aj = ai + 1; aj < activeArray.length; aj++) {
                const i = activeArray[ai];
                const j = activeArray[aj];
                let dist = quantizeSimilarity(averageLinkage(clusters[i], clusters[j], distances));

                if (mutualGraph) {
                    let hasMutual = false;
                    for (const idxI of clusters[i]) {
                        for (const idxJ of clusters[j]) {
                            const nodeI = paragraphIds[idxI];
                            const nodeJ = paragraphIds[idxJ];
                            const key = nodeI < nodeJ ? `${nodeI}|${nodeJ}` : `${nodeJ}|${nodeI}`;
                            if (mutualEdges.has(key)) {
                                hasMutual = true;
                                break;
                            }
                        }
                        if (hasMutual) break;
                    }

                    if (hasMutual) {
                        dist = quantizeSimilarity(dist * 0.9);
                    }
                }

                // Stable tie-breaker - prefer lower index pairs
                if (dist < minDist || (dist === minDist && (i < minI || (i === minI && j < minJ)))) {
                    minDist = dist;
                    minI = i;
                    minJ = j;
                }
            }
        }

        // Stop conditions with max clusters safety

        // HARD STOP: Never merge beyond threshold
        if (minDist > distanceThreshold) {
            // Safety cap: warn if approaching limit, but don't force bad merges
            if (active.size > config.maxClusters * 0.8) {
                console.debug(
                    `[HAC] Stopping at ${active.size} clusters (threshold exceeded). ` +
                    `Consider lowering similarityThreshold if more clusters needed.`
                );
            }
            break; // No more valid merges exist
        }

        // Merge j into i
        for (const idx of clusters[minJ]) {
            clusters[minI].add(idx);
        }
        active.delete(minJ);
    }

    // If we exceed maxClusters due to threshold, log it but don't lie
    if (active.size > config.maxClusters) {
        console.warn(
            `[HAC] Produced ${active.size} clusters (exceeds max ${config.maxClusters}). ` +
            `Data is genuinely fragmented at threshold ${config.similarityThreshold}.`
        );
    }

    // Convert to stable array format
    return Array.from(active)
        .sort((a, b) => a - b)
        .map(i => Array.from(clusters[i]).sort((a, b) => a - b));
}

// ═══════════════════════════════════════════════════════════════════════════
// MUTUAL RECOGNITION GRAPH
//
// Builds a graph where edges exist only when two nodes mutually exceed each
// other's locally-derived similarity threshold:
//
//   threshold_P = mean(sim(P,*)) + stddev(sim(P,*))
//   edge(P,Q) iff sim(P,Q) > threshold_P AND sim(P,Q) > threshold_Q
//
// INVERSION TEST: L1. Pure math on pairwise similarity distributions.
// ═══════════════════════════════════════════════════════════════════════════

import type {
    PairwiseField,
    MutualRankEdge,
    MutualRankGraph,
    MutualRankNodeStats,
    MutualRecognitionThresholdStats,
} from './types';

/**
 * Build mutual recognition graph from the pairwise field.
 *
 * @param pairwiseField - Full N×N pairwise similarity field
 */
export function buildMutualRankGraph(
    pairwiseField: PairwiseField,
): MutualRankGraph {
    const { perNode } = pairwiseField;

    const thresholdStats = new Map<string, MutualRecognitionThresholdStats>();
    const notableLookup = new Map<string, Set<string>>();

    for (const [nodeId, neighbors] of perNode) {
        const count = neighbors.length;
        if (count === 0) {
            const stats: MutualRecognitionThresholdStats = {
                paragraphId: nodeId,
                mean: 0,
                stddev: 0,
                threshold: 0,
                notableNeighborCount: 0,
            };
            thresholdStats.set(nodeId, stats);
            notableLookup.set(nodeId, new Set());
            continue;
        }

        let sum = 0;
        for (const n of neighbors) sum += n.similarity;
        const mean = sum / count;

        let variance = 0;
        for (const n of neighbors) {
            const d = n.similarity - mean;
            variance += d * d;
        }
        variance /= count;
        const stddev = Math.sqrt(variance);
        const threshold = mean + stddev;

        const notable = new Set<string>();
        for (const n of neighbors) {
            if (n.similarity > threshold) notable.add(n.nodeId);
        }

        thresholdStats.set(nodeId, {
            paragraphId: nodeId,
            mean,
            stddev,
            threshold,
            notableNeighborCount: notable.size,
        });
        notableLookup.set(nodeId, notable);
    }

    // Find mutual edges (canonical dedup: source < target)
    const edges: MutualRankEdge[] = [];
    const seen = new Set<string>();

    for (const [nodeId, notableNeighbors] of notableLookup) {
        for (const neighborId of notableNeighbors) {
            const canonicalKey = nodeId < neighborId
                ? `${nodeId}|${neighborId}`
                : `${neighborId}|${nodeId}`;
            if (seen.has(canonicalKey)) continue;

            const neighborNotables = notableLookup.get(neighborId);
            if (!neighborNotables) continue;
            if (!neighborNotables.has(nodeId)) continue;

            const source = nodeId < neighborId ? nodeId : neighborId;
            const target = nodeId < neighborId ? neighborId : nodeId;
            const simAB = pairwiseField.matrix.get(source)?.get(target);
            const simBA = pairwiseField.matrix.get(target)?.get(source);
            const similarity = simAB ?? simBA ?? 0;
            if (simAB === undefined && simBA === undefined) {
                console.warn(`[MutualRank] Missing similarity for pair ${source}|${target}`);
            }

            edges.push({ source, target, similarity });
            seen.add(canonicalKey);
        }
    }

    // Sort edges deterministically
    edges.sort((a, b) => {
        const keyA = `${a.source}|${a.target}`;
        const keyB = `${b.source}|${b.target}`;
        return keyA.localeCompare(keyB);
    });

    // Build adjacency (both directions)
    const adjacency = new Map<string, MutualRankEdge[]>();
    for (const nodeId of perNode.keys()) {
        adjacency.set(nodeId, []);
    }

    for (const edge of edges) {
        adjacency.get(edge.source)!.push(edge);
        adjacency.get(edge.target)!.push({
            source: edge.target,
            target: edge.source,
            similarity: edge.similarity,
        });
    }

    // Build per-node stats
    const nodeStats = new Map<string, MutualRankNodeStats>();
    for (const nodeId of perNode.keys()) {
        const neighbors = adjacency.get(nodeId) || [];
        const neighborIds = neighbors.map(e => e.target);
        const neighborhood = [nodeId, ...neighborIds].sort((a, b) => a.localeCompare(b));

        nodeStats.set(nodeId, {
            paragraphId: nodeId,
            mutualRankDegree: neighbors.length,
            isolated: neighbors.length === 0,
            mutualRankNeighborhood: neighborhood,
        });
    }

    return {
        edges,
        adjacency,
        nodeStats,
        thresholdStats,
    };
}

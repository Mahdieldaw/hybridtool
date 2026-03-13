// ═══════════════════════════════════════════════════════════════════════════
// PER-NODE LOCAL STATS
// ═══════════════════════════════════════════════════════════════════════════

import type { ShadowParagraph } from '../shadow/ShadowParagraphProjector';
import type { NodeLocalStats, KnnGraph, MutualKnnGraph, StrongGraph, MutualRankGraph } from './types';
import { quantize } from './knn';

/**
 * Compute local stats for each paragraph node.
 *
 * Step 7: mutualNeighborhoodPatch now uses mutual recognition (μ+σ) neighbors
 * when available, falling back to mutual kNN neighbors for backward compat.
 */
export function computeNodeStats(
    paragraphs: ShadowParagraph[],
    knn: KnnGraph,
    mutual: MutualKnnGraph,
    strong: StrongGraph,
    top1Sims: Map<string, number>,
    topKSims: Map<string, number[]>,
    mutualRankGraph?: MutualRankGraph,
    basinInversionResult?: any, // Topographic data
): NodeLocalStats[] {
    const nodes: NodeLocalStats[] = [];

    for (const p of paragraphs) {
        const id = p.id;

        // Similarity stats
        const t1 = top1Sims.get(id) ?? 0;
        const topK = topKSims.get(id) ?? [];
        const avgTopK = topK.length > 0
            ? topK.reduce((a, b) => a + b, 0) / topK.length
            : 0;

        // Degree in each graph
        const knnDegree = knn.adjacency.get(id)?.length ?? 0;
        const mutualDegree = mutual.adjacency.get(id)?.length ?? 0;
        const strongDegree = strong.adjacency.get(id)?.length ?? 0;

        // Isolation score (higher = more isolated)
        const isolationScore = quantize(1 - t1);

        // Mutual neighborhood patch: use mutual recognition (μ+σ) neighbors when available
        const mrStats = mutualRankGraph?.nodeStats.get(id);
        const patch = mrStats?.mutualRankNeighborhood ?? [id];

        const mutualRankDegree = mrStats?.mutualRankDegree;

        nodes.push({
            paragraphId: id,
            modelIndex: p.modelIndex,
            dominantStance: p.dominantStance,
            contested: p.contested,
            statementIds: [...p.statementIds],

            top1Sim: t1,
            avgTopKSim: quantize(avgTopK),

            knnDegree,
            mutualDegree,
            strongDegree,

            isolationScore,
            mutualNeighborhoodPatch: patch,
            mutualRankDegree,
            basinId: basinInversionResult?.basinByNodeId?.[id] ?? undefined,
        });
    }

    // Sort deterministically by paragraphId
    nodes.sort((a, b) => a.paragraphId.localeCompare(b.paragraphId));

    return nodes;
}

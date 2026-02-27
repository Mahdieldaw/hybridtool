// ═══════════════════════════════════════════════════════════════════════════
// GEOMETRIC SUBSTRATE BUILDER
// ═══════════════════════════════════════════════════════════════════════════
import { classifyShape, ShapeClassification } from './shape';
import type { ShadowParagraph } from '../shadow/ShadowParagraphProjector';
import type {
    GeometricSubstrate,
    DegenerateSubstrate,
    DegenerateReason,
    NodeLocalStats
} from './types';
import { buildTwoGraphs, buildPairwiseField } from './knn';
import {
    computeSoftThreshold,
    buildStrongGraph,
    computeSimilarityStats,
    computeExtendedSimilarityStats,
    DEFAULT_THRESHOLD_CONFIG,
    ThresholdConfig
} from './threshold';
import { computeMutualRankTopology } from './topology';
import { buildMutualRankGraph } from './mutualRank';
import { computeNodeStats } from './nodes';
import { computeUmapLayout } from './layout';

export interface SubstrateConfig {
    k: number;
    threshold: ThresholdConfig;
    minParagraphs: number;
}

export const DEFAULT_SUBSTRATE_CONFIG: SubstrateConfig = {
    k: 5,
    threshold: DEFAULT_THRESHOLD_CONFIG,
    minParagraphs: 3,
};

/**
 * Build the complete geometric substrate from paragraphs and embeddings.
 * 
 * GUARANTEES:
 * - Always returns a valid substrate (never null)
 * - Degenerate cases explicitly marked
 * - All similarities quantized for determinism
 * - Tie-breaks are lexicographic
 */
export function buildGeometricSubstrate(
    paragraphs: ShadowParagraph[],
    embeddings: Map<string, Float32Array> | null,
    embeddingBackend: 'webgpu' | 'wasm' | 'none',
    config: SubstrateConfig = DEFAULT_SUBSTRATE_CONFIG
): GeometricSubstrate | DegenerateSubstrate {
    const startTime = performance.now();
    const paragraphIds = paragraphs.map(p => p.id);
    const n = paragraphIds.length;

    // ─────────────────────────────────────────────────────────────────────────
    // DEGENERATE CASE 1: Insufficient paragraphs
    // ─────────────────────────────────────────────────────────────────────────
    if (n < config.minParagraphs) {
        return buildDegenerateSubstrate(
            paragraphs,
            'insufficient_paragraphs',
            embeddingBackend,
            config,
            performance.now() - startTime
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // DEGENERATE CASE 2: No embeddings
    // ─────────────────────────────────────────────────────────────────────────
    if (!embeddings || embeddings.size === 0) {
        return buildDegenerateSubstrate(
            paragraphs,
            'embedding_failure',
            embeddingBackend,
            config,
            performance.now() - startTime
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // BUILD TWO-GRAPH STRUCTURE
    // ─────────────────────────────────────────────────────────────────────────
    const { knn, mutual, top1Sims, topKSims, allPairwiseSimilarities } = buildTwoGraphs(
        paragraphIds,
        embeddings,
        config.k
    );

    // ─────────────────────────────────────────────────────────────────────────
    // BUILD PAIRWISE FIELD (full N×N matrix)
    // ─────────────────────────────────────────────────────────────────────────
    const pairwiseField = buildPairwiseField(paragraphIds, embeddings);

    // ─────────────────────────────────────────────────────────────────────────
    // DEGENERATE CASE 3: All embeddings identical (all similarities = 1.0)
    // ─────────────────────────────────────────────────────────────────────────
    const allSims = Array.from(topKSims.values()).flat();
    const uniqueSims = new Set(allSims);
    if (uniqueSims.size === 1 && allSims.length > 0) {
        return buildDegenerateSubstrate(
            paragraphs,
            'all_embeddings_identical',
            embeddingBackend,
            config,
            performance.now() - startTime
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // BUILD MUTUAL RANK GRAPH (μ+σ mutual recognition — the structural backbone)
    // ─────────────────────────────────────────────────────────────────────────
    const mutualRankGraph = buildMutualRankGraph(pairwiseField);
    const mutualRankTopology = computeMutualRankTopology(mutualRankGraph, paragraphIds);

    // ─────────────────────────────────────────────────────────────────────────
    // PRIMARY TOPOLOGY — from mutual recognition graph (Step 7: replaces strong graph)
    // ─────────────────────────────────────────────────────────────────────────
    const topology: import('./types').TopologyMetrics = {
        components: mutualRankTopology.components,
        componentCount: mutualRankTopology.componentCount,
        largestComponentRatio: mutualRankTopology.largestComponentRatio,
        isolationRatio: mutualRankTopology.isolationRatio,
        globalStrongDensity: paragraphIds.length > 1
            ? mutualRankGraph.edges.length / ((paragraphIds.length * (paragraphIds.length - 1)) / 2)
            : 0,
        convergentField: mutualRankTopology.convergentField,
    };

    // ─────────────────────────────────────────────────────────────────────────
    // LEGACY: soft threshold + strong graph (diagnostic only, not structural backbone)
    // ─────────────────────────────────────────────────────────────────────────
    const softThreshold = computeSoftThreshold(top1Sims, config.threshold);
    const strong = buildStrongGraph(
        mutual,
        paragraphIds,
        softThreshold,
        config.threshold.method
    );

    const shape = classifyShape(topology, n);

    const layout2d = computeUmapLayout(paragraphIds, embeddings);

    // ─────────────────────────────────────────────────────────────────────────
    // COMPUTE NODE STATS
    // ─────────────────────────────────────────────────────────────────────────
    const nodes = computeNodeStats(
        paragraphs,
        knn,
        mutual,
        strong,
        top1Sims,
        topKSims,
        mutualRankGraph,
    );

    const similarityStats = computeSimilarityStats(topKSims);
    const extendedSimilarityStats = computeExtendedSimilarityStats(topKSims);
    // Discrimination range check (from pairwise field, not top-K)
    const discriminationRange = pairwiseField.stats.discriminationRange;
    if (discriminationRange < 0.10) {
        console.warn(
            `[Substrate] Insufficient embedding discrimination: ` +
            `range P90-P10 = ${discriminationRange.toFixed(3)} < 0.10. ` +
            `Downstream thresholds may not be meaningful.`
        );
    }
    if (similarityStats.max < 0.7) {
        console.warn(
            `[Substrate] Extremely low max similarity (${similarityStats.max.toFixed(3)}). ` +
            `Embeddings may be degraded or content is genuinely unrelated.`
        );
    }
    if (similarityStats.mean < 0.4) {
        console.warn(
            `[Substrate] Low mean similarity (${similarityStats.mean.toFixed(3)}). ` +
            `This suggests high diversity or weak semantic coherence.`
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ASSEMBLE SUBSTRATE
    // ─────────────────────────────────────────────────────────────────────────
    const buildTimeMs = performance.now() - startTime;

    return {
        nodes,

        graphs: {
            knn,
            mutual,
            strong,
        },

        topology,
        shape,
        layout2d,
        pairwiseField,
        mutualRankGraph,
        mutualRankTopology,
        meta: {
            embeddingSuccess: true,
            embeddingBackend,
            nodeCount: n,

            knnEdgeCount: knn.edges.length,
            mutualEdgeCount: mutual.edges.length,
            strongEdgeCount: strong.edges.length,

            similarityStats,
            extendedSimilarityStats,
            allPairwiseSimilarities,

            quantization: '1e-6',
            tieBreaker: 'lexicographic',

            buildTimeMs,
        },
    };
}

/**
 * Build a degenerate substrate when normal construction is impossible.
 * 
 * Even in degenerate cases, the substrate structure is valid:
 * - Every node is its own component
 * - All edges are empty
 * - Topology reflects total fragmentation
 */
function buildDegenerateSubstrate(
    paragraphs: ShadowParagraph[],
    reason: DegenerateReason,
    embeddingBackend: 'webgpu' | 'wasm' | 'none',
    config: SubstrateConfig,
    buildTimeMs: number
): DegenerateSubstrate {
    const paragraphIds = paragraphs.map(p => p.id);
    const n = paragraphIds.length;

    // Build empty graphs
    const emptyAdjacency = new Map<string, never[]>();
    for (const id of paragraphIds) {
        emptyAdjacency.set(id, []);
    }

    // Build isolated nodes
    const nodes: NodeLocalStats[] = paragraphs.map(p => ({
        paragraphId: p.id,
        modelIndex: p.modelIndex,
        dominantStance: p.dominantStance,
        contested: p.contested,
        statementIds: [...p.statementIds],

        top1Sim: 0,
        avgTopKSim: 0,

        knnDegree: 0,
        mutualDegree: 0,
        strongDegree: 0,

        isolationScore: 1,
        mutualNeighborhoodPatch: [p.id], // Only self
    }));

    // Build singleton components
    const components = paragraphIds.map((id, idx) => ({
        id: `comp_${idx}`,
        nodeIds: [id],
        size: 1,
        internalDensity: 0,
    }));

    const topology = {
        components,
        componentCount: n,
        largestComponentRatio: n > 0 ? 1 / n : 0,
        isolationRatio: 1,
        globalStrongDensity: 0,
    };

    const shape: ShapeClassification = classifyShape(topology, n);

    return {
        degenerate: true,
        degenerateReason: reason,

        nodes,

        graphs: {
            knn: { k: config.k, edges: [], adjacency: new Map(emptyAdjacency) },
            mutual: { k: config.k, edges: [], adjacency: new Map(emptyAdjacency) },
            strong: {
                softThreshold: 0,
                thresholdMethod: config.threshold.method,
                edges: [],
                adjacency: new Map(emptyAdjacency)
            },
        },

        topology,

        shape,

        meta: {
            embeddingSuccess: reason !== 'embedding_failure',
            embeddingBackend,
            nodeCount: n,

            knnEdgeCount: 0,
            mutualEdgeCount: 0,
            strongEdgeCount: 0,

            similarityStats: { max: 0, p95: 0, p80: 0, p50: 0, mean: 0 },

            quantization: '1e-6',
            tieBreaker: 'lexicographic',

            buildTimeMs,
        },
    };
}

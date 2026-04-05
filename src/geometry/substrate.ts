// ═══════════════════════════════════════════════════════════════════════════
// GEOMETRIC SUBSTRATE BUILDER
// ═══════════════════════════════════════════════════════════════════════════
import type { ShadowParagraph } from '../shadow/ShadowParagraphProjector';
import type {
    GeometricSubstrate,
    DegenerateSubstrate,
    DegenerateReason,
    NodeLocalStats,
    MutualRankGraph,
    PairwiseField,
} from './types';
import { buildPairwiseField } from './knn';
import { buildMutualRankGraph } from './mutualRank';
import { computeNodeStats } from './nodes';
import { computeUmapLayout } from './layout';

export interface SubstrateConfig {
    minParagraphs: number;
}

export const DEFAULT_SUBSTRATE_CONFIG: SubstrateConfig = {
    minParagraphs: 3,
};

/**
 * Build the complete geometric substrate from paragraphs and embeddings.
 *
 * Pipeline: pairwiseField → mutualRankGraph → nodeStats
 */
export function buildGeometricSubstrate(
    paragraphs: ShadowParagraph[],
    embeddings: Map<string, Float32Array> | null,
    embeddingBackend: 'webgpu' | 'wasm' | 'none',
    config: SubstrateConfig = DEFAULT_SUBSTRATE_CONFIG,
    basinInversionResult?: any,
): GeometricSubstrate | DegenerateSubstrate {
    const startTime = performance.now();
    const paragraphIds = paragraphs.map(p => p.id);
    const n = paragraphIds.length;

    if (n < config.minParagraphs) {
        return buildDegenerateSubstrate(paragraphs, 'insufficient_paragraphs', embeddingBackend, performance.now() - startTime);
    }

    if (!embeddings || embeddings.size === 0) {
        return buildDegenerateSubstrate(paragraphs, 'embedding_failure', embeddingBackend, performance.now() - startTime);
    }

    // ── Pairwise field (full N×N matrix) ────────────────────────────────
    const pairwiseField = buildPairwiseField(paragraphIds, embeddings);

    // Degenerate: all embeddings identical
    if (pairwiseField.stats.discriminationRange === 0 && pairwiseField.nodeCount > 1) {
        return buildDegenerateSubstrate(paragraphs, 'all_embeddings_identical', embeddingBackend, performance.now() - startTime);
    }

    // ── Mutual recognition graph (μ+σ — the structural backbone) ────────
    const mutualRankGraph = buildMutualRankGraph(pairwiseField);

    // ── Node stats ──────────────────────────────────────────────────────
    const nodes = computeNodeStats(paragraphs, mutualRankGraph, basinInversionResult);

    // ── Layout ──────────────────────────────────────────────────────────
    const layout2d = computeUmapLayout(paragraphIds, embeddings);

    // ── Similarity stats (from pairwise field) ─────────────────────────
    const similarityStats = {
        max: pairwiseField.stats.max,
        p95: pairwiseField.stats.p95,
        p80: pairwiseField.stats.p80,
        p50: pairwiseField.stats.p50,
        mean: pairwiseField.stats.mean,
    };

    if (pairwiseField.stats.discriminationRange < 0.10) {
        console.warn(
            `[Substrate] Insufficient embedding discrimination: ` +
            `range P90-P10 = ${pairwiseField.stats.discriminationRange.toFixed(3)} < 0.10.`
        );
    }

    const buildTimeMs = performance.now() - startTime;

    return {
        nodes,
        pairwiseField,
        mutualRankGraph,
        layout2d,
        meta: {
            embeddingSuccess: true,
            embeddingBackend,
            nodeCount: n,
            similarityStats,
            quantization: '1e-6',
            tieBreaker: 'lexicographic',
            buildTimeMs,
        },
    };
}

function buildDegenerateSubstrate(
    paragraphs: ShadowParagraph[],
    reason: DegenerateReason,
    embeddingBackend: 'webgpu' | 'wasm' | 'none',
    buildTimeMs: number,
): DegenerateSubstrate {
    const n = paragraphs.length;

    const nodes: NodeLocalStats[] = paragraphs.map(p => ({
        paragraphId: p.id,
        modelIndex: p.modelIndex,
        dominantStance: p.dominantStance,
        contested: p.contested,
        statementIds: [...p.statementIds],
        isolationScore: 1,
        mutualNeighborhoodPatch: [p.id],
        mutualRankDegree: 0,
    }));

    // Empty mutual rank graph
    const nodeStats = new Map<string, import('./types').MutualRankNodeStats>();
    for (const p of paragraphs) {
        nodeStats.set(p.id, {
            paragraphId: p.id,
            mutualRankDegree: 0,
            isolated: true,
            mutualRankNeighborhood: [p.id],
        });
    }
    const mutualRankGraph: MutualRankGraph = {
        edges: [],
        adjacency: new Map(paragraphs.map(p => [p.id, []])),
        nodeStats,
        thresholdStats: new Map(),
    };

    // Empty pairwise field
    const pairwiseField: PairwiseField = {
        matrix: new Map(paragraphs.map(p => [p.id, new Map()])),
        perNode: new Map(paragraphs.map(p => [p.id, []])),
        stats: { count: 0, min: 0, p10: 0, p25: 0, p50: 0, p75: 0, p80: 0, p90: 0, p95: 0, max: 0, mean: 0, stddev: 0, discriminationRange: 0 },
        nodeCount: n,
    };

    return {
        degenerate: true,
        degenerateReason: reason,
        nodes,
        pairwiseField,
        mutualRankGraph,
        meta: {
            embeddingSuccess: reason !== 'embedding_failure',
            embeddingBackend,
            nodeCount: n,
            similarityStats: { max: 0, p95: 0, p80: 0, p50: 0, mean: 0 },
            quantization: '1e-6',
            tieBreaker: 'lexicographic',
            buildTimeMs,
        },
    };
}

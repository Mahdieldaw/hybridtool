// ===========================================================================
// GEOMETRIC SUBSTRATE TYPES
// ===========================================================================

import type { Stance } from '../shadow/StatementTypes';
import type { ExtendedSimilarityStats } from './threshold';

// ------------------------------------------------------------------------------
// NODE STATS
// ------------------------------------------------------------------------------

export interface NodeLocalStats {
    paragraphId: string;
    modelIndex: number;
    dominantStance: Stance;
    contested: boolean;
    statementIds: string[];

    isolationScore: number;       // 0 = connected hub, 1 = fully isolated

    // From mutual recognition graph (μ+σ)
    mutualNeighborhoodPatch: string[];
    mutualRankDegree: number;

    // topographic basin id (from density inversion)
    basinId?: number;
}

// ------------------------------------------------------------------------------
// PAIRWISE FIELD (full N×N similarity matrix)
// ------------------------------------------------------------------------------

export interface PairwiseFieldStats extends ExtendedSimilarityStats {
    discriminationRange: number;  // p90 - p10
}

export interface PairwiseField {
    matrix: Map<string, Map<string, number>>;
    perNode: Map<string, Array<{ nodeId: string; similarity: number }>>;
    stats: PairwiseFieldStats;
    nodeCount: number;
}

// ------------------------------------------------------------------------------
// MUTUAL RECOGNITION GRAPH (μ+σ mutual recognition, no parameters)
// ------------------------------------------------------------------------------

export interface MutualRankEdge {
    source: string;
    target: string;
    similarity: number;
}

export interface MutualRecognitionThresholdStats {
    paragraphId: string;
    mean: number;
    stddev: number;
    threshold: number; // mean + stddev
    notableNeighborCount: number;
}

export interface MutualRankNodeStats {
    paragraphId: string;
    mutualRankDegree: number;
    isolated: boolean;
    mutualRankNeighborhood: string[];  // [self + neighbors], sorted
}

export interface MutualRankGraph {
    edges: MutualRankEdge[];
    adjacency: Map<string, MutualRankEdge[]>;
    nodeStats: Map<string, MutualRankNodeStats>;
    thresholdStats: Map<string, MutualRecognitionThresholdStats>;
}

export interface Layout2D {
    method: 'umap' | 'spectral' | 'force';
    coordinates: Record<string, [number, number]>;
    buildTimeMs: number;
}

// ------------------------------------------------------------------------------
// FULL SUBSTRATE
// ------------------------------------------------------------------------------

export interface GeometricSubstrate {
    nodes: NodeLocalStats[];

    pairwiseField: PairwiseField;
    mutualRankGraph: MutualRankGraph;

    layout2d?: Layout2D;

    meta: {
        embeddingSuccess: boolean;
        embeddingBackend: 'webgpu' | 'wasm' | 'none';
        nodeCount: number;

        similarityStats: {
            max: number;
            p95: number;
            p80: number;
            p50: number;
            mean: number;
        };

        quantization: '1e-6';
        tieBreaker: 'lexicographic';
        buildTimeMs: number;
    };
}

// ------------------------------------------------------------------------------
// DEGENERATE SUBSTRATE (embedding failure)
// ------------------------------------------------------------------------------

export type DegenerateReason =
    | 'embedding_failure'
    | 'insufficient_paragraphs'
    | 'all_embeddings_identical';

export interface DegenerateSubstrate extends GeometricSubstrate {
    degenerate: true;
    degenerateReason: DegenerateReason;
}

export function isDegenerate(s: GeometricSubstrate): s is DegenerateSubstrate {
    return 'degenerate' in s && s.degenerate === true;
}

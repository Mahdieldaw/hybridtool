// ═══════════════════════════════════════════════════════════════════════════
// GEOMETRIC SUBSTRATE TYPES
// ═══════════════════════════════════════════════════════════════════════════

import type { Stance } from '../shadow/StatementTypes';
import type { ShapeClassification } from './shape';
import type { ExtendedSimilarityStats } from './threshold';

// ───────────────────────────────────────────────────────────────────────────
// EDGES
// ───────────────────────────────────────────────────────────────────────────

export interface KnnEdge {
    source: string;           // p_* id
    target: string;           // p_* id
    similarity: number;       // quantized cosine similarity
    rank: number;             // 1 = nearest neighbor of source
}

export interface MutualKnnEdge extends KnnEdge {
    // Mutual edges exist only when A in B's topK AND B in A's topK
    // Rank is min(rankInSource, rankInTarget) for symmetry
}

// ───────────────────────────────────────────────────────────────────────────
// GRAPHS
// ───────────────────────────────────────────────────────────────────────────

export interface KnnGraph {
    k: number;
    edges: KnnEdge[];
    // Adjacency: nodeId → outgoing edges (for fast lookup)
    adjacency: Map<string, KnnEdge[]>;
}

export interface MutualKnnGraph {
    k: number;
    edges: MutualKnnEdge[];
    adjacency: Map<string, MutualKnnEdge[]>;
}

export interface StrongGraph {
    softThreshold: number;
    thresholdMethod: 'p80_top1' | 'p75_top1' | 'fixed';
    edges: MutualKnnEdge[];    // Subset of mutual where sim >= softThreshold
    adjacency: Map<string, MutualKnnEdge[]>;
}

// ───────────────────────────────────────────────────────────────────────────
// NODE STATS
// ───────────────────────────────────────────────────────────────────────────

export interface NodeLocalStats {
    paragraphId: string;
    modelIndex: number;
    dominantStance: Stance;
    contested: boolean;
    statementIds: string[];

    // Similarity stats
    top1Sim: number;              // Best neighbor similarity
    avgTopKSim: number;           // Average of top-K similarities

    // Connectivity stats
    knnDegree: number;            // Degree in kNN graph (usually K due to symmetric union)
    mutualDegree: number;         // Degree in mutual graph
    /** @deprecated Strong graph removed (Step 7). Kept for backward compat. */
    strongDegree: number;         // Degree in strong graph (legacy, always 0 for new builds)

    // Derived
    isolationScore: number;       // 1 - top1Sim (higher = more isolated)

    // Neighborhood patch — now from mutual recognition graph (μ+σ)
    mutualNeighborhoodPatch: string[];

    // Mutual rank degree (from mutual recognition graph)
    mutualRankDegree?: number;
}

// ───────────────────────────────────────────────────────────────────────────
// TOPOLOGY (computed on strong graph)
// ───────────────────────────────────────────────────────────────────────────

export interface Component {
    id: string;                   // comp_0, comp_1, ... (sorted by size desc)
    nodeIds: string[];            // Paragraph IDs in this component
    size: number;
    internalDensity: number;      // edges / max_possible_edges
}

export interface TopologyMetrics {
    components: Component[];
    componentCount: number;
    largestComponentRatio: number;   // largest.size / total nodes
    isolationRatio: number;          // nodes with zero mutual recognition edges / total
    globalStrongDensity: number;     // mutual recognition edges / max possible (renamed from strong for compat)
    convergentField?: boolean;       // largest component > 70%
}

// ───────────────────────────────────────────────────────────────────────────
// PAIRWISE FIELD (full N×N similarity matrix)
// ───────────────────────────────────────────────────────────────────────────

export interface PairwiseFieldStats extends ExtendedSimilarityStats {
    discriminationRange: number;  // p90 - p10
}

export interface PairwiseField {
    matrix: Map<string, Map<string, number>>;
    perNode: Map<string, Array<{ nodeId: string; similarity: number }>>;
    stats: PairwiseFieldStats;
    nodeCount: number;
}

// ───────────────────────────────────────────────────────────────────────────
// MUTUAL RECOGNITION GRAPH (μ+σ mutual recognition, no parameters)
// ───────────────────────────────────────────────────────────────────────────

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

export interface MutualRankTopologyMetrics {
    components: Component[];
    componentCount: number;
    largestComponentRatio: number;
    isolationRatio: number;
    convergentField: boolean;  // largest component > 70%
}

export interface Layout2D {
    method: 'umap' | 'spectral' | 'force';
    coordinates: Record<string, [number, number]>;
    buildTimeMs: number;
}

// ───────────────────────────────────────────────────────────────────────────
// FULL SUBSTRATE
// ───────────────────────────────────────────────────────────────────────────

export interface GeometricSubstrate {
    // Per-node data (always present)
    nodes: NodeLocalStats[];

    // Three connectivity views
    graphs: {
        knn: KnnGraph;              // Local field (always-on, K neighbors per node)
        mutual: MutualKnnGraph;     // High-precision backbone
        strong: StrongGraph;        // Threshold-gated mutual (for components)
    };

    // Topology computed on strong graph
    topology: TopologyMetrics;

    shape: ShapeClassification;

    layout2d?: Layout2D;

    // Pairwise field (full N×N matrix)
    pairwiseField?: PairwiseField;

    // Mutual rank graph (top-τ% mutual recognition)
    mutualRankGraph?: MutualRankGraph;
    mutualRankTopology?: MutualRankTopologyMetrics;

    // Provenance
    meta: {
        embeddingSuccess: boolean;
        embeddingBackend: 'webgpu' | 'wasm' | 'none';
        nodeCount: number;

        // Edge counts
        knnEdgeCount: number;
        mutualEdgeCount: number;
        strongEdgeCount: number;

        // Similarity distribution
        similarityStats: {
            max: number;
            p95: number;
            p80: number;
            p50: number;
            mean: number;
        };
        extendedSimilarityStats?: ExtendedSimilarityStats;

        // Full pairwise distribution (pre-kNN truncation, canonical pairs only)
        allPairwiseSimilarities?: number[];

        // Determinism proof
        quantization: '1e-6';
        tieBreaker: 'lexicographic';

        // Timing
        buildTimeMs: number;
    };
}

// ───────────────────────────────────────────────────────────────────────────
// DEGENERATE SUBSTRATE (embedding failure)
// ───────────────────────────────────────────────────────────────────────────

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

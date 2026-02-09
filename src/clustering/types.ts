// ═══════════════════════════════════════════════════════════════════════════
// CLUSTERING TYPES
// ═══════════════════════════════════════════════════════════════════════════

import type { Stance } from '../shadow/StatementTypes';

export interface ClusterableItem {
    id: string;                      // Paragraph ID (p_*)
    text: string;                    // Full paragraph text for embedding
    modelIndex: number;
    dominantStance: Stance;
    stanceHints: Stance[];
    contested: boolean;
    signals: {
        sequence: boolean;
        tension: boolean;
        conditional: boolean;
    };
    statementIds: string[];          // For provenance tracking
}

export interface ParagraphCluster {
    id: string;                      // "pc_0", "pc_1", ...
    paragraphIds: string[];          // Member paragraph IDs in encounter order
    statementIds: string[];          // Union of all statement IDs, stable order

    // Representative (centroid)
    representativeParagraphId: string;

    // Quality metrics
    cohesion: number;                // 0-1, average similarity to centroid
    pairwiseCohesion: number;        // 0-1, average similarity across all member pairs

    // Uncertainty detection
    uncertain: boolean;
    uncertaintyReasons: string[];    // ["low_cohesion", "dumbbell_cluster", "stance_diversity", "oversized", "high_contested_ratio", "conflicting_signals"]

    // Expansion (only when uncertain=true)
    expansion?: {
        members: Array<{
            paragraphId: string;
            text: string;            // Raw _fullParagraph, clipped ≤700 chars
        }>;
    };
}

export interface ClusteringResult {
    clusters: ParagraphCluster[];
    meta: {
        totalClusters: number;
        singletonCount: number;
        uncertainCount: number;
        avgClusterSize: number;
        maxClusterSize: number;
        compressionRatio: number;    // clusters / paragraphs
        embeddingTimeMs: number;
        clusteringTimeMs: number;
        totalTimeMs: number;
    };
}

// For TypeScript 5.x compatibility, we use a looser Float32Array type
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type EmbeddingVector = Float32Array;

export interface EmbeddingResult {
    embeddings: Map<string, EmbeddingVector>;  // paragraphId -> embedding
    dimensions: number;
    timeMs: number;
}

export interface StatementEmbeddingResult {
    embeddings: Map<string, EmbeddingVector>;  // statementId -> embedding
    dimensions: number;
    statementCount: number;
    timeMs: number;
}

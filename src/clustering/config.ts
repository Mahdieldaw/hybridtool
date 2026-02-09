// ═══════════════════════════════════════════════════════════════════════════
// CLUSTERING CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

export interface ClusteringConfig {
    // Similarity threshold for merging (cosine similarity)
    // Higher = more clusters, stricter matching
    similarityThreshold: number;

    // Max clusters safety limit
    maxClusters: number;

    // Uncertainty detection thresholds
    lowCohesionThreshold: number;
    maxClusterSize: number;
    stanceDiversityThreshold: number;      // Max unique stances before uncertain
    contestedRatioThreshold: number;       // Max ratio of contested paragraphs

    // Expansion limits
    maxExpansionMembers: number;
    maxExpansionCharsTotal: number;
    maxMemberTextChars: number;

    // Embedding configuration
    embeddingDimensions: number;
    modelId: string;

    // Minimum paragraphs to attempt clustering
    minParagraphsForClustering: number;
}

export const DEFAULT_CONFIG: ClusteringConfig = {
    // 0.72 = moderately conservative threshold
    similarityThreshold: 0.72,

    // Safety limit to prevent pathological explosion
    maxClusters: 40,

    // Uncertainty thresholds
    lowCohesionThreshold: 0.70,
    maxClusterSize: 8,
    stanceDiversityThreshold: 3,
    contestedRatioThreshold: 0.30,

    // Expansion limits
    maxExpansionMembers: 6,
    maxExpansionCharsTotal: 2100,
    maxMemberTextChars: 700,

    // Embedding
    embeddingDimensions: 256,
    modelId: 'all-MiniLM-L6-v2',

    // Minimum input
    minParagraphsForClustering: 3,
};

export const CONFIG_PRESETS = {
    highPrecision: {
        ...DEFAULT_CONFIG,
        similarityThreshold: 0.88,
        embeddingDimensions: 384,
    } as ClusteringConfig,

    balanced: DEFAULT_CONFIG,

    highRecall: {
        ...DEFAULT_CONFIG,
        similarityThreshold: 0.78,
    } as ClusteringConfig,

    fast: {
        ...DEFAULT_CONFIG,
        embeddingDimensions: 128,
    } as ClusteringConfig,
} as const;

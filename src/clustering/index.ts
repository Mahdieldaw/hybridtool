// ═══════════════════════════════════════════════════════════════════════════
// CLUSTERING MODULE - PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════

// Embedding types
export type {
    EmbeddingVector,
    EmbeddingResult,
    StatementEmbeddingResult,
    TextEmbeddingResult,
} from './types';

export type { DensityRegressionModel } from './semanticDensity';
export { projectSemanticDensity } from './semanticDensity';

// Configuration
export {
    type ClusteringConfig,
    DEFAULT_CONFIG,
    CONFIG_PRESETS,
} from './config';

// Similarity utilities
export {
    quantizeSimilarity,
    cosineSimilarity,
} from './distance';

// Embedding service
export {
    generateEmbeddings,
    generateStatementEmbeddings,
    generateTextEmbeddings,
    preloadModel,
    getEmbeddingStatus,
    cleanupPendingEmbeddingsBuffers,
    stripInlineMarkdown,
    structuredTruncate,
} from './embeddings';

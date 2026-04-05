// ═══════════════════════════════════════════════════════════════════════════
// CLUSTERING MODULE - PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════

// Configuration
export {
    type EmbeddingConfig,
    DEFAULT_CONFIG,
} from './config';

// Similarity utilities
export {
    cosineSimilarity,
} from './distance';

// Embedding service
export {
    generateEmbeddings,
    generateStatementEmbeddings,
    generateTextEmbeddings,
    getEmbeddingStatus,
    cleanupPendingEmbeddingsBuffers,
    stripInlineMarkdown,
    structuredTruncate,
} from './embeddings';

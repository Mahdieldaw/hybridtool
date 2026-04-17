// ═══════════════════════════════════════════════════════════════════════════
// CLUSTERING MODULE - PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════

// Configuration
export { type EmbeddingConfig, type EmbeddingModelEntry, DEFAULT_CONFIG, EMBEDDING_MODELS, getConfigForModel } from './config';

// Similarity utilities
export { cosineSimilarity } from './distance';

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

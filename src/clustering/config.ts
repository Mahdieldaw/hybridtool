// ═══════════════════════════════════════════════════════════════════════════
// EMBEDDING CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

export interface EmbeddingConfig {
    embeddingDimensions: number;
    modelId: string;
}

export const DEFAULT_CONFIG: EmbeddingConfig = {
    embeddingDimensions: 768,
    modelId: 'bge-base-en-v1.5',
};

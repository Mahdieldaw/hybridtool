// ═══════════════════════════════════════════════════════════════════════════
// EMBEDDING TYPES
// ═══════════════════════════════════════════════════════════════════════════

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

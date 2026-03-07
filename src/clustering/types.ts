// ═══════════════════════════════════════════════════════════════════════════
// EMBEDDING TYPES
// ═══════════════════════════════════════════════════════════════════════════

import type { DensityRegressionModel } from './semanticDensity';

// For TypeScript 5.x compatibility, we use a looser Float32Array type
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type EmbeddingVector = Float32Array;

export interface EmbeddingResult {
    embeddings: Map<string, EmbeddingVector>;  // paragraphId -> embedding
    dimensions: number;
    timeMs: number;
    semanticDensityScores?: Map<string, number>;  // z-scored residual magnitude (paragraph-level)
}

export interface StatementEmbeddingResult {
    embeddings: Map<string, EmbeddingVector>;  // statementId -> embedding
    dimensions: number;
    statementCount: number;
    timeMs: number;
    semanticDensityScores?: Map<string, number>;  // z-scored residual magnitude (observational only)
    densityRegressionModel?: DensityRegressionModel;  // OLS model for downstream projection
}

export interface TextEmbeddingResult {
    embeddings: Map<string, Float32Array>;
    semanticDensityScores?: Map<string, number>;
    rawMagnitudes?: Map<string, number>;
    textLengths?: Map<string, number>;
}

// ═══════════════════════════════════════════════════════════════════════════
// CLUSTERING MODULE - PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════

// Types
export type {
    ClusterableItem,
    ParagraphCluster,
    ClusteringResult,
    EmbeddingResult,
    StatementEmbeddingResult,
} from './types';

// Configuration
export {
    type ClusteringConfig,
    DEFAULT_CONFIG,
    CONFIG_PRESETS,
} from './config';

// Distance utilities
export {
    quantizeSimilarity,
    cosineSimilarity,
    buildDistanceMatrix,
    computeCohesion,
    pairwiseCohesion,
} from './distance';

// HAC algorithm
export { hierarchicalCluster } from './hac';

// Main functions
export {
    generateEmbeddings,
    generateStatementEmbeddings,
    poolToParagraphEmbeddings,
    preloadModel,
    getEmbeddingStatus,
} from './embeddings';
export { buildClusters, toClusterableItems } from './engine';

// Re-export for convenience
import type { ShadowParagraph } from '../shadow/ShadowParagraphProjector';
import type { ShadowStatement } from '../shadow/ShadowExtractor';
import type { ClusteringResult } from './types';
import type { ClusteringConfig } from './config';
import { DEFAULT_CONFIG } from './config';
import { generateEmbeddings } from './embeddings';
import { buildClusters } from './engine';

/**
 * High-level API: Cluster paragraphs end-to-end.
 * Handles embedding generation and clustering in one call.
 * 
 * Requires shadowStatements for building embedding text correctly.
 */
export async function clusterParagraphs(
    paragraphs: ShadowParagraph[],
    shadowStatements: ShadowStatement[],
    config: Partial<ClusteringConfig> = {}
): Promise<ClusteringResult> {
    const mergedConfig: ClusteringConfig = { ...DEFAULT_CONFIG, ...config };

    // Skip if too few paragraphs
    if (paragraphs.length < mergedConfig.minParagraphsForClustering) {
        return buildClusters(paragraphs, shadowStatements, new Map(), mergedConfig);
    }

    // Generate embeddings
    const embeddingResult = await generateEmbeddings(paragraphs, shadowStatements, mergedConfig);

    // Build clusters
    const clusterResult = buildClusters(paragraphs, shadowStatements, embeddingResult.embeddings, mergedConfig);

    // Update timing
    clusterResult.meta.embeddingTimeMs = embeddingResult.timeMs;
    clusterResult.meta.totalTimeMs = embeddingResult.timeMs + clusterResult.meta.clusteringTimeMs;

    return clusterResult;
}

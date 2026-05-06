export interface EmbeddingConfig {
  embeddingDimensions: number;
  modelId: string;
}

export interface EmbeddingModelEntry {
  id: string;
  displayName: string;
  dimensions: number;
  description: string;
}

export const EMBEDDING_MODELS: EmbeddingModelEntry[] = [
  {
    id: 'bge-base-en-v1.5',
    displayName: 'BGE Base',
    dimensions: 768,
    description: 'High-accuracy retrieval model, 768-dim',
  },
  {
    id: 'all-MiniLM-L6-v2',
    displayName: 'MiniLM L6',
    dimensions: 384,
    description: 'Fast, lightweight model, 384-dim',
  },
];

export const DEFAULT_CONFIG: EmbeddingConfig = {
  embeddingDimensions: 768,
  modelId: 'bge-base-en-v1.5',
};

export function getConfigForModel(modelId: string): EmbeddingConfig {
  const entry = EMBEDDING_MODELS.find((model) => model.id === modelId);
  if (!entry) return DEFAULT_CONFIG;
  return { modelId: entry.id, embeddingDimensions: entry.dimensions };
}

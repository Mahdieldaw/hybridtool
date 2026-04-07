/**
 * Corpus Search — cosine similarity over paragraph embeddings.
 *
 * Pure function: takes a query embedding + paragraph embeddings,
 * returns ranked results. No I/O, no side effects.
 */

import { cosineSimilarity } from '../clustering/distance';

export interface CorpusSearchHit {
  paragraphId: string;
  similarity: number;         // raw cosine [-1,1]
  normalizedSim: number;      // (cos+1)/2 for display [0,1]
  modelIndex: number;
  paragraphIndex: number;
}

export function searchCorpus(
  queryEmbedding: Float32Array,
  paragraphEmbeddings: Map<string, Float32Array>,
  paragraphMeta: Array<{ id: string; modelIndex: number; paragraphIndex: number }>,
  maxResults: number = 50,
): CorpusSearchHit[] {
  const hits: CorpusSearchHit[] = [];

  for (const meta of paragraphMeta) {
    const emb = paragraphEmbeddings.get(meta.id);
    if (!emb) continue;

    const sim = cosineSimilarity(queryEmbedding, emb);
    hits.push({
      paragraphId: meta.id,
      similarity: sim,
      normalizedSim: Math.max(0, Math.min(1, (sim + 1) / 2)),
      modelIndex: meta.modelIndex,
      paragraphIndex: meta.paragraphIndex,
    });
  }

  hits.sort((a, b) => b.similarity - a.similarity);
  return hits.slice(0, maxResults);
}

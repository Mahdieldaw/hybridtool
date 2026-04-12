import type { ShadowStatement } from '../shadow/ShadowExtractor';
import type { ShadowParagraph } from '../shadow/ShadowParagraphProjector';
import { cosineSimilarity } from '../clustering/distance';

export interface QueryRelevanceStatementScore {
  querySimilarity: number; // [-1,1] raw cosine (CANONICAL for pipeline decisions)
  querySimilarityNormalized: number; // [0,1] (cos+1)/2 — for UI display only
  simRaw: number; // [-1,1] deprecated alias for querySimilarity
  embeddingSource: 'statement' | 'paragraph' | 'none';
  paragraphSimRaw: number; // [-1,1] raw cosine at paragraph level
}

export interface QueryRelevanceResult {
  statementScores: Map<string, QueryRelevanceStatementScore>;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

export function computeQueryRelevance(input: {
  queryEmbedding: Float32Array;
  statements: ShadowStatement[];
  statementEmbeddings?: Map<string, Float32Array> | null;
  paragraphEmbeddings?: Map<string, Float32Array> | null;
  paragraphs: ShadowParagraph[];
}): QueryRelevanceResult {
  const { queryEmbedding, statements, statementEmbeddings, paragraphEmbeddings, paragraphs } =
    input;

  const statementToParagraph = new Map<string, string>();
  for (const p of paragraphs) {
    for (const sid of p.statementIds) {
      statementToParagraph.set(sid, p.id);
    }
  }

  const statementScores = new Map<string, QueryRelevanceStatementScore>();

  for (const st of statements) {
    const pid = statementToParagraph.get(st.id);
    const stmtEmb = statementEmbeddings ? (statementEmbeddings.get(st.id) ?? null) : null;
    const paraEmb = pid && paragraphEmbeddings ? (paragraphEmbeddings.get(pid) ?? null) : null;

    const emb = stmtEmb || paraEmb || null;
    const embeddingSource: 'statement' | 'paragraph' | 'none' = stmtEmb
      ? 'statement'
      : paraEmb
        ? 'paragraph'
        : 'none';

    const simRaw = emb ? cosineSimilarity(queryEmbedding, emb) : 0;
    const querySimilarity = simRaw;
    const querySimilarityNormalized = clamp01((simRaw + 1) / 2);
    const paragraphSimRaw = paraEmb ? cosineSimilarity(queryEmbedding, paraEmb) : 0;

    statementScores.set(st.id, {
      querySimilarity,
      querySimilarityNormalized,
      simRaw,
      embeddingSource,
      paragraphSimRaw,
    });
  }

  return { statementScores };
}

// ═══════════════════════════════════════════════════════════════════════════
// ANNOTATE — statement enrichment and query relevance
//
// Inlines: enrichment.ts, queryRelevance.ts
//
// Two operations:
//   enrichStatements()      — attach geometric position data to shadow statements
//   computeQueryRelevance() — score statements against a query embedding
// ═══════════════════════════════════════════════════════════════════════════

import type { ShadowStatement } from '../shadow/shadow-extractor';
import type { ShadowParagraph } from '../shadow/shadow-paragraph-projector';
import type { GeometricSubstrate, NodeLocalStats, SubstrateInterpretation } from './types';
import { cosineSimilarity } from '../clustering/distance';

// ─── Enrichment types ─────────────────────────────────────────────────────────

export interface EnrichmentResult {
  enrichedCount: number;
  unenrichedCount: number;
  failures: Array<{
    statementId: string;
    reason: 'no_paragraph' | 'no_node';
  }>;
}

// ─── Query relevance types ────────────────────────────────────────────────────

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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

// ─── Enrichment ───────────────────────────────────────────────────────────────

/**
 * Attach geometric position data (paragraphId, regionId, isolationScore) to
 * each shadow statement in-place.
 */
export function enrichStatementsWithGeometry(
  statements: ShadowStatement[],
  paragraphs: ShadowParagraph[],
  substrate: GeometricSubstrate,
  interpretation?: SubstrateInterpretation | null,
  statementToParagraph?: Map<string, string>
): EnrichmentResult {
  const stmtToPara = statementToParagraph ?? new Map<string, string>();
  if (!statementToParagraph) {
    for (const para of paragraphs) {
      for (const stmtId of para.statementIds) {
        stmtToPara.set(stmtId, para.id);
      }
    }
  }

  const paragraphToNode = new Map<string, NodeLocalStats>();
  for (const node of substrate.nodes) {
    paragraphToNode.set(node.paragraphId, node);
  }

  const failures: EnrichmentResult['failures'] = [];
  let enrichedCount = 0;

  for (const stmt of statements) {
    const paragraphId = stmtToPara.get(stmt.id);
    if (!paragraphId) {
      failures.push({ statementId: stmt.id, reason: 'no_paragraph' });
      continue;
    }

    const node = paragraphToNode.get(paragraphId);
    if (!node) {
      if (stmt.isTableCell) {
        stmt.geometricCoordinates = {
          paragraphId,
          regionId: null,
          basinId: null,
          isolationScore: 1,
        };
        enrichedCount++;
      } else {
        failures.push({ statementId: stmt.id, reason: 'no_node' });
      }
      continue;
    }

    const annotation = interpretation?.nodeAnnotations?.get(paragraphId);

    stmt.geometricCoordinates = {
      paragraphId,
      regionId: annotation?.regionId ?? null,
      basinId: annotation?.basinId ?? null,
      isolationScore: node.isolationScore,
    };

    enrichedCount++;
  }

  return {
    enrichedCount,
    unenrichedCount: failures.length,
    failures,
  };
}

/** Backward-compat alias. */
export const enrichStatements = enrichStatementsWithGeometry;

// ─── Query relevance ──────────────────────────────────────────────────────────

export function computeQueryRelevance(input: {
  queryEmbedding: Float32Array;
  statements: ShadowStatement[];
  statementEmbeddings?: Map<string, Float32Array> | null;
  paragraphEmbeddings?: Map<string, Float32Array> | null;
  paragraphs: ShadowParagraph[];
  statementToParagraph?: Map<string, string> | null;
}): QueryRelevanceResult {
  const { queryEmbedding, statements, statementEmbeddings, paragraphEmbeddings, paragraphs } =
    input;

  const statementToParagraph = input.statementToParagraph ?? new Map<string, string>();
  if (!input.statementToParagraph) {
    for (const p of paragraphs) {
      for (const sid of p.statementIds) {
        statementToParagraph.set(sid, p.id);
      }
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

/**
 * Convenience wrapper: enrich statements and compute query relevance in one
 * call when both are needed together.
 */
export function annotateStatements(input: {
  statements: ShadowStatement[];
  paragraphs: ShadowParagraph[];
  substrate: GeometricSubstrate;
  interpretation?: SubstrateInterpretation | null;
  queryEmbedding?: Float32Array | null;
  statementEmbeddings?: Map<string, Float32Array> | null;
  paragraphEmbeddings?: Map<string, Float32Array> | null;
}): { queryRelevance: QueryRelevanceResult | null } {
  const statementToParagraph = new Map<string, string>();
  for (const p of input.paragraphs) {
    for (const sid of p.statementIds) statementToParagraph.set(sid, p.id);
  }

  enrichStatementsWithGeometry(
    input.statements,
    input.paragraphs,
    input.substrate,
    input.interpretation,
    statementToParagraph
  );

  let queryRelevance: QueryRelevanceResult | null = null;
  if (input.queryEmbedding) {
    queryRelevance = computeQueryRelevance({
      queryEmbedding: input.queryEmbedding,
      statements: input.statements,
      statementEmbeddings: input.statementEmbeddings,
      paragraphEmbeddings: input.paragraphEmbeddings,
      paragraphs: input.paragraphs,
      statementToParagraph,
    });
  }

  return { queryRelevance };
}

import type { ShadowStatement } from '../shadow/ShadowExtractor';
import type { ShadowParagraph } from '../shadow/ShadowParagraphProjector';
import type { GeometricSubstrate } from './types';
import { cosineSimilarity } from '../clustering/distance';

export interface QueryRelevanceStatementScore {
    querySimilarity: number;          // [-1,1] raw cosine (CANONICAL for pipeline decisions). Do NOT normalize this field — it's the source of truth for all threshold comparisons.
    querySimilarityNormalized: number; // [0,1] (cos+1)/2 — for UI display only, never used for logic
    simRaw: number;                   // [-1,1] deprecated alias for querySimilarity (kept for compatibility)
    embeddingSource: 'statement' | 'paragraph' | 'none';
    paragraphSimRaw: number;          // [-1,1] raw cosine at paragraph level (always paragraph embedding)
    recusant: number;
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
    substrate: GeometricSubstrate;
    regionization?: unknown;
    regionProfiles?: unknown;
}): QueryRelevanceResult {
    const {
        queryEmbedding,
        statements,
        statementEmbeddings,
        paragraphEmbeddings,
        paragraphs,
        substrate,
    } = input;

    const statementToParagraph = new Map<string, string>();
    for (const p of paragraphs) {
        for (const sid of p.statementIds) {
            statementToParagraph.set(sid, p.id);
        }
    }

    const nodesByParagraphId = new Map(substrate.nodes.map(n => [n.paragraphId, n] as const));

    // Collect per-statement degrees for normalization
    const statementDegrees: number[] = [];
    const perStatementDegree = new Map<string, number>();

    for (const st of statements) {
        const pid = statementToParagraph.get(st.id);
        const node = pid ? nodesByParagraphId.get(pid) : undefined;
        const degree = node ? node.mutualDegree : 0;
        perStatementDegree.set(st.id, degree);
        statementDegrees.push(degree);
    }

    let minDegree = Infinity;
    let maxDegree = -Infinity;
    for (const d of statementDegrees) {
        if (d < minDegree) minDegree = d;
        if (d > maxDegree) maxDegree = d;
    }
    if (!Number.isFinite(minDegree)) minDegree = 0;
    if (!Number.isFinite(maxDegree)) maxDegree = 0;

    const statementScores = new Map<string, QueryRelevanceStatementScore>();

    for (const st of statements) {
        const pid = statementToParagraph.get(st.id);
        const stmtEmb = statementEmbeddings ? statementEmbeddings.get(st.id) ?? null : null;
        const paraEmb = pid && paragraphEmbeddings ? paragraphEmbeddings.get(pid) ?? null : null;

        // Pick best available embedding (statement > paragraph > none)
        const emb = stmtEmb || paraEmb || null;
        const embeddingSource: 'statement' | 'paragraph' | 'none' =
            stmtEmb ? 'statement' : paraEmb ? 'paragraph' : 'none';

        // querySimilarity: raw cosine similarity with query [-1,1]
        // CANONICAL VALUE for all downstream threshold comparisons (blast radius, skeletonization, etc.)
        const simRaw = emb ? cosineSimilarity(queryEmbedding, emb) : 0;
        const querySimilarity = simRaw; // [-1,1] raw — use this for all pipeline logic
        const querySimilarityNormalized = clamp01((simRaw + 1) / 2); // [0,1] normalized — UI display only

        // paragraph-level raw cosine (always uses paragraph embedding, independent of statement)
        const paragraphSimRaw = paraEmb ? cosineSimilarity(queryEmbedding, paraEmb) : 0;

        // recusant: inverse of normalized mutual degree (1 = isolated, 0 = hub)
        const degree = perStatementDegree.get(st.id) ?? 0;
        const normalizedDensity = maxDegree > minDegree ? clamp01((degree - minDegree) / (maxDegree - minDegree)) : 0;
        const recusant = clamp01(1 - normalizedDensity);

        statementScores.set(st.id, { querySimilarity, querySimilarityNormalized, simRaw, embeddingSource, paragraphSimRaw, recusant });
    }

    return { statementScores };
}

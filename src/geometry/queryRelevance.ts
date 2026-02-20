import type { ShadowStatement } from '../shadow/ShadowExtractor';
import type { ShadowParagraph } from '../shadow/ShadowParagraphProjector';
import type { GeometricSubstrate } from './types';
import { cosineSimilarity } from '../clustering/distance';

export interface QueryRelevanceStatementScore {
    querySimilarity: number;
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
        const emb =
            (statementEmbeddings && statementEmbeddings.get(st.id)) ||
            (pid && paragraphEmbeddings && paragraphEmbeddings.get(pid)) ||
            null;

        // querySimilarity: cosine similarity with query, normalized to [0,1]
        const simRaw = emb ? cosineSimilarity(queryEmbedding, emb) : 0;
        const querySimilarity = clamp01((simRaw + 1) / 2);

        // recusant: inverse of normalized mutual degree (1 = isolated, 0 = hub)
        const degree = perStatementDegree.get(st.id) ?? 0;
        const normalizedDensity = maxDegree > minDegree ? clamp01((degree - minDegree) / (maxDegree - minDegree)) : 0;
        const recusant = clamp01(1 - normalizedDensity);

        statementScores.set(st.id, { querySimilarity, recusant });
    }

    return { statementScores };
}

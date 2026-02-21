// ═══════════════════════════════════════════════════════════════════════════
// CLAIM ASSEMBLY - TRAVERSAL ANALYSIS LAYER
// ═══════════════════════════════════════════════════════════════════════════

import type { ShadowParagraph, ShadowStatement } from '../shadow';
import type { LinkedClaim, MapperClaim } from '../../shared/contract';
import type { Region } from '../geometry/interpretation/types';
import { cosineSimilarity } from '../clustering/distance';
import { generateTextEmbeddings } from '../clustering/embeddings';
export async function reconstructProvenance(
    claims: MapperClaim[],
    statements: ShadowStatement[],
    paragraphs: ShadowParagraph[],
    paragraphEmbeddings: Map<string, Float32Array>,
    regions: Region[],
    totalModelCount: number,
    statementEmbeddings: Map<string, Float32Array> | null = null
): Promise<LinkedClaim[]> {
    const statementsById = new Map(statements.map(s => [s.id, s]));
    const claimTexts = claims.map(c => `${c.label}. ${c.text || ''}`);
    const claimEmbeddings = await generateTextEmbeddings(claimTexts);

    const useStatementMatching = statementEmbeddings !== null && statementEmbeddings.size > 0;

    // Build paragraph-node → region lookup for sourceRegionIds derivation
    const paragraphToRegionIds = new Map<string, string[]>();
    for (const region of regions) {
        if (!Array.isArray(region.nodeIds)) continue;
        for (const nodeId of region.nodeIds) {
            const existing = paragraphToRegionIds.get(nodeId);
            if (existing) {
                existing.push(region.id);
            } else {
                paragraphToRegionIds.set(nodeId, [region.id]);
            }
        }
    }

    // Build statement → paragraph lookup
    const statementToParagraphId = new Map<string, string>();
    for (const para of paragraphs) {
        for (const sid of para.statementIds) {
            statementToParagraphId.set(sid, para.id);
        }
    }

    return claims.map((claim, idx) => {
        const claimEmbedding = claimEmbeddings.get(String(idx));
        const supporters = Array.isArray(claim.supporters) ? claim.supporters : [];

        let sourceStatementIds: string[];

        if (useStatementMatching && claimEmbedding) {
            // ── STATEMENT-LEVEL MATCHING ─────────────────────────────────
            // Match claim against ALL statements (no supporter filter).
            const scoredStatements: Array<{ statementId: string; similarity: number }> = [];

            for (const stmt of statements) {
                const stmtEmb = statementEmbeddings!.get(stmt.id);
                if (!stmtEmb) continue;

                const similarity = cosineSimilarity(claimEmbedding, stmtEmb);
                if (similarity > 0.45) {
                    scoredStatements.push({ statementId: stmt.id, similarity });
                }
            }

            scoredStatements.sort((a, b) => {
                if (b.similarity !== a.similarity) return b.similarity - a.similarity;
                return a.statementId.localeCompare(b.statementId);
            });

            sourceStatementIds = scoredStatements.slice(0, 12).map(s => s.statementId);

            if (sourceStatementIds.length === 0) {
                // ── PARAGRAPH-LEVEL FALLBACK ─────────────────────────────
                const scored: Array<{ paragraph: ShadowParagraph; similarity: number }> = [];
                for (const paragraph of paragraphs) {
                    const paragraphEmbedding = paragraphEmbeddings.get(paragraph.id);
                    if (!paragraphEmbedding) continue;
                    const similarity = cosineSimilarity(claimEmbedding, paragraphEmbedding);
                    if (similarity > 0.5) {
                        scored.push({ paragraph, similarity });
                    }
                }
                scored.sort((a, b) => {
                    if (b.similarity !== a.similarity) return b.similarity - a.similarity;
                    return a.paragraph.id.localeCompare(b.paragraph.id);
                });
                const sourceStatementIdSet = new Set<string>();
                for (const { paragraph } of scored.slice(0, 5)) {
                    for (const sid of paragraph.statementIds) sourceStatementIdSet.add(sid);
                }
                sourceStatementIds = Array.from(sourceStatementIdSet);
            }
        } else {
            // ── PARAGRAPH-LEVEL MATCHING (no statement embeddings) ───────
            const scored: Array<{ paragraph: ShadowParagraph; similarity: number }> = [];
            if (claimEmbedding) {
                for (const paragraph of paragraphs) {
                    const paragraphEmbedding = paragraphEmbeddings.get(paragraph.id);
                    if (!paragraphEmbedding) continue;
                    const similarity = cosineSimilarity(claimEmbedding, paragraphEmbedding);
                    if (similarity > 0.5) {
                        scored.push({ paragraph, similarity });
                    }
                }
            }
            scored.sort((a, b) => {
                if (b.similarity !== a.similarity) return b.similarity - a.similarity;
                return a.paragraph.id.localeCompare(b.paragraph.id);
            });
            const sourceStatementIdSet = new Set<string>();
            for (const { paragraph } of scored.slice(0, 5)) {
                for (const sid of paragraph.statementIds) sourceStatementIdSet.add(sid);
            }
            sourceStatementIds = Array.from(sourceStatementIdSet);
        }

        sourceStatementIds.sort();
        const sourceStatements = sourceStatementIds
            .map(id => statementsById.get(id))
            .filter((s): s is ShadowStatement => s !== undefined);

        // Derive region ids from source statements → paragraphs → regions
        const matchedRegionIds = new Set<string>();
        for (const sid of sourceStatementIds) {
            const pid = statementToParagraphId.get(sid);
            if (!pid) continue;
            for (const rid of paragraphToRegionIds.get(pid) || []) matchedRegionIds.add(rid);
        }
        const sourceRegionIds = Array.from(matchedRegionIds).sort();

        const supportRatio = totalModelCount > 0 ? supporters.length / totalModelCount : 0;
        const hasConditionalSignal = sourceStatements.some(s => s.signals.conditional);
        const hasSequenceSignal = sourceStatements.some(s => s.signals.sequence);
        const hasTensionSignal = sourceStatements.some(s => s.signals.tension);

        return {
            id: claim.id,
            label: claim.label,
            text: claim.text,
            supporters,
            challenges: claim.challenges ?? null,
            support_count: supporters.length,
            type: 'assertive' as const,
            role: 'supplement' as const,
            sourceStatementIds,
            sourceStatements,
            sourceRegionIds,
            supportRatio,
            hasConditionalSignal,
            hasSequenceSignal,
            hasTensionSignal,
        };
    });
}


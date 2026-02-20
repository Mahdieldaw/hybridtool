// ═══════════════════════════════════════════════════════════════════════════
// CLAIM ASSEMBLY - TRAVERSAL ANALYSIS LAYER
// ═══════════════════════════════════════════════════════════════════════════

import type { ShadowParagraph, ShadowStatement } from '../shadow';
import type { LinkedClaim, MapperClaim, ConditionProvenance, ConditionMatch } from '../../shared/contract';
import type { Region } from '../geometry/interpretation/types';
import { cosineSimilarity } from '../clustering/distance';
import { generateTextEmbeddings } from '../clustering/embeddings';
import {
    Claim,
    ConditionalGate,
    ConflictEdge,
} from './contract';

/**
 * Reconstruct provenance for conditions (questions) by matching them to statements.
 * This is the condition-based analogue of reconstructProvenance for claims.
 * 
 * @param conditions - Array of condition objects with id and question text
 * @param statements - All shadow statements extracted from models
 * @param statementEmbeddings - Pre-computed statement embeddings (required)
 * @returns Array of ConditionProvenance with linked statements for each condition
 */
export async function reconstructConditionProvenance(
    conditions: Array<{ id: string; question: string }>,
    statements: ShadowStatement[],
    statementEmbeddings: Map<string, Float32Array> | null
): Promise<ConditionProvenance[]> {
    if (!statementEmbeddings || statementEmbeddings.size === 0) {
        console.warn('[reconstructConditionProvenance] No statement embeddings provided, returning empty provenance');
        return conditions.map(c => ({
            conditionId: c.id,
            question: c.question,
            linkedStatements: []
        }));
    }

    // Embed all condition questions
    const conditionTexts = conditions.map(c => c.question);
    const conditionEmbeddings = await generateTextEmbeddings(conditionTexts);

    return conditions.map((condition, idx) => {
        const conditionEmbedding = conditionEmbeddings.get(String(idx));

        if (!conditionEmbedding) {
            return {
                conditionId: condition.id,
                question: condition.question,
                linkedStatements: []
            };
        }

        // Match condition embedding against ALL statement embeddings (no model filtering)
        const scoredStatements: ConditionMatch[] = [];

        for (const stmt of statements) {
            const stmtEmb = statementEmbeddings.get(stmt.id);
            if (!stmtEmb) continue;

            const similarity = cosineSimilarity(conditionEmbedding, stmtEmb);
            if (similarity > 0.45) {
                scoredStatements.push({
                    statementId: stmt.id,
                    modelIndex: stmt.modelIndex,
                    text: stmt.text,
                    similarity
                });
            }
        }

        // Sort by similarity (highest first), take top-12
        scoredStatements.sort((a, b) => {
            if (b.similarity !== a.similarity) return b.similarity - a.similarity;
            return a.statementId.localeCompare(b.statementId);
        });

        const linkedStatements = scoredStatements.slice(0, 12);

        return {
            conditionId: condition.id,
            question: condition.question,
            linkedStatements
        };
    });
}


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

// ═══════════════════════════════════════════════════════════════════════════
// PROVENANCE HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get provenance for a specific gate
 */
export function getGateProvenance(
    gate: ConditionalGate,
    statementMap: Map<string, ShadowStatement>
): ShadowStatement[] {
    return gate.sourceStatementIds
        .map(id => statementMap.get(id))
        .filter((s): s is ShadowStatement => s !== undefined);
}

/**
 * Get provenance for a specific edge
 */
export function getConflictProvenance(
    conflict: ConflictEdge,
    statementMap: Map<string, ShadowStatement>
): ShadowStatement[] {
    return conflict.sourceStatementIds
        .map(id => statementMap.get(id))
        .filter((s): s is ShadowStatement => s !== undefined);
}

/**
 * Validate all provenance references exist
 */
export function validateProvenance(
    claims: Claim[],
    statementMap: Map<string, ShadowStatement>
): { valid: boolean; missing: string[] } {
    const missing: string[] = [];

    for (const claim of claims) {
        for (const id of claim.sourceStatementIds) {
            if (!statementMap.has(id)) missing.push(id);
        }
        for (const gate of claim.gates.conditionals) {
            for (const id of gate.sourceStatementIds) {
                if (!statementMap.has(id)) missing.push(id);
            }
        }
        for (const conflict of (claim.conflicts || [])) {
            for (const id of conflict.sourceStatementIds) {
                if (!statementMap.has(id)) missing.push(id);
            }
        }
    }

    return {
        valid: missing.length === 0,
        missing: Array.from(new Set(missing)),
    };
}

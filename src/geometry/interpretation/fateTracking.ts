import type { ShadowStatement } from '../../shadow/ShadowExtractor';
import type { Stance } from '../../shadow/StatementTypes';

export interface StatementFate {
    statementId: string;
    regionId: string | null;
    claimIds: string[];
    fate: 'primary' | 'supporting' | 'unaddressed' | 'orphan' | 'noise';
    reason: string;
    querySimilarity?: number;
    shadowMetadata: {
        stance: Stance;
        confidence: number;
        signalWeight: number;
        geometricIsolation: number;
    };
}

function computeSignalWeight(signals: { sequence: boolean; tension: boolean; conditional: boolean }): number {
    let weight = 0;
    if (signals.conditional) weight += 3;
    if (signals.sequence) weight += 2;
    if (signals.tension) weight += 1;
    return weight;
}

/**
 * Build statement fates.
 *
 * Step 8: Removed elbow gate for orphan → unaddressed promotion.
 * All orphans with query relevance scores are now classified as 'unaddressed'
 * and ranked by raw cosine descending. The consumer (completeness report)
 * presents a continuous list — no binary threshold.
 */
export function buildStatementFates(
    statements: ShadowStatement[],
    claims: Array<{ id: string; sourceStatementIds?: string[] }>,
    queryRelevanceScores: Map<string, { querySimilarity: number }> | null = null
): Map<string, StatementFate> {
    const enrichedCount = statements.reduce((acc, s) => acc + (s.geometricCoordinates ? 1 : 0), 0);
    if (enrichedCount === 0 && statements.length > 0) {
        console.warn('[FateTracking] No statements have geometricCoordinates');
    }

    const statementToClaims = new Map<string, string[]>();
    for (const claim of claims) {
        const sourceIds = claim.sourceStatementIds ?? [];
        for (const stmtId of sourceIds) {
            const arr = statementToClaims.get(stmtId) ?? [];
            arr.push(claim.id);
            statementToClaims.set(stmtId, arr);
        }
    }

    const fates = new Map<string, StatementFate>();

    for (const stmt of statements) {
        const claimIds = statementToClaims.get(stmt.id) ?? [];
        const coords = stmt.geometricCoordinates;

        let fate: StatementFate['fate'];
        let reason: string;
        let querySimilarity: number | undefined;

        if (claimIds.length > 0) {
            fate = claimIds.length === 1 ? 'primary' : 'supporting';
            reason = `Referenced by ${claimIds.length} claim(s): ${claimIds.join(', ')}`;
        } else {
            // Classify as orphan or noise first, then promote ALL orphans with
            // query relevance to unaddressed (Step 8: no elbow gate)
            let baseOrphan = false;
            if (coords?.regionId) {
                baseOrphan = true;
                reason = `In region ${coords.regionId} but not referenced by any claim`;
            } else if (coords?.componentId) {
                baseOrphan = true;
                reason = `In component ${coords.componentId} but no region assignment`;
            } else if (coords) {
                reason = 'Isolated node';
            } else {
                reason = 'No geometric coordinates';
            }

            if (baseOrphan && queryRelevanceScores !== null) {
                const qScore = queryRelevanceScores.get(stmt.id);
                if (qScore) {
                    // Step 8: all orphans with query relevance become unaddressed
                    // Ranked by raw cosine descending — continuous list, no binary gate
                    fate = 'unaddressed';
                    querySimilarity = qScore.querySimilarity;
                    reason = `${reason}; query-relevant (querySimilarity=${qScore.querySimilarity.toFixed(3)})`;
                } else {
                    fate = 'orphan';
                }
            } else if (baseOrphan) {
                fate = 'orphan';
            } else {
                fate = 'noise';
            }
        }

        fates.set(stmt.id, {
            statementId: stmt.id,
            regionId: coords?.regionId ?? null,
            claimIds,
            fate,
            reason,
            ...(querySimilarity !== undefined ? { querySimilarity } : {}),
            shadowMetadata: {
                stance: stmt.stance,
                confidence: stmt.confidence,
                signalWeight: computeSignalWeight(stmt.signals),
                geometricIsolation: coords?.isolationScore ?? 1.0,
            },
        });
    }

    return fates;
}

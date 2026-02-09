import type { ShadowStatement } from '../../shadow/ShadowExtractor';
import type { Stance } from '../../shadow/StatementTypes';

export interface StatementFate {
    statementId: string;
    regionId: string | null;
    claimIds: string[];
    fate: 'primary' | 'supporting' | 'orphan' | 'noise';
    reason: string;
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

export function buildStatementFates(
    statements: ShadowStatement[],
    claims: Array<{ id: string; sourceStatementIds?: string[] }>
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

        if (claimIds.length > 0) {
            fate = claimIds.length === 1 ? 'primary' : 'supporting';
            reason = `Referenced by ${claimIds.length} claim(s): ${claimIds.join(', ')}`;
        } else if (coords?.regionId) {
            fate = 'orphan';
            reason = `In region ${coords.regionId} but not referenced by any claim`;
        } else if (coords?.componentId) {
            fate = 'orphan';
            reason = `In component ${coords.componentId} but no region assignment`;
        } else if (coords) {
            fate = 'noise';
            reason = 'Isolated node';
        } else {
            fate = 'noise';
            reason = 'No geometric coordinates';
        }

        fates.set(stmt.id, {
            statementId: stmt.id,
            regionId: coords?.regionId ?? null,
            claimIds,
            fate,
            reason,
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

export function getHighSignalOrphans(
    fates: Map<string, StatementFate>,
    statements: ShadowStatement[],
    limit: number = 10
): Array<{ statement: ShadowStatement; fate: StatementFate }> {
    const stmtById = new Map(statements.map(s => [s.id, s]));

    return Array.from(fates.values())
        .filter(f => f.fate === 'orphan' && f.shadowMetadata.signalWeight >= 2)
        .sort((a, b) => b.shadowMetadata.signalWeight - a.shadowMetadata.signalWeight)
        .slice(0, limit)
        .map(fate => {
            const statement = stmtById.get(fate.statementId);
            return statement ? { statement, fate } : null;
        })
        .filter((v): v is { statement: ShadowStatement; fate: StatementFate } => v !== null);
}

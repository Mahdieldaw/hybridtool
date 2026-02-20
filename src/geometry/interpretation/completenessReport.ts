import type { StatementFate } from './fateTracking';
import type { UnattendedRegion } from './coverageAudit';
import type { ShadowStatement } from '../../shadow/ShadowExtractor';

export interface CompletenessReport {
    statements: {
        total: number;
        inClaims: number;
        orphaned: number;
        unaddressed: number;
        noise: number;
        coverageRatio: number;
    };
    regions: {
        total: number;
        attended: number;
        unattended: number;
        coverageRatio: number;
    };
    recovery: {
        unaddressedStatements: Array<{
            statementId: string;
            text: string;
            modelIndex: number;
            querySimilarity: number;
        }>;
        unattendedRegionPreviews: Array<{
            regionId: string;
            statementPreviews: string[];
        }>;
    };
}

export function buildCompletenessReport(
    statementFates: Map<string, StatementFate>,
    unattendedRegions: UnattendedRegion[],
    statements: ShadowStatement[],
    totalRegions: number
): CompletenessReport {
    const fateArray = Array.from(statementFates.values());
    const totalStatements = fateArray.length;
    const inClaims = fateArray.filter(f => f.fate === 'primary' || f.fate === 'supporting').length;
    const orphaned = fateArray.filter(f => f.fate === 'orphan').length;
    const unaddressedFates = fateArray.filter(f => f.fate === 'unaddressed');
    const noise = fateArray.filter(f => f.fate === 'noise').length;
    const statementCoverage = totalStatements > 0 ? inClaims / totalStatements : 1;

    const unattendedCount = unattendedRegions.length;
    const attendedCount = Math.max(0, totalRegions - unattendedCount);
    const regionCoverage = totalRegions > 0 ? attendedCount / totalRegions : 1;

    const stmtById = new Map(statements.map(s => [s.id, s]));

    // Recovery: unaddressed statements sorted by querySimilarity descending
    const unaddressedStatements = unaddressedFates
        .sort((a, b) => (b.querySimilarity ?? 0) - (a.querySimilarity ?? 0))
        .slice(0, 10)
        .map(fate => {
            const stmt = stmtById.get(fate.statementId);
            return {
                statementId: fate.statementId,
                text: stmt?.text ?? '',
                modelIndex: stmt?.modelIndex ?? -1,
                querySimilarity: fate.querySimilarity ?? 0,
            };
        })
        .filter(s => s.text.length > 0);

    const regionPreviews = unattendedRegions
        .slice(0, 5)
        .map(region => ({
            regionId: region.id,
            statementPreviews: region.statementIds
                .slice(0, 3)
                .map(sid => stmtById.get(sid)?.text ?? '')
                .filter(t => t.length > 0),
        }));

    return {
        statements: {
            total: totalStatements,
            inClaims,
            orphaned,
            unaddressed: unaddressedFates.length,
            noise,
            coverageRatio: statementCoverage,
        },
        regions: {
            total: totalRegions,
            attended: attendedCount,
            unattended: unattendedCount,
            coverageRatio: regionCoverage,
        },
        recovery: {
            unaddressedStatements,
            unattendedRegionPreviews: regionPreviews,
        },
    };
}

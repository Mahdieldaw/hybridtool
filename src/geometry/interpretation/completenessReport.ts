import type { StatementFate } from './fateTracking';
import type { UnattendedRegion } from './coverageAudit';
import type { ShadowStatement } from '../../shadow/ShadowExtractor';

export interface CompletenessReport {
    statements: {
        total: number;
        inClaims: number;
        orphaned: number;
        noise: number;
        coverageRatio: number;
    };
    regions: {
        total: number;
        attended: number;
        unattended: number;
        unattendedWithLikelyClaims: number;
        coverageRatio: number;
    };
    verdict: {
        complete: boolean;
        confidence: 'high' | 'medium' | 'low';
        estimatedMissedClaims: number;
        recommendation: 'coverage_acceptable' | 'review_orphans' | 'possible_gaps';
    };
    recovery: {
        highSignalOrphans: Array<{
            statementId: string;
            text: string;
            stance: string;
            signalWeight: number;
            reason: string;
        }>;
        unattendedRegionPreviews: Array<{
            regionId: string;
            statementPreviews: string[];
            reason: string;
            likelyClaim: boolean;
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
    const noise = fateArray.filter(f => f.fate === 'noise').length;
    const statementCoverage = totalStatements > 0 ? inClaims / totalStatements : 1;

    const unattendedCount = unattendedRegions.length;
    const attendedCount = Math.max(0, totalRegions - unattendedCount);
    const unattendedWithLikelyClaims = unattendedRegions.filter(r => r.likelyClaim).length;
    const regionCoverage = totalRegions > 0 ? attendedCount / totalRegions : 1;

    const complete = statementCoverage > 0.85 && regionCoverage > 0.8;

    const highSignalOrphans = fateArray.filter(f => f.fate === 'orphan' && f.shadowMetadata.signalWeight >= 2);
    const estimatedMissedClaims = unattendedWithLikelyClaims + Math.ceil(highSignalOrphans.length / 3);

    let recommendation: CompletenessReport['verdict']['recommendation'];
    if (!complete || unattendedWithLikelyClaims > 0) {
        recommendation = 'possible_gaps';
    } else if (highSignalOrphans.length > 0) {
        recommendation = 'review_orphans';
    } else {
        recommendation = 'coverage_acceptable';
    }

    const confidence: CompletenessReport['verdict']['confidence'] =
        complete && estimatedMissedClaims === 0
            ? 'high'
            : statementCoverage > 0.7 && regionCoverage > 0.6
                ? 'medium'
                : 'low';

    const stmtById = new Map(statements.map(s => [s.id, s]));

    const recoveryOrphans = highSignalOrphans
        .filter(fate => (stmtById.get(fate.statementId)?.text ?? '').length > 0)
        .sort((a, b) => b.shadowMetadata.signalWeight - a.shadowMetadata.signalWeight)
        .slice(0, 10)
        .map(fate => {
            const stmt = stmtById.get(fate.statementId);
            return {
                statementId: fate.statementId,
                text: stmt?.text ?? '',
                stance: fate.shadowMetadata.stance,
                signalWeight: fate.shadowMetadata.signalWeight,
                reason: fate.reason,
            };
        });

    const regionPreviews = unattendedRegions
        .filter(r => r.likelyClaim)
        .slice(0, 5)
        .map(region => ({
            regionId: region.id,
            statementPreviews: region.statementIds
                .slice(0, 3)
                .map(sid => stmtById.get(sid)?.text ?? '')
                .filter(t => t.length > 0),
            reason: region.reason,
            likelyClaim: region.likelyClaim,
        }));

    return {
        statements: {
            total: totalStatements,
            inClaims,
            orphaned,
            noise,
            coverageRatio: statementCoverage,
        },
        regions: {
            total: totalRegions,
            attended: attendedCount,
            unattended: unattendedCount,
            unattendedWithLikelyClaims,
            coverageRatio: regionCoverage,
        },
        verdict: {
            complete,
            confidence,
            estimatedMissedClaims,
            recommendation,
        },
        recovery: {
            highSignalOrphans: recoveryOrphans,
            unattendedRegionPreviews: regionPreviews,
        },
    };
}

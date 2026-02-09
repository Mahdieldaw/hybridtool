import type { StructuralAnalysis } from '../../../shared/contract';
import type { PreSemanticInterpretation, StructuralValidation, StructuralViolation } from './types';

export function validateStructuralMapping(
    preSemantic: PreSemanticInterpretation,
    postSemantic: StructuralAnalysis
): StructuralValidation {
    const violations: StructuralViolation[] = [];

    const { hints, regionProfiles } = preSemantic;

    const predictedShape = hints.predictedShape.predicted;
    const actualShape = postSemantic.shape.primary;
    const shapeMatch = predictedShape === actualShape;

    if (!shapeMatch) {
        violations.push({
            type: 'shape_mismatch',
            severity: 'medium',
            predicted: {
                description: `Predicted: ${predictedShape}`,
                evidence: hints.predictedShape.evidence.join('; '),
            },
            actual: {
                description: `Actual: ${actualShape}`,
                evidence: 'From post-semantic analysis',
            },
        });
    }

    if (predictedShape === 'sparse' && actualShape === 'convergent') {
        violations.push({
            type: 'embedding_quality_suspect',
            severity: 'high',
            predicted: {
                description: 'Topology sparse but semantics converged. Embeddings may be degraded.',
                evidence: hints.predictedShape.evidence.join('; '),
            },
            actual: {
                description: `Actual: ${actualShape}`,
                evidence: postSemantic.shape.evidence.join('; '),
            },
        });
    }

    const [minClaims, maxClaims] = hints.expectedClaimCount;
    const claimCount = postSemantic.claimsWithLeverage.length;

    if (claimCount < minClaims) {
        violations.push({
            type: 'claim_count_mismatch',
            severity: 'high',
            predicted: {
                description: `Expected at least ${minClaims} claims`,
                evidence: `peaks=${regionProfiles.filter(p => p.tier === 'peak').length}`,
            },
            actual: {
                description: `Got ${claimCount} claims`,
                evidence: 'From semantic mapper',
            },
        });
    } else if (claimCount > maxClaims * 1.5) {
        violations.push({
            type: 'claim_count_mismatch',
            severity: 'low',
            predicted: {
                description: `Expected at most ~${maxClaims} claims`,
                evidence: 'Based on region analysis',
            },
            actual: {
                description: `Got ${claimCount} claims (50% over)`,
                evidence: 'From semantic mapper',
            },
        });
    }

    const expectedConflicts = hints.expectedConflicts;
    const actualConflictEdges = postSemantic.edges.filter(e => e.type === 'conflicts').length;

    const conflictPrecision =
        actualConflictEdges > 0
            ? Math.min(1, expectedConflicts / actualConflictEdges)
            : expectedConflicts === 0
                ? 1
                : 0;

    const conflictRecall =
        expectedConflicts > 0
            ? Math.min(1, actualConflictEdges / expectedConflicts)
            : actualConflictEdges === 0
                ? 1
                : 0;

    if (expectedConflicts > 0 && actualConflictEdges === 0) {
        violations.push({
            type: 'missed_conflict',
            severity: 'high',
            predicted: {
                description: `Expected ${expectedConflicts} conflict(s)`,
                evidence: `oppositions=${preSemantic.oppositions.length}`,
            },
            actual: {
                description: 'No conflict edges created',
                evidence: 'Mapper may have collapsed tension',
            },
        });
    }

    const peaks = regionProfiles.filter(p => p.tier === 'peak');
    const highSupportClaims = postSemantic.claimsWithLeverage.filter(c => c.supportRatio > 0.5);

    const tierAlignmentScore =
        peaks.length > 0
            ? Math.min(1, highSupportClaims.length / peaks.length)
            : highSupportClaims.length > 0
                ? 0.5
                : 1;

    if (peaks.length > 0 && highSupportClaims.length === 0) {
        violations.push({
            type: 'tier_mismatch',
            severity: 'medium',
            predicted: {
                description: `${peaks.length} peak region(s) should produce high-support claims`,
                evidence: peaks.map(p => p.regionId).join(', '),
            },
            actual: {
                description: 'No high-support claims (>50%) produced',
                evidence: 'Mapper may have fragmented peaks',
            },
        });
    }

    const overallFidelity =
        (shapeMatch ? 0.3 : 0) +
        tierAlignmentScore * 0.25 +
        conflictRecall * 0.2 +
        conflictPrecision * 0.15 +
        (claimCount >= minClaims && claimCount <= maxClaims * 1.5 ? 0.1 : 0);

    const confidence: StructuralValidation['confidence'] =
        overallFidelity > 0.8 ? 'high' : overallFidelity > 0.6 ? 'medium' : 'low';

    const summaryParts: string[] = [];
    summaryParts.push(shapeMatch ? `Shape: ✓ ${predictedShape}` : `Shape: ✗ ${predictedShape} vs ${actualShape}`);
    summaryParts.push(`Tier alignment: ${(tierAlignmentScore * 100).toFixed(0)}%`);
    summaryParts.push(
        `Conflicts: P=${(conflictPrecision * 100).toFixed(0)}% R=${(conflictRecall * 100).toFixed(0)}%`
    );
    if (violations.length > 0) summaryParts.push(`Violations: ${violations.length}`);

    return {
        shapeMatch,
        predictedShape,
        actualShape,
        tierAlignmentScore,
        conflictPrecision,
        conflictRecall,
        violations,
        overallFidelity,
        confidence,
        summary: summaryParts.join(' | '),
        diagnostics: {
            expectedClaimCount: hints.expectedClaimCount,
            expectedConflicts,
            actualConflictEdges,
            actualPeakClaims: highSupportClaims.length,
            mappedPeakClaims: peaks.length,
        },
    };
}

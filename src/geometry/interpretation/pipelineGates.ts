import type { GeometricSubstrate } from '../types';
import { isDegenerate } from '../types';
import type { PipelineGateResult } from './types';

function clamp01(value: number): number {
    if (value <= 0) return 0;
    if (value >= 1) return 1;
    return value;
}

function formatPct(value: number): string {
    return `${Math.round(value * 100)}%`;
}

/**
 * Pipeline gates — derived inline from mutualRankGraph + pairwiseField.
 *
 * Verdicts:
 *   skip_geometry           — degenerate OR no mutual recognition edges OR discrimination < 0.10
 *   insufficient_structure  — >70% isolated and edge count trivially low
 *   proceed                 — normal
 */
export function evaluatePipelineGates(substrate: GeometricSubstrate): PipelineGateResult {
    const nodeCount = substrate.meta.nodeCount;
    const maxPossibleEdges = nodeCount > 1 ? (nodeCount * (nodeCount - 1)) / 2 : 0;

    const edgeCount = substrate.mutualRankGraph.edges.length;
    const discriminationRange = substrate.pairwiseField.stats.discriminationRange;

    // Isolation: fraction of nodes with zero mutual recognition edges
    let isolatedCount = 0;
    for (const ns of substrate.mutualRankGraph.nodeStats.values()) {
        if (ns.isolated) isolatedCount++;
    }
    const isolationRatio = nodeCount > 0 ? isolatedCount / nodeCount : 1;
    const density = maxPossibleEdges > 0 ? edgeCount / maxPossibleEdges : 0;

    const measurements: PipelineGateResult['measurements'] = {
        isDegenerate: isDegenerate(substrate),
        isolationRatio,
        edgeCount,
        density,
        discriminationRange,
        nodeCount,
    };

    if (measurements.isDegenerate) {
        return {
            verdict: 'skip_geometry',
            confidence: 1,
            evidence: ['degenerate_substrate=true'],
            measurements,
        };
    }

    const evidence: string[] = [];
    evidence.push(`mutual_recognition_edges=${edgeCount}`);
    evidence.push(`discrimination_range=${discriminationRange.toFixed(3)}`);
    evidence.push(`isolation_ratio=${formatPct(isolationRatio)}`);
    evidence.push(`density=${density.toFixed(4)}`);

    // Skip geometry if no mutual recognition structure or insufficient discrimination
    if (edgeCount === 0 || discriminationRange < 0.10) {
        return {
            verdict: 'skip_geometry',
            confidence: 0.9,
            evidence: [
                ...evidence,
                edgeCount === 0
                    ? 'no_mutual_recognition_edges'
                    : `discrimination_range_below_floor(${discriminationRange.toFixed(3)}<0.10)`,
            ],
            measurements,
        };
    }

    // Insufficient structure: most nodes isolated, trivial edge count
    if (isolationRatio > 0.7) {
        const confidence = clamp01((isolationRatio - 0.7) / 0.3);
        return {
            verdict: 'insufficient_structure',
            confidence,
            evidence: [...evidence, `isolation_above_threshold(${formatPct(isolationRatio)}>70%)`],
            measurements,
        };
    }

    // Proceed
    const proceedConfidence = clamp01(
        0.25 +
        clamp01(density / 0.35) * 0.45 +
        clamp01((1 - isolationRatio) / 0.9) * 0.3
    );

    return {
        verdict: 'proceed',
        confidence: proceedConfidence,
        evidence,
        measurements,
    };
}

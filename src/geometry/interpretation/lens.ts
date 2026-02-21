import type { GeometricSubstrate } from '../types';
import type { AdaptiveLens } from './types';

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

export function deriveLens(substrate: GeometricSubstrate): AdaptiveLens {
    const { topology, graphs, meta, shape } = substrate;
    const stats = meta.similarityStats;

    const hardMergeThreshold = clamp(stats.p95 - 0.03, 0.65, 0.85);

    const evidence: string[] = [];
    evidence.push(`shape.conf=${shape.confidence.toFixed(2)}`);
    evidence.push(`shape.frag=${shape.signals.fragmentationScore.toFixed(2)},bim=${shape.signals.bimodalityScore.toFixed(2)},par=${shape.signals.parallelScore.toFixed(2)},conv=${shape.signals.convergentScore.toFixed(2)}`);
    evidence.push(`density=${topology.globalStrongDensity.toFixed(3)}`);
    evidence.push(`isolation=${topology.isolationRatio.toFixed(3)}`);
    evidence.push(`p95=${stats.p95.toFixed(3)}`);

    const confidence = clamp(0.35 + 0.6 * shape.confidence, 0.35, 0.95);

    return {
        hardMergeThreshold,
        softThreshold: graphs.strong.softThreshold,
        k: graphs.knn.k,
        confidence,
        evidence,
    };
}

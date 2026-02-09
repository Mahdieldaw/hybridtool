import type { GeometricSubstrate } from '../types';
import type { AdaptiveLens, Regime } from './types';

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function mapPriorToRegime(prior: GeometricSubstrate['shape']['prior']): Regime {
    switch (prior) {
        case 'convergent_core':
            return 'convergent_core';
        case 'bimodal_fork':
            return 'bimodal_fork';
        case 'parallel_components':
            return 'parallel_components';
        case 'fragmented':
        default:
            return 'fragmented';
    }
}

export function deriveLens(substrate: GeometricSubstrate): AdaptiveLens {
    const { topology, graphs, meta, shape } = substrate;
    const stats = meta.similarityStats;
    const regime = mapPriorToRegime(shape.prior);

    const hardMergeThreshold = clamp(stats.p95 - 0.03, 0.65, 0.85);

    const shouldRunClustering =
        topology.globalStrongDensity >= 0.1 &&
        topology.isolationRatio < 0.7 &&
        meta.nodeCount >= 3 &&
        shape.confidence >= 0.35;

    const evidence: string[] = [];
    evidence.push(`shape.prior=${shape.prior}`);
    evidence.push(`shape.conf=${shape.confidence.toFixed(2)}`);
    evidence.push(`density=${topology.globalStrongDensity.toFixed(3)}`);
    evidence.push(`isolation=${topology.isolationRatio.toFixed(3)}`);
    evidence.push(`p95=${stats.p95.toFixed(3)}`);
    if (!shouldRunClustering) {
        const reason =
            topology.globalStrongDensity < 0.1
                ? 'low_density'
                : topology.isolationRatio >= 0.7
                    ? 'high_isolation'
                    : meta.nodeCount < 3
                        ? 'insufficient_nodes'
                        : 'low_shape_confidence';
        evidence.push(`clustering_skipped=${reason}`);
    }

    const confidence = clamp(0.35 + 0.6 * shape.confidence, 0.35, 0.95);

    return {
        regime,
        shouldRunClustering,
        hardMergeThreshold,
        softThreshold: graphs.strong.softThreshold,
        k: graphs.knn.k,
        confidence,
        evidence,
    };
}

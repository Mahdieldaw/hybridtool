import type { TopologyMetrics } from './types';

export type ShapePrior =
    | 'fragmented'           // No dominant structure, high isolation
    | 'convergent_core'      // Single dominant component, high density
    | 'bimodal_fork'         // Two major components of similar size
    | 'parallel_components'; // Multiple independent components

export interface ShapeClassification {
    prior: ShapePrior;
    confidence: number;
    signals: {
        fragmentationScore: number;   // 0 = unified, 1 = maximally fragmented
        bimodalityScore: number;      // 0 = unimodal, 1 = perfect bimodal
        parallelScore: number;        // 0 = single track, 1 = multiple tracks
    };
    recommendation: {
        expectClusterCount: [number, number];  // [min, max]
        expectConflicts: boolean;
        expectDissent: boolean;
    };
}

export function classifyShape(
    topology: TopologyMetrics,
    nodeCount: number
): ShapeClassification {
    const { components, largestComponentRatio, isolationRatio, globalStrongDensity } = topology;

    // Fragmentation score: many small components + high isolation
    const fragmentationScore = Math.min(1,
        (1 - largestComponentRatio) * 0.5 +
        isolationRatio * 0.3 +
        (1 - globalStrongDensity) * 0.2
    );

    // Bimodality score: two similarly-sized large components
    let bimodalityScore = 0;
    if (components.length >= 2) {
        const [first, second] = components;
        const sizeRatio = second.size / first.size;
        const combinedCoverage = (first.size + second.size) / nodeCount;
        bimodalityScore = sizeRatio * combinedCoverage;
    }

    // Parallel score: multiple independent components of reasonable size
    const significantComponents = components.filter(c => c.size >= 3);
    const parallelScore = significantComponents.length >= 3
        ? Math.min(1, significantComponents.length / 5)
        : 0;

    // Classification logic
    let prior: ShapePrior;
    let confidence: number;

    if (fragmentationScore > 0.6 && globalStrongDensity < 0.15) {
        prior = 'fragmented';
        confidence = fragmentationScore;
    } else if (bimodalityScore > 0.5 && components.length === 2) {
        prior = 'bimodal_fork';
        confidence = bimodalityScore;
    } else if (parallelScore > 0.4) {
        prior = 'parallel_components';
        confidence = parallelScore;
    } else if (largestComponentRatio > 0.7 && globalStrongDensity > 0.2) {
        prior = 'convergent_core';
        confidence = largestComponentRatio;
    } else {
        // Default: pick highest signal
        const scores = [
            { prior: 'fragmented' as const, score: fragmentationScore },
            { prior: 'convergent_core' as const, score: largestComponentRatio },
            { prior: 'bimodal_fork' as const, score: bimodalityScore },
            { prior: 'parallel_components' as const, score: parallelScore },
        ];
        scores.sort((a, b) => b.score - a.score);
        prior = scores[0].prior;
        confidence = scores[0].score;
    }

    // Recommendations
    const recommendation = {
        expectClusterCount: getExpectedClusterRange(prior, nodeCount),
        expectConflicts: prior === 'bimodal_fork',
        expectDissent: prior === 'fragmented' || parallelScore > 0.3,
    };

    return {
        prior,
        confidence,
        signals: {
            fragmentationScore,
            bimodalityScore,
            parallelScore,
        },
        recommendation,
    };
}

function getExpectedClusterRange(
    prior: ShapePrior,
    nodeCount: number
): [number, number] {
    switch (prior) {
        case 'fragmented':
            return [nodeCount * 0.5, nodeCount]; // Many singletons expected
        case 'convergent_core':
            return [1, 3]; // 1-3 major clusters
        case 'bimodal_fork':
            return [2, 4]; // 2 main + possibly 1-2 minor
        case 'parallel_components':
            return [3, 8]; // Multiple independent tracks
    }
}

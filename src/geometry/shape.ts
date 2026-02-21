import type { TopologyMetrics } from './types';

export interface ShapeClassification {
    confidence: number;
    signals: {
        fragmentationScore: number;   // 0 = unified, 1 = maximally fragmented
        bimodalityScore: number;      // 0 = unimodal, 1 = perfect bimodal
        parallelScore: number;        // 0 = single track, 1 = multiple tracks
        convergentScore: number;      // largestComponentRatio — how dominant is the single largest component
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

    // Convergent score: how dominated the substrate is by a single large component
    const convergentScore = largestComponentRatio;

    // Confidence = strength of the dominant topology signal, whichever it is.
    // No categorical label — the signals speak for themselves.
    const confidence = Math.max(fragmentationScore, bimodalityScore, parallelScore, convergentScore);

    return {
        confidence,
        signals: {
            fragmentationScore,
            bimodalityScore,
            parallelScore,
            convergentScore,
        },
    };
}

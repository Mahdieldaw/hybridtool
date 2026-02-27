import { Edge, EnrichedClaim } from "../../../shared/contract";

export const getPercentileThreshold = (values: number[], percentile: number): number => {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.floor(sorted.length * percentile);
    return sorted[Math.min(index, sorted.length - 1)];
};

export const getTopNCount = (total: number, ratio: number): number => {
    return Math.max(1, Math.ceil(total * ratio));
};

export const isInTopPercentile = (value: number, allValues: number[], percentile: number): boolean => {
    if (allValues.length === 0) return false;
    let min = Infinity;
    let max = -Infinity;
    for (const v of allValues) {
        min = Math.min(min, v);
        max = Math.max(max, v);
    }
    if (min === max) return false;
    const threshold = getPercentileThreshold(allValues, 1 - percentile);
    return value >= threshold;
};

export const isInBottomPercentile = (value: number, allValues: number[], percentile: number): boolean => {
    if (allValues.length === 0) return false;
    let min = Infinity;
    let max = -Infinity;
    for (const v of allValues) {
        min = Math.min(min, v);
        max = Math.max(max, v);
    }
    if (min === max) return false;
    const threshold = getPercentileThreshold(allValues, percentile);
    return value < threshold;
};

// AUDIT: computeSignalStrength — HEURISTIC (partially DECORATIVE)
//
// Semantic: signal strength estimates "how much structure can be read from this
// artifact." High signal = confident classifications. Low signal = sparse/uncertain.
//
// Formula: edgeSignal*0.4 + supportSignal*0.3 + coverageSignal*0.3
//
//   edgeSignal = edges / max(3, claims*0.15) clamped 0-1
//     Measures edge density relative to a minimum threshold. The 0.15 multiplier
//     (15% of claims should have edges for "some structure") is heuristic.
//
//   supportSignal = variance(normalizedSupportCounts) * 5, clamped 0-1
//     The *5 multiplier is the key design decision: it assumes that DISAGREEMENT
//     between models (high variance in support counts) is more informative than
//     agreement (low variance). The logic: uniform support = models don't distinguish
//     claims; varying support = models have opinions. This is intentional but
//     counterintuitive — high signal does NOT mean strong consensus; it means
//     the artifact has discriminating structure. The *5 amplifier is arbitrary.
//
//   coverageSignal = uniqueModels / totalModels
//     Straightforward coverage measure. LIVE and well-motivated.
//
//   Weights (0.4, 0.3, 0.3) are heuristic, not calibrated.
//
// CONSUMER CHAIN:
//   signalStrength is stored on ProblemStructure.signalStrength AND passed to
//   buildSparseData() where it's stored in ExploratoryShapeData.signalStrength.
//   As of this audit, no UI component reads shape.signalStrength directly.
//   buildSparseData renders it into ExploratoryShapeData for potential UI use,
//   but current UI components don't surface it. PARTIALLY DECORATIVE at the
//   ProblemStructure level; potentially LIVE inside ExploratoryShapeData if
//   a future component renders that pattern's detail view.
export const computeSignalStrength = (
    claimCount: number,
    edgeCount: number,
    modelCount: number,
    supporters: number[][]
): number => {
    const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
    const minEdgesForPattern = Math.max(3, claimCount * 0.15);
    const edgeSignal = clamp01(edgeCount / minEdgesForPattern);

    const supportCounts = supporters.map(s => s.length);
    const maxSupport = Math.max(...supportCounts, 1);
    const normalized = supportCounts.map(c => c / maxSupport);

    let supportSignal = 0;
    if (normalized.length > 0) {
        const mean = normalized.reduce((a, b) => a + b, 0) / normalized.length;
        const variance = normalized.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / normalized.length;
        supportSignal = clamp01(variance * 5);
    }

    const uniqueModelCount = new Set(supporters.flat()).size;
    const coverageSignal = modelCount > 0 ? clamp01(uniqueModelCount / modelCount) : 0;

    return (edgeSignal * 0.4 + supportSignal * 0.3 + coverageSignal * 0.3);
};

export const isHubLoadBearing = (hubId: string, edges: Edge[]): boolean => {
    const prereqOut = edges.filter(e =>
        e.from === hubId && e.type === 'prerequisite'
    );
    return prereqOut.length >= 2;
};

export const determineTensionDynamics = (
    claimA: EnrichedClaim,
    claimB: EnrichedClaim
): 'symmetric' | 'asymmetric' => {
    const diff = Math.abs(claimA.supportRatio - claimB.supportRatio);
    return diff < 0.15 ? 'symmetric' : 'asymmetric';
};

// ── ELBOW DETECTION ──────────────────────────────────────────────────────
// Finds the natural boundary in a descending-sorted similarity distribution.
// Used to replace static cosine thresholds with per-distribution adaptive cuts.

export interface ElbowResult {
    index: number;          // last index to INCLUDE (boundary position)
    boundaryFound: boolean; // true if a significant gap was detected
}

export function findElbow(values: number[]): ElbowResult {
    if (values.length === 0) {
        return { index: 0, boundaryFound: false };
    }
    if (values.length === 1) {
        return { index: 0, boundaryFound: false };
    }

    // Consecutive gaps
    const gaps: number[] = [];
    for (let i = 0; i < values.length - 1; i++) {
        gaps.push(values[i] - values[i + 1]);
    }

    // Median gap
    const sortedGaps = [...gaps].sort((a, b) => a - b);
    const mid = Math.floor(sortedGaps.length / 2);
    const medianGap = sortedGaps.length % 2 === 0
        ? (sortedGaps[mid - 1] + sortedGaps[mid]) / 2
        : sortedGaps[mid];

    const MIN_GAP = 0.01;
    const gapThreshold = (values.length > 3) ? 2.0 * medianGap : medianGap;

    // First position where the drop is anomalously large
    for (let i = 0; i < gaps.length; i++) {
        if (gaps[i] > gapThreshold && gaps[i] > MIN_GAP) {
            return { index: i, boundaryFound: true };
        }
    }

    return { index: values.length - 1, boundaryFound: false };
}

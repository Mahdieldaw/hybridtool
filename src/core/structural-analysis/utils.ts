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


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

import { EnrichedClaim } from "../../../shared/contract";

export const getTopNCount = (total: number, ratio: number): number => {
    return Math.max(1, Math.ceil(total * ratio));
};

export const determineTensionDynamics = (
    claimA: EnrichedClaim,
    claimB: EnrichedClaim
): 'symmetric' | 'asymmetric' => {
    const diff = Math.abs(claimA.supportRatio - claimB.supportRatio);
    return diff < 0.15 ? 'symmetric' : 'asymmetric';
};

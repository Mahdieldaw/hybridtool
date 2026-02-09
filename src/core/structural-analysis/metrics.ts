import {
    CognitiveArtifact,
    Claim,
    Edge,
    EnrichedClaim,
} from "../../../shared/contract";
import { getTopNCount } from "./utils";

export const computeLandscapeMetrics = (artifact: CognitiveArtifact): {
    dominantType: Claim["type"];
    typeDistribution: Record<string, number>;
    dominantRole: Claim["role"];
    roleDistribution: Record<string, number>;
    claimCount: number;
    modelCount: number;
    convergenceRatio: number;
} => {
    const claims = Array.isArray(artifact?.semantic?.claims) ? artifact.semantic.claims : [];

    const typeDistribution: Record<string, number> = {};
    const roleDistribution: Record<string, number> = {};
    const supporterSet = new Set<number>();

    for (const c of claims) {
        if (!c) continue;
        typeDistribution[c.type] = (typeDistribution[c.type] || 0) + 1;
        roleDistribution[c.role] = (roleDistribution[c.role] || 0) + 1;
        if (Array.isArray(c.supporters)) {
            for (const s of c.supporters) {
                if (typeof s === "number") supporterSet.add(s);
            }
        }
    }

    const dominantType = (Object.entries(typeDistribution).sort((a, b) => b[1] - a[1])[0]?.[0] || "prescriptive") as Claim["type"];
    const dominantRole = (Object.entries(roleDistribution).sort((a, b) => b[1] - a[1])[0]?.[0] || "anchor") as Claim["role"];

    const explicitModelCount = artifact?.meta?.modelCount;

    const modelCount =
        typeof explicitModelCount === "number" && explicitModelCount > 0
            ? explicitModelCount
            : supporterSet.size > 0 ? supporterSet.size : 1;

    const topThreshold = getTopNCount(claims.length, 0.3);
    const sortedBySupport = [...claims].sort((a, b) => (b.supporters?.length || 0) - (a.supporters?.length || 0));
    const topSupportLevel = sortedBySupport[topThreshold - 1]?.supporters?.length || 1;
    const convergentClaims = claims.filter((c) => (c.supporters?.length || 0) >= topSupportLevel);

    return {
        dominantType,
        typeDistribution,
        dominantRole,
        roleDistribution,
        claimCount: claims.length,
        modelCount,
        convergenceRatio: claims.length > 0 ? convergentClaims.length / claims.length : 0,
    };
};

export const computeClaimRatios = (
    claim: Claim,
    edges: Edge[],
    modelCount: number
): Omit<EnrichedClaim,
    'isHighSupport' |
    'isContested' | 'isConditional' | 'isChallenger' | 'isIsolated'
> => {
    const safeModelCount = Math.max(modelCount, 1);
    const supporters = Array.isArray(claim.supporters) ? claim.supporters : [];

    const supportRatio = supporters.length / safeModelCount;

    const outgoing = edges.filter((e) => e.from === claim.id);
    const incoming = edges.filter((e) => e.to === claim.id);
    const inDegree = incoming.length;
    const outDegree = outgoing.length;

    return {
        ...claim,
        supportRatio,
        inDegree,
        outDegree,
    };
};

export const assignPercentileFlags = (
    claims: Array<ReturnType<typeof computeClaimRatios>>,
    edges: Edge[],
    topClaimIds: Set<string>
): EnrichedClaim[] => {
    const connectedIds = new Set<string>();
    edges.forEach(e => {
        connectedIds.add(e.from);
        connectedIds.add(e.to);
    });
    return claims.map(claim => {
        const isHighSupport = topClaimIds.has(claim.id);

        const hasConflict = edges.some(e =>
            e.type === "conflicts" && (e.from === claim.id || e.to === claim.id)
        );

        const isIsolated = !connectedIds.has(claim.id);

        return {
            ...claim,
            isHighSupport,
            isContested: hasConflict,
            isConditional: claim.type === 'conditional',
            isChallenger: claim.role === 'challenger',
            isIsolated,
        };
    });
};

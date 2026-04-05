import {
    Claim,
    Edge,
    EnrichedClaim,
    CascadeRisk,
} from "../../../shared/contract";
import {
    isInBottomPercentile,
    isHubLoadBearing
} from "./utils";

export const computeLandscapeMetrics = (input: { claims: Claim[]; modelCount?: number }): {
    modelCount: number;
} => {
    const claims = Array.isArray(input?.claims) ? input.claims : [];
    const supporterSet = new Set<number>();
    for (const c of claims) {
        if (!c) continue;
        if (Array.isArray(c.supporters)) {
            for (const s of c.supporters) {
                if (typeof s === "number") supporterSet.add(s);
            }
        }
    }
    const explicitModelCount = input?.modelCount;
    const modelCount =
        typeof explicitModelCount === "number" && explicitModelCount > 0
            ? explicitModelCount
            : supporterSet.size > 0 ? supporterSet.size : 1;
    return { modelCount };
};

export const computeClaimRatios = (
    claim: Claim,
    edges: Edge[],
    modelCount: number
): Omit<EnrichedClaim,
    'isHighSupport' | 'isLeverageInversion' | 'isKeystone' | 'isOutlier' |
    'isContested' | 'isConditional' | 'isIsolated' | 'chainDepth'
> => {
    const safeModelCount = Math.max(modelCount, 1);
    const supporters = Array.isArray(claim.supporters) ? claim.supporters : [];

    const supportRatio = supporters.length / safeModelCount;

    const outgoing = edges.filter((e) => e.from === claim.id);
    const incoming = edges.filter((e) => e.to === claim.id);
    const inDegree = incoming.length;
    const outDegree = outgoing.length;

    const hasIncomingPrereq = incoming.some((e) => e.type === "prerequisite");
    const hasOutgoingPrereq = outgoing.some((e) => e.type === "prerequisite");

    const prerequisiteOutDegree = outgoing.filter((e) => e.type === "prerequisite").length;
    const conflictEdgeCount = edges.filter(
        (e) => e.type === "conflicts" && (e.from === claim.id || e.to === claim.id)
    ).length;

    const isChainRoot = !hasIncomingPrereq && hasOutgoingPrereq;
    const isChainTerminal = hasIncomingPrereq && !hasOutgoingPrereq;

    return {
        ...claim,
        supportRatio,
        inDegree,
        outDegree,
        prerequisiteOutDegree,
        conflictEdgeCount,
        isChainRoot,
        isChainTerminal,
    };
};

export const assignPercentileFlags = (
    claims: Array<ReturnType<typeof computeClaimRatios>>,
    edges: Edge[],
    cascadeRisks: CascadeRisk[],
    topClaimIds: Set<string>
): EnrichedClaim[] => {
    const allSupportRatios = claims.map(c => c.supportRatio);

    const cascadeBySource = new Map<string, CascadeRisk>();
    cascadeRisks.forEach(risk => cascadeBySource.set(risk.sourceId, risk));

    const connectedIds = new Set<string>();
    edges.forEach(e => {
        connectedIds.add(e.from);
        connectedIds.add(e.to);
    });

    const prereqChildren = new Map<string, string[]>();
    for (const c of claims) prereqChildren.set(c.id, []);
    for (const e of edges) {
        if (e.type !== "prerequisite") continue;
        if (!prereqChildren.has(e.from) || !prereqChildren.has(e.to)) continue;
        prereqChildren.get(e.from)!.push(e.to);
    }

    const chainDepthById = new Map<string, number>();
    const queue: string[] = [];
    for (const c of claims) {
        if (!c.isChainRoot) continue;
        chainDepthById.set(c.id, 0);
        queue.push(c.id);
    }
    while (queue.length > 0) {
        const current = queue.shift()!;
        const baseDepth = chainDepthById.get(current)!;
        const next = prereqChildren.get(current) || [];
        for (const child of next) {
            const candidate = baseDepth + 1;
            const existing = chainDepthById.get(child);
            if (existing == null || candidate < existing) {
                chainDepthById.set(child, candidate);
                queue.push(child);
            }
        }
    }
    const unreachableChainDepth = Number.MAX_SAFE_INTEGER;
    return claims.map((claim) => {
        const isHighSupport = topClaimIds.has(claim.id);
        const isLowSupport = isInBottomPercentile(claim.supportRatio, allSupportRatios, 0.3);

        const isLeverageInversion = isLowSupport && (claim.outDegree >= 2 || claim.conflictEdgeCount >= 1);

        const isKeystone = claim.outDegree >= 2 && isHighSupport && isHubLoadBearing(claim.id, edges);

        const distinctModelCount = new Set(claim.supporters.map(String)).size;
        const isOutlier = claim.supporters.length <= 2 && distinctModelCount === 1;

        const hasConflict = claim.conflictEdgeCount > 0;
        const hasIncomingPrereq = edges.some(e =>
            e.type === "prerequisite" && e.to === claim.id
        );

        const isIsolated = !connectedIds.has(claim.id);
        const chainDepth = chainDepthById.get(claim.id) ?? unreachableChainDepth;

        return {
            ...claim,
            isHighSupport,
            isLeverageInversion,
            isKeystone,
            isOutlier,
            isContested: hasConflict,
            isConditional: hasIncomingPrereq,
            isIsolated,
            chainDepth,
        };
    });
};

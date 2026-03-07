import {
    CognitiveArtifact,
    Claim,
    Edge,
    EnrichedClaim,
    CascadeRisk,
    CoreRatios
} from "../../../shared/contract";
import {
    getTopNCount,
    isInTopPercentile,
    isInBottomPercentile,
    isHubLoadBearing
} from "./utils";

// AUDIT: computeCoreRatios — DECORATIVE
// Returns concentration, alignment, tension, fragmentation, depth.
// As of this audit, no UI component or downstream consumer reads `ratios` from
// the StructuralAnalysis object. The context-resolver discards it; StepExecutor
// diagnostics don't reference it; no UI component destructures it.
// These ratios are candidates for removal once positionBrief/synthesisPrompt are
// reconnected — at that point they could feed the synthesis layer meaningfully.
// DO NOT REMOVE YET: retain as documented placeholders for the reconnection phase.
export const computeCoreRatios = (
    claims: EnrichedClaim[],
    edges: Edge[],
    graph: { componentCount: number; longestChain: string[] },
    modelCount: number
): CoreRatios => {
    const claimCount = claims.length;
    const edgeCount = edges.length;

    const maxSupport = Math.max(...claims.map(c => c.supporters.length), 0);
    const concentration = modelCount > 0 ? maxSupport / modelCount : 0;

    const topCount = getTopNCount(claimCount, 0.3);
    const sortedBySupport = [...claims].sort((a, b) => b.supporters.length - a.supporters.length);
    const topIds = new Set(sortedBySupport.slice(0, topCount).map(c => c.id));

    const topEdges = edges.filter(e => topIds.has(e.from) && topIds.has(e.to));
    const reinforcingEdges = topEdges.filter(e =>
        e.type === "supports" || e.type === "prerequisite"
    ).length;

    const alignment = topEdges.length > 0
        ? reinforcingEdges / topEdges.length
        : null;

    const tensionEdges = edges.filter(e =>
        e.type === "conflicts" || e.type === "tradeoff"
    ).length;
    const tension = edgeCount > 0 ? tensionEdges / edgeCount : 0;

    const fragmentation = claimCount > 1
        ? (graph.componentCount - 1) / (claimCount - 1)
        : 0;

    const depth = claimCount > 0
        ? graph.longestChain.length / claimCount
        : 0;

    return { concentration, alignment, tension, fragmentation, depth };
};

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
    'isHighSupport' | 'isLeverageInversion' | 'isKeystone' | 'isEvidenceGap' | 'isOutlier' |
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

    // cascadeExposure: dependent count relative to supporters — used for isEvidenceGap
    const allCascadeExposures = claims.map(c => {
        const cascade = cascadeBySource.get(c.id);
        return cascade && c.supporters.length > 0
            ? cascade.dependentIds.length / c.supporters.length
            : 0;
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
    return claims.map((claim, idx) => {
        const isHighSupport = topClaimIds.has(claim.id);
        const isLowSupport = isInBottomPercentile(claim.supportRatio, allSupportRatios, 0.3);

        // isLeverageInversion: structurally active (has outgoing edges or conflict edges) but low support
        const isLeverageInversion = isLowSupport && (claim.outDegree >= 2 || claim.conflictEdgeCount >= 1);

        // isKeystone: outgoing connections + high support + structurally load-bearing hub
        const isKeystone = claim.outDegree >= 2 && isHighSupport && isHubLoadBearing(claim.id, edges);

        // isEvidenceGap: high cascade exposure relative to peers, and low support
        const cascadeExposure = allCascadeExposures[idx];
        const isEvidenceGap = isInTopPercentile(cascadeExposure, allCascadeExposures, 0.2) && cascadeExposure > 0 && isLowSupport;

        // isOutlier: single-model support with narrow supporter base
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
            isEvidenceGap,
            isOutlier,
            isContested: hasConflict,
            isConditional: hasIncomingPrereq,
            isIsolated,
            chainDepth,
        };
    });
};

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

// AUDIT: computeClaimRatios — HEURISTIC
// The leverage score combines four weights into a single number per claim.
// These weights are heuristic (design intuition), not calibrated against outcomes:
//   supportWeight  = supportRatio * 2         — HEURISTIC: doubles support's contribution
//   roleWeight     = { challenger:4, anchor:2, branch:1, supplement:0.5 } — HEURISTIC:
//     challenger is weighted highest because it structurally constrains the peak;
//     values are round-number intuitions, not derived from data.
//   connectivityWeight = prereqOut*2 + prereqIn + conflictEdges*1.5 + degree*0.25 — HEURISTIC:
//     prerequisite-out is weighted heaviest (you gate others); conflict edges more
//     than degree edges (conflict is structural not incidental). All multipliers invented.
//   positionWeight = isChainRoot ? 2 : 0     — HEURISTIC: chain roots get a flat bonus
//     on the assumption that the first link in a dependency chain is disproportionately
//     important. The value 2 is not calibrated.
//
// keystoneScore = outDegree * supporters.length — HEURISTIC:
//   Treats outgoing-connection count and supporter count as symmetric contributors to
//   keystoneness. A claim with 2 out-edges and 6 supporters scores 12; so does one with
//   6 out-edges and 2 supporters. These are structurally different situations (broad
//   support vs. broad connectivity) but the formula equates them. The assumption is that
//   both dimensions independently signal "load-bearing" status. Unvalidated.
//
// supportSkew = maxFromSingleModel / supporters.length — HEURISTIC:
//   Measures whether one model dominates a claim's support. Used only for the isOutlier
//   flag in assignPercentileFlags. isOutlier is not rendered by any current UI component;
//   if that remains true, supportSkew and isOutlier are DECORATIVE.
export const computeClaimRatios = (
    claim: Claim,
    edges: Edge[],
    modelCount: number
): Omit<EnrichedClaim,
    'isHighSupport' | 'isLeverageInversion' | 'isKeystone' | 'isEvidenceGap' | 'isOutlier' |
    'isContested' | 'isConditional' | 'isChallenger' | 'isIsolated' | 'chainDepth'
> => {
    const safeModelCount = Math.max(modelCount, 1);
    const supporters = Array.isArray(claim.supporters) ? claim.supporters : [];

    const supportRatio = supporters.length / safeModelCount;
    const supportWeight = supportRatio * 2;

    const roleWeights: Record<string, number> = {
        challenger: 4,
        anchor: 2,
        branch: 1,
        supplement: 0.5,
    };
    const roleWeight = roleWeights[claim.role] ?? 1;

    const outgoing = edges.filter((e) => e.from === claim.id);
    const incoming = edges.filter((e) => e.to === claim.id);
    const inDegree = incoming.length;
    const outDegree = outgoing.length;

    const prereqOut = outgoing.filter((e) => e.type === "prerequisite").length * 2;
    const prereqIn = incoming.filter((e) => e.type === "prerequisite").length;
    const conflictEdges = edges.filter(
        (e) => e.type === "conflicts" && (e.from === claim.id || e.to === claim.id)
    ).length * 1.5;

    const connectivityWeight = prereqOut + prereqIn + conflictEdges + (outgoing.length + incoming.length) * 0.25;

    const hasIncomingPrereq = incoming.some((e) => e.type === "prerequisite");
    const hasOutgoingPrereq = outgoing.some((e) => e.type === "prerequisite");
    const positionWeight = !hasIncomingPrereq && hasOutgoingPrereq ? 2 : 0;

    const leverage = supportWeight + roleWeight + connectivityWeight + positionWeight;
    const keystoneScore = outDegree * supporters.length;

    const supporterCounts = supporters.reduce((acc: Record<string, number>, s: number) => {
        const key = String(s);
        acc[key] = (acc[key] || 0) + 1;
        return acc;
    }, {} as Record<string, number>);
    const maxFromSingleModel = Object.values(supporterCounts).length > 0
        ? Math.max(...(Object.values(supporterCounts) as number[]))
        : 0;
    const supportSkew = supporters.length > 0 ? maxFromSingleModel / supporters.length : 0;

    const isChainRoot = !hasIncomingPrereq && hasOutgoingPrereq;
    const isChainTerminal = hasIncomingPrereq && !hasOutgoingPrereq;

    return {
        ...claim,
        supportRatio,
        leverage,
        leverageFactors: {
            supportWeight,
            roleWeight,
            connectivityWeight,
            positionWeight,
        },
        keystoneScore,
        evidenceGapScore: 0,
        supportSkew,
        inDegree,
        outDegree,
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
    const allLeverages = claims.map(c => c.leverage);
    const allKeystoneScores = claims.map(c => c.keystoneScore);
    const allSupportSkews = claims.map(c => c.supportSkew);
    const consensusIds = new Set(claims.filter(c => c.supportRatio >= 0.5).map(c => c.id));

    const cascadeBySource = new Map<string, CascadeRisk>();
    cascadeRisks.forEach(risk => cascadeBySource.set(risk.sourceId, risk));

    const connectedIds = new Set<string>();
    edges.forEach(e => {
        connectedIds.add(e.from);
        connectedIds.add(e.to);
    });
    const allEvidenceGaps = claims.map(c => {
        const cCascade = cascadeBySource.get(c.id);
        return cCascade && c.supporters.length > 0
            ? cCascade.dependentIds.length / c.supporters.length
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
    return claims.map(claim => {
        const cascade = cascadeBySource.get(claim.id);
        const evidenceGapScore = cascade && claim.supporters.length > 0
            ? cascade.dependentIds.length / claim.supporters.length
            : 0;


        const isHighSupport = topClaimIds.has(claim.id);
        const isLowSupport = isInBottomPercentile(claim.supportRatio, allSupportRatios, 0.3);
        const isHighLeverage = isInTopPercentile(claim.leverage, allLeverages, 0.25);
        const isLeverageInversion = isLowSupport && isHighLeverage;

        const isKeystoneCandidate = isInTopPercentile(claim.keystoneScore, allKeystoneScores, 0.2) && claim.outDegree >= 2;
        const isKeystone = isKeystoneCandidate && isHubLoadBearing(claim.id, edges);

        const isEvidenceGap = isInTopPercentile(evidenceGapScore, allEvidenceGaps, 0.2) && evidenceGapScore > 0;
        const isOutlier = isInTopPercentile(claim.supportSkew, allSupportSkews, 0.2) && claim.supporters.length >= 2;

        const hasConflict = edges.some(e =>
            e.type === "conflicts" && (e.from === claim.id || e.to === claim.id)
        );
        const hasIncomingPrereq = edges.some(e =>
            e.type === "prerequisite" && e.to === claim.id
        );

        const isChallenger = !isHighSupport && edges.some(e =>
            e.type === "conflicts" &&
            ((e.from === claim.id && consensusIds.has(e.to)) || (e.to === claim.id && consensusIds.has(e.from)))
        );

        const isIsolated = !connectedIds.has(claim.id);
        const chainDepth = chainDepthById.get(claim.id) ?? unreachableChainDepth;

        return {
            ...claim,
            evidenceGapScore,
            isHighSupport,
            isLeverageInversion,
            isKeystone,
            isEvidenceGap,
            isOutlier,
            isContested: hasConflict,
            isConditional: hasIncomingPrereq,
            isChallenger,
            isIsolated,
            chainDepth,
        };
    });
};

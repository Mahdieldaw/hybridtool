import {
    CognitiveArtifact,
    ProblemStructure,
    EnrichedClaim,
    StructuralAnalysis,
    SettledShapeData,
    ContestedShapeData,
    TradeoffShapeData,
    Claim,
    Edge,
} from "../../../shared/contract";
import { computeLandscapeMetrics, computeClaimRatios, assignPercentileFlags, computeCoreRatios } from "./metrics";
import { getTopNCount, computeSignalStrength } from "./utils";
import { analyzeGraph } from "./graph";
import { detectCompositeShape } from "./classification";
import {
    detectLeverageInversions,
    detectCascadeRisks,
    detectConflicts,
    detectTradeoffs,
    detectConvergencePoints,
    detectIsolatedClaims,
    detectEnrichedConflicts,
    detectConflictClusters,
    analyzeGhosts
} from "./patterns";
import {
    buildConvergentData,
    buildForkedData,
    buildConstrainedData,
    buildParallelData,
    buildSparseData
} from "./builders";
import {
    executeShadowExtraction,
    executeShadowDelta,
    extractReferencedIds,
    ShadowAudit,
    UnindexedStatement
} from "../../shadow";

type ConditionalAffectedClaims = Array<{ affectedClaims: string[] }>;

const applyComputedRoles = (
    claims: Claim[],
    edges: Edge[],
    conditionals: ConditionalAffectedClaims,
    modelCount: number
): Claim[] => {
    const safeModelCount = Math.max(modelCount, 1);
    const supportRatioById = new Map<string, number>();
    for (const c of claims) {
        const supporterCount = Array.isArray(c.supporters) ? c.supporters.length : 0;
        supportRatioById.set(c.id, supporterCount / safeModelCount);
    }
    const consensusIds = new Set<string>();
    for (const [id, ratio] of supportRatioById.entries()) {
        if (ratio >= 0.5) consensusIds.add(id);
    }

    const bestTargetByChallenger = new Map<string, { targetId: string; targetSupportRatio: number }>();
    for (const e of edges) {
        if (e.type !== "conflicts") continue;
        const fromIsConsensus = consensusIds.has(e.from);
        const toIsConsensus = consensusIds.has(e.to);
        if (fromIsConsensus === toIsConsensus) continue;

        const challengerId = fromIsConsensus ? e.to : e.from;
        const targetId = fromIsConsensus ? e.from : e.to;
        const targetSupportRatio = supportRatioById.get(targetId) ?? 0;

        const prev = bestTargetByChallenger.get(challengerId);
        if (!prev || targetSupportRatio > prev.targetSupportRatio) {
            bestTargetByChallenger.set(challengerId, { targetId, targetSupportRatio });
        }
    }

    const branchIds = new Set<string>();
    for (const c of conditionals) {
        if (!c?.affectedClaims) continue;
        for (const id of c.affectedClaims) branchIds.add(id);
    }
    const conditionalClaimIds = new Set<string>();
    for (const c of claims) {
        if (c?.type === "conditional") conditionalClaimIds.add(c.id);
    }
    if (conditionalClaimIds.size > 0) {
        for (const e of edges) {
            if (e.type !== "prerequisite") continue;
            if (!conditionalClaimIds.has(e.from)) continue;
            branchIds.add(e.to);
        }
    }

    const challengerIds = new Set<string>(bestTargetByChallenger.keys());
    const prereqOutCounts = new Map<string, number>();
    const prereqOutHasChildren = new Map<string, boolean>();
    const supportInCounts = new Map<string, number>();
    for (const e of edges) {
        if (e.type === "prerequisite") {
            prereqOutCounts.set(e.from, (prereqOutCounts.get(e.from) ?? 0) + 1);
            prereqOutHasChildren.set(e.from, true);
        } else if (e.type === "supports") {
            supportInCounts.set(e.to, (supportInCounts.get(e.to) ?? 0) + 1);
        }
    }

    const dependentsById = new Map<string, string[]>();
    for (const e of edges) {
        if (e.type !== "prerequisite") continue;
        const list = dependentsById.get(e.from) ?? [];
        list.push(e.to);
        dependentsById.set(e.from, list);
    }

    const conflictChallengerNeighborCounts = new Map<string, number>();
    const conflictChallengerNeighbors = new Map<string, Set<string>>();
    for (const e of edges) {
        if (e.type !== "conflicts") continue;
        const aIsChallenger = challengerIds.has(e.from);
        const bIsChallenger = challengerIds.has(e.to);
        if (aIsChallenger === bIsChallenger) continue;
        const targetId = aIsChallenger ? e.to : e.from;
        const challengerId = aIsChallenger ? e.from : e.to;
        const set = conflictChallengerNeighbors.get(targetId) ?? new Set<string>();
        set.add(challengerId);
        conflictChallengerNeighbors.set(targetId, set);
    }
    for (const [targetId, set] of conflictChallengerNeighbors.entries()) {
        conflictChallengerNeighborCounts.set(targetId, set.size);
    }

    const computeAnchorScore = (claimId: string): number => {
        let score = 0;
        const prereqOutDegree = prereqOutCounts.get(claimId) ?? 0;
        score += prereqOutDegree * 2;
        const supportInDegree = supportInCounts.get(claimId) ?? 0;
        score += supportInDegree * 1;
        const conflictTargetCount = conflictChallengerNeighborCounts.get(claimId) ?? 0;
        score += conflictTargetCount * 1.5;
        const dependents = dependentsById.get(claimId) ?? [];
        let dependentsArePrereqs = 0;
        for (const depId of dependents) {
            if (prereqOutHasChildren.has(depId)) dependentsArePrereqs += 1;
        }
        score += dependentsArePrereqs * 1.5;
        return score;
    };

    return claims.map((c) => {
        const target = bestTargetByChallenger.get(c.id);
        if (target) {
            return {
                ...c,
                role: "challenger",
                challenges: target.targetId,
            };
        }
        if (branchIds.has(c.id)) {
            return { ...c, role: "branch", challenges: c.challenges || null };
        }
        const anchorScore = computeAnchorScore(c.id);
        if (anchorScore >= 2) {
            return { ...c, role: "anchor", challenges: c.challenges || null };
        }
        return { ...c, role: "supplement", challenges: c.challenges || null };
    });
};

export const computeStructuralAnalysis = (artifact: CognitiveArtifact): StructuralAnalysis => {
    const semantic = artifact?.semantic;

    const rawClaims = Array.isArray(semantic?.claims) ? semantic.claims : [];
    const edges = Array.isArray(semantic?.edges) ? semantic.edges : [];
    const ghosts = Array.isArray(semantic?.ghosts) ? semantic.ghosts.filter(Boolean).map(String) : [];
    const landscape = computeLandscapeMetrics(artifact);
    const conditionals = Array.isArray(semantic?.conditionals) ? semantic.conditionals : [];
    const claimsWithDerivedRoles = applyComputedRoles(rawClaims, edges, conditionals, landscape.modelCount);
    const claimIds = claimsWithDerivedRoles.map(c => c.id);
    const claimsWithRatios = claimsWithDerivedRoles.map((c) =>
        computeClaimRatios(c, edges, landscape.modelCount)
    );
    const simpleClaimMap = new Map(claimsWithRatios.map(c => [c.id, { id: c.id, label: c.label }]));
    const cascadeRisks = detectCascadeRisks(edges, simpleClaimMap);
    const topCount = getTopNCount(claimsWithRatios.length, 0.3);
    const sortedBySupport = [...claimsWithRatios].sort((a, b) => b.supportRatio - a.supportRatio);
    const topClaimIds = new Set(sortedBySupport.slice(0, topCount).map(c => c.id));
    const claimsWithLeverage = assignPercentileFlags(claimsWithRatios, edges, cascadeRisks, topClaimIds);
    const claimMap = new Map<string, EnrichedClaim>(claimsWithLeverage.map((c) => [c.id, c]));
    const graph = analyzeGraph(claimIds, edges, claimsWithLeverage);
    const ratios = computeCoreRatios(claimsWithLeverage, edges, graph, landscape.modelCount);
    const enrichedConflicts = detectEnrichedConflicts(edges, claimsWithLeverage, landscape);
    const conflictClusters = detectConflictClusters(enrichedConflicts, claimsWithLeverage);
    const patterns: StructuralAnalysis["patterns"] = {
        leverageInversions: detectLeverageInversions(claimsWithLeverage, edges, topClaimIds),
        cascadeRisks,
        conflicts: detectConflicts(edges, claimMap, topClaimIds),
        conflictInfos: enrichedConflicts,
        conflictClusters,
        tradeoffs: detectTradeoffs(edges, claimMap, topClaimIds),
        convergencePoints: detectConvergencePoints(edges, claimMap),
        isolatedClaims: detectIsolatedClaims(claimsWithLeverage),
    };
    const ghostAnalysis = analyzeGhosts(ghosts, claimsWithLeverage);
    const signalStrength = computeSignalStrength(
        claimsWithLeverage.length,
        edges.length,
        landscape.modelCount,
        claimsWithLeverage.map(c => c.supporters)
    );
    const compositeShape = detectCompositeShape(
        claimsWithLeverage,
        edges,
        graph,
        patterns
    );
    const buildShapeData = (): ProblemStructure['data'] => {
        const { primary } = compositeShape;
        switch (primary) {
            case 'convergent':
                return buildConvergentData(claimsWithLeverage, edges, ghosts, landscape.modelCount);
            case 'forked':
                if (enrichedConflicts.length === 0 && conflictClusters.length === 0) {
                    return buildConvergentData(claimsWithLeverage, edges, ghosts, landscape.modelCount);
                }
                return buildForkedData(claimsWithLeverage, patterns, enrichedConflicts, conflictClusters);
            case 'constrained':
                if (patterns.tradeoffs.length === 0) {
                    if (enrichedConflicts.length > 0) {
                        return buildForkedData(claimsWithLeverage, patterns, enrichedConflicts, conflictClusters);
                    }
                    return buildSparseData(claimsWithLeverage, graph, ghosts, signalStrength);
                }
                return buildConstrainedData(claimsWithLeverage, patterns.tradeoffs);
            case 'parallel':
                if (graph.componentCount < 2) {
                    return buildConvergentData(claimsWithLeverage, edges, ghosts, landscape.modelCount);
                }
                return buildParallelData(claimsWithLeverage, edges, graph, ghosts);
            case 'sparse':
            default:
                return buildSparseData(claimsWithLeverage, graph, ghosts, signalStrength);
        }
    };
    let shapeData: ProblemStructure['data'] | undefined;
    try {
        shapeData = buildShapeData();
    } catch (err) {
        console.error("[StructuralAnalysis] buildShapeData failed:", {
            error: err,
            claimsCount: claimsWithLeverage.length,
            edgesCount: edges.length,
            ghostsCount: ghosts.length
        });
        shapeData = buildSparseData(claimsWithLeverage, graph, ghosts, signalStrength);
    }
    let floorAssumptions: string[] | undefined;
    let centralConflict: string | undefined;
    let tradeoffsList: string[] | undefined;

    if (shapeData?.pattern === 'settled') {
        floorAssumptions = (shapeData as SettledShapeData).floorAssumptions;
    } else if (shapeData?.pattern === 'contested') {
        centralConflict = (shapeData as ContestedShapeData).collapsingQuestion || undefined;
    } else if (shapeData?.pattern === 'tradeoff') {
        tradeoffsList = (shapeData as TradeoffShapeData).tradeoffs?.map(t =>
            t.governingFactor || `${t.optionA.label} vs ${t.optionB.label}`
        );
    }
    const shape: ProblemStructure = {
        primary: compositeShape.primary,
        confidence: compositeShape.confidence,
        patterns: compositeShape.patterns,
        peaks: compositeShape.peaks,
        peakRelationship: compositeShape.peakRelationship,
        peakPairRelations: compositeShape.peakPairRelations,
        evidence: compositeShape.evidence,
        data: shapeData,
        signalStrength,
        floorAssumptions,
        centralConflict,
        tradeoffs: tradeoffsList,
    };
    const analysis: StructuralAnalysis = {
        edges,
        landscape,
        claimsWithLeverage,
        patterns,
        ghostAnalysis,
        graph,
        ratios,
        shape,
    };
    return analysis;
};

export const computeProblemStructureFromArtifact = (artifact: CognitiveArtifact): ProblemStructure => {
    return computeStructuralAnalysis(artifact).shape;
};

export const computeFullAnalysis = (
    batchResponses: Array<{ modelIndex: number; content: string }>,
    primaryArtifact: CognitiveArtifact,
    userQuery: string
): StructuralAnalysis & {
    shadow?: {
        audit: ShadowAudit;
        unindexed: UnindexedStatement[];
        topUnindexed: UnindexedStatement[];
        processingTime: number;
    }
} => {
    const baseAnalysis = computeStructuralAnalysis(primaryArtifact);
    const shadowExtraction = executeShadowExtraction(batchResponses);
    const claims = primaryArtifact?.semantic?.claims || [];
    const referencedIds = extractReferencedIds(claims);
    const shadowDelta = executeShadowDelta(
        shadowExtraction,
        referencedIds,
        userQuery
    );
    const MAX_SHADOW_TOP = 5;
    return {
        ...baseAnalysis,
        shadow: {
            audit: shadowDelta.audit,
            unindexed: shadowDelta.unreferenced,
            topUnindexed: shadowDelta.unreferenced.slice(0, MAX_SHADOW_TOP),
            processingTime: shadowExtraction.meta.processingTimeMs + shadowDelta.processingTimeMs
        }
    };
};

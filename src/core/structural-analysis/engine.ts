import {
    ProblemStructure,
    EnrichedClaim,
    Edge,
    StructuralAnalysis,
} from "../../../shared/contract";
import { computeLandscapeMetrics, computeClaimRatios, assignPercentileFlags } from "./metrics";
import { getTopNCount } from "./utils";
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
} from "./patterns";

export interface StructuralAnalysisInput {
    claims: EnrichedClaim[];
    edges: Edge[];
    modelCount?: number;
}

export const computeStructuralAnalysis = (input: StructuralAnalysisInput): StructuralAnalysis => {
    const rawClaims = Array.isArray(input?.claims) ? input.claims : [];
    const edges = Array.isArray(input?.edges) ? input.edges : [];
    const landscape = computeLandscapeMetrics({ claims: rawClaims, modelCount: input?.modelCount });
    const claimIds = rawClaims.map(c => c.id);
    const claimsWithRatios = rawClaims.map((c) =>
        computeClaimRatios(c, edges, landscape.modelCount)
    );
    const simpleClaimMap = new Map(claimsWithRatios.map(c => [c.id, { id: c.id, label: c.label }]));
    const cascadeRisks = detectCascadeRisks(edges, simpleClaimMap);
    const topCount = getTopNCount(claimsWithRatios.length, 0.3);
    const sortedBySupport = [...claimsWithRatios].sort((a, b) => b.supportRatio - a.supportRatio);
    const topClaimIds = new Set(sortedBySupport.slice(0, topCount).map(c => c.id));
    const claimsWithFlags = assignPercentileFlags(claimsWithRatios, edges, cascadeRisks, topClaimIds);
    const graph = analyzeGraph(claimIds, edges, claimsWithFlags);
    // Attach graph-derived hubDominance to the hub claim (undefined for all others)
    const claimsWithLeverage: EnrichedClaim[] = graph.hubClaim
        ? claimsWithFlags.map(c => c.id === graph.hubClaim ? { ...c, hubDominance: graph.hubDominance } : c)
        : claimsWithFlags;
    const claimMap = new Map<string, EnrichedClaim>(claimsWithLeverage.map((c) => [c.id, c]));
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
    const compositeShape = detectCompositeShape(
        claimsWithLeverage,
        edges,
        graph,
        patterns
    );
    const shape: ProblemStructure = {
        primary: compositeShape.primary,
        confidence: compositeShape.confidence,
        patterns: compositeShape.patterns,
        evidence: compositeShape.evidence,
    };
    const analysis: StructuralAnalysis = {
        edges,
        landscape,
        claimsWithLeverage,
        patterns,
        graph,
        shape,
    };
    return analysis;
};

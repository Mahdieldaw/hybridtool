import {
    ProblemStructure,
    EnrichedClaim,
    Edge,
    StructuralAnalysis,
    SettledShapeData,
    ContestedShapeData,
    TradeoffShapeData,
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
} from "./patterns";
import {
    buildConvergentData,
    buildForkedData,
    buildConstrainedData,
    buildParallelData,
    buildSparseData
} from "./builders";
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
                return buildConvergentData(claimsWithLeverage, edges, landscape.modelCount);
            case 'forked':
                if (enrichedConflicts.length === 0 && conflictClusters.length === 0) {
                    return buildConvergentData(claimsWithLeverage, edges, landscape.modelCount);
                }
                return buildForkedData(claimsWithLeverage, patterns, enrichedConflicts, conflictClusters);
            case 'constrained':
                if (patterns.tradeoffs.length === 0) {
                    if (enrichedConflicts.length > 0) {
                        return buildForkedData(claimsWithLeverage, patterns, enrichedConflicts, conflictClusters);
                    }
                    return buildSparseData(claimsWithLeverage, graph, signalStrength);
                }
                return buildConstrainedData(claimsWithLeverage, patterns.tradeoffs);
            case 'parallel':
                if (graph.componentCount < 2) {
                    return buildConvergentData(claimsWithLeverage, edges, landscape.modelCount);
                }
                return buildParallelData(claimsWithLeverage, edges, graph);
            case 'sparse':
            default:
                return buildSparseData(claimsWithLeverage, graph, signalStrength);
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
        });
        shapeData = buildSparseData(claimsWithLeverage, graph, signalStrength);
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
        graph,
        ratios,
        shape,
    };
    return analysis;
};


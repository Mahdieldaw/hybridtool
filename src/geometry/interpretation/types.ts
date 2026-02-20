import type { ParagraphCluster } from '../../clustering/types';
import type { ShadowParagraph } from '../../shadow/ShadowParagraphProjector';
import type { Stance } from '../../shadow/StatementTypes';
import type { EnrichedClaim, Edge } from '../../../shared/contract';
import type { GeometricSubstrate } from '../types';

export type Regime = 'fragmented' | 'parallel_components' | 'bimodal_fork' | 'convergent_core';

export interface AdaptiveLens {
    regime: Regime;
    shouldRunClustering: boolean;
    hardMergeThreshold: number;
    softThreshold: number;
    k: number;
    confidence: number;
    evidence: string[];
}

export interface Region {
    id: string;
    kind: 'cluster' | 'component' | 'patch';
    nodeIds: string[];
    statementIds: string[];
    sourceId: string;
    modelIndices: number[];
}

export interface RegionizationResult {
    regions: Region[];
    meta: {
        regionCount: number;
        kindCounts: Record<Region['kind'], number>;
        fallbackUsed: boolean;
        fallbackReason?: 'clustering_skipped_by_lens' | 'no_multi_member_clusters';
        coveredNodes: number;
        totalNodes: number;
    };
}

export interface RegionProfile {
    regionId: string;
    tier: 'peak' | 'hill' | 'floor';
    tierConfidence: number;
    mass: {
        nodeCount: number;
        modelDiversity: number;
        modelDiversityRatio: number;
    };
    purity: {
        dominantStance: Stance;
        stanceUnanimity: number;
        contestedRatio: number;
        stanceVariety: number;
    };
    geometry: {
        internalDensity: number;
        isolation: number;
        nearestCarrierSimilarity: number;
        avgInternalSimilarity: number;
    };
    predicted: {
        likelyClaims: number;
    };
}

export type GateVerdict = 'proceed' | 'skip_geometry' | 'trivial_convergence' | 'insufficient_structure';

export interface PipelineGateResult {
    verdict: GateVerdict;
    confidence: number;
    evidence: string[];
    measurements: {
        isDegenerate: boolean;
        largestComponentRatio: number;
        largestComponentModelDiversityRatio: number;
        isolationRatio: number;
        maxComponentSize: number;
        nodeCount: number;
    };
}

export interface ModelScore {
    modelIndex: number;
    irreplaceability: number;
    queryRelevanceBoost?: Map<number, number>;
    breakdown: {
        soloCarrierRegions: number;
        lowDiversityContribution: number;
        totalParagraphsInRegions: number;
    };
}

export interface ModelOrderingResult {
    orderedModelIndices: number[];
    scores: ModelScore[];
    meta: {
        totalModels: number;
        regionCount: number;
        processingTimeMs: number;
    };
}

export interface GeometricObservation {
    type:
        | 'uncovered_peak'
        | 'overclaimed_floor'
        | 'claim_count_outside_range'
        | 'topology_mapper_divergence'
        | 'embedding_quality_suspect';
    observation: string;
    regionIds?: string[];
    claimIds?: string[];
}

export interface ClaimGeometricMeasurement {
    claimId: string;
    sourceCoherence: number | null;
    embeddingSpread: number | null;
    regionSpan: number;
    sourceModelDiversity: number;
    sourceStatementCount: number;
    dominantRegionId: string | null;
    dominantRegionTier: 'peak' | 'hill' | 'floor' | null;
    dominantRegionModelDiversity: number | null;
}

export interface EdgeGeographicMeasurement {
    edgeId: string;
    from: string;
    to: string;
    edgeType: string;
    crossesRegionBoundary: boolean;
    centroidSimilarity: number | null;
    fromRegionId: string | null;
    toRegionId: string | null;
}

export interface DiagnosticMeasurements {
    claimMeasurements: ClaimGeometricMeasurement[];
    edgeMeasurements: EdgeGeographicMeasurement[];
}

export interface DiagnosticsResult {
    observations: GeometricObservation[];
    measurements: DiagnosticMeasurements;
    summary: string;
    meta: {
        regionCount: number;
        claimCount: number;
        processingTimeMs: number;
    };
}

export interface PreSemanticInterpretation {
    lens: AdaptiveLens;
    regionization: RegionizationResult;
    regionProfiles: RegionProfile[];
    pipelineGate: PipelineGateResult;
    modelOrdering: ModelOrderingResult;
}

export interface InterpretationInputs {
    substrate: GeometricSubstrate;
    paragraphs: ShadowParagraph[];
    clusters?: ParagraphCluster[];
}

export type ClaimWithProvenance = EnrichedClaim & { sourceStatementIds?: string[] };

export type EdgeList = Edge[];

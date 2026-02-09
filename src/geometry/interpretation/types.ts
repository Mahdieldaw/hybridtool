import type { ParagraphCluster } from '../../clustering/types';
import type { ShadowParagraph } from '../../shadow/ShadowParagraphProjector';
import type { Stance } from '../../shadow/StatementTypes';
import type { EnrichedClaim, Edge, PrimaryShape, StructuralAnalysis } from '../../../shared/contract';
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
        avgInternalSimilarity: number;
    };
    predicted: {
        likelyClaims: number;
    };
}

export interface OppositionPair {
    regionA: string;
    regionB: string;
    similarity: number;
    stanceConflict: boolean;
    reason: string;
}

export interface ShapePrediction {
    predicted: PrimaryShape;
    confidence: number;
    evidence: string[];
}

export interface MapperGeometricHints {
    predictedShape: ShapePrediction;
    expectedClaimCount: [number, number];
    expectedConflicts: number;
    expectedDissent: boolean;
    attentionRegions: Array<{
        regionId: string;
        reason:
            | 'semantic_opposition'
            | 'high_isolation'
            | 'stance_inversion'
            | 'uncertain'
            | 'bridge'
            | 'low_cohesion';
        priority: 'high' | 'medium' | 'low';
        guidance: string;
    }>;
    meta: {
        usedClusters: boolean;
        regionCount: number;
        oppositionCount: number;
    };
}

export interface PreSemanticInterpretation {
    lens: AdaptiveLens;
    regionization: RegionizationResult;
    regionProfiles: RegionProfile[];
    oppositions: OppositionPair[];
    hints: MapperGeometricHints;
}

export interface StructuralViolation {
    type:
        | 'shape_mismatch'
        | 'claim_count_mismatch'
        | 'tier_mismatch'
        | 'missed_conflict'
        | 'false_conflict'
        | 'embedding_quality_suspect';
    severity: 'high' | 'medium' | 'low';
    predicted: { description: string; evidence: string };
    actual: { description: string; evidence: string };
    regionIds?: string[];
    claimIds?: string[];
}

export interface StructuralValidation {
    shapeMatch: boolean;
    predictedShape: PrimaryShape;
    actualShape: PrimaryShape;
    tierAlignmentScore: number;
    conflictPrecision: number;
    conflictRecall: number;
    violations: StructuralViolation[];
    overallFidelity: number;
    confidence: 'high' | 'medium' | 'low';
    summary: string;
    diagnostics: {
        expectedClaimCount: [number, number];
        expectedConflicts: number;
        actualConflictEdges: number;
        actualPeakClaims: number;
        mappedPeakClaims: number;
    };
}

export interface InterpretationInputs {
    substrate: GeometricSubstrate;
    paragraphs: ShadowParagraph[];
    clusters?: ParagraphCluster[];
}

export interface ValidationInputs {
    preSemantic: PreSemanticInterpretation;
    postSemantic: StructuralAnalysis;
}

export type ClaimWithProvenance = EnrichedClaim & { sourceStatementIds?: string[] };

export type EdgeList = Edge[];

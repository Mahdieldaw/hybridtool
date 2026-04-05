import type { ShadowParagraph } from '../../shadow/ShadowParagraphProjector';
import type { EnrichedClaim, Edge } from '../../../shared/contract';
import type { GeometricSubstrate } from '../types';

export interface Region {
    id: string;
    kind: 'basin' | 'gap';
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
        coveredNodes: number;
        totalNodes: number;
    };
}

export interface RegionProfile {
    regionId: string;
    mass: {
        nodeCount: number;
        modelDiversity: number;
        modelDiversityRatio: number;
    };
    geometry: {
        internalDensity: number;
        isolation: number;
        nearestCarrierSimilarity: number;
        avgInternalSimilarity: number;
    };
}

export type GateVerdict = 'proceed' | 'skip_geometry' | 'insufficient_structure';

export interface PipelineGateResult {
    verdict: GateVerdict;
    confidence: number;
    evidence: string[];
    measurements: {
        isDegenerate: boolean;
        isolationRatio: number;
        edgeCount: number;
        density: number;
        discriminationRange: number;
        nodeCount: number;
    };
}

export interface PreSemanticInterpretation {
    regionization: RegionizationResult;
    regionProfiles: RegionProfile[];
    pipelineGate: PipelineGateResult;
}

export interface InterpretationInputs {
    substrate: GeometricSubstrate;
    paragraphs: ShadowParagraph[];
}

export type ClaimWithProvenance = EnrichedClaim & { sourceStatementIds?: string[] };

export type EdgeList = Edge[];

export type {
    AdaptiveLens,
    Region,
    RegionizationResult,
    RegionProfile,
    PreSemanticInterpretation,
    GateVerdict,
    PipelineGateResult,
    ModelScore,
    ModelOrderingResult,
    GeometricObservation,
    DiagnosticsResult,
    InterpretationInputs,
    ClaimWithProvenance,
    EdgeList,
} from './types';

export { deriveLens } from './lens';
export { buildRegions } from './regions';
export { profileRegions } from './profiles';
export { evaluatePipelineGates } from './pipelineGates';
export { computeModelOrdering, computePerModelQueryRelevance } from './modelOrdering';
export { computeDiagnostics } from './diagnostics';
export { validateStructuralMapping } from './validation';

import type { ShadowParagraph } from '../../shadow/ShadowParagraphProjector';
import type { GeometricSubstrate } from '../types';
import type { ModelOrderingResult, PreSemanticInterpretation } from './types';
import { deriveLens } from './lens';
import { buildRegions } from './regions';
import { profileRegions } from './profiles';
import { evaluatePipelineGates } from './pipelineGates';
import { computeModelOrdering } from './modelOrdering';

function buildDefaultModelOrdering(substrate: GeometricSubstrate, regionCount: number): ModelOrderingResult {
    const startedAt = Date.now();
    const observedModelIndices = Array.from(
        new Set(substrate.nodes.map(n => n.modelIndex).filter((x): x is number => typeof x === 'number'))
    ).sort((a, b) => a - b);

    return {
        orderedModelIndices: observedModelIndices,
        scores: observedModelIndices.map(modelIndex => ({
            modelIndex,
            irreplaceability: 0,
            breakdown: {
                soloCarrierRegions: 0,
                lowDiversityContribution: 0,
                totalParagraphsInRegions: 0,
            },
        })),
        meta: {
            totalModels: observedModelIndices.length,
            regionCount,
            processingTimeMs: Date.now() - startedAt,
        },
    };
}

export function buildPreSemanticInterpretation(
    substrate: GeometricSubstrate,
    paragraphs: ShadowParagraph[],
    paragraphEmbeddings?: Map<string, Float32Array> | null,
    queryRelevanceBoost?: Map<number, number>
): PreSemanticInterpretation {
    const lens = deriveLens(substrate);
    const pipelineGate = evaluatePipelineGates(substrate);
    if (pipelineGate.verdict === 'skip_geometry') {
        return {
            lens,
            pipelineGate,
            regionization: {
                regions: [],
                meta: {
                    regionCount: 0,
                    kindCounts: { component: 0, patch: 0 },
                    coveredNodes: 0,
                    totalNodes: substrate.nodes.length,
                },
            },
            regionProfiles: [],
            modelOrdering: buildDefaultModelOrdering(substrate, 0),
        };
    }

    const regionization = buildRegions(substrate, paragraphs, lens);
    const regionProfiles = profileRegions(regionization.regions, substrate, paragraphs, paragraphEmbeddings ?? null);
    const modelOrdering =
        pipelineGate.verdict === 'insufficient_structure'
            ? buildDefaultModelOrdering(substrate, regionization.regions.length)
            : computeModelOrdering(regionization.regions, regionProfiles, substrate, queryRelevanceBoost);

    return {
        lens,
        pipelineGate,
        regionization,
        regionProfiles,
        modelOrdering,
    };
}

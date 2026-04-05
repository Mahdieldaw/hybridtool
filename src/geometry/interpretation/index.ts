export type {
    Region,
    RegionizationResult,
    RegionProfile,
    PreSemanticInterpretation,
    GateVerdict,
    PipelineGateResult,
    InterpretationInputs,
    ClaimWithProvenance,
    EdgeList,
} from './types';

export { buildRegions } from './regions';
export { profileRegions } from './profiles';
export { evaluatePipelineGates } from './pipelineGates';

import type { ShadowParagraph } from '../../shadow/ShadowParagraphProjector';
import type { GeometricSubstrate } from '../types';
import type { PreSemanticInterpretation } from './types';
import { buildRegions } from './regions';
import { profileRegions } from './profiles';
import { evaluatePipelineGates } from './pipelineGates';
import { computeGapRegionalization } from '../../../shared/geometry/gapRegionalization';

export function buildPreSemanticInterpretation(
    substrate: GeometricSubstrate,
    paragraphs: ShadowParagraph[],
    paragraphEmbeddings?: Map<string, Float32Array> | null,
    _queryRelevanceBoost?: unknown,
    basinInversionResult?: any
): PreSemanticInterpretation {
    const pipelineGate = evaluatePipelineGates(substrate);
    if (pipelineGate.verdict === 'skip_geometry') {
        return {
            pipelineGate,
            regionization: {
                regions: [],
                meta: {
                    regionCount: 0,
                    kindCounts: { basin: 0, gap: 0 },
                    coveredNodes: 0,
                    totalNodes: substrate.nodes.length,
                },
            },
            regionProfiles: [],
        };
    }

    let gapResult: any = null;
    if (paragraphEmbeddings) {
        const nodes = substrate.nodes
            .map(n => ({ id: n.paragraphId, embedding: paragraphEmbeddings.get(n.paragraphId)! }))
            .filter(n => n.embedding != null);
        if (nodes.length > 0) {
            gapResult = computeGapRegionalization(nodes);
        }
    }

    const regionization = buildRegions(substrate, paragraphs, basinInversionResult, gapResult);
    const regionProfiles = profileRegions(regionization.regions, substrate, paragraphs, paragraphEmbeddings ?? null);

    return {
        pipelineGate,
        regionization,
        regionProfiles,
    };
}

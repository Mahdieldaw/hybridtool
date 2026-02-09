export type {
    Regime,
    AdaptiveLens,
    Region,
    RegionizationResult,
    RegionProfile,
    OppositionPair,
    ShapePrediction,
    MapperGeometricHints,
    PreSemanticInterpretation,
    StructuralViolation,
    StructuralValidation,
    InterpretationInputs,
    ValidationInputs,
    ClaimWithProvenance,
    EdgeList,
} from './types';

export { deriveLens } from './lens';
export { buildRegions } from './regions';
export { profileRegions } from './profiles';
export { detectOppositions } from './opposition';
export { buildMapperGeometricHints } from './guidance';
export { validateStructuralMapping } from './validation';

import type { ParagraphCluster } from '../../clustering/types';
import type { ShadowParagraph } from '../../shadow/ShadowParagraphProjector';
import type { GeometricSubstrate } from '../types';
import type { PreSemanticInterpretation } from './types';

import { deriveLens } from './lens';
import { buildRegions } from './regions';
import { profileRegions } from './profiles';
import { detectOppositions } from './opposition';
import { buildMapperGeometricHints } from './guidance';

export function buildPreSemanticInterpretation(
    substrate: GeometricSubstrate,
    paragraphs: ShadowParagraph[],
    clusters?: ParagraphCluster[]
): PreSemanticInterpretation {
    const lens = deriveLens(substrate);
    const regionization = buildRegions(substrate, paragraphs, lens, clusters);
    const regionProfiles = profileRegions(regionization.regions, substrate, paragraphs);
    const oppositions = detectOppositions(regionization.regions, regionProfiles, substrate);
    const hints = buildMapperGeometricHints(substrate, regionization.regions, regionProfiles, oppositions);

    return {
        lens,
        regionization,
        regionProfiles,
        oppositions,
        hints,
    };
}

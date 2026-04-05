// ═══════════════════════════════════════════════════════════════════════════
// GEOMETRY MODULE - PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════

// Types
export type {
    NodeLocalStats,
    GeometricSubstrate,
    DegenerateSubstrate,
    DegenerateReason,
    PairwiseField,
    PairwiseFieldStats,
    MutualRankEdge,
    MutualRankNodeStats,
    MutualRankGraph,
} from './types';

export { isDegenerate } from './types';

// Config
export type { SubstrateConfig } from './substrate';
export { DEFAULT_SUBSTRATE_CONFIG } from './substrate';

// Main builder
export { buildGeometricSubstrate } from './substrate';

// Utilities
export { quantize, buildPairwiseField } from './knn';
export { computeExtendedStatsFromArray } from './threshold';
export { buildMutualRankGraph } from './mutualRank';
export { computeNodeStats } from './nodes';

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
} from './interpretation/types';

export { buildRegions } from './interpretation/regions';
export { profileRegions } from './interpretation/profiles';
export { evaluatePipelineGates } from './interpretation/pipelineGates';
export { buildPreSemanticInterpretation } from './interpretation';

export type { QueryRelevanceResult, QueryRelevanceStatementScore } from './queryRelevance';
export { computeQueryRelevance } from './queryRelevance';

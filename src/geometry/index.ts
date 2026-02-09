// ═══════════════════════════════════════════════════════════════════════════
// GEOMETRY MODULE - PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════

// Types
export type {
    KnnEdge,
    MutualKnnEdge,
    KnnGraph,
    MutualKnnGraph,
    StrongGraph,
    NodeLocalStats,
    Component,
    TopologyMetrics,
    GeometricSubstrate,
    DegenerateSubstrate,
    DegenerateReason,
} from './types';

export { isDegenerate } from './types';

// Config
export type { SubstrateConfig } from './substrate';
export type { ThresholdConfig } from './threshold';
export { DEFAULT_SUBSTRATE_CONFIG } from './substrate';
export { DEFAULT_THRESHOLD_CONFIG } from './threshold';

// Main builder
export { buildGeometricSubstrate } from './substrate';

// Utilities (for testing/debugging)
export { quantize, buildTwoGraphs } from './knn';
export { computeSoftThreshold, computeSimilarityStats } from './threshold';
export { computeTopology } from './topology';
export { computeNodeStats } from './nodes';

export type { ShapePrior, ShapeClassification } from './shape';
export { classifyShape } from './shape';

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
} from './interpretation/types';

// Alignment (claim↔geometry)
export type {
    ClaimVector,
    RegionCoverage,
    SplitAlert,
    MergeAlert,
    AlignmentResult,
} from './alignment';
export { buildClaimVectors, computeAlignment } from './alignment';

export { deriveLens } from './interpretation/lens';
export { buildRegions } from './interpretation/regions';
export { profileRegions } from './interpretation/profiles';
export { detectOppositions } from './interpretation/opposition';
export { buildMapperGeometricHints } from './interpretation/guidance';
export { validateStructuralMapping } from './interpretation/validation';
export { buildPreSemanticInterpretation } from './interpretation';

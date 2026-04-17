// ═══════════════════════════════════════════════════════════════════════════
// GEOMETRY MODULE - PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════

// ─── Types ────────────────────────────────────────────────────────────────────

export type {
  NodeLocalStats,
  GeometricSubstrate,
  MeasuredSubstrate,
  SubstrateHealth,
  DegenerateSubstrate,
  DegenerateReason,
  PairwiseField,
  PairwiseFieldStats,
  MutualRankEdge,
  MutualRankNodeStats,
  MutualRankGraph,
  MeasuredRegion,
  SubstrateInterpretation,
  RegionizationMeta,
  BasinNodeProfile,
  NodeStructuralProfile,
  GateVerdict,
  PipelineGateResult,
  CorpusMode,
  PeripheryResult,
  ExtendedSimilarityStats,
} from './types';

export { isDegenerate } from './types';

// ─── Measure ──────────────────────────────────────────────────────────────────

export type { SubstrateConfig } from './measure';
export { DEFAULT_SUBSTRATE_CONFIG } from './measure';

export {
  measureSubstrate,
  buildGeometricSubstrate,   // backward-compat alias
  buildMutualRankGraph,
  computeNodeStats,
  computeExtendedStatsFromArray,
  quantize,
} from './measure';

// ─── Interpret ────────────────────────────────────────────────────────────────

export {
  interpretSubstrate,
  buildPreSemanticInterpretation, // backward-compat alias
  identifyPeriphery,
} from './interpret';

// ─── Annotate ─────────────────────────────────────────────────────────────────

export type { QueryRelevanceResult, QueryRelevanceStatementScore, EnrichmentResult } from './annotate';

export {
  enrichStatementsWithGeometry,
  enrichStatements,
  computeQueryRelevance,
  annotateStatements,
} from './annotate';

// ─── Engine (full pipeline) ───────────────────────────────────────────────────

export type { GeometryPipelineResult } from './engine';
export { buildGeometryPipeline } from './engine';

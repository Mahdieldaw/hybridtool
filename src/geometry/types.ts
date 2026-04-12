// ===========================================================================
// GEOMETRIC SUBSTRATE TYPES
// ===========================================================================

import type { Stance } from '../shadow/statement-types';

// ------------------------------------------------------------------------------
// SIMILARITY STATS (inlined from threshold.ts)
// ------------------------------------------------------------------------------

export interface ExtendedSimilarityStats {
  count: number;
  min: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p80: number;
  p90: number;
  p95: number;
  max: number;
  mean: number;
  stddev: number;
}

// ------------------------------------------------------------------------------
// NODE STATS
// ------------------------------------------------------------------------------

export interface NodeLocalStats {
  paragraphId: string;
  modelIndex: number;
  dominantStance: Stance;
  contested: boolean;
  statementIds: string[];

  isolationScore: number; // 0 = connected hub, 1 = fully isolated

  // From mutual recognition graph (μ+σ)
  mutualNeighborhoodPatch: string[];
  mutualRankDegree: number;

  // topographic basin id (from density inversion)
  basinId?: number;
}

// ------------------------------------------------------------------------------
// PAIRWISE FIELD (full N×N similarity matrix)
// ------------------------------------------------------------------------------

export interface PairwiseFieldStats extends ExtendedSimilarityStats {
  discriminationRange: number; // p90 - p10
}

export interface PairwiseField {
  matrix: Map<string, Map<string, number>>;
  perNode: Map<string, Array<{ nodeId: string; similarity: number }>>;
  stats: PairwiseFieldStats;
  nodeCount: number;
}

// ------------------------------------------------------------------------------
// MUTUAL RECOGNITION GRAPH (μ+σ mutual recognition, no parameters)
// ------------------------------------------------------------------------------

export interface MutualRankEdge {
  source: string;
  target: string;
  similarity: number;
}

export interface MutualRecognitionThresholdStats {
  paragraphId: string;
  mean: number;
  stddev: number;
  threshold: number; // mean + stddev
  notableNeighborCount: number;
}

export interface MutualRankNodeStats {
  paragraphId: string;
  mutualRankDegree: number;
  isolated: boolean;
  mutualRankNeighborhood: string[]; // [self + neighbors], sorted
}

export interface MutualRankGraph {
  edges: MutualRankEdge[];
  adjacency: Map<string, MutualRankEdge[]>;
  nodeStats: Map<string, MutualRankNodeStats>;
  thresholdStats: Map<string, MutualRecognitionThresholdStats>;
}

export interface Layout2D {
  method: 'umap' | 'spectral' | 'force';
  coordinates: Record<string, [number, number]>;
  buildTimeMs: number;
}

// ------------------------------------------------------------------------------
// SUBSTRATE HEALTH (pre-computed gate measurements)
// ------------------------------------------------------------------------------

export interface SubstrateHealth {
  isolationRatio: number; // fraction of nodes with zero mutual recognition edges
  edgeCount: number; // total edges in mutual recognition graph
  density: number; // edgeCount / maxPossibleEdges
  discriminationRange: number; // p90 - p10 from pairwise field
  nodeCount: number;
}

// ------------------------------------------------------------------------------
// FULL SUBSTRATE
// ------------------------------------------------------------------------------

export interface GeometricSubstrate {
  nodes: NodeLocalStats[];

  pairwiseField: PairwiseField;
  mutualRankGraph: MutualRankGraph;

  layout2d?: Layout2D;

  health: SubstrateHealth;

  meta: {
    embeddingSuccess: boolean;
    embeddingBackend: 'webgpu' | 'wasm' | 'none';
    nodeCount: number;

    similarityStats: {
      max: number;
      p95: number;
      p80: number;
      p50: number;
      mean: number;
    };

    quantization: '1e-6';
    tieBreaker: 'lexicographic';
    buildTimeMs: number;
  };
}

// ------------------------------------------------------------------------------
// DEGENERATE SUBSTRATE (embedding failure)
// ------------------------------------------------------------------------------

export type DegenerateReason =
  | 'embedding_failure'
  | 'insufficient_paragraphs'
  | 'all_embeddings_identical';

export interface DegenerateSubstrate extends GeometricSubstrate {
  degenerate: true;
  degenerateReason: DegenerateReason;
}

export function isDegenerate(s: GeometricSubstrate): s is DegenerateSubstrate {
  return 'degenerate' in s && s.degenerate === true;
}

// MeasuredSubstrate: alias for GeometricSubstrate — all substrates carry health after refactor.
export type MeasuredSubstrate = GeometricSubstrate;

// ------------------------------------------------------------------------------
// INTERPRETATION TYPES (merged from interpretation/types.ts)
// ------------------------------------------------------------------------------

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

/** Which geometry source produced the regions array. */
export type RegionSource = 'gap' | 'basin' | 'none';

/** Single flat object merging region identity + mass + geometry metrics. */
export interface MeasuredRegion {
  // Identity
  id: string;
  kind: 'basin' | 'gap';
  nodeIds: string[];
  statementIds: string[];
  sourceId: string;
  modelIndices: number[];

  // Mass metrics
  nodeCount: number;
  modelDiversity: number;
  modelDiversityRatio: number;

  // Geometry metrics
  internalDensity: number;
  isolation: number;
  nearestCarrierSimilarity: number;
  avgInternalSimilarity: number;
}

export interface RegionizationMeta {
  regionCount: number;
  kindCounts: Record<'basin' | 'gap', number>;
  coveredNodes: number;
  totalNodes: number;
}

export type CorpusMode = 'dominant-core' | 'parallel-cores' | 'no-geometry';

/** Shape returned by identifyPeriphery — also embedded in SubstrateInterpretation. */
export interface PeripheryResult {
  corpusMode: CorpusMode;
  peripheralNodeIds: Set<string>;
  peripheralRatio: number;
  largestBasinRatio: number | null;
  basinByNodeId: Record<string, number>;
}

/** Output of interpretSubstrate(). */
export interface SubstrateInterpretation {
  gate: PipelineGateResult;

  // Region lens
  regions: MeasuredRegion[];
  regionMeta: RegionizationMeta;
  regionSource: RegionSource;

  // Basin lens (separate — do not conflate with regions)
  corpusMode: CorpusMode;
  peripheralNodeIds: Set<string>;
  peripheralRatio: number;
  largestBasinRatio: number | null;
  basinByNodeId: Record<string, number>;
}

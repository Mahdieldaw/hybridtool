// ===========================================================================
// GEOMETRIC SUBSTRATE TYPES
// ===========================================================================

import type { Stance } from '../shadow/statement-types';
import type { BasinInversionResult } from '../../shared/types';

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

}

// ------------------------------------------------------------------------------
// PAIRWISE FIELD (full N×N similarity matrix)
// ------------------------------------------------------------------------------

export interface PairwiseFieldStats extends ExtendedSimilarityStats {
  discriminationRange: number; // p90 - p10
  // Pre-computed histogram (sqrt(pairCount) bins, algorithm-independent)
  histogram: number[];
  binCount: number;
  binMin: number;
  binMax: number;
  binWidth: number;
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

/** Per-node basin alignment profile derived from pairwise similarity field. */
export interface BasinNodeProfile {
  basinId: number | null;
  intraBasinSimilarity: number;   // avg similarity to nodes in assigned basin
  interBasinSimilarity: number;   // avg similarity to nodes outside basin
  separationDelta: number;        // intra - inter
}

/** Per-node structural profile: independent measurement signals. */
export interface NodeStructuralProfile {
  paragraphId: string;
  connectivity: number;           // [0,1] mutual rank degree, normalized by (N-1)
  gapStrength: number;            // [0,1] upper boundary from NodeGapProfile
  basinId: number | null;         // categorical basin membership
  basinSeparationDelta: number;   // intra-basin minus inter-basin similarity
}

/** Output of interpretSubstrate(). */
export interface SubstrateInterpretation {
  gate: PipelineGateResult;

  // Region lens (always from gap)
  regions: MeasuredRegion[];
  regionMeta: RegionizationMeta;

  // Basin lens (separate — do not conflate with regions)
  corpusMode: CorpusMode;
  peripheralNodeIds: Set<string>;
  peripheralRatio: number;
  largestBasinRatio: number | null;
  basinByNodeId: Record<string, number>;

  // Basin inversion result — parallel structural signal (L2 owned)
  basinInversion: BasinInversionResult | null;

  // Node annotations — replaces in-place mutation of substrate.nodes
  nodeAnnotations: Map<string, { basinId: number | null; regionId: string | null }>;

  // Structural profiles — per-node measurement signals (evidence layer)
  structuralProfiles: Map<string, NodeStructuralProfile>;
  basinNodeProfiles: Map<string, BasinNodeProfile>;
}

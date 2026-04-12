// ============================================================================
// GRAPH TYPES — graph computation layer (pure src-side)
// ============================================================================
import type { ShadowStatement } from './contract';

export interface Claim {
  id: string;
  label: string;
  text: string;
  dimension?: string | null; // Optional legacy metadata
  supporters: number[];
  type:
    | 'factual'
    | 'prescriptive'
    | 'cautionary'
    | 'assertive'
    | 'uncertain'
    | 'conditional'
    | 'contested'
    | 'speculative';
  role?: 'anchor' | 'branch' | 'challenger' | 'supplement';
  quote?: string;
  support_count?: number;
  sourceStatementIds?: string[]; // Tracking for shadow mapper provenance
  sourceCoherence?: number;
}

export interface Edge {
  from: string;
  to: string;
  type: 'supports' | 'conflicts' | 'tradeoff' | 'prerequisite';
}

export interface EnrichedClaim extends Claim {
  derivedType?: Claim['type'];
  sourceStatementIds?: string[];
  sourceStatements?: ShadowStatement[];
  geometricSignals?: {
    backedByPeak: boolean;
    backedByHill: boolean;
    backedByFloor: boolean;
    avgGeometricConfidence: number;
    sourceRegionIds: string[];
  };
  supportRatio: number;
  inDegree: number;
  outDegree: number;
  prerequisiteOutDegree: number;
  conflictEdgeCount: number;
  hubDominance?: number;
  isChainRoot: boolean;
  isChainTerminal: boolean;

  isHighSupport: boolean;
  isKeystone: boolean;
  isOutlier: boolean;
  isContested: boolean;
  isConditional: boolean;
  isIsolated: boolean;
  chainDepth: number;
  queryDistance?: number;
}

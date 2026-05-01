// ============================================================================
// GRAPH TYPES — graph computation layer (pure src-side)
// ============================================================================

import type { ClaimStructuralFingerprint } from './structural-fingerprint';

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
  sourceCoherence?: number;
  structuralFingerprint?: ClaimStructuralFingerprint;
}

export interface Edge {
  from: string;
  to: string;
  type: 'supports' | 'conflicts' | 'tradeoff' | 'prerequisite';
}

export interface EnrichedClaim extends Claim {
  derivedType?: Claim['type'];
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

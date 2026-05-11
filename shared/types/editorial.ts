// ============================================================================
// EDITORIAL TYPES — cognitive pipeline → editorial UI rendering boundary
// ============================================================================
import type { Claim, Edge, EnrichedClaim } from './graph';
import type {
  PipelineShadowStatement,
  PipelineShadowParagraph,
  PipelineSubstrateGraph,
  BasinInversionResult,
  PreSemanticInterpretation,
  PipelineDiagnosticsResult,
} from './contract';

// Re-export for consumers that only import from editorial
export type { EnrichedClaim };

export interface ChallengedPatternData {
  challenges: Array<{
    challenger: { id: string; label: string; supportRatio: number };
    target: { id: string; label: string; supportRatio: number };
  }>;
}

export interface KeystonePatternData {
  keystone: { id: string; label: string; supportRatio: number };
  dependents: string[];
  cascadeSize: number;
}

export interface ChainPatternData {
  chain: string[];
  length: number;
  weakLinks: string[];
}

export interface FragilePatternData {
  fragilities: Array<{
    peak: { id: string; label: string };
    weakFoundation: { id: string; label: string; supportRatio: number };
  }>;
}

export interface ConditionalPatternData {
  conditions: Array<{ id: string; label: string; branches: string[] }>;
}

export interface SecondaryPattern {
  type: any;
  severity: 'high' | 'medium' | 'low';
  data:
    | ChallengedPatternData
    | KeystonePatternData
    | ChainPatternData
    | FragilePatternData
    | ConditionalPatternData;
}

export interface SingularityOutput {
  text: string;
  providerId: string;
  timestamp: number;
  leakageDetected?: boolean;
  leakageViolations?: string[];
  pipeline?: any | null;
}

export interface EditorialThreadItem {
  id: string; // claim ID (e.g. "claim_3") or unclaimed-run ID (e.g. "u_m1_2")
  role: 'anchor' | 'development' | 'alternative';
}

export interface EditorialThread {
  id: string;
  label: string;
  why_care: string;
  start_here: boolean;
  items: EditorialThreadItem[];
}

export interface EditorialAST {
  orientation: string;
  threads: EditorialThread[];
  thread_order: string[];
  /** Run IDs referenced anywhere in threads — derived after parsing. Their statements are 'unclaimedclaimed'. */
  elevatedRunIds: string[];
  diagnostics: {
    flat_corpus: boolean;
    notes: string;
  };
}

export interface CognitiveArtifact {
  substrateSummary?: any;
  shadow: {
    statements: PipelineShadowStatement[];
    paragraphs: PipelineShadowParagraph[];
  };
  geometry: {
    embeddingStatus: 'computed' | 'failed';
    substrate: PipelineSubstrateGraph;
    basinInversion?: BasinInversionResult;
    bayesianBasinInversion?: BasinInversionResult;
    preSemantic?: PreSemanticInterpretation | null;
    diagnostics?: PipelineDiagnosticsResult | null;
    structuralValidation?: any | null;
  };
  semantic: {
    claims: Claim[];
    edges: Edge[];
    narrative?: string;
  };
  citationSourceOrder?: Record<number, string>;
  /** Unclaimed runs computed at editorial-mapper time. Persisted so the resolver can find run text without recomputing. */
  unclaimedRuns?: UnclaimedRun[];
  meta?: {
    modelCount?: number;
    query?: string;
    turn?: number;
    timestamp?: string;
  };
}

/**
 * A contiguous run of statements within a single model's output that are not assigned to any claim.
 * Editorial mapper decides whether each run is query-relevant (referenced in threads → 'unclaimedclaimed')
 * or stays unclaimed (not referenced).
 */
export interface UnclaimedRun {
  runId: string; // "u_m{modelIndex}_{runOrdinal}"
  modelIndex: number;
  statementIds: string[];
  text: string;
}

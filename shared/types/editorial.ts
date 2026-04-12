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
  id: string; // passageKey or unclaimed group key
  role: 'anchor' | 'support' | 'context' | 'reframe' | 'alternative';
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
  diagnostics: {
    flat_corpus: boolean;
    conflict_count: number;
    notes: string;
  };
}

export interface CognitiveArtifact {
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
    conditionals: any[];
    narrative?: string;
  };
  meta?: {
    modelCount?: number;
    query?: string;
    turn?: number;
    timestamp?: string;
  };
}

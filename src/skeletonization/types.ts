import type { ShadowStatement, ShadowParagraph } from '../shadow';
import type { EnrichedClaim } from '../../shared/contract';

export type StatementAction = 'PROTECTED' | 'UNTRIAGED' | 'SKELETONIZE' | 'REMOVE';

export interface StatementFate {
  statementId: string;
  action: StatementAction;
  reason: string;
  triggerClaimId?: string;
}

export interface DirectionProbe {
  survivingClaimId: string;
  twinStatementId: string | null;
  twinSimilarity: number | null;
  pointsIntoPrunedSet: boolean | null; // null = no twin found
}

export interface MixedStatementDetail {
  statementId: string;
  survivingParents: string[];
  prunedParents: string[];
  action: 'PROTECTED' | 'REMOVE' | 'SKELETONIZE';
  reason: string;
  probes: DirectionProbe[];
  /** The surviving claim that "saved" this statement (if PROTECTED) */
  protectorClaimId: string | null;
}

export interface MixedInstrumentation {
  mixedCount: number;
  mixedProtectedCount: number;
  mixedRemovedCount: number;
  mixedSkeletonizedCount: number;
  details: MixedStatementDetail[];
  /** Keyed by pruned claimId → array of mixed statements involving that pruned claim */
  byPrunedClaim: Record<string, MixedStatementDetail[]>;
}

export interface TriageResult {
  protectedStatementIds: Set<string>;
  statementFates: Map<string, StatementFate>;
  mixedInstrumentation: MixedInstrumentation;
  meta: {
    totalStatements: number;
    protectedCount: number;
    untriagedCount?: number;
    skeletonizedCount: number;
    removedCount: number;
    mixedCount: number;
    mixedProtectedCount: number;
    mixedRemovedCount: number;
    mixedSkeletonizedCount: number;
    processingTimeMs: number;
  };
}

export interface ReconstructedOutput {
  modelIndex: number;
  providerId: string;
  text: string;
  paragraphs: ReconstructedParagraph[];
  meta: {
    originalCharCount: number;
    finalCharCount: number;
    protectedStatementCount: number;
    untriagedStatementCount?: number;
    skeletonizedStatementCount: number;
    removedStatementCount: number;
    isPassthrough?: boolean;
  };
}

export interface ReconstructedParagraph {
  paragraphId: string;
  text: string;
  intactRatio: number;
  statements: Array<{
    statementId: string;
    action: StatementAction;
    originalText: string;
    resultText: string;
  }>;
}

export interface ChewedSubstrate {
  outputs: ReconstructedOutput[];
  reconstructedTables?: string[];
  summary: {
    totalModels: number;
    survivingClaimCount: number;
    prunedClaimCount: number;
    protectedStatementCount: number;
    untriagedStatementCount?: number;
    skeletonizedStatementCount: number;
    removedStatementCount: number;
    /** Actual mixed-parent resolution results from triage (post-prune) */
    mixedInstrumentation?: MixedInstrumentation;
    tableCellUnits?: {
      protectedCount: number;
      removedCount: number;
      unallocatedCount: number;
    };
  };
  pathSteps: string[];
  meta: {
    triageTimeMs: number;
    reconstructionTimeMs: number;
    totalTimeMs: number;
  };
}

export interface NormalizedTraversalState {
  claimStatuses: Map<string, 'active' | 'pruned'>;
  pathSteps: string[];
}

export interface SkeletonizationInput {
  statements: ShadowStatement[];
  paragraphs: ShadowParagraph[];
  claims: EnrichedClaim[];
  traversalState: NormalizedTraversalState;
  sourceData: Array<{
    providerId: string;
    modelIndex: number;
    text: string;
  }>;
  statementEmbeddings?: Map<string, Float32Array>;
  paragraphEmbeddings?: Map<string, Float32Array>;
  blastSurface?: any | null;
  tableSidecar?: any[];
  tableCellAllocation?: {
    cellUnits?: Array<{ id: string; tableIndex: number; rowIndex: number; colIndex: number; modelIndex: number; text: string; rowHeader: string; columnHeader: string; value: string }>;
    tableCellAllocations?: Map<string, string[]> | Record<string, string[]>;
    cellUnitClaims?: Map<string, string[]> | Record<string, string[]>;
    unallocatedCellUnitIds?: string[];
  } | null;
}

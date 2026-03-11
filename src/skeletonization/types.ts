import type { ShadowStatement, ShadowParagraph } from '../shadow';
import type { EnrichedClaim } from '../../shared/contract';

export type StatementAction = 'PROTECTED' | 'UNTRIAGED' | 'SKELETONIZE' | 'REMOVE';

export interface StatementFate {
  statementId: string;
  action: StatementAction;
  reason: string;
  triggerClaimId?: string;
}

export interface TriageResult {
  protectedStatementIds: Set<string>;
  statementFates: Map<string, StatementFate>;
  meta: {
    totalStatements: number;
    protectedCount: number;
    untriagedCount?: number;
    skeletonizedCount: number;
    removedCount: number;
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
  summary: {
    totalModels: number;
    survivingClaimCount: number;
    prunedClaimCount: number;
    protectedStatementCount: number;
    untriagedStatementCount?: number;
    skeletonizedStatementCount: number;
    removedStatementCount: number;
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
}

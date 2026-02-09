import type { ShadowStatement, ShadowParagraph } from '../shadow';
import type { EnrichedClaim } from '../../shared/contract';

export type StatementAction = 'PROTECTED' | 'SKELETONIZE' | 'REMOVE';

export interface StatementFate {
  statementId: string;
  action: StatementAction;
  reason: string;
  triggerClaimId?: string;
  carriersSkeletonized?: string[];
  isSoleCarrier?: boolean;
}

export interface ConfirmedCarrier {
  statementId: string;
  claimSimilarity: number;
  sourceSimilarity: number;
  prunedClaimId: string;
  sourceStatementId: string;
}

export interface CarrierDetectionResult {
  prunedClaimId: string;
  sourceStatementId: string;
  carriers: ConfirmedCarrier[];
  action: 'REMOVE' | 'SKELETONIZE';
}

export interface TriageResult {
  protectedStatementIds: Set<string>;
  statementFates: Map<string, StatementFate>;
  meta: {
    totalStatements: number;
    protectedCount: number;
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
    skeletonizedStatementCount: number;
    removedStatementCount: number;
  };
  pathSteps: string[];
  meta: {
    triageTimeMs: number;
    reconstructionTimeMs: number;
    embeddingTimeMs: number;
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
}

export interface CarrierThresholds {
  claimSimilarity: number;
  sourceSimilarity: number;
}

export const DEFAULT_THRESHOLDS: CarrierThresholds = {
  claimSimilarity: 0.6,
  sourceSimilarity: 0.6,
};

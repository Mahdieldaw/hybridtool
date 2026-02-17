import type { EnrichedClaim } from '../../shared/contract';
import type { ShadowStatement } from '../shadow';
import { cosineSimilarity } from '../clustering/distance';
import type {
  CarrierDetectionResult,
  CarrierThresholds,
  ConfirmedCarrier,
} from './types';
import { DEFAULT_THRESHOLDS } from './types';

export interface CarrierDetectionInput {
  prunedClaim: EnrichedClaim;
  sourceStatementId: string;
  allStatements: ShadowStatement[];
  protectedStatementIds: Set<string>;
  statementEmbeddings: Map<string, Float32Array>;
  claimEmbeddings: Map<string, Float32Array>;
  thresholds?: CarrierThresholds;
}

function isOpposingStance(a: unknown, b: unknown): boolean {
  const sa = String(a || '');
  const sb = String(b || '');
  return (
    (sa === 'prescriptive' && sb === 'cautionary') ||
    (sa === 'cautionary' && sb === 'prescriptive') ||
    (sa === 'assertive' && sb === 'uncertain') ||
    (sa === 'uncertain' && sb === 'assertive')
  );
}

export function detectCarriers(input: CarrierDetectionInput): CarrierDetectionResult {
  const {
    prunedClaim,
    sourceStatementId,
    allStatements,
    protectedStatementIds,
    statementEmbeddings,
    claimEmbeddings,
    thresholds: providedThresholds,
  } = input;

  const thresholds = { ...DEFAULT_THRESHOLDS, ...(providedThresholds || {}) };
  const claimEmbedding = claimEmbeddings.get(prunedClaim.id);
  const sourceEmbedding = statementEmbeddings.get(sourceStatementId);

  if (!claimEmbedding || !sourceEmbedding) {
    return {
      prunedClaimId: prunedClaim.id,
      sourceStatementId,
      carriers: [],
      action: 'SKELETONIZE',
    };
  }

  const carriers: ConfirmedCarrier[] = [];
  const sourceStatement = allStatements.find(s => s.id === sourceStatementId);

  for (const statement of allStatements) {
    if (statement.id === sourceStatementId) continue;
    if (protectedStatementIds.has(statement.id)) continue;

    const candidateEmbedding = statementEmbeddings.get(statement.id);
    if (!candidateEmbedding) continue;

    const claimSimilarity = cosineSimilarity(candidateEmbedding, claimEmbedding);
    if (claimSimilarity < thresholds.claimSimilarity) continue;

    const sourceSimilarity = cosineSimilarity(candidateEmbedding, sourceEmbedding);
    const opposingStance = sourceStatement ? isOpposingStance(sourceStatement.stance, statement.stance) : false;
    const requiredSourceSim = opposingStance ? thresholds.sourceSimilarity + 0.08 : thresholds.sourceSimilarity;
    if (sourceSimilarity < requiredSourceSim) continue;

    carriers.push({
      statementId: statement.id,
      claimSimilarity,
      sourceSimilarity,
      prunedClaimId: prunedClaim.id,
      sourceStatementId,
    });
  }

  carriers.sort((a, b) => (b.claimSimilarity + b.sourceSimilarity) - (a.claimSimilarity + a.sourceSimilarity));

  return {
    prunedClaimId: prunedClaim.id,
    sourceStatementId,
    carriers,
    action: carriers.length > 0 ? 'REMOVE' : 'SKELETONIZE',
  };
}

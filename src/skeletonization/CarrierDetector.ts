import type { EnrichedClaim } from '../../shared/contract';
import type { ShadowStatement } from '../shadow';
import { cosineSimilarity } from '../clustering/distance';
import type {
  CarrierDetectionResult,
  CarrierThresholds,
  ConfirmedCarrier,
} from './types';

export interface CarrierDetectionInput {
  prunedClaim: EnrichedClaim;
  sourceStatementId: string;
  allStatements: ShadowStatement[];
  protectedStatementIds: Set<string>;
  statementEmbeddings: Map<string, Float32Array>;
  claimEmbeddings: Map<string, Float32Array>;
  thresholds?: CarrierThresholds;
  candidateStatementIds?: Set<string>;
}

/**
 * Compute μ+σ from a distribution of similarity values.
 */
function muPlusSigma(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return mean + Math.sqrt(variance);
}

/**
 * Compute P75 (75th percentile) from a sorted ascending array.
 */
function percentile75(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil(sorted.length * 0.75) - 1;
  return sorted[idx];
}

/**
 * Carrier detection — Step 9 calibration.
 *
 * Replaces elbow-based detection with dual gate:
 *   Gate A: sourceSimilarity > max(μ_source + σ_source, P75_global_source)
 *   Gate B: claimSimilarity > max(μ_claim + σ_claim, P75_global_claim)
 *
 * Both gates must pass for a statement to be confirmed as a carrier.
 * The P75 floor prevents isolated statements from getting falsely "carried"
 * by distant neighbors. Per-statement μ+σ adapts to local density.
 */
export function detectCarriers(input: CarrierDetectionInput): CarrierDetectionResult {
  const {
    prunedClaim,
    sourceStatementId,
    allStatements,
    protectedStatementIds,
    statementEmbeddings,
    claimEmbeddings,
    candidateStatementIds,
  } = input;

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

  // Compute all similarities for eligible statements
  const eligibleScores: Array<{
    statementId: string;
    sourceSimilarity: number;
    claimSimilarity: number;
  }> = [];

  for (const statement of allStatements) {
    if (statement.id === sourceStatementId) continue;
    if (protectedStatementIds.has(statement.id)) continue;
    if (candidateStatementIds && !candidateStatementIds.has(statement.id)) continue;

    const candidateEmbedding = statementEmbeddings.get(statement.id);
    if (!candidateEmbedding) continue;

    const sourceSimilarity = cosineSimilarity(candidateEmbedding, sourceEmbedding);
    const claimSimilarity = cosineSimilarity(candidateEmbedding, claimEmbedding);
    eligibleScores.push({ statementId: statement.id, sourceSimilarity, claimSimilarity });
  }

  if (eligibleScores.length === 0) {
    return {
      prunedClaimId: prunedClaim.id,
      sourceStatementId,
      carriers: [],
      action: 'SKELETONIZE',
    };
  }

  // Compute adaptive thresholds: max(μ+σ, P75_global) for each gate
  const sourceSims = eligibleScores.map(s => s.sourceSimilarity);
  const claimSims = eligibleScores.map(s => s.claimSimilarity);

  const sourceMusigma = muPlusSigma(sourceSims);
  const claimMusigma = muPlusSigma(claimSims);

  const sortedSourceSims = [...sourceSims].sort((a, b) => a - b);
  const sortedClaimSims = [...claimSims].sort((a, b) => a - b);

  const sourceP75 = percentile75(sortedSourceSims);
  const claimP75 = percentile75(sortedClaimSims);

  const sourceThreshold = Math.max(sourceMusigma, sourceP75);
  const claimThreshold = Math.max(claimMusigma, claimP75);

  // Both gates must pass
  const inclusive = eligibleScores.length === 1;
  const carriers: ConfirmedCarrier[] = eligibleScores
    .filter(s =>
      (inclusive ? s.sourceSimilarity >= sourceThreshold : s.sourceSimilarity > sourceThreshold)
      && (inclusive ? s.claimSimilarity >= claimThreshold : s.claimSimilarity > claimThreshold)
    )
    .map(s => ({
      statementId: s.statementId,
      claimSimilarity: s.claimSimilarity,
      sourceSimilarity: s.sourceSimilarity,
      prunedClaimId: prunedClaim.id,
      sourceStatementId,
    }));

  // Sort by combined similarity descending
  carriers.sort((a, b) => (b.claimSimilarity + b.sourceSimilarity) - (a.claimSimilarity + a.sourceSimilarity));

  return {
    prunedClaimId: prunedClaim.id,
    sourceStatementId,
    carriers,
    action: carriers.length > 0 ? 'REMOVE' : 'SKELETONIZE',
  };
}

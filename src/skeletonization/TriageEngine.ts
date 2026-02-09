import type { EnrichedClaim } from '../../shared/contract';
import { generateTextEmbeddings } from '../clustering/embeddings';
import { detectCarriers } from './CarrierDetector';
import { DEFAULT_THRESHOLDS } from './types';
import type { CarrierThresholds, SkeletonizationInput, StatementFate, TriageResult } from './types';

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
}

export async function triageStatements(
  input: SkeletonizationInput,
  thresholds: CarrierThresholds = DEFAULT_THRESHOLDS
): Promise<TriageResult> {
  const start = nowMs();
  const { statements, claims, traversalState } = input;

  const survivingClaims: EnrichedClaim[] = [];
  const prunedClaims: EnrichedClaim[] = [];

  for (const claim of claims) {
    const status = traversalState.claimStatuses.get(claim.id);
    if (status === 'pruned') prunedClaims.push(claim);
    else survivingClaims.push(claim);
  }

  const protectedStatementIds = new Set<string>();
  for (const claim of survivingClaims) {
    if (!Array.isArray(claim.sourceStatementIds)) continue;
    for (const sid of claim.sourceStatementIds) {
      if (typeof sid === 'string' && sid.trim().length > 0) protectedStatementIds.add(sid);
    }
  }

  const statementTexts = statements.map(s => s.text);
  const rawStatementEmbeddings = await generateTextEmbeddings(statementTexts);
  const statementEmbeddings = new Map<string, Float32Array>();
  for (let i = 0; i < statements.length; i++) {
    const emb = rawStatementEmbeddings.get(String(i));
    if (emb) statementEmbeddings.set(statements[i].id, emb);
  }

  const prunedClaimTexts = prunedClaims.map(c => `${c.label}. ${c.text || ''}`);
  const rawClaimEmbeddings = await generateTextEmbeddings(prunedClaimTexts);
  const claimEmbeddings = new Map<string, Float32Array>();
  for (let i = 0; i < prunedClaims.length; i++) {
    const emb = rawClaimEmbeddings.get(String(i));
    if (emb) claimEmbeddings.set(prunedClaims[i].id, emb);
  }

  const statementFates = new Map<string, StatementFate>();

  for (const sid of protectedStatementIds) {
    statementFates.set(sid, {
      statementId: sid,
      action: 'PROTECTED',
      reason: 'Linked to surviving claim',
    });
  }

  for (const prunedClaim of prunedClaims) {
    const sourceStatementIds = Array.isArray(prunedClaim.sourceStatementIds) ? prunedClaim.sourceStatementIds : [];

    for (const sourceStatementId of sourceStatementIds) {
      if (protectedStatementIds.has(sourceStatementId)) continue;
      if (statementFates.has(sourceStatementId)) continue;

      const carrierResult = detectCarriers({
        prunedClaim,
        sourceStatementId,
        allStatements: statements,
        protectedStatementIds,
        statementEmbeddings,
        claimEmbeddings,
        thresholds,
      });

      if (carrierResult.carriers.length > 0) {
        statementFates.set(sourceStatementId, {
          statementId: sourceStatementId,
          action: 'REMOVE',
          reason: `Source of pruned ${prunedClaim.id}, ${carrierResult.carriers.length} carrier(s) found`,
          triggerClaimId: prunedClaim.id,
          carriersSkeletonized: carrierResult.carriers.map(c => c.statementId),
        });

        for (const carrier of carrierResult.carriers) {
          if (!statementFates.has(carrier.statementId)) {
            statementFates.set(carrier.statementId, {
              statementId: carrier.statementId,
              action: 'SKELETONIZE',
              reason: `Carrier of pruned ${prunedClaim.id}`,
              triggerClaimId: prunedClaim.id,
              isSoleCarrier: false,
            });
          }
        }
      } else {
        statementFates.set(sourceStatementId, {
          statementId: sourceStatementId,
          action: 'SKELETONIZE',
          reason: `Sole carrier of pruned ${prunedClaim.id}`,
          triggerClaimId: prunedClaim.id,
          isSoleCarrier: true,
        });
      }
    }
  }

  for (const statement of statements) {
    if (!statementFates.has(statement.id)) {
      statementFates.set(statement.id, {
        statementId: statement.id,
        action: 'PROTECTED',
        reason: 'Not linked to any claim (passthrough)',
      });
    }
  }

  let protectedCount = 0;
  let skeletonizedCount = 0;
  let removedCount = 0;

  for (const fate of statementFates.values()) {
    if (fate.action === 'PROTECTED') protectedCount++;
    else if (fate.action === 'SKELETONIZE') skeletonizedCount++;
    else removedCount++;
  }

  return {
    protectedStatementIds,
    statementFates,
    meta: {
      totalStatements: statements.length,
      protectedCount,
      skeletonizedCount,
      removedCount,
      processingTimeMs: nowMs() - start,
    },
  };
}

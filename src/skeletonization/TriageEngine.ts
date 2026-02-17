import type { EnrichedClaim } from '../../shared/contract';
import { generateTextEmbeddings } from '../clustering/embeddings';
import { cosineSimilarity } from '../clustering/distance';
import { detectCarriers } from './CarrierDetector';
import { DEFAULT_THRESHOLDS } from './types';
import type { CarrierThresholds, SkeletonizationInput, StatementFate, TriageResult } from './types';

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
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

function meanEmbedding(vectors: Float32Array[]): Float32Array | null {
  if (vectors.length === 0) return null;
  const dim = vectors[0].length;
  const out = new Float32Array(dim);
  let used = 0;
  for (const v of vectors) {
    if (!v || v.length !== dim) continue;
    for (let i = 0; i < dim; i++) out[i] += v[i];
    used++;
  }
  if (used === 0) return null;
  for (let i = 0; i < dim; i++) out[i] /= used;
  return out;
}

function normalizeEmbedding(vec: Float32Array): Float32Array {
  let norm = 0;
  for (let i = 0; i < vec.length; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < vec.length; i++) vec[i] /= norm;
  }
  return vec;
}

function dominantClaimStance(claim: EnrichedClaim, statementsById: Map<string, { stance?: unknown; confidence?: unknown }>): string | null {
  const sourceIds = Array.isArray(claim.sourceStatementIds) ? claim.sourceStatementIds : [];
  const weights = new Map<string, number>();

  for (const sid of sourceIds) {
    const st = statementsById.get(String(sid));
    if (!st) continue;
    const stance = String(st.stance || '').trim();
    if (!stance || stance === 'unclassified') continue;
    const confRaw = st.confidence;
    const w = typeof confRaw === 'number' && Number.isFinite(confRaw) ? Math.max(0.1, confRaw) : 0.5;
    weights.set(stance, (weights.get(stance) || 0) + w);
  }

  let best: { stance: string; weight: number } | null = null;
  let second: { stance: string; weight: number } | null = null;

  for (const [stance, weight] of weights.entries()) {
    if (!best || weight > best.weight) {
      second = best;
      best = { stance, weight };
    } else if (!second || weight > second.weight) {
      second = { stance, weight };
    }
  }

  if (!best) return null;
  if (second && Math.abs(best.weight - second.weight) < 1e-6) return null;
  return best.stance;
}

export async function triageStatements(
  input: SkeletonizationInput,
  thresholds: CarrierThresholds = DEFAULT_THRESHOLDS
): Promise<TriageResult> {
  const start = nowMs();
  const { statements, claims, traversalState } = input;
  const validStatementIds = new Set(statements.map(s => s.id));

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
      if (typeof sid === 'string' && sid.trim().length > 0 && validStatementIds.has(sid)) {
        protectedStatementIds.add(sid);
      }
    }
  }

  const statementTexts = statements.map(s => s.text);
  const rawStatementEmbeddings = await generateTextEmbeddings(statementTexts);
  const statementEmbeddings = new Map<string, Float32Array>();
  for (let i = 0; i < statements.length; i++) {
    const emb = rawStatementEmbeddings.get(String(i));
    if (emb) statementEmbeddings.set(statements[i].id, emb);
  }

  const claimEmbeddings = new Map<string, Float32Array>();
  for (const claim of prunedClaims) {
    const sourceIds = Array.isArray(claim.sourceStatementIds) ? claim.sourceStatementIds : [];
    const vecs: Float32Array[] = [];
    for (const sid of sourceIds) {
      const v = statementEmbeddings.get(String(sid));
      if (v) vecs.push(v);
    }
    const pooled = meanEmbedding(vecs);
    if (pooled) claimEmbeddings.set(claim.id, normalizeEmbedding(pooled));
  }

  const statementFates = new Map<string, StatementFate>();

  for (const sid of protectedStatementIds) {
    statementFates.set(sid, {
      statementId: sid,
      action: 'PROTECTED',
      reason: 'Linked to surviving claim',
    });
  }

  const statementsById = new Map(statements.map(s => [s.id, s]));
  const dominantStancesByClaimId = new Map<string, string | null>();
  for (const claim of prunedClaims) {
    dominantStancesByClaimId.set(claim.id, dominantClaimStance(claim, statementsById));
  }

  const relevanceMin = 0.55;
  const removeRelevanceMin = 0.7;

  for (const prunedClaim of prunedClaims) {
    const sourceStatementIds = Array.isArray(prunedClaim.sourceStatementIds) ? prunedClaim.sourceStatementIds : [];
    const claimCentroid = claimEmbeddings.get(prunedClaim.id);
    const claimDominantStance = dominantStancesByClaimId.get(prunedClaim.id) ?? null;

    for (const sourceStatementId of sourceStatementIds) {
      if (!validStatementIds.has(sourceStatementId)) continue;
      if (protectedStatementIds.has(sourceStatementId)) continue;
      if (statementFates.has(sourceStatementId)) continue;

      const sourceStatement = statementsById.get(sourceStatementId);
      const sourceEmbedding = statementEmbeddings.get(sourceStatementId);

      if (!claimCentroid || !sourceEmbedding || !sourceStatement) {
        statementFates.set(sourceStatementId, {
          statementId: sourceStatementId,
          action: 'UNTRIAGED',
          reason: `Missing claim centroid or statement embedding for pruned ${prunedClaim.id}`,
          triggerClaimId: prunedClaim.id,
        });
        continue;
      }

      const relevance = cosineSimilarity(sourceEmbedding, claimCentroid);
      const stance = String(sourceStatement.stance || 'unclassified');

      if (claimDominantStance && isOpposingStance(stance, claimDominantStance)) {
        statementFates.set(sourceStatementId, {
          statementId: sourceStatementId,
          action: 'PROTECTED',
          reason: `Counterevidence vs pruned ${prunedClaim.id} (relevance: ${relevance.toFixed(2)})`,
          triggerClaimId: prunedClaim.id,
        });
        continue;
      }

      if (relevance < relevanceMin) {
        statementFates.set(sourceStatementId, {
          statementId: sourceStatementId,
          action: 'UNTRIAGED',
          reason: `Low claim relevance for pruned ${prunedClaim.id} (relevance: ${relevance.toFixed(2)})`,
          triggerClaimId: prunedClaim.id,
        });
        continue;
      }

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
        const carriersSkeletonized: string[] = [];

        for (const carrier of carrierResult.carriers) {
          if (!statementFates.has(carrier.statementId)) {
            const carrierStatement = statementsById.get(carrier.statementId);
            const carrierEmbedding = statementEmbeddings.get(carrier.statementId);
            const carrierRelevance = carrierEmbedding ? cosineSimilarity(carrierEmbedding, claimCentroid) : 0;
            const carrierStance = String(carrierStatement?.stance || 'unclassified');

            if (claimDominantStance && isOpposingStance(carrierStance, claimDominantStance)) {
              statementFates.set(carrier.statementId, {
                statementId: carrier.statementId,
                action: 'PROTECTED',
                reason: `Counterevidence carrier vs pruned ${prunedClaim.id} (relevance: ${carrierRelevance.toFixed(2)})`,
                triggerClaimId: prunedClaim.id,
                isSoleCarrier: false,
              });
              continue;
            }

            if (carrierRelevance < relevanceMin) {
              statementFates.set(carrier.statementId, {
                statementId: carrier.statementId,
                action: 'UNTRIAGED',
                reason: `Low claim relevance carrier vs pruned ${prunedClaim.id} (relevance: ${carrierRelevance.toFixed(2)})`,
                triggerClaimId: prunedClaim.id,
                isSoleCarrier: false,
              });
              continue;
            }

            statementFates.set(carrier.statementId, {
              statementId: carrier.statementId,
              action: 'SKELETONIZE',
              reason: `Carrier of pruned ${prunedClaim.id} (relevance: ${carrierRelevance.toFixed(2)})`,
              triggerClaimId: prunedClaim.id,
              isSoleCarrier: false,
            });
            carriersSkeletonized.push(carrier.statementId);
          }
        }

        const canRemove =
          carriersSkeletonized.length > 0 &&
          !!claimDominantStance &&
          stance === claimDominantStance &&
          relevance >= removeRelevanceMin;

        statementFates.set(sourceStatementId, {
          statementId: sourceStatementId,
          action: canRemove ? 'REMOVE' : 'SKELETONIZE',
          reason: `Pruned ${prunedClaim.id} (relevance: ${relevance.toFixed(2)}), ${carrierResult.carriers.length} carrier(s) found`,
          triggerClaimId: prunedClaim.id,
          carriersSkeletonized: carriersSkeletonized.length > 0 ? carriersSkeletonized : undefined,
          isSoleCarrier: carriersSkeletonized.length === 0,
        });
      } else {
        statementFates.set(sourceStatementId, {
          statementId: sourceStatementId,
          action: 'SKELETONIZE',
          reason: `Sole carrier of pruned ${prunedClaim.id} (relevance: ${relevance.toFixed(2)})`,
          triggerClaimId: prunedClaim.id,
          isSoleCarrier: true,
        });
      }
    }
  }

  // ── CROSS-MODEL PARAPHRASE DETECTION ────────────────────────────────────
  // For each pruning target (REMOVE or SKELETONIZE), find semantic paraphrases
  // in other models' statements. If a paraphrase is found and unprotected,
  // add it to the pruning set as well.
  const pruningTargets = new Set<string>();
  for (const [sid, fate] of statementFates.entries()) {
    if (fate.action === 'REMOVE' || fate.action === 'SKELETONIZE') {
      pruningTargets.add(sid);
    }
  }

  const paraphraseThreshold = 0.85;
  const paraphrasesFound: Array<{ original: string; paraphrase: string; similarity: number }> = [];

  for (const targetSid of pruningTargets) {
    const targetEmb = statementEmbeddings.get(targetSid);
    if (!targetEmb) continue;

    const targetStmt = statementsById.get(targetSid);
    if (!targetStmt) continue;

    for (const stmt of statements) {
      if (stmt.id === targetSid) continue;
      if (protectedStatementIds.has(stmt.id)) continue;
      if (statementFates.has(stmt.id)) continue; // Already processed

      const emb = statementEmbeddings.get(stmt.id);
      if (!emb) continue;

      const similarity = cosineSimilarity(targetEmb, emb);
      const required = isOpposingStance(targetStmt.stance, stmt.stance) ? paraphraseThreshold + 0.08 : paraphraseThreshold;
      if (similarity >= required) {
        const triggerClaimId = statementFates.get(targetSid)?.triggerClaimId;
        const claimCentroid = triggerClaimId ? claimEmbeddings.get(triggerClaimId) : null;
        const claimDominantStance = triggerClaimId ? (dominantStancesByClaimId.get(triggerClaimId) ?? null) : null;

        const relevance = claimCentroid ? cosineSimilarity(emb, claimCentroid) : 0;
        const stance = String(stmt.stance || 'unclassified');

        if (triggerClaimId && claimDominantStance && isOpposingStance(stance, claimDominantStance)) {
          statementFates.set(stmt.id, {
            statementId: stmt.id,
            action: 'PROTECTED',
            reason: `Counterevidence paraphrase vs pruned ${triggerClaimId} (sim: ${similarity.toFixed(2)}, rel: ${relevance.toFixed(2)})`,
            triggerClaimId,
            isSoleCarrier: false,
          });
        } else if (triggerClaimId && (!claimCentroid || relevance < relevanceMin)) {
          statementFates.set(stmt.id, {
            statementId: stmt.id,
            action: 'UNTRIAGED',
            reason: `Low claim relevance paraphrase vs pruned ${triggerClaimId} (sim: ${similarity.toFixed(2)}, rel: ${relevance.toFixed(2)})`,
            triggerClaimId,
            isSoleCarrier: false,
          });
        } else {
          statementFates.set(stmt.id, {
            statementId: stmt.id,
            action: 'SKELETONIZE',
            reason: `Paraphrase of pruned statement ${targetSid} (sim: ${similarity.toFixed(2)}, rel: ${relevance.toFixed(2)})`,
            triggerClaimId,
            isSoleCarrier: false,
          });
        }
        paraphrasesFound.push({ original: targetSid, paraphrase: stmt.id, similarity });
      }
    }
  }

  if (paraphrasesFound.length > 0) {
    console.log(`[TriageEngine] Found ${paraphrasesFound.length} cross-model paraphrases for pruning`);
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
  let untriagedCount = 0;
  let skeletonizedCount = 0;
  let removedCount = 0;

  for (const fate of statementFates.values()) {
    if (fate.action === 'PROTECTED') protectedCount++;
    else if (fate.action === 'UNTRIAGED') {
      protectedCount++;
      untriagedCount++;
    }
    else if (fate.action === 'SKELETONIZE') skeletonizedCount++;
    else removedCount++;
  }

  return {
    protectedStatementIds,
    statementFates,
    meta: {
      totalStatements: statements.length,
      protectedCount,
      untriagedCount,
      skeletonizedCount,
      removedCount,
      processingTimeMs: nowMs() - start,
    },
  };
}

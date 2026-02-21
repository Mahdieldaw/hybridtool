import type { EnrichedClaim } from '../../shared/contract';
import { generateTextEmbeddings } from '../clustering/embeddings';
import { cosineSimilarity } from '../clustering/distance';
import { detectCarriers } from './CarrierDetector';
import { DEFAULT_THRESHOLDS } from './types';
import type { CarrierThresholds, SkeletonizationInput, StatementFate, TriageResult } from './types';

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
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

  // Phase 1: protect everything sourced by surviving claims
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
  const embeddingStart = nowMs();
  const rawStatementEmbeddings = await generateTextEmbeddings(statementTexts);
  const embeddingTimeMs = nowMs() - embeddingStart;
  const statementEmbeddings = new Map<string, Float32Array>();
  for (let i = 0; i < statements.length; i++) {
    const emb = rawStatementEmbeddings.get(String(i));
    if (emb) statementEmbeddings.set(statements[i].id, emb);
  }

  // Build centroid per pruned claim from its source statement embeddings
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

  const relevanceMin = 0.55;

  // Phase 2 + 3: relevance gate then carrier detection
  for (const prunedClaim of prunedClaims) {
    const sourceStatementIds = Array.isArray(prunedClaim.sourceStatementIds) ? prunedClaim.sourceStatementIds : [];
    const claimCentroid = claimEmbeddings.get(prunedClaim.id);

    for (const sourceStatementId of sourceStatementIds) {
      if (!validStatementIds.has(sourceStatementId)) continue;
      if (protectedStatementIds.has(sourceStatementId)) continue;
      if (statementFates.has(sourceStatementId)) continue;

      const sourceEmbedding = statementEmbeddings.get(sourceStatementId);

      if (!claimCentroid || !sourceEmbedding) {
        statementFates.set(sourceStatementId, {
          statementId: sourceStatementId,
          action: 'PROTECTED',
          reason: `Cannot confirm carrier of pruned ${prunedClaim.id} — missing embedding`,
          triggerClaimId: prunedClaim.id,
        });
        continue;
      }

      const relevance = cosineSimilarity(sourceEmbedding, claimCentroid);

      if (relevance < relevanceMin) {
        statementFates.set(sourceStatementId, {
          statementId: sourceStatementId,
          action: 'PROTECTED',
          reason: `Not a confirmed carrier of pruned ${prunedClaim.id} — low relevance (${relevance.toFixed(2)})`,
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
            const carrierEmbedding = statementEmbeddings.get(carrier.statementId);
            const carrierRelevance = carrierEmbedding ? cosineSimilarity(carrierEmbedding, claimCentroid) : 0;

            if (carrierRelevance < relevanceMin) {
              statementFates.set(carrier.statementId, {
                statementId: carrier.statementId,
                action: 'PROTECTED',
                reason: `Not a confirmed carrier of pruned ${prunedClaim.id} — low relevance (${carrierRelevance.toFixed(2)})`,
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

        // REMOVE only when content is demonstrably redundant: 2+ independent carriers exist.
        // The relevance gate (step 2) already confirms this statement is about the pruned claim.
        // Carrier count is the only additional signal needed.
        const totalCarriers = carrierResult.carriers.length;
        const canRemove = totalCarriers >= 2;

        statementFates.set(sourceStatementId, {
          statementId: sourceStatementId,
          action: canRemove ? 'REMOVE' : 'SKELETONIZE',
          reason: `Pruned ${prunedClaim.id} (relevance: ${relevance.toFixed(2)}), ${carrierResult.carriers.length} carrier(s) found`,
          triggerClaimId: prunedClaim.id,
          carriersSkeletonized: carriersSkeletonized.length > 0 ? carriersSkeletonized : undefined,
          isSoleCarrier: totalCarriers === 0,
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
  // For each pruning target, find semantic paraphrases in other statements.
  // Flat threshold — no stance penalty.
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

    for (const stmt of statements) {
      if (stmt.id === targetSid) continue;
      if (protectedStatementIds.has(stmt.id)) continue;
      if (statementFates.has(stmt.id)) continue;

      const emb = statementEmbeddings.get(stmt.id);
      if (!emb) continue;

      const similarity = cosineSimilarity(targetEmb, emb);
      if (similarity >= paraphraseThreshold) {
        const triggerClaimId = statementFates.get(targetSid)?.triggerClaimId;
        const claimCentroid = triggerClaimId ? claimEmbeddings.get(triggerClaimId) : null;
        const relevance = claimCentroid ? cosineSimilarity(emb, claimCentroid) : 0;

        if (triggerClaimId && (!claimCentroid || relevance < relevanceMin)) {
          statementFates.set(stmt.id, {
            statementId: stmt.id,
            action: 'PROTECTED',
            reason: `Not a confirmed carrier paraphrase for pruned ${triggerClaimId} — low relevance (sim: ${similarity.toFixed(2)}, rel: ${relevance.toFixed(2)})`,
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
        action: 'UNTRIAGED',
        reason: 'Not linked to any claim',
      });
    }
  }

  let protectedCount = 0;
  let untriagedCount = 0;
  let skeletonizedCount = 0;
  let removedCount = 0;

  for (const fate of statementFates.values()) {
    if (fate.action === 'PROTECTED') protectedCount++;
    else if (fate.action === 'UNTRIAGED') untriagedCount++;
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
      embeddingTimeMs,
    },
  };
}

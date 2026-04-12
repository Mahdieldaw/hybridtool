/**
 * conflictValidation.ts — All-pairs conflict validation using geometry.
 *
 * Pure geometry layer: takes enriched claims, semantic edges, and statement
 * embeddings, returns validated conflict records. No blast surface or
 * fragility dependency — those are downstream consumers.
 */

import type { Edge, EnrichedClaim, ValidatedConflict } from '../../../shared/types';
import { cosineSimilarity } from '../../clustering/distance';

// ─── Helpers ─────────────────────────────────────────────────────────────

/** Builds canonical and exclusive statement ID sets for all claims. */
function buildClaimStatementSets(claims: EnrichedClaim[]): {
  canonicalSets: Map<string, Set<string>>;
  exclusiveIds: Map<string, string[]>;
} {
  const canonicalSets = new Map<string, Set<string>>();
  const ownerCount = new Map<string, number>();
  for (const c of claims) {
    const set = new Set<string>(Array.isArray(c.sourceStatementIds) ? c.sourceStatementIds : []);
    canonicalSets.set(String(c.id), set);
    for (const sid of set) ownerCount.set(sid, (ownerCount.get(sid) ?? 0) + 1);
  }
  const exclusiveIds = new Map<string, string[]>();
  for (const [claimId, set] of canonicalSets.entries()) {
    exclusiveIds.set(
      claimId,
      Array.from(set).filter((sid) => (ownerCount.get(sid) ?? 0) <= 1)
    );
  }
  return { canonicalSets, exclusiveIds };
}

/**
 * Cross-pool proximity on statement embeddings.
 * For each exclusive statement in A, find max cosine similarity to any statement in B's
 * full canonical set. Average → meanAtoB. Mirror for B→A. Return min(meanAtoB, meanBtoA).
 */
function computeCrossPoolProximityStatements(
  exclusiveStmtsA: string[],
  canonicalB: Set<string>,
  exclusiveStmtsB: string[],
  canonicalA: Set<string>,
  embeddings: Map<string, Float32Array>
): number | null {
  const embsExclA = exclusiveStmtsA
    .map((s) => embeddings.get(s))
    .filter((e): e is Float32Array => !!e);
  const embsExclB = exclusiveStmtsB
    .map((s) => embeddings.get(s))
    .filter((e): e is Float32Array => !!e);
  const allEmbsA = Array.from(canonicalA)
    .map((s) => embeddings.get(s))
    .filter((e): e is Float32Array => !!e);
  const allEmbsB = Array.from(canonicalB)
    .map((s) => embeddings.get(s))
    .filter((e): e is Float32Array => !!e);

  if (
    embsExclA.length === 0 ||
    embsExclB.length === 0 ||
    allEmbsA.length === 0 ||
    allEmbsB.length === 0
  )
    return null;

  // A→B: for each exclusive-A statement, max sim to any statement in B's full pool
  let sumAtoB = 0;
  for (const ea of embsExclA) {
    let maxSim = -Infinity;
    for (const eb of allEmbsB) {
      const s = cosineSimilarity(ea, eb);
      if (s > maxSim) maxSim = s;
    }
    sumAtoB += maxSim;
  }
  const meanAtoB = sumAtoB / embsExclA.length;

  // B→A: for each exclusive-B statement, max sim to any statement in A's full pool
  let sumBtoA = 0;
  for (const eb of embsExclB) {
    let maxSim = -Infinity;
    for (const ea of allEmbsA) {
      const s = cosineSimilarity(eb, ea);
      if (s > maxSim) maxSim = s;
    }
    sumBtoA += maxSim;
  }
  const meanBtoA = sumBtoA / embsExclB.length;

  return Math.min(meanAtoB, meanBtoA);
}

/**
 * Triangle residual on claim centroids.
 * residual = (sim(A,Q) * sim(B,Q)) - sim(A,B)
 * Positive residual → claims diverge more than shared query relevance predicts.
 */
function computeTriangleResidual(
  claimIdA: string,
  claimIdB: string,
  claimEmbeddings: Map<string, Float32Array>,
  queryEmbedding: Float32Array
): { residual: number; simAQ: number; simBQ: number } | null {
  const embA = claimEmbeddings.get(claimIdA);
  const embB = claimEmbeddings.get(claimIdB);
  if (!embA || !embB) return null;

  const simAQ = cosineSimilarity(embA, queryEmbedding);
  const simBQ = cosineSimilarity(embB, queryEmbedding);
  const simAB = cosineSimilarity(embA, embB);

  return { residual: simAQ * simBQ - simAB, simAQ, simBQ };
}

// ─── Public API ──────────────────────────────────────────────────────────

export interface ConflictValidationInput {
  enrichedClaims: EnrichedClaim[];
  edges: Edge[];
  statementEmbeddings?: Map<string, Float32Array> | null;
  /** Claim centroid embeddings (claim ID → Float32Array). For triangle residual metric. */
  claimEmbeddings?: Map<string, Float32Array> | null;
  /** Query embedding. For triangle residual metric. */
  queryEmbedding?: Float32Array | null;
}

/**
 * All-pairs conflict validation — two-pass so the threshold is the mean of
 * the actual cross-pool proximity values being tested, not the top-K similarity mean.
 *
 * Returns the full set of ValidatedConflict records (both validated and failed).
 */
export function computeConflictValidation(input: ConflictValidationInput): ValidatedConflict[] {
  const claims = Array.isArray(input.enrichedClaims) ? input.enrichedClaims : [];
  const edges = Array.isArray(input.edges) ? input.edges : [];
  const stmtEmbeddings = input.statementEmbeddings ?? null;
  const claimEmbs = input.claimEmbeddings ?? null;
  const queryEmb = input.queryEmbedding ?? null;

  const { canonicalSets } = buildClaimStatementSets(claims);

  // Build mapper conflict edge set for quick lookup
  const mapperConflictSet = new Set<string>();
  for (const e of edges) {
    if (e?.type !== 'conflicts') continue;
    const a = String(e.from),
      b = String(e.to);
    mapperConflictSet.add(`${a}\0${b}`);
    mapperConflictSet.add(`${b}\0${a}`);
  }

  // Pass 1: compute proximity and triangle residual for every eligible pair.
  type PairResult = {
    aId: string;
    bId: string;
    exclA: string[];
    exclB: string[];
    crossPoolProx: number | null;
    failReason: string | null;
    mapperLabeledConflict: boolean;
    triangleResult: { residual: number; simAQ: number; simBQ: number } | null;
  };
  const pairResults: PairResult[] = [];
  const proximityValues: number[] = [];
  const residualValues: number[] = [];

  for (let i = 0; i < claims.length; i++) {
    for (let j = i + 1; j < claims.length; j++) {
      const aId = String(claims[i].id);
      const bId = String(claims[j].id);
      const canonA = canonicalSets.get(aId) ?? new Set<string>();
      const canonB = canonicalSets.get(bId) ?? new Set<string>();
      const exclA = Array.from(canonA).filter((sid) => !canonB.has(sid));
      const exclB = Array.from(canonB).filter((sid) => !canonA.has(sid));
      const mapperLabeledConflict = mapperConflictSet.has(`${aId}\0${bId}`);

      let crossPoolProx: number | null = null;
      let failReason: string | null = null;

      if (exclA.length < 2 || exclB.length < 2) {
        failReason = `insufficient exclusive statements (A:${exclA.length}, B:${exclB.length}, need ≥2 each)`;
      } else if (!stmtEmbeddings) {
        failReason = 'no statement embeddings available';
      } else {
        crossPoolProx = computeCrossPoolProximityStatements(
          exclA,
          canonB,
          exclB,
          canonA,
          stmtEmbeddings
        );
        if (crossPoolProx === null) {
          failReason = 'embeddings missing for exclusive statements';
        } else {
          proximityValues.push(crossPoolProx);
        }
      }

      // Triangle residual (claim centroids + query)
      const triangleResult =
        claimEmbs && queryEmb ? computeTriangleResidual(aId, bId, claimEmbs, queryEmb) : null;
      if (triangleResult) residualValues.push(triangleResult.residual);

      pairResults.push({
        aId,
        bId,
        exclA,
        exclB,
        crossPoolProx,
        failReason,
        mapperLabeledConflict,
        triangleResult,
      });
    }
  }

  // Derive thresholds from distributions.
  const muProximity =
    proximityValues.length > 0
      ? proximityValues.reduce((a, b) => a + b, 0) / proximityValues.length
      : null;
  const muResidual =
    residualValues.length > 0
      ? residualValues.reduce((a, b) => a + b, 0) / residualValues.length
      : null;

  // Pass 2: apply threshold and assemble ValidatedConflict records.
  const validatedConflicts: ValidatedConflict[] = [];
  for (const pr of pairResults) {
    let validated = false;
    let failReason = pr.failReason;

    if (pr.crossPoolProx !== null) {
      if (muProximity === null) {
        failReason = 'muProximity not available';
      } else {
        validated = pr.crossPoolProx > muProximity;
      }
    }

    validatedConflicts.push({
      edgeFrom: pr.aId,
      edgeTo: pr.bId,
      crossPoolProximity: pr.crossPoolProx,
      muPairwise: muProximity,
      exclusiveA: pr.exclA.length,
      exclusiveB: pr.exclB.length,
      mapperLabeledConflict: pr.mapperLabeledConflict,
      validated,
      failReason: failReason ?? null,
      triangleResidual: pr.triangleResult?.residual ?? null,
      muTriangle: muResidual,
      querySimPair: pr.triangleResult ? [pr.triangleResult.simAQ, pr.triangleResult.simBQ] : null,
    });
  }

  return validatedConflicts;
}

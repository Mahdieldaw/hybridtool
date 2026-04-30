/**
 * Phase 2 — Validate
 *
 * Single export: validateEdgesAndAllegiance
 *   - Conflict validation (cross-pool proximity + triangle residual)
 *   - Provenance refinement (allegiance-based primary claim assignment)
 *
 * Accepts canonicalSets and ownershipMap directly from Phase 1.
 */

import { cosineSimilarity } from '../clustering/distance';
import type { ShadowStatement } from '../shadow/shadow-extractor';
import type { ShadowParagraph } from '../shadow/shadow-paragraph-projector';
import type {
  Edge,
  EnrichedClaim,
  ValidatedConflict,
  ClaimDensityResult,
  ProvenanceRefinementResult,
  ProvenanceRefinementEntry,
  AllegianceSignal,
  RivalAllegiance,
  PassageDominanceSignal,
  SignalStrengthSignal,
} from '../../shared/types';

export interface ValidateInput {
  enrichedClaims: EnrichedClaim[];
  edges: Edge[];
  statementEmbeddings: Map<string, Float32Array> | null;
  claimEmbeddings: Map<string, Float32Array>;
  queryEmbedding?: Float32Array | null;
  ownershipMap: Map<string, Set<string>>;
  canonicalSets: Map<string, Set<string>>;
  shadowStatements: ShadowStatement[];
  shadowParagraphs: ShadowParagraph[];
  claimDensityResult: ClaimDensityResult;
}

export interface ValidateOutput {
  validatedConflicts: ValidatedConflict[];
  provenanceRefinement: ProvenanceRefinementResult;
}

// ── Conflict helpers ──────────────────────────────────────────────────────────

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

  let sumAtoB = 0;
  for (const ea of embsExclA) {
    let maxSim = -Infinity;
    for (const eb of allEmbsB) {
      const s = cosineSimilarity(ea, eb);
      if (s > maxSim) maxSim = s;
    }
    sumAtoB += maxSim;
  }

  let sumBtoA = 0;
  for (const eb of embsExclB) {
    let maxSim = -Infinity;
    for (const ea of allEmbsA) {
      const s = cosineSimilarity(eb, ea);
      if (s > maxSim) maxSim = s;
    }
    sumBtoA += maxSim;
  }

  return Math.min(sumAtoB / embsExclA.length, sumBtoA / embsExclB.length);
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
): { residual: number; simAQ: number; simBQ: number; simAB: number } | null {
  const embA = claimEmbeddings.get(claimIdA);
  const embB = claimEmbeddings.get(claimIdB);
  if (!embA || !embB) return null;
  const simAQ = cosineSimilarity(embA, queryEmbedding);
  const simBQ = cosineSimilarity(embB, queryEmbedding);
  const simAB = cosineSimilarity(embA, embB);
  return { residual: simAQ * simBQ - simAB, simAQ, simBQ, simAB };
}

// ── Provenance helpers ────────────────────────────────────────────────────────

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < arr.length; i++) sum += arr[i];
  return sum / arr.length;
}

function wordCount(text: string): number {
  if (!text) return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
}

interface PassageMember {
  claimId: string;
  passageLength: number;
  coverageFraction: number;
}

function buildPassageMembership(densityResult: ClaimDensityResult): Map<string, PassageMember[]> {
  const membership = new Map<string, PassageMember[]>();
  for (const [claimId, profile] of Object.entries(densityResult.profiles)) {
    const coverageByParaKey = new Map<string, number>();
    for (const pc of profile.paragraphCoverage) {
      coverageByParaKey.set(`${pc.modelIndex}:${pc.paragraphIndex}`, pc.coverage);
    }
    for (const passage of profile.statementPassages) {
      for (let pi = passage.startParagraphIndex; pi <= passage.endParagraphIndex; pi++) {
        const key = `${passage.modelIndex}:${pi}`;
        const coverage = coverageByParaKey.get(key) ?? passage.avgCoverage;
        let arr = membership.get(key);
        if (!arr) {
          arr = [];
          membership.set(key, arr);
        }
        arr.push({ claimId, passageLength: passage.statementLength, coverageFraction: coverage });
      }
    }
  }
  return membership;
}

interface ParaCoverageItem {
  claimId: string;
  coverage: number;
}

function buildParaCoverage(densityResult: ClaimDensityResult): Map<string, ParaCoverageItem[]> {
  const map = new Map<string, ParaCoverageItem[]>();
  for (const [claimId, profile] of Object.entries(densityResult.profiles)) {
    for (const pc of profile.paragraphCoverage) {
      let arr = map.get(pc.paragraphId);
      if (!arr) {
        arr = [];
        map.set(pc.paragraphId, arr);
      }
      arr.push({ claimId, coverage: pc.coverage });
    }
  }
  return map;
}

function computeAllegiance(
  stmtId: string,
  stmtEmb: Float32Array | undefined,
  paragraphId: string,
  assignedClaims: string[],
  paraById: Map<string, ShadowParagraph>,
  paraCoverage: Map<string, ParaCoverageItem[]>,
  statementOwnership: Map<string, Set<string>>,
  statementEmbeddings: Map<string, Float32Array>,
  claimEmbeddings: Map<string, Float32Array>,
  passageMembership: Map<string, PassageMember[]>
): { allegiance: AllegianceSignal; primaryClaim: string | null } {
  const para = paraById.get(paragraphId);

  const coverages = paraCoverage.get(paragraphId) ?? [];
  let dominantClaimId = assignedClaims[0];
  let bestCoverage = -1;
  for (const cv of coverages) {
    if (assignedClaims.includes(cv.claimId) && cv.coverage > bestCoverage) {
      bestCoverage = cv.coverage;
      dominantClaimId = cv.claimId;
    }
  }
  const rivalClaimIds = assignedClaims.filter((id) => id !== dominantClaimId);

  // Tier 1: Locally-calibrated allegiance
  if (para && stmtEmb) {
    const calibrationPool: Float32Array[] = [];
    for (const sid of para.statementIds) {
      if (sid === stmtId) continue;
      const owners = statementOwnership.get(sid);
      if (owners && owners.size === 1 && owners.has(dominantClaimId)) {
        const emb = statementEmbeddings.get(sid);
        if (emb) calibrationPool.push(emb);
      }
    }

    const calibrationWeight =
      para.statementIds.length > 0 ? calibrationPool.length / para.statementIds.length : 0;

    if (calibrationPool.length >= 2) {
      const dominantCentroid = claimEmbeddings.get(dominantClaimId);
      if (dominantCentroid) {
        const rivalAllegiances: RivalAllegiance[] = [];
        for (const rivalId of rivalClaimIds) {
          const rivalCentroid = claimEmbeddings.get(rivalId);
          if (!rivalCentroid) continue;

          const calDominantSims = calibrationPool.map((e) => cosineSimilarity(e, dominantCentroid));
          const calRivalSims = calibrationPool.map((e) => cosineSimilarity(e, rivalCentroid));
          const calDenom = mean(calDominantSims) + mean(calRivalSims);
          const dominantProfile = calDenom > 0 ? mean(calDominantSims) / calDenom : 0.5;

          const simDom = cosineSimilarity(stmtEmb, dominantCentroid);
          const simRiv = cosineSimilarity(stmtEmb, rivalCentroid);
          const jointDenom = simDom + simRiv;
          const jointProfile = jointDenom > 0 ? simDom / jointDenom : 0.5;

          const rawAllegiance = dominantProfile - jointProfile;
          rivalAllegiances.push({
            claimId: rivalId,
            rawAllegiance,
            weightedAllegiance: rawAllegiance * calibrationWeight,
          });
        }

        if (rivalAllegiances.length > 0) {
          let bestRival: RivalAllegiance | null = null;
          let maxAbs = -1;
          for (const ra of rivalAllegiances) {
            const abs = Math.abs(ra.weightedAllegiance);
            if (abs > maxAbs) {
              maxAbs = abs;
              bestRival = ra;
            }
          }
          const value = bestRival?.weightedAllegiance ?? null;

          let primaryClaim: string | null;
          if (value !== null && value > 0) {
            primaryClaim = dominantClaimId;
          } else if (value !== null && value < 0) {
            let strongestRival = rivalAllegiances[0].claimId;
            let strongestPull = rivalAllegiances[0].weightedAllegiance;
            for (const ra of rivalAllegiances) {
              if (ra.weightedAllegiance < strongestPull) {
                strongestPull = ra.weightedAllegiance;
                strongestRival = ra.claimId;
              }
            }
            primaryClaim = strongestRival;
          } else {
            primaryClaim = dominantClaimId;
          }

          return {
            allegiance: {
              value,
              calibrationWeight,
              dominantClaimId,
              rivalAllegiances,
              method: 'calibrated',
            },
            primaryClaim,
          };
        }
      }
    }

    // Tier 2: Centroid similarity fallback
    const centroidSims: Array<{ claimId: string; sim: number }> = [];
    for (const cid of assignedClaims) {
      const centroid = claimEmbeddings.get(cid);
      if (centroid) centroidSims.push({ claimId: cid, sim: cosineSimilarity(stmtEmb, centroid) });
    }

    if (centroidSims.length > 0) {
      centroidSims.sort((a, b) => b.sim - a.sim);
      const primaryClaim = centroidSims[0].claimId;
      const primarySim = centroidSims[0].sim;
      const rivalAllegiances: RivalAllegiance[] = [];
      for (let i = 1; i < centroidSims.length; i++) {
        const diff = primarySim - centroidSims[i].sim;
        rivalAllegiances.push({
          claimId: centroidSims[i].claimId,
          rawAllegiance: diff,
          weightedAllegiance: diff,
        });
      }
      return {
        allegiance: {
          value: rivalAllegiances.length > 0 ? rivalAllegiances[0].rawAllegiance : 0,
          calibrationWeight: 0,
          dominantClaimId,
          rivalAllegiances,
          method: 'centroid-fallback',
        },
        primaryClaim,
      };
    }
  }

  // Tier 3: Passage dominance fallback
  if (para) {
    const paraKey = `${para.modelIndex}:${para.paragraphIndex}`;
    const passages = passageMembership.get(paraKey);
    if (passages && passages.length > 0) {
      let bestOwner: string | null = null;
      let bestCov = -1;
      for (const pm of passages) {
        if (assignedClaims.includes(pm.claimId) && pm.coverageFraction > bestCov) {
          bestCov = pm.coverageFraction;
          bestOwner = pm.claimId;
        }
      }
      if (bestOwner) {
        return {
          allegiance: {
            value: null,
            calibrationWeight: 0,
            dominantClaimId,
            rivalAllegiances: [],
            method: 'passage-dominance',
          },
          primaryClaim: bestOwner,
        };
      }
    }
  }

  return {
    allegiance: {
      value: null,
      calibrationWeight: 0,
      dominantClaimId,
      rivalAllegiances: [],
      method: null,
    },
    primaryClaim: null,
  };
}

function computePassageDominance(
  para: ShadowParagraph | undefined,
  passageMembership: Map<string, PassageMember[]>
): PassageDominanceSignal {
  if (!para) return { inPassage: false, passageOwner: null, coverageFraction: 0, passageLength: 0 };
  const passages = passageMembership.get(`${para.modelIndex}:${para.paragraphIndex}`);
  if (!passages || passages.length === 0)
    return { inPassage: false, passageOwner: null, coverageFraction: 0, passageLength: 0 };
  let best = passages[0];
  for (let i = 1; i < passages.length; i++) {
    if (passages[i].coverageFraction > best.coverageFraction) best = passages[i];
  }
  return {
    inPassage: true,
    passageOwner: best.claimId,
    coverageFraction: best.coverageFraction,
    passageLength: best.passageLength,
  };
}

function computeSignalStrength(text: string): SignalStrengthSignal {
  return { signalWeight: 0, nounEntityCount: 0, stmtWordCount: wordCount(text) };
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function validateEdgesAndAllegiance(input: ValidateInput): ValidateOutput {
  const {
    enrichedClaims: claims,
    edges,
    statementEmbeddings: stmtEmbeddings,
    claimEmbeddings,
    queryEmbedding: queryEmb,
    ownershipMap,
    canonicalSets,
    shadowStatements,
    shadowParagraphs,
    claimDensityResult,
  } = input;

  const start = nowMs();

  // ── Conflict validation (two-pass: collect proximities, then threshold) ──

  const mapperConflictSet = new Set<string>();
  for (const e of edges) {
    if (e?.type !== 'conflicts') continue;
    const a = String(e.from),
      b = String(e.to);
    mapperConflictSet.add(`${a}\0${b}`);
    mapperConflictSet.add(`${b}\0${a}`);
  }

  type PairResult = {
    aId: string;
    bId: string;
    exclA: string[];
    exclB: string[];
    crossPoolProx: number | null;
    failReason: string | null;
    mapperLabeledConflict: boolean;
    triangleResult: { residual: number; simAQ: number; simBQ: number; simAB: number } | null;
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
        if (crossPoolProx === null) failReason = 'embeddings missing for exclusive statements';
        else proximityValues.push(crossPoolProx);
      }

      const triangleResult =
        claimEmbeddings && queryEmb
          ? computeTriangleResidual(aId, bId, claimEmbeddings, queryEmb)
          : null;
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

  const muProximity =
    proximityValues.length > 0
      ? proximityValues.reduce((a, b) => a + b, 0) / proximityValues.length
      : null;
  const muResidual =
    residualValues.length > 0
      ? residualValues.reduce((a, b) => a + b, 0) / residualValues.length
      : null;

  const validatedConflicts: ValidatedConflict[] = [];
  for (const pr of pairResults) {
    let validated = false;
    let failReason = pr.failReason;

    if (pr.triangleResult && muResidual !== null) {
      // NEW SYSTEM: Triangulation
      // Dynamic threshold: residual must be greater than the corpus mean
      validated = pr.triangleResult.residual > muResidual;
      if (validated) {
        failReason = null;
      } else {
        failReason = `triangle residual ${pr.triangleResult.residual.toFixed(3)} <= mu ${muResidual.toFixed(3)}`;
      }
    } else if (pr.crossPoolProx !== null) {
      // OLD SYSTEM: Cross-pool proximity
      if (muProximity === null) {
        failReason = 'muProximity not available';
      } else {
        // Must be GREATER than mean: proves they are arguing about the exact same localized topic
        validated = pr.crossPoolProx > muProximity;
        if (validated) {
          failReason = null;
        } else {
          failReason = `cross-pool prox ${pr.crossPoolProx.toFixed(3)} <= mu ${muProximity.toFixed(3)}`;
        }
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
      centroidSim: pr.triangleResult?.simAB ?? null,
      muTriangle: muResidual,
      querySimPair: pr.triangleResult ? [pr.triangleResult.simAQ, pr.triangleResult.simBQ] : null,
    });
  }

  // ── Provenance refinement ────────────────────────────────────────────────

  const stmtToParagraphId = new Map<string, string>();
  const paraById = new Map<string, ShadowParagraph>();
  for (const para of shadowParagraphs) {
    paraById.set(para.id, para);
    for (const sid of para.statementIds) stmtToParagraphId.set(sid, para.id);
  }

  const paraCoverage = buildParaCoverage(claimDensityResult);
  const passageMembership = buildPassageMembership(claimDensityResult);

  const stmtTextMap = new Map<string, string>();
  for (const stmt of shadowStatements) stmtTextMap.set(stmt.id, stmt.cleanText || stmt.text);

  const entries: Record<string, ProvenanceRefinementEntry> = {};
  let resolvedByCalibration = 0,
    resolvedByCentroidFallback = 0,
    resolvedByPassageDominance = 0,
    unresolved = 0;
  const stmtEmbeddingsNonNull = stmtEmbeddings ?? new Map<string, Float32Array>();

  for (const [stmtId, owners] of ownershipMap) {
    if (owners.size < 2) continue;

    const assignedClaims = [...owners];
    const paragraphId = stmtToParagraphId.get(stmtId);
    const stmtEmb = stmtEmbeddings?.get(stmtId);
    const para = paragraphId ? paraById.get(paragraphId) : undefined;

    const { allegiance, primaryClaim } = computeAllegiance(
      stmtId,
      stmtEmb,
      paragraphId ?? '',
      assignedClaims,
      paraById,
      paraCoverage,
      ownershipMap,
      stmtEmbeddingsNonNull,
      claimEmbeddings,
      passageMembership
    );

    if (allegiance.method === 'calibrated') resolvedByCalibration++;
    else if (allegiance.method === 'centroid-fallback') resolvedByCentroidFallback++;
    else if (allegiance.method === 'passage-dominance') resolvedByPassageDominance++;
    else unresolved++;

    entries[stmtId] = {
      statementId: stmtId,
      assignedClaims,
      primaryClaim,
      secondaryClaims: primaryClaim
        ? assignedClaims.filter((id) => id !== primaryClaim)
        : [...assignedClaims],
      allegiance,
      passageDominance: computePassageDominance(para, passageMembership),
      signalStrength: computeSignalStrength(stmtTextMap.get(stmtId) ?? ''),
    };
  }

  const totalJoint =
    resolvedByCalibration + resolvedByCentroidFallback + resolvedByPassageDominance + unresolved;

  return {
    validatedConflicts,
    provenanceRefinement: {
      entries,
      summary: {
        totalJoint,
        resolvedByCalibration,
        resolvedByCentroidFallback,
        resolvedByPassageDominance,
        unresolved,
      },
      meta: { processingTimeMs: nowMs() - start },
    },
  };
}

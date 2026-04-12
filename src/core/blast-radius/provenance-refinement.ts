/**
 * Provenance Refinement — canonical provenance assignment.
 *
 * Post-pass after mixed-method provenance merge. Disambiguates joint
 * statement ownership using three independent signals:
 *
 *   Signal 1 — Allegiance (geometry): locally-calibrated cosine allegiance
 *              with centroid-fallback when calibration pool is thin.
 *   Signal 2 — Passage dominance (structure): instrument-only.
 *   Signal 3 — Signal strength (noun density): instrument-only.
 *
 * Only Signal 1 (allegiance) produces a runtime-affecting `primaryClaim`.
 */

import { cosineSimilarity } from '../../clustering/distance';
import type { ShadowStatement } from '../../shadow/shadow-extractor';
import type { ShadowParagraph } from '../../shadow/shadow-paragraph-projector';
import type {
  ClaimDensityResult,
  ProvenanceRefinementResult,
  ProvenanceRefinementEntry,
  AllegianceSignal,
  RivalAllegiance,
  PassageDominanceSignal,
  SignalStrengthSignal,
} from '../../../shared/types';

// ── Input ───────────────────────────────────────────────────────────────

export interface ProvenanceRefinementInput {
  shadowStatements: ShadowStatement[];
  shadowParagraphs: ShadowParagraph[];
  statementOwnership: Map<string, Set<string>>;
  statementEmbeddings: Map<string, Float32Array>;
  claimEmbeddings: Map<string, Float32Array>;
  claimDensityResult: ClaimDensityResult;
}

// ── Helpers ─────────────────────────────────────────────────────────────

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

// ── Passage membership lookup ───────────────────────────────────────────

interface PassageMember {
  claimId: string;
  passageLength: number;
  coverageFraction: number;
}

function buildPassageMembership(densityResult: ClaimDensityResult): Map<string, PassageMember[]> {
  // Key: `${modelIndex}:${paragraphIndex}` → list of passages that contain it
  const membership = new Map<string, PassageMember[]>();

  for (const [claimId, profile] of Object.entries(densityResult.profiles)) {
    // Build a coverage map for quick lookup
    const coverageByParaKey = new Map<string, number>();
    for (const pc of profile.paragraphCoverage) {
      coverageByParaKey.set(`${pc.modelIndex}:${pc.paragraphIndex}`, pc.coverage);
    }

    for (const passage of profile.passages) {
      for (let pi = passage.startParagraphIndex; pi <= passage.endParagraphIndex; pi++) {
        const key = `${passage.modelIndex}:${pi}`;
        const coverage = coverageByParaKey.get(key) ?? passage.avgCoverage;
        let arr = membership.get(key);
        if (!arr) {
          arr = [];
          membership.set(key, arr);
        }
        arr.push({
          claimId,
          passageLength: passage.length,
          coverageFraction: coverage,
        });
      }
    }
  }

  return membership;
}

// ── Per-paragraph coverage lookup ───────────────────────────────────────

interface ParaCoverageItem {
  claimId: string;
  coverage: number;
}

function buildParaCoverage(densityResult: ClaimDensityResult): Map<string, ParaCoverageItem[]> {
  const map = new Map<string, ParaCoverageItem[]>();
  for (const [claimId, profile] of Object.entries(densityResult.profiles)) {
    for (const pc of profile.paragraphCoverage) {
      const key = pc.paragraphId;
      let arr = map.get(key);
      if (!arr) {
        arr = [];
        map.set(key, arr);
      }
      arr.push({ claimId, coverage: pc.coverage });
    }
  }
  return map;
}

// ── Signal 1 — Allegiance ───────────────────────────────────────────────

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

  // Find dominant claim in this paragraph (highest coverage fraction)
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

  // ── Tier 1: Locally-calibrated allegiance ───────────────────────────
  if (para && stmtEmb) {
    // Build calibration pool: statements in P exclusively owned by dominant claim
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

          // Calibration baseline: how do dominant-exclusive statements split between centroids?
          const calDominantSims = calibrationPool.map((e) => cosineSimilarity(e, dominantCentroid));
          const calRivalSims = calibrationPool.map((e) => cosineSimilarity(e, rivalCentroid));

          const meanCalDom = mean(calDominantSims);
          const meanCalRiv = mean(calRivalSims);
          const calDenom = meanCalDom + meanCalRiv;
          const dominantProfile = calDenom > 0 ? meanCalDom / calDenom : 0.5;

          // Subject: how does the joint statement split?
          const simDom = cosineSimilarity(stmtEmb, dominantCentroid);
          const simRiv = cosineSimilarity(stmtEmb, rivalCentroid);
          const jointDenom = simDom + simRiv;
          const jointProfile = jointDenom > 0 ? simDom / jointDenom : 0.5;

          const rawAllegiance = dominantProfile - jointProfile;
          const weightedAllegiance = rawAllegiance * calibrationWeight;

          rivalAllegiances.push({
            claimId: rivalId,
            rawAllegiance,
            weightedAllegiance,
          });
        }

        if (rivalAllegiances.length > 0) {
          // Positive value = leans dominant, negative = leans rival
          // Use the max absolute weighted allegiance for the summary value
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

          // Resolve primary: if allegiance is positive, dominant wins.
          // If negative, the rival with strongest pull wins.
          let primaryClaim: string | null;
          if (value !== null && value > 0) {
            primaryClaim = dominantClaimId;
          } else if (value !== null && value < 0) {
            // Find the rival with the most negative (strongest pull) allegiance
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
            primaryClaim = dominantClaimId; // zero allegiance — defer to dominant
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

    // ── Tier 2: Centroid similarity fallback (calibrationPool < 2) ─────
    const centroidSims: Array<{ claimId: string; sim: number }> = [];
    for (const cid of assignedClaims) {
      const centroid = claimEmbeddings.get(cid);
      if (centroid) {
        centroidSims.push({ claimId: cid, sim: cosineSimilarity(stmtEmb, centroid) });
      }
    }

    if (centroidSims.length > 0) {
      centroidSims.sort((a, b) => b.sim - a.sim);
      const primaryClaim = centroidSims[0].claimId;
      const primarySim = centroidSims[0].sim;

      // Build synthetic rival allegiances from sim differences
      const rivalAllegiances: RivalAllegiance[] = [];
      for (let i = 1; i < centroidSims.length; i++) {
        const diff = primarySim - centroidSims[i].sim;
        rivalAllegiances.push({
          claimId: centroidSims[i].claimId,
          rawAllegiance: diff,
          weightedAllegiance: diff, // No calibration weight in fallback
        });
      }

      return {
        allegiance: {
          value: rivalAllegiances.length > 0 ? rivalAllegiances[0].rawAllegiance : 0,
          calibrationWeight: 0, // No calibration pool
          dominantClaimId,
          rivalAllegiances,
          method: 'centroid-fallback',
        },
        primaryClaim,
      };
    }
  }

  // ── Tier 3: Passage dominance fallback (no embeddings — theoretical) ──
  if (para) {
    const paraKey = `${para.modelIndex}:${para.paragraphIndex}`;
    const passages = passageMembership.get(paraKey);
    if (passages && passages.length > 0) {
      // Pick the passage owner with highest coverage among assigned claims
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

  // Genuinely unresolvable
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

// ── Signal 2 — Passage Dominance ────────────────────────────────────────

function computePassageDominance(
  para: ShadowParagraph | undefined,
  passageMembership: Map<string, PassageMember[]>
): PassageDominanceSignal {
  if (!para) {
    return { inPassage: false, passageOwner: null, coverageFraction: 0, passageLength: 0 };
  }

  const key = `${para.modelIndex}:${para.paragraphIndex}`;
  const passages = passageMembership.get(key);
  if (!passages || passages.length === 0) {
    return { inPassage: false, passageOwner: null, coverageFraction: 0, passageLength: 0 };
  }

  // Pick the passage with highest coverage
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

// ── Signal 3 — Signal Strength ──────────────────────────────────────────

function computeSignalStrength(text: string): SignalStrengthSignal {
  const wc = wordCount(text);
  return {
    signalWeight: 0,
    nounEntityCount: 0,
    stmtWordCount: wc,
  };
}

// ── Main ────────────────────────────────────────────────────────────────

export function computeProvenanceRefinement(
  input: ProvenanceRefinementInput
): ProvenanceRefinementResult {
  const start = nowMs();
  const {
    shadowStatements,
    shadowParagraphs,
    statementOwnership,
    statementEmbeddings,
    claimEmbeddings,
    claimDensityResult,
  } = input;

  // ── Build lookups ───────────────────────────────────────────────────
  const stmtToParagraphId = new Map<string, string>();
  const paraById = new Map<string, ShadowParagraph>();

  for (const para of shadowParagraphs) {
    paraById.set(para.id, para);
    for (const sid of para.statementIds) {
      stmtToParagraphId.set(sid, para.id);
    }
  }

  const paraCoverage = buildParaCoverage(claimDensityResult);
  const passageMembership = buildPassageMembership(claimDensityResult);

  // Statement text lookup
  const stmtTextMap = new Map<string, string>();
  for (const stmt of shadowStatements) {
    stmtTextMap.set(stmt.id, stmt.cleanText || stmt.text);
  }

  // ── Process jointly-assigned statements ─────────────────────────────
  const entries: Record<string, ProvenanceRefinementEntry> = {};
  let resolvedByCalibration = 0;
  let resolvedByCentroidFallback = 0;
  let resolvedByPassageDominance = 0;
  let unresolved = 0;

  for (const [stmtId, owners] of statementOwnership) {
    if (owners.size < 2) continue;

    const assignedClaims = [...owners];
    const paragraphId = stmtToParagraphId.get(stmtId);
    const stmtEmb = statementEmbeddings.get(stmtId);
    const text = stmtTextMap.get(stmtId) ?? '';
    const para = paragraphId ? paraById.get(paragraphId) : undefined;

    // Signal 1 — Allegiance (with 3-tier fallback)
    const { allegiance, primaryClaim } = computeAllegiance(
      stmtId,
      stmtEmb,
      paragraphId ?? '',
      assignedClaims,
      paraById,
      paraCoverage,
      statementOwnership,
      statementEmbeddings,
      claimEmbeddings,
      passageMembership
    );

    // Signal 2 — Passage dominance (instrument only)
    const passageDominance = computePassageDominance(para, passageMembership);

    // Signal 3 — Signal strength (instrument only)
    const signalStrength = computeSignalStrength(text);

    // Track resolution method
    if (allegiance.method === 'calibrated') resolvedByCalibration++;
    else if (allegiance.method === 'centroid-fallback') resolvedByCentroidFallback++;
    else if (allegiance.method === 'passage-dominance') resolvedByPassageDominance++;
    else unresolved++;

    // Build secondary claims: assigned minus primary, ordered
    const secondaryClaims = primaryClaim
      ? assignedClaims.filter((id) => id !== primaryClaim)
      : [...assignedClaims];

    entries[stmtId] = {
      statementId: stmtId,
      assignedClaims,
      primaryClaim,
      secondaryClaims,
      allegiance,
      passageDominance,
      signalStrength,
    };
  }

  const totalJoint =
    resolvedByCalibration + resolvedByCentroidFallback + resolvedByPassageDominance + unresolved;

  return {
    entries,
    summary: {
      totalJoint,
      resolvedByCalibration,
      resolvedByCentroidFallback,
      resolvedByPassageDominance,
      unresolved,
    },
    meta: { processingTimeMs: nowMs() - start },
  };
}

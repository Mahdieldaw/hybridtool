/**
 * Phase 5 — Classify
 *
 * Moves statement-classification.ts into the provenance pipeline as a strict
 * phase. Key difference from the original:
 *
 *   - ownershipMap is REQUIRED (not nullable). The defensive fallback
 *     `statementOwnership ?? computeStatementOwnership(enrichedClaims)` is
 *     removed — Phase 1 always produces the map.
 *   - computeStatementOwnership is not imported here at all.
 *
 * All downstream code that called computeStatementClassification with
 * statementOwnership: null must now pass ownershipMap from Phase 1.
 */

import { cosineSimilarity } from '../clustering/distance';
import type { ShadowParagraph } from '../shadow/shadow-paragraph-projector';
import type {
  ClaimDensityResult,
  PassageRoutingResult,
  LandscapePosition,
  StatementClassificationResult,
  ClaimedStatementEntry,
  UnclaimedGroup,
  UnclaimedParagraphEntry,
} from '../../shared/types';

// ── Helpers ───────────────────────────────────────────────────────────────

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

// ── Input ─────────────────────────────────────────────────────────────────

export interface ClassifyPhaseInput {
  shadowStatements: Array<{ id: string; modelIndex?: number }>;
  shadowParagraphs: ShadowParagraph[];
  enrichedClaims: Array<{ id: string; sourceStatementIds?: string[] }>;
  claimDensityResult: ClaimDensityResult;
  passageRoutingResult: PassageRoutingResult | null;
  paragraphEmbeddings: Map<string, Float32Array>;
  claimEmbeddings: Map<string, Float32Array>;
  queryRelevanceScores: Map<string, { querySimilarity: number }>;
  /** Required — provided by Phase 1 (runMeasurePhase). No fallback. */
  ownershipMap: Map<string, Set<string>>;
}

// ── Engine ────────────────────────────────────────────────────────────────

export function computeStatementClassification(
  input: ClassifyPhaseInput
): StatementClassificationResult {
  const start = nowMs();
  const {
    shadowStatements,
    shadowParagraphs,
    enrichedClaims,
    claimDensityResult,
    passageRoutingResult,
    paragraphEmbeddings,
    claimEmbeddings,
    queryRelevanceScores,
    ownershipMap,
  } = input;

  // ── 1. Claimed set from Phase 1 ownershipMap (no reconstruction) ─────
  const claimedStmts = ownershipMap;

  // ── 2. Build passage membership lookup ────────────────────────────────
  const paraByKey = new Map<string, ShadowParagraph>();
  for (const para of shadowParagraphs) {
    paraByKey.set(`${para.modelIndex}:${para.paragraphIndex}`, para);
  }

  // stmtId → passageKey ("claimId:modelIndex:startParagraphIndex")
  const passageMembership = new Map<string, string>();
  const profiles = claimDensityResult.profiles;

  for (const claim of enrichedClaims) {
    const profile = profiles[claim.id];
    if (!profile || !Array.isArray(profile.passages)) continue;

    const claimStmtSet = new Set(
      Array.isArray(claim.sourceStatementIds)
        ? claim.sourceStatementIds.filter((s): s is string => typeof s === 'string' && !!s.trim())
        : []
    );
    if (claimStmtSet.size === 0) continue;

    for (const passage of profile.passages) {
      const passageKey = `${claim.id}:${passage.modelIndex}:${passage.startParagraphIndex}`;
      for (let pi = passage.startParagraphIndex; pi <= passage.endParagraphIndex; pi++) {
        const para = paraByKey.get(`${passage.modelIndex}:${pi}`);
        if (!para) continue;
        for (const stmtId of para.statementIds) {
          if (claimStmtSet.has(stmtId)) {
            passageMembership.set(stmtId, passageKey);
          }
        }
      }
    }
  }

  // ── 3. Populate claimed entries ───────────────────────────────────────
  const claimed: Record<string, ClaimedStatementEntry> = {};
  for (const [stmtId, claimIdSet] of claimedStmts) {
    claimed[stmtId] = {
      claimIds: [...claimIdSet],
      inPassage: passageMembership.has(stmtId),
      passageKey: passageMembership.get(stmtId),
    };
  }

  // ── 4. Identify paragraphs with unclaimed statements ──────────────────
  const allStmtIds = new Set(shadowStatements.map((s) => s.id));
  let mixedParagraphCount = 0;
  let fullyUnclaimedParagraphCount = 0;
  let fullyCoveredParagraphCount = 0;

  interface CandidateParagraph {
    para: ShadowParagraph;
    unclaimedIds: string[];
    claimedIds: string[];
  }
  const candidates: CandidateParagraph[] = [];

  for (const para of shadowParagraphs) {
    const unclaimed: string[] = [];
    const claimedInPara: string[] = [];
    for (const sid of para.statementIds) {
      if (!allStmtIds.has(sid)) continue;
      if (claimedStmts.has(sid)) {
        claimedInPara.push(sid);
      } else {
        unclaimed.push(sid);
      }
    }
    if (unclaimed.length === 0 && claimedInPara.length > 0) {
      fullyCoveredParagraphCount++;
    } else if (unclaimed.length > 0 && claimedInPara.length === 0) {
      fullyUnclaimedParagraphCount++;
      candidates.push({ para, unclaimedIds: unclaimed, claimedIds: claimedInPara });
    } else if (unclaimed.length > 0 && claimedInPara.length > 0) {
      mixedParagraphCount++;
      candidates.push({ para, unclaimedIds: unclaimed, claimedIds: claimedInPara });
    }
  }

  // ── 5. Compute per-paragraph claim similarities ───────────────────────
  const claimIds = enrichedClaims.map((c) => c.id);
  const claimEmbList: Array<{ id: string; emb: Float32Array }> = [];
  for (const id of claimIds) {
    const emb = claimEmbeddings.get(id);
    if (emb) claimEmbList.push({ id, emb });
  }

  interface ScoredParagraph {
    entry: UnclaimedParagraphEntry;
    bestClaimId: string;
    bestSim: number;
  }
  const scoredParagraphs: ScoredParagraph[] = [];

  for (const { para, unclaimedIds, claimedIds } of candidates) {
    const paraEmb = paragraphEmbeddings.get(para.id);
    if (claimEmbList.length === 0 || !paraEmb) continue;

    const claimSimilarities: Record<string, number> = {};
    let bestClaimId = '';
    let bestSim = -Infinity;

    for (const { id, emb } of claimEmbList) {
      const sim = cosineSimilarity(paraEmb, emb);
      claimSimilarities[id] = sim;
      if (sim > bestSim) {
        bestSim = sim;
        bestClaimId = id;
      }
    }

    if (!bestClaimId) continue;

    const statementQueryRelevance: Record<string, number> = {};
    for (const sid of unclaimedIds) {
      const qr = queryRelevanceScores.get(sid);
      statementQueryRelevance[sid] = qr?.querySimilarity ?? 0;
    }

    scoredParagraphs.push({
      entry: {
        paragraphId: para.id,
        modelIndex: para.modelIndex,
        paragraphIndex: para.paragraphIndex,
        claimSimilarities,
        unclaimedStatementIds: unclaimedIds,
        claimedStatementIds: claimedIds,
        statementQueryRelevance,
      },
      bestClaimId,
      bestSim,
    });
  }

  // ── 6. Group by nearestClaimId ────────────────────────────────────────
  const groupMap = new Map<string, ScoredParagraph[]>();
  for (const sp of scoredParagraphs) {
    if (!groupMap.has(sp.bestClaimId)) groupMap.set(sp.bestClaimId, []);
    groupMap.get(sp.bestClaimId)!.push(sp);
  }

  const claimProfiles = passageRoutingResult?.claimProfiles ?? {};

  const unclaimedGroups: UnclaimedGroup[] = [];
  for (const [nearestClaimId, members] of groupMap) {
    const paragraphs = members.map((m) => m.entry);

    const sims = members.map((m) => m.bestSim);
    const meanClaimSimilarity = sims.length > 0 ? sims.reduce((a, b) => a + b, 0) / sims.length : 0;

    const allQr: number[] = [];
    for (const m of members) {
      for (const v of Object.values(m.entry.statementQueryRelevance)) {
        allQr.push(v);
      }
    }
    const meanQueryRelevance =
      allQr.length > 0 ? allQr.reduce((a, b) => a + b, 0) / allQr.length : 0;
    const maxQueryRelevance = allQr.length > 0 ? Math.max(...allQr) : 0;

    const landscape: LandscapePosition =
      (claimProfiles[nearestClaimId]?.landscapePosition as LandscapePosition) ?? 'floor';

    unclaimedGroups.push({
      nearestClaimId,
      nearestClaimLandscapePosition: landscape,
      paragraphs,
      meanClaimSimilarity,
      meanQueryRelevance,
      maxQueryRelevance,
    });
  }

  // ── 7. Summary ────────────────────────────────────────────────────────
  const totalStatements = shadowStatements.length;
  const claimedCount = Object.keys(claimed).length;
  let unclaimedCount = 0;
  for (const g of unclaimedGroups) {
    for (const p of g.paragraphs) {
      unclaimedCount += p.unclaimedStatementIds.length;
    }
  }

  return {
    claimed,
    unclaimedGroups,
    summary: {
      totalStatements,
      claimedCount,
      unclaimedCount,
      mixedParagraphCount,
      fullyUnclaimedParagraphCount,
      fullyCoveredParagraphCount,
      unclaimedGroupCount: unclaimedGroups.length,
    },
    meta: { processingTimeMs: nowMs() - start },
  };
}

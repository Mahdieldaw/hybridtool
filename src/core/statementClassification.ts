/**
 * Statement classification — geometric grouping of the full corpus for the reading surface.
 *
 * Bridges paragraph embeddings (coarse spatial grouping) with statement IDs
 * (fine-grained coverage tracking). Unclaimed statements are grouped by
 * paragraph-level cosine proximity to the nearest claim — geometric
 * neighborhoods, not semantic assignments.
 *
 * Runs AFTER: mixed provenance, claim density, passage routing, query relevance.
 * Consumes existing data only. No new embeddings, no LLM calls.
 */

import { cosineSimilarity } from '../clustering/distance';
import type { ShadowParagraph } from '../shadow/ShadowParagraphProjector';
import type {
  ClaimDensityResult,
  PassageRoutingResult,
  LandscapePosition,
  StatementClassificationResult,
  ClaimedStatementEntry,
  UnclaimedGroup,
  UnclaimedParagraphEntry,
} from '../../shared/contract';
import { computeStatementOwnership } from '../ConciergeService/claimProvenance';

// ── Input ───────────────────────────────────────────────────────────────

export interface StatementClassificationInput {
  shadowStatements: Array<{ id: string; modelIndex?: number }>;
  shadowParagraphs: ShadowParagraph[];
  enrichedClaims: Array<{ id: string; sourceStatementIds?: string[] }>;
  claimDensityResult: ClaimDensityResult;
  passageRoutingResult: PassageRoutingResult | null;
  paragraphEmbeddings: Map<string, Float32Array>;
  claimEmbeddings: Map<string, Float32Array>;
  queryRelevanceScores: Map<string, { querySimilarity: number }>;
  statementOwnership: Map<string, Set<string>> | null;
}

// ── Helpers ─────────────────────────────────────────────────────────────

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

// ── Engine ───────────────────────────────────────────────────────────────

export function computeStatementClassification(
  input: StatementClassificationInput
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
    statementOwnership,
  } = input;

  // ── 1. Build claimed set: stmtId → Set<claimId> ────────────────────
  const claimedStmts = statementOwnership ?? computeStatementOwnership(enrichedClaims as any);

  // ── 2. Build passage membership lookup ─────────────────────────────
  // Pre-build paragraph lookup: "modelIndex:paragraphIndex" → ShadowParagraph
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

  // ── 3. Populate claimed entries ────────────────────────────────────
  const claimed: Record<string, ClaimedStatementEntry> = {};
  for (const [stmtId, claimIdSet] of claimedStmts) {
    claimed[stmtId] = {
      claimIds: [...claimIdSet],
      inPassage: passageMembership.has(stmtId),
      passageKey: passageMembership.get(stmtId),
    };
  }

  // ── 4. Identify paragraphs with unclaimed statements ───────────────
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
      if (!allStmtIds.has(sid)) continue; // skip if not in corpus
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
    // else: empty paragraph (no statements in corpus), skip
  }

  // ── 5. Compute per-paragraph claim similarities ────────────────────
  // Collect claim IDs + embeddings once
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

    // Compute cosine to all claims (or empty if no embedding)
    const claimSimilarities: Record<string, number> = {};
    let bestClaimId = claimIds[0] ?? '';
    let bestSim = -Infinity;

    if (paraEmb && claimEmbList.length > 0) {
      for (const { id, emb } of claimEmbList) {
        const sim = cosineSimilarity(paraEmb, emb);
        claimSimilarities[id] = sim;
        if (sim > bestSim) {
          bestSim = sim;
          bestClaimId = id;
        }
      }
    } else {
      bestSim = 0;
    }

    // Collect per-statement query relevance
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

  // ── 6. Group by nearestClaimId ─────────────────────────────────────
  const groupMap = new Map<string, ScoredParagraph[]>();
  for (const sp of scoredParagraphs) {
    if (!groupMap.has(sp.bestClaimId)) groupMap.set(sp.bestClaimId, []);
    groupMap.get(sp.bestClaimId)!.push(sp);
  }

  const claimProfiles = passageRoutingResult?.claimProfiles ?? {};

  const unclaimedGroups: UnclaimedGroup[] = [];
  for (const [nearestClaimId, members] of groupMap) {
    const paragraphs = members.map((m) => m.entry);

    // Group-level aggregates
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

  // ── 7. Summary ─────────────────────────────────────────────────────
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

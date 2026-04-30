/**
 * Phase 3 — Surface
 *
 * Single export: computeTopologicalSurface
 *   - Passage routing (L1 arithmetic on density profiles → landscape positions)
 *   - Blast surface (twin map + risk vectors)
 *
 * Accepts canonicalSets and exclusiveIds directly from Phase 1.
 */

import type {
  EnrichedClaim,
  ClaimDensityResult,
  PassageRoutingResult,
  BlastSurfaceResult,
  ValidatedConflict,
  PassageClaimProfile,
  PassageClaimRouting,
  PassageRoutedClaim,
  StatementPassageEntry,
  BlastSurfaceClaimScore,
  BlastSurfaceRiskVector,
  StatementTwinMap,
  MixedResolution,
  MixedStatementResolution,
  MixedDirectionProbe,
} from '../../shared/types';
import type { PeripheryResult } from '../geometry';
import type { ShadowParagraph } from '../shadow';
import { cosineSimilarity } from '../clustering/distance';
import nlp from 'compromise';
import { logInfraError } from '../errors';

export interface SurfaceInput {
  enrichedClaims: EnrichedClaim[];
  claimDensityResult: ClaimDensityResult;
  validatedConflicts: ValidatedConflict[];
  modelCount: number;
  periphery: PeripheryResult;
  queryEmbedding?: Float32Array;
  claimEmbeddings?: Map<string, Float32Array>;
  statementEmbeddings: Map<string, Float32Array>;
  statementTexts?: Map<string, string>;
  totalCorpusStatements: number;
  canonicalSets: Map<string, Set<string>>;
  exclusiveIds: Map<string, string[]>;
  shadowParagraphs: ShadowParagraph[]; // needed for mass triple computation
}

export interface SurfaceOutput {
  passageRoutingResult: PassageRoutingResult;
  blastSurfaceResult: BlastSurfaceResult;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function mean(nums: number[]): number {
  if (nums.length === 0) return 0;
  let s = 0;
  for (const n of nums) s += n;
  return s / nums.length;
}

function sigma(nums: number[], mu: number): number {
  if (nums.length === 0) return 0;
  let s = 0;
  for (const n of nums) {
    const d = n - mu;
    s += d * d;
  }
  return Math.sqrt(s / nums.length);
}

function clamp01(v: number): number {
  return v <= 0 ? 0 : v >= 1 ? 1 : v;
}

// Rank-average percentile against a pre-sorted ascending array.
// Caller is responsible for sorting once and reusing across calls — the helper
// trusts the contract and never copies or re-sorts. Walks forward to find the
// upper bound of equal values (avoids the in-place reverse() bug).
function percentileFromSortedAsc(val: number, sortedAsc: number[]): number {
  const n = sortedAsc.length;
  if (n <= 1) return 0;
  const firstIdx = sortedAsc.findIndex((v) => v === val);
  if (firstIdx === -1) return 0;
  let lastIdx = firstIdx;
  while (lastIdx + 1 < n && sortedAsc[lastIdx + 1] === val) lastIdx++;
  const rankAvg = (firstIdx + lastIdx) / 2;
  return rankAvg / (n - 1);
}

function findHostClaim(
  statementId: string,
  canonicalSets: Map<string, Set<string>>
): string | null {
  for (const [claimId, set] of canonicalSets) {
    if (set.has(statementId)) return claimId;
  }
  return null;
}

export function computeNounSurvivalRatio(text: string): number {
  if (!text || typeof text !== 'string') return 0;
  const trimmed = text.replace(/[*_#|>]/g, '').trim();
  if (trimmed.length === 0) return 0;
  const words = trimmed.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return 0;
  try {
    const doc = nlp(trimmed);
    doc.remove('#Verb');
    doc.remove('#Adverb');
    doc.remove('#Adjective');
    doc.remove('#Conjunction');
    doc.remove('#Preposition');
    doc.remove('#Determiner');
    doc.remove('#Pronoun');
    doc.remove('#Modal');
    doc.remove('#Auxiliary');
    doc.remove('#Copula');
    doc.remove('#Negative');
    doc.remove('#QuestionWord');
    const skeleton = doc.text('normal').replace(/\s+/g, ' ').trim();
    return skeleton.split(/\s+/).filter((w) => w.length > 0).length / words.length;
  } catch (err) {
    logInfraError('provenance/surface/computeNounSurvivalRatio', err);
    return 0;
  }
}

function computeTwinMap(
  claims: Array<{ id: string }>,
  canonicalSets: Map<string, Set<string>>,
  statementEmbeddings: Map<string, Float32Array>
): StatementTwinMap {
  const twinStart = performance.now();

  const allClaimOwnedIds = new Set<string>();
  for (const set of canonicalSets.values()) for (const sid of set) allClaimOwnedIds.add(sid);

  const unclassifiedIds: string[] = [];
  for (const sid of statementEmbeddings.keys()) {
    if (!allClaimOwnedIds.has(sid)) unclassifiedIds.push(sid);
  }

  const perClaim: Record<
    string,
    Record<string, { twinStatementId: string; similarity: number } | null>
  > = {};
  const thresholdsPerClaim: Record<string, Record<string, number>> = {};
  let statementsProcessed = 0;
  let totalWithTwins = 0;
  const allThresholdValues: number[] = [];

  for (const claim of claims) {
    const claimId = claim.id;
    const homeSet = canonicalSets.get(claimId) ?? new Set<string>();
    if (homeSet.size === 0) continue;

    const claimTwins: Record<string, { twinStatementId: string; similarity: number } | null> = {};
    const claimThresholds: Record<string, number> = {};

    const homeEmbeddings = new Map<string, Float32Array>();
    for (const sid of homeSet) {
      const emb = statementEmbeddings.get(sid);
      if (emb) homeEmbeddings.set(sid, emb);
    }

    const candidateIdSet = new Set<string>();
    for (const [otherId, otherSet] of canonicalSets.entries()) {
      if (otherId === claimId) continue;
      for (const sid of otherSet) {
        if (!homeSet.has(sid)) candidateIdSet.add(sid);
      }
    }
    for (const sid of unclassifiedIds) {
      if (!homeSet.has(sid)) candidateIdSet.add(sid);
    }
    const candidateIds = Array.from(candidateIdSet);

    for (const sid of homeSet) {
      statementsProcessed++;
      const sEmb = statementEmbeddings.get(sid);
      if (!sEmb) {
        claimTwins[sid] = null;
        continue;
      }

      const candidateSims: number[] = [];
      const simByCandidateId = new Map<string, number>();
      for (const cid of candidateIds) {
        const cEmb = statementEmbeddings.get(cid);
        if (!cEmb) continue;
        const sim = cosineSimilarity(sEmb, cEmb);
        candidateSims.push(sim);
        simByCandidateId.set(cid, sim);
      }

      if (candidateSims.length === 0) {
        claimTwins[sid] = null;
        continue;
      }

      const muS = candidateSims.reduce((a, b) => a + b, 0) / candidateSims.length;
      const varS = candidateSims.reduce((s, v) => s + (v - muS) ** 2, 0) / candidateSims.length;
      const tauS = clamp01(muS + 2 * Math.sqrt(varS));
      claimThresholds[sid] = tauS;
      allThresholdValues.push(tauS);

      let bestSim = -Infinity;
      let bestCandidateId: string | null = null;
      for (const [cid, sim] of simByCandidateId.entries()) {
        if (sim > bestSim) {
          bestSim = sim;
          bestCandidateId = cid;
        }
      }

      if (!bestCandidateId || bestSim <= tauS) {
        claimTwins[sid] = null;
        continue;
      }

      const tEmb = statementEmbeddings.get(bestCandidateId);
      if (!tEmb) {
        claimTwins[sid] = null;
        continue;
      }

      let bestBackSim = -Infinity;
      let bestBackId: string | null = null;
      for (const [hid, hEmb] of homeEmbeddings.entries()) {
        const sim = cosineSimilarity(tEmb, hEmb);
        if (sim > bestBackSim) {
          bestBackSim = sim;
          bestBackId = hid;
        }
      }

      if (bestBackId === sid) {
        claimTwins[sid] = { twinStatementId: bestCandidateId, similarity: bestSim };
        totalWithTwins++;
      } else {
        claimTwins[sid] = null;
      }
    }

    perClaim[claimId] = claimTwins;
    thresholdsPerClaim[claimId] = claimThresholds;
  }

  return {
    perClaim,
    thresholds: thresholdsPerClaim,
    meta: {
      totalStatements: statementsProcessed,
      statementsWithTwins: totalWithTwins,
      meanThreshold:
        allThresholdValues.length > 0
          ? allThresholdValues.reduce((a, b) => a + b, 0) / allThresholdValues.length
          : 0,
      processingTimeMs: performance.now() - twinStart,
    },
  };
}

function speculativeMixedResolution(
  prunedClaimId: string,
  canonicalSets: Map<string, Set<string>>,
  canonicalOwnerCounts: Map<string, number>,
  perClaim: Record<string, Record<string, { twinStatementId: string; similarity: number } | null>>,
  allClaimOwnedIds: Set<string>,
  safeClaimIds: Set<string>
): MixedResolution {
  const prunedSet = canonicalSets.get(prunedClaimId) ?? new Set<string>();
  const sharedSids: string[] = [];
  for (const sid of prunedSet) {
    if ((canonicalOwnerCounts.get(sid) ?? 0) >= 2) sharedSids.push(sid);
  }

  if (sharedSids.length === 0) {
    return {
      mixedCount: 0,
      mixedProtectedCount: 0,
      mixedRemovedCount: 0,
      mixedSkeletonizedCount: 0,
      details: [],
    };
  }

  const ownersBySid = new Map<string, string[]>();
  for (const sid of sharedSids) {
    const owners: string[] = [];
    for (const [claimId, set] of canonicalSets) {
      if (claimId !== prunedClaimId && set.has(sid)) owners.push(claimId);
    }
    ownersBySid.set(sid, owners);
  }

  const details: MixedStatementResolution[] = [];
  let protCount = 0,
    remCount = 0,
    skelCount = 0;

  for (const sid of sharedSids) {
    const survivingParents = ownersBySid.get(sid) ?? [];
    if (survivingParents.length === 0) continue;

    const probes: MixedDirectionProbe[] = [];
    let resolved = false;
    let protectorClaimId: string | null = null;

    for (const q of survivingParents) {
      const twinEntry = perClaim[q]?.[sid] ?? null;
      if (!twinEntry) {
        probes.push({
          survivingClaimId: q,
          twinStatementId: null,
          twinSimilarity: null,
          pointsIntoPrunedSet: null,
        });
        continue;
      }
      const pointsInto = prunedSet.has(twinEntry.twinStatementId);
      probes.push({
        survivingClaimId: q,
        twinStatementId: twinEntry.twinStatementId,
        twinSimilarity: twinEntry.similarity,
        pointsIntoPrunedSet: pointsInto,
      });
      if (!pointsInto && !resolved) {
        resolved = true;
        protectorClaimId = q;
      }
    }

    let action: 'PROTECTED' | 'REMOVE' | 'SKELETONIZE';
    if (resolved) {
      action = 'PROTECTED';
      protCount++;
    } else {
      const fateTwin = perClaim[prunedClaimId]?.[sid] ?? null;
      if (fateTwin) {
        const twinId = fateTwin.twinStatementId;
        if (!allClaimOwnedIds.has(twinId)) {
          action = 'REMOVE';
          remCount++;
        } else {
          let hasSafeOwner = false;
          for (const [claimId, set] of canonicalSets) {
            if (set.has(twinId) && safeClaimIds.has(claimId)) {
              hasSafeOwner = true;
              break;
            }
          }
          if (hasSafeOwner) {
            action = 'REMOVE';
            remCount++;
          } else {
            action = 'SKELETONIZE';
            skelCount++;
          }
        }
      } else {
        action = 'SKELETONIZE';
        skelCount++;
      }
    }

    details.push({ statementId: sid, survivingParents, action, probes, protectorClaimId });
  }

  return {
    mixedCount: details.length,
    mixedProtectedCount: protCount,
    mixedRemovedCount: remCount,
    mixedSkeletonizedCount: skelCount,
    details,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function computeTopologicalSurface(input: SurfaceInput): SurfaceOutput {
  const t0 = performance.now();
  const {
    enrichedClaims,
    claimDensityResult,
    validatedConflicts,
    periphery,
    queryEmbedding,
    claimEmbeddings,
    statementEmbeddings,
    statementTexts,
    totalCorpusStatements,
    canonicalSets,
    exclusiveIds,
    shadowParagraphs,
  } = input;

  const profiles = claimDensityResult.profiles;
  const filterPeripheral =
    periphery.corpusMode === 'dominant-core' && periphery.peripheralNodeIds.size > 0;

  // Shared derived structures (built once from Phase 1's canonicalSets)
  const canonicalOwnerCounts = new Map<string, number>();
  const allClaimOwnedIds = new Set<string>();
  for (const set of canonicalSets.values()) {
    for (const sid of set) {
      allClaimOwnedIds.add(sid);
      canonicalOwnerCounts.set(sid, (canonicalOwnerCounts.get(sid) ?? 0) + 1);
    }
  }

  // ── Block 1: Passage Routing (5-Phase Bottom-Up Algorithm) ────────────────────────

  const claimProfiles: Record<string, PassageClaimProfile> = {};

  // Block A: Build base profiles for all claims (instrumentation fields + placeholders for routing fields)
  for (const claim of enrichedClaims) {
    const id = String(claim.id);
    const profile = profiles[id];

    let queryDistance: number | undefined;
    if (queryEmbedding && claimEmbeddings?.has(id)) {
      const emb = claimEmbeddings.get(id);
      if (emb) queryDistance = 1 - cosineSimilarity(emb, queryEmbedding);
    }

    if (!profile) {
      claimProfiles[id] = {
        claimId: id,
        landscapePosition: 'floor',
        isMinority: false,
        routingMeasurements: null,
        dominatedParagraphCount: 0,
        presenceMass: 0,
        territorialMass: 0,
        sovereignMass: 0,
        sovereignRatio: null,
        sustainedMass: 0,
        sustainedMassCohort: 'balanced',
        modelSpread: 0,
        modelsWithPassages: 0,
        isLoadBearing: null,
        dominantModel: null,
        concentrationRatio: 0,
        densityRatio: 0,
        maxPassageLength: 0,
        meanCoverageInLongestRun: 0,
        structuralContributors: [],
        incidentalMentions: [],
        ...(queryDistance !== undefined ? { queryDistance } : {}),
      };
      continue;
    }

    const activeCoverage = filterPeripheral
      ? profile.paragraphCoverage.filter((pc) => !periphery.peripheralNodeIds.has(pc.paragraphId))
      : profile.paragraphCoverage;

    // Per-model presence mass decomposition (replaces MAJ-count-based metrics)
    const presenceByModel = new Map<number, number>();
    const allModels = new Set<number>();
    for (const entry of activeCoverage) {
      allModels.add(entry.modelIndex);
      presenceByModel.set(
        entry.modelIndex,
        (presenceByModel.get(entry.modelIndex) ?? 0) + entry.coverage
      );
    }

    const structuralContributors: number[] = [];
    const incidentalMentions: number[] = [];
    for (const mi of allModels) {
      const hasMaj = activeCoverage.some((pc) => pc.modelIndex === mi && pc.coverage > 0.5);
      (hasMaj ? structuralContributors : incidentalMentions).push(mi);
    }

    let dominantModel: number | null = null;
    let dominantPresenceMass = 0;
    let totalPresenceMass = 0;
    for (const [mi, pm] of presenceByModel) {
      totalPresenceMass += pm;
      if (pm > dominantPresenceMass) {
        dominantPresenceMass = pm;
        dominantModel = mi;
      }
    }

    const concentrationRatio = totalPresenceMass > 0 ? dominantPresenceMass / totalPresenceMass : 0;

    let maxPassageLengthOfDominant = 0;
    for (const passage of profile.statementPassages) {
      if (passage.modelIndex === dominantModel && passage.statementLength > maxPassageLengthOfDominant)
        maxPassageLengthOfDominant = passage.statementLength;
    }

    claimProfiles[id] = {
      claimId: id,
      landscapePosition: 'floor',
      isMinority: false,
      routingMeasurements: null,
      dominatedParagraphCount: 0,
      presenceMass: 0,
      territorialMass: 0,
      sovereignMass: 0,
      sovereignRatio: null,
      sustainedMass: 0,
      sustainedMassCohort: 'balanced',
      modelSpread: profile.modelSpread,
      modelsWithPassages: profile.modelsWithPassages,
      isLoadBearing: null,
      dominantModel,
      concentrationRatio,
      densityRatio:
        dominantPresenceMass > 0 ? maxPassageLengthOfDominant / dominantPresenceMass : 0,
      maxPassageLength: profile.maxPassageLength,
      meanCoverageInLongestRun: profile.meanCoverageInLongestRun,
      structuralContributors,
      incidentalMentions,
      ...(queryDistance !== undefined ? { queryDistance } : {}),
    };
  }

  // ── 5-Phase Routing Algorithm ──

  // Phase 0: Precondition filtering and activeMajParagraphIds computation
  interface CandidateProfile extends PassageClaimProfile {
    activeMajParagraphIds: string[];
  }
  const candidates: CandidateProfile[] = [];

  for (const p of Object.values(claimProfiles)) {
    const profile = profiles[p.claimId];
    if (!profile) {
      p.landscapePosition = 'floor';
      p.routingMeasurements = null;
      continue;
    }

    // Derive majority paragraph IDs from the continuous coverage vector (coverage > 0.5)
    const activeMajIds = (
      filterPeripheral
        ? profile.paragraphCoverage.filter((pc) => !periphery.peripheralNodeIds.has(pc.paragraphId))
        : profile.paragraphCoverage
    )
      .filter((pc) => pc.coverage > 0.5)
      .map((pc) => pc.paragraphId);

    if (activeMajIds.length === 0) {
      p.landscapePosition = 'floor';
      p.routingMeasurements = null;
      continue;
    }

    candidates.push({
      ...(p as any),
      activeMajParagraphIds: activeMajIds,
    });
  }

  // Assign floor status to non-candidates
  const candidateIds = new Set(candidates.map((c) => c.claimId));
  for (const [id, p] of Object.entries(claimProfiles)) {
    if (!candidateIds.has(id)) {
      p.landscapePosition = 'floor';
      p.routingMeasurements = null;
    }
  }

  if (candidates.length === 0) {
    // All claims are floor
    let floorCount = 0;
    for (const p of Object.values(claimProfiles)) {
      if (p.landscapePosition === 'floor') floorCount++;
    }

    const passageRoutingResult: PassageRoutingResult = {
      claimProfiles,
      gate: {
        muConcentration: 0,
        sigmaConcentration: 0,
        concentrationThreshold: 0,
        preconditionPassCount: 0,
        loadBearingCount: 0,
      },
      routing: {
        conflictClusters: [],
        loadBearingClaims: [],
        passthrough: enrichedClaims.map((c) => String(c.id)),
        routedClaimIds: [],
        diagnostics: {
          concentrationDistribution: [],
          densityRatioDistribution: [],
          totalClaims: enrichedClaims.length,
          floorCount,
          corpusMode: periphery.corpusMode,
          peripheralNodeIds: Array.from(periphery.peripheralNodeIds),
          peripheralRatio: periphery.peripheralRatio,
          largestBasinRatio: periphery.largestBasinRatio,
        },
      },
      meta: { processingTimeMs: performance.now() - t0 },
    };

    return {
      passageRoutingResult,
      blastSurfaceResult: (() => {
        const twinMap = computeTwinMap(enrichedClaims, canonicalSets, statementEmbeddings);
        return {
          scores: enrichedClaims.map((claim) => ({
            claimId: String(claim.id),
            claimLabel: (claim as any).label ?? String(claim.id),
            layerC: { canonicalCount: 0, nonExclusiveCount: 0, twinCount: 0, orphanCount: 0 },
          })),
          twinMap,
          meta: { totalCorpusStatements, processingTimeMs: performance.now() - t0 },
        };
      })(),
    };
  }

  // ── Block C: Pre-phase compute over candidates

  // Compute paragraphToAllClaims: any presence (not just MAJ)
  const paragraphToAllClaims = new Map<string, Set<string>>();
  for (const c of candidates) {
    const profile = profiles[c.claimId];
    if (!profile) continue;
    const activeCoverage = filterPeripheral
      ? profile.paragraphCoverage.filter((pc) => !periphery.peripheralNodeIds.has(pc.paragraphId))
      : profile.paragraphCoverage;
    for (const entry of activeCoverage) {
      if (!paragraphToAllClaims.has(entry.paragraphId)) {
        paragraphToAllClaims.set(entry.paragraphId, new Set());
      }
      paragraphToAllClaims.get(entry.paragraphId)!.add(c.claimId);
    }
  }

  // Compute totalCorpusParagraphs: the total deduplicated paragraph pool across all candidates
  const totalCorpusParagraphs = new Set(
    candidates.flatMap((c) => {
      const profile = profiles[c.claimId];
      if (!profile) return [];
      const activeCoverage = filterPeripheral
        ? profile.paragraphCoverage.filter((pc) => !periphery.peripheralNodeIds.has(pc.paragraphId))
        : profile.paragraphCoverage;
      return activeCoverage.map((pc) => pc.paragraphId);
    })
  ).size;

  // Compute maxSupporterCount from enrichedClaims
  let maxSupporterCount = 0;
  const supportersById = new Map<string, any[]>();
  for (const claim of enrichedClaims) {
    const id = String(claim.id);
    const supporters = Array.isArray((claim as any).supporters) ? (claim as any).supporters : [];
    supportersById.set(id, supporters);
    if (supporters.length > maxSupporterCount) {
      maxSupporterCount = supporters.length;
    }
  }

  // Extended candidate interface with computed fields
  interface ExtendedCandidate extends CandidateProfile {
    /** Continuous ratio: territorialMass / (presenceMass - sovereignMass). Null when denominator is 0. */
    contestedDominance: number | null;
    presenceMass: number;
    territorialMass: number;
    sovereignMass: number;
    /** Derived: sovereignMass / presenceMass. Null when presenceMass = 0. */
    sovereignRatio: number | null;
    sustainedMass: number;
    sustainedMassCohort: 'passage-heavy' | 'balanced' | 'maj-breadth';
    allParagraphIds: Set<string>;
    supporters: any[];
  }

  // Per-candidate static field computation
  const extendedCandidates: ExtendedCandidate[] = [];

  // Hoisted: O(1) lookup of statementId set per paragraph (replaces O(n) .find per statement)
  const paragraphStatementSets = new Map<string, Set<string>>();
  for (const para of shadowParagraphs) {
    paragraphStatementSets.set(para.id, new Set(para.statementIds));
  }

  // Hoisted: k per statement — how many claims share each canonical statement.
  // Used by territorial mass (fractional-credit) computation.
  const statementOwnerCount = new Map<string, number>();
  for (const stmtSet of canonicalSets.values()) {
    for (const sid of stmtSet) {
      statementOwnerCount.set(sid, (statementOwnerCount.get(sid) ?? 0) + 1);
    }
  }

  // Hoisted: precompute active-major paragraph IDs per claim (presence vector @ 0.5)
  const activeMajByClaimId = new Map<string, string[]>();
  for (const c2 of candidates) {
    const profile = profiles[c2.claimId];
    if (!profile) {
      activeMajByClaimId.set(c2.claimId, []);
      continue;
    }
    const activeCoverageForClaim = filterPeripheral
      ? profile.paragraphCoverage.filter((pc) => !periphery.peripheralNodeIds.has(pc.paragraphId))
      : profile.paragraphCoverage;
    const majIdsForClaim = activeCoverageForClaim
      .filter((pc) => pc.coverage > 0.5)
      .map((pc) => pc.paragraphId);
    activeMajByClaimId.set(c2.claimId, majIdsForClaim);
  }

  const getMaj = (claimId: string) => activeMajByClaimId.get(claimId) ?? [];

  // Hoisted: percentile inputs sorted once, ascending. Used for normMAXLEN / normPresenceMass.
  const sortedMaxLen = candidates
    .map((c2) => profiles[c2.claimId]?.maxPassageLength ?? 0)
    .sort((a, b) => a - b);
  // presenceMass replaces MAJ count as the breadth signal in sustainedMass.
  const sortedPresenceMass = candidates
    .map((c2) => profiles[c2.claimId]?.presenceMass ?? 0)
    .sort((a, b) => a - b);

  for (const c of candidates) {
    const profile = profiles[c.claimId];
    if (!profile) continue;
    const derivedActiveMajIds = getMaj(c.claimId);

    // dominatedParagraphCount: MAJ paragraphs where ≥1 other claim has ANY presence
    let dominatedCount = 0;
    for (const pid of derivedActiveMajIds) {
      const claimsInPara = paragraphToAllClaims.get(pid) ?? new Set();
      if (claimsInPara.size > 1) dominatedCount++;
    }

    // Single-pass triple mass computation:
    //   presenceMass  = Σ(claimStmts/paraTotal)           — raw presence volume
    //   territorialMass = Σ(Σ(1/k)/paraTotal)             — fractional-credit exclusivity
    //   sovereignMass = Σ(exclusiveStmts/paraTotal)        — sole-holder only
    // Invariant: sovereignMass ≤ territorialMass ≤ presenceMass
    const activeCoverage = filterPeripheral
      ? profile.paragraphCoverage.filter((pc) => !periphery.peripheralNodeIds.has(pc.paragraphId))
      : profile.paragraphCoverage;

    const claimAllIds = canonicalSets.get(c.claimId) ?? new Set<string>();
    const claimExclusiveSet = new Set(exclusiveIds.get(c.claimId) ?? []);
    let presenceMass = 0;
    let territorialMass = 0;
    let sovereignMass = 0;
    const allParaSet = new Set<string>();
    for (const entry of activeCoverage) {
      allParaSet.add(entry.paragraphId);
      presenceMass += entry.coverage;
      if (entry.totalStatements === 0) continue;
      const stmtSet = paragraphStatementSets.get(entry.paragraphId);
      if (!stmtSet) continue;
      let exclusiveCount = 0;
      let fractionalSum = 0;
      for (const sid of claimAllIds) {
        if (!stmtSet.has(sid)) continue;
        if (claimExclusiveSet.has(sid)) {
          exclusiveCount++;
          fractionalSum += 1;
        } else {
          fractionalSum += 1 / (statementOwnerCount.get(sid) ?? 1);
        }
      }
      sovereignMass += exclusiveCount / entry.totalStatements;
      territorialMass += fractionalSum / entry.totalStatements;
    }

    // sustainedMass cohort computation: percentile ranks for MAXLEN and presenceMass.
    // presenceMass replaces the old MAJ-paragraph-count breadth signal — it is a
    // continuous analog that does not require a 0.5 threshold.
    const MAXLEN = profile.maxPassageLength;

    const normMAXLEN = percentileFromSortedAsc(MAXLEN, sortedMaxLen);
    const normPresenceMass = percentileFromSortedAsc(presenceMass, sortedPresenceMass);
    const sustainedMass = Math.sqrt(normMAXLEN * normPresenceMass);

    // Cohort assignment: passage-heavy ↔ depth-dominant, maj-breadth ↔ breadth-dominant.
    // Semantics unchanged; only the breadth axis is now presenceMass not MAJ count.
    let sustainedMassCohort: 'passage-heavy' | 'balanced' | 'maj-breadth';
    if (normMAXLEN >= 2 / 3 && normPresenceMass < 1 / 3) {
      sustainedMassCohort = 'passage-heavy';
    } else if (normPresenceMass >= 2 / 3 && normMAXLEN < 1 / 3) {
      sustainedMassCohort = 'maj-breadth';
    } else {
      sustainedMassCohort = 'balanced';
    }

    // Continuous contestedDominance (Part 1B):
    //   territorialMass / (presenceMass - sovereignMass)
    // Measures the yield rate of fractional exclusivity credit relative to shared territory.
    // Null when the denominator is 0 (fully sovereign claim or empty presence).
    const sharedPresence = presenceMass - sovereignMass;
    const contestedDominance: number | null = sharedPresence > 0 ? territorialMass / sharedPresence : null;

    // Derived: sovereignRatio = sovereignMass / presenceMass
    const sovereignRatio: number | null = presenceMass > 0 ? sovereignMass / presenceMass : null;

    // Build extended candidate
    const extCand: ExtendedCandidate = {
      ...(c as any),
      contestedDominance,
      presenceMass,
      territorialMass,
      sovereignMass,
      sovereignRatio,
      sustainedMass,
      sustainedMassCohort,
      allParagraphIds: allParaSet,
      supporters: supportersById.get(c.claimId) ?? [],
    };

    extendedCandidates.push(extCand);

    // Persist static fields on claimProfiles
    claimProfiles[c.claimId].dominatedParagraphCount = dominatedCount;
    claimProfiles[c.claimId].presenceMass = presenceMass;
    claimProfiles[c.claimId].territorialMass = territorialMass;
    claimProfiles[c.claimId].sovereignMass = sovereignMass;
    claimProfiles[c.claimId].sovereignRatio = sovereignRatio;
    claimProfiles[c.claimId].sustainedMass = sustainedMass;
    claimProfiles[c.claimId].sustainedMassCohort = sustainedMassCohort;
  }

  // ── Block D: Phase 1 — Minority classification
  for (const c of extendedCandidates) {
    c.isMinority = c.supporters.length < maxSupporterCount / 2;
  }

  // ── Block E: Phase 2 — Minority ranking

  const minorityPool: ExtendedCandidate[] = extendedCandidates.filter((c) => c.isMinority);

  // Stage 1: Group by cohort
  const byCohort = new Map<string, ExtendedCandidate[]>();
  for (const cohort of ['maj-breadth', 'balanced', 'passage-heavy']) {
    byCohort.set(
      cohort,
      minorityPool.filter((c) => c.sustainedMassCohort === cohort)
    );
  }

  // Stage 2: Within each cohort, seed-sort by MAXLEN DESC, then MAJ DESC
  for (const cohortClaims of byCohort.values()) {
    cohortClaims.sort((a, b) => {
      const maxLenDiff =
        (profiles[b.claimId]?.maxPassageLength ?? 0) - (profiles[a.claimId]?.maxPassageLength ?? 0);
      if (maxLenDiff !== 0) return maxLenDiff;
      // presenceMass replaces MAJ count as breadth tiebreaker
      return (profiles[b.claimId]?.presenceMass ?? 0) - (profiles[a.claimId]?.presenceMass ?? 0);
    });
  }

  // Stage 3 & 4: Apply 2×2 competition and modelSpread tiebreaker
  const sortedMinorityPool: ExtendedCandidate[] = [];
  const cohortOrder = ['maj-breadth', 'balanced', 'passage-heavy'];

  // Precompute priority bucket per minority claim once. Sort percentile inputs once
  // (O(m log m)) and reuse the sorted arrays across all m percentile lookups (O(m log m)
  // total via findIndex, vs the previous O(m² log m) when each comparator call re-sorted).
  // contestedDominance is now number|null; treat null as 0 for percentile ranking
  const sortedContested = minorityPool
    .map((c) => c.contestedDominance ?? 0)
    .sort((a, b) => a - b);
  const sortedExclusivity = minorityPool.map((c) => c.sovereignMass).sort((a, b) => a - b);
  const bucketByClaim = new Map<string, number>();
  for (const c of minorityPool) {
    const contestedPerc = percentileFromSortedAsc(c.contestedDominance ?? 0, sortedContested);
    const exclusivityPerc = percentileFromSortedAsc(c.sovereignMass, sortedExclusivity);
    const highC = contestedPerc >= 0.5;
    const highE = exclusivityPerc >= 0.5;
    const bucket = highC && highE ? 1 : !highC && highE ? 2 : highC && !highE ? 3 : 4;
    bucketByClaim.set(c.claimId, bucket);
  }

  for (const cohortName of cohortOrder) {
    const cohortClaims = byCohort.get(cohortName) ?? [];

    const survivingClaims = cohortClaims.filter((c) => bucketByClaim.get(c.claimId) !== 4);
    const flooredClaims = cohortClaims.filter((c) => bucketByClaim.get(c.claimId) === 4);

    for (const c of flooredClaims) {
      c.landscapePosition = 'floor';
      c.routingMeasurements = null;
    }

    // Sort by priority bucket -> contestedDominance DESC -> sovereignMass DESC -> supporters.length DESC
    // contestedDominance is number|null; null treated as 0 for ordering.
    survivingClaims.sort((a, b) => {
      const bucketA = bucketByClaim.get(a.claimId) ?? 4;
      const bucketB = bucketByClaim.get(b.claimId) ?? 4;
      if (bucketA !== bucketB) return bucketA - bucketB;

      const contDiff = (b.contestedDominance ?? 0) - (a.contestedDominance ?? 0);
      if (contDiff !== 0) return contDiff;

      const exclDiff = b.sovereignMass - a.sovereignMass;
      if (exclDiff !== 0) return exclDiff;

      return b.supporters.length - a.supporters.length;
    });

    sortedMinorityPool.push(...survivingClaims);
  }

  // ── Block F: Phase 3 — Minority peeling
  const assignedSet = new Set<string>();
  for (let i = 0; i < sortedMinorityPool.length; i++) {
    const c = sortedMinorityPool[i];
    const maj = getMaj(c.claimId);
    const novelIds = maj.filter((pid) => !assignedSet.has(pid));
    c.landscapePosition = i === 0 ? 'leadMinority' : 'mechanism';

    const claimNoveltyRatio = maj.length > 0 ? novelIds.length / maj.length : 0;
    const corpusNoveltyRatio =
      totalCorpusParagraphs - assignedSet.size > 0
        ? novelIds.length / (totalCorpusParagraphs - assignedSet.size)
        : 0;

    c.routingMeasurements = {
      contestedDominance: c.contestedDominance,
      presenceMass: c.presenceMass,
      territorialMass: c.territorialMass,
      sovereignMass: c.sovereignMass,
      sovereignRatio: c.sovereignRatio,
      sustainedMassCohort: c.sustainedMassCohort,
      modelSpread: c.modelSpread,
      claimNoveltyRatio,
      corpusNoveltyRatio,
      novelParagraphCount: novelIds.length,
      majorityGateSnapshot: null,
    };

    for (const pid of maj) {
      assignedSet.add(pid);
    }
  }

  // ── Block G: Phase 4 — Majority mechanism assignment

  const majorityPool = extendedCandidates.filter(
    (c) => !c.isMinority && getMaj(c.claimId).length > 0
  );

  // Extract NorthStar before cohort sorting: largest by sustainedMass overall
  let northStarCandidate: ExtendedCandidate | null = null;
  if (majorityPool.length > 0) {
    let maxMass = -1;
    let nsIndex = -1;
    for (let i = 0; i < majorityPool.length; i++) {
      if (majorityPool[i].sustainedMass > maxMass) {
        maxMass = majorityPool[i].sustainedMass;
        nsIndex = i;
      }
    }
    northStarCandidate = majorityPool.splice(nsIndex, 1)[0];
  }

  // Sort remaining majority candidates by cohort (maj-breadth → balanced → passage-heavy)
  const sortedMajorityPool: ExtendedCandidate[] = [];
  const majorityCohortOrder = ['maj-breadth', 'balanced', 'passage-heavy'];

  for (const cohortName of majorityCohortOrder) {
    const cohortClaims = majorityPool.filter((c) => c.sustainedMassCohort === cohortName);

    // Inside cohorts, tiebreakers: inverted supporter count (ASC), exclusivity (DESC)
    cohortClaims.sort((a, b) => {
      if (a.supporters.length !== b.supporters.length)
        return a.supporters.length - b.supporters.length;
      if (b.sovereignMass !== a.sovereignMass) return b.sovereignMass - a.sovereignMass;

      const maxLenDiff =
        (profiles[b.claimId]?.maxPassageLength ?? 0) - (profiles[a.claimId]?.maxPassageLength ?? 0);
      if (maxLenDiff !== 0) return maxLenDiff;

      // presenceMass replaces MAJ count as final breadth tiebreaker
      return (profiles[b.claimId]?.presenceMass ?? 0) - (profiles[a.claimId]?.presenceMass ?? 0);
    });

    sortedMajorityPool.push(...cohortClaims);
  }

  // Iterate remaining majority candidates
  for (let i = 0; i < sortedMajorityPool.length; i++) {
    const c = sortedMajorityPool[i];
    const maj = getMaj(c.claimId);
    const nsIds = northStarCandidate ? getMaj(northStarCandidate.claimId) : [];
    const currentNSNovel = nsIds.filter((pid) => !assignedSet.has(pid)).length;
    const projectedNSNovel = nsIds.filter(
      (pid) => !assignedSet.has(pid) && !maj.includes(pid)
    ).length;
    const delta = currentNSNovel - projectedNSNovel;
    const candidateContribution = maj.filter((pid) => !assignedSet.has(pid)).length;

    if (candidateContribution === 0) {
      c.landscapePosition = 'floor';
      c.routingMeasurements = null;
      continue;
    }

    if (delta > candidateContribution) {
      // Floor remaining candidates
      for (let j = i; j < sortedMajorityPool.length; j++) {
        const remaining = sortedMajorityPool[j];
        remaining.landscapePosition = 'floor';
        remaining.routingMeasurements = null;
      }
      break;
    }

    c.landscapePosition = 'mechanism';

    // c.routingMeasurements already has contestedDominance
    c.routingMeasurements = {
      contestedDominance: c.contestedDominance,
      presenceMass: c.presenceMass,
      territorialMass: c.territorialMass,
      sovereignMass: c.sovereignMass,
      sovereignRatio: c.sovereignRatio,
      sustainedMassCohort: c.sustainedMassCohort,
      modelSpread: c.modelSpread,
      claimNoveltyRatio: maj.length > 0 ? candidateContribution / maj.length : 0,
      corpusNoveltyRatio:
        totalCorpusParagraphs - assignedSet.size > 0
          ? candidateContribution / (totalCorpusParagraphs - assignedSet.size)
          : 0,
      novelParagraphCount: candidateContribution,
      majorityGateSnapshot: { delta, currentNSNovel, projectedNSNovel, candidateContribution },
    };

    for (const pid of maj) {
      assignedSet.add(pid);
    }
  }

  // ── Block H: Phase 5 — NorthStar
  if (northStarCandidate) {
    northStarCandidate.landscapePosition = 'northStar';
    const nsMaj = getMaj(northStarCandidate.claimId);
    const nsNovel = nsMaj.filter((pid) => !assignedSet.has(pid)).length;
    const nsTotal = nsMaj.length;

    // northStarCandidate.routingMeasurements already has contestedDominance
    northStarCandidate.routingMeasurements = {
      contestedDominance: northStarCandidate.contestedDominance,
      presenceMass: northStarCandidate.presenceMass,
      territorialMass: northStarCandidate.territorialMass,
      sovereignMass: northStarCandidate.sovereignMass,
      sovereignRatio: northStarCandidate.sovereignRatio,
      sustainedMassCohort: northStarCandidate.sustainedMassCohort,
      modelSpread: northStarCandidate.modelSpread,
      claimNoveltyRatio: nsTotal > 0 ? nsNovel / nsTotal : 0,
      corpusNoveltyRatio:
        totalCorpusParagraphs - assignedSet.size > 0
          ? nsNovel / (totalCorpusParagraphs - assignedSet.size)
          : 0,
      novelParagraphCount: nsNovel,
      majorityGateSnapshot: null,
    };

    for (const pid of nsMaj) {
      assignedSet.add(pid);
    }
  }

  // ── Block I: Phase 6 — Floor (defensive sweep)
  for (const c of extendedCandidates) {
    if (!c.landscapePosition || c.landscapePosition === 'floor') {
      c.landscapePosition = 'floor';
      c.routingMeasurements = null;
    }
  }

  // Update claimProfiles with routing results from extended candidates
  for (const c of extendedCandidates) {
    const id = c.claimId;
    if (claimProfiles[id]) {
      claimProfiles[id].landscapePosition = c.landscapePosition;
      claimProfiles[id].isMinority = c.isMinority;
      claimProfiles[id].routingMeasurements = c.routingMeasurements;
    }
  }

  // Instrumentation: compute concentration threshold for gate diagnostics
  const preconditionPass = candidates;
  const concentrationValues = preconditionPass.map((p) => p.concentrationRatio);
  const muConcentration = mean(concentrationValues);
  const sigmaConcentration = sigma(concentrationValues, muConcentration);
  const concentrationThreshold = muConcentration + sigmaConcentration;

  let loadBearingCount = 0;
  for (const p of Object.values(claimProfiles)) {
    if (p.landscapePosition !== 'floor') loadBearingCount++;
  }

  // Conflict clusters
  const routingConflictEdges = validatedConflicts.filter(
    (c) => c.validated && c.mapperLabeledConflict
  );
  const conflictClusters: PassageClaimRouting['conflictClusters'] = [];
  const claimsInRoutedConflict = new Set<string>();

  if (routingConflictEdges.length > 0) {
    const adj = new Map<string, Set<string>>();
    for (const e of routingConflictEdges) {
      if (!adj.has(e.edgeFrom)) adj.set(e.edgeFrom, new Set());
      if (!adj.has(e.edgeTo)) adj.set(e.edgeTo, new Set());
      adj.get(e.edgeFrom)!.add(e.edgeTo);
      adj.get(e.edgeTo)!.add(e.edgeFrom);
    }
    const visited = new Set<string>();
    for (const node of adj.keys()) {
      if (visited.has(node)) continue;
      const component: string[] = [];
      const stack = [node];
      visited.add(node);
      while (stack.length > 0) {
        const cur = stack.pop()!;
        component.push(cur);
        for (const n of adj.get(cur) ?? []) {
          if (!visited.has(n)) {
            visited.add(n);
            stack.push(n);
          }
        }
      }
      conflictClusters.push({
        claimIds: component,
        edges: routingConflictEdges
          .filter((e) => component.includes(e.edgeFrom) && component.includes(e.edgeTo))
          .map((e) => ({
            from: e.edgeFrom,
            to: e.edgeTo,
            crossPoolProximity: e.crossPoolProximity,
          })),
      });
      for (const id of component) claimsInRoutedConflict.add(id);
    }
  }

  // Routing assembly — landscape position is the single source of truth (floor = passthrough)
  const claimMap = new Map<string, EnrichedClaim>();
  for (const c of enrichedClaims) claimMap.set(String(c.id), c);

  // Define priority order for sorting (not for routing — routing is determined by landscapePosition)
  const priorityOrder: Record<string, number> = {
    northStar: 0,
    leadMinority: 1,
    mechanism: 2,
    floor: 3,
  };

  const loadBearingClaims: PassageRoutedClaim[] = Object.values(claimProfiles)
    .filter((p) => p.landscapePosition !== 'floor' && !claimsInRoutedConflict.has(p.claimId))
    .sort((a, b) => {
      const priorityDiff =
        (priorityOrder[a.landscapePosition] ?? 99) - (priorityOrder[b.landscapePosition] ?? 99);
      if (priorityDiff !== 0) return priorityDiff;
      return b.concentrationRatio - a.concentrationRatio;
    })
    .map((p) => {
      const c = claimMap.get(p.claimId);
      return {
        claimId: p.claimId,
        claimLabel: String((c as any)?.label ?? p.claimId),
        claimText: String((c as any)?.text ?? ''),
        landscapePosition: p.landscapePosition,
        concentrationRatio: p.concentrationRatio,
        densityRatio: p.densityRatio,
        meanCoverageInLongestRun: p.meanCoverageInLongestRun,
        dominantModel: p.dominantModel,
        structuralContributors: p.structuralContributors,
        supporters: Array.isArray((c as any)?.supporters) ? (c as any).supporters : [],
        ...(p.queryDistance !== undefined ? { queryDistance: p.queryDistance } : {}),
      };
    });

  const routedClaimIds = [...claimsInRoutedConflict, ...loadBearingClaims.map((c) => c.claimId)];
  const routedSet = new Set(routedClaimIds);
  // Passthrough is exactly the floor claims (not routed in conflict, not load-bearing)
  const passthroughClaims = enrichedClaims
    .map((c) => String(c.id))
    .filter((id) => claimProfiles[id]?.landscapePosition === 'floor' && !routedSet.has(id));

  const routing: PassageClaimRouting = {
    conflictClusters,
    loadBearingClaims,
    passthrough: passthroughClaims,
    routedClaimIds,
    diagnostics: {
      concentrationDistribution: Object.values(claimProfiles).map((p) => p.concentrationRatio),
      densityRatioDistribution: Object.values(claimProfiles).map((p) => p.densityRatio),
      totalClaims: enrichedClaims.length,
      floorCount: Object.values(claimProfiles).filter((p) => p.landscapePosition === 'floor')
        .length,
      corpusMode: periphery.corpusMode,
      peripheralNodeIds: Array.from(periphery.peripheralNodeIds),
      peripheralRatio: periphery.peripheralRatio,
      largestBasinRatio: periphery.largestBasinRatio,
    },
  };

  const basinAnnotations =
    periphery.corpusMode === 'parallel-cores' ? periphery.basinByNodeId : undefined;

  const passageRoutingResult: PassageRoutingResult = {
    claimProfiles,
    gate: {
      muConcentration,
      sigmaConcentration,
      concentrationThreshold,
      preconditionPassCount: preconditionPass.length,
      loadBearingCount,
    },
    routing,
    ...(basinAnnotations ? { basinAnnotations } : {}),
    meta: { processingTimeMs: performance.now() - t0 },
  };

  // ── Block 2: Blast Surface (Statement Fragility) ──────────────────────────

  const twinMap = computeTwinMap(enrichedClaims, canonicalSets, statementEmbeddings);

  const conflictClaimIds = new Set<string>(
    validatedConflicts.flatMap((c) => [c.edgeFrom, c.edgeTo])
  );
  const safeClaimIds = new Set<string>();
  for (const claim of enrichedClaims) {
    if (!conflictClaimIds.has(claim.id) && ((claim as any).supportRatio ?? 0) > 0.5)
      safeClaimIds.add(claim.id);
  }

  const blastScores: BlastSurfaceClaimScore[] = [];

  for (const claim of enrichedClaims) {
    const id = String(claim.id);
    const claimLabel = (claim as any).label ?? id;
    const canonicalSet = canonicalSets.get(id) ?? new Set<string>();
    const claimExclusive = exclusiveIds.get(id) ?? [];

    const deletionIds: string[] = [];
    const degradationIds: string[] = [];
    const deletionCertaintyDetails: Array<{
      statementId: string;
      twinId: string;
      twinSimilarity: number;
      certainty: '2a' | '2b' | '2c';
      twinHostClaimId: string | null;
    }> = [];
    const degradationDetails: Array<{
      statementId: string;
      originalWordCount: number;
      survivingWordCount: number;
      nounSurvivalRatio: number;
      cost: number;
    }> = [];
    let deletionDamage = 0;
    let degradationDamage = 0;

    for (const sid of claimExclusive) {
      if (sid.startsWith('tc_')) continue;
      const twin = twinMap.perClaim[id]?.[sid] ?? null;
      if (twin) {
        deletionIds.push(sid);
        deletionDamage += 1 - twin.similarity;
        const twinId = twin.twinStatementId;
        let certainty: '2a' | '2b' | '2c';
        let hostClaim: string | null;
        if (!allClaimOwnedIds.has(twinId)) {
          certainty = '2a';
          hostClaim = null;
        } else {
          hostClaim = findHostClaim(twinId, canonicalSets);
          certainty = (canonicalOwnerCounts.get(twinId) ?? 0) <= 1 ? '2c' : '2b';
        }
        deletionCertaintyDetails.push({
          statementId: sid,
          twinId,
          twinSimilarity: twin.similarity,
          certainty,
          twinHostClaimId: hostClaim,
        });
      } else {
        degradationIds.push(sid);
        const text = statementTexts?.get(sid) ?? '';
        const nounRatio = computeNounSurvivalRatio(text);
        const words = text
          .replace(/[*_#|>]/g, '')
          .trim()
          .split(/\s+/)
          .filter((w) => w.length > 0);
        const originalWordCount = words.length;
        degradationDamage += 1 - nounRatio;
        degradationDetails.push({
          statementId: sid,
          originalWordCount,
          survivingWordCount: Math.round(nounRatio * originalWordCount),
          nounSurvivalRatio: nounRatio,
          cost: 1 - nounRatio,
        });
      }
    }

    const type1Count = canonicalSet.size - claimExclusive.length;
    const type2Count = deletionIds.length;
    const type3Count = degradationIds.length;
    const K = canonicalSet.size;

    const cascadeFragilityDetails: Array<{
      statementId: string;
      parentCount: number;
      fragility: number;
    }> = [];
    let cascadeFragilitySum = 0;
    for (const sid of canonicalSet) {
      const ownerCount = canonicalOwnerCounts.get(sid) ?? 0;
      if (ownerCount >= 2) {
        const fragility = 1 / (ownerCount - 1);
        cascadeFragilityDetails.push({ statementId: sid, parentCount: ownerCount, fragility });
        cascadeFragilitySum += fragility;
      }
    }
    const fragValues = cascadeFragilityDetails.map((d) => d.fragility);
    const cascadeFragilityMu = mean(fragValues);
    const cascadeFragilitySigma =
      fragValues.length > 0
        ? Math.sqrt(
            fragValues.reduce((s, v) => s + (v - cascadeFragilityMu) ** 2, 0) / fragValues.length
          )
        : 0;

    let count2a = 0,
      count2b = 0,
      count2c = 0;
    for (const d of deletionCertaintyDetails) {
      if (d.certainty === '2a') count2a++;
      else if (d.certainty === '2b') count2b++;
      else count2c++;
    }

    // Reframe degradationDamage: compute over ALL canonical statements (not just Type 3 orphans).
    // This makes it a per-claim referential density signal applicable to any statement subset.
    let totalDegradationDamage = 0;
    const allDegradationDetails: Array<{
      statementId: string;
      originalWordCount: number;
      survivingWordCount: number;
      nounSurvivalRatio: number;
      cost: number;
    }> = [];
    for (const sid of canonicalSet) {
      if (sid.startsWith('tc_')) continue;
      const text = statementTexts?.get(sid) ?? '';
      const nounRatio = computeNounSurvivalRatio(text);
      const words = text.replace(/[*_#|>]/g, '').trim().split(/\s+/).filter((w) => w.length > 0);
      const originalWordCount = words.length;
      totalDegradationDamage += 1 - nounRatio;
      allDegradationDetails.push({
        statementId: sid,
        originalWordCount,
        survivingWordCount: Math.round(nounRatio * originalWordCount),
        nounSurvivalRatio: nounRatio,
        cost: 1 - nounRatio,
      });
    }

    const riskVector: BlastSurfaceRiskVector = {
      twinCount: type2Count,
      twinStatementIds: deletionIds,
      orphanCount: type3Count,
      orphanStatementIds: degradationIds,
      cascadeFragility: cascadeFragilitySum,
      cascadeFragilityDetails,
      cascadeFragilityMu,
      cascadeFragilitySigma,
      simplex: [K > 0 ? type1Count / K : 0, K > 0 ? type2Count / K : 0, K > 0 ? type3Count / K : 0],
      degradationDamage: totalDegradationDamage,
      degradationDetails: allDegradationDetails,
      deletionCertainty: {
        unconditional: count2a,
        conditional: count2b,
        fragile: count2c,
        details: deletionCertaintyDetails,
      },
    };

    blastScores.push({
      claimId: id,
      claimLabel,
      layerC: {
        canonicalCount: K,
        nonExclusiveCount: type1Count,
        twinCount: type2Count,
        orphanCount: type3Count,
      },
      riskVector,
      mixedResolution: speculativeMixedResolution(
        id,
        canonicalSets,
        canonicalOwnerCounts,
        twinMap.perClaim,
        allClaimOwnedIds,
        safeClaimIds
      ),
    });
  }

  return {
    passageRoutingResult,
    blastSurfaceResult: {
      scores: blastScores,
      twinMap,
      meta: { totalCorpusStatements, processingTimeMs: performance.now() - t0 },
    },
  };
}

// ── Source continuity (consumed by editorial-mapper and step-executor) ────────

export interface SourceContinuityEntry {
  passageKey: string;
  modelIndex: number;
  claimId: string;
  startParagraphIndex: number;
  endParagraphIndex: number;
  prevPassageKey: string | null;
  nextPassageKey: string | null;
}

export function buildSourceContinuityMap(
  claimDensity: ClaimDensityResult
): Map<string, SourceContinuityEntry> {
  const result = new Map<string, SourceContinuityEntry>();
  const byModel = new Map<
    number,
    Array<{ passageKey: string; claimId: string; entry: StatementPassageEntry }>
  >();

  for (const [claimId, profile] of Object.entries(claimDensity.profiles)) {
    for (const p of profile.statementPassages) {
      const key = `${claimId}:${p.modelIndex}:${p.startParagraphIndex}`;
      const list = byModel.get(p.modelIndex) ?? [];
      list.push({ passageKey: key, claimId, entry: p });
      byModel.set(p.modelIndex, list);
    }
  }

  for (const [, passages] of byModel) {
    passages.sort((a, b) => a.entry.startParagraphIndex - b.entry.startParagraphIndex);
    for (let i = 0; i < passages.length; i++) {
      const cur = passages[i];
      result.set(cur.passageKey, {
        passageKey: cur.passageKey,
        modelIndex: cur.entry.modelIndex,
        claimId: cur.claimId,
        startParagraphIndex: cur.entry.startParagraphIndex,
        endParagraphIndex: cur.entry.endParagraphIndex,
        prevPassageKey: i > 0 ? passages[i - 1].passageKey : null,
        nextPassageKey: i < passages.length - 1 ? passages[i + 1].passageKey : null,
      });
    }
  }

  return result;
}

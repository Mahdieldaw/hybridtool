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
  ClaimDensityProfile,
} from '../../shared/types';
import type { PeripheryResult } from '../geometry';
import type { ShadowParagraph } from '../shadow';
import {
  assertMeasurementConsumer,
  type MeasurementViolation,
} from '../../shared/measurement-registry';
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
  shadowParagraphs: ShadowParagraph[];
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

type MassEligibilityDiagnostic = PassageClaimRouting['diagnostics']['massEligibility'][number];
type ScalarMigrationDiagnostic = PassageClaimRouting['diagnostics']['scalarMigration'][number];

type SurfaceScalarMeasurements = {
  dominantModel: number | null;
  dominantPresenceShare: number | null;
  dominantPassageShare: number | null;
  maxStatementRun: number;
  legacyConcentrationRatio: number;
  legacyDensityRatio: number;
  legacyMeanCoverageInLongestRun: number;
};

function getFootprintPresenceParagraphIds(profile: ClaimDensityProfile | undefined): string[] {
  return (profile?.footprint?.vectors.presenceByParagraph ?? [])
    .filter((entry) => entry.value > 0)
    .map((entry) => entry.paragraphId);
}

function isFootprintEligible(profile: ClaimDensityProfile | undefined): boolean {
  return (profile?.footprint?.totals.presenceMass ?? 0) > 0;
}

function nullableScore(value: number | null): number {
  return value ?? Number.NEGATIVE_INFINITY;
}

function share(part: number, total: number): number | null {
  return total > 0 ? part / total : null;
}

function computeSurfaceScalarMeasurements(
  profile: ClaimDensityProfile,
  activeCoverage: ClaimDensityProfile['paragraphCoverage']
): SurfaceScalarMeasurements {
  const paragraphModel = new Map<string, number>();
  for (const coverage of profile.paragraphCoverage) {
    paragraphModel.set(coverage.paragraphId, coverage.modelIndex);
  }

  const presenceByModel = new Map<number, number>();
  for (const entry of profile.footprint.vectors.presenceByParagraph) {
    const modelIndex = paragraphModel.get(entry.paragraphId);
    if (modelIndex == null) continue;
    presenceByModel.set(modelIndex, (presenceByModel.get(modelIndex) ?? 0) + entry.value);
  }

  let dominantModel: number | null = null;
  let dominantPresenceMass = 0;
  for (const [modelIndex, mass] of presenceByModel) {
    if (mass > dominantPresenceMass) {
      dominantPresenceMass = mass;
      dominantModel = modelIndex;
    }
  }
  const dominantPresenceShare = share(
    dominantPresenceMass,
    profile.footprint.totals.presenceMass
  );

  const passageStatementMassByModel = new Map<number, number>();
  for (const passage of profile.statementPassages) {
    passageStatementMassByModel.set(
      passage.modelIndex,
      (passageStatementMassByModel.get(passage.modelIndex) ?? 0) + passage.statementLength
    );
  }
  let dominantPassageStatementMass = 0;
  let totalPassageStatementMass = 0;
  for (const mass of passageStatementMassByModel.values()) {
    totalPassageStatementMass += mass;
    if (mass > dominantPassageStatementMass) dominantPassageStatementMass = mass;
  }
  const dominantPassageShare = share(dominantPassageStatementMass, totalPassageStatementMass);
  const maxStatementRun = profile.maxPassageLength;

  const legacyPresenceByModel = new Map<number, number>();
  let legacyDominantModel: number | null = null;
  let legacyDominantPresenceMass = 0;
  let legacyTotalPresenceMass = 0;
  for (const entry of activeCoverage) {
    const next = (legacyPresenceByModel.get(entry.modelIndex) ?? 0) + entry.coverage;
    legacyPresenceByModel.set(entry.modelIndex, next);
  }
  for (const [modelIndex, mass] of legacyPresenceByModel) {
    legacyTotalPresenceMass += mass;
    if (mass > legacyDominantPresenceMass) {
      legacyDominantPresenceMass = mass;
      legacyDominantModel = modelIndex;
    }
  }
  const legacyConcentrationRatio =
    legacyTotalPresenceMass > 0 ? legacyDominantPresenceMass / legacyTotalPresenceMass : 0;

  let maxPassageLengthOfLegacyDominant = 0;
  for (const passage of profile.statementPassages) {
    if (
      passage.modelIndex === legacyDominantModel &&
      passage.statementLength > maxPassageLengthOfLegacyDominant
    ) {
      maxPassageLengthOfLegacyDominant = passage.statementLength;
    }
  }
  const legacyDensityRatio =
    legacyDominantPresenceMass > 0
      ? maxPassageLengthOfLegacyDominant / legacyDominantPresenceMass
      : 0;

  return {
    dominantModel,
    dominantPresenceShare,
    dominantPassageShare,
    maxStatementRun,
    legacyConcentrationRatio,
    legacyDensityRatio,
    legacyMeanCoverageInLongestRun: profile.meanCoverageInLongestRun,
  };
}

function buildScalarMigrationDiagnostic(
  claimId: string,
  scalars: SurfaceScalarMeasurements | null,
  legacyContestedDominance: number | null,
  contestedShareRatio: number | null
): ScalarMigrationDiagnostic {
  return {
    claimId,
    legacyContestedDominance,
    contestedShareRatio,
    legacyConcentrationRatio: scalars?.legacyConcentrationRatio ?? 0,
    dominantPresenceShare: scalars?.dominantPresenceShare ?? null,
    legacyDensityRatio: scalars?.legacyDensityRatio ?? 0,
    dominantPassageShare: scalars?.dominantPassageShare ?? null,
    legacyMeanCoverageInLongestRun: scalars?.legacyMeanCoverageInLongestRun ?? 0,
    maxStatementRun: scalars?.maxStatementRun ?? 0,
    legacyMinorityBucket: null,
    legacyWouldFloorByScalarBucket: null,
    newLandscapePosition: 'floor',
    changedRoutingOutcome: false,
    reason: null,
  };
}

function oldMajorityEligibleForDiagnostic(
  profile: ClaimDensityProfile | undefined,
  filterPeripheral: boolean,
  peripheralNodeIds: Set<string>
): boolean {
  if (!profile) return false;
  const activeCoverage = filterPeripheral
    ? profile.paragraphCoverage.filter((pc) => !peripheralNodeIds.has(pc.paragraphId))
    : profile.paragraphCoverage;
  return activeCoverage.some((pc) => pc.coverage > 0.5);
}

export function buildMassEligibilityDiagnostic(
  claimId: string,
  profile: ClaimDensityProfile | undefined,
  oldMajorityEligible: boolean
): MassEligibilityDiagnostic {
  const presenceMass = profile?.footprint?.totals.presenceMass ?? 0;
  const territorialMass = profile?.footprint?.totals.territorialMass ?? 0;
  const sovereignMass = profile?.footprint?.totals.sovereignMass ?? 0;
  const sovereignRatio = profile?.footprint?.derived.sovereignRatio ?? null;
  const contestedShareRatio = profile?.footprint?.derived.contestedShareRatio ?? null;
  const newFootprintEligible = presenceMass > 0;
  const changedEligibility = oldMajorityEligible !== newFootprintEligible;
  let reason: string | null = null;
  if (changedEligibility) {
    reason = newFootprintEligible
      ? 'canonical footprint exists but no paragraph passed the legacy majority threshold'
      : 'legacy majority threshold passed but canonical footprint has zero presence mass';
  }

  return {
    claimId,
    oldMajorityEligible,
    newFootprintEligible,
    presenceMass,
    territorialMass,
    sovereignMass,
    sovereignRatio,
    contestedShareRatio,
    changedEligibility,
    reason,
  };
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
  } = input;

  const profiles = claimDensityResult.profiles;
  const measurementGuardViolations: MeasurementViolation[] = [];
  const collectRoutingMeasurement = (key: string, context: string) => {
    assertMeasurementConsumer(key, 'routing', {
      mode: 'collect',
      context,
      collector: measurementGuardViolations,
    });
  };

  if (periphery.corpusMode === 'dominant-core' && periphery.peripheralNodeIds.size > 0) {
    collectRoutingMeasurement(
      'corpusMode',
      'computeTopologicalSurface peripheral filtering'
    );
    collectRoutingMeasurement(
      'peripheralNodeIds',
      'computeTopologicalSurface peripheral filtering'
    );
  }

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
  const scalarMigrationByClaimId = new Map<string, ScalarMigrationDiagnostic>();

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
        contestedShareRatio: null,
        sustainedMass: 0,
        sustainedMassCohort: 'balanced',
        modelSpread: 0,
        modelsWithPassages: 0,
        isLoadBearing: null,
        dominantModel: null,
        dominantPresenceShare: null,
        dominantPassageShare: null,
        maxStatementRun: 0,
        concentrationRatio: 0,
        densityRatio: 0,
        maxPassageLength: 0,
        meanCoverageInLongestRun: 0,
        structuralContributors: [],
        incidentalMentions: [],
        ...(queryDistance !== undefined ? { queryDistance } : {}),
      };
      scalarMigrationByClaimId.set(
        id,
        buildScalarMigrationDiagnostic(id, null, null, null)
      );
      continue;
    }

    const activeCoverage = filterPeripheral
      ? profile.paragraphCoverage.filter((pc) => !periphery.peripheralNodeIds.has(pc.paragraphId))
      : profile.paragraphCoverage;

    const scalars = computeSurfaceScalarMeasurements(profile, activeCoverage);

    const allModels = new Set<number>();
    for (const entry of activeCoverage) {
      allModels.add(entry.modelIndex);
    }

    const structuralContributors: number[] = [];
    const incidentalMentions: number[] = [];
    for (const mi of allModels) {
      // Legacy compatibility export only; Phase 2 routing decisions do not read this threshold.
      const legacyHasMajorityCoverage = activeCoverage.some(
        (pc) => pc.modelIndex === mi && pc.coverage > 0.5
      );
      (legacyHasMajorityCoverage ? structuralContributors : incidentalMentions).push(mi);
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
      contestedShareRatio: null,
      sustainedMass: 0,
      sustainedMassCohort: 'balanced',
      modelSpread: profile.modelSpread,
      modelsWithPassages: profile.modelsWithPassages,
      isLoadBearing: null,
      dominantModel: scalars.dominantModel,
      dominantPresenceShare: scalars.dominantPresenceShare,
      dominantPassageShare: scalars.dominantPassageShare,
      maxStatementRun: scalars.maxStatementRun,
      concentrationRatio: scalars.legacyConcentrationRatio,
      densityRatio: scalars.legacyDensityRatio,
      maxPassageLength: profile.maxPassageLength,
      meanCoverageInLongestRun: profile.meanCoverageInLongestRun,
      structuralContributors,
      incidentalMentions,
      ...(queryDistance !== undefined ? { queryDistance } : {}),
    };
    scalarMigrationByClaimId.set(
      id,
      buildScalarMigrationDiagnostic(
        id,
        scalars,
        null,
        profile.footprint.derived.contestedShareRatio
      )
    );
  }

  // ── 5-Phase Routing Algorithm ──

  const massEligibility = enrichedClaims.map((claim) => {
    const claimId = String(claim.id);
    return buildMassEligibilityDiagnostic(
      claimId,
      profiles[claimId],
      oldMajorityEligibleForDiagnostic(
        profiles[claimId],
        filterPeripheral,
        periphery.peripheralNodeIds
      )
    );
  });

  interface CandidateProfile extends PassageClaimProfile {
    footprintParagraphIds: string[];
  }
  const candidates: CandidateProfile[] = [];

  for (const p of Object.values(claimProfiles)) {
    const profile = profiles[p.claimId];
    if (!profile) {
      p.landscapePosition = 'floor';
      p.routingMeasurements = null;
      continue;
    }

    const footprintParagraphIds = getFootprintPresenceParagraphIds(profile);

    if (!isFootprintEligible(profile)) {
      p.landscapePosition = 'floor';
      p.routingMeasurements = null;
      continue;
    }

    candidates.push({
      ...(p as any),
      footprintParagraphIds,
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
          massEligibility,
          scalarMigration: Array.from(scalarMigrationByClaimId.values()),
          totalClaims: enrichedClaims.length,
          floorCount,
          corpusMode: periphery.corpusMode,
          peripheralNodeIds: Array.from(periphery.peripheralNodeIds),
          peripheralRatio: periphery.peripheralRatio,
          largestBasinRatio: periphery.largestBasinRatio,
          measurementGuardViolations,
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
    /** Canonical footprint.derived.contestedShareRatio. Null when denominator is 0. */
    contestedShareRatio: number | null;
    /** Legacy compatibility diagnostic. Not consumed by active routing after Phase 3. */
    contestedDominance: number | null;
    presenceMass: number;
    territorialMass: number;
    sovereignMass: number;
    /** Derived: sovereignMass / presenceMass. Null when presenceMass = 0. */
    sovereignRatio: number | null;
    sustainedMass: number;
    sustainedMassCohort: 'passage-heavy' | 'balanced' | 'maj-breadth';
    dominantPresenceShare: number | null;
    dominantPassageShare: number | null;
    maxStatementRun: number;
    allParagraphIds: Set<string>;
    supporters: any[];
  }

  // Per-candidate static field computation
  const extendedCandidates: ExtendedCandidate[] = [];

  // Hoisted: canonical footprint paragraph IDs per claim.
  const footprintParagraphsByClaimId = new Map<string, string[]>();
  for (const c2 of candidates) {
    const profile = profiles[c2.claimId];
    if (!profile) {
      footprintParagraphsByClaimId.set(c2.claimId, []);
      continue;
    }
    footprintParagraphsByClaimId.set(c2.claimId, getFootprintPresenceParagraphIds(profile));
  }

  const getFootprintParagraphs = (claimId: string) =>
    footprintParagraphsByClaimId.get(claimId) ?? [];

  // Hoisted: percentile inputs sorted once, ascending. Used for normMAXLEN / normPresenceMass.
  const sortedMaxLen = candidates
    .map((c2) => profiles[c2.claimId]?.maxPassageLength ?? 0)
    .sort((a, b) => a - b);
  // presenceMass replaces MAJ count as the breadth signal in sustainedMass.
  const sortedPresenceMass = candidates
    .map((c2) => profiles[c2.claimId]?.footprint.totals.presenceMass ?? 0)
    .sort((a, b) => a - b);

  for (const c of candidates) {
    const profile = profiles[c.claimId];
    if (!profile) continue;
    const footprintParagraphIds = getFootprintParagraphs(c.claimId);

    // dominatedParagraphCount: footprint paragraphs where another claim also has presence.
    let dominatedCount = 0;
    for (const pid of footprintParagraphIds) {
      const claimsInPara = paragraphToAllClaims.get(pid) ?? new Set();
      if (claimsInPara.size > 1) dominatedCount++;
    }

    const presenceMass = profile.footprint.totals.presenceMass;
    const territorialMass = profile.footprint.totals.territorialMass;
    const sovereignMass = profile.footprint.totals.sovereignMass;
    const sovereignRatio = profile.footprint.derived.sovereignRatio;
    const allParaSet = new Set<string>(footprintParagraphIds);

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

    const contestedShareRatio = profile.footprint.derived.contestedShareRatio;

    // Legacy compatibility diagnostic only. Active routing uses contestedShareRatio.
    const sharedPresence = presenceMass - sovereignMass;
    const contestedDominance: number | null = sharedPresence > 0 ? territorialMass / sharedPresence : null;
    const scalarDiagnostic = scalarMigrationByClaimId.get(c.claimId);
    if (scalarDiagnostic) {
      scalarDiagnostic.legacyContestedDominance = contestedDominance;
      scalarDiagnostic.contestedShareRatio = contestedShareRatio;
    }

    // Build extended candidate
    const extCand: ExtendedCandidate = {
      ...(c as any),
      contestedShareRatio,
      contestedDominance,
      presenceMass,
      territorialMass,
      sovereignMass,
      sovereignRatio,
      sustainedMass,
      sustainedMassCohort,
      dominantPresenceShare: claimProfiles[c.claimId].dominantPresenceShare,
      dominantPassageShare: claimProfiles[c.claimId].dominantPassageShare,
      maxStatementRun: claimProfiles[c.claimId].maxStatementRun,
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
    claimProfiles[c.claimId].contestedShareRatio = contestedShareRatio;
    claimProfiles[c.claimId].contestedDominance = contestedDominance;
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

  // Stage 2: Within each cohort, seed-sort by MAXLEN DESC, then footprint mass DESC
  for (const cohortClaims of byCohort.values()) {
    cohortClaims.sort((a, b) => {
      const maxLenDiff =
        b.maxStatementRun - a.maxStatementRun;
      if (maxLenDiff !== 0) return maxLenDiff;
      // presenceMass replaces MAJ count as breadth tiebreaker
      return (
        (profiles[b.claimId]?.footprint.totals.presenceMass ?? 0) -
        (profiles[a.claimId]?.footprint.totals.presenceMass ?? 0)
      );
    });
  }

  // Stage 3 & 4: Keep the old bucket as a diagnostic, but route on continuous
  // mass-native values. Phase 3 intentionally removes the bucket floor.
  const sortedMinorityPool: ExtendedCandidate[] = [];
  const cohortOrder = ['maj-breadth', 'balanced', 'passage-heavy'];

  const sortedLegacyContested = minorityPool
    .map((c) => c.contestedDominance ?? 0)
    .sort((a, b) => a - b);
  const sortedExclusivity = minorityPool.map((c) => c.sovereignMass).sort((a, b) => a - b);
  for (const c of minorityPool) {
    const contestedPerc = percentileFromSortedAsc(c.contestedDominance ?? 0, sortedLegacyContested);
    const exclusivityPerc = percentileFromSortedAsc(c.sovereignMass, sortedExclusivity);
    const highC = contestedPerc >= 0.5;
    const highE = exclusivityPerc >= 0.5;
    const bucket = highC && highE ? 1 : !highC && highE ? 2 : highC && !highE ? 3 : 4;
    const diagnostic = scalarMigrationByClaimId.get(c.claimId);
    if (diagnostic) {
      diagnostic.legacyMinorityBucket = bucket;
      diagnostic.legacyWouldFloorByScalarBucket = bucket === 4;
    }
  }

  for (const cohortName of cohortOrder) {
    const cohortClaims = byCohort.get(cohortName) ?? [];

    cohortClaims.sort((a, b) => {
      const contDiff = nullableScore(b.contestedShareRatio) - nullableScore(a.contestedShareRatio);
      if (contDiff !== 0) return contDiff;

      const exclDiff = b.sovereignMass - a.sovereignMass;
      if (exclDiff !== 0) return exclDiff;

      return b.supporters.length - a.supporters.length;
    });

    sortedMinorityPool.push(...cohortClaims);
  }

  // ── Block F: Phase 3 — Minority peeling
  const assignedSet = new Set<string>();
  if (sortedMinorityPool.length > 0) {
    collectRoutingMeasurement('claimNoveltyRatio', 'minority peeling assignment');
    collectRoutingMeasurement('corpusNoveltyRatio', 'minority peeling assignment');
    collectRoutingMeasurement('novelParagraphCount', 'minority peeling assignment');
  }

  for (let i = 0; i < sortedMinorityPool.length; i++) {
    const c = sortedMinorityPool[i];
    const footprintParagraphs = getFootprintParagraphs(c.claimId);
    const novelIds = footprintParagraphs.filter((pid) => !assignedSet.has(pid));
    c.landscapePosition = i === 0 ? 'leadMinority' : 'mechanism';

    const claimNoveltyRatio =
      footprintParagraphs.length > 0 ? novelIds.length / footprintParagraphs.length : 0;
    const corpusNoveltyRatio =
      totalCorpusParagraphs - assignedSet.size > 0
        ? novelIds.length / (totalCorpusParagraphs - assignedSet.size)
        : 0;

    c.routingMeasurements = {
      contestedShareRatio: c.contestedShareRatio,
      presenceMass: c.presenceMass,
      territorialMass: c.territorialMass,
      sovereignMass: c.sovereignMass,
      sovereignRatio: c.sovereignRatio,
      sustainedMassCohort: c.sustainedMassCohort,
      modelSpread: c.modelSpread,
      dominantPresenceShare: c.dominantPresenceShare,
      dominantPassageShare: c.dominantPassageShare,
      maxStatementRun: c.maxStatementRun,
      claimNoveltyRatio,
      corpusNoveltyRatio,
      novelParagraphCount: novelIds.length,
      majorityGateSnapshot: null,
    };

    for (const pid of footprintParagraphs) {
      assignedSet.add(pid);
    }
  }

  // ── Block G: Phase 4 — Majority mechanism assignment

  const majorityPool = extendedCandidates.filter(
    (c) => !c.isMinority && getFootprintParagraphs(c.claimId).length > 0
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
        b.maxStatementRun - a.maxStatementRun;
      if (maxLenDiff !== 0) return maxLenDiff;

      // presenceMass replaces MAJ count as final breadth tiebreaker
      return (
        (profiles[b.claimId]?.footprint.totals.presenceMass ?? 0) -
        (profiles[a.claimId]?.footprint.totals.presenceMass ?? 0)
      );
    });

    sortedMajorityPool.push(...cohortClaims);
  }

  // Iterate remaining majority candidates
  for (let i = 0; i < sortedMajorityPool.length; i++) {
    const c = sortedMajorityPool[i];
    const footprintParagraphs = getFootprintParagraphs(c.claimId);
    const nsIds = northStarCandidate ? getFootprintParagraphs(northStarCandidate.claimId) : [];
    const currentNSNovel = nsIds.filter((pid) => !assignedSet.has(pid)).length;
    const projectedNSNovel = nsIds.filter(
      (pid) => !assignedSet.has(pid) && !footprintParagraphs.includes(pid)
    ).length;
    const delta = currentNSNovel - projectedNSNovel;
    const candidateContribution = footprintParagraphs.filter((pid) => !assignedSet.has(pid))
      .length;

    collectRoutingMeasurement('claimNoveltyRatio', 'majority novelty gate');
    collectRoutingMeasurement('corpusNoveltyRatio', 'majority novelty gate');
    collectRoutingMeasurement('majorityGateSnapshot', 'majority novelty gate');

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

    c.routingMeasurements = {
      contestedShareRatio: c.contestedShareRatio,
      presenceMass: c.presenceMass,
      territorialMass: c.territorialMass,
      sovereignMass: c.sovereignMass,
      sovereignRatio: c.sovereignRatio,
      sustainedMassCohort: c.sustainedMassCohort,
      modelSpread: c.modelSpread,
      dominantPresenceShare: c.dominantPresenceShare,
      dominantPassageShare: c.dominantPassageShare,
      maxStatementRun: c.maxStatementRun,
      claimNoveltyRatio:
        footprintParagraphs.length > 0 ? candidateContribution / footprintParagraphs.length : 0,
      corpusNoveltyRatio:
        totalCorpusParagraphs - assignedSet.size > 0
          ? candidateContribution / (totalCorpusParagraphs - assignedSet.size)
          : 0,
      novelParagraphCount: candidateContribution,
      majorityGateSnapshot: { delta, currentNSNovel, projectedNSNovel, candidateContribution },
    };

    for (const pid of footprintParagraphs) {
      assignedSet.add(pid);
    }
  }

  // ── Block H: Phase 5 — NorthStar
  if (northStarCandidate) {
    northStarCandidate.landscapePosition = 'northStar';
    const nsFootprintParagraphs = getFootprintParagraphs(northStarCandidate.claimId);
    const nsNovel = nsFootprintParagraphs.filter((pid) => !assignedSet.has(pid)).length;
    const nsTotal = nsFootprintParagraphs.length;

    northStarCandidate.routingMeasurements = {
      contestedShareRatio: northStarCandidate.contestedShareRatio,
      presenceMass: northStarCandidate.presenceMass,
      territorialMass: northStarCandidate.territorialMass,
      sovereignMass: northStarCandidate.sovereignMass,
      sovereignRatio: northStarCandidate.sovereignRatio,
      sustainedMassCohort: northStarCandidate.sustainedMassCohort,
      modelSpread: northStarCandidate.modelSpread,
      dominantPresenceShare: northStarCandidate.dominantPresenceShare,
      dominantPassageShare: northStarCandidate.dominantPassageShare,
      maxStatementRun: northStarCandidate.maxStatementRun,
      claimNoveltyRatio: nsTotal > 0 ? nsNovel / nsTotal : 0,
      corpusNoveltyRatio:
        totalCorpusParagraphs - assignedSet.size > 0
          ? nsNovel / (totalCorpusParagraphs - assignedSet.size)
          : 0,
      novelParagraphCount: nsNovel,
      majorityGateSnapshot: null,
    };

    for (const pid of nsFootprintParagraphs) {
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

  // Instrumentation: keep the legacy gate shape, but feed it the replacement
  // modelTreatment dominant-presence share rather than concentrationRatio.
  const preconditionPass = candidates;
  const concentrationValues = preconditionPass.map((p) => p.dominantPresenceShare ?? 0);
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
  if (routingConflictEdges.length > 0) {
    collectRoutingMeasurement('validatedConflict', 'conflict cluster routing');
    collectRoutingMeasurement('crossPoolProximity', 'conflict cluster routing');
  }

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

  for (const profile of Object.values(claimProfiles)) {
    collectRoutingMeasurement(
      profile.landscapePosition,
      'landscapePosition route assembly'
    );
  }

  for (const diagnostic of scalarMigrationByClaimId.values()) {
    const newLandscapePosition =
      claimProfiles[diagnostic.claimId]?.landscapePosition ?? 'floor';
    diagnostic.newLandscapePosition = newLandscapePosition;
    if (diagnostic.legacyWouldFloorByScalarBucket !== null) {
      const newFloored = newLandscapePosition === 'floor';
      diagnostic.changedRoutingOutcome =
        diagnostic.legacyWouldFloorByScalarBucket !== newFloored;
      if (diagnostic.changedRoutingOutcome) {
        diagnostic.reason = diagnostic.legacyWouldFloorByScalarBucket
          ? 'legacy contestedDominance bucket would have floored this minority claim; continuous contestedShareRatio routing did not'
          : 'continuous contestedShareRatio routing floored this claim after legacy scalar bucket would have kept it';
      }
    }
  }
  const scalarMigration = Array.from(scalarMigrationByClaimId.values());

  const loadBearingClaims: PassageRoutedClaim[] = Object.values(claimProfiles)
    .filter((p) => p.landscapePosition !== 'floor' && !claimsInRoutedConflict.has(p.claimId))
    .sort((a, b) => {
      const priorityDiff =
        (priorityOrder[a.landscapePosition] ?? 99) - (priorityOrder[b.landscapePosition] ?? 99);
      if (priorityDiff !== 0) return priorityDiff;
      return nullableScore(b.dominantPresenceShare) - nullableScore(a.dominantPresenceShare);
    })
    .map((p) => {
      const c = claimMap.get(p.claimId);
      return {
        claimId: p.claimId,
        claimLabel: String((c as any)?.label ?? p.claimId),
        claimText: String((c as any)?.text ?? ''),
        landscapePosition: p.landscapePosition,
        contestedShareRatio: p.contestedShareRatio,
        dominantPresenceShare: p.dominantPresenceShare,
        dominantPassageShare: p.dominantPassageShare,
        maxStatementRun: p.maxStatementRun,
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
      massEligibility,
      scalarMigration,
      concentrationDistribution: Object.values(claimProfiles).map(
        (p) => p.dominantPresenceShare ?? 0
      ),
      densityRatioDistribution: Object.values(claimProfiles).map(
        (p) => p.dominantPassageShare ?? 0
      ),
      totalClaims: enrichedClaims.length,
      floorCount: Object.values(claimProfiles).filter((p) => p.landscapePosition === 'floor')
        .length,
      corpusMode: periphery.corpusMode,
      peripheralNodeIds: Array.from(periphery.peripheralNodeIds),
      peripheralRatio: periphery.peripheralRatio,
      largestBasinRatio: periphery.largestBasinRatio,
      measurementGuardViolations,
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

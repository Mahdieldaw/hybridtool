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
  ClaimStatus,
  StatementPassageEntry,
  BlastSurfaceClaimScore,
  BlastSurfaceRiskVector,
  StatementTwinMap,
  MixedResolution,
  MixedStatementResolution,
  MixedDirectionProbe,
  ClaimDensityProfile,
  ClaimFootprintClaimRollup,
} from '../../shared/types';
import type { PeripheryResult } from '../geometry';
import type { ShadowParagraph } from '../shadow';
import type { MeasurementViolation } from '../../shared/measurement-registry';
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
type LabelExcisionDiagnostic = PassageClaimRouting['diagnostics']['labelExcision'][number];
type PassageRoutePlan = PassageClaimRouting['routePlan'];
type RoutePlanStructuralInputs = PassageRoutePlan['structuralInputsByClaim'][string];

type SurfaceScalarMeasurements = {
  dominantModel: number | null;
  dominantPresenceShare: number | null;
  dominantPassageShare: number | null;
  maxStatementRun: number;
};

function emptyFootprintRollup(claimId = ''): ClaimFootprintClaimRollup {
  return {
    claimId,
    claimPresenceCount: 0,
    territorialMass: 0,
    sharedTerritorialMass: 0,
    sovereignStatementCount: 0,
    sharedStatementCount: 0,
    paragraphPresenceCount: 0,
    contestedParagraphCount: 0,
    dominantParagraphCount: 0,
    sovereignRatio: null,
    contestedShareRatio: null,
  };
}

function getFootprintRollup(profile: ClaimDensityProfile | undefined): ClaimFootprintClaimRollup {
  return profile?.footprint?.rollups?.byClaim ?? emptyFootprintRollup(profile?.claimId);
}

function getFootprintPresenceParagraphIds(profile: ClaimDensityProfile | undefined): string[] {
  return (profile?.footprint?.rollups?.byParagraph ?? [])
    .filter((entry) => entry.claimPresenceCount > 0)
    .map((entry) => entry.paragraphId);
}

function isFootprintEligible(profile: ClaimDensityProfile | undefined): boolean {
  return getFootprintRollup(profile).claimPresenceCount > 0;
}

function nullableScore(value: number | null): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : -1;
}

function share(part: number, total: number): number | null {
  return total > 0 ? part / total : null;
}

function shareOrZero(part: number, total: number): number {
  return total > 0 ? part / total : 0;
}

function finiteNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function getSovereignTerritoryMass(
  profile: ClaimDensityProfile | undefined,
  rollup: ClaimFootprintClaimRollup
): number {
  const atoms = profile?.footprint?.atoms ?? [];
  if (atoms.length > 0) {
    return atoms.reduce((sum, atom) => sum + (atom.isSovereign ? atom.ownershipShare : 0), 0);
  }
  return Math.max(0, rollup.territorialMass - rollup.sharedTerritorialMass);
}

function getParagraphTerritoryShare(
  paragraph: ClaimDensityProfile['footprint']['rollups']['byParagraph'][number]
): number | null {
  const explicitShare = finiteNumber((paragraph as any).paragraphTerritoryShare, NaN);
  if (Number.isFinite(explicitShare)) return explicitShare;

  const totalStatementMass = finiteNumber(
    (paragraph as any).totalStatementMass,
    paragraph.claimPresenceCount
  );
  return totalStatementMass > 0 ? paragraph.territorialMass / totalStatementMass : null;
}

type ContinuousRoutingProfile = Pick<
  PassageClaimProfile,
  | 'globalTerritoryShare'
  | 'sovereignTerritoryMass'
  | 'globalSovereignTerritoryShare'
  | 'sovereignPurity'
  | 'contestedTerritoryShare'
  | 'globalContestedTerritoryShare'
  | 'paragraphPresenceShare'
  | 'dominantParagraphShare'
  | 'claimDominanceRate'
  | 'dominanceStrengthMean'
  | 'dominanceStrengthMax'
  | 'dominanceExcessShare'
  | 'sustainedTreatmentDepth'
  | 'sustainedTreatmentShare'
  | 'passageMassShare'
  | 'dominantModelTerritoryShare'
  | 'crossModelEvidenceShare'
  | 'crossModelSustainedShare'
>;

function emptyContinuousRoutingProfile(): ContinuousRoutingProfile {
  return {
    globalTerritoryShare: 0,
    sovereignTerritoryMass: 0,
    globalSovereignTerritoryShare: 0,
    sovereignPurity: null,
    contestedTerritoryShare: null,
    globalContestedTerritoryShare: 0,
    paragraphPresenceShare: 0,
    dominantParagraphShare: 0,
    claimDominanceRate: null,
    dominanceStrengthMean: null,
    dominanceStrengthMax: null,
    dominanceExcessShare: 0,
    sustainedTreatmentDepth: 0,
    sustainedTreatmentShare: null,
    passageMassShare: null,
    dominantModelTerritoryShare: null,
    crossModelEvidenceShare: 0,
    crossModelSustainedShare: 0,
  };
}

function computeContinuousRoutingProfile({
  profile,
  rollup,
  maxStatementRun,
  modelSpread,
  modelsWithPassages,
  totalClaimTerritoryMass,
  totalParagraphs,
  totalModels,
}: {
  profile: ClaimDensityProfile | undefined;
  rollup: ClaimFootprintClaimRollup;
  maxStatementRun: number;
  modelSpread: number;
  modelsWithPassages: number;
  totalClaimTerritoryMass: number;
  totalParagraphs: number;
  totalModels: number;
}): ContinuousRoutingProfile {
  if (!profile || rollup.claimPresenceCount <= 0) {
    return emptyContinuousRoutingProfile();
  }

  const sovereignTerritoryMass = getSovereignTerritoryMass(profile, rollup);
  const paragraphShares = profile.footprint.rollups.byParagraph
    .map(getParagraphTerritoryShare)
    .filter((value): value is number => value !== null && Number.isFinite(value));
  const dominantParagraphShares = paragraphShares.filter((value) => value > 0.5);
  const dominanceExcessMass = paragraphShares.reduce(
    (sum, value) => sum + Math.max(0, value - 0.5),
    0
  );
  const passageStatementMass = profile.statementPassages.reduce(
    (sum, passage) => sum + passage.statementLength,
    0
  );
  const dominantModelTerritoryMass = Math.max(
    0,
    ...profile.footprint.rollups.byModel.map((model) => model.territorialMass)
  );

  return {
    globalTerritoryShare: shareOrZero(rollup.territorialMass, totalClaimTerritoryMass),
    sovereignTerritoryMass,
    globalSovereignTerritoryShare: shareOrZero(
      sovereignTerritoryMass,
      totalClaimTerritoryMass
    ),
    sovereignPurity: share(sovereignTerritoryMass, rollup.territorialMass),
    contestedTerritoryShare: share(rollup.sharedTerritorialMass, rollup.territorialMass),
    globalContestedTerritoryShare: shareOrZero(
      rollup.sharedTerritorialMass,
      totalClaimTerritoryMass
    ),
    paragraphPresenceShare: shareOrZero(rollup.paragraphPresenceCount, totalParagraphs),
    dominantParagraphShare: shareOrZero(rollup.dominantParagraphCount, totalParagraphs),
    claimDominanceRate: share(rollup.dominantParagraphCount, rollup.paragraphPresenceCount),
    dominanceStrengthMean:
      dominantParagraphShares.length > 0 ? mean(dominantParagraphShares) : null,
    dominanceStrengthMax:
      paragraphShares.length > 0 ? Math.max(...paragraphShares) : null,
    dominanceExcessShare: shareOrZero(dominanceExcessMass, 0.5 * totalParagraphs),
    sustainedTreatmentDepth: maxStatementRun,
    sustainedTreatmentShare: share(maxStatementRun, rollup.claimPresenceCount),
    passageMassShare: share(passageStatementMass, rollup.claimPresenceCount),
    dominantModelTerritoryShare: share(dominantModelTerritoryMass, rollup.territorialMass),
    crossModelEvidenceShare: clamp01(shareOrZero(modelSpread, totalModels)),
    crossModelSustainedShare: clamp01(shareOrZero(modelsWithPassages, totalModels)),
  };
}

function computeSurfaceScalarMeasurements(profile: ClaimDensityProfile): SurfaceScalarMeasurements {
  const presenceByModel = new Map<number, number>();
  for (const entry of profile.footprint.rollups.byModel) {
    presenceByModel.set(entry.modelIndex, entry.claimPresenceCount);
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
    getFootprintRollup(profile).claimPresenceCount
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

  return {
    dominantModel,
    dominantPresenceShare,
    dominantPassageShare,
    maxStatementRun,
  };
}

function buildScalarMigrationDiagnostic(
  claimId: string,
  scalars: SurfaceScalarMeasurements | null,
  contestedShareRatio: number | null
): ScalarMigrationDiagnostic {
  return {
    claimId,
    contestedShareRatio,
    dominantPresenceShare: scalars?.dominantPresenceShare ?? null,
    dominantPassageShare: scalars?.dominantPassageShare ?? null,
    maxStatementRun: scalars?.maxStatementRun ?? 0,
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
  const rollup = getFootprintRollup(profile);
  const newFootprintEligible = rollup.claimPresenceCount > 0;
  const changedEligibility = oldMajorityEligible !== newFootprintEligible;
  let reason: string | null = null;
  if (changedEligibility) {
    reason = newFootprintEligible
      ? 'canonical footprint exists but no paragraph passed the legacy majority threshold'
      : 'legacy majority threshold passed but canonical footprint has zero claim presence';
  }

  return {
    claimId,
    oldMajorityEligible,
    newFootprintEligible,
    claimPresenceCount: rollup.claimPresenceCount,
    territorialMass: rollup.territorialMass,
    sharedTerritorialMass: rollup.sharedTerritorialMass,
    sovereignStatementCount: rollup.sovereignStatementCount,
    sharedStatementCount: rollup.sharedStatementCount,
    paragraphPresenceCount: rollup.paragraphPresenceCount,
    contestedParagraphCount: rollup.contestedParagraphCount,
    dominantParagraphCount: rollup.dominantParagraphCount,
    sovereignRatio: rollup.sovereignRatio,
    contestedShareRatio: rollup.contestedShareRatio,
    changedEligibility,
    reason,
  };
}

function emptyRouteStructuralInputs(): RoutePlanStructuralInputs {
  return {
    claimPresenceCount: 0,
    territorialMass: 0,
    sharedTerritorialMass: 0,
    globalTerritoryShare: 0,
    sovereignTerritoryMass: 0,
    globalSovereignTerritoryShare: 0,
    sovereignPurity: null,
    contestedTerritoryShare: null,
    globalContestedTerritoryShare: 0,
    sovereignStatementCount: 0,
    sharedStatementCount: 0,
    paragraphPresenceCount: 0,
    paragraphPresenceShare: 0,
    contestedParagraphCount: 0,
    dominantParagraphCount: 0,
    dominantParagraphShare: 0,
    claimDominanceRate: null,
    dominanceStrengthMean: null,
    dominanceStrengthMax: null,
    dominanceExcessShare: 0,
    sovereignRatio: null,
    contestedShareRatio: null,
    dominantPresenceShare: null,
    dominantPassageShare: null,
    maxStatementRun: 0,
    sustainedTreatmentDepth: 0,
    sustainedTreatmentShare: null,
    passageMassShare: null,
    dominantModelTerritoryShare: null,
    passageCount: 0,
    modelSpread: 0,
    modelsWithPassages: 0,
    crossModelEvidenceShare: 0,
    crossModelSustainedShare: 0,
    sustainedMass: 0,
  };
}

function buildRouteStructuralInputs(profile: PassageClaimProfile | undefined): RoutePlanStructuralInputs {
  if (!profile) return emptyRouteStructuralInputs();
  return {
    claimPresenceCount: profile.claimPresenceCount,
    territorialMass: profile.territorialMass,
    sharedTerritorialMass: profile.sharedTerritorialMass,
    globalTerritoryShare: profile.globalTerritoryShare,
    sovereignTerritoryMass: profile.sovereignTerritoryMass,
    globalSovereignTerritoryShare: profile.globalSovereignTerritoryShare,
    sovereignPurity: profile.sovereignPurity,
    contestedTerritoryShare: profile.contestedTerritoryShare,
    globalContestedTerritoryShare: profile.globalContestedTerritoryShare,
    sovereignStatementCount: profile.sovereignStatementCount,
    sharedStatementCount: profile.sharedStatementCount,
    paragraphPresenceCount: profile.paragraphPresenceCount,
    paragraphPresenceShare: profile.paragraphPresenceShare,
    contestedParagraphCount: profile.contestedParagraphCount,
    dominantParagraphCount: profile.dominantParagraphCount,
    dominantParagraphShare: profile.dominantParagraphShare,
    claimDominanceRate: profile.claimDominanceRate,
    dominanceStrengthMean: profile.dominanceStrengthMean,
    dominanceStrengthMax: profile.dominanceStrengthMax,
    dominanceExcessShare: profile.dominanceExcessShare,
    sovereignRatio: profile.sovereignRatio,
    contestedShareRatio: profile.contestedShareRatio,
    dominantPresenceShare: profile.dominantPresenceShare,
    dominantPassageShare: profile.dominantPassageShare,
    maxStatementRun: profile.maxStatementRun,
    sustainedTreatmentDepth: profile.sustainedTreatmentDepth,
    sustainedTreatmentShare: profile.sustainedTreatmentShare,
    passageMassShare: profile.passageMassShare,
    dominantModelTerritoryShare: profile.dominantModelTerritoryShare,
    passageCount: profile.passageCount,
    modelSpread: profile.modelSpread,
    modelsWithPassages: profile.modelsWithPassages,
    crossModelEvidenceShare: profile.crossModelEvidenceShare,
    crossModelSustainedShare: profile.crossModelSustainedShare,
    sustainedMass: profile.sustainedMass,
  };
}

function compareRoutePlanInputs(
  a: RoutePlanStructuralInputs,
  b: RoutePlanStructuralInputs
): number {
  const dominanceExcessDiff = b.dominanceExcessShare - a.dominanceExcessShare;
  if (dominanceExcessDiff !== 0) return dominanceExcessDiff;

  const territoryDiff = b.globalTerritoryShare - a.globalTerritoryShare;
  if (territoryDiff !== 0) return territoryDiff;

  const sustainedTreatmentDiff =
    nullableScore(b.sustainedTreatmentShare) - nullableScore(a.sustainedTreatmentShare);
  if (sustainedTreatmentDiff !== 0) return sustainedTreatmentDiff;

  const sovereignDiff = b.globalSovereignTerritoryShare - a.globalSovereignTerritoryShare;
  if (sovereignDiff !== 0) return sovereignDiff;

  const crossModelSustainedDiff = b.crossModelSustainedShare - a.crossModelSustainedShare;
  if (crossModelSustainedDiff !== 0) return crossModelSustainedDiff;

  const dominanceStrengthDiff =
    nullableScore(b.dominanceStrengthMean) - nullableScore(a.dominanceStrengthMean);
  if (dominanceStrengthDiff !== 0) return dominanceStrengthDiff;

  return b.claimPresenceCount - a.claimPresenceCount;
}

function buildOrderingReasons(inputs: RoutePlanStructuralInputs): string[] {
  return [
    `dominanceExcessShare=${inputs.dominanceExcessShare.toFixed(3)}`,
    `globalTerritoryShare=${inputs.globalTerritoryShare.toFixed(3)}`,
    `sustainedTreatmentShare=${inputs.sustainedTreatmentShare == null ? 'null' : inputs.sustainedTreatmentShare.toFixed(3)}`,
    `globalSovereignTerritoryShare=${inputs.globalSovereignTerritoryShare.toFixed(3)}`,
    `crossModelSustainedShare=${inputs.crossModelSustainedShare.toFixed(3)}`,
    `dominanceStrengthMean=${inputs.dominanceStrengthMean == null ? 'null' : inputs.dominanceStrengthMean.toFixed(3)}`,
    `claimPresenceCount=${inputs.claimPresenceCount}`,
  ];
}

function buildRoutePlan(
  enrichedClaims: EnrichedClaim[],
  claimProfiles: Record<string, PassageClaimProfile>
): PassageRoutePlan {
  const claimIds = enrichedClaims.map((claim) => String(claim.id));
  const structuralInputsByClaim: PassageRoutePlan['structuralInputsByClaim'] = {};
  const orderingReasonsByClaim: PassageRoutePlan['orderingReasonsByClaim'] = {};

  for (const claimId of claimIds) {
    const inputs = buildRouteStructuralInputs(claimProfiles[claimId]);
    structuralInputsByClaim[claimId] = inputs;
    orderingReasonsByClaim[claimId] = buildOrderingReasons(inputs);
  }

  const includedClaimIds = claimIds
    .filter((claimId) => structuralInputsByClaim[claimId]?.claimPresenceCount > 0)
    .sort((a, b) => {
      const diff = compareRoutePlanInputs(structuralInputsByClaim[a], structuralInputsByClaim[b]);
      if (diff !== 0) return diff;
      return a.localeCompare(b);
    });
  const includedSet = new Set(includedClaimIds);
  const nonPrimaryClaimIds = claimIds.filter((claimId) => !includedSet.has(claimId));

  return {
    orderedClaimIds: [...includedClaimIds],
    includedClaimIds,
    nonPrimaryClaimIds,
    orderingReasonsByClaim,
    structuralInputsByClaim,
  };
}

function claimStatusForRouteRank(routeRank: number | null): ClaimStatus {
  return {
    routeRank,
    role:
      routeRank === null
        ? 'passthrough'
        : routeRank === 1
          ? 'anchor'
          : routeRank === 2
            ? 'supporting'
            : 'mechanism',
  };
}

function computeClaimStatusCompatibility(routePlan: PassageRoutePlan): Record<string, ClaimStatus> {
  const claimStatusByClaim: Record<string, ClaimStatus> = {};
  routePlan.includedClaimIds.forEach((claimId, index) => {
    const status = claimStatusForRouteRank(index + 1);
    claimStatusByClaim[claimId] = status;
  });
  for (const claimId of routePlan.nonPrimaryClaimIds) {
    const status = claimStatusForRouteRank(null);
    claimStatusByClaim[claimId] = status;
  }
  return claimStatusByClaim;
}

function applyClaimStatusToProfiles(
  claimProfiles: Record<string, PassageClaimProfile>,
  claimStatusByClaim: Record<string, ClaimStatus>
): void {
  for (const [claimId, status] of Object.entries(claimStatusByClaim)) {
    if (!claimProfiles[claimId]) continue;
    claimProfiles[claimId].claimStatus = status;
  }
}

function buildLabelExcisionDiagnostics(routePlan: PassageRoutePlan): LabelExcisionDiagnostic[] {
  const includedSet = new Set(routePlan.includedClaimIds);
  const orderIndex = new Map(routePlan.orderedClaimIds.map((claimId, index) => [claimId, index]));
  return Object.keys(routePlan.structuralInputsByClaim).map((claimId) => {
    const newRoutePlanInclusion = includedSet.has(claimId);
    return {
      claimId,
      newRoutePlanInclusion,
      routeOrderIndex: orderIndex.get(claimId) ?? null,
      structuralValuesUsed: routePlan.structuralInputsByClaim[claimId],
      reason: newRoutePlanInclusion
        ? 'included by canonical footprint presence and ordered by mass-native structural keys'
        : 'not included because canonical footprint presence mass is zero',
      consumersRemoved: [
        'routing',
        'route ordering',
        'load-bearing inclusion',
        'route mirror exports',
        'editorial prompt input',
      ],
    };
  });
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
  const totalClaimTerritoryMass = enrichedClaims.reduce((sum, claim) => {
    const claimId = String(claim.id);
    return sum + getFootprintRollup(profiles[claimId]).territorialMass;
  }, 0);
  const totalParagraphs = Math.max(0, claimDensityResult.meta.totalParagraphs);
  const totalModels = Math.max(0, claimDensityResult.meta.totalModels);

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

    let queryDistance: number | undefined =
      typeof (profile as any)?.queryDistance === 'number' &&
      Number.isFinite((profile as any).queryDistance)
        ? (profile as any).queryDistance
        : undefined;
    if (queryEmbedding && claimEmbeddings?.has(id)) {
      const emb = claimEmbeddings.get(id);
      if (emb) queryDistance = 1 - cosineSimilarity(emb, queryEmbedding);
    }

    if (!profile) {
      claimProfiles[id] = {
        claimId: id,
        claimStatus: claimStatusForRouteRank(null),
        isMinority: false,
        routingMeasurements: null,
        paragraphPresenceCount: 0,
        claimPresenceCount: 0,
        territorialMass: 0,
        sharedTerritorialMass: 0,
        sovereignStatementCount: 0,
        sharedStatementCount: 0,
        contestedParagraphCount: 0,
        dominantParagraphCount: 0,
        ...emptyContinuousRoutingProfile(),
        sovereignRatio: null,
        contestedShareRatio: null,
        sustainedMass: 0,
        sustainedMassCohort: 'balanced',
        modelSpread: 0,
        passageCount: 0,
        modelsWithPassages: 0,
        isLoadBearing: null,
        dominantModel: null,
        dominantPresenceShare: null,
        dominantPassageShare: null,
        maxStatementRun: 0,
        maxPassageLength: 0,
        ...(queryDistance !== undefined ? { queryDistance } : {}),
      };
      scalarMigrationByClaimId.set(
        id,
        buildScalarMigrationDiagnostic(id, null, null)
      );
      continue;
    }

    const scalars = computeSurfaceScalarMeasurements(profile);

    claimProfiles[id] = {
      claimId: id,
      claimStatus: claimStatusForRouteRank(null),
      isMinority: false,
      routingMeasurements: null,
      paragraphPresenceCount: 0,
      claimPresenceCount: 0,
      territorialMass: 0,
      sharedTerritorialMass: 0,
      sovereignStatementCount: 0,
      sharedStatementCount: 0,
      contestedParagraphCount: 0,
      dominantParagraphCount: 0,
      ...emptyContinuousRoutingProfile(),
      sovereignRatio: null,
      contestedShareRatio: null,
      sustainedMass: 0,
      sustainedMassCohort: 'balanced',
      modelSpread: profile.modelSpread,
      passageCount: profile.passageCount,
      modelsWithPassages: profile.modelsWithPassages,
      isLoadBearing: null,
      dominantModel: scalars.dominantModel,
      dominantPresenceShare: scalars.dominantPresenceShare,
      dominantPassageShare: scalars.dominantPassageShare,
      maxStatementRun: scalars.maxStatementRun,
      maxPassageLength: profile.maxPassageLength,
      ...(queryDistance !== undefined ? { queryDistance } : {}),
    };
    scalarMigrationByClaimId.set(
      id,
      buildScalarMigrationDiagnostic(
        id,
        scalars,
        getFootprintRollup(profile).contestedShareRatio
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
      p.routingMeasurements = null;
      continue;
    }

    const footprintParagraphIds = getFootprintPresenceParagraphIds(profile);

    if (!isFootprintEligible(profile)) {
      p.routingMeasurements = null;
      continue;
    }

    candidates.push({
      ...(p as any),
      footprintParagraphIds,
    });
  }

  // Non-candidates remain outside the structural route plan.
  const candidateIds = new Set(candidates.map((c) => c.claimId));
  for (const [id, p] of Object.entries(claimProfiles)) {
    if (!candidateIds.has(id)) {
      p.routingMeasurements = null;
    }
  }

  if (candidates.length === 0) {
    const routePlan = buildRoutePlan(enrichedClaims, claimProfiles);
    const claimStatusByClaim = computeClaimStatusCompatibility(routePlan);
    applyClaimStatusToProfiles(claimProfiles, claimStatusByClaim);
    const labelExcision = buildLabelExcisionDiagnostics(routePlan);

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
        routePlan,
        diagnostics: {
          dominantPresenceDistribution: [],
          dominantPassageDistribution: [],
          massEligibility,
          scalarMigration: Array.from(scalarMigrationByClaimId.values()),
          labelExcision,
          totalClaims: enrichedClaims.length,
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

  // Compute paragraphToAllClaims from any claim presence.
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
  interface ExtendedCandidate extends CandidateProfile, ContinuousRoutingProfile {
    /** Canonical sharedTerritorialMass / sharedStatementCount. Null when denominator is 0. */
    contestedShareRatio: number | null;
    claimPresenceCount: number;
    territorialMass: number;
    sharedTerritorialMass: number;
    sovereignStatementCount: number;
    sharedStatementCount: number;
    paragraphPresenceCount: number;
    contestedParagraphCount: number;
    dominantParagraphCount: number;
    /** Derived: sovereignStatementCount / claimPresenceCount. Null when claimPresenceCount = 0. */
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

  // Hoisted: percentile inputs sorted once, ascending. Used for normMAXLEN / normClaimPresence.
  const sortedMaxLen = candidates
    .map((c2) => profiles[c2.claimId]?.maxPassageLength ?? 0)
    .sort((a, b) => a - b);
  // claimPresenceCount is the breadth signal in sustainedMass.
  const sortedClaimPresence = candidates
    .map((c2) => getFootprintRollup(profiles[c2.claimId]).claimPresenceCount)
    .sort((a, b) => a - b);

  for (const c of candidates) {
    const profile = profiles[c.claimId];
    if (!profile) continue;
    const footprintParagraphIds = getFootprintParagraphs(c.claimId);

    // contestedParagraphCount: footprint paragraphs where another claim also has presence.
    let contestedParagraphCount = 0;
    for (const pid of footprintParagraphIds) {
      const claimsInPara = paragraphToAllClaims.get(pid) ?? new Set();
      if (claimsInPara.size > 1) contestedParagraphCount++;
    }

    const rollup = getFootprintRollup(profile);
    const claimPresenceCount = rollup.claimPresenceCount;
    const territorialMass = rollup.territorialMass;
    const sharedTerritorialMass = rollup.sharedTerritorialMass;
    const sovereignStatementCount = rollup.sovereignStatementCount;
    const sharedStatementCount = rollup.sharedStatementCount;
    const paragraphPresenceCount = rollup.paragraphPresenceCount;
    const dominantParagraphCount = rollup.dominantParagraphCount;
    const sovereignRatio = rollup.sovereignRatio;
    const continuousRouting = computeContinuousRoutingProfile({
      profile,
      rollup,
      maxStatementRun: claimProfiles[c.claimId].maxStatementRun,
      modelSpread: profile.modelSpread,
      modelsWithPassages: profile.modelsWithPassages,
      totalClaimTerritoryMass,
      totalParagraphs,
      totalModels,
    });
    const allParaSet = new Set<string>(footprintParagraphIds);

    // sustainedMass cohort computation: percentile ranks for MAXLEN and claimPresenceCount.
    // claimPresenceCount is a continuous breadth axis that does not require a 0.5 threshold.
    const MAXLEN = profile.maxPassageLength;

    const normMAXLEN = percentileFromSortedAsc(MAXLEN, sortedMaxLen);
    const normClaimPresence = percentileFromSortedAsc(claimPresenceCount, sortedClaimPresence);
    const sustainedMass = Math.sqrt(normMAXLEN * normClaimPresence);

    // Cohort assignment: passage-heavy ↔ depth-dominant, maj-breadth ↔ breadth-dominant.
    let sustainedMassCohort: 'passage-heavy' | 'balanced' | 'maj-breadth';
    if (normMAXLEN >= 2 / 3 && normClaimPresence < 1 / 3) {
      sustainedMassCohort = 'passage-heavy';
    } else if (normClaimPresence >= 2 / 3 && normMAXLEN < 1 / 3) {
      sustainedMassCohort = 'maj-breadth';
    } else {
      sustainedMassCohort = 'balanced';
    }

    const contestedShareRatio = rollup.contestedShareRatio;

    const scalarDiagnostic = scalarMigrationByClaimId.get(c.claimId);
    if (scalarDiagnostic) {
      scalarDiagnostic.contestedShareRatio = contestedShareRatio;
    }

    // Build extended candidate
    const extCand: ExtendedCandidate = {
      ...(c as any),
      contestedShareRatio,
      claimPresenceCount,
      territorialMass,
      sharedTerritorialMass,
      sovereignStatementCount,
      sharedStatementCount,
      paragraphPresenceCount,
      contestedParagraphCount,
      dominantParagraphCount,
      ...continuousRouting,
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
    claimProfiles[c.claimId].paragraphPresenceCount = paragraphPresenceCount;
    claimProfiles[c.claimId].claimPresenceCount = claimPresenceCount;
    claimProfiles[c.claimId].territorialMass = territorialMass;
    claimProfiles[c.claimId].sharedTerritorialMass = sharedTerritorialMass;
    claimProfiles[c.claimId].sovereignStatementCount = sovereignStatementCount;
    claimProfiles[c.claimId].sharedStatementCount = sharedStatementCount;
    claimProfiles[c.claimId].contestedParagraphCount = contestedParagraphCount;
    claimProfiles[c.claimId].dominantParagraphCount = dominantParagraphCount;
    Object.assign(claimProfiles[c.claimId], continuousRouting);
    claimProfiles[c.claimId].sovereignRatio = sovereignRatio;
    claimProfiles[c.claimId].contestedShareRatio = contestedShareRatio;
    claimProfiles[c.claimId].sustainedMass = sustainedMass;
    claimProfiles[c.claimId].sustainedMassCohort = sustainedMassCohort;
  }

  // Phase 4 route planning: active inclusion and ordering are structural only.
  for (const c of extendedCandidates) {
    c.isMinority = c.supporters.length < maxSupporterCount / 2;
    const profile = claimProfiles[c.claimId];
    if (!profile) continue;
    profile.isMinority = c.isMinority;
    profile.routingMeasurements = {
      contestedShareRatio: c.contestedShareRatio,
      claimPresenceCount: c.claimPresenceCount,
      territorialMass: c.territorialMass,
      sharedTerritorialMass: c.sharedTerritorialMass,
      sovereignStatementCount: c.sovereignStatementCount,
      sharedStatementCount: c.sharedStatementCount,
      paragraphPresenceCount: c.paragraphPresenceCount,
      contestedParagraphCount: c.contestedParagraphCount,
      dominantParagraphCount: c.dominantParagraphCount,
      globalTerritoryShare: c.globalTerritoryShare,
      sovereignTerritoryMass: c.sovereignTerritoryMass,
      globalSovereignTerritoryShare: c.globalSovereignTerritoryShare,
      sovereignPurity: c.sovereignPurity,
      contestedTerritoryShare: c.contestedTerritoryShare,
      globalContestedTerritoryShare: c.globalContestedTerritoryShare,
      paragraphPresenceShare: c.paragraphPresenceShare,
      dominantParagraphShare: c.dominantParagraphShare,
      claimDominanceRate: c.claimDominanceRate,
      dominanceStrengthMean: c.dominanceStrengthMean,
      dominanceStrengthMax: c.dominanceStrengthMax,
      dominanceExcessShare: c.dominanceExcessShare,
      sovereignRatio: c.sovereignRatio,
      sustainedMassCohort: c.sustainedMassCohort,
      modelSpread: c.modelSpread,
      dominantPresenceShare: c.dominantPresenceShare,
      dominantPassageShare: c.dominantPassageShare,
      maxStatementRun: c.maxStatementRun,
      sustainedTreatmentDepth: c.sustainedTreatmentDepth,
      sustainedTreatmentShare: c.sustainedTreatmentShare,
      passageMassShare: c.passageMassShare,
      dominantModelTerritoryShare: c.dominantModelTerritoryShare,
      crossModelEvidenceShare: c.crossModelEvidenceShare,
      crossModelSustainedShare: c.crossModelSustainedShare,
      claimNoveltyRatio: 0,
      corpusNoveltyRatio: 0,
      novelParagraphCount: 0,
      majorityGateSnapshot: null,
    };
  }

  // Instrumentation: keep the legacy gate shape, but feed it the replacement
  // modelTreatment dominant-presence share.
  const preconditionPass = candidates;
  const concentrationValues = preconditionPass.map((p) => p.dominantPresenceShare ?? 0);
  const muConcentration = mean(concentrationValues);
  const sigmaConcentration = sigma(concentrationValues, muConcentration);
  const concentrationThreshold = muConcentration + sigmaConcentration;

  const routePlan = buildRoutePlan(enrichedClaims, claimProfiles);
  const claimStatusByClaim = computeClaimStatusCompatibility(routePlan);
  applyClaimStatusToProfiles(claimProfiles, claimStatusByClaim);
  const labelExcision = buildLabelExcisionDiagnostics(routePlan);
  const loadBearingCount = routePlan.includedClaimIds.length;

  // Conflict clusters remain compatibility/debug context only. They do not feed routePlan.
  const routingConflictEdges = validatedConflicts.filter(
    (c) => c.validated && c.mapperLabeledConflict
  );

  const conflictClusters: PassageClaimRouting['conflictClusters'] = [];

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
    }
  }

  const scalarMigration = Array.from(scalarMigrationByClaimId.values());

  const routing: PassageClaimRouting = {
    conflictClusters,
    routePlan,
    diagnostics: {
      massEligibility,
      scalarMigration,
      labelExcision,
      dominantPresenceDistribution: Object.values(claimProfiles).map(
        (p) => p.dominantPresenceShare ?? 0
      ),
      dominantPassageDistribution: Object.values(claimProfiles).map(
        (p) => p.dominantPassageShare ?? 0
      ),
      totalClaims: enrichedClaims.length,
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
    for (const sid of claimExclusive) {
      if (sid.startsWith('tc_')) continue;
      const twin = twinMap.perClaim[id]?.[sid] ?? null;
      if (twin) {
        deletionIds.push(sid);
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

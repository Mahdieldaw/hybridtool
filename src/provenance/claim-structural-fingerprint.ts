import type {
  ClaimDensityResult,
  ClaimStructuralFingerprint,
  ClaimStructuralFingerprintModelTreatment,
  ClaimStructuralFingerprintPassage,
  ClaimStructuralFingerprintResult,
  MixedProvenanceResult,
  ParagraphOrigin,
  ProvenanceRefinementResult,
  StructuralFingerprintGap,
} from '../../shared/types';
import type { ShadowParagraph, ShadowStatement } from '../shadow';

export interface ClaimStructuralFingerprintInput {
  claimIds: string[];
  claimDensityResult: ClaimDensityResult;
  mixedProvenanceResult: MixedProvenanceResult;
  canonicalSets: Map<string, Set<string>>;
  shadowParagraphs: ShadowParagraph[];
  shadowStatements: ShadowStatement[];
  provenanceRefinement?: ProvenanceRefinementResult;
}

type OriginKey = 'both' | 'competitiveOnly' | 'claimCentricOnly';

const ORIGIN_TO_KEY: Record<ParagraphOrigin, OriginKey> = {
  both: 'both',
  'competitive-only': 'competitiveOnly',
  'claim-centric-only': 'claimCentricOnly',
};

export function computeContestedShareRatio(
  sharedTerritorialMass: number,
  sharedStatementCount: number
): number | null {
  if (sharedStatementCount <= 0) return null;
  return sharedTerritorialMass / sharedStatementCount;
}

function ensureModel(
  vector: Record<string, ClaimStructuralFingerprintModelTreatment>,
  modelId: string
): ClaimStructuralFingerprintModelTreatment {
  const existing = vector[modelId];
  if (existing) return existing;
  const created: ClaimStructuralFingerprintModelTreatment = {
    claimPresenceCount: 0,
    territorialMass: 0,
    sharedTerritorialMass: 0,
    sovereignStatementCount: 0,
    sharedStatementCount: 0,
    paragraphPresenceCount: 0,
    contestedParagraphCount: 0,
    dominantParagraphCount: 0,
    passageRuns: 0,
    passageStatementMass: 0,
    boundaryCrossingCount: 0,
    statementCount: 0,
    referentialMass: null,
  };
  vector[modelId] = created;
  return created;
}

function maxOrNull(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.max(...values);
}

function share(maxValue: number | null, total: number): number | null {
  if (maxValue == null || total <= 0) return null;
  return maxValue / total;
}

function entropy(values: number[]): number {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return 0;
  const positive = values.filter((value) => value > 0);
  if (positive.length <= 1) return 0;
  const raw = positive.reduce((sum, value) => {
    const p = value / total;
    return sum - p * Math.log(p);
  }, 0);
  return raw / Math.log(positive.length);
}

function top2Gap(values: number[], total: number): number | null {
  if (total <= 0) return null;
  const shares = values
    .filter((value) => value > 0)
    .map((value) => value / total)
    .sort((a, b) => b - a);
  if (shares.length === 0) return null;
  return shares[0] - (shares[1] ?? 0);
}

function addGap(gaps: StructuralFingerprintGap[], gap: StructuralFingerprintGap): void {
  if (gaps.some((existing) => existing.namespace === gap.namespace && existing.field === gap.field)) {
    return;
  }
  gaps.push(gap);
}

function originDistributionTemplate(): Record<OriginKey, { count: number; mass: number }> {
  return {
    both: { count: 0, mass: 0 },
    competitiveOnly: { count: 0, mass: 0 },
    claimCentricOnly: { count: 0, mass: 0 },
  };
}

export function buildClaimStructuralFingerprints(
  input: ClaimStructuralFingerprintInput
): ClaimStructuralFingerprintResult {
  const {
    claimIds,
    claimDensityResult,
    mixedProvenanceResult,
    canonicalSets,
    shadowParagraphs,
    shadowStatements,
    provenanceRefinement,
  } = input;

  const missingSubstrate: StructuralFingerprintGap[] = [];
  const byClaimId: Record<string, ClaimStructuralFingerprint> = {};
  const paragraphById = new Map<string, ShadowParagraph>();
  const statementById = new Map<string, ShadowStatement>();
  const statementToParagraphId = new Map<string, string>();

  for (const paragraph of shadowParagraphs) {
    paragraphById.set(paragraph.id, paragraph);
    for (const statementId of paragraph.statementIds) {
      statementToParagraphId.set(statementId, paragraph.id);
    }
  }
  for (const statement of shadowStatements) {
    statementById.set(statement.id, statement);
  }

  addGap(missingSubstrate, {
    namespace: 'statement.structuralFingerprint',
    field: 'referentialMassInputs',
    reason: 'Raw noun/named-entity observations are not first-class statement substrate yet, so modelTreatment.referentialMass may be null.',
    producerHint: 'Produce statement-level nounEntityCount or referentialDensity before aggregating into claim.structuralFingerprint.',
  });

  const allClaimIds = new Set([
    ...claimIds.map(String),
    ...Object.keys(claimDensityResult.profiles),
    ...Object.keys(mixedProvenanceResult.perClaim),
  ]);

  for (const claimId of allClaimIds) {
    const profile = claimDensityResult.profiles[claimId];
    const mixed = mixedProvenanceResult.perClaim[claimId];
    const canonicalStatementIds = canonicalSets.get(claimId) ?? new Set<string>();
    const footprint = profile?.footprint;
    const footprintRollup = footprint?.rollups.byClaim ?? {
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
    const claimPresenceCount = footprintRollup.claimPresenceCount;
    const territorialMass = footprintRollup.territorialMass;
    const sharedTerritorialMass = footprintRollup.sharedTerritorialMass;
    const sovereignStatementCount = footprintRollup.sovereignStatementCount;
    const sharedStatementCount = footprintRollup.sharedStatementCount;
    const paragraphPresenceCount = footprintRollup.paragraphPresenceCount;
    const contestedParagraphCount = footprintRollup.contestedParagraphCount;
    const dominantParagraphCount = footprintRollup.dominantParagraphCount;
    const sovereignRatio = footprintRollup.sovereignRatio;
    const contestedShareRatio = footprintRollup.contestedShareRatio;

    const passages: ClaimStructuralFingerprintPassage[] = (profile?.statementPassages ?? []).map(
      (passage) => {
        const paragraphMembership = Array.from(
          new Set(
            passage.statementIds
              .map((statementId) => statementToParagraphId.get(statementId))
              .filter((paragraphId): paragraphId is string => Boolean(paragraphId))
          )
        );
        const paragraphsCrossed = paragraphMembership.length;
        const boundaryCrossing = paragraphsCrossed > 1;
        return {
          statementIds: [...passage.statementIds],
          statementLength: passage.statementLength,
          paragraphMembership,
          paragraphsCrossed,
          boundaryCrossing,
          paragraphSpanningDepth: Math.max(0, paragraphsCrossed - 1),
          inParagraphPassage: !boundaryCrossing,
          modelId: String(passage.modelIndex),
        };
      }
    );

    const maxStatementRun = Math.max(0, ...passages.map((passage) => passage.statementLength));
    const inParagraphCount = passages.filter((passage) => passage.inParagraphPassage).length;
    const boundaryCrossingCount = passages.filter((passage) => passage.boundaryCrossing).length;
    const paragraphSpanningDepth = Math.max(
      0,
      ...passages.map((passage) => passage.paragraphSpanningDepth)
    );

    const modelVector: Record<string, ClaimStructuralFingerprintModelTreatment> = {};
    for (const rollup of footprint?.rollups.byModel ?? []) {
      const model = ensureModel(modelVector, String(rollup.modelIndex));
      model.claimPresenceCount += rollup.claimPresenceCount;
      model.territorialMass += rollup.territorialMass;
      model.sharedTerritorialMass += rollup.sharedTerritorialMass;
      model.sovereignStatementCount += rollup.sovereignStatementCount;
      model.sharedStatementCount += rollup.sharedStatementCount;
      model.paragraphPresenceCount += rollup.paragraphPresenceCount;
      model.contestedParagraphCount += rollup.contestedParagraphCount;
      model.dominantParagraphCount += rollup.dominantParagraphCount;
    }

    for (const passage of passages) {
      const model = ensureModel(modelVector, passage.modelId);
      model.passageRuns += 1;
      model.passageStatementMass += passage.statementLength;
      if (passage.boundaryCrossing) model.boundaryCrossingCount += 1;
    }

    let hasReferentialMassInput = false;
    for (const statementId of canonicalStatementIds) {
      const statement = statementById.get(statementId);
      if (!statement) continue;
      const model = ensureModel(modelVector, String(statement.modelIndex));
      model.statementCount += 1;

      const signal = provenanceRefinement?.entries[statementId]?.signalStrength;
      if (signal && signal.nounEntityCount > 0) {
        model.referentialMass = (model.referentialMass ?? 0) + signal.nounEntityCount;
        hasReferentialMassInput = true;
      }
    }

    if (!hasReferentialMassInput) {
      for (const model of Object.values(modelVector)) {
        model.referentialMass = null;
      }
    }

    const modelPresenceValues = Object.values(modelVector).map((model) => model.claimPresenceCount);
    const modelSovereignValues = Object.values(modelVector).map((model) => model.sovereignStatementCount);
    const modelPassageValues = Object.values(modelVector).map(
      (model) => model.passageStatementMass
    );
    const totalPassageStatementMass = modelPassageValues.reduce((sum, value) => sum + value, 0);

    const assignmentOriginDistribution = originDistributionTemplate();
    let keptMass = 0;
    let removedMass = 0;
    for (const statement of mixed?.statements ?? []) {
      const paragraph = paragraphById.get(statement.paragraphId);
      const statementMass = paragraph && paragraph.statementIds.length > 0
        ? 1 / paragraph.statementIds.length
        : 0;
      const originKey = ORIGIN_TO_KEY[statement.paragraphOrigin];
      assignmentOriginDistribution[originKey].count += 1;
      assignmentOriginDistribution[originKey].mass += statementMass;
      if (statement.kept) keptMass += statementMass;
      else removedMass += statementMass;
    }

    const bothMass = assignmentOriginDistribution.both.mass;
    const competitiveOnlyMass = assignmentOriginDistribution.competitiveOnly.mass;
    const claimCentricOnlyMass = assignmentOriginDistribution.claimCentricOnly.mass;
    const totalAssignmentMass = keptMass + removedMass;
    const keptCount = Math.max(0, (mixed?.totalCount ?? 0) - (mixed?.removedCount ?? 0));
    const removedCount = mixed?.removedCount ?? 0;

    const fingerprint: ClaimStructuralFingerprint = {
      footprint: {
        schemaVersion: 2,
        atoms: (footprint?.atoms ?? []).map((atom) => ({
          claimId: atom.claimId,
          statementId: atom.statementId,
          paragraphId: atom.paragraphId,
          modelIndex: atom.modelIndex,
          ownerCount: atom.ownerCount,
          ownershipShare: atom.ownershipShare,
          isSovereign: atom.isSovereign,
          isShared: atom.isShared,
        })),
        rollups: {
          byParagraph: Object.fromEntries(
            (footprint?.rollups.byParagraph ?? []).map((rollup) => [
              rollup.paragraphId,
              rollup.claimPresenceCount,
            ])
          ),
          byModel: Object.fromEntries(
            (footprint?.rollups.byModel ?? []).map((rollup) => [
              String(rollup.modelIndex),
              {
                claimPresenceCount: rollup.claimPresenceCount,
                territorialMass: rollup.territorialMass,
                sharedTerritorialMass: rollup.sharedTerritorialMass,
                sovereignStatementCount: rollup.sovereignStatementCount,
                sharedStatementCount: rollup.sharedStatementCount,
                paragraphPresenceCount: rollup.paragraphPresenceCount,
                contestedParagraphCount: rollup.contestedParagraphCount,
                dominantParagraphCount: rollup.dominantParagraphCount,
              },
            ])
          ),
          byClaim: {
            claimPresenceCount,
            territorialMass,
            sharedTerritorialMass,
            sovereignStatementCount,
            sharedStatementCount,
            paragraphPresenceCount,
            contestedParagraphCount,
            dominantParagraphCount,
            sovereignRatio,
            contestedShareRatio,
          },
        },
      },
      passageShape: {
        passages,
        derived: {
          maxStatementRun,
          passageCount: passages.length,
          inParagraphCount,
          boundaryCrossingCount,
          paragraphSpanningDepth,
        },
      },
      modelTreatment: {
        vector: modelVector,
        derived: {
          dominantPresenceShare: share(maxOrNull(modelPresenceValues), claimPresenceCount),
          dominantSovereignShare: share(maxOrNull(modelSovereignValues), sovereignStatementCount),
          dominantPassageShare: share(maxOrNull(modelPassageValues), totalPassageStatementMass),
          modelEntropy: entropy(modelPresenceValues),
          top2Gap: top2Gap(modelPresenceValues, claimPresenceCount),
          modelsWithEvidence: Object.values(modelVector).filter(
            (model) => model.claimPresenceCount > 0 || model.statementCount > 0
          ).length,
          modelsWithSustainedTreatment: Object.values(modelVector).filter(
            (model) => model.passageRuns > 0
          ).length,
        },
      },
      assignmentHealth: {
        massNative: {
          bothMass,
          competitiveOnlyMass,
          claimCentricOnlyMass,
          keptMass,
          removedMass,
        },
        counts: {
          bothCount: mixed?.bothCount ?? assignmentOriginDistribution.both.count,
          competitiveOnlyCount:
            mixed?.competitiveOnlyCount ?? assignmentOriginDistribution.competitiveOnly.count,
          claimCentricOnlyCount:
            mixed?.claimCentricOnlyCount ?? assignmentOriginDistribution.claimCentricOnly.count,
          keptCount,
          removedCount,
        },
        derived: {
          recoveryRate: keptMass > 0 ? bothMass / keptMass : null,
          expansionRate: keptMass > 0 ? claimCentricOnlyMass / keptMass : null,
          removalRate: totalAssignmentMass > 0 ? removedMass / totalAssignmentMass : null,
          paragraphOriginDistribution: assignmentOriginDistribution,
        },
      },
      diagnostics: {
        // Diagnostic-only flags. They are registered in the measurement guard and
        // must not steer routing, evaluation policy, claim suppression, or conclusions.
        flags: {
          compactSovereign: sovereignRatio != null && sovereignRatio >= 0.67,
          broadShared: contestedShareRatio != null && contestedShareRatio >= 0.5,
          modelConcentrated:
            share(maxOrNull(modelPresenceValues), claimPresenceCount) != null &&
            (share(maxOrNull(modelPresenceValues), claimPresenceCount) ?? 0) >= 0.67,
          crossModelSustained: Object.values(modelVector).filter((model) => model.passageRuns > 0).length >= 2,
          fragmented: passages.length > 1 && maxStatementRun <= 2,
          boundaryCrossing: boundaryCrossingCount > 0,
          assignmentAmbiguous: Object.values(provenanceRefinement?.entries ?? {}).some(
            (entry) => entry.assignedClaims.includes(claimId) && entry.assignedClaims.length > 1
          ),
        },
      },
    };

    byClaimId[claimId] = fingerprint;
  }

  return { byClaimId, missingSubstrate };
}

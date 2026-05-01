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
  presenceMass: number,
  territorialMass: number,
  sovereignMass: number
): number | null {
  if (Math.abs(presenceMass - sovereignMass) <= Number.EPSILON) return null;
  return (territorialMass - sovereignMass) / (presenceMass - sovereignMass);
}

function vectorToRecord(vector: Array<{ paragraphId: string; value: number }> | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const entry of vector ?? []) {
    out[entry.paragraphId] = entry.value;
  }
  return out;
}

function ensureModel(
  vector: Record<string, ClaimStructuralFingerprintModelTreatment>,
  modelId: string
): ClaimStructuralFingerprintModelTreatment {
  const existing = vector[modelId];
  if (existing) return existing;
  const created: ClaimStructuralFingerprintModelTreatment = {
    presenceMass: 0,
    territorialMass: 0,
    sovereignMass: 0,
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
    const presenceByParagraph = vectorToRecord(footprint?.vectors.presenceByParagraph);
    const territorialByParagraph = vectorToRecord(footprint?.vectors.territorialByParagraph);
    const sovereignByParagraph = vectorToRecord(footprint?.vectors.sovereignByParagraph);
    const presenceMass = footprint?.totals.presenceMass ?? 0;
    const territorialMass = footprint?.totals.territorialMass ?? 0;
    const sovereignMass = footprint?.totals.sovereignMass ?? 0;
    const sovereignRatio = footprint?.derived.sovereignRatio ?? null;
    const contestedShareRatio = footprint?.derived.contestedShareRatio ?? null;

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
    for (const coverage of profile?.paragraphCoverage ?? []) {
      const model = ensureModel(modelVector, String(coverage.modelIndex));
      model.presenceMass += coverage.coverage;
      model.territorialMass += territorialByParagraph[coverage.paragraphId] ?? 0;
      model.sovereignMass += sovereignByParagraph[coverage.paragraphId] ?? 0;
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

    const modelPresenceValues = Object.values(modelVector).map((model) => model.presenceMass);
    const modelSovereignValues = Object.values(modelVector).map((model) => model.sovereignMass);
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
        vectors: {
          presenceByParagraph,
          territorialByParagraph,
          sovereignByParagraph,
        },
        totals: {
          presenceMass,
          territorialMass,
          sovereignMass,
        },
        derived: {
          sovereignRatio,
          contestedShareRatio,
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
          dominantPresenceShare: share(maxOrNull(modelPresenceValues), presenceMass),
          dominantSovereignShare: share(maxOrNull(modelSovereignValues), sovereignMass),
          dominantPassageShare: share(maxOrNull(modelPassageValues), totalPassageStatementMass),
          modelEntropy: entropy(modelPresenceValues),
          top2Gap: top2Gap(modelPresenceValues, presenceMass),
          modelsWithEvidence: Object.values(modelVector).filter(
            (model) => model.presenceMass > 0 || model.statementCount > 0
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
            share(maxOrNull(modelPresenceValues), presenceMass) != null &&
            (share(maxOrNull(modelPresenceValues), presenceMass) ?? 0) >= 0.67,
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

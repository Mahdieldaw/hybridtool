export type ClaimFingerprintVector = Record<string, number>;

export type StructuralFingerprintNamespace =
  | 'statement.structuralFingerprint'
  | 'paragraph.structuralFingerprint'
  | 'claim.structuralFingerprint'
  | 'corpus.structuralFingerprint';

export interface StructuralFingerprintGap {
  namespace: StructuralFingerprintNamespace;
  field: string;
  reason: string;
  producerHint: string;
}

export interface ClaimStructuralFingerprintPassage {
  statementIds: string[];
  statementLength: number;
  paragraphMembership: string[];
  paragraphsCrossed: number;
  boundaryCrossing: boolean;
  paragraphSpanningDepth: number;
  inParagraphPassage: boolean;
  modelId: string;
}

export interface ClaimStructuralFingerprintModelTreatment {
  claimPresenceCount: number;
  territorialMass: number;
  sharedTerritorialMass: number;
  sovereignStatementCount: number;
  sharedStatementCount: number;
  paragraphPresenceCount: number;
  contestedParagraphCount: number;
  dominantParagraphCount: number;
  passageRuns: number;
  passageStatementMass: number;
  boundaryCrossingCount: number;
  statementCount: number;
  referentialMass: number | null;
}

export interface ClaimStructuralFingerprint {
  footprint: {
    schemaVersion: 2;
    atoms: Array<{
      claimId: string;
      statementId: string;
      paragraphId: string;
      modelIndex: number;
      ownerCount: number;
      ownershipShare: number;
      isSovereign: boolean;
      isShared: boolean;
    }>;
    rollups: {
      byParagraph: ClaimFingerprintVector;
      byModel: Record<string, {
        claimPresenceCount: number;
        territorialMass: number;
        sharedTerritorialMass: number;
        sovereignStatementCount: number;
        sharedStatementCount: number;
        paragraphPresenceCount: number;
        contestedParagraphCount: number;
        dominantParagraphCount: number;
      }>;
      byClaim: {
        claimPresenceCount: number;
        territorialMass: number;
        sharedTerritorialMass: number;
        sovereignStatementCount: number;
        sharedStatementCount: number;
        paragraphPresenceCount: number;
        contestedParagraphCount: number;
        dominantParagraphCount: number;
        sovereignRatio: number | null;
        contestedShareRatio: number | null;
      };
    };
  };
  passageShape: {
    passages: ClaimStructuralFingerprintPassage[];
    derived: {
      maxStatementRun: number;
      passageCount: number;
      inParagraphCount: number;
      boundaryCrossingCount: number;
      paragraphSpanningDepth: number;
    };
  };
  modelTreatment: {
    vector: Record<string, ClaimStructuralFingerprintModelTreatment>;
    derived: {
      dominantPresenceShare: number | null;
      dominantSovereignShare: number | null;
      dominantPassageShare: number | null;
      modelEntropy: number;
      top2Gap: number | null;
      modelsWithEvidence: number;
      modelsWithSustainedTreatment: number;
    };
  };
  assignmentHealth: {
    massNative: {
      bothMass: number;
      competitiveOnlyMass: number;
      claimCentricOnlyMass: number;
      keptMass: number;
      removedMass: number;
    };
    counts: {
      bothCount: number;
      competitiveOnlyCount: number;
      claimCentricOnlyCount: number;
      keptCount: number;
      removedCount: number;
    };
    derived: {
      recoveryRate: number | null;
      expansionRate: number | null;
      removalRate: number | null;
      paragraphOriginDistribution: Record<
        'both' | 'competitiveOnly' | 'claimCentricOnly',
        { count: number; mass: number }
      >;
    };
  };
  diagnostics: {
    flags: {
      compactSovereign: boolean;
      broadShared: boolean;
      modelConcentrated: boolean;
      crossModelSustained: boolean;
      fragmented: boolean;
      boundaryCrossing: boolean;
      assignmentAmbiguous: boolean;
    };
  };
}

export interface ClaimStructuralFingerprintResult {
  byClaimId: Record<string, ClaimStructuralFingerprint>;
  missingSubstrate: StructuralFingerprintGap[];
}

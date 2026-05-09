import { buildPassageIndex } from './editorial-mapper';

function basePassageRouting(overrides: Record<string, unknown> = {}) {
  return {
    claimProfiles: {
      c1: {
        claimId: 'c1',
        claimStatus: { routeRank: 1, role: 'anchor' },
        claimPresenceCount: 3,
        sovereignStatementCount: 3,
        sharedTerritorialMass: 0,
        contestedShareRatio: null,
        globalTerritoryShare: 1,
        globalSovereignTerritoryShare: 1,
        dominanceExcessShare: 1,
        dominanceStrengthMean: 1,
        sustainedTreatmentShare: 1,
        crossModelSustainedShare: 0.5,
        maxStatementRun: 3,
        dominantPresenceShare: 1,
        dominantPassageShare: 1,
        ...overrides,
      },
    },
    gate: {
      muConcentration: 0,
      sigmaConcentration: 0,
      concentrationThreshold: 0,
      preconditionPassCount: 1,
      loadBearingCount: 1,
    },
    routing: {
      conflictClusters: [],
      routePlan: {
        orderedClaimIds: ['c1'],
        includedClaimIds: ['c1'],
        nonPrimaryClaimIds: [],
        orderingReasonsByClaim: { c1: [] },
        structuralInputsByClaim: {},
      },
      diagnostics: {
        massEligibility: [],
        scalarMigration: [],
        labelExcision: [],
        dominantPresenceDistribution: [],
        dominantPassageDistribution: [],
        totalClaims: 1,
        corpusMode: 'no-geometry',
        peripheralNodeIds: [],
        peripheralRatio: 0,
        largestBasinRatio: null,
      },
    },
    meta: { processingTimeMs: 0 },
  };
}

describe('buildPassageIndex', () => {
  test('marks sole source from model treatment rather than structural contributors', () => {
    const result = buildPassageIndex(
      {
        profiles: {
          c1: {
            statementPassages: [
              {
                modelIndex: 0,
                statementIds: ['s1', 's2', 's3'],
                statementLength: 3,
                startParagraphIndex: 0,
                endParagraphIndex: 0,
                avgCoverage: 1,
                spanParagraphCount: 1,
              },
            ],
          },
        },
        meta: { totalParagraphs: 1, totalModels: 2, processingTimeMs: 0 },
      } as any,
      basePassageRouting() as any,
      {
        claimed: {},
        unclaimedGroups: [],
        summary: {
          totalStatements: 3,
          claimedCount: 3,
          unclaimedCount: 0,
          mixedParagraphCount: 0,
          fullyUnclaimedParagraphCount: 0,
          fullyCoveredParagraphCount: 1,
          unclaimedGroupCount: 0,
        },
        meta: { processingTimeMs: 0 },
      },
      {
        models: [
          {
            modelIndex: 0,
            paragraphs: [
              {
                modelIndex: 0,
                paragraphOrdinal: 0,
                _fullParagraph: 'Evidence text.',
                statements: [],
              },
            ],
          },
        ],
      } as any,
      [
        {
          id: 'c1',
          label: 'Claim 1',
          text: 'Claim text',
          supporters: [0],
          structuralFingerprint: {
            modelTreatment: {
              derived: {
                dominantPresenceShare: 1,
                modelsWithEvidence: 1,
              },
            },
          },
        } as any,
      ],
      { 0: 'Model A' },
      new Map()
    );

    expect(result.passages[0].isSoleSource).toBe(true);
  });
});

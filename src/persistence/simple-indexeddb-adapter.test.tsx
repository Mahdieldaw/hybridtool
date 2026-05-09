import { stripDeprecatedPassageRoutingFieldsForRead } from './simple-indexeddb-adapter';

describe('stripDeprecatedPassageRoutingFieldsForRead', () => {
  test('removes deprecated routing measurements from persisted mapper artifacts', () => {
    const record = {
      id: 'turn-1',
      mapping: {
        claimDensity: {
          profiles: {
            c1: {
              meanCoverage: 0.8,
              meanCoverageInLongestRun: 0.9,
              presenceVector: [{ paragraphId: 'p1', value: 0.8 }],
            },
          },
        },
        passageRouting: {
          claimProfiles: {
            c1: {
              claimId: 'c1',
              claimStatus: { routeRank: 1, role: 'anchor' },
              landscapePosition: 'northStar',
              concentrationRatio: 1,
              densityRatio: 1,
              meanCoverageInLongestRun: 0.9,
              structuralContributors: [0],
              incidentalMentions: [1],
              routingMeasurements: {
                contestedDominance: 0.5,
                contestedShareRatio: 0.25,
              },
            },
            c2: {
              claimId: 'c2',
              claimStatus: { routeRank: null, role: 'passthrough' },
              landscapePosition: 'floor',
            },
          },
          routing: {
            routePlan: {
              includedClaimIds: ['c1'],
              nonPrimaryClaimIds: ['c2'],
            },
            legacyCompatibility: {
              landscapePositionByClaim: {
                c1: 'northStar',
                c2: 'floor',
              },
            },
            loadBearingClaims: [{ claimId: 'c1' }],
            passthrough: ['c2'],
            routedClaimIds: ['c1'],
            diagnostics: {
              floorCount: 1,
              totalClaims: 2,
            },
          },
        },
      },
    };

    const migrated = stripDeprecatedPassageRoutingFieldsForRead(record);
    const passageRouting = migrated.mapping.passageRouting;
    const claimDensity = migrated.mapping.claimDensity;

    expect(claimDensity.profiles.c1).toEqual({
      presenceVector: [{ paragraphId: 'p1', value: 0.8 }],
    });
    expect(passageRouting.claimProfiles.c1).toEqual({
      claimId: 'c1',
      claimStatus: { routeRank: 1, role: 'anchor' },
      routingMeasurements: {
        contestedShareRatio: 0.25,
      },
    });
    expect(passageRouting.claimProfiles.c2).toEqual({
      claimId: 'c2',
      claimStatus: { routeRank: null, role: 'passthrough' },
    });
    expect(passageRouting.routing).toEqual({
      routePlan: {
        includedClaimIds: ['c1'],
        nonPrimaryClaimIds: ['c2'],
      },
      diagnostics: {
        totalClaims: 2,
      },
    });
  });
});

import type { ClaimDensityProfile, ClaimDensityResult } from '../../shared/types';
import type { ShadowParagraph } from '../shadow';
import {
  buildMassEligibilityDiagnostic,
  computeTopologicalSurface,
} from './surface';

function makeProfile(
  overrides: Partial<ClaimDensityProfile> = {}
): ClaimDensityProfile {
  const profile: ClaimDensityProfile = {
    claimId: 'c1',
    paragraphCount: 1,
    passageCount: 0,
    maxPassageLength: 1,
    modelSpread: 1,
    modelsWithPassages: 0,
    totalClaimStatements: 1,
    presenceMass: 99,
    presenceVector: [{ paragraphId: 'p1', value: 0.25 }],
    footprint: makeFootprint('c1', [
      {
        paragraphId: 'p1',
        modelIndex: 0,
        paragraphIndex: 0,
        claimPresenceCount: 1,
        territorialMass: 1,
        sovereignStatementCount: 1,
      },
    ]),
    paragraphCoverage: [
      {
        paragraphId: 'p1',
        modelIndex: 0,
        paragraphIndex: 0,
        totalStatements: 4,
        claimStatements: 1,
        coverage: 0.25,
      },
    ],
    statementPassages: [],
  };

  return {
    ...profile,
    ...overrides,
  };
}

function makeShadowParagraphs(ids: string[] = ['p1']): ShadowParagraph[] {
  return [
    ...ids.map((id, index) => ({
      id,
      modelIndex: index,
      paragraphIndex: index,
      statementIds: [`s${index + 1}`],
      dominantStance: 'assertive',
      stanceHints: ['assertive'],
      contested: false,
      confidence: 1,
      signals: { sequence: false, tension: false, conditional: false },
      statements: [
        {
          id: `s${index + 1}`,
          text: `Statement s${index + 1}`,
          stance: 'assertive',
          signals: [],
        },
      ],
      _fullParagraph: `Statement s${index + 1}`,
    })),
  ];
}

function makeFootprint(
  claimId: string,
  paragraphs: Array<{
    paragraphId: string;
    modelIndex?: number;
    paragraphIndex?: number;
    claimPresenceCount: number;
    territorialMass: number;
    sharedTerritorialMass?: number;
    sovereignStatementCount: number;
    sharedStatementCount?: number;
    totalStatementMass?: number;
    contested?: boolean;
    dominant?: boolean;
  }>
): ClaimDensityProfile['footprint'] {
  const byParagraph = paragraphs.map((p, index) => ({
    paragraphId: p.paragraphId,
    modelIndex: p.modelIndex ?? index,
    paragraphIndex: p.paragraphIndex ?? index,
    claimPresenceCount: p.claimPresenceCount,
    territorialMass: p.territorialMass,
    sharedTerritorialMass: p.sharedTerritorialMass ?? 0,
    sovereignStatementCount: p.sovereignStatementCount,
    sharedStatementCount: p.sharedStatementCount ?? 0,
    totalStatementMass: p.totalStatementMass ?? p.claimPresenceCount,
    paragraphTerritoryShare:
      (p.totalStatementMass ?? p.claimPresenceCount) > 0
        ? p.territorialMass / (p.totalStatementMass ?? p.claimPresenceCount)
        : null,
    contested: p.contested ?? (p.sharedStatementCount ?? 0) > 0,
    dominant: p.dominant ?? true,
  }));
  const claimPresenceCount = byParagraph.reduce((sum, p) => sum + p.claimPresenceCount, 0);
  const territorialMass = byParagraph.reduce((sum, p) => sum + p.territorialMass, 0);
  const sharedTerritorialMass = byParagraph.reduce((sum, p) => sum + p.sharedTerritorialMass, 0);
  const sovereignStatementCount = byParagraph.reduce((sum, p) => sum + p.sovereignStatementCount, 0);
  const sharedStatementCount = byParagraph.reduce((sum, p) => sum + p.sharedStatementCount, 0);
  const paragraphPresenceCount = byParagraph.filter((p) => p.claimPresenceCount > 0).length;
  const contestedParagraphCount = byParagraph.filter((p) => p.contested).length;
  const dominantParagraphCount = byParagraph.filter((p) => p.dominant).length;
  const byModel = Array.from(
    byParagraph.reduce((acc, p) => {
      const existing = acc.get(p.modelIndex) ?? {
        modelIndex: p.modelIndex,
        claimPresenceCount: 0,
        territorialMass: 0,
        sharedTerritorialMass: 0,
        sovereignStatementCount: 0,
        sharedStatementCount: 0,
        paragraphPresenceCount: 0,
        contestedParagraphCount: 0,
        dominantParagraphCount: 0,
      };
      existing.claimPresenceCount += p.claimPresenceCount;
      existing.territorialMass += p.territorialMass;
      existing.sharedTerritorialMass += p.sharedTerritorialMass;
      existing.sovereignStatementCount += p.sovereignStatementCount;
      existing.sharedStatementCount += p.sharedStatementCount;
      existing.paragraphPresenceCount += p.claimPresenceCount > 0 ? 1 : 0;
      existing.contestedParagraphCount += p.contested ? 1 : 0;
      existing.dominantParagraphCount += p.dominant ? 1 : 0;
      acc.set(p.modelIndex, existing);
      return acc;
    }, new Map<number, ClaimDensityProfile['footprint']['rollups']['byModel'][number]>()).values()
  ).sort((a, b) => a.modelIndex - b.modelIndex);

  return {
    schemaVersion: 2,
    atoms: [],
    rollups: {
      byParagraph,
      byModel,
      byClaim: {
        claimId,
        claimPresenceCount,
        territorialMass,
        sharedTerritorialMass,
        sovereignStatementCount,
        sharedStatementCount,
        paragraphPresenceCount,
        contestedParagraphCount,
        dominantParagraphCount,
        sovereignRatio: claimPresenceCount > 0 ? sovereignStatementCount / claimPresenceCount : null,
        contestedShareRatio:
          sharedStatementCount > 0 ? sharedTerritorialMass / sharedStatementCount : null,
      },
    },
  };
}

function runSurfaceWithProfiles(
  profiles: Record<string, ClaimDensityProfile>,
  enrichedClaims: any[]
) {
  const claimDensityResult: ClaimDensityResult = {
    profiles,
    meta: {
      totalParagraphs: Object.values(profiles).reduce(
        (max, profile) => Math.max(max, profile.paragraphCount),
        0
      ),
      totalModels: 2,
      processingTimeMs: 0,
    },
  };

  return computeTopologicalSurface({
    enrichedClaims,
    claimDensityResult,
    validatedConflicts: [],
    modelCount: 2,
    periphery: {
      corpusMode: 'no-geometry',
      peripheralNodeIds: new Set(),
      peripheralRatio: 0,
      largestBasinRatio: null,
      basinByNodeId: {},
    },
    statementEmbeddings: new Map(),
    totalCorpusStatements: Object.keys(profiles).length,
    canonicalSets: new Map(
      Object.keys(profiles).map((claimId, index) => [
        claimId,
        new Set([`s${index + 1}`]),
      ])
    ),
    exclusiveIds: new Map(
      Object.keys(profiles).map((claimId, index) => [claimId, [`s${index + 1}`]])
    ),
    shadowParagraphs: makeShadowParagraphs(['p1', 'p2', 'p3']),
  });
}

function runSurface(profile: ClaimDensityProfile) {
  return runSurfaceWithProfiles(
    { c1: profile },
    [
      {
        id: 'c1',
        label: 'Claim 1',
        text: 'Claim text',
        supporters: [0],
      } as any,
    ]
  );
}

describe('surface mass eligibility', () => {
  test('mass diagnostics read canonical atom rollups rather than legacy presenceMass', () => {
    const diagnostic = buildMassEligibilityDiagnostic('c1', makeProfile(), false);

    expect(diagnostic).toEqual(
      expect.objectContaining({
        oldMajorityEligible: false,
        newFootprintEligible: true,
        claimPresenceCount: 1,
        territorialMass: 1,
        sharedTerritorialMass: 0,
        sovereignStatementCount: 1,
        sharedStatementCount: 0,
        paragraphPresenceCount: 1,
        contestedParagraphCount: 0,
        dominantParagraphCount: 1,
        sovereignRatio: 1,
        contestedShareRatio: null,
        changedEligibility: true,
      })
    );
  });

  test('footprint eligibility does not require a legacy majority paragraph', () => {
    const result = runSurface(makeProfile());
    const routing = result.passageRoutingResult.routing;

    expect(result.passageRoutingResult.gate.preconditionPassCount).toBe(1);
    expect((result.passageRoutingResult.claimProfiles.c1 as any).claimPresenceCount).toBe(1);
    expect((result.passageRoutingResult.claimProfiles.c1 as any).paragraphPresenceCount).toBe(1);
    expect(routing.diagnostics.massEligibility).toEqual([
      expect.objectContaining({
        oldMajorityEligible: false,
        newFootprintEligible: true,
        changedEligibility: true,
      }),
    ]);
    expect(routing.diagnostics.measurementGuardViolations?.map((v) => v.key)).not.toContain(
      'MAJ'
    );
    expect(routing.routePlan.includedClaimIds).toEqual(['c1']);
    expect(routing).not.toHaveProperty('routedClaimIds');
    expect(routing).not.toHaveProperty('loadBearingClaims');
  });

  test('zero canonical presence mass is not footprint-eligible even if legacy coverage is high', () => {
    const result = runSurface(
      makeProfile({
        paragraphCoverage: [
          {
            paragraphId: 'p1',
            modelIndex: 0,
            paragraphIndex: 0,
            totalStatements: 1,
            claimStatements: 1,
            coverage: 1,
          },
        ],
        footprint: makeFootprint('c1', []),
      })
    );

    expect(result.passageRoutingResult.gate.preconditionPassCount).toBe(0);
    expect(result.passageRoutingResult.routing.diagnostics.massEligibility).toEqual([
      expect.objectContaining({
        oldMajorityEligible: true,
        newFootprintEligible: false,
        changedEligibility: true,
      }),
    ]);
    expect(result.passageRoutingResult.routing.routePlan.includedClaimIds).toEqual([]);
    expect(result.passageRoutingResult.routing.routePlan.nonPrimaryClaimIds).toEqual(['c1']);
    expect(result.passageRoutingResult.routing).not.toHaveProperty('passthrough');
    expect(result.passageRoutingResult.routing.diagnostics).not.toHaveProperty('floorCount');
  });

  test('routes expose replacement scalar fields and do not guard deprecated scalar reads', () => {
    const result = runSurface(
      makeProfile({
        paragraphCount: 2,
        maxPassageLength: 4,
        footprint: makeFootprint('c1', [
          {
            paragraphId: 'p1',
            modelIndex: 0,
            paragraphIndex: 0,
            claimPresenceCount: 1,
            territorialMass: 1,
            sovereignStatementCount: 1,
          },
          {
            paragraphId: 'p2',
            modelIndex: 1,
            paragraphIndex: 1,
            claimPresenceCount: 4,
            territorialMass: 3,
            sharedTerritorialMass: 1,
            sovereignStatementCount: 2,
            sharedStatementCount: 2,
          },
        ]),
        paragraphCoverage: [
          {
            paragraphId: 'p1',
            modelIndex: 0,
            paragraphIndex: 0,
            totalStatements: 1,
            claimStatements: 1,
            coverage: 1,
          },
          {
            paragraphId: 'p2',
            modelIndex: 1,
            paragraphIndex: 1,
            totalStatements: 10,
            claimStatements: 1,
            coverage: 0.1,
          },
        ],
        statementPassages: [
          {
            modelIndex: 0,
            statementIds: ['s1', 's2'],
            statementLength: 2,
            startParagraphIndex: 0,
            endParagraphIndex: 0,
            avgCoverage: 1,
            spanParagraphCount: 1,
          },
          {
            modelIndex: 1,
            statementIds: ['s3', 's4', 's5', 's6'],
            statementLength: 4,
            startParagraphIndex: 1,
            endParagraphIndex: 1,
            avgCoverage: 0.1,
            spanParagraphCount: 1,
          },
        ],
      })
    );
    const profile = result.passageRoutingResult.claimProfiles.c1;
    const scalarDiagnostic = result.passageRoutingResult.routing.diagnostics.scalarMigration[0];

    expect(profile.contestedShareRatio).toBe(0.5);
    expect(profile.dominantPresenceShare).toBe(0.8);
    expect(profile.dominantPassageShare).toBeCloseTo(4 / 6);
    expect(profile.maxStatementRun).toBe(4);
    expect(profile).not.toHaveProperty('concentrationRatio');
    expect(profile).not.toHaveProperty('densityRatio');
    expect(profile).not.toHaveProperty('meanCoverageInLongestRun');
    expect(profile).not.toHaveProperty('structuralContributors');
    expect(profile).not.toHaveProperty('incidentalMentions');
    expect(profile.routingMeasurements).not.toHaveProperty('contestedDominance');
    expect((profile as any).claimPresenceCount).toBe(5);
    expect((profile as any).paragraphPresenceCount).toBe(2);
    expect((profile as any).contestedParagraphCount).toBe(0);
    expect((profile as any).sharedTerritorialMass).toBe(1);
    expect((profile as any).sovereignStatementCount).toBe(3);
    expect(result.passageRoutingResult.routing.routePlan.structuralInputsByClaim.c1).toEqual(
      expect.objectContaining({
        claimPresenceCount: 5,
        sharedTerritorialMass: 1,
        sovereignStatementCount: 3,
        contestedShareRatio: 0.5,
        dominantPresenceShare: 0.8,
        dominantPassageShare: expect.any(Number),
        maxStatementRun: 4,
      })
    );
    expect(result.passageRoutingResult.routing).not.toHaveProperty('loadBearingClaims');
    expect(scalarDiagnostic).toEqual(
      expect.objectContaining({
        contestedShareRatio: 0.5,
        dominantPresenceShare: 0.8,
        maxStatementRun: 4,
      })
    );
    expect(scalarDiagnostic).not.toHaveProperty('legacyContestedDominance');
    expect(scalarDiagnostic).not.toHaveProperty('legacyConcentrationRatio');
    expect(scalarDiagnostic).not.toHaveProperty('legacyDensityRatio');
    expect(scalarDiagnostic).not.toHaveProperty('legacyMeanCoverageInLongestRun');
    expect(
      result.passageRoutingResult.routing.diagnostics.measurementGuardViolations?.map(
        (violation) => violation.key
      )
    ).toEqual(
      expect.not.arrayContaining([
        'contestedDominance',
        'concentrationRatio',
        'densityRatio',
        'meanCoverageInLongestRun',
      ])
    );
  });

  test('routePlan and claimStatus replace deprecated route mirrors', () => {
    const c1 = makeProfile({
      claimId: 'c1',
      footprint: makeFootprint('c1', [
        {
          paragraphId: 'p1',
          modelIndex: 0,
          paragraphIndex: 0,
          claimPresenceCount: 2,
          territorialMass: 2,
          sovereignStatementCount: 2,
        },
      ]),
    });
    const c2 = makeProfile({
      claimId: 'c2',
      footprint: makeFootprint('c2', [
        {
          paragraphId: 'p2',
          modelIndex: 0,
          paragraphIndex: 1,
          claimPresenceCount: 1,
          territorialMass: 0.5,
          sharedTerritorialMass: 0.5,
          sovereignStatementCount: 0,
          sharedStatementCount: 1,
        },
      ]),
      paragraphCoverage: [
        {
          paragraphId: 'p2',
          modelIndex: 0,
          paragraphIndex: 1,
          totalStatements: 1,
          claimStatements: 1,
          coverage: 1,
        },
      ],
    });
    const c3 = makeProfile({
      claimId: 'c3',
      footprint: makeFootprint('c3', []),
      paragraphCoverage: [],
      statementPassages: [],
    });

    const result = runSurfaceWithProfiles(
      { c1, c2, c3 },
      [
        { id: 'c1', label: 'Claim 1', text: 'Claim text', supporters: [0, 1] },
        { id: 'c2', label: 'Claim 2', text: 'Claim text', supporters: [] },
        { id: 'c3', label: 'Claim 3', text: 'Claim text', supporters: [] },
      ]
    );
    const routing = result.passageRoutingResult.routing;
    const labelKeys = [
      'northStar',
      'eastStar',
      'mechanism',
      'floor',
      'leadMinority',
      'landscapePosition',
    ];

    expect(routing.routePlan.includedClaimIds).toEqual(routing.routePlan.orderedClaimIds);
    expect(routing.routePlan.includedClaimIds).toEqual(expect.arrayContaining(['c1', 'c2']));
    expect(routing.routePlan.nonPrimaryClaimIds).toEqual(['c3']);
    expect(routing).not.toHaveProperty('loadBearingClaims');
    expect(routing).not.toHaveProperty('routedClaimIds');
    expect(routing).not.toHaveProperty('passthrough');
    expect(routing).not.toHaveProperty('legacyCompatibility');
    expect(routing.diagnostics).not.toHaveProperty('floorCount');
    expect(JSON.stringify(routing.routePlan)).not.toMatch(
      /northStar|eastStar|mechanism|floor|leadMinority|landscapePosition/
    );
    expect(result.passageRoutingResult.claimProfiles.c3.claimStatus.role).toBe('passthrough');
    expect(result.passageRoutingResult.claimProfiles.c3).not.toHaveProperty('landscapePosition');
    expect(routing.diagnostics.labelExcision).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          claimId: 'c1',
          newRoutePlanInclusion: true,
          routeOrderIndex: expect.any(Number),
          consumersRemoved: expect.arrayContaining(['routing', 'editorial prompt input']),
        }),
        expect.objectContaining({
          claimId: 'c3',
          newRoutePlanInclusion: false,
          routeOrderIndex: null,
        }),
      ])
    );
    expect(
      routing.diagnostics.measurementGuardViolations?.map((violation) => violation.key) ?? []
    ).toEqual(expect.not.arrayContaining(labelKeys));
    expect(routing.routePlan).not.toHaveProperty('policyPosition');
    expect(routing.routePlan).not.toHaveProperty('projectedLandscapePosition');
    expect(routing.routePlan).not.toHaveProperty('isRouted');
    expect(routing.routePlan).not.toHaveProperty('isPassthrough');
  });

  test('continuous dominance strength orders equally dominant claims', () => {
    const strongDominance = makeProfile({
      claimId: 'strong',
      paragraphCount: 1,
      maxPassageLength: 2,
      footprint: makeFootprint('strong', [
        {
          paragraphId: 'p1',
          modelIndex: 0,
          paragraphIndex: 0,
          claimPresenceCount: 9,
          territorialMass: 9,
          sovereignStatementCount: 9,
          totalStatementMass: 10,
          dominant: true,
        },
      ]),
      statementPassages: [
        {
          modelIndex: 0,
          statementIds: ['s1', 's2'],
          statementLength: 2,
          startParagraphIndex: 0,
          endParagraphIndex: 0,
          avgCoverage: 0.9,
          spanParagraphCount: 1,
        },
      ],
    });
    const weakDominance = makeProfile({
      claimId: 'weak',
      paragraphCount: 1,
      maxPassageLength: 2,
      footprint: makeFootprint('weak', [
        {
          paragraphId: 'p2',
          modelIndex: 1,
          paragraphIndex: 1,
          claimPresenceCount: 13,
          territorialMass: 13,
          sovereignStatementCount: 13,
          totalStatementMass: 20,
          dominant: true,
        },
      ]),
      statementPassages: [
        {
          modelIndex: 1,
          statementIds: ['s3', 's4'],
          statementLength: 2,
          startParagraphIndex: 1,
          endParagraphIndex: 1,
          avgCoverage: 0.65,
          spanParagraphCount: 1,
        },
      ],
    });

    const result = runSurfaceWithProfiles(
      { strong: strongDominance, weak: weakDominance },
      [
        { id: 'strong', label: 'Strong', text: 'Strong claim', supporters: [0] },
        { id: 'weak', label: 'Weak', text: 'Weak claim', supporters: [1] },
      ]
    );
    const inputs = result.passageRoutingResult.routing.routePlan.structuralInputsByClaim as any;

    expect(inputs.strong.dominantParagraphCount).toBe(1);
    expect(inputs.weak.dominantParagraphCount).toBe(1);
    expect(inputs.strong.dominanceStrengthMean).toBeCloseTo(0.9);
    expect(inputs.weak.dominanceStrengthMean).toBeCloseTo(0.65);
    expect(inputs.strong.dominanceExcessShare).toBeGreaterThan(
      inputs.weak.dominanceExcessShare
    );
    expect(result.passageRoutingResult.routing.routePlan.includedClaimIds.slice(0, 2)).toEqual([
      'strong',
      'weak',
    ]);
  });

  test('global sovereign share uses total claim territory as denominator', () => {
    const c1 = makeProfile({
      claimId: 'c1',
      footprint: makeFootprint('c1', [
        {
          paragraphId: 'p1',
          claimPresenceCount: 3,
          territorialMass: 3,
          sharedTerritorialMass: 1,
          sovereignStatementCount: 2,
          sharedStatementCount: 2,
          totalStatementMass: 4,
        },
      ]),
    });
    const c2 = makeProfile({
      claimId: 'c2',
      footprint: makeFootprint('c2', [
        {
          paragraphId: 'p2',
          claimPresenceCount: 1,
          territorialMass: 1,
          sovereignStatementCount: 1,
          totalStatementMass: 4,
        },
      ]),
    });

    const result = runSurfaceWithProfiles(
      { c1, c2 },
      [
        { id: 'c1', label: 'Claim 1', text: 'Claim text', supporters: [0] },
        { id: 'c2', label: 'Claim 2', text: 'Claim text', supporters: [1] },
      ]
    );
    const c1Inputs = result.passageRoutingResult.routing.routePlan
      .structuralInputsByClaim.c1 as any;

    expect(c1Inputs.sovereignTerritoryMass).toBe(2);
    expect(c1Inputs.globalSovereignTerritoryShare).toBeCloseTo(2 / 4);
    expect(c1Inputs.globalTerritoryShare).toBeCloseTo(3 / 4);
    expect(c1Inputs.globalSovereignTerritoryShare).not.toBeCloseTo(2 / 2);
  });

  test('query distance remains diagnostic and does not steer route ordering', () => {
    const structurallyStrong = makeProfile({
      claimId: 'structural',
      maxPassageLength: 2,
      queryDistance: 1,
      footprint: makeFootprint('structural', [
        {
          paragraphId: 'p1',
          claimPresenceCount: 9,
          territorialMass: 9,
          sovereignStatementCount: 9,
          totalStatementMass: 10,
        },
      ]),
    });
    const queryNear = makeProfile({
      claimId: 'near',
      maxPassageLength: 2,
      queryDistance: 0,
      footprint: makeFootprint('near', [
        {
          paragraphId: 'p2',
          claimPresenceCount: 13,
          territorialMass: 13,
          sovereignStatementCount: 13,
          totalStatementMass: 20,
        },
      ]),
    });

    const result = runSurfaceWithProfiles(
      { structural: structurallyStrong, near: queryNear },
      [
        { id: 'structural', label: 'Structural', text: 'Structural claim', supporters: [0] },
        { id: 'near', label: 'Query near', text: 'Query-near claim', supporters: [1] },
      ]
    );
    const structuralInputs = result.passageRoutingResult.routing.routePlan
      .structuralInputsByClaim as any;

    expect(structuralInputs.structural.queryDistance).toBeUndefined();
    expect(structuralInputs.near.queryDistance).toBeUndefined();
    expect(result.passageRoutingResult.claimProfiles.structural.queryDistance).toBe(1);
    expect(result.passageRoutingResult.claimProfiles.near.queryDistance).toBe(0);
    expect(result.passageRoutingResult.routing.routePlan.includedClaimIds.slice(0, 2)).toEqual([
      'structural',
      'near',
    ]);
  });
});

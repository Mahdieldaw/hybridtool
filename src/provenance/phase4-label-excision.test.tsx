import type { ClaimDensityProfile, ClaimDensityResult } from '../../shared/types';
import type { ShadowParagraph } from '../shadow';
import { buildEditorialPrompt, type IndexedPassage } from '../concierge-service/editorial-mapper';
import { computeTopologicalSurface } from './surface';

const LABEL_KEYS = [
  'northStar',
  'eastStar',
  'mechanism',
  'floor',
  'leadMinority',
  'landscapePosition',
];

function makeProfile(overrides: Partial<ClaimDensityProfile> = {}): ClaimDensityProfile {
  const profile: ClaimDensityProfile = {
    claimId: 'c1',
    paragraphCount: 1,
    passageCount: 1,
    maxPassageLength: 3,
    meanCoverageInLongestRun: 1,
    modelSpread: 1,
    modelsWithPassages: 1,
    totalClaimStatements: 3,
    presenceMass: 3,
    meanCoverage: 1,
    presenceVector: [{ paragraphId: 'p1', value: 3 }],
    footprint: {
      schemaVersion: 2,
      atoms: [],
      rollups: {
        byParagraph: [
          {
            paragraphId: 'p1',
            modelIndex: 0,
            paragraphIndex: 0,
            claimPresenceCount: 3,
            territorialMass: 3,
            sharedTerritorialMass: 0,
            sovereignStatementCount: 3,
            sharedStatementCount: 0,
            contested: false,
            dominant: true,
          },
        ],
        byModel: [
          {
            modelIndex: 0,
            claimPresenceCount: 3,
            territorialMass: 3,
            sharedTerritorialMass: 0,
            sovereignStatementCount: 3,
            sharedStatementCount: 0,
            paragraphPresenceCount: 1,
            contestedParagraphCount: 0,
            dominantParagraphCount: 1,
          },
        ],
        byClaim: {
          claimId: 'c1',
          claimPresenceCount: 3,
          territorialMass: 3,
          sharedTerritorialMass: 0,
          sovereignStatementCount: 3,
          sharedStatementCount: 0,
          paragraphPresenceCount: 1,
          contestedParagraphCount: 0,
          dominantParagraphCount: 1,
          sovereignRatio: 1,
          contestedShareRatio: null,
        },
      },
    },
    paragraphCoverage: [
      {
        paragraphId: 'p1',
        modelIndex: 0,
        paragraphIndex: 0,
        totalStatements: 3,
        claimStatements: 3,
        coverage: 1,
      },
    ],
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
  };

  return { ...profile, ...overrides };
}

function makeShadowParagraphs(): ShadowParagraph[] {
  return [
    {
      id: 'p1',
      modelIndex: 0,
      paragraphIndex: 0,
      statementIds: ['s1', 's2', 's3'],
      dominantStance: 'assertive',
      stanceHints: ['assertive'],
      contested: false,
      confidence: 1,
      signals: { sequence: false, tension: false, conditional: false },
      statements: [
        { id: 's1', text: 'Statement one.', stance: 'assertive', signals: [] },
        { id: 's2', text: 'Statement two.', stance: 'assertive', signals: [] },
        { id: 's3', text: 'Statement three.', stance: 'assertive', signals: [] },
      ],
      _fullParagraph: 'Statement one. Statement two. Statement three.',
    },
  ];
}

function runSurface(profiles: Record<string, ClaimDensityProfile>) {
  const claimDensityResult: ClaimDensityResult = {
    profiles,
    meta: { totalParagraphs: 1, totalModels: 2, processingTimeMs: 0 },
  };

  return computeTopologicalSurface({
    enrichedClaims: [
      { id: 'c1', label: 'Claim 1', text: 'Claim one.', supporters: [0] } as any,
      { id: 'c2', label: 'Claim 2', text: 'Claim two.', supporters: [] } as any,
    ],
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
    totalCorpusStatements: 3,
    canonicalSets: new Map([['c1', new Set(['s1', 's2', 's3'])]]),
    exclusiveIds: new Map([['c1', ['s1', 's2', 's3']]]),
    shadowParagraphs: makeShadowParagraphs(),
  });
}

describe('Phase 4 label excision', () => {
  test('active routing derives route artifact from routePlan structural state', () => {
    const result = runSurface({ c1: makeProfile() });
    const routing = result.passageRoutingResult.routing;

    expect(routing.routePlan).toEqual({
      orderedClaimIds: ['c1'],
      includedClaimIds: ['c1'],
      nonPrimaryClaimIds: ['c2'],
      orderingReasonsByClaim: expect.any(Object),
      structuralInputsByClaim: expect.any(Object),
    });
    expect(routing.routedClaimIds).toEqual(routing.routePlan.includedClaimIds);
    expect(routing.passthrough).toEqual(routing.routePlan.nonPrimaryClaimIds);
    expect(routing.diagnostics.floorCount).toBe(routing.routePlan.nonPrimaryClaimIds.length);
    expect(routing.loadBearingClaims.map((claim) => claim.claimId)).toEqual(
      routing.routePlan.includedClaimIds
    );
    expect(JSON.stringify(routing.routePlan)).not.toMatch(
      /northStar|eastStar|mechanism|floor|leadMinority|policyPosition|passthroughRole|routedStatus|primaryRole/
    );
  });

  test('legacy labels are emitted only in legacyCompatibility and not guard-collected', () => {
    const result = runSurface({ c1: makeProfile() });
    const routing = result.passageRoutingResult.routing;

    expect(routing.legacyCompatibility.landscapePositionByClaim).toEqual({
      c1: 'northStar',
      c2: 'floor',
    });
    expect(routing.diagnostics.labelExcision).toEqual([
      expect.objectContaining({
        claimId: 'c1',
        oldLegacyLandscapePosition: 'northStar',
        newRoutePlanInclusion: true,
        routeOrderIndex: 0,
      }),
      expect.objectContaining({
        claimId: 'c2',
        oldLegacyLandscapePosition: 'floor',
        newRoutePlanInclusion: false,
        routeOrderIndex: null,
      }),
    ]);
    const guardKeys = routing.diagnostics.measurementGuardViolations?.map((v) => v.key) ?? [];
    expect(guardKeys).toEqual(expect.not.arrayContaining(LABEL_KEYS));
  });

  test('buildEditorialPrompt is free of landscape label inputs and output text', () => {
    const passages: IndexedPassage[] = [
      {
        passageKey: 'c1:0:0',
        claimId: 'c1',
        claimLabel: 'Claim 1',
        modelIndex: 0,
        modelName: 'Model A',
        startParagraphIndex: 0,
        endParagraphIndex: 0,
        paragraphCount: 1,
        statementLength: 3,
        text: 'Evidence text.',
        routeOrderIndex: 0,
        routeIncluded: true,
        routeOrderingReasons: ['claimPresenceCount=3'],
        claimPresenceCount: 3,
        sovereignStatementCount: 3,
        sharedTerritorialMass: 0,
        contestedShareRatio: null,
        maxStatementRun: 3,
        dominantPresenceShare: 1,
        dominantPassageShare: 1,
        isSoleSource: true,
        conflictClusterIndex: null,
        continuity: { prev: null, next: null },
      },
    ];

    const prompt = buildEditorialPrompt('question?', passages, [], {
      passageCount: 1,
      claimCount: 1,
      conflictCount: 0,
    });

    expect(prompt).not.toContain('Landscape:');
    expect(prompt).not.toMatch(/northStar|eastStar|mechanism|floor|leadMinority/);
    expect(prompt).toContain('claimPresenceCount=3');
    expect(prompt).toContain('Route: included, order=0');
  });
});

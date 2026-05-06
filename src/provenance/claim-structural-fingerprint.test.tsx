import type { ClaimDensityResult, MixedProvenanceResult } from '../../shared/types';
import type { MeasurementViolation } from '../../shared/measurement-registry';
import type { ShadowParagraph, ShadowStatement } from '../shadow';
import { assertMeasurementConsumer } from '../../shared/measurement-registry';
import { computeClaimFootprintMeasurement } from './measure';
import {
  buildClaimStructuralFingerprints,
  computeContestedShareRatio,
} from './claim-structural-fingerprint';

function makeStatement(id: string, modelIndex: number): ShadowStatement {
  return {
    id,
    modelIndex,
    text: `Statement ${id}`,
    cleanText: `Statement ${id}`,
    stance: 'assertive',
    confidence: 1,
    signals: { sequence: false, tension: false, conditional: false },
    location: { paragraphIndex: 0, sentenceIndex: 0 },
    fullParagraph: `Paragraph for ${id}`,
  };
}

function makeParagraph(
  id: string,
  modelIndex: number,
  paragraphIndex: number,
  statementIds: string[]
): ShadowParagraph {
  return {
    id,
    modelIndex,
    paragraphIndex,
    statementIds,
    dominantStance: 'assertive',
    stanceHints: ['assertive'],
    contested: false,
    confidence: 1,
    signals: { sequence: false, tension: false, conditional: false },
    statements: statementIds.map((sid) => ({
      id: sid,
      text: `Statement ${sid}`,
      stance: 'assertive',
      signals: [],
    })),
    _fullParagraph: `Full ${id}`,
  };
}

function makeFingerprint() {
  const shadowStatements = [
    makeStatement('s1', 0),
    makeStatement('s2', 0),
    makeStatement('s3', 1),
  ];
  const shadowParagraphs = [
    makeParagraph('p1', 0, 0, ['s1', 's2']),
    makeParagraph('p2', 1, 1, ['s3']),
  ];
  const ownershipMap = new Map([
    ['s1', new Set(['c1'])],
    ['s2', new Set(['c1', 'c2'])],
    ['s3', new Set(['c1'])],
  ]);
  const footprint = computeClaimFootprintMeasurement({
    claimId: 'c1',
    canonicalStatementIds: ['s1', 's2', 's3'],
    ownershipMap,
    stmtToParagraphId: new Map([
      ['s1', 'p1'],
      ['s2', 'p1'],
      ['s3', 'p2'],
    ]),
    statementsById: new Map(shadowStatements.map((statement) => [statement.id, statement])),
    paragraphOrder: new Map([
      ['p1', 0],
      ['p2', 1],
    ]),
    paragraphMeta: new Map([
      ['p1', { modelIndex: 0, paragraphIndex: 0, totalStatements: 2 }],
      ['p2', { modelIndex: 1, paragraphIndex: 1, totalStatements: 1 }],
    ]),
  });
  const claimDensityResult: ClaimDensityResult = {
    profiles: {
      c1: {
        claimId: 'c1',
        paragraphCount: 2,
        passageCount: 1,
        maxPassageLength: 3,
        meanCoverageInLongestRun: 1,
        modelSpread: 2,
        modelsWithPassages: 1,
        totalClaimStatements: 3,
        presenceMass: 2,
        meanCoverage: 1,
        presenceVector: [
          { paragraphId: 'p1', value: 1 },
          { paragraphId: 'p2', value: 1 },
        ],
        footprint,
        paragraphCoverage: [
          {
            paragraphId: 'p1',
            modelIndex: 0,
            paragraphIndex: 0,
            totalStatements: 2,
            claimStatements: 2,
            coverage: 1,
          },
          {
            paragraphId: 'p2',
            modelIndex: 1,
            paragraphIndex: 1,
            totalStatements: 1,
            claimStatements: 1,
            coverage: 1,
          },
        ],
        statementPassages: [
          {
            modelIndex: 0,
            statementIds: ['s1', 's2', 's3'],
            statementLength: 3,
            startParagraphIndex: 0,
            endParagraphIndex: 1,
            avgCoverage: 1,
            spanParagraphCount: 2,
          },
        ],
      },
    },
    meta: { totalParagraphs: 2, totalModels: 2, processingTimeMs: 0 },
  };
  const mixedProvenanceResult: MixedProvenanceResult = {
    perClaim: {
      c1: {
        claimId: 'c1',
        ccMu: 0,
        ccSigma: 0,
        ccThreshold: 0,
        mergedParagraphs: [],
        statements: [
          {
            statementId: 's1',
            globalSim: 1,
            kept: true,
            fromSupporterModel: true,
            paragraphOrigin: 'both',
            paragraphId: 'p1',
            zone: 'core',
          },
          {
            statementId: 's2',
            globalSim: 1,
            kept: false,
            fromSupporterModel: true,
            paragraphOrigin: 'claim-centric-only',
            paragraphId: 'p1',
            zone: 'removed',
          },
          {
            statementId: 's3',
            globalSim: 1,
            kept: true,
            fromSupporterModel: true,
            paragraphOrigin: 'competitive-only',
            paragraphId: 'p2',
            zone: 'core',
          },
        ],
        globalMu: 0,
        removedCount: 1,
        totalCount: 3,
        bothCount: 1,
        competitiveOnlyCount: 1,
        claimCentricOnlyCount: 1,
        canonicalStatementIds: ['s1', 's2', 's3'],
      },
    },
    recoveryRate: 0,
    expansionRate: 0,
    removalRate: 0,
  };

  return buildClaimStructuralFingerprints({
    claimIds: ['c1'],
    claimDensityResult,
    mixedProvenanceResult,
    canonicalSets: new Map([['c1', new Set(['s1', 's2', 's3'])]]),
    shadowParagraphs,
    shadowStatements,
  });
}

describe('claim structural fingerprint', () => {
  test('canonical footprint atoms and rollups are produced from assignment ownership', () => {
    const statements = [
      makeStatement('s1', 0),
      makeStatement('s2', 0),
      makeStatement('s3', 1),
    ];
    const footprint = computeClaimFootprintMeasurement({
      claimId: 'c1',
      canonicalStatementIds: ['s1', 's2', 's3'],
      ownershipMap: new Map([
        ['s1', new Set(['c1'])],
        ['s2', new Set(['c1', 'c2'])],
        ['s3', new Set(['c1'])],
      ]),
      stmtToParagraphId: new Map([
        ['s1', 'p1'],
        ['s2', 'p1'],
        ['s3', 'p2'],
      ]),
      statementsById: new Map(statements.map((statement) => [statement.id, statement])),
      paragraphOrder: new Map([
        ['p1', 0],
        ['p2', 1],
      ]),
    });

    expect(footprint.schemaVersion).toBe(2);
    expect(footprint.atoms).toEqual([
      expect.objectContaining({
        statementId: 's1',
        claimId: 'c1',
        paragraphId: 'p1',
        modelIndex: 0,
        ownerCount: 1,
        claimPresence: 1,
        ownershipShare: 1,
        isSovereign: true,
        isShared: false,
      }),
      expect.objectContaining({
        statementId: 's2',
        claimId: 'c1',
        paragraphId: 'p1',
        modelIndex: 0,
        owners: ['c1', 'c2'],
        ownerCount: 2,
        claimPresence: 1,
        ownershipShare: 0.5,
        isSovereign: false,
        isShared: true,
      }),
      expect.objectContaining({
        statementId: 's3',
        claimId: 'c1',
        paragraphId: 'p2',
        modelIndex: 1,
        ownerCount: 1,
        claimPresence: 1,
        ownershipShare: 1,
        isSovereign: true,
        isShared: false,
      }),
    ]);
    expect(footprint.rollups.byParagraph).toEqual([
      expect.objectContaining({
        paragraphId: 'p1',
        modelIndex: 0,
        claimPresenceCount: 2,
        territorialMass: 1.5,
        sharedTerritorialMass: 0.5,
        sovereignStatementCount: 1,
        sharedStatementCount: 1,
      }),
      expect.objectContaining({
        paragraphId: 'p2',
        modelIndex: 1,
        claimPresenceCount: 1,
        territorialMass: 1,
        sharedTerritorialMass: 0,
        sovereignStatementCount: 1,
        sharedStatementCount: 0,
      }),
    ]);
    expect(footprint.rollups.byClaim).toEqual({
      claimId: 'c1',
      claimPresenceCount: 3,
      territorialMass: 2.5,
      sharedTerritorialMass: 0.5,
      sovereignStatementCount: 2,
      sharedStatementCount: 1,
      paragraphPresenceCount: 2,
      contestedParagraphCount: 1,
      dominantParagraphCount: 2,
      sovereignRatio: 2 / 3,
      contestedShareRatio: 0.5,
    });
    expect(JSON.stringify(footprint)).not.toContain('presenceByParagraph');
  });

  test('zero-presence claims have empty atoms and zero rollups', () => {
    const footprint = computeClaimFootprintMeasurement({
      claimId: 'empty',
      canonicalStatementIds: [],
      ownershipMap: new Map(),
      stmtToParagraphId: new Map(),
      statementsById: new Map(),
      paragraphOrder: new Map(),
    });

    expect(footprint.atoms).toEqual([]);
    expect(footprint.rollups.byParagraph).toEqual([]);
    expect(footprint.rollups.byModel).toEqual([]);
    expect(footprint.rollups.byClaim).toEqual({
      claimId: 'empty',
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
    });
  });

  test('contested paragraphs count paragraph co-presence separately from shared atoms', () => {
    const statements = [
      makeStatement('s1', 0),
      makeStatement('s2', 0),
    ];
    const footprint = computeClaimFootprintMeasurement({
      claimId: 'c1',
      canonicalStatementIds: ['s1'],
      ownershipMap: new Map([
        ['s1', new Set(['c1'])],
        ['s2', new Set(['c2'])],
      ]),
      stmtToParagraphId: new Map([
        ['s1', 'p1'],
        ['s2', 'p1'],
      ]),
      statementsById: new Map(statements.map((statement) => [statement.id, statement])),
      paragraphOrder: new Map([['p1', 0]]),
    });

    expect(footprint.rollups.byClaim).toEqual(
      expect.objectContaining({
        claimPresenceCount: 1,
        sharedTerritorialMass: 0,
        sharedStatementCount: 0,
        paragraphPresenceCount: 1,
        contestedParagraphCount: 1,
        dominantParagraphCount: 0,
        contestedShareRatio: null,
      })
    );
  });

  test('builds footprint rollups and does not require legacy routing fields', () => {
    const result = makeFingerprint();
    const fingerprint = result.byClaimId.c1;

    expect(fingerprint.footprint.schemaVersion).toBe(2);
    expect(fingerprint.footprint.rollups.byParagraph).toEqual({ p1: 2, p2: 1 });
    expect(fingerprint.footprint.rollups.byClaim).toEqual(
      expect.objectContaining({
        claimPresenceCount: 3,
        territorialMass: 2.5,
        sharedTerritorialMass: 0.5,
        sovereignStatementCount: 2,
        sharedStatementCount: 1,
        paragraphPresenceCount: 2,
        contestedParagraphCount: 1,
        dominantParagraphCount: 2,
        contestedShareRatio: 0.5,
      })
    );
    expect(JSON.stringify(result.missingSubstrate)).not.toContain('footprint.vectors');

    const serialized = JSON.stringify(fingerprint);
    expect(serialized).not.toContain('MAJ');
    expect(serialized).not.toContain('northStar');
    expect(serialized).not.toContain('contestedDominance');
    expect(serialized).not.toContain('concentrationRatio');
    expect(serialized).not.toContain('densityRatio');
  });

  test('contestedShareRatio is direct shared territorial mass over shared atoms', () => {
    expect(computeContestedShareRatio(0, 0)).toBeNull();
    expect(computeContestedShareRatio(0.5, 1)).toBe(0.5);
  });

  test('diagnostic flags are not licensed for routing', () => {
    const collector: MeasurementViolation[] = [];

    assertMeasurementConsumer(
      'claim.structuralFingerprint.diagnostics.flags.compactSovereign',
      'routing',
      { mode: 'collect', collector, context: 'fingerprint diagnostics test' }
    );

    expect(collector).toHaveLength(1);
    expect(collector[0].reason).toBe('forbidden');
    expect(() =>
      assertMeasurementConsumer(
        'claim.structuralFingerprint.diagnostics.flags.compactSovereign',
        'routing'
      )
    ).toThrow(/Forbidden measurement consumption/);
  });

  test('collector mode gathers multiple violations', () => {
    const collector: MeasurementViolation[] = [];

    assertMeasurementConsumer('northStar', 'routing', {
      mode: 'collect',
      collector,
      context: 'collector test',
    });
    assertMeasurementConsumer('landscapePosition', 'routing', {
      mode: 'collect',
      collector,
      context: 'collector test',
    });
    assertMeasurementConsumer('validatedConflict', 'routing', {
      mode: 'collect',
      collector,
      context: 'collector test',
    });

    expect(collector.map((violation) => violation.key)).toEqual([
      'northStar',
      'landscapePosition',
      'validatedConflict',
    ]);
    expect(() => assertMeasurementConsumer('northStar', 'legacyCompatibility')).not.toThrow();
    expect(() => assertMeasurementConsumer('landscapePosition', 'legacyCompatibility')).not.toThrow();
  });
});

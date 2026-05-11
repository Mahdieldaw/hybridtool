import type { ShadowParagraph, ShadowStatement } from '../shadow';
import type {
  ClaimParagraphEnvironmentEntry,
  ScopeDenominatorTable,
  StatementPassageEntry,
} from '../../shared/types';
import {
  buildScopeDenominatorTable,
  computeClaimFootprintMeasurement,
  computeClaimParagraphEnvironment,
} from './measure';
import { getScopeDenominator, scopedShare } from '../../shared/scoped-mass';

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

function buildHarness(opts: {
  paragraphs: ShadowParagraph[];
  statements: ShadowStatement[];
  ownership: Record<string, string[]>;
  competitivePool: Record<string, string[]>;
}) {
  const statementsById = new Map<string, ShadowStatement>(
    opts.statements.map((s) => [s.id, s])
  );
  const paragraphById = new Map<string, ShadowParagraph>(
    opts.paragraphs.map((p) => [p.id, p])
  );
  const stmtToParagraphId = new Map<string, string>();
  for (const para of opts.paragraphs) {
    for (const sid of para.statementIds) stmtToParagraphId.set(sid, para.id);
  }
  const paragraphOrder = new Map<string, number>();
  const paragraphMeta = new Map<
    string,
    { modelIndex: number; paragraphIndex: number; totalStatements: number }
  >();
  opts.paragraphs.forEach((para, index) => {
    paragraphOrder.set(para.id, index);
    paragraphMeta.set(para.id, {
      modelIndex: para.modelIndex,
      paragraphIndex: para.paragraphIndex,
      totalStatements: para.statementIds.filter(
        (sid) => !statementsById.get(sid)?.isTableCell
      ).length,
    });
  });
  const ownershipMap = new Map<string, Set<string>>();
  for (const [sid, owners] of Object.entries(opts.ownership)) {
    if (owners.length > 0) ownershipMap.set(sid, new Set(owners));
  }
  return {
    statementsById,
    paragraphById,
    stmtToParagraphId,
    paragraphOrder,
    paragraphMeta,
    ownershipMap,
    competitivePool: opts.competitivePool,
  };
}

function entryFor(
  entries: ClaimParagraphEnvironmentEntry[],
  claimId: string,
  paragraphId: string
): ClaimParagraphEnvironmentEntry {
  const found = entries.find(
    (e) => e.claimId === claimId && e.paragraphId === paragraphId
  );
  if (!found) {
    throw new Error(
      `Missing environment entry for claim ${claimId} paragraph ${paragraphId}`
    );
  }
  return found;
}

function approxEqual(actual: number, expected: number, epsilon = 1e-9): void {
  expect(Math.abs(actual - expected)).toBeLessThan(epsilon);
}

describe('claim paragraph environment partition', () => {
  const statements = [
    makeStatement('s1', 0),
    makeStatement('s2', 0),
    makeStatement('s3', 0),
    makeStatement('s4', 1),
    makeStatement('s5', 1),
    makeStatement('s6', 1),
    makeStatement('s7', 1),
    makeStatement('s8', 1),
  ];
  const paragraphs = [
    makeParagraph('p_ab', 0, 0, ['s1', 's2', 's3', 's4', 's5']),
    makeParagraph('p_au', 1, 1, ['s6', 's7', 's8']),
  ];
  // p_ab : c1 owns s1,s2,s3 ; c2 owns s4,s5     → A A A B B
  // p_au : c1 owns s6 ; s7,s8 unclaimed        (and s8 unclaimed) → A U U
  // Adjust to make exactly A A A U U for the distinguishing test:
  statements.push(
    makeStatement('s9', 1),
    makeStatement('s10', 1)
  );
  paragraphs[1] = makeParagraph('p_au', 1, 1, ['s6', 's9', 's10', 's7', 's8']);

  const harness = buildHarness({
    paragraphs,
    statements,
    ownership: {
      s1: ['c1'],
      s2: ['c1'],
      s3: ['c1'],
      s4: ['c2'],
      s5: ['c2'],
      s6: ['c1'],
      s9: ['c1'],
      s10: ['c1'],
      // s7, s8 → unclaimed
    },
    competitivePool: {
      c1: ['p_ab', 'p_au'],
      c2: ['p_ab'],
    },
  });

  const envC1 = computeClaimParagraphEnvironment({
    claimId: 'c1',
    ownershipMap: harness.ownershipMap,
    competitivePoolParagraphIds: harness.competitivePool.c1,
    paragraphById: harness.paragraphById,
    statementsById: harness.statementsById,
    stmtToParagraphId: harness.stmtToParagraphId,
    paragraphMeta: harness.paragraphMeta,
    paragraphOrder: harness.paragraphOrder,
  });

  test('per-statement partition sums to 1', () => {
    for (const entry of envC1.entries) {
      for (const stmt of entry.statements) {
        approxEqual(stmt.selfShare + stmt.rivalShare + stmt.unclaimedShare, 1);
      }
    }
  });

  test('per-entry mass partition sums to statementCount', () => {
    for (const entry of envC1.entries) {
      approxEqual(
        entry.totals.selfTerritoryMass +
          entry.totals.rivalTerritoryMass +
          entry.totals.unclaimedTerritoryMass,
        entry.totals.statementCount
      );
      expect(
        entry.totals.claimedStatementCount + entry.totals.unclaimedStatementCount
      ).toBe(entry.totals.statementCount);
    }
  });

  test('relation discriminator agrees with selfTerritoryMass sign', () => {
    for (const entry of envC1.entries) {
      if (entry.relation === 'ownedFootprint') {
        expect(entry.totals.selfTerritoryMass).toBeGreaterThan(0);
      } else {
        expect(entry.totals.selfTerritoryMass).toBe(0);
      }
    }
  });

  test('A A A B B vs A A A U U have equal selfMass but distinct rival/unclaimed', () => {
    const ab = entryFor(envC1.entries, 'c1', 'p_ab');
    const au = entryFor(envC1.entries, 'c1', 'p_au');
    approxEqual(ab.totals.selfTerritoryMass, 3);
    approxEqual(au.totals.selfTerritoryMass, 3);
    approxEqual(ab.totals.rivalTerritoryMass, 2);
    approxEqual(ab.totals.unclaimedTerritoryMass, 0);
    approxEqual(au.totals.rivalTerritoryMass, 0);
    approxEqual(au.totals.unclaimedTerritoryMass, 2);
  });

  test('selfTerritoryMass equals footprint paragraph territorialMass for ownedFootprint entries', () => {
    const footprint = computeClaimFootprintMeasurement({
      claimId: 'c1',
      canonicalStatementIds: ['s1', 's2', 's3', 's6', 's9', 's10'],
      ownershipMap: harness.ownershipMap,
      stmtToParagraphId: harness.stmtToParagraphId,
      statementsById: harness.statementsById,
      paragraphOrder: harness.paragraphOrder,
      paragraphMeta: harness.paragraphMeta,
    });
    const fpByPara = new Map(
      footprint.rollups.byParagraph.map((p) => [p.paragraphId, p])
    );
    for (const entry of envC1.entries) {
      if (entry.relation !== 'ownedFootprint') continue;
      const fp = fpByPara.get(entry.paragraphId);
      expect(fp).toBeDefined();
      approxEqual(entry.totals.selfTerritoryMass, fp!.territorialMass);
    }
  });
});

describe('claim paragraph environment — relation gating', () => {
  const statements = [
    makeStatement('s1', 0),
    makeStatement('s2', 0),
    makeStatement('s3', 1),
    makeStatement('s4', 1),
  ];
  const paragraphs = [
    makeParagraph('p1', 0, 0, ['s1', 's2']),
    makeParagraph('p2', 1, 1, ['s3', 's4']),
  ];
  const harness = buildHarness({
    paragraphs,
    statements,
    ownership: {
      s1: ['c1'],
      s2: ['c1'],
      s3: ['c2'],
      s4: ['c2'],
    },
    competitivePool: {
      c1: ['p1', 'p2'],
      c2: ['p1', 'p2'],
    },
  });

  test('competitive-pool paragraph with zero ownership becomes competitiveCandidate, not ownedFootprint', () => {
    const env = computeClaimParagraphEnvironment({
      claimId: 'c1',
      ownershipMap: harness.ownershipMap,
      competitivePoolParagraphIds: harness.competitivePool.c1,
      paragraphById: harness.paragraphById,
      statementsById: harness.statementsById,
      stmtToParagraphId: harness.stmtToParagraphId,
      paragraphMeta: harness.paragraphMeta,
      paragraphOrder: harness.paragraphOrder,
    });
    const p1 = entryFor(env.entries, 'c1', 'p1');
    const p2 = entryFor(env.entries, 'c1', 'p2');
    expect(p1.relation).toBe('ownedFootprint');
    expect(p2.relation).toBe('competitiveCandidate');
    approxEqual(p2.totals.selfTerritoryMass, 0);
    approxEqual(p2.totals.rivalTerritoryMass, 2);
  });

  test('paragraphs outside the competitive pool with zero ownership are not emitted', () => {
    const env = computeClaimParagraphEnvironment({
      claimId: 'c1',
      ownershipMap: harness.ownershipMap,
      competitivePoolParagraphIds: ['p1'], // p2 NOT in pool
      paragraphById: harness.paragraphById,
      statementsById: harness.statementsById,
      stmtToParagraphId: harness.stmtToParagraphId,
      paragraphMeta: harness.paragraphMeta,
      paragraphOrder: harness.paragraphOrder,
    });
    expect(env.entries.find((e) => e.paragraphId === 'p2')).toBeUndefined();
  });
});

describe('scope denominator table + scopedShare', () => {
  const statements = [
    makeStatement('s1', 0),
    makeStatement('s2', 0),
    makeStatement('s3', 1),
    makeStatement('s4', 1),
    makeStatement('s5', 1),
  ];
  const paragraphs = [
    makeParagraph('p1', 0, 0, ['s1', 's2']),
    makeParagraph('p2', 1, 1, ['s3', 's4', 's5']),
  ];
  const ownershipMap = new Map<string, Set<string>>([
    ['s1', new Set(['c1'])],
    ['s2', new Set(['c1', 'c2'])],
    ['s3', new Set(['c2'])],
    // s4, s5 → unclaimed
  ]);
  const paragraphToRegionIds = new Map<string, string[]>([
    ['p1', ['r1']],
    ['p2', ['r1', 'r2']],
  ]);
  const passages: StatementPassageEntry[] = [
    {
      modelIndex: 1,
      statementIds: ['s3', 's4'],
      statementLength: 2,
      startParagraphIndex: 1,
      endParagraphIndex: 1,
      avgCoverage: 1,
      spanParagraphCount: 1,
    },
  ];
  const table: ScopeDenominatorTable = buildScopeDenominatorTable({
    shadowStatements: statements,
    shadowParagraphs: paragraphs,
    ownershipMap,
    paragraphToRegionIds,
    statementPassagesByClaim: new Map([['c2', passages]]),
  });

  test('corpus row counts all/claimed/unclaimed correctly', () => {
    const corpus = table.byScope.find((r) => r.scopeKind === 'corpus');
    expect(corpus).toBeDefined();
    expect(corpus!.statementCount).toBe(5);
    expect(corpus!.claimedStatementCount).toBe(3);
    expect(corpus!.unclaimedStatementCount).toBe(2);
  });

  test('paragraph rows partition into claimed + unclaimed', () => {
    for (const row of table.byScope.filter((r) => r.scopeKind === 'paragraph')) {
      expect(row.claimedStatementCount + row.unclaimedStatementCount).toBe(
        row.statementCount
      );
    }
    const p2 = table.byScope.find(
      (r) => r.scopeKind === 'paragraph' && r.scopeId === 'p2'
    );
    expect(p2!.statementCount).toBe(3);
    expect(p2!.claimedStatementCount).toBe(1);
    expect(p2!.unclaimedStatementCount).toBe(2);
  });

  test('region rows accumulate across overlapping paragraphs', () => {
    const r1 = table.byScope.find(
      (r) => r.scopeKind === 'region' && r.scopeId === 'r1'
    );
    expect(r1!.statementCount).toBe(5);
    const r2 = table.byScope.find(
      (r) => r.scopeKind === 'region' && r.scopeId === 'r2'
    );
    expect(r2!.statementCount).toBe(3);
  });

  test('passage rows are claim-prefixed and have claimed === all', () => {
    const passageRows = table.byScope.filter((r) => r.scopeKind === 'passage');
    expect(passageRows.length).toBe(1);
    expect(passageRows[0].scopeId.startsWith('c2#')).toBe(true);
    expect(passageRows[0].claimedStatementCount).toBe(passageRows[0].statementCount);
    expect(passageRows[0].unclaimedStatementCount).toBe(0);
  });

  test('scopedShare returns weight / denominator per mode', () => {
    expect(scopedShare(2, { kind: 'corpus', id: 'corpus' }, table, 'all')).toBe(2 / 5);
    expect(scopedShare(2, { kind: 'corpus', id: 'corpus' }, table, 'claimed')).toBe(2 / 3);
    expect(scopedShare(2, { kind: 'corpus', id: 'corpus' }, table, 'unclaimed')).toBe(2 / 2);
  });

  test('scopedShare returns null for unknown scope and zero denominator', () => {
    expect(
      scopedShare(1, { kind: 'paragraph', id: 'nonexistent' }, table)
    ).toBeNull();
    const emptyTable = buildScopeDenominatorTable({
      shadowStatements: [],
      shadowParagraphs: [],
      ownershipMap: new Map(),
      paragraphToRegionIds: new Map(),
      statementPassagesByClaim: new Map(),
    });
    expect(
      scopedShare(1, { kind: 'corpus', id: 'corpus' }, emptyTable, 'claimed')
    ).toBeNull();
  });

  test('getScopeDenominator returns same denominator scopedShare consumes', () => {
    expect(
      getScopeDenominator(table, { kind: 'paragraph', id: 'p2' }, 'unclaimed')
    ).toBe(2);
    expect(
      getScopeDenominator(table, { kind: 'model', id: '1' }, 'all')
    ).toBe(3);
  });

  test('paragraph scope counts agree with environment entry statementCount', () => {
    const harness = buildHarness({
      paragraphs,
      statements,
      ownership: {
        s1: ['c1'],
        s2: ['c1', 'c2'],
        s3: ['c2'],
      },
      competitivePool: { c1: ['p1', 'p2'] },
    });
    const env = computeClaimParagraphEnvironment({
      claimId: 'c1',
      ownershipMap: harness.ownershipMap,
      competitivePoolParagraphIds: harness.competitivePool.c1,
      paragraphById: harness.paragraphById,
      statementsById: harness.statementsById,
      stmtToParagraphId: harness.stmtToParagraphId,
      paragraphMeta: harness.paragraphMeta,
      paragraphOrder: harness.paragraphOrder,
    });
    for (const entry of env.entries) {
      const row = table.byScope.find(
        (r) => r.scopeKind === 'paragraph' && r.scopeId === entry.paragraphId
      );
      expect(row).toBeDefined();
      expect(entry.totals.statementCount).toBe(row!.statementCount);
      expect(entry.totals.claimedStatementCount).toBe(row!.claimedStatementCount);
      expect(entry.totals.unclaimedStatementCount).toBe(row!.unclaimedStatementCount);
    }
  });
});

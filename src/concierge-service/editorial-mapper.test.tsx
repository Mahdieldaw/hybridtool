import { buildUnclaimedRuns, buildUnclaimedStatementMeta, parseEditorialOutput } from './editorial-mapper';
import type { CorpusTree } from '../../shared/types/corpus-tree';

function makeCorpus(): CorpusTree {
  return {
    models: [
      {
        modelIndex: 1,
        paragraphs: [
          {
            paragraphId: 'p1',
            modelIndex: 1,
            paragraphOrdinal: 0,
            statements: [
              { statementId: 's1', paragraphId: 'p1', modelIndex: 1, statementOrdinal: 0, text: 'Claimed A.' },
              { statementId: 's2', paragraphId: 'p1', modelIndex: 1, statementOrdinal: 1, text: 'Unclaimed B.' },
              { statementId: 's3', paragraphId: 'p1', modelIndex: 1, statementOrdinal: 2, text: 'Unclaimed C.' },
              { statementId: 's4', paragraphId: 'p1', modelIndex: 1, statementOrdinal: 3, text: 'Claimed D.' },
            ],
          },
          {
            paragraphId: 'p2',
            modelIndex: 1,
            paragraphOrdinal: 1,
            statements: [
              { statementId: 's5', paragraphId: 'p2', modelIndex: 1, statementOrdinal: 0, text: 'Unclaimed E.' },
            ],
          },
        ],
      },
      {
        modelIndex: 2,
        paragraphs: [
          {
            paragraphId: 'p3',
            modelIndex: 2,
            paragraphOrdinal: 0,
            statements: [
              { statementId: 's10', paragraphId: 'p3', modelIndex: 2, statementOrdinal: 0, text: 'Claimed F.' },
            ],
          },
        ],
      },
    ],
  };
}

describe('buildUnclaimedRuns', () => {
  test('groups consecutive unclaimed statements into runs with stable IDs', () => {
    const corpus = makeCorpus();
    const claimed = new Set(['s1', 's4', 's10']);
    const runs = buildUnclaimedRuns(corpus, claimed);

    // Model 1: [s2,s3] (run 1), [s5] (run 2). Model 2: nothing.
    expect(runs).toHaveLength(2);
    expect(runs[0].runId).toBe('u_m1_1');
    expect(runs[0].statementIds).toEqual(['s2', 's3']);
    expect(runs[1].runId).toBe('u_m1_2');
    expect(runs[1].statementIds).toEqual(['s5']);
  });

  test('returns no runs when every statement is claimed', () => {
    const corpus = makeCorpus();
    const claimed = new Set(['s1', 's2', 's3', 's4', 's5', 's10']);
    expect(buildUnclaimedRuns(corpus, claimed)).toHaveLength(0);
  });
});

describe('buildUnclaimedStatementMeta', () => {
  test('maps unclaimed statement IDs to corpus sort keys', () => {
    const corpus = makeCorpus();
    const claimed = new Set(['s1', 's4', 's10']);
    const meta = buildUnclaimedStatementMeta(corpus, claimed);

    expect(meta.has('s2')).toBe(true);
    expect(meta.has('s3')).toBe(true);
    expect(meta.has('s5')).toBe(true);
    expect(meta.has('s1')).toBe(false); // claimed
    expect(meta.get('s2')).toEqual({ modelIndex: 1, paragraphOrdinal: 0, statementOrdinal: 1 });
    expect(meta.get('s5')).toEqual({ modelIndex: 1, paragraphOrdinal: 1, statementOrdinal: 0 });
  });
});

describe('parseEditorialOutput', () => {
  const validClaims = new Set(['claim_1', 'claim_2']);
  const corpus = makeCorpus();
  const claimed = new Set(['s1', 's4', 's10']);
  const stmtMeta = buildUnclaimedStatementMeta(corpus, claimed);

  test('parses threads with claim and surfaced_unclaimed items', () => {
    const json = JSON.stringify({
      orientation: 'A line.',
      threads: [
        {
          id: 'thread_1',
          label: 'A',
          why_care: 'because',
          start_here: true,
          items: [
            { type: 'claim', id: 'claim_1', role: 'anchor' },
            { type: 'surfaced_unclaimed', role: 'development', statement_ids: ['s2', 's3'] },
          ],
        },
      ],
      thread_order: ['thread_1'],
      diagnostics: { flat_corpus: false, notes: '' },
    });
    const raw = '```json\n' + json + '\n```';
    const result = parseEditorialOutput(raw, validClaims, stmtMeta);

    expect(result.success).toBe(true);
    expect(result.ast?.threads).toHaveLength(1);

    const items = result.ast!.threads[0].items;
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({ type: 'claim', id: 'claim_1', role: 'anchor' });
    expect(items[1].type).toBe('surfaced_unclaimed');
    expect(items[1].id).toMatch(/^su_thread_1_/);
    expect((items[1] as any).statement_ids).toEqual(['s2', 's3']); // already in canonical order

    expect(result.ast?.surfacedUnclaimed).toHaveLength(1);
    expect(result.ast?.surfacedUnclaimed[0].statementIds).toEqual(['s2', 's3']);
    expect(result.ast?.surfacedUnclaimed[0].threadId).toBe('thread_1');
  });

  test('canonically sorts statement IDs regardless of model output order', () => {
    const json = JSON.stringify({
      orientation: 'A.',
      threads: [
        {
          id: 't1',
          label: 'X',
          why_care: '',
          start_here: true,
          items: [
            { type: 'claim', id: 'claim_1', role: 'anchor' },
            // s5 comes before s2 in model output — should be sorted to s2, s5
            { type: 'surfaced_unclaimed', role: 'development', statement_ids: ['s5', 's2'] },
          ],
        },
      ],
      thread_order: ['t1'],
      diagnostics: { flat_corpus: false, notes: '' },
    });
    const result = parseEditorialOutput('```json\n' + json + '\n```', validClaims, stmtMeta);
    expect(result.success).toBe(true);
    // s2: modelIndex=1, para=0, stmt=1  — s5: modelIndex=1, para=1, stmt=0
    // s2 has lower paragraphOrdinal so comes first
    expect(result.ast?.surfacedUnclaimed[0].statementIds).toEqual(['s2', 's5']);
  });

  test('drops unknown statement IDs from surfaced_unclaimed', () => {
    const json = JSON.stringify({
      orientation: 'A.',
      threads: [
        {
          id: 't1',
          label: 'X',
          why_care: '',
          start_here: true,
          items: [
            { type: 'claim', id: 'claim_1', role: 'anchor' },
            { type: 'surfaced_unclaimed', role: 'development', statement_ids: ['s2', 'made_up_id'] },
          ],
        },
      ],
      thread_order: ['t1'],
      diagnostics: { flat_corpus: false, notes: '' },
    });
    const result = parseEditorialOutput('```json\n' + json + '\n```', validClaims, stmtMeta);
    expect(result.success).toBe(true);
    expect(result.ast?.surfacedUnclaimed[0].statementIds).toEqual(['s2']);
    expect(result.errors.some((e) => e.includes('made_up_id'))).toBe(true);
  });

  test('drops items with hallucinated claim IDs', () => {
    const json = JSON.stringify({
      orientation: 'A.',
      threads: [
        {
          id: 't1',
          label: 'X',
          why_care: '',
          start_here: true,
          items: [
            { type: 'claim', id: 'claim_1', role: 'anchor' },
            { type: 'claim', id: 'made_up_claim', role: 'development' },
          ],
        },
      ],
      thread_order: ['t1'],
      diagnostics: { flat_corpus: false, notes: '' },
    });
    const result = parseEditorialOutput('```json\n' + json + '\n```', validClaims, stmtMeta);
    expect(result.success).toBe(true);
    expect(result.ast?.threads[0].items).toHaveLength(1);
    expect(result.ast?.surfacedUnclaimed).toHaveLength(0);
    expect(result.errors.some((e) => e.includes('Hallucinated'))).toBe(true);
  });

  test('drops surfaced_unclaimed item when all statement IDs are invalid', () => {
    const json = JSON.stringify({
      orientation: 'A.',
      threads: [
        {
          id: 't1',
          label: 'X',
          why_care: '',
          start_here: true,
          items: [
            { type: 'claim', id: 'claim_1', role: 'anchor' },
            { type: 'surfaced_unclaimed', role: 'development', statement_ids: ['bad_id_1', 'bad_id_2'] },
          ],
        },
      ],
      thread_order: ['t1'],
      diagnostics: { flat_corpus: false, notes: '' },
    });
    const result = parseEditorialOutput('```json\n' + json + '\n```', validClaims, stmtMeta);
    expect(result.success).toBe(true);
    expect(result.ast?.threads[0].items).toHaveLength(1);
    expect(result.ast?.surfacedUnclaimed).toHaveLength(0);
  });

  test('handles legacy items without type field as claims', () => {
    const json = JSON.stringify({
      orientation: 'A.',
      threads: [
        {
          id: 't1',
          label: 'X',
          why_care: '',
          start_here: true,
          items: [
            { id: 'claim_1', role: 'anchor' }, // no type field
          ],
        },
      ],
      thread_order: ['t1'],
      diagnostics: { flat_corpus: false, notes: '' },
    });
    const result = parseEditorialOutput('```json\n' + json + '\n```', validClaims, stmtMeta);
    expect(result.success).toBe(true);
    expect(result.ast?.threads[0].items[0]).toEqual({ type: 'claim', id: 'claim_1', role: 'anchor' });
  });
});

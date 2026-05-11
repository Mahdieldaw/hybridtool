import { buildUnclaimedRuns, parseEditorialOutput } from './editorial-mapper';
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

describe('parseEditorialOutput', () => {
  const validClaims = new Set(['claim_1', 'claim_2']);
  const validRuns = new Set(['u_m1_1', 'u_m1_2']);

  test('parses threads referencing claim and run IDs, tracks elevated runs', () => {
    const json = JSON.stringify({
      orientation: 'A line.',
      threads: [
        {
          id: 'thread_1',
          label: 'A',
          why_care: 'because',
          start_here: true,
          items: [
            { id: 'claim_1', role: 'anchor' },
            { id: 'u_m1_1', role: 'support' },
          ],
        },
      ],
      thread_order: ['thread_1'],
      diagnostics: { flat_corpus: false, notes: '' },
    });
    const raw = '```json\n' + json + '\n```';
    const result = parseEditorialOutput(raw, validClaims, validRuns);
    expect(result.success).toBe(true);
    expect(result.ast?.threads).toHaveLength(1);
    expect(result.ast?.elevatedRunIds).toEqual(['u_m1_1']);
  });

  test('drops items with hallucinated IDs', () => {
    const json = JSON.stringify({
      orientation: 'A line.',
      threads: [
        {
          id: 'thread_1',
          label: 'A',
          why_care: '',
          start_here: true,
          items: [
            { id: 'claim_1', role: 'anchor' },
            { id: 'made_up_id', role: 'support' },
          ],
        },
      ],
      thread_order: ['thread_1'],
      diagnostics: { flat_corpus: false, notes: '' },
    });
    const raw = '```json\n' + json + '\n```';
    const result = parseEditorialOutput(raw, validClaims, validRuns);
    expect(result.success).toBe(true);
    expect(result.ast?.threads[0].items).toHaveLength(1);
    expect(result.ast?.elevatedRunIds).toEqual([]);
    expect(result.errors.some((e) => e.includes('Hallucinated'))).toBe(true);
  });
});

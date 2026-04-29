import type { NodeLocalStats } from './types';
import type { ShadowParagraph } from '../shadow/shadow-paragraph-projector';
import type { ShadowStatement } from '../shadow/shadow-extractor';
import { computeQueryRelevance } from './annotate';

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

describe('computeQueryRelevance', () => {
  test('returns querySimilarity for each statement', () => {
    const nodes: NodeLocalStats[] = [
      {
        paragraphId: 'p0',
        modelIndex: 0,
        dominantStance: 'assertive',
        contested: false,
        statementIds: ['s0'],
        recognitionMass: 0,
        mutualNeighborhoodPatch: ['p0', 'p1'],
        mutualRankDegree: 4,
      },
      {
        paragraphId: 'p1',
        modelIndex: 1,
        dominantStance: 'assertive',
        contested: false,
        statementIds: ['s1'],
        recognitionMass: 0,
        mutualNeighborhoodPatch: ['p1', 'p0'],
        mutualRankDegree: 4,
      },
      {
        paragraphId: 'p2',
        modelIndex: 0,
        dominantStance: 'assertive',
        contested: false,
        statementIds: ['s2'],
        recognitionMass: 1,
        mutualNeighborhoodPatch: [],
        mutualRankDegree: 0,
      },
    ];

    const statements: ShadowStatement[] = nodes.map((n, i) => makeStatement(`s${i}`, n.modelIndex));
    const paragraphs: ShadowParagraph[] = nodes.map((n, i) =>
      makeParagraph(n.paragraphId, n.modelIndex, i, [`s${i}`])
    );

    const statementEmbeddings = new Map<string, Float32Array>([
      ['s0', new Float32Array([1, 0])],
      ['s1', new Float32Array([1, 0])],
      ['s2', new Float32Array([0, 1])],
    ]);
    const queryEmbedding = new Float32Array([1, 0]);

    const result = computeQueryRelevance({
      queryEmbedding,
      statements,
      statementEmbeddings,
      paragraphEmbeddings: null,
      paragraphs,
    });

    const s0 = result.statementScores.get('s0');
    const s2 = result.statementScores.get('s2');

    expect(s0).toBeDefined();
    expect(s2).toBeDefined();
    // s0 aligned with query → querySimilarity near 1
    expect(s0!.querySimilarity).toBeGreaterThan(0.9);
    // s2 orthogonal to query → querySimilarity near 0.0 (raw cosine)
    expect(s2!.querySimilarity).toBeCloseTo(0.0, 1);
  });
});

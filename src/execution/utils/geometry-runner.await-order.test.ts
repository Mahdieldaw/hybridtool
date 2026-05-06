jest.mock('../../clustering/index.js', () => ({
  DEFAULT_CONFIG: { modelId: 'fixture-model', embeddingDimensions: 3 },
  getEmbeddingStatus: jest.fn(),
  generateTextEmbeddings: jest.fn(),
  generateEmbeddings: jest.fn(),
  generateStatementEmbeddings: jest.fn(),
  stripInlineMarkdown: (text: string) => text,
  structuredTruncate: (text: string) => text,
}));

import { buildGeometryAsync } from './geometry-runner';
import {
  generateEmbeddings,
  generateStatementEmbeddings,
  generateTextEmbeddings,
  getEmbeddingStatus,
} from '../../clustering/index.js';
import type { ShadowParagraph, ShadowStatement } from '../../shadow';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function vec(values: number[]): Float32Array {
  return new Float32Array(values);
}

const signals = { sequence: false, tension: false, conditional: false };

function makeStatement(id: string, modelIndex: number): ShadowStatement {
  return {
    id,
    modelIndex,
    text: `Statement ${id}`,
    cleanText: `Statement ${id}`,
    stance: 'assertive',
    confidence: 1,
    signals,
    location: { paragraphIndex: modelIndex, sentenceIndex: 0 },
    fullParagraph: `Statement ${id}`,
  };
}

function makeParagraph(statement: ShadowStatement): ShadowParagraph {
  return {
    id: `p_${statement.modelIndex}`,
    modelIndex: statement.modelIndex,
    paragraphIndex: statement.modelIndex,
    statementIds: [statement.id],
    dominantStance: 'assertive',
    stanceHints: ['assertive'],
    contested: false,
    confidence: 1,
    signals,
    statements: [{ id: statement.id, text: statement.text, stance: 'assertive', signals: [] }],
    _fullParagraph: statement.fullParagraph,
  };
}

describe('buildGeometryAsync embedding await guard', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test('embedding jobs start before the join and diagnostics remain per-promise', async () => {
    const statements = [
      makeStatement('s_1', 1),
      makeStatement('s_2', 2),
      makeStatement('s_3', 3),
    ];
    const paragraphs = statements.map(makeParagraph);
    const query = deferred<{ embeddings: Map<string, Float32Array> }>();
    const paragraph = deferred<{
      embeddings: Map<string, Float32Array>;
      semanticDensityScores: Map<string, number>;
    }>();
    const statement = deferred<{
      embeddings: Map<string, Float32Array>;
      statementCount: number;
    }>();
    const starts: string[] = [];

    (getEmbeddingStatus as jest.Mock).mockResolvedValue({ backend: 'wasm' });
    (generateTextEmbeddings as jest.Mock).mockImplementation(() => {
      starts.push('query');
      return query.promise;
    });
    (generateEmbeddings as jest.Mock).mockImplementation(() => {
      starts.push('paragraph');
      return paragraph.promise;
    });
    (generateStatementEmbeddings as jest.Mock).mockImplementation(() => {
      starts.push('statement');
      return statement.promise;
    });

    const diagnostics = { stages: {} as Record<string, unknown> };
    const run = buildGeometryAsync(
      { paragraphs },
      { statements },
      {},
      { originalPrompt: 'fixture query' },
      {},
      {},
      diagnostics,
      () => 0,
      { modelId: 'fixture-model', embeddingDimensions: 3 }
    );

    await Promise.resolve();
    await Promise.resolve();

    expect(starts).toEqual(['query', 'paragraph', 'statement']);

    paragraph.resolve({
      embeddings: new Map([
        ['p_1', vec([1, 0, 0])],
        ['p_2', vec([1, 0, 0])],
        ['p_3', vec([0, 1, 0])],
      ]),
      semanticDensityScores: new Map(),
    });
    statement.resolve({
      embeddings: new Map([
        ['s_1', vec([1, 0, 0])],
        ['s_2', vec([1, 0, 0])],
        ['s_3', vec([0, 1, 0])],
      ]),
      statementCount: 3,
    });
    query.resolve({ embeddings: new Map([['0', vec([1, 0, 0])]]) });

    const result = await run;

    expect(result.queryEmbedding).toEqual(vec([1, 0, 0]));
    expect(diagnostics.stages).toEqual(
      expect.objectContaining({
        queryEmbedding: expect.objectContaining({ status: 'ok', dimensions: 3 }),
        paragraphEmbeddings: expect.objectContaining({
          status: 'ok',
          paragraphs: 3,
          paragraphEmbeddings: 3,
        }),
        statementEmbeddings: expect.objectContaining({
          status: 'ok',
          statements: 3,
          embedded: 3,
        }),
      })
    );
  });
});

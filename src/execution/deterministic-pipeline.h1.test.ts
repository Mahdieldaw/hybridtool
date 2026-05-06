import {
  buildArtifactForProvider,
  executeArtifactPipeline,
} from './deterministic-pipeline';
import { buildGeometricSubstrate } from '../geometry/measure';
import { buildPreSemanticInterpretation } from '../geometry/interpret';
import { computeQueryRelevance } from '../geometry/annotate';
import type { ShadowParagraph, ShadowStatement } from '../shadow';

const signals = { sequence: false, tension: false, conditional: false };

function vec(values: number[]): Float32Array {
  return new Float32Array(values);
}

function makeStatement(
  id: string,
  modelIndex: number,
  paragraphIndex: number,
  text: string
): ShadowStatement {
  return {
    id,
    modelIndex,
    text,
    cleanText: text,
    stance: 'assertive',
    confidence: 1,
    signals,
    location: { paragraphIndex, sentenceIndex: 0 },
    fullParagraph: text,
  };
}

function makeParagraph(statement: ShadowStatement): ShadowParagraph {
  return {
    id: `p_${statement.modelIndex}`,
    modelIndex: statement.modelIndex,
    paragraphIndex: statement.location.paragraphIndex,
    statementIds: [statement.id],
    dominantStance: 'assertive',
    stanceHints: ['assertive'],
    contested: false,
    confidence: 1,
    signals,
    statements: [
      {
        id: statement.id,
        text: statement.text,
        stance: 'assertive',
        signals: [],
      },
    ],
    _fullParagraph: statement.fullParagraph,
  };
}

function makeFixture() {
  const shadowStatements = [
    makeStatement('s_1', 1, 0, 'Models one and two share the same grounded premise.'),
    makeStatement('s_2', 2, 0, 'The second model repeats that grounded premise.'),
    makeStatement('s_3', 3, 0, 'The third model supplies a separate caution.'),
  ];
  const shadowParagraphs = shadowStatements.map(makeParagraph);
  const statementEmbeddings = new Map<string, Float32Array>([
    ['s_1', vec([1, 0, 0])],
    ['s_2', vec([1, 0, 0])],
    ['s_3', vec([0, 1, 0])],
  ]);
  const paragraphEmbeddings = new Map<string, Float32Array>([
    ['p_1', vec([1, 0, 0])],
    ['p_2', vec([1, 0, 0])],
    ['p_3', vec([0, 1, 0])],
  ]);
  const queryEmbedding = vec([1, 0, 0]);
  const claimEmbeddings = new Map<string, Float32Array>([['claim_1', vec([1, 0, 0])]]);
  const parsedMappingResult = {
    narrative: 'Shared ground narrative.',
    claims: [
      {
        id: 'claim_1',
        label: 'Shared Ground',
        text: 'Models one and two converge on the same premise.',
        supporters: [1, 2],
      },
    ],
    edges: [],
  };
  const mappingText = `<narrative>Shared ground narrative.</narrative>
<map>${JSON.stringify({
    claims: parsedMappingResult.claims,
    edges: parsedMappingResult.edges,
  })}</map>`;
  const citationSourceOrder = { 1: 'gemini', 2: 'qwen', 3: 'chatgpt' };

  const substrate = buildGeometricSubstrate(shadowParagraphs, paragraphEmbeddings, 'wasm');
  const preSemantic = buildPreSemanticInterpretation(substrate, paragraphEmbeddings);
  const queryRelevance = computeQueryRelevance({
    queryEmbedding,
    statements: shadowStatements,
    statementEmbeddings,
    paragraphEmbeddings,
    paragraphs: shadowParagraphs,
  });

  return {
    shadowStatements,
    shadowParagraphs,
    statementEmbeddings,
    paragraphEmbeddings,
    queryEmbedding,
    claimEmbeddings,
    parsedMappingResult,
    mappingText,
    citationSourceOrder,
    substrate,
    preSemantic,
    queryRelevance,
  };
}

function stable(value: unknown, keyName = ''): unknown {
  if (value instanceof Float32Array) return Array.from(value);
  if (value instanceof Map) {
    return {
      __map: Array.from(value.entries())
        .sort(([a], [b]) => String(a).localeCompare(String(b)))
        .map(([key, entry]) => [key, stable(entry)]),
    };
  }
  if (value instanceof Set) {
    return { __set: Array.from(value).sort() };
  }
  if (Array.isArray(value)) return value.map((entry) => stable(entry));
  if (!value || typeof value !== 'object') return value;

  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) {
    if (key === 'id' && typeof entry === 'string' && entry.startsWith('artifact-')) {
      out[key] = '<artifact-id>';
    } else if (
      key === 'timestamp' ||
      key === 'buildTimeMs' ||
      key === 'processingTimeMs' ||
      keyName === 'buildTimeMs' ||
      keyName === 'processingTimeMs'
    ) {
      out[key] = '<dynamic>';
    } else {
      out[key] = stable(entry, key);
    }
  }
  return out;
}

function stableJson(value: unknown): string {
  return JSON.stringify(stable(value));
}

function geometricCoordinatesByStatement(artifact: any): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const model of artifact?.corpus?.models ?? []) {
    for (const paragraph of model.paragraphs ?? []) {
      for (const statement of paragraph.statements ?? []) {
        out[statement.statementId] = statement.geometricCoordinates;
      }
    }
  }
  return out;
}

describe('H-1 deterministic pipeline fixture', () => {
  test('live prebuilt geometry and regenerate rebuild produce byte-equivalent artifacts', async () => {
    const fixture = makeFixture();

    const live = await executeArtifactPipeline({
      parsedMappingResult: fixture.parsedMappingResult,
      shadowStatements: fixture.shadowStatements.map((statement) => ({ ...statement })),
      shadowParagraphs: fixture.shadowParagraphs,
      statementEmbeddings: fixture.statementEmbeddings,
      paragraphEmbeddings: fixture.paragraphEmbeddings,
      queryEmbedding: fixture.queryEmbedding,
      preBuiltSubstrate: fixture.substrate as any,
      preBuiltPreSemantic: fixture.preSemantic as any,
      preBuiltQueryRelevance: fixture.queryRelevance,
      claimEmbeddings: fixture.claimEmbeddings,
      citationSourceOrder: fixture.citationSourceOrder,
      queryText: 'What is shared?',
      modelCount: 3,
    });

    const regenerate = await buildArtifactForProvider({
      mappingText: fixture.mappingText,
      shadowStatements: fixture.shadowStatements.map((statement) => ({ ...statement })),
      shadowParagraphs: fixture.shadowParagraphs,
      statementEmbeddings: fixture.statementEmbeddings,
      paragraphEmbeddings: fixture.paragraphEmbeddings,
      queryEmbedding: fixture.queryEmbedding,
      geoRecord: { meta: { embeddingBackend: 'wasm' } },
      claimEmbeddings: fixture.claimEmbeddings,
      citationSourceOrder: fixture.citationSourceOrder,
      queryText: 'What is shared?',
      modelCount: 3,
    });

    expect(
      stableJson({
        cognitiveArtifact: live.cognitiveArtifact,
        mapperArtifact: live.mapperArtifact,
      })
    ).toBe(
      stableJson({
        cognitiveArtifact: regenerate.cognitiveArtifact,
        mapperArtifact: regenerate.mapperArtifact,
      })
    );

    const liveCoordinates = geometricCoordinatesByStatement(live.cognitiveArtifact);
    expect(liveCoordinates).toEqual(geometricCoordinatesByStatement(regenerate.cognitiveArtifact));
    expect(liveCoordinates).toEqual({
      s_1: { paragraphId: 'p_1', regionId: null, basinId: null },
      s_2: { paragraphId: 'p_2', regionId: null, basinId: null },
      s_3: { paragraphId: 'p_3', regionId: null, basinId: null },
    });
    expect((live.cognitiveArtifact as any).semantic.claims[0].sourceCoherence).toBe(1);
    expect((regenerate.cognitiveArtifact as any).semantic.claims[0].sourceCoherence).toBe(1);
  });
});

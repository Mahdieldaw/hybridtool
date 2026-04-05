import type { GeometricSubstrate, NodeLocalStats, MutualRankGraph, PairwiseField } from "./types";
import type { ShadowParagraph } from "../shadow/ShadowParagraphProjector";
import type { ShadowStatement } from "../shadow/ShadowExtractor";
import { computeQueryRelevance } from "./queryRelevance";

function makeStatement(id: string, modelIndex: number): ShadowStatement {
  return {
    id,
    modelIndex,
    text: `Statement ${id}`,
    cleanText: `Statement ${id}`,
    stance: "assertive",
    confidence: 1,
    signals: { sequence: false, tension: false, conditional: false },
    location: { paragraphIndex: 0, sentenceIndex: 0 },
    fullParagraph: `Paragraph for ${id}`,
  };
}

function makeParagraph(id: string, modelIndex: number, paragraphIndex: number, statementIds: string[]): ShadowParagraph {
  return {
    id,
    modelIndex,
    paragraphIndex,
    statementIds,
    dominantStance: "assertive",
    stanceHints: ["assertive"],
    contested: false,
    confidence: 1,
    signals: { sequence: false, tension: false, conditional: false },
    statements: statementIds.map((sid) => ({ id: sid, text: `Statement ${sid}`, stance: "assertive", signals: [] })),
    _fullParagraph: `Full ${id}`,
  };
}

function makeSubstrate(nodes: NodeLocalStats[]): GeometricSubstrate {
  const nodeStats = new Map<string, any>();
  for (const n of nodes) {
    nodeStats.set(n.paragraphId, {
      paragraphId: n.paragraphId,
      mutualRankDegree: n.mutualRankDegree,
      isolated: n.mutualRankDegree === 0,
      mutualRankNeighborhood: n.mutualNeighborhoodPatch,
    });
  }

  const mutualRankGraph: MutualRankGraph = {
    edges: [],
    adjacency: new Map(nodes.map(n => [n.paragraphId, []])),
    nodeStats,
    thresholdStats: new Map(),
  };

  const pairwiseField: PairwiseField = {
    matrix: new Map(nodes.map(n => [n.paragraphId, new Map()])),
    perNode: new Map(nodes.map(n => [n.paragraphId, []])),
    stats: { count: 0, min: 0, p10: 0, p25: 0, p50: 0, p75: 0, p80: 0, p90: 0, p95: 0, max: 0, mean: 0, stddev: 0, discriminationRange: 0 },
    nodeCount: nodes.length,
  };

  return {
    nodes,
    pairwiseField,
    mutualRankGraph,
    meta: {
      embeddingSuccess: true,
      embeddingBackend: "wasm",
      nodeCount: nodes.length,
      similarityStats: { max: 0, p95: 0, p80: 0, p50: 0, mean: 0 },
      quantization: "1e-6",
      tieBreaker: "lexicographic",
      buildTimeMs: 0,
    },
  };
}

describe("computeQueryRelevance", () => {
  test("returns querySimilarity for each statement", () => {
    const nodes: NodeLocalStats[] = [
      { paragraphId: "p0", modelIndex: 0, dominantStance: "assertive", contested: false, statementIds: ["s0"], isolationScore: 0, mutualNeighborhoodPatch: ["p0", "p1"], mutualRankDegree: 4 },
      { paragraphId: "p1", modelIndex: 1, dominantStance: "assertive", contested: false, statementIds: ["s1"], isolationScore: 0, mutualNeighborhoodPatch: ["p1", "p0"], mutualRankDegree: 4 },
      { paragraphId: "p2", modelIndex: 0, dominantStance: "assertive", contested: false, statementIds: ["s2"], isolationScore: 1, mutualNeighborhoodPatch: [], mutualRankDegree: 0 },
    ];

    const substrate = makeSubstrate(nodes);
    const statements: ShadowStatement[] = nodes.map((n, i) => makeStatement(`s${i}`, n.modelIndex));
    const paragraphs: ShadowParagraph[] = nodes.map((n, i) => makeParagraph(n.paragraphId, n.modelIndex, i, [`s${i}`]));

    const statementEmbeddings = new Map<string, Float32Array>([
      ["s0", new Float32Array([1, 0])],
      ["s1", new Float32Array([1, 0])],
      ["s2", new Float32Array([0, 1])],
    ]);
    const queryEmbedding = new Float32Array([1, 0]);

    const result = computeQueryRelevance({
      queryEmbedding,
      statements,
      statementEmbeddings,
      paragraphEmbeddings: null,
      paragraphs,
      substrate,
    });

    const s0 = result.statementScores.get("s0");
    const s2 = result.statementScores.get("s2");

    expect(s0).toBeDefined();
    expect(s2).toBeDefined();
    // s0 aligned with query → querySimilarity near 1
    expect(s0!.querySimilarity).toBeGreaterThan(0.9);
    // s2 orthogonal to query → querySimilarity near 0.0 (raw cosine)
    expect(s2!.querySimilarity).toBeCloseTo(0.0, 1);
  });
});

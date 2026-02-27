import type { GeometricSubstrate, NodeLocalStats } from "./types";
import type { ShadowParagraph } from "../shadow/ShadowParagraphProjector";
import type { ShadowStatement } from "../shadow/ShadowExtractor";
import { computeQueryRelevance } from "./queryRelevance";

function makeStatement(id: string, modelIndex: number): ShadowStatement {
  return {
    id,
    modelIndex,
    text: `Statement ${id}`,
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
  const emptyAdjacency = new Map<string, any>();
  for (const n of nodes) emptyAdjacency.set(n.paragraphId, []);

  return {
    nodes,
    graphs: {
      knn: { k: 5, edges: [], adjacency: emptyAdjacency },
      mutual: { k: 5, edges: [], adjacency: emptyAdjacency },
      strong: { softThreshold: 0.75, thresholdMethod: "fixed", edges: [], adjacency: emptyAdjacency },
    },
    topology: {
      components: [],
      componentCount: 0,
      largestComponentRatio: 1,
      isolationRatio: 0,
      globalStrongDensity: 0,
    },
    shape: {
      confidence: 0.5,
      signals: { fragmentationScore: 1, bimodalityScore: 0, parallelScore: 0, convergentScore: 0 },
    },
    meta: {
      embeddingSuccess: true,
      embeddingBackend: "wasm",
      nodeCount: nodes.length,
      knnEdgeCount: 0,
      mutualEdgeCount: 0,
      strongEdgeCount: 0,
      similarityStats: { max: 0, p95: 0, p80: 0, p50: 0, mean: 0 },
      quantization: "1e-6",
      tieBreaker: "lexicographic",
      buildTimeMs: 0,
    },
  };
}

describe("computeQueryRelevance", () => {
  test("returns querySimilarity and recusant for each statement", () => {
    const nodes: NodeLocalStats[] = [
      { paragraphId: "p0", modelIndex: 0, dominantStance: "assertive", contested: false, statementIds: ["s0"], top1Sim: 0, avgTopKSim: 0, knnDegree: 0, mutualDegree: 4, strongDegree: 0, isolationScore: 0, mutualNeighborhoodPatch: ["p0", "p1"] },
      { paragraphId: "p1", modelIndex: 1, dominantStance: "assertive", contested: false, statementIds: ["s1"], top1Sim: 0, avgTopKSim: 0, knnDegree: 0, mutualDegree: 4, strongDegree: 0, isolationScore: 0, mutualNeighborhoodPatch: ["p1", "p0"] },
      { paragraphId: "p2", modelIndex: 0, dominantStance: "assertive", contested: false, statementIds: ["s2"], top1Sim: 0, avgTopKSim: 0, knnDegree: 0, mutualDegree: 0, strongDegree: 0, isolationScore: 1, mutualNeighborhoodPatch: [] },
    ];

    const substrate = makeSubstrate(nodes);
    const statements: ShadowStatement[] = nodes.map((n, i) => makeStatement(`s${i}`, n.modelIndex));
    const paragraphs: ShadowParagraph[] = nodes.map((n, i) => makeParagraph(n.paragraphId, n.modelIndex, i, [`s${i}`]));

    // s0 and s1 are aligned with query; s2 is orthogonal
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
    // s2 has degree 0 (max isolation) → recusant should be 1
    expect(s2!.recusant).toBe(1);
    // s0 has higher degree → lower recusant
    expect(s0!.recusant).toBeLessThan(s2!.recusant);
  });
});

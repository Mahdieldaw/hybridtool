import type { GeometricSubstrate, NodeLocalStats } from "./types";
import type { ShadowParagraph } from "../shadow/ShadowParagraphProjector";
import type { ShadowStatement } from "../shadow/ShadowExtractor";
import type { RegionProfile, RegionizationResult } from "./interpretation/types";
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
      prior: "fragmented",
      confidence: 0.5,
      signals: { fragmentationScore: 1, bimodalityScore: 0, parallelScore: 0 },
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

function makeRegionProfile(regionId: string, tier: RegionProfile["tier"], tierConfidence: number, modelDiversity: number, stanceUnanimity: number, contestedRatio: number): RegionProfile {
  return {
    regionId,
    tier,
    tierConfidence,
    mass: { nodeCount: 1, modelDiversity, modelDiversityRatio: 1 },
    purity: { dominantStance: "assertive", stanceUnanimity, contestedRatio, stanceVariety: 1 },
    geometry: { internalDensity: 0.5, isolation: 0.2, nearestCarrierSimilarity: 0, avgInternalSimilarity: 0.8 },
  };
}

function makeRegionization(regions: Array<{ id: string; nodeIds: string[] }>): RegionizationResult {
  return {
    regions: regions.map((r) => ({
      id: r.id,
      kind: "cluster",
      nodeIds: r.nodeIds,
      statementIds: [],
      sourceId: "test",
      modelIndices: [],
    })),
    meta: {
      regionCount: regions.length,
      kindCounts: { cluster: regions.length, component: 0, patch: 0 },
      fallbackUsed: false,
      coveredNodes: regions.reduce((sum, r) => sum + r.nodeIds.length, 0),
      totalNodes: regions.reduce((sum, r) => sum + r.nodeIds.length, 0),
    },
  };
}

describe("computeQueryRelevance (Phase I refinements)", () => {
  test("disables sub-consensus in peak regions even if degree is non-peak", () => {
    const paragraphs = ["p0", "p1", "p2", "p3", "p4"];
    const nodes: NodeLocalStats[] = [
      { paragraphId: "p0", modelIndex: 0, dominantStance: "assertive", contested: false, statementIds: ["s0"], top1Sim: 0, avgTopKSim: 0, knnDegree: 0, mutualDegree: 5, strongDegree: 0, isolationScore: 0, mutualNeighborhoodPatch: ["p0", "p1"] },
      { paragraphId: "p1", modelIndex: 1, dominantStance: "assertive", contested: false, statementIds: ["s1"], top1Sim: 0, avgTopKSim: 0, knnDegree: 0, mutualDegree: 4, strongDegree: 0, isolationScore: 0, mutualNeighborhoodPatch: ["p1", "p0"] },
      { paragraphId: "p2", modelIndex: 0, dominantStance: "assertive", contested: false, statementIds: ["s2"], top1Sim: 0, avgTopKSim: 0, knnDegree: 0, mutualDegree: 1, strongDegree: 0, isolationScore: 0, mutualNeighborhoodPatch: ["p2", "p3"] },
      { paragraphId: "p3", modelIndex: 1, dominantStance: "assertive", contested: false, statementIds: ["s3"], top1Sim: 0, avgTopKSim: 0, knnDegree: 0, mutualDegree: 1, strongDegree: 0, isolationScore: 0, mutualNeighborhoodPatch: ["p3", "p2"] },
      { paragraphId: "p4", modelIndex: 0, dominantStance: "assertive", contested: false, statementIds: ["s4"], top1Sim: 0, avgTopKSim: 0, knnDegree: 0, mutualDegree: 1, strongDegree: 0, isolationScore: 0, mutualNeighborhoodPatch: ["p4"] },
    ];

    const substrate = makeSubstrate(nodes);
    const statements: ShadowStatement[] = paragraphs.map((_, i) => makeStatement(`s${i}`, nodes[i].modelIndex));
    const shadowParagraphs: ShadowParagraph[] = paragraphs.map((p, i) => makeParagraph(p, nodes[i].modelIndex, i, [`s${i}`]));

    const statementEmbeddings = new Map<string, Float32Array>(statements.map((s) => [s.id, new Float32Array([1, 0])]));
    const queryEmbedding = new Float32Array([1, 0]);

    const baseline = computeQueryRelevance({
      queryEmbedding,
      statements,
      statementEmbeddings,
      paragraphEmbeddings: null,
      paragraphs: shadowParagraphs,
      substrate,
    });
    expect(baseline.statementScores.get("s1")?.subConsensusCorroboration).toBe(1);

    const regionization = makeRegionization([{ id: "r_peak", nodeIds: ["p1"] }]);
    const regionProfiles: RegionProfile[] = [makeRegionProfile("r_peak", "peak", 1, 2, 0.9, 0.05)];

    const refined = computeQueryRelevance({
      queryEmbedding,
      statements,
      statementEmbeddings,
      paragraphEmbeddings: null,
      paragraphs: shadowParagraphs,
      substrate,
      regionization,
      regionProfiles,
    });
    expect(refined.statementScores.get("s1")?.subConsensusCorroboration).toBe(0);
    expect(refined.meta.regionSignalsUsed).toBe(true);
  });

  test("requires coherent region profile signals for sub-consensus", () => {
    const nodes: NodeLocalStats[] = [
      { paragraphId: "p0", modelIndex: 0, dominantStance: "assertive", contested: false, statementIds: ["s0"], top1Sim: 0, avgTopKSim: 0, knnDegree: 0, mutualDegree: 5, strongDegree: 0, isolationScore: 0, mutualNeighborhoodPatch: ["p0", "p1"] },
      { paragraphId: "p1", modelIndex: 1, dominantStance: "assertive", contested: false, statementIds: ["s1"], top1Sim: 0, avgTopKSim: 0, knnDegree: 0, mutualDegree: 4, strongDegree: 0, isolationScore: 0, mutualNeighborhoodPatch: ["p1", "p0"] },
      { paragraphId: "p2", modelIndex: 0, dominantStance: "assertive", contested: false, statementIds: ["s2"], top1Sim: 0, avgTopKSim: 0, knnDegree: 0, mutualDegree: 1, strongDegree: 0, isolationScore: 0, mutualNeighborhoodPatch: ["p2", "p3"] },
      { paragraphId: "p3", modelIndex: 1, dominantStance: "assertive", contested: false, statementIds: ["s3"], top1Sim: 0, avgTopKSim: 0, knnDegree: 0, mutualDegree: 1, strongDegree: 0, isolationScore: 0, mutualNeighborhoodPatch: ["p3", "p2"] },
      { paragraphId: "p4", modelIndex: 0, dominantStance: "assertive", contested: false, statementIds: ["s4"], top1Sim: 0, avgTopKSim: 0, knnDegree: 0, mutualDegree: 1, strongDegree: 0, isolationScore: 0, mutualNeighborhoodPatch: ["p4"] },
    ];

    const substrate = makeSubstrate(nodes);
    const statements: ShadowStatement[] = nodes.map((n, i) => makeStatement(`s${i}`, n.modelIndex));
    const paragraphs: ShadowParagraph[] = nodes.map((n, i) => makeParagraph(n.paragraphId, n.modelIndex, i, [`s${i}`]));

    const statementEmbeddings = new Map<string, Float32Array>(statements.map((s) => [s.id, new Float32Array([1, 0])]));
    const queryEmbedding = new Float32Array([1, 0]);

    const regionization = makeRegionization([{ id: "r_noisy", nodeIds: ["p2"] }]);
    const regionProfiles: RegionProfile[] = [makeRegionProfile("r_noisy", "floor", 1, 2, 0.9, 0.6)];

    const refined = computeQueryRelevance({
      queryEmbedding,
      statements,
      statementEmbeddings,
      paragraphEmbeddings: null,
      paragraphs,
      substrate,
      regionization,
      regionProfiles,
    });

    expect(refined.statementScores.get("s2")?.subConsensusCorroboration).toBe(0);
    expect(refined.statementScores.get("s2")?.meta?.subConsensusMode).toBe("region_profile");
  });
});

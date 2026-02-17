import type { Component, GeometricSubstrate, MutualKnnEdge } from "../types";
import type { ShadowStatement } from "../../shadow/ShadowExtractor";
import type { ShadowParagraph } from "../../shadow/ShadowParagraphProjector";
import type { Region, RegionProfile } from "./types";
import { buildMapperGeometricHints } from "./guidance";
import { buildDisruptionWorklist, computeDisruptionScores, constructJury } from "./index";
import { detectInterRegionSignals } from "./opposition";

function makeSubstrate(paragraphIds: string[], mutualEdges: MutualKnnEdge[], components: Component[] = []): GeometricSubstrate {
  const emptyAdjacency = new Map<string, any>();
  for (const id of paragraphIds) emptyAdjacency.set(id, []);

  const maxSize = components.reduce((m, c) => Math.max(m, c.size), 0);
  const largestComponentRatio = paragraphIds.length > 0 ? maxSize / paragraphIds.length : 0;

  return {
    nodes: paragraphIds.map((id) => ({
      paragraphId: id,
      modelIndex: 0,
      dominantStance: "assertive",
      contested: false,
      statementIds: [],
      top1Sim: 0,
      avgTopKSim: 0,
      knnDegree: 0,
      mutualDegree: 0,
      strongDegree: 0,
      isolationScore: 0,
      mutualNeighborhoodPatch: [],
    })),
    graphs: {
      knn: { k: 5, edges: [], adjacency: emptyAdjacency },
      mutual: { k: 5, edges: mutualEdges, adjacency: emptyAdjacency },
      strong: { softThreshold: 0.75, thresholdMethod: "fixed", edges: [], adjacency: emptyAdjacency },
    },
    topology: {
      components,
      componentCount: components.length,
      largestComponentRatio,
      isolationRatio: 0,
      globalStrongDensity: 0,
    },
    shape: {
      prior: "fragmented",
      confidence: 0.5,
      signals: { fragmentationScore: 1, bimodalityScore: 0, parallelScore: 0 },
      recommendation: { expectClusterCount: [1, 3], expectConflicts: false, expectDissent: false },
    },
    meta: {
      embeddingSuccess: true,
      embeddingBackend: "wasm",
      nodeCount: paragraphIds.length,
      knnEdgeCount: 0,
      mutualEdgeCount: mutualEdges.length,
      strongEdgeCount: 0,
      similarityStats: { max: 0, p95: 0, p80: 0, p50: 0, mean: 0 },
      quantization: "1e-6",
      tieBreaker: "lexicographic",
      buildTimeMs: 0,
    },
  };
}

function edge(a: string, b: string, similarity: number): MutualKnnEdge {
  return { source: a, target: b, similarity, rank: 1 };
}

const emptyRegions: Region[] = [];
const emptyProfiles: RegionProfile[] = [];
const emptyOppositions: any[] = [];

describe("buildMapperGeometricHints expectedClaimCount", () => {
  test("single connected component collapses to 2–2", () => {
    const ids = ["p1", "p2", "p3", "p4"];
    const substrate = makeSubstrate(ids, [edge("p1", "p2", 0.8), edge("p2", "p3", 0.8), edge("p3", "p4", 0.8)]);
    const hints = buildMapperGeometricHints(substrate, emptyRegions, emptyProfiles, emptyOppositions, 0.75);
    expect(hints.expectedClaimCount).toEqual([2, 2]);
  });

  test("many singletons produces 2–ceil(n/2)", () => {
    const ids = ["p1", "p2", "p3", "p4", "p5"];
    const substrate = makeSubstrate(ids, [edge("p1", "p2", 0.7)]);
    const hints = buildMapperGeometricHints(substrate, emptyRegions, emptyProfiles, emptyOppositions, 0.75);
    expect(hints.expectedClaimCount).toEqual([2, 3]);
  });

  test("mixed mass + singleton positions follows the pinned formula", () => {
    const ids = ["p1", "p2", "p3", "p4", "p5"];
    const substrate = makeSubstrate(ids, [edge("p1", "p2", 0.9), edge("p2", "p3", 0.9)]);
    const hints = buildMapperGeometricHints(substrate, emptyRegions, emptyProfiles, emptyOppositions, 0.75);
    expect(hints.expectedClaimCount).toEqual([2, 2]);
  });

  test("two mass components produces 2–2", () => {
    const ids = ["p1", "p2", "p3", "p4"];
    const substrate = makeSubstrate(ids, [edge("p1", "p2", 0.9), edge("p3", "p4", 0.9)]);
    const hints = buildMapperGeometricHints(substrate, emptyRegions, emptyProfiles, emptyOppositions, 0.75);
    expect(hints.expectedClaimCount).toEqual([2, 2]);
  });
});

function makeRegion(id: string, nodeIds: string[]): Region {
  return {
    id,
    kind: "patch",
    nodeIds,
    statementIds: [],
    sourceId: "test",
    modelIndices: [0],
  };
}

function makeProfile(regionId: string, tier: RegionProfile["tier"], stance: RegionProfile["purity"]["dominantStance"]): RegionProfile {
  return {
    regionId,
    tier,
    tierConfidence: 1,
    mass: { nodeCount: 2, modelDiversity: 1, modelDiversityRatio: 1 },
    purity: { dominantStance: stance, stanceUnanimity: 0.9, contestedRatio: 0.05, stanceVariety: 1 },
    geometry: { internalDensity: 0.5, isolation: 0.2, nearestCarrierSimilarity: 0, avgInternalSimilarity: 0.8 },
    predicted: { likelyClaims: 1 },
  };
}

describe("detectInterRegionSignals", () => {
  test("infers conflict from opposite stances with topical overlap", () => {
    const substrate = makeSubstrate(["p1", "p2"], [edge("p1", "p2", 0.8)]);
    const regions = [makeRegion("r1", ["p1"]), makeRegion("r2", ["p2"])];
    const profiles = [makeProfile("r1", "peak", "prescriptive"), makeProfile("r2", "peak", "cautionary")];
    const signals = detectInterRegionSignals(regions, profiles, substrate);
    expect(signals.some((s) => s.relationship === "conflict" && s.reasons.includes("opposite_stances"))).toBe(true);
  });

  test("infers support from same stance with topical overlap", () => {
    const substrate = makeSubstrate(["p1", "p2"], [edge("p1", "p2", 0.8)]);
    const regions = [makeRegion("r1", ["p1"]), makeRegion("r2", ["p2"])];
    const profiles = [makeProfile("r1", "peak", "assertive"), makeProfile("r2", "hill", "assertive")];
    const signals = detectInterRegionSignals(regions, profiles, substrate);
    expect(signals.some((s) => s.relationship === "support" && s.reasons.includes("same_stance"))).toBe(true);
  });

  test("emits independent signals for regions in separate components", () => {
    const components: Component[] = [
      { id: "comp_0", nodeIds: ["p1"], size: 1, internalDensity: 0 },
      { id: "comp_1", nodeIds: ["p2"], size: 1, internalDensity: 0 },
    ];
    const substrate = makeSubstrate(["p1", "p2"], [], components);
    const regions = [makeRegion("r1", ["p1"]), makeRegion("r2", ["p2"])];
    const profiles = [makeProfile("r1", "floor", "assertive"), makeProfile("r2", "floor", "assertive")];
    const signals = detectInterRegionSignals(regions, profiles, substrate);
    expect(signals.some((s) => s.relationship === "independent" && s.reasons.includes("separate_components"))).toBe(true);
  });
});

describe("computeDisruptionScores + buildDisruptionWorklist", () => {
  test("ranks focal statements by disruption and caps per-paragraph worklist", () => {
    const statements: ShadowStatement[] = [
      {
        id: "s1",
        modelIndex: 1,
        text: "If you do X, you should do Y, but it depends on Z.",
        stance: "prescriptive",
        confidence: 0.9,
        signals: { sequence: false, tension: true, conditional: true },
        location: { paragraphIndex: 0, sentenceIndex: 0 },
        fullParagraph: "If you do X, you should do Y, but it depends on Z.",
      },
      {
        id: "s2",
        modelIndex: 1,
        text: "X is generally fine.",
        stance: "assertive",
        confidence: 0.7,
        signals: { sequence: false, tension: false, conditional: false },
        location: { paragraphIndex: 1, sentenceIndex: 0 },
        fullParagraph: "X is generally fine.",
      },
      {
        id: "s3",
        modelIndex: 1,
        text: "But if Z is true, avoid Y.",
        stance: "cautionary",
        confidence: 0.8,
        signals: { sequence: false, tension: true, conditional: true },
        location: { paragraphIndex: 1, sentenceIndex: 1 },
        fullParagraph: "But if Z is true, avoid Y.",
      },
    ];

    const paragraphs: ShadowParagraph[] = [
      {
        id: "p_a",
        modelIndex: 1,
        paragraphIndex: 0,
        statementIds: ["s1"],
        dominantStance: "prescriptive",
        stanceHints: ["prescriptive"],
        contested: false,
        confidence: 0.9,
        signals: { sequence: false, tension: true, conditional: true },
        statements: [{ id: "s1", text: "s1", stance: "prescriptive", signals: ["TENS", "COND"] }],
        _fullParagraph: "p_a",
      },
      {
        id: "p_b",
        modelIndex: 1,
        paragraphIndex: 1,
        statementIds: ["s2", "s3"],
        dominantStance: "assertive",
        stanceHints: ["assertive"],
        contested: true,
        confidence: 0.8,
        signals: { sequence: false, tension: true, conditional: true },
        statements: [
          { id: "s2", text: "s2", stance: "assertive", signals: [] },
          { id: "s3", text: "s3", stance: "cautionary", signals: ["TENS", "COND"] },
        ],
        _fullParagraph: "p_b",
      },
      {
        id: "p_c",
        modelIndex: 2,
        paragraphIndex: 0,
        statementIds: [],
        dominantStance: "assertive",
        stanceHints: ["assertive"],
        contested: false,
        confidence: 0.7,
        signals: { sequence: false, tension: false, conditional: false },
        statements: [],
        _fullParagraph: "p_c",
      },
    ];

    const preSemantic: any = {
      lens: {
        regime: "fragmented",
        shouldRunClustering: false,
        hardMergeThreshold: 0.8,
        softThreshold: 0.75,
        k: 5,
        confidence: 0.7,
        evidence: [],
      },
      regionization: {
        regions: [
          { id: "r1", kind: "patch", nodeIds: ["p_a"], statementIds: ["s1"], sourceId: "test", modelIndices: [1] },
          { id: "r2", kind: "patch", nodeIds: ["p_b", "p_c"], statementIds: ["s2", "s3"], sourceId: "test", modelIndices: [1, 2] },
        ],
        meta: {
          regionCount: 2,
          kindCounts: { cluster: 0, component: 0, patch: 2 },
          fallbackUsed: true,
          coveredNodes: 3,
          totalNodes: 3,
        },
      },
      regionProfiles: [
        {
          regionId: "r1",
          tier: "hill",
          tierConfidence: 1,
          mass: { nodeCount: 1, modelDiversity: 1, modelDiversityRatio: 1 },
          purity: { dominantStance: "prescriptive", stanceUnanimity: 0.8, contestedRatio: 0.1, stanceVariety: 2 },
          geometry: { internalDensity: 0.5, isolation: 0.4, avgInternalSimilarity: 0.75 },
          predicted: { likelyClaims: 1 },
        },
        {
          regionId: "r2",
          tier: "peak",
          tierConfidence: 1,
          mass: { nodeCount: 2, modelDiversity: 2, modelDiversityRatio: 1 },
          purity: { dominantStance: "cautionary", stanceUnanimity: 0.6, contestedRatio: 0.35, stanceVariety: 3 },
          geometry: { internalDensity: 0.4, isolation: 0.25, avgInternalSimilarity: 0.7 },
          predicted: { likelyClaims: 2 },
        },
      ],
      oppositions: [{ regionA: "r1", regionB: "r2", similarity: 0.8, stanceConflict: true, reason: "opposite_stances" }],
      interRegionSignals: [],
      hints: {
        predictedShape: { predicted: "fragmented", confidence: 0.5, evidence: [] },
        expectedClaimCount: [2, 2],
        expectedConflicts: 1,
        expectedDissent: true,
        attentionRegions: [],
        meta: { usedClusters: false, regionCount: 2, oppositionCount: 1 },
      },
    };

    const queryRelevance: any = {
      statementScores: new Map([
        ["s1", { compositeRelevance: 0.9 }],
        ["s2", { compositeRelevance: 0.2 }],
        ["s3", { compositeRelevance: 0.8 }],
      ]),
      tiers: { high: ["s1", "s3"], medium: ["s2"], low: [] },
      meta: { weightsUsed: { querySimilarity: 1, novelty: 0, subConsensus: 0 }, adaptiveWeightsActive: false, regionSignalsUsed: false, subConsensusMode: "degree_only" },
    };

    const disruption = computeDisruptionScores({
      statements,
      paragraphs,
      preSemantic,
      queryRelevance,
    });

    expect(disruption.ranked.map((r) => r.statementId)).toEqual(expect.arrayContaining(["s1", "s2", "s3"]));
    expect(disruption.ranked[disruption.ranked.length - 1]?.statementId).toBe("s2");

    const worklist = buildDisruptionWorklist({
      ranked: disruption.ranked,
      limit: 3,
      maxPerParagraph: 1,
      maxPerRegion: 2,
    });

    expect(worklist.worklist.map((w) => w.statementId)).toEqual(expect.arrayContaining(["s1", "s3"]));
    expect(worklist.worklist.map((w) => w.statementId)).not.toEqual(expect.arrayContaining(["s2"]));
  });
});

describe("constructJury", () => {
  test("returns bounded jury with major region coverage", () => {
    const condensedStatements: ShadowStatement[] = [
      {
        id: "s1",
        modelIndex: 1,
        text: "Focal statement.",
        stance: "prescriptive",
        confidence: 0.9,
        signals: { sequence: false, tension: true, conditional: true },
        location: { paragraphIndex: 0, sentenceIndex: 0 },
        fullParagraph: "p1",
      },
      {
        id: "s2",
        modelIndex: 1,
        text: "Region 2 centroid rep.",
        stance: "assertive",
        confidence: 0.7,
        signals: { sequence: false, tension: false, conditional: false },
        location: { paragraphIndex: 1, sentenceIndex: 0 },
        fullParagraph: "p2",
      },
      {
        id: "s3",
        modelIndex: 2,
        text: "Region 3 centroid rep.",
        stance: "assertive",
        confidence: 0.7,
        signals: { sequence: false, tension: false, conditional: false },
        location: { paragraphIndex: 2, sentenceIndex: 0 },
        fullParagraph: "p3",
      },
      {
        id: "s4",
        modelIndex: 3,
        text: "Outlier statement.",
        stance: "assertive",
        confidence: 0.6,
        signals: { sequence: false, tension: false, conditional: false },
        location: { paragraphIndex: 3, sentenceIndex: 0 },
        fullParagraph: "p4",
      },
      {
        id: "s5",
        modelIndex: 2,
        text: "Dissenter statement.",
        stance: "cautionary",
        confidence: 0.8,
        signals: { sequence: false, tension: true, conditional: true },
        location: { paragraphIndex: 2, sentenceIndex: 1 },
        fullParagraph: "p3",
      },
    ];

    const substrate: any = makeSubstrate(["p1", "p2", "p3", "p4"], []);
    substrate.nodes = [
      {
        paragraphId: "p1",
        modelIndex: 1,
        dominantStance: "prescriptive",
        contested: false,
        statementIds: ["s1"],
        top1Sim: 0.9,
        avgTopKSim: 0.9,
        knnDegree: 0,
        mutualDegree: 0,
        strongDegree: 0,
        isolationScore: 0.05,
        mutualNeighborhoodPatch: [],
      },
      {
        paragraphId: "p2",
        modelIndex: 1,
        dominantStance: "assertive",
        contested: false,
        statementIds: ["s2"],
        top1Sim: 0.85,
        avgTopKSim: 0.85,
        knnDegree: 0,
        mutualDegree: 0,
        strongDegree: 0,
        isolationScore: 0.1,
        mutualNeighborhoodPatch: [],
      },
      {
        paragraphId: "p3",
        modelIndex: 2,
        dominantStance: "assertive",
        contested: true,
        statementIds: ["s3", "s5"],
        top1Sim: 0.8,
        avgTopKSim: 0.8,
        knnDegree: 0,
        mutualDegree: 0,
        strongDegree: 0,
        isolationScore: 0.15,
        mutualNeighborhoodPatch: [],
      },
      {
        paragraphId: "p4",
        modelIndex: 3,
        dominantStance: "assertive",
        contested: false,
        statementIds: ["s4"],
        top1Sim: 0.2,
        avgTopKSim: 0.2,
        knnDegree: 0,
        mutualDegree: 0,
        strongDegree: 0,
        isolationScore: 0.95,
        mutualNeighborhoodPatch: [],
      },
    ];

    const regions: Region[] = [
      { id: "r1", kind: "patch", nodeIds: ["p1"], statementIds: ["s1"], sourceId: "test", modelIndices: [1] },
      { id: "r2", kind: "patch", nodeIds: ["p2"], statementIds: ["s2"], sourceId: "test", modelIndices: [1] },
      { id: "r3", kind: "patch", nodeIds: ["p3", "p4"], statementIds: ["s3", "s4", "s5"], sourceId: "test", modelIndices: [2, 3] },
    ];

    const focal: any = {
      statementId: "s1",
      paragraphId: "p1",
      regionId: "r1",
      stance: "prescriptive",
      composite: 0.9,
      partitionRelevance: 1,
      breakdown: {
        queryRelevance: 1,
        clusterSize: 1,
        modelDiversity: 1,
        stanceWeight: 1,
        isolation: 0,
        opposition: 0,
        signals: 1,
        contested: 0,
        partitionRelevance: 1,
        compositeRaw: 1,
        composite: 1,
      },
    };

    const result = constructJury({
      focal,
      regions,
      substrate,
      condensedStatements,
      maxJurySize: 6,
    });

    expect(result.jury.length).toBeGreaterThan(0);
    expect(result.jury.length).toBeLessThanOrEqual(6);
    expect(result.jury.some((m) => m.statementId === "s1")).toBe(false);
    expect(new Set(result.jury.map((m) => m.regionId)).has("r2")).toBe(true);
    expect(new Set(result.jury.map((m) => m.regionId)).has("r3")).toBe(true);
    expect(result.jury.some((m) => m.role === "outlier")).toBe(true);
    expect(result.jury.some((m) => m.role === "dissenter")).toBe(true);
  });
});

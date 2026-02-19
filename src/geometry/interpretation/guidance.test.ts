import type { Component, GeometricSubstrate, MutualKnnEdge } from "../types";
import type { Region, RegionProfile } from "./types";
import { buildMapperGeometricHints } from "./guidance";

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

export function buildCognitiveArtifact(
  mapper?: any,
  pipeline?: any,
): any | null {
  if (!mapper && !pipeline) return null;

  // If mapper is already a CognitiveArtifact (has .semantic), pass through
  if (mapper?.semantic?.claims) {
    return mapper;
  }

  const substrateGraph = pipeline?.substrate?.graph;
  const traversalGraph = mapper?.traversalGraph;

  return {
    shadow: {
      statements:
        pipeline?.shadow?.extraction?.statements ??
        mapper?.shadow?.statements ??
        [],
      paragraphs: pipeline?.paragraphProjection?.paragraphs ?? [],
      audit: mapper?.shadow?.audit ?? {},
      delta: pipeline?.shadow?.delta ?? null,
    },
    geometry: {
      embeddingStatus: pipeline?.substrate ? 'computed' : 'failed',
      substrate: {
        nodes: substrateGraph?.nodes ?? [],
        edges: substrateGraph?.edges ?? [],
        mutualEdges: substrateGraph?.mutualEdges ?? [],
        strongEdges: substrateGraph?.strongEdges ?? [],
        softThreshold: substrateGraph?.softThreshold,
      },
      preSemantic: pipeline?.preSemantic
        ? {
          hint: pipeline.preSemantic.lens?.shape ?? 'sparse',
          regions: (pipeline.preSemantic.regionization?.regions || []).map((r: any) => ({
            id: r.id,
            kind: r.kind,
            nodeIds: r.nodeIds,
          })),
        }
        : undefined,
      alignment: mapper?.alignment ?? undefined,
    },
    semantic: {
      claims: mapper?.claims ?? [],
      edges: mapper?.edges ?? [],
      conditionals: mapper?.conditionals ?? [],
      narrative: mapper?.narrative,
      ghosts: Array.isArray(mapper?.ghosts) ? mapper.ghosts : undefined,
    },
    traversal: {
      forcingPoints: mapper?.forcingPoints ?? [],
      graph: traversalGraph
        ? {
          claims: traversalGraph.claims ?? [],
          edges: traversalGraph.edges ?? [],
          conditionals: traversalGraph.conditionals ?? [],
          tensions: traversalGraph.tensions ?? [],
          tiers: traversalGraph.tiers ?? [],
          maxTier: traversalGraph.maxTier ?? 0,
          roots: traversalGraph.roots ?? [],
          cycles: traversalGraph.cycles ?? [],
        }
        : {
          claims: [],
          edges: [],
          conditionals: [],
          tensions: [],
          tiers: [],
          maxTier: 0,
          roots: [],
          cycles: [],
        },
    },
    meta: {
      modelCount: mapper?.model_count ?? mapper?.modelCount ?? undefined,
      query: mapper?.query ?? undefined,
      turn: mapper?.turn ?? undefined,
      timestamp: mapper?.timestamp ?? undefined,
    },
  };
}

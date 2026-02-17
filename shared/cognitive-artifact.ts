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
    paragraphClustering: mapper?.paragraphClustering ?? undefined,
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
      labels: pipeline?.labels ?? undefined,
      substrate: {
        nodes: substrateGraph?.nodes ?? [],
        edges: substrateGraph?.edges ?? [],
        mutualEdges: substrateGraph?.mutualEdges ?? [],
        strongEdges: substrateGraph?.strongEdges ?? [],
        softThreshold: substrateGraph?.softThreshold,
      },
      query: pipeline?.query
        ? {
          ...pipeline.query,
          condensedStatementIds: Array.isArray(pipeline.query.condensedStatementIds)
            ? pipeline.query.condensedStatementIds
            : [],
        }
        : undefined,
      preSemantic: pipeline?.preSemantic
        ? {
          ...pipeline.preSemantic,
          hint: pipeline.preSemantic.lens?.shape ?? 'sparse',
          regions: (pipeline.preSemantic.regionization?.regions || []).map((r: any) => ({
            id: r.id,
            kind: r.kind,
            nodeIds: r.nodeIds,
          })),
        }
        : undefined,
      structuralValidation: mapper?.structuralValidation ?? undefined,
      convergence: mapper?.convergence ?? undefined,
      alignment: mapper?.alignment ?? undefined,
    },
    semantic: {
      claims: mapper?.claims ?? [],
      edges: mapper?.edges ?? [],
      conditionals: mapper?.conditionals ?? [],
      narrative: mapper?.narrative,
      ghosts: Array.isArray(mapper?.ghosts) ? mapper.ghosts : undefined,
      partitions: Array.isArray(mapper?.partitions) ? mapper.partitions : undefined,
    },
    traversal: {
      forcingPoints: mapper?.forcingPoints ?? [],
      traversalQuestions: Array.isArray(mapper?.traversalQuestions) ? mapper.traversalQuestions : undefined,
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
    traversalAnalysis: mapper?.traversalAnalysis ?? undefined,
    mechanicalGating: mapper?.mechanicalGating ?? undefined,
    observability: pipeline?.observability ?? undefined,
    fallbacks: pipeline?.fallbacks ?? undefined,
    meta: {
      modelCount: mapper?.model_count ?? mapper?.modelCount ?? undefined,
      query: mapper?.query ?? undefined,
      turn: mapper?.turn ?? undefined,
      timestamp: mapper?.timestamp ?? undefined,
    },
  };
}

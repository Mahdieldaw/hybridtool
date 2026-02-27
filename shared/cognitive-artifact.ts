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
  const pipelineQuery = pipeline?.query ? { ...pipeline.query } : undefined;
  const rawScores = pipelineQuery?.relevance?.statementScores;
  if (rawScores instanceof Map) {
    pipelineQuery.relevance = {
      ...(pipelineQuery.relevance ?? {}),
      statementScores: Object.fromEntries(rawScores),
    };
  }

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
      basinInversion: mapper?.basinInversion ?? pipeline?.basinInversion ?? undefined,
      substrate: {
        nodes: substrateGraph?.nodes ?? [],
        edges: substrateGraph?.edges ?? [],
        mutualEdges: substrateGraph?.mutualEdges ?? [],
        strongEdges: substrateGraph?.strongEdges ?? [],
        softThreshold: substrateGraph?.softThreshold,
        similarityStats: substrateGraph?.similarityStats ?? null,
        extendedSimilarityStats: substrateGraph?.extendedSimilarityStats ?? null,
        allPairwiseSimilarities: substrateGraph?.allPairwiseSimilarities ?? null,
      },
      query: pipelineQuery,
      preSemantic: pipeline?.preSemantic
        ? {
          ...pipeline.preSemantic,
          shapeSignals: {
            fragmentationScore: pipeline?.substrate?.shape?.signals?.fragmentationScore ?? 1,
            bimodalityScore: pipeline?.substrate?.shape?.signals?.bimodalityScore ?? 0,
            parallelScore: pipeline?.substrate?.shape?.signals?.parallelScore ?? 0,
            convergentScore: pipeline?.substrate?.shape?.signals?.convergentScore ?? 0,
            confidence: pipeline?.substrate?.shape?.confidence ?? 0,
          },
          regions: (pipeline.preSemantic.regionization?.regions || []).map((r: any) => ({
            id: r.id,
            kind: r.kind,
            nodeIds: r.nodeIds,
          })),
        }
        : undefined,
      diagnostics: mapper?.diagnostics ?? mapper?.structuralValidation ?? undefined,
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
    meta: {
      modelCount: mapper?.model_count ?? mapper?.modelCount ?? undefined,
      query: mapper?.query ?? undefined,
      turn: mapper?.turn ?? undefined,
      timestamp: mapper?.timestamp ?? undefined,
    },
    claimProvenance: mapper?.claimProvenance ?? undefined,
    blastRadiusFilter: mapper?.blastRadiusFilter ?? undefined,
    surveyGates: mapper?.surveyGates ?? undefined,
    surveyRationale: mapper?.surveyRationale ?? undefined,
    completeness: mapper?.completeness ?? undefined,
    substrateSummary: mapper?.substrate ?? undefined,
  };
}

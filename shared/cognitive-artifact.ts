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
  const pipelineQuery = pipeline?.query ? { ...pipeline.query } : undefined;
  const rawScores = pipelineQuery?.relevance?.statementScores;
  if (rawScores instanceof Map) {
    pipelineQuery.relevance = {
      ...(pipelineQuery.relevance ?? {}),
      statementScores: Object.fromEntries(rawScores),
    };
  }

  const result: any = {
    paragraphClustering: mapper?.paragraphClustering ?? undefined,
    shadow: {
      statements:
        pipeline?.shadow?.extraction?.statements ??
        mapper?.shadow?.statements ??
        [],
      paragraphs: pipeline?.paragraphProjection?.paragraphs ?? [],
      tableSidecar: pipeline?.shadow?.extraction?.tableSidecar ?? [],
    },
    geometry: {
      embeddingStatus: pipeline?.substrate ? 'computed' : 'failed',
      labels: pipeline?.labels ?? undefined,
      basinInversion: mapper?.basinInversion ?? pipeline?.basinInversion ?? undefined,
      substrate: {
        nodes: substrateGraph?.nodes ?? [],
        mutualEdges: substrateGraph?.mutualEdges ?? [],
      },
      query: pipelineQuery,
      preSemantic: pipeline?.preSemantic
        ? {
          ...pipeline.preSemantic,
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
    },
    semantic: {
      claims: mapper?.claims ?? [],
      edges: mapper?.edges ?? [],
      conditionals: mapper?.conditionals ?? [],
      narrative: mapper?.narrative,
    },
    meta: {
      modelCount: mapper?.model_count ?? mapper?.modelCount ?? undefined,
      query: mapper?.query ?? undefined,
      turn: mapper?.turn ?? undefined,
      timestamp: mapper?.timestamp ?? undefined,
    },
    // Renamed field: mapper.substrate → substrateSummary
    substrateSummary: mapper?.substrate ?? undefined,
  };

  // Auto-forward: any mapper field NOT consumed into structured sections above
  // passes through automatically. Adding a new field to deterministicPipeline.js
  // is sufficient — no need to touch this file.
  const consumedMapperKeys = new Set([
    // → semantic
    'claims', 'edges', 'conditionals', 'narrative',
    // → geometry
    'diagnostics', 'structuralValidation', 'convergence', 'alignment',
    'basinInversion', 'preSemantic',
    // → meta
    'model_count', 'modelCount', 'query', 'turn', 'timestamp',
    // → special / renamed / nested
    'paragraphClustering', 'shadow', 'substrate',
    'id',
  ]);

  if (mapper && typeof mapper === 'object') {
    for (const [key, value] of Object.entries(mapper)) {
      if (!consumedMapperKeys.has(key) && value !== undefined && !(key in result)) {
        (result as any)[key] = value;
      }
    }
  }

  return result;
}

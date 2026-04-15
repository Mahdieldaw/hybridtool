// @ts-nocheck
import { DEFAULT_CONFIG } from '../../../clustering/index.js';
import { getErrorMessage } from '../../errors/handler.js';

/**
 * Build geometry async pipeline, processing embeddings and substrate.
 * Returns an object with all computed geometry results; mutates geometryDiagnostics.
 */
export async function buildGeometryAsync(
  paragraphResult,
  shadowResult,
  indexedSourceData,
  payload,
  context,
  options,
  geometryDiagnostics,
  nowMs
) {
  const startedAtMs = nowMs();
  const results = {
    embeddingResult: null,
    statementEmbeddingResult: null,
    geometryParagraphEmbeddings: null,
    queryEmbedding: null,
    queryRelevance: null,
    substrateSummary: null,
    substrateDegenerate: null,
    substrateDegenerateReason: null,
    preSemanticInterpretation: null,
    substrate: null,
    basinInversionResult: null,
    bayesianBasinInversionResult: null,
  };

  try {
    if (paragraphResult.paragraphs.length === 0) {
      geometryDiagnostics.stages.embeddingsSkipped = {
        startedAtMs,
        timeMs: 0,
        reason: 'no_paragraphs',
      };
      return results;
    }

    const ensureOffscreenReady = async () => {
      if (typeof chrome === 'undefined' || !chrome?.runtime?.getContexts || !chrome?.offscreen)
        return;
      const existingContexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
      });
      if (existingContexts.length > 0) return;
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: [chrome.offscreen.Reason.WORKERS],
        justification: 'Embedding model inference for semantic clustering',
      });
    };

    const offscreenReadyPromise = ensureOffscreenReady().catch((err) => {
      geometryDiagnostics.embeddingBackendFailure = true;
      geometryDiagnostics.stages.offscreen = { status: 'failed', error: getErrorMessage(err) };
    });

    const clusteringModule = await import('../../../clustering/index.js');
    const {
      generateEmbeddings,
      generateTextEmbeddings,
      generateStatementEmbeddings,
      stripInlineMarkdown,
      structuredTruncate,
      getEmbeddingStatus,
    } = clusteringModule;
    const { buildGeometricSubstrate, isDegenerate } = await import('../../../geometry/index.js');
    const { buildPreSemanticInterpretation } = await import('../../../geometry/interpret.js');
    const { computeQueryRelevance } = await import('../../../geometry/annotate.js');

    /** @type {"none" | "webgpu" | "wasm"} */
    let embeddingBackend = 'none';
    try {
      const status = await getEmbeddingStatus();
      if (status?.backend === 'webgpu' || status?.backend === 'wasm') {
        embeddingBackend = status.backend;
      }
    } catch (_) {}

    const rawQuery =
      (payload && typeof payload.originalPrompt === 'string' && payload.originalPrompt) ||
      (context && typeof context.userMessage === 'string' && context.userMessage) ||
      '';
    const cleanedQuery = stripInlineMarkdown(String(rawQuery || '')).trim();
    const truncatedQuery = structuredTruncate(cleanedQuery, 1740);
    const queryTextForEmbedding =
      truncatedQuery &&
      !truncatedQuery
        .toLowerCase()
        .startsWith('represent this sentence for searching relevant passages:')
        ? `Represent this sentence for searching relevant passages: ${truncatedQuery}`
        : truncatedQuery;

    const queryEmbeddingPromise = (async () => {
      try {
        await offscreenReadyPromise;
        console.log(
          `[buildGeometryAsync] Query embedding: queryText length=${queryTextForEmbedding.length}, model=${DEFAULT_CONFIG?.modelId || 'unknown'}`
        );
        const queryEmbeddingBatch = await generateTextEmbeddings(
          [queryTextForEmbedding],
          DEFAULT_CONFIG
        );
        results.queryEmbedding = queryEmbeddingBatch.embeddings.get('0') || null;
        if (results.queryEmbedding && results.queryEmbedding.length !== DEFAULT_CONFIG.embeddingDimensions) {
          throw new Error(
            `[buildGeometryAsync] Query embedding dimension mismatch: expected ${DEFAULT_CONFIG.embeddingDimensions}, got ${results.queryEmbedding.length}`
          );
        }
        geometryDiagnostics.stages.queryEmbedding = {
          status: results.queryEmbedding ? 'ok' : 'failed',
          dimensions: results.queryEmbedding ? results.queryEmbedding.length : null,
        };
      } catch (err) {
        results.queryEmbedding = null;
        console.warn(`[buildGeometryAsync] Query embedding failed:`, getErrorMessage(err));
        geometryDiagnostics.stages.queryEmbedding = {
          status: 'failed',
          error: getErrorMessage(err),
        };
      }
    })();

    const paragraphEmbeddingPromise = (async () => {
      try {
        await offscreenReadyPromise;
        const paragraphEmbeddingResult = await generateEmbeddings(
          paragraphResult.paragraphs,
          shadowResult.statements,
          DEFAULT_CONFIG
        );
        results.embeddingResult = paragraphEmbeddingResult;
        results.geometryParagraphEmbeddings = paragraphEmbeddingResult.embeddings;
        geometryDiagnostics.stages.paragraphEmbeddings = {
          status: 'ok',
          paragraphs: paragraphResult.paragraphs.length,
          paragraphEmbeddings: paragraphEmbeddingResult.embeddings.size,
        };
      } catch (err) {
        results.embeddingResult = null;
        results.geometryParagraphEmbeddings = null;
        geometryDiagnostics.embeddingBackendFailure = true;
        geometryDiagnostics.stages.paragraphEmbeddings = {
          status: 'failed',
          error: getErrorMessage(err),
        };
      }
    })();

    const statementEmbeddingPromise = (async () => {
      if (!Array.isArray(shadowResult?.statements) || shadowResult.statements.length === 0) {
        geometryDiagnostics.stages.statementEmbeddings = {
          status: 'skipped',
          reason: 'no_statements',
        };
        results.statementEmbeddingResult = null;
        return;
      }
      try {
        await offscreenReadyPromise;
        results.statementEmbeddingResult = await generateStatementEmbeddings(
          shadowResult.statements,
          DEFAULT_CONFIG
        );
        geometryDiagnostics.stages.statementEmbeddings = {
          status: 'ok',
          statements: shadowResult.statements.length,
          embedded:
            typeof results.statementEmbeddingResult?.statementCount === 'number'
              ? results.statementEmbeddingResult.statementCount
              : null,
        };
      } catch (embeddingError) {
        console.warn(
          '[buildGeometryAsync] Statement embedding generation failed, continuing without embeddings:',
          getErrorMessage(embeddingError)
        );
        geometryDiagnostics.embeddingBackendFailure = true;
        geometryDiagnostics.stages.statementEmbeddings = {
          status: 'failed',
          error: getErrorMessage(embeddingError),
        };
        results.statementEmbeddingResult = null;
      }
    })();

    await queryEmbeddingPromise;
    await paragraphEmbeddingPromise;
    await statementEmbeddingPromise;

    const firstParagraphEmbedding = results.geometryParagraphEmbeddings
      ?.values?.()
      .next?.().value;
    if (
      results.queryEmbedding &&
      firstParagraphEmbedding &&
      firstParagraphEmbedding.length !== results.queryEmbedding.length
    ) {
      throw new Error(
        `[buildGeometryAsync] Query/paragraph embedding dimension mismatch: query=${results.queryEmbedding.length}, paragraph=${firstParagraphEmbedding.length}`
      );
    }

    if (!results.geometryParagraphEmbeddings || results.geometryParagraphEmbeddings.size === 0) {
      console.log(`[buildGeometryAsync] Skipping embeddings/geometry (paragraph_embeddings_unavailable)`);
      geometryDiagnostics.stages.embeddingsSkipped = {
        startedAtMs,
        timeMs: 0,
        reason: 'paragraph_embeddings_unavailable',
      };
      return results;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Basin Inversion (Topographic Analysis)
    // ─────────────────────────────────────────────────────────────────────────
    try {
      const { computeBasinInversion } =
        await import('../../../geometry/algorithms/basin-inversion-bayesian.js');
      const paraIds = Array.from(results.geometryParagraphEmbeddings.keys());
      const paraVectors = paraIds.map((id) => results.geometryParagraphEmbeddings.get(id));
      results.basinInversionResult = computeBasinInversion(paraIds, paraVectors);
      console.log(
        `[buildGeometryAsync] Basin inversion complete: ${results.basinInversionResult.basinCount} basins found`
      );
    } catch (err) {
      console.warn(`[buildGeometryAsync] Basin inversion failed:`, getErrorMessage(err));
    }

    results.bayesianBasinInversionResult = results.basinInversionResult;

    results.substrate = buildGeometricSubstrate(
      paragraphResult.paragraphs,
      results.geometryParagraphEmbeddings,
      embeddingBackend,
      undefined, // config
      results.basinInversionResult // Pass topography to substrate
    );
    geometryDiagnostics.stages.substrate = {
      status: 'ok',
      embeddingBackend,
    };

    try {
      results.substrateDegenerate = isDegenerate(results.substrate);
      results.substrateDegenerateReason = results.substrateDegenerate
        ? results.substrate && typeof results.substrate === 'object' && 'degenerateReason' in results.substrate
          ? String(results.substrate.degenerateReason)
          : 'unknown'
        : null;
    } catch (_) {
      results.substrateDegenerate = null;
      results.substrateDegenerateReason = null;
    }

    try {
      const nodeCount = Array.isArray(results.substrate.nodes) ? results.substrate.nodes.length : 0;
      const contestedCount = Array.isArray(results.substrate.nodes)
        ? results.substrate.nodes.reduce((acc, n) => acc + (n?.contested ? 1 : 0), 0)
        : 0;
      const avgIsolationScore =
        Array.isArray(results.substrate.nodes) && nodeCount > 0
          ? results.substrate.nodes.reduce(
              (acc, n) => acc + (typeof n?.isolationScore === 'number' ? n.isolationScore : 0),
              0
            ) / nodeCount
          : 0;
      const mutualRankEdgeCount = results.substrate.mutualRankGraph?.edges?.length ?? 0;

      results.substrateSummary = {
        meta: {
          embeddingSuccess: !!results.substrate?.meta?.embeddingSuccess,
          embeddingBackend: results.substrate?.meta?.embeddingBackend || 'none',
          nodeCount:
            typeof results.substrate?.meta?.nodeCount === 'number'
              ? results.substrate.meta.nodeCount
              : nodeCount,
          mutualRankEdgeCount,
          buildTimeMs:
            typeof results.substrate?.meta?.buildTimeMs === 'number'
              ? results.substrate.meta.buildTimeMs
              : 0,
        },
        nodes: {
          contestedCount,
          avgIsolationScore,
        },
      };
    } catch (_) {
      results.substrateSummary = null;
    }

    if (isDegenerate(results.substrate)) {
      console.warn(`[buildGeometryAsync] Degenerate substrate: ${results.substrate.degenerateReason}`);
    } else {
      console.log(
        `[buildGeometryAsync] Substrate: ${results.substrate.meta.nodeCount} nodes, ` +
          `${results.substrate.mutualRankGraph?.edges?.length ?? 0} mutual recognition edges`
      );
    }

    try {
      if (!results.substrateDegenerate && typeof buildPreSemanticInterpretation === 'function') {
        results.preSemanticInterpretation = buildPreSemanticInterpretation(
          results.substrate,
          paragraphResult.paragraphs,
          results.geometryParagraphEmbeddings,
          undefined,
          results.basinInversionResult
        );
      } else {
        results.preSemanticInterpretation = null;
      }
      geometryDiagnostics.stages.preSemantic = {
        status: results.preSemanticInterpretation ? 'ok' : 'skipped',
        degenerate: !!results.substrateDegenerate,
      };
    } catch (_) {
      results.preSemanticInterpretation = null;
      geometryDiagnostics.stages.preSemantic = {
        status: 'failed',
      };
    }

    try {
      if (results.queryEmbedding && results.substrate && !results.substrateDegenerate) {
        results.queryRelevance = computeQueryRelevance({
          queryEmbedding: results.queryEmbedding,
          statements: shadowResult.statements,
          statementEmbeddings: results.statementEmbeddingResult?.embeddings || null,
          paragraphEmbeddings: results.geometryParagraphEmbeddings || null,
          paragraphs: paragraphResult.paragraphs,
        });
        const qrCount = results.queryRelevance?.statementScores?.size ?? 0;
        console.log(`[buildGeometryAsync] Query relevance computed: ${qrCount} statements scored`);
        geometryDiagnostics.stages.queryRelevance = {
          status: results.queryRelevance ? 'ok' : 'failed',
          statementCount: qrCount,
          ...(results.queryRelevance?.meta ? { meta: results.queryRelevance.meta } : {}),
        };
      } else {
        results.queryRelevance = null;
        const skipReason = !results.queryEmbedding
          ? 'queryEmbedding=null'
          : !results.substrate
            ? 'substrate=null'
            : 'substrateDegenerate=true';
        console.warn(`[buildGeometryAsync] Query relevance SKIPPED: ${skipReason}`);
        geometryDiagnostics.stages.queryRelevance = {
          status: 'skipped',
          reason: skipReason,
        };
      }
    } catch (err) {
      results.queryRelevance = null;
      console.warn('[buildGeometryAsync] Query relevance scoring failed:', getErrorMessage(err));
      geometryDiagnostics.stages.queryRelevance = {
        status: 'failed',
        error: getErrorMessage(err),
      };
    }

    try {
      if (options.sessionManager && context.canonicalAiTurnId) {
        const { packEmbeddingMap } = await import('../../../persistence/embedding-codec.js');
        const stmtDim = results.statementEmbeddingResult?.embeddings
          ?.values?.()
          .next?.().value?.length;
        const paraDim = results.geometryParagraphEmbeddings?.values?.().next?.().value?.length;
        const queryDim = results.queryEmbedding?.length;
        const dims =
          Number.isFinite(queryDim) && queryDim > 0
            ? queryDim
            : Number.isFinite(paraDim) && paraDim > 0
              ? paraDim
              : Number.isFinite(stmtDim) && stmtDim > 0
                ? stmtDim
                : DEFAULT_CONFIG.embeddingDimensions;

        const packedStatements = results.statementEmbeddingResult?.embeddings
          ? packEmbeddingMap(results.statementEmbeddingResult.embeddings, dims)
          : null;
        const packedParagraphs = results.geometryParagraphEmbeddings
          ? packEmbeddingMap(results.geometryParagraphEmbeddings, dims)
          : null;
        const queryBuffer = results.queryEmbedding
          ? results.queryEmbedding.buffer.slice(
              results.queryEmbedding.byteOffset,
              results.queryEmbedding.byteOffset + results.queryEmbedding.byteLength
            )
          : null;

        if (packedStatements || packedParagraphs || queryBuffer) {
          options.sessionManager
            .persistEmbeddings(context.canonicalAiTurnId, {
              ...(packedStatements ? { statementEmbeddings: packedStatements.buffer } : {}),
              ...(packedParagraphs ? { paragraphEmbeddings: packedParagraphs.buffer } : {}),
              ...(queryBuffer ? { queryEmbedding: queryBuffer } : {}),
              meta: {
                embeddingModelId: DEFAULT_CONFIG.modelId,
                dimensions: dims,
                hasStatements: Boolean(packedStatements),
                hasParagraphs: Boolean(packedParagraphs),
                hasQuery: Boolean(queryBuffer),
                ...(packedStatements
                  ? {
                      statementCount: packedStatements.index.length,
                      statementIndex: packedStatements.index,
                    }
                  : {}),
                ...(packedParagraphs
                  ? {
                      paragraphCount: packedParagraphs.index.length,
                      paragraphIndex: packedParagraphs.index,
                    }
                  : {}),
                embeddingVersion: 2,
                timestamp: Date.now(),
              },
            })
            .catch((err) =>
              console.warn('[buildGeometryAsync] Embedding persistence failed (non-blocking):', err)
            );
        }
      }
    } catch (err) {
      console.warn('[buildGeometryAsync] Embedding persistence setup failed (non-blocking):', err);
    }
  } catch (geometryError) {
    console.warn(
      '[buildGeometryAsync] Geometry pipeline failed, continuing without:',
      getErrorMessage(geometryError)
    );
    geometryDiagnostics.embeddingBackendFailure = true;
    geometryDiagnostics.stages.geometryFailure = {
      startedAtMs,
      timeMs: 0,
      error: getErrorMessage(geometryError),
    };
  }

  return results;
}

import { DEFAULT_THREAD } from '../../../shared/messaging.js';
import { ArtifactProcessor } from '../../../shared/artifact-processor';
import { PROVIDER_LIMITS } from '../../../shared/provider-limits';
import { parseMapperArtifact } from '../../../shared/parsing-utils';
import { buildCognitiveArtifact } from '../../../shared/cognitive-artifact';
import { classifyError } from '../error-classifier';
import {
  errorHandler,
  isProviderAuthError,
  createMultiProviderAuthError,
  getErrorMessage
} from '../../utils/ErrorHandler';
import { buildReactiveBridge } from '../../services/ReactiveBridge';
import { formatSubstrateForPrompt } from '../../skeletonization';
import { PROMPT_TEMPLATES } from '../templates/prompt-templates.js';
// computeExplore import removed (unused)
// persona signal injections removed (absorbed by Concierge)

const WORKFLOW_DEBUG = false;
const wdbg = (...args) => {
  if (WORKFLOW_DEBUG) console.log(...args);
};

export class StepExecutor {
  constructor(orchestrator, healthTracker) {
    this.orchestrator = orchestrator;
    // MapperService deprecated; mapping handled by new semantic mapper pipeline
    // ResponseProcessor removed; providers produce normalized { text } already
    this.healthTracker = healthTracker;
  }

  async executePromptStep(step, context, options) {
    const { streamingManager } = options;
    const artifactProcessor = new ArtifactProcessor();
    const {
      prompt,
      providers,
      useThinking,
      providerContexts,
      previousContext,
    } = step.payload;

    let enhancedPrompt = prompt;
    let bridgeContext = "";

    // Reactive Bridge Injection (Priority 1)
    if (step.payload.previousAnalysis) {
      try {
        const bridge = buildReactiveBridge(prompt, step.payload.previousAnalysis);
        if (bridge) {
          bridgeContext = bridge.context;
          console.log(`[StepExecutor] Injected reactive bridge context: ${bridge.matched.map(m => m.label).join(', ')}`);
        }
      } catch (err) {
        console.warn("[StepExecutor] Failed to build reactive bridge:", err);
      }
    }

    if (previousContext && bridgeContext) {
      enhancedPrompt = PROMPT_TEMPLATES.withBridgeAndPrior(prompt, bridgeContext, previousContext);
    } else if (previousContext) {
      enhancedPrompt = PROMPT_TEMPLATES.withPriorOnly(prompt, previousContext);
    } else if (bridgeContext) {
      enhancedPrompt = PROMPT_TEMPLATES.withBridgeOnly(prompt, bridgeContext);
    }

    const providerStatuses = [];
    const activeProviders = [];
    try {
      for (const pid of providers) {
        const bypassCircuit = options?.isRecompute === true;
        const check = bypassCircuit ? { allowed: true } : this.healthTracker.shouldAttempt(pid);
        if (!check.allowed) {
          providerStatuses.push({
            providerId: pid,
            status: 'skipped',
            skippedReason: check.reason || 'circuit_open',
            error: {
              type: 'circuit_open',
              message: 'Provider temporarily unavailable due to recent failures',
              retryable: true,
              retryAfterMs: check.retryAfterMs,
            },
          });
        } else {
          providerStatuses.push({ providerId: pid, status: 'queued', progress: 0 });
          activeProviders.push(pid);
        }
      }
      streamingManager.port.postMessage({
        type: 'WORKFLOW_PROGRESS',
        sessionId: context.sessionId,
        aiTurnId: context.canonicalAiTurnId || 'unknown',
        phase: 'batch',
        providerStatuses,
        completedCount: 0,
        totalCount: providers.length,
      });
    } catch (_) { }

    const promptLength = enhancedPrompt.length;
    const allowedProviders = [];
    const skippedProviders = [];
    try {
      for (const pid of activeProviders) {
        const limits = PROVIDER_LIMITS[pid];
        if (limits && promptLength > limits.maxInputChars) {
          skippedProviders.push(pid);
        } else {
          allowedProviders.push(pid);
        }
      }
      if (skippedProviders.length > 0) {
        skippedProviders.forEach((pid) => {
          try {
            const entry = providerStatuses.find((s) => s.providerId === pid);
            if (entry) {
              entry.status = 'skipped';
              entry.skippedReason = 'input_too_long';
              entry.error = { type: 'input_too_long', message: `Prompt length ${promptLength} exceeds limit for ${pid}`, retryable: true };
            } else {
              providerStatuses.push({ providerId: pid, status: 'skipped', skippedReason: 'input_too_long', error: { type: 'input_too_long', message: `Prompt length ${promptLength} exceeds limit for ${pid}`, retryable: true } });
            }
          } catch (_) { }
        });
        try {
          streamingManager.port.postMessage({
            type: 'WORKFLOW_PROGRESS',
            sessionId: context.sessionId,
            aiTurnId: context.canonicalAiTurnId || 'unknown',
            phase: 'batch',
            providerStatuses,
            completedCount: providerStatuses.filter((p) => p.status === 'completed').length,
            totalCount: providerStatuses.length,
          });
        } catch (_) { }
      }
      if (allowedProviders.length === 0) {
        throw new Error(`INPUT_TOO_LONG: Prompt length ${promptLength} exceeds limits for all selected providers`);
      }
    } catch (e) {
      return Promise.reject(e);
    }

    return new Promise((resolve, reject) => {
      const completedProviders = new Set();
      this.orchestrator.executeParallelFanout(enhancedPrompt, allowedProviders, {
        sessionId: context.sessionId,
        useThinking,
        providerContexts,
        providerMeta: step?.payload?.providerMeta,
        onPartial: (providerId, chunk) => {
          streamingManager.dispatchPartialDelta(
            context.sessionId,
            step.stepId,
            providerId,
            chunk.text,
            "Prompt",
          );
          try {
            const entry = providerStatuses.find((s) => s.providerId === providerId);
            if (entry) {
              entry.status = 'streaming';
              entry.progress = undefined;
              streamingManager.port.postMessage({
                type: 'WORKFLOW_PROGRESS',
                sessionId: context.sessionId,
                aiTurnId: context.canonicalAiTurnId || 'unknown',
                phase: 'batch',
                providerStatuses,
                completedCount: providerStatuses.filter((p) => p.status === 'completed').length,
                totalCount: providers.length,
              });
            }
          } catch (_) { }
        },
        onProviderComplete: (providerId, resultWrapper) => {
          const entry = providerStatuses.find((s) => s.providerId === providerId);

          if (resultWrapper && resultWrapper.status === "rejected") {
            const err = resultWrapper.reason;
            const classified = classifyError(err);
            try {
              if (!completedProviders.has(providerId)) {
                completedProviders.add(providerId);
                this.healthTracker.recordFailure(providerId, err);
              }
            } catch (_) { }

            if (entry) {
              entry.status = 'failed';
              entry.progress = 100;
              entry.error = classified;
            }

            try {
              streamingManager.port.postMessage({
                type: 'WORKFLOW_PROGRESS',
                sessionId: context.sessionId,
                aiTurnId: context.canonicalAiTurnId || 'unknown',
                phase: 'batch',
                providerStatuses,
                completedCount: providerStatuses.filter((p) => p.status === 'completed').length,
                totalCount: providers.length,
              });
            } catch (err) {
              wdbg('[StepExecutor] postMessage failed (rejected path):', err);
            }
            return;
          }

          try {
            if (!completedProviders.has(providerId)) {
              completedProviders.add(providerId);
              this.healthTracker.recordSuccess(providerId);
            }
          } catch (_) { }

          if (entry) {
            entry.status = 'completed';
            entry.progress = 100;
            if (entry.error) delete entry.error;

            try {
              streamingManager.port.postMessage({
                type: 'WORKFLOW_PROGRESS',
                sessionId: context.sessionId,
                aiTurnId: context.canonicalAiTurnId || 'unknown',
                phase: 'batch',
                providerStatuses,
                completedCount: providerStatuses.filter((p) => p.status === 'completed').length,
                totalCount: providers.length,
              });
            } catch (_) { }
          }
        },
        onError: (error) => {
          try {
            streamingManager.port.postMessage({
              type: "WORKFLOW_STEP_UPDATE",
              sessionId: context.sessionId,
              stepId: step.stepId,
              status: "failed",
              error: error?.message || String(error),
            });
          } catch (_) { }
        },
        onAllComplete: async (results, errors) => {
          const batchUpdates = {};
          results.forEach((result, providerId) => {
            batchUpdates[providerId] = result;
          });

          // Update contexts async
          options.persistenceCoordinator.persistProviderContextsAsync(context.sessionId, batchUpdates, "batch");

          const formattedResults = {};
          const authErrors = [];

          results.forEach((result, providerId) => {
            const processed = artifactProcessor.process(result.text || '');
            formattedResults[providerId] = {
              providerId: providerId,
              text: processed.cleanText,
              status: "completed",
              meta: result.meta || {},
              artifacts: processed.artifacts,
              ...(result.softError ? { softError: result.softError } : {}),
            };
            try {
              if (!completedProviders.has(providerId)) {
                completedProviders.add(providerId);
                this.healthTracker.recordSuccess(providerId);
              }
              const entry = providerStatuses.find((s) => s.providerId === providerId);
              if (entry) {
                entry.status = 'completed';
                entry.progress = 100;
                if (entry.error) delete entry.error;
              }
            } catch (_) { }
          });

          errors.forEach((error, providerId) => {
            const providerResponse = error?.providerResponse;
            const classified = classifyError(error);
            formattedResults[providerId] = {
              providerId: providerId,
              text: "",
              status: "failed",
              meta: {
                error: classified,
                _rawError: error.message,
                errorCode: error?.code,
                providerError: providerResponse?.meta?.error,
                providerDetails: providerResponse?.meta?.details,
              },
            };

            if (isProviderAuthError(error)) {
              authErrors.push(error);
            }
            try {
              if (!completedProviders.has(providerId)) {
                completedProviders.add(providerId);
                this.healthTracker.recordFailure(providerId, error);
              }
              const entry = providerStatuses.find((s) => s.providerId === providerId);
              if (entry) {
                entry.status = 'failed';
                entry.error = classified;
              }
              if (formattedResults[providerId]?.meta) {
                formattedResults[providerId].meta.retryable = classified?.retryable;
                formattedResults[providerId].meta.retryAfterMs = classified?.retryAfterMs;
                formattedResults[providerId].meta.errorType = classified?.type;
                formattedResults[providerId].meta.errorMessage = classified?.message;
                formattedResults[providerId].meta.requiresReauth = classified?.requiresReauth;
              }
            } catch (_) { }
          });

          const hasAnyValidResults = Object.values(formattedResults).some(
            (r) =>
              r.status === "completed" && r.text && r.text.trim().length > 0,
          );

          // ✅ CRITICAL FIX: Ensure skipped/failed providers are included in formattedResults
          providerStatuses.forEach(p => {
            if ((p.status === 'skipped' || p.status === 'failed') && !formattedResults[p.providerId]) {
              formattedResults[p.providerId] = {
                providerId: p.providerId,
                text: "",
                status: p.status === 'skipped' ? 'skipped' : 'failed', // Map to valid status
                meta: {
                  error: p.error?.message || p.skippedReason || "Skipped or failed",
                  skipped: p.status === 'skipped',
                  reason: p.skippedReason
                }
              };
            }
          });

          if (!hasAnyValidResults) {
            if (authErrors.length > 0 && authErrors.length === errors.size) {
              const providerIds = Array.from(errors.keys());
              reject(createMultiProviderAuthError(providerIds, "Multiple authentication errors occurred."));
              return;
            }

            // Even if no valid results, we might want to return the skipped/failed ones instead of rejecting
            // if we want the UI to show them as "failed" orbs.
            if (providerStatuses.length > 0) {
              resolve({
                results: formattedResults,
                errors: Object.fromEntries(errors),
              });
              return;
            }

            reject(
              new Error("All providers failed or returned empty responses"),
            );
            return;
          }

          try {
            const completedCount = providerStatuses.filter((p) => p.status === 'completed').length;
            streamingManager.port.postMessage({
              type: 'WORKFLOW_PROGRESS',
              sessionId: context.sessionId,
              aiTurnId: context.canonicalAiTurnId || 'unknown',
              phase: 'batch',
              providerStatuses,
              completedCount,
              totalCount: providers.length,
            });

            const failedProviders = providerStatuses.filter((p) => p.status === 'failed');
            const successfulProviders = providerStatuses.filter((p) => p.status === 'completed');
            if (failedProviders.length > 0) {
              streamingManager.port.postMessage({
                type: 'WORKFLOW_PARTIAL_COMPLETE',
                sessionId: context.sessionId,
                aiTurnId: context.canonicalAiTurnId || 'unknown',
                successfulProviders: successfulProviders.map((p) => p.providerId),
                failedProviders: failedProviders.map((p) => ({ providerId: p.providerId, error: p.error })),
                mappingCompleted: false,
              });
            }
          } catch (_) { }

          resolve({
            results: formattedResults,
            errors: Object.fromEntries(errors),
          });
        },
      });
    });
  }

  async executeMappingStep(step, context, stepResults, workflowContexts, options) {
    const { streamingManager } = options;
    const artifactProcessor = new ArtifactProcessor();
    const payload = step.payload;
    const rawSourceData = await this._resolveSourceData(
      payload,
      context,
      stepResults,
      options
    );

    const sourceData = (() => {
      const items = Array.isArray(rawSourceData) ? rawSourceData : [];
      const out = [];
      const seen = new Set();
      for (const s of items) {
        const providerId = String(s?.providerId || '').trim();
        const text = String(s?.text ?? s?.content ?? '').trim();
        if (!providerId || !text) continue;
        if (seen.has(providerId)) continue;
        seen.add(providerId);
        out.push({ providerId, text });
      }
      return out;
    })();

    if (sourceData.length < 2) {
      throw new Error(
        `Mapping requires at least 2 valid sources, but found ${sourceData.length}.`,
      );
    }

    wdbg(
      `[StepExecutor] Running mapping with ${sourceData.length
      } sources: ${sourceData.map((s) => s.providerId).join(", ")} `,
    );

    const providerOrder = Array.isArray(payload.providerOrder)
      ? payload.providerOrder
      : sourceData.map((s) => s.providerId);
    const normalizedProviderOrder = providerOrder
      .map((pid) => String(pid || '').trim())
      .filter(Boolean);
    const uniqueProviderOrder = [];
    const providerSeen = new Set();
    for (const pid of normalizedProviderOrder) {
      if (providerSeen.has(pid)) continue;
      providerSeen.add(pid);
      uniqueProviderOrder.push(pid);
    }

    const sourceProviderIds = sourceData.map((s) => s.providerId);
    const sourceProviderIdSet = new Set(sourceProviderIds);

    const citationOrder = uniqueProviderOrder.filter((pid) =>
      sourceProviderIdSet.has(pid),
    );
    for (const pid of sourceProviderIds) {
      if (citationOrder.includes(pid)) continue;
      citationOrder.push(pid);
    }

    const indexedSourceData = sourceData.map((s) => {
      const modelIndex = citationOrder.indexOf(s.providerId) + 1;
      if (modelIndex < 1) {
        throw new Error(
          `[StepExecutor] Invariant violated: providerId ${s.providerId} missing from citationOrder`,
        );
      }
      return {
        providerId: s.providerId,
        modelIndex,
        text: s.text,
      };
    });

    // ══════════════════════════════════════════════════════════════════════
    // NEW PIPELINE: Shadow -> Semantic -> Traversal
    // ══════════════════════════════════════════════════════════════════════

    // 1. Import new modules dynamically
    // Import shadow module once at function scope so callbacks can use its exports without awaiting
    const shadowModule = await import('../../shadow');
    const { extractShadowStatements, computeShadowDelta, getTopUnreferenced } = shadowModule;
    const { buildSemanticMapperPrompt, parseSemanticMapperOutput } = await import('../../ConciergeService/semanticMapper');
    const { reconstructProvenance } = await import('../../ConciergeService/claimAssembly');
    const { extractForcingPoints } = await import('../../utils/cognitive/traversalEngine');
    const { enrichStatementsWithGeometry } = await import('../../geometry/enrichment');
    const { buildStatementFates } = await import('../../geometry/interpretation/fateTracking');
    const { findUnattendedRegions } = await import('../../geometry/interpretation/coverageAudit');
    const { buildCompletenessReport } = await import('../../geometry/interpretation/completenessReport');
    const { computeQueryRelevance } = await import('../../geometry/queryRelevance');

    const nowMs = () =>
      typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();

    const geometryDiagnostics = {
      embeddingBackendFailure: false,
      stages: {},
    };

    // 2. Shadow Extraction (Mechanical)
    // Map sourceData to expected format (modelIndex, content)
    const shadowInput = sourceData.map(s => {
      const idx = citationOrder.findIndex(pid => pid === s.providerId) + 1;
      return { modelIndex: idx > 0 ? idx : 99, content: s.text };
    });

    console.log(`[StepExecutor] Extracting shadow statements from ${shadowInput.length} models...`);
    const shadowResult = extractShadowStatements(shadowInput);
    console.log(`[StepExecutor] Extracted ${shadowResult.statements.length} shadow statements.`);

    const { projectParagraphs } = shadowModule;
    const paragraphResult = projectParagraphs(shadowResult.statements);
    console.log(`[StepExecutor] Projected ${paragraphResult.paragraphs.length} paragraphs ` +
      `(${paragraphResult.meta.contestedCount} contested, ` +
      `${paragraphResult.meta.processingTimeMs.toFixed(1)}ms)`);

    // ════════════════════════════════════════════════════════════════════════
    // 2.6 CLUSTERING (async, may fail gracefully)
    // ════════════════════════════════════════════════════════════════════════
    let clusteringResult = null;
    let embeddingResult = null;
    let statementEmbeddingResult = null;
    let geometryParagraphEmbeddings = null;
    let queryEmbedding = null;
    let queryRelevance = null;
    let paragraphClusteringSummary = null;
    let substrateSummary = null;
    let substrateGraph = null;
    let substrateDegenerate = null;
    let substrateDegenerateReason = null;
    let preSemanticInterpretation = null;
    let substrate = null;
    let enrichmentResult = null;
    let clusteringModule = null;

    if (Array.isArray(shadowResult?.statements) && shadowResult.statements.length > 0) {
      try {
        clusteringModule = await import('../../clustering');
        const { generateStatementEmbeddings, DEFAULT_CONFIG } = clusteringModule;
        statementEmbeddingResult = await generateStatementEmbeddings(
          shadowResult.statements,
          DEFAULT_CONFIG
        );
        geometryDiagnostics.stages.statementEmbeddings = {
          status: 'ok',
          statements: shadowResult.statements.length,
          embedded: typeof statementEmbeddingResult?.statementCount === 'number' ? statementEmbeddingResult.statementCount : null,
        };
      } catch (embeddingError) {
        console.warn('[StepExecutor] Statement embedding generation failed, continuing without embeddings:', getErrorMessage(embeddingError));
        geometryDiagnostics.embeddingBackendFailure = true;
        geometryDiagnostics.stages.statementEmbeddings = {
          status: 'failed',
          error: getErrorMessage(embeddingError),
        };
        statementEmbeddingResult = null;
        clusteringModule = null;
      }
    } else {
      geometryDiagnostics.stages.statementEmbeddings = {
        status: 'skipped',
        reason: 'no_statements',
      };
    }

    if (paragraphResult.paragraphs.length > 0 && statementEmbeddingResult?.embeddings) {
      try {
        if (!clusteringModule) {
          clusteringModule = await import('../../clustering');
        }

        const { generateTextEmbeddings, stripInlineMarkdown, poolToParagraphEmbeddings, getEmbeddingStatus, buildClusters, DEFAULT_CONFIG } = clusteringModule;
        const { buildGeometricSubstrate, isDegenerate } = await import('../../geometry');
        const { buildPreSemanticInterpretation } = await import('../../geometry/interpretation');

        const rawQuery =
          (payload && typeof payload.originalPrompt === 'string' && payload.originalPrompt) ||
          (context && typeof context.userMessage === 'string' && context.userMessage) ||
          '';
        const cleanedQuery = stripInlineMarkdown(String(rawQuery || ''));
        try {
          const queryEmbeddingBatch = await generateTextEmbeddings([cleanedQuery], DEFAULT_CONFIG);
          queryEmbedding = queryEmbeddingBatch.get('0') || null;
          if (queryEmbedding && queryEmbedding.length !== DEFAULT_CONFIG.embeddingDimensions) {
            throw new Error(
              `[StepExecutor] Query embedding dimension mismatch: expected ${DEFAULT_CONFIG.embeddingDimensions}, got ${queryEmbedding.length}`
            );
          }
          geometryDiagnostics.stages.queryEmbedding = {
            status: queryEmbedding ? 'ok' : 'failed',
            dimensions: queryEmbedding ? queryEmbedding.length : null,
          };
        } catch (err) {
          queryEmbedding = null;
          geometryDiagnostics.stages.queryEmbedding = {
            status: 'failed',
            error: getErrorMessage(err),
          };
        }

        const pooledParagraphEmbeddings = poolToParagraphEmbeddings(
          paragraphResult.paragraphs,
          shadowResult.statements,
          statementEmbeddingResult.embeddings,
          DEFAULT_CONFIG.embeddingDimensions
        );
        geometryDiagnostics.stages.paragraphEmbeddings = {
          status: 'ok',
          paragraphs: Array.isArray(paragraphResult?.paragraphs) ? paragraphResult.paragraphs.length : 0,
          statementEmbeddings: statementEmbeddingResult?.embeddings instanceof Map ? statementEmbeddingResult.embeddings.size : 0,
          paragraphEmbeddings: pooledParagraphEmbeddings instanceof Map ? pooledParagraphEmbeddings.size : 0,
        };

        const firstParagraphEmbedding = pooledParagraphEmbeddings.values().next().value;
        if (queryEmbedding && firstParagraphEmbedding && firstParagraphEmbedding.length !== queryEmbedding.length) {
          throw new Error(
            `[StepExecutor] Query/paragraph embedding dimension mismatch: query=${queryEmbedding.length}, paragraph=${firstParagraphEmbedding.length}`
          );
        }

        embeddingResult = {
          embeddings: pooledParagraphEmbeddings,
          dimensions: DEFAULT_CONFIG.embeddingDimensions,
          timeMs: statementEmbeddingResult.timeMs,
        };

        /** @type {"none" | "webgpu" | "wasm"} */
        let embeddingBackend = 'none';
        try {
          const status = await getEmbeddingStatus();
          if (status?.backend === 'webgpu' || status?.backend === 'wasm') {
            embeddingBackend = status.backend;
          }
        } catch (_) { }

        geometryParagraphEmbeddings = pooledParagraphEmbeddings;

        substrate = buildGeometricSubstrate(
          paragraphResult.paragraphs,
          geometryParagraphEmbeddings,
          embeddingBackend
        );
        geometryDiagnostics.stages.substrate = {
          status: 'ok',
          embeddingBackend,
        };

        try {
          substrateDegenerate = isDegenerate(substrate);
          substrateDegenerateReason = substrateDegenerate
            ? (substrate && typeof substrate === 'object' && 'degenerateReason' in substrate
              ? String(substrate.degenerateReason)
              : 'unknown')
            : null;
        } catch (_) {
          substrateDegenerate = null;
          substrateDegenerateReason = null;
        }

        try {
          const nodeCount = Array.isArray(substrate.nodes) ? substrate.nodes.length : 0;
          const contestedCount = Array.isArray(substrate.nodes)
            ? substrate.nodes.reduce((acc, n) => acc + (n?.contested ? 1 : 0), 0)
            : 0;
          const avgTop1Sim = Array.isArray(substrate.nodes) && nodeCount > 0
            ? substrate.nodes.reduce((acc, n) => acc + (typeof n?.top1Sim === 'number' ? n.top1Sim : 0), 0) / nodeCount
            : 0;
          const avgIsolationScore = Array.isArray(substrate.nodes) && nodeCount > 0
            ? substrate.nodes.reduce((acc, n) => acc + (typeof n?.isolationScore === 'number' ? n.isolationScore : 0), 0) / nodeCount
            : 0;

          substrateSummary = {
            shape: {
              prior: String(substrate?.shape?.prior || 'unknown'),
              confidence: typeof substrate?.shape?.confidence === 'number' ? substrate.shape.confidence : 0,
            },
            topology: {
              componentCount: typeof substrate?.topology?.componentCount === 'number' ? substrate.topology.componentCount : 0,
              largestComponentRatio: typeof substrate?.topology?.largestComponentRatio === 'number' ? substrate.topology.largestComponentRatio : 0,
              isolationRatio: typeof substrate?.topology?.isolationRatio === 'number' ? substrate.topology.isolationRatio : 0,
              globalStrongDensity: typeof substrate?.topology?.globalStrongDensity === 'number' ? substrate.topology.globalStrongDensity : 0,
            },
            meta: {
              embeddingSuccess: !!substrate?.meta?.embeddingSuccess,
              embeddingBackend: substrate?.meta?.embeddingBackend || 'none',
              nodeCount: typeof substrate?.meta?.nodeCount === 'number' ? substrate.meta.nodeCount : nodeCount,
              knnEdgeCount: typeof substrate?.meta?.knnEdgeCount === 'number' ? substrate.meta.knnEdgeCount : 0,
              mutualEdgeCount: typeof substrate?.meta?.mutualEdgeCount === 'number' ? substrate.meta.mutualEdgeCount : 0,
              strongEdgeCount: typeof substrate?.meta?.strongEdgeCount === 'number' ? substrate.meta.strongEdgeCount : 0,
              softThreshold: typeof substrate?.graphs?.strong?.softThreshold === 'number' ? substrate.graphs.strong.softThreshold : 0,
              buildTimeMs: typeof substrate?.meta?.buildTimeMs === 'number' ? substrate.meta.buildTimeMs : 0,
            },
            nodes: {
              contestedCount,
              avgTop1Sim,
              avgIsolationScore,
            },
          };
        } catch (_) {
          substrateSummary = null;
        }

        if (isDegenerate(substrate)) {
          console.warn(`[StepExecutor] Degenerate substrate: ${substrate.degenerateReason}`);
        } else {
          console.log(
            `[StepExecutor] Substrate shape: ${substrate.shape.prior} ` +
            `(${substrate.shape.confidence.toFixed(2)})`
          );
        }

        if (paragraphResult.paragraphs.length >= 3) {
          clusteringResult = buildClusters(
            paragraphResult.paragraphs,
            shadowResult.statements,
            geometryParagraphEmbeddings,
            DEFAULT_CONFIG,
            substrate.graphs.mutual
          );
          geometryDiagnostics.stages.clustering = {
            status: 'ok',
            clusters: Array.isArray(clusteringResult?.clusters) ? clusteringResult.clusters.length : 0,
            paragraphs: Array.isArray(paragraphResult?.paragraphs) ? paragraphResult.paragraphs.length : 0,
          };

          clusteringResult.meta.embeddingTimeMs = embeddingResult.timeMs;
          clusteringResult.meta.totalTimeMs = embeddingResult.timeMs + clusteringResult.meta.clusteringTimeMs;

          try {
            paragraphClusteringSummary = {
              meta: { ...(clusteringResult.meta || {}) },
              clusters: (clusteringResult.clusters || []).map((c) => ({
                id: c.id,
                size: Array.isArray(c.paragraphIds) ? c.paragraphIds.length : 0,
                cohesion: typeof c.cohesion === 'number' ? c.cohesion : 0,
                pairwiseCohesion: typeof c.pairwiseCohesion === 'number' ? c.pairwiseCohesion : 0,
                uncertain: !!c.uncertain,
                ...(Array.isArray(c.uncertaintyReasons) ? { uncertaintyReasons: c.uncertaintyReasons } : {}),
              })),
            };
          } catch (_) {
            paragraphClusteringSummary = null;
          }
        } else {
          clusteringResult = null;
          paragraphClusteringSummary = null;
        }

        let perModelQueryRelevance = undefined;
        if (queryEmbedding && statementEmbeddingResult?.embeddings && paragraphResult?.paragraphs) {
          try {
            const { computePerModelQueryRelevance } = await import('../../geometry/interpretation/modelOrdering');
            perModelQueryRelevance = computePerModelQueryRelevance(
              queryEmbedding,
              statementEmbeddingResult.embeddings,
              paragraphResult.paragraphs
            );
          } catch (err) {
            console.warn('[StepExecutor] Per-model query relevance failed:', getErrorMessage(err));
          }
        }

        try {
          if (!substrateDegenerate && typeof buildPreSemanticInterpretation === 'function') {
            preSemanticInterpretation = buildPreSemanticInterpretation(
              substrate,
              paragraphResult.paragraphs,
              Array.isArray(clusteringResult?.clusters) ? clusteringResult.clusters : undefined,
              geometryParagraphEmbeddings,
              perModelQueryRelevance
            );
          } else {
            preSemanticInterpretation = null;
          }
          geometryDiagnostics.stages.preSemantic = {
            status: preSemanticInterpretation ? 'ok' : 'skipped',
            degenerate: !!substrateDegenerate,
          };
        } catch (_) {
          preSemanticInterpretation = null;
          geometryDiagnostics.stages.preSemantic = {
            status: 'failed',
          };
        }

        try {
          if (queryEmbedding && substrate && !substrateDegenerate) {
            queryRelevance = computeQueryRelevance({
              queryEmbedding,
              statements: shadowResult.statements,
              statementEmbeddings: statementEmbeddingResult?.embeddings || null,
              paragraphEmbeddings: geometryParagraphEmbeddings || null,
              paragraphs: paragraphResult.paragraphs,
              substrate,
              regionization: preSemanticInterpretation?.regionization || null,
              regionProfiles: preSemanticInterpretation?.regionProfiles || null,
            });
            geometryDiagnostics.stages.queryRelevance = {
              status: queryRelevance ? 'ok' : 'failed',
              ...(queryRelevance?.meta ? { meta: queryRelevance.meta } : {}),
            };
          } else {
            queryRelevance = null;
            geometryDiagnostics.stages.queryRelevance = {
              status: 'skipped',
              reason: 'missing_query_embedding_or_geometry',
            };
          }
        } catch (err) {
          queryRelevance = null;
          console.warn('[StepExecutor] Query relevance scoring failed:', getErrorMessage(err));
          geometryDiagnostics.stages.queryRelevance = {
            status: 'failed',
            error: getErrorMessage(err),
          };
        }

        try {
          if (substrate && !substrateDegenerate && substrate.layout2d && substrate.layout2d.coordinates) {
            const coords = substrate.layout2d.coordinates || {};
            const regions = preSemanticInterpretation?.regionization?.regions || [];

            const paragraphToRegion = new Map();
            for (const region of regions) {
              for (const nodeId of region.nodeIds || []) {
                paragraphToRegion.set(nodeId, region.id);
              }
            }

            const paragraphToComponent = new Map();
            for (const comp of substrate.topology.components || []) {
              for (const nodeId of comp.nodeIds || []) {
                paragraphToComponent.set(nodeId, comp.id);
              }
            }

            substrateGraph = {
              nodes: (substrate.nodes || []).map((node) => ({
                paragraphId: node.paragraphId,
                modelIndex: node.modelIndex,
                dominantStance: node.dominantStance,
                contested: node.contested,
                statementIds: Array.isArray(node.statementIds) ? [...node.statementIds] : [],
                top1Sim: node.top1Sim,
                avgTopKSim: node.avgTopKSim,
                mutualDegree: node.mutualDegree,
                strongDegree: node.strongDegree,
                isolationScore: node.isolationScore,
                componentId: paragraphToComponent.get(node.paragraphId) || null,
                regionId: paragraphToRegion.get(node.paragraphId) || null,
                x: coords[node.paragraphId]?.[0] ?? 0,
                y: coords[node.paragraphId]?.[1] ?? 0,
              })),
              edges: (substrate.graphs?.knn?.edges || []).map((e) => ({
                source: e.source,
                target: e.target,
                similarity: e.similarity,
                rank: e.rank,
              })),
              mutualEdges: (substrate.graphs?.mutual?.edges || []).map((e) => ({
                source: e.source,
                target: e.target,
                similarity: e.similarity,
                rank: e.rank,
              })),
              strongEdges: (substrate.graphs?.strong?.edges || []).map((e) => ({
                source: e.source,
                target: e.target,
                similarity: e.similarity,
                rank: e.rank,
              })),
              softThreshold: substrate.graphs?.strong?.softThreshold,
            };
          } else {
            substrateGraph = null;
          }
        } catch (_) {
          substrateGraph = null;
        }

        try {
          const regions = Array.isArray(preSemanticInterpretation?.regionization?.regions)
            ? preSemanticInterpretation.regionization.regions
            : [];
          if (substrate && regions.length > 0) {
            enrichmentResult = enrichStatementsWithGeometry(
              shadowResult.statements,
              paragraphResult.paragraphs,
              substrate,
              regions
            );
            if (enrichmentResult?.unenrichedCount > 0) {
              console.warn(
                `[Enrichment] ${enrichmentResult.unenrichedCount}/${shadowResult.statements.length} statements could not be enriched`,
                enrichmentResult.failures.slice(0, 5)
              );
            }
          } else {
            enrichmentResult = null;
          }
        } catch (err) {
          enrichmentResult = null;
          console.warn('[Enrichment] Failed:', getErrorMessage(err));
        }

        if (clusteringResult) {
          const nonSingletons = clusteringResult.clusters.filter(c => c.paragraphIds.length > 1);
          console.log(`[StepExecutor] Clustering results:`);
          console.log(`  - Total clusters: ${clusteringResult.meta.totalClusters}`);
          console.log(`  - Singletons: ${clusteringResult.meta.singletonCount}`);
          console.log(`  - Multi-member: ${nonSingletons.length}`);
          console.log(`  - Uncertain: ${clusteringResult.meta.uncertainCount}`);
          console.log(`  - Compression: ${(clusteringResult.meta.compressionRatio * 100).toFixed(0)}%`);
          console.log(
            `  - Timing: embed ${clusteringResult.meta.embeddingTimeMs.toFixed(0)}ms, ` +
            `cluster ${clusteringResult.meta.clusteringTimeMs.toFixed(0)}ms`
          );

          if (nonSingletons.length > 0) {
            const largest = [...nonSingletons]
              .sort((a, b) => b.paragraphIds.length - a.paragraphIds.length)
              .slice(0, 3);
            console.log(
              `  - Largest clusters:`,
              largest.map(c => `${c.id}: ${c.paragraphIds.length} paragraphs`)
            );
          }
        }
      } catch (clusteringError) {
        // Per design: skip clustering entirely on failure, continue without
        console.warn('[StepExecutor] Clustering failed, continuing without clusters:', getErrorMessage(clusteringError));
        geometryDiagnostics.embeddingBackendFailure = true;
        geometryDiagnostics.stages.clusteringFailure = {
          startedAtMs: nowMs(),
          timeMs: 0,
          error: getErrorMessage(clusteringError),
        };
        clusteringResult = null;
      }
    } else {
      const reason = paragraphResult.paragraphs.length === 0
        ? 'no_paragraphs'
        : 'statement_embeddings_unavailable';
      console.log(`[StepExecutor] Skipping embeddings/geometry (${reason})`);
      geometryDiagnostics.stages.embeddingsSkipped = {
        startedAtMs: nowMs(),
        timeMs: 0,
        reason,
      };
    }

    // 3. Build Prompt (LLM) - pass pre-computed paragraph projection and clustering
    // Apply geometry-informed model ordering if available (outside-in: most irreplaceable at edges).
    // Falls back to citationOrder if pre-semantic didn't run or produced no ordering.
    const orderedModelIndices = preSemanticInterpretation?.modelOrdering?.orderedModelIndices;
    const orderedSourceData = (Array.isArray(orderedModelIndices) && orderedModelIndices.length > 0)
      ? (() => {
          const positionByModelIndex = new Map(orderedModelIndices.map((mi, pos) => [mi, pos]));
          return [...indexedSourceData].sort((a, b) => {
            const pa = positionByModelIndex.get(a.modelIndex) ?? indexedSourceData.length;
            const pb = positionByModelIndex.get(b.modelIndex) ?? indexedSourceData.length;
            return pa - pb;
          });
        })()
      : indexedSourceData;

    const mappingPrompt = buildSemanticMapperPrompt(
      payload.originalPrompt,
      orderedSourceData.map((s) => ({ modelIndex: s.modelIndex, content: s.text }))
    );

    const promptLength = mappingPrompt.length;
    console.log(`[StepExecutor] Semantic Mapper prompt length for ${payload.mappingProvider}: ${promptLength} chars`);

    const limits = PROVIDER_LIMITS[payload.mappingProvider];
    if (limits && promptLength > limits.maxInputChars) {
      console.warn(`[StepExecutor] Mapping prompt length ${promptLength} exceeds limit ${limits.maxInputChars} for ${payload.mappingProvider}`);
      throw new Error(`INPUT_TOO_LONG: Prompt length ${promptLength} exceeds limit ${limits.maxInputChars} for ${payload.mappingProvider}`);
    }

    return new Promise((resolve, reject) => {
      this.orchestrator.executeParallelFanout(
        mappingPrompt,
        [payload.mappingProvider],
        {
          sessionId: context.sessionId,
          useThinking: payload.useThinking,
          providerMeta: step?.payload?.providerMeta,
          onPartial: (providerId, chunk) => {
            streamingManager.dispatchPartialDelta(
              context.sessionId,
              step.stepId,
              providerId,
              chunk.text,
              "Mapping",
            );
          },
          onAllComplete: async (results, errors) => {
            let finalResult = results.get(payload.mappingProvider);
            const providerError = errors?.get?.(payload.mappingProvider);

            if ((!finalResult || !finalResult.text) && providerError) {
              const recovered = streamingManager.getRecoveredText(
                context.sessionId, step.stepId, payload.mappingProvider
              );

              if (recovered && recovered.trim().length > 0) {
                finalResult = finalResult || { providerId: payload.mappingProvider, meta: {} };
                finalResult.text = recovered;
                finalResult.softError = finalResult.softError || {
                  message: providerError?.message || String(providerError),
                };
              }
            }

            let mapperArtifact = null;
            const rawText = finalResult?.text || "";
            let shadowDelta = null;
            let topUnindexed = null;
            let referencedIds = null;
            let structuralValidation = null;

            if (finalResult?.text) {
              // 4. Parse (New Parser)
              const parseResult = parseSemanticMapperOutput(rawText, shadowResult.statements);

              if (parseResult.success && parseResult.output) {
                // 5. Assembly & Traversal (Mechanical)
                const regions = Array.isArray(preSemanticInterpretation?.regionization?.regions)
                  ? preSemanticInterpretation.regionization.regions
                  : [];
                const regionProfiles = Array.isArray(preSemanticInterpretation?.regionProfiles)
                  ? preSemanticInterpretation.regionProfiles
                  : [];

                const unifiedEdges = Array.isArray(parseResult.output.edges) ? parseResult.output.edges : [];
                let unifiedConditionals = Array.isArray(parseResult.output.conditionals) ? parseResult.output.conditionals : [];
                // rawGates and gateQuestionByClaimPair are populated by the Survey Mapper below (after enrichedClaims)
                let rawGates = [];
                let gateQuestionByClaimPair = new Map();

                let enrichedClaims = [];

                const mapperClaimsForProvenance = (parseResult.output.claims || []).map((c) => ({
                  id: c.id,
                  label: c.label,
                  text: c.text,
                  supporters: Array.isArray(c.supporters) ? c.supporters : [],
                  challenges: c?.challenges || null,
                }));

                enrichedClaims = await reconstructProvenance(
                  mapperClaimsForProvenance,
                  shadowResult.statements,
                  paragraphResult.paragraphs,
                  embeddingResult?.embeddings || new Map(),
                  regions,
                  citationOrder.length,
                  statementEmbeddingResult?.embeddings || null
                );

                // ── SURVEY MAPPER ─────────────────────────────────────────
                // Runs after enrichedClaims are ready. Produces gates (forced_choice /
                // conditional_gate) using strict survey methodology. Toggle useSurveyMapper
                // to false to bypass entirely and flow straight to Singularity with no gates.
                let surveyRationale = null;
                const useSurveyMapper = true;

                if (useSurveyMapper && enrichedClaims.length > 0) {
                  try {
                    const { buildSurveyMapperPrompt, parseSurveyMapperOutput: parseSurveyOutput } =
                      await import('../../ConciergeService/surveyMapper');

                    const claimsForSurvey = enrichedClaims.map((c) => ({
                      id: String(c?.id || ''),
                      label: String(c?.label || ''),
                      text: String(c?.text || ''),
                      supporters: Array.isArray(c?.supporters) ? c.supporters : [],
                    }));

                    const surveyPrompt = buildSurveyMapperPrompt(
                      payload.originalPrompt,
                      claimsForSurvey,
                      unifiedEdges,
                      indexedSourceData.map((s) => ({ modelIndex: s.modelIndex, content: s.text }))
                    );

                    const surveyResult = await new Promise((resolve) => {
                      let surveyText = '';
                      this.orchestrator.executeParallelFanout(
                        surveyPrompt,
                        [payload.mappingProvider],
                        {
                          sessionId: context.sessionId,
                          useThinking: false,
                          onPartial: () => { },
                          onAllComplete: (results) => {
                            const r = results?.get?.(payload.mappingProvider);
                            surveyText = r?.text || '';
                            resolve({ text: surveyText });
                          },
                          onError: () => resolve({ text: '' }),
                        }
                      );
                    });

                    if (surveyResult?.text) {
                      const parsed = parseSurveyOutput(surveyResult.text);
                      rawGates = parsed.gates;
                      surveyRationale = parsed.rationale;
                      if (parsed.errors.length > 0) {
                        console.warn('[SurveyMapper] Parse warnings:', parsed.errors);
                      }
                      console.log(`[SurveyMapper] ${rawGates.length} gate(s) produced`);

                      // Rebuild unifiedConditionals and gateQuestionByClaimPair from survey gates
                      unifiedConditionals = [];
                      gateQuestionByClaimPair = new Map();

                      for (const gate of rawGates) {
                        if (!gate || !gate.id) continue;
                        const gClaims = Array.isArray(gate.claims)
                          ? gate.claims.map((c) => String(c).trim()).filter(Boolean)
                          : [];
                        if (gClaims.length === 0) continue;

                        if (gate.classification === 'conditional_gate') {
                          const affected = Array.isArray(gate.affectedClaims) && gate.affectedClaims.length > 0
                            ? gate.affectedClaims.map((c) => String(c).trim()).filter(Boolean)
                            : gClaims;
                          unifiedConditionals.push({
                            id: gate.id,
                            question: String(gate.question || '').trim(),
                            affectedClaims: affected,
                            construct: gate.construct || null,
                            hinge: gate.hinge || null,
                            classification: 'conditional_gate',
                          });
                        } else if (gate.classification === 'forced_choice' && gClaims.length >= 2) {
                          for (let i = 0; i < gClaims.length; i++) {
                            for (let j = i + 1; j < gClaims.length; j++) {
                              const key = [gClaims[i], gClaims[j]].sort().join('::');
                              gateQuestionByClaimPair.set(key, String(gate.question || '').trim());
                            }
                          }
                        }
                      }
                    }
                  } catch (err) {
                    console.warn('[SurveyMapper] Failed, continuing without gates:', getErrorMessage(err));
                    rawGates = [];
                    surveyRationale = null;
                  }
                }

                let completeness = null;
                try {
                  if (substrate && Array.isArray(regions) && regions.length > 0) {
                    const statementFates = buildStatementFates(shadowResult.statements, enrichedClaims, queryRelevance?.statementScores ?? null);
                    const unattendedRegions = findUnattendedRegions(
                      substrate,
                      paragraphResult.paragraphs,
                      enrichedClaims,
                      regions,
                      shadowResult.statements
                    );
                    const completenessReport = buildCompletenessReport(
                      statementFates,
                      unattendedRegions,
                      shadowResult.statements,
                      regions.length
                    );
                    completeness = {
                      report: completenessReport,
                      statementFates: Object.fromEntries(statementFates),
                      unattendedRegions,
                    };
                    console.log('[Reconciliation] Completeness:', {
                      statementCoverage: `${(completenessReport.statements.coverageRatio * 100).toFixed(1)}%`,
                      regionCoverage: `${(completenessReport.regions.coverageRatio * 100).toFixed(1)}%`,
                      verdict: completenessReport.verdict.recommendation,
                      unaddressed: completenessReport.statements.unaddressed
                    });
                  }
                } catch (err) {
                  completeness = null;
                  console.warn('[Reconciliation] Failed:', getErrorMessage(err));
                }

                // ── CLAIM↔GEOMETRY ALIGNMENT ─────────────────────────────
                let alignmentResult = null;
                try {
                  if (statementEmbeddingResult?.embeddings && regions.length > 0 && enrichedClaims.length > 0) {
                    const { buildClaimVectors, computeAlignment } = await import('../../geometry');
                    // Ensure dimensions are valid (fallback to length of first embedding if dimensions missing)
                    const dimensions = statementEmbeddingResult.dimensions ||
                      (statementEmbeddingResult.embeddings.size > 0
                        ? (statementEmbeddingResult.embeddings.values().next().value?.length || 0)
                        : 0);

                    const claimVectors = buildClaimVectors(
                      enrichedClaims,
                      statementEmbeddingResult.embeddings,
                      dimensions
                    );
                    if (claimVectors.length > 0) {
                      alignmentResult = computeAlignment(
                        claimVectors,
                        regions,
                        regionProfiles,
                        statementEmbeddingResult.embeddings
                      );
                      console.log('[Alignment]', {
                        globalCoverage: `${(alignmentResult.globalCoverage * 100).toFixed(1)}%`,
                        unattended: alignmentResult.unattendedRegionIds.length,
                        splits: alignmentResult.splitAlerts.length,
                        merges: alignmentResult.mergeAlerts.length,
                      });
                    }
                  }
                } catch (err) {
                  alignmentResult = null;
                  console.warn('[Alignment] Failed:', getErrorMessage(err));
                }

                const claimOrder = new Map();
                for (let i = 0; i < enrichedClaims.length; i++) {
                  const id = enrichedClaims[i]?.id;
                  if (id) claimOrder.set(id, i);
                }

                const conflictClaimIdSet = new Set();
                const conflictAdj = new Map();
                for (const e of unifiedEdges) {
                  if (!e || e.type !== 'conflicts') continue;
                  const from = String(e.from || '').trim();
                  const to = String(e.to || '').trim();
                  if (!from || !to) continue;

                  conflictClaimIdSet.add(from);
                  conflictClaimIdSet.add(to);

                  if (!conflictAdj.has(from)) conflictAdj.set(from, new Set());
                  if (!conflictAdj.has(to)) conflictAdj.set(to, new Set());
                  conflictAdj.get(from).add(to);
                  conflictAdj.get(to).add(from);
                }

                const foundationClaimIds = [];
                for (const c of enrichedClaims) {
                  if (!conflictClaimIdSet.has(c.id)) foundationClaimIds.push(c.id);
                }

                const conflictComponents = [];
                const visited = new Set();
                for (const id of Array.from(conflictClaimIdSet)) {
                  if (visited.has(id)) continue;
                  const stack = [id];
                  const component = [];
                  visited.add(id);
                  while (stack.length > 0) {
                    const cur = stack.pop();
                    component.push(cur);
                    const neighbors = conflictAdj.get(cur);
                    if (!neighbors) continue;
                    for (const n of Array.from(neighbors)) {
                      if (visited.has(n)) continue;
                      visited.add(n);
                      stack.push(n);
                    }
                  }
                  component.sort((a, b) => (claimOrder.get(a) ?? 0) - (claimOrder.get(b) ?? 0));
                  conflictComponents.push(component);
                }

                conflictComponents.sort((a, b) => {
                  const amin = a.length > 0 ? (claimOrder.get(a[0]) ?? 0) : 0;
                  const bmin = b.length > 0 ? (claimOrder.get(b[0]) ?? 0) : 0;
                  return amin - bmin;
                });

                const tiers = [
                  { tierIndex: 0, claimIds: foundationClaimIds, gates: [] },
                  ...conflictComponents.map((claimIds, i) => ({ tierIndex: i + 1, claimIds, gates: [] })),
                ];

                const tierByClaimId = new Map();
                for (const t of tiers) {
                  const ids = Array.isArray(t?.claimIds) ? t.claimIds : [];
                  for (const id of ids) {
                    if (!tierByClaimId.has(id)) tierByClaimId.set(id, t.tierIndex);
                  }
                }

                const claimLabelById = new Map(
                  enrichedClaims.map((c) => [c.id, c.label]),
                );

                const enablesById = new Map();
                const conflictsById = new Map();

                for (const e of unifiedEdges) {
                  if (!e) continue;
                  const edgeType = String(e.type || '').trim();
                  if (edgeType === 'conflicts') {
                    const from = String(e.from || '').trim();
                    const to = String(e.to || '').trim();
                    if (!from || !to) continue;
                    if (!conflictsById.has(from)) conflictsById.set(from, []);
                    const fromLabel = claimLabelById.get(from) || from;
                    const toLabel = claimLabelById.get(to) || to;
                    // Use gate question if a forced_choice gate exists for this claim pair
                    const gateKey = [from, to].sort().join('::');
                    const gateQuestion = gateQuestionByClaimPair.get(gateKey) || '';
                    conflictsById.get(from).push({
                      claimId: to,
                      question: gateQuestion || String(e.question || '').trim() || `${fromLabel} vs ${toLabel}`,
                      sourceStatementIds: [],
                    });
                  }
                }

                const serializedClaims = enrichedClaims.map((c) => {
                  const id = String(c?.id || '').trim();
                  const supporters = Array.isArray(c?.supporters) ? c.supporters : [];
                  const sourceStatementIds = Array.isArray(c?.sourceStatementIds)
                    ? c.sourceStatementIds.map((s) => String(s)).filter(Boolean)
                    : [];

                  const tier = tierByClaimId.get(id) ?? 0;
                  const enables = enablesById.has(id) ? Array.from(enablesById.get(id)) : [];
                  const conflicts = conflictsById.has(id) ? conflictsById.get(id) : [];

                  return {
                    id,
                    label: String(c?.label || id),
                    stance: 'NEUTRAL',
                    gates: {
                      conditionals: [],
                    },
                    enables,
                    conflicts,
                    sourceStatementIds,
                    supporterModels: supporters,
                    supportRatio: typeof c?.supportRatio === 'number' ? c.supportRatio : 0,
                    hasConditionalSignal: Boolean(c?.hasConditionalSignal),
                    hasSequenceSignal: Boolean(c?.hasSequenceSignal),
                    hasTensionSignal: Boolean(c?.hasTensionSignal),
                    tier,
                  };
                });

                const conflictEdges = unifiedEdges.filter((e) => {
                  if (!e || !e.from || !e.to) return false;
                  const t = String(e.type || '').trim();
                  return t === 'conflicts';
                });

                const traversalEdges = conflictEdges.map((e) => ({
                  ...e,
                  type: 'conflicts',
                }));

                const traversalGraph = {
                  claims: serializedClaims,
                  edges: traversalEdges,
                  conditionals: unifiedConditionals,
                  tiers,
                  maxTier: tiers.length - 1,
                  roots: [],
                  tensions: [],
                  cycles: [],
                };

                const forcingPoints = extractForcingPoints(traversalGraph).map((fp) => {
                  const options = Array.isArray(fp?.options)
                    ? fp.options
                      .map((o) => ({
                        claimId: String(o?.claimId || '').trim(),
                        label: String(o?.label || '').trim(),
                      }))
                      .filter((o) => o.claimId && o.label)
                    : undefined;

                  return {
                    id: String(fp?.id || '').trim(),
                    type: fp?.type,
                    tier: typeof fp?.tier === 'number' ? fp.tier : 0,
                    question: String(fp?.question || '').trim(),
                    condition: String(fp?.condition || '').trim(),
                    ...(options ? { options } : {}),
                    unlocks: [],
                    prunes: [],
                    blockedBy: Array.isArray(fp?.blockedByGateIds)
                      ? fp.blockedByGateIds.map((g) => String(g)).filter(Boolean)
                      : [],
                    sourceStatementIds: Array.isArray(fp?.sourceStatementIds)
                      ? fp.sourceStatementIds.map((s) => String(s)).filter(Boolean)
                      : [],
                  };
                });

                try {
                  referencedIds = new Set(
                    enrichedClaims
                      .map((c) => (Array.isArray(c?.sourceStatementIds) ? c.sourceStatementIds : []))
                      .flat()
                  );
                  shadowDelta = computeShadowDelta(shadowResult, referencedIds, payload.originalPrompt);
                  topUnindexed = getTopUnreferenced(shadowDelta, 10);

                  const EDGE_SUPPORTS = 'supports';
                  const EDGE_CONFLICTS = 'conflicts';
                  const EDGE_PREREQUISITE = 'prerequisite';

                  const semanticEdges = unifiedEdges
                    .filter((e) => e && e.from && e.to)
                    .map((e) => {
                      const t = String(e.type || '').trim();
                      if (t === 'conflicts') return { ...e, type: EDGE_CONFLICTS };
                      if (t === 'prerequisites') return { ...e, type: EDGE_PREREQUISITE };
                      return e;
                    })
                    .filter((e) => {
                      const t = String(e.type || '').trim();
                      return t === EDGE_SUPPORTS || t === EDGE_CONFLICTS || t === 'tradeoff' || t === EDGE_PREREQUISITE;
                    });

                  const derivedSupportEdges = [];
                  const supportKey = new Set();

                  // TODO: Derive support relationships from claim provenance embeddings/geometry.
                  // - High similarity between claim source paragraphs + compatible stance => support.
                  // - Consider geometry/topology proximity as an additional signal.

                  const hasAnySupportEdges = semanticEdges.some((e) => String(e?.type || '') === EDGE_SUPPORTS);
                  if (!hasAnySupportEdges) {
                    for (const cond of unifiedConditionals) {
                      const affected = Array.isArray(cond?.affectedClaims) ? cond.affectedClaims : [];
                      for (let i = 0; i < affected.length; i++) {
                        const a = String(affected[i] || '').trim();
                        if (!a) continue;
                        for (let j = i + 1; j < affected.length; j++) {
                          const b = String(affected[j] || '').trim();
                          if (!b || a === b) continue;
                          const k1 = `${a}::${b}::supports`;
                          if (!supportKey.has(k1)) {
                            supportKey.add(k1);
                            derivedSupportEdges.push({ from: a, to: b, type: EDGE_SUPPORTS });
                          }
                          const k2 = `${b}::${a}::supports`;
                          if (!supportKey.has(k2)) {
                            supportKey.add(k2);
                            derivedSupportEdges.push({ from: b, to: a, type: EDGE_SUPPORTS });
                          }
                        }
                      }
                    }
                  }

                  const ghosts = null;
                  const traversalAnalysis = null;

                  mapperArtifact = {
                    id: `artifact-${Date.now()}`,
                    query: payload.originalPrompt,
                    turn: context.turn || 0,
                    timestamp: new Date().toISOString(),
                    model_count: citationOrder.length,

                    claims: enrichedClaims,
                    edges: [...semanticEdges, ...derivedSupportEdges],
                    ghosts,
                    narrative: String(parseResult.narrative || '').trim(),
                    conditionals: unifiedConditionals,

                    // NEW DATA (not in V1)
                    traversalGraph,
                    forcingPoints,
                    traversalAnalysis,
                    ...(rawGates.length > 0 ? { surveyGates: rawGates, surveyRationale } : { surveyRationale }),
                    preSemantic: preSemanticInterpretation || null,
                    ...(completeness ? { completeness } : {}),
                    ...(alignmentResult ? { alignment: alignmentResult } : {}),

                    // SHADOW DATA
                    shadow: {
                      statements: shadowResult.statements,
                      audit: shadowDelta.audit,
                      topUnreferenced: Array.isArray(topUnindexed)
                        ? topUnindexed.map((u) => u?.statement).filter(Boolean)
                        : []
                    },
                    ...(paragraphResult?.meta ? { paragraphProjection: paragraphResult.meta } : {}),
                    ...(paragraphClusteringSummary ? { paragraphClustering: paragraphClusteringSummary } : {}),
                    ...(substrateSummary ? { substrate: substrateSummary } : {}),
                  };

                  let diagnosticsResult = null;
                  try {
                    if (preSemanticInterpretation && mapperArtifact) {
                      const { computeStructuralAnalysis } = await import('../PromptMethods');
                      const { validateStructuralMapping } = await import('../../geometry/interpretation');
                      // Convert to cognitive shape for structural analysis
                      const tempCognitive = buildCognitiveArtifact(JSON.parse(JSON.stringify(mapperArtifact)), null);
                      const postSemantic = computeStructuralAnalysis(tempCognitive);
                      diagnosticsResult = validateStructuralMapping(
                        preSemanticInterpretation,
                        postSemantic,
                        substrate,
                        statementEmbeddingResult?.embeddings ?? null,
                        paragraphResult?.paragraphs ?? null
                      );
                    }
                  } catch (_) {
                    diagnosticsResult = null;
                  }

                  if (mapperArtifact) {
                    try {
                      const diagnostics = diagnosticsResult;
                      mapperArtifact.diagnostics = diagnostics;

                      const claimMeasurements = diagnostics?.measurements?.claimMeasurements;
                      if (Array.isArray(claimMeasurements)) {
                        const coherenceById = new Map(claimMeasurements.map(m => [m.claimId, m]));
                        for (const c of (mapperArtifact.claims ?? [])) {
                          const m = coherenceById.get(c?.id);
                          if (m && typeof m.sourceCoherence === 'number') {
                            c.sourceCoherence = m.sourceCoherence;
                          }
                        }
                      }
                    } catch (err) {
                      console.error('[StepExecutor] Diagnostics stamp failed', err);
                    }

                    // Claim Provenance (debug panel — first entries of Claim entity profile)
                    try {
                      const { computeStatementOwnership, computeClaimExclusivity, computeClaimOverlap } = await import('../../ConciergeService/claimProvenance');
                      const ownership = computeStatementOwnership(enrichedClaims);
                      const exclusivity = computeClaimExclusivity(enrichedClaims, ownership);
                      const overlap = computeClaimOverlap(enrichedClaims);
                      mapperArtifact.claimProvenance = {
                        statementOwnership: Object.fromEntries(
                          Array.from(ownership.entries()).map(([k, v]) => [k, Array.from(v)])
                        ),
                        claimExclusivity: Object.fromEntries(exclusivity),
                        claimOverlap: overlap,
                      };
                    } catch (err) {
                      console.warn('[StepExecutor] Claim provenance failed:', err);
                    }
                  }

                  console.log(`[StepExecutor] Generated mapper artifact with ${enrichedClaims.length} claims, ${semanticEdges.length} edges`);
                } catch (err) {
                  // processLogger.error or console.error with context
                  console.error('[StepExecutor] Mapper artifact build failed:', err);
                  console.debug('Context:', {
                    originalPrompt: payload.originalPrompt,
                    turn: context.turn,
                    citationCount: citationOrder.length,
                    error: getErrorMessage(err)
                  });
                  throw err; // Rethrow to handle consistently upstream
                }


                // mapperArtifact was built from V2->V1 adapter above (v1Artifact) and has
                // been augmented with traversalGraph, forcingPoints and shadow data.
                // Remove legacy fallback that referenced undefined `legacyClaims`/`legacyEdges`.

              } else {
                console.warn("[StepExecutor] Semantic Mapper parsing failed:", parseResult.errors);
                // Fallback? Or just fail? For now, we proceed with raw text but no artifact.
              }

              // Process raw text for clean display
              const processed = artifactProcessor.process(finalResult.text);
              finalResult.text = processed.cleanText;
              finalResult.artifacts = processed.artifacts;

              streamingManager.dispatchPartialDelta(
                context.sessionId,
                step.stepId,
                payload.mappingProvider,
                finalResult.text,
                "Mapping",
                true,
              );
            }

            if (!finalResult || !finalResult.text) {
              if (providerError) {
                reject(providerError);
              } else {
                reject(
                  new Error(
                    `Mapping provider ${payload.mappingProvider} returned empty response`,
                  ),
                );
              }
              return;
            }

            const citationSourceOrder = {};
            citationOrder.forEach((pid, idx) => {
              citationSourceOrder[idx + 1] = pid;
            });

            const finalResultWithMeta = {
              ...finalResult,
              meta: {
                citationSourceOrder,
                rawMappingText: rawText,
                semanticMapperPrompt: mappingPrompt,
              },
            };

            const cognitiveArtifact = buildCognitiveArtifact(mapperArtifact, {
              shadow: {
                extraction: shadowResult || null,
                delta: shadowDelta || null,
              },
              paragraphProjection: paragraphResult || null,
              substrate: {
                graph: substrateGraph,
                shape: substrate?.shape,
              },
              preSemantic: preSemanticInterpretation || null,
              ...(queryRelevance ? { query: { relevance: queryRelevance } } : {}),
            });

            try {
              if (finalResultWithMeta?.meta) {
                workflowContexts[payload.mappingProvider] =
                  finalResultWithMeta.meta;
              }
            } catch (_) { }

            resolve({
              providerId: payload.mappingProvider,
              text: finalResultWithMeta.text,
              status: "completed",
              meta: finalResultWithMeta.meta || {},
              artifacts: finalResult.artifacts || [],
              ...(cognitiveArtifact ? { mapping: { artifact: cognitiveArtifact } } : {}),
              ...(finalResult.softError ? { softError: finalResult.softError } : {}),
            });
          },
        },
      );
    });
  }
  async _resolveSourceData(payload, context, previousResults, options) {
    const { sessionManager } = options;
    if (Array.isArray(payload?.sourceData) && payload.sourceData.length > 0) {
      return payload.sourceData
        .map((s) => {
          const providerId = String(s?.providerId || '').trim();
          const text = String(s?.text ?? s?.content ?? '').trim();
          return { providerId, text };
        })
        .filter((s) => s.providerId && s.text);
    }
    if (payload.sourceHistorical) {
      // Historical source
      const { turnId, responseType } = payload.sourceHistorical;
      console.log(
        `[StepExecutor] Resolving historical data from turn: ${turnId} `,
      );

      // Prefer adapter lookup
      let aiTurn = null;
      try {
        const adapter = sessionManager?.adapter;
        if (adapter?.isReady && adapter.isReady()) {
          const turn = await adapter.get("turns", turnId);
          if (turn && (turn.type === "ai" || turn.role === "assistant")) {
            aiTurn = turn;
          } else if (turn && turn.type === "user") {
            try {
              const sessionTurns = await adapter.getTurnsBySessionId(context.sessionId);
              if (Array.isArray(sessionTurns)) {
                const userIdx = sessionTurns.findIndex(t => t.id === turnId);
                if (userIdx !== -1) {
                  const next = sessionTurns[userIdx + 1];
                  if (next && (next.type === "ai" || next.role === "assistant")) {
                    aiTurn = next;
                  }
                }
              }
            } catch (ignored) { }
          }
        }
      } catch (e) {
        console.warn("[StepExecutor] resolveSourceData adapter lookup failed:", e);
      }

      if (!aiTurn) {
        // Try text matching fallback if ID lookup failed (via adapter)
        const fallbackText = context?.userMessage || "";
        if (fallbackText && fallbackText.trim().length > 0 && sessionManager?.adapter?.isReady && sessionManager.adapter.isReady()) {
          try {
            const sessionTurns = await sessionManager.adapter.getTurnsBySessionId(context.sessionId);
            if (Array.isArray(sessionTurns)) {
              for (let i = 0; i < sessionTurns.length; i++) {
                const t = sessionTurns[i];
                if (t && t.type === "user" && String(t.text || "") === String(fallbackText)) {
                  const next = sessionTurns[i + 1];
                  if (next && next.type === "ai") {
                    aiTurn = next;
                    break;
                  }
                }
              }
            }
          } catch (e) {
            console.warn(`[StepExecutor] Could not find corresponding AI turn for ${turnId} (text fallback failed):`, e);
            aiTurn = null;
          }
        }

        if (!aiTurn) {
          console.warn(`[StepExecutor] Could not resolve AI turn for source ${turnId}`);
          return [];
        }
      }

      let sourceContainer;
      switch (responseType) {
        case "mapping": sourceContainer = aiTurn.mappingResponses || {}; break;
        default: sourceContainer = aiTurn.batchResponses || {}; break;
      }

      const latestMap = new Map();
      Object.keys(sourceContainer).forEach(pid => {
        const versions = (sourceContainer[pid] || [])
          .filter(r => r.status === "completed" && r.text?.trim())
          .sort((a, b) => (b.responseIndex || 0) - (a.responseIndex || 0));

        if (versions.length > 0) {
          latestMap.set(pid, {
            providerId: pid,
            text: versions[0].text
          });
        }
      });

      let sourceArray = Array.from(latestMap.values());

      // If embedded responses were not present, attempt provider_responses fallback (prefer indexed lookup)
      if (
        sourceArray.length === 0 &&
        sessionManager?.adapter?.isReady &&
        sessionManager.adapter.isReady()
      ) {
        try {
          const responses = await sessionManager.adapter.getResponsesByTurnId(
            aiTurn.id,
          );

          const respType = responseType || "batch";
          const dbLatestMap = new Map();

          (responses || [])
            .filter(r => r?.responseType === respType && r.text?.trim())
            .forEach(r => {
              const existing = dbLatestMap.get(r.providerId);
              if (!existing || (r.responseIndex || 0) >= (existing.responseIndex || 0)) {
                dbLatestMap.set(r.providerId, r);
              }
            });

          sourceArray = Array.from(dbLatestMap.values()).map(r => ({
            providerId: r.providerId,
            text: r.text
          }));
          if (sourceArray.length > 0) {
            console.log(
              "[StepExecutor] provider_responses fallback succeeded for historical sources",
            );
          }
        } catch (e) {
          console.warn(
            "[StepExecutor] provider_responses fallback failed for historical sources:",
            e,
          );
        }
      }

      console.log(
        `[StepExecutor] Found ${sourceArray.length} historical sources`,
      );
      return sourceArray;

    } else if (payload.sourceStepIds) {
      const sourceArray = [];
      for (const stepId of payload.sourceStepIds) {
        const stepResult = previousResults.get(stepId);
        if (!stepResult || stepResult.status !== "completed") continue;
        const { results } = stepResult.result;
        Object.entries(results).forEach(([providerId, result]) => {
          if (result.status === "completed" && result.text && result.text.trim().length > 0) {
            sourceArray.push({
              providerId: providerId,
              text: result.text,
            });
          }
        });
      }
      return sourceArray;
    }
    throw new Error("No valid source specified for step.");
  }

  async _executeGenericSingleStep(step, context, providerId, prompt, stepType, options, parseOutputFn) {
    const { streamingManager, persistenceCoordinator, sessionManager } = options;
    const { payload } = step;

    console.log(`[StepExecutor] ${stepType} prompt for ${providerId}: ${prompt.length} chars`);

    // 1. Check Limits
    const limits = PROVIDER_LIMITS[providerId];
    if (limits && prompt.length > limits.maxInputChars) {
      console.warn(`[StepExecutor] ${stepType} prompt length ${prompt.length} exceeds limit ${limits.maxInputChars} for ${providerId}`);
      throw new Error(`INPUT_TOO_LONG: Prompt length ${prompt.length} exceeds limit ${limits.maxInputChars} for ${providerId}`);
    }

    const resolveProviderContextsForPid = async (pid) => {
      const role = options.contextRole;
      const effectivePid = role ? `${pid}:${role}` : pid;
      const explicit = payload?.providerContexts;

      // If we have an explicit context for the scoped ID, use it
      if (explicit && typeof explicit === "object" && explicit[effectivePid]) {
        const entry = explicit[effectivePid];
        const meta = (entry && typeof entry === "object" && "meta" in entry) ? entry.meta : entry;
        const continueThread = (entry && typeof entry === "object" && "continueThread" in entry) ? entry.continueThread : true;
        return { [pid]: { meta, continueThread } };
      }

      // Fallback: check for the raw pid (legacy or default)
      if (explicit && typeof explicit === "object" && explicit[pid]) {
        const entry = explicit[pid];
        const meta = (entry && typeof entry === "object" && "meta" in entry) ? entry.meta : entry;
        const continueThread = (entry && typeof entry === "object" && "continueThread" in entry) ? entry.continueThread : true;
        return { [pid]: { meta, continueThread } };
      }

      try {
        if (!sessionManager?.getProviderContexts) return undefined;
        // isolation: pass contextRole (e.g. "batch") to get only the scoped thread from DB
        const ctxs = await sessionManager.getProviderContexts(context.sessionId, DEFAULT_THREAD, { contextRole: options.contextRole });
        const meta = ctxs?.[pid]?.meta;
        if (meta && typeof meta === "object" && Object.keys(meta).length > 0) {
          return { [pid]: { meta, continueThread: true } };
        }
      } catch (_) { }

      return undefined;
    };

    const runRequest = async (pid) => {
      const providerContexts = await resolveProviderContextsForPid(pid);

      return new Promise((resolve, reject) => {
        this.orchestrator.executeParallelFanout(
          prompt,
          [pid],
          {
            sessionId: context.sessionId,
            useThinking: options.useThinking || payload.useThinking || false,
            providerContexts,
            onPartial: (id, chunk) => {
              streamingManager.dispatchPartialDelta(
                context.sessionId,
                step.stepId,
                id,
                chunk.text,
                stepType
              );
            },
            onAllComplete: (results, errors) => {
              let finalResult = results.get(pid);
              const providerError = errors?.get?.(pid);

              // 2. Partial Recovery
              if ((!finalResult || !finalResult.text) && providerError) {
                const recovered = streamingManager.getRecoveredText(
                  context.sessionId, step.stepId, pid
                );
                if (recovered && recovered.trim().length > 0) {
                  finalResult = finalResult || { providerId: pid, meta: {} };
                  finalResult.text = recovered;
                  finalResult.softError = finalResult.softError || {
                    message: providerError?.message || String(providerError),
                  };
                } else {
                  reject(providerError);
                  return;
                }
              }

              if (finalResult?.text) {
                // 3. Parse Output
                let outputData = null;
                try {
                  outputData = parseOutputFn(finalResult.text);
                  if (outputData && typeof outputData === "object") {
                    outputData.providerId = pid;
                    if (outputData.pipeline && typeof outputData.pipeline === "object") {
                      outputData.pipeline.providerId = pid;
                    }
                  }
                } catch (parseErr) {
                  console.warn(`[StepExecutor] Output parsing failed for ${stepType}:`, parseErr);
                  // We continue with raw text if parsing fails, but mark it? 
                  // For now, allow specific parsers to handle robustness or throw.
                }

                // Prefer cleaned text from outputData if available
                const canonicalText = (outputData && typeof outputData === "object" && (outputData.text || outputData.cleanedText)) || finalResult.text;

                streamingManager.dispatchPartialDelta(
                  context.sessionId,
                  step.stepId,
                  pid,
                  canonicalText,
                  stepType,
                  true
                );

                // 4. Persist Context
                persistenceCoordinator.persistProviderContextsAsync(context.sessionId, {
                  [pid]: finalResult,
                }, options.contextRole);

                resolve({
                  providerId: pid,
                  text: finalResult.text,
                  status: "completed",
                  meta: {
                    ...finalResult.meta,
                    ...(outputData ? { [`${stepType.toLowerCase()}Output`]: outputData } : {})
                  },
                  output: outputData, // Standardize output access
                  ...(finalResult.softError ? { softError: finalResult.softError } : {}),
                });
              } else {
                reject(new Error(`Empty response from ${stepType} provider`));
              }
            }
          }
        );
      });
    };

    // 5. Auth Fallback Wrapper
    try {
      return await runRequest(providerId);
    } catch (error) {
      if (isProviderAuthError(error)) {
        console.warn(`[StepExecutor] ${stepType} failed with auth error for ${providerId}, attempting fallback...`);
        const fallbackStrategy = errorHandler.fallbackStrategies.get('PROVIDER_AUTH_FAILED');
        if (fallbackStrategy) {
          try {
            const fallbackProvider = await fallbackStrategy(
              stepType.toLowerCase(),
              { failedProviderId: providerId }
            );
            if (fallbackProvider) {
              console.log(`[StepExecutor] Executing ${stepType} with fallback provider: ${fallbackProvider}`);
              return await runRequest(fallbackProvider);
            }
          } catch (fallbackError) {
            console.warn(`[StepExecutor] Fallback failed: `, fallbackError);
          }
        }
      }
      throw error;
    }
  }

  // Deprecated persona steps (Refiner, Antagonist, Understand, Gauntlet) have been removed.
  // Consolidated into executeSingularityStep.

  async executeSingularityStep(step, context, _previousResults, options) {
    const payload = step.payload;

    // Resolve the cognitive artifact from payload
    let mappingArtifact = payload.mappingArtifact || null;

    // Fallback: parse from raw mapping text and convert to cognitive shape
    if (!mappingArtifact && payload.mappingText) {
      const parsed = parseMapperArtifact(payload.mappingText);
      if (parsed) {
        mappingArtifact = buildCognitiveArtifact(parsed, null);
      }
    }

    if (!mappingArtifact) {
      throw new Error("Singularity mode requires a mapping artifact.");
    }

    let ConciergeService;
    try {
      const module = await import('../../ConciergeService/ConciergeService');
      ConciergeService = module.ConciergeService;
    } catch (e) {
      console.warn("[StepExecutor] Failed to import ConciergeService:", e);
      ConciergeService = null;
    }

    let singularityPrompt;

    if (!ConciergeService) {
      throw new Error("ConciergeService is not available. Cannot execute Singularity step.");
    }

    // ══════════════════════════════════════════════════════════════════
    // FEATURE 3: Rebuild historical prompts for recompute (Efficient Storage)
    // ══════════════════════════════════════════════════════════════════

    const promptSeed = options?.frozenSingularityPromptSeed || payload.conciergePromptSeed;
    let evidenceSubstrate = null;
    try {
      const substrate = payload?.chewedSubstrate;
      if (substrate && typeof substrate === "object") {
        try {
          if (typeof formatSubstrateForPrompt === 'function') {
            const formatted = String(formatSubstrateForPrompt(substrate) || '').trim();
            if (formatted) evidenceSubstrate = formatted;
          }
        } catch (_) { }

        if (!evidenceSubstrate) {
          const outputs = substrate && typeof substrate === "object" ? substrate.outputs : null;
          if (Array.isArray(outputs) && outputs.length > 0) {
            const parts = [];
            for (const out of outputs) {
              const text = out && typeof out === "object" ? String(out.text || "") : "";
              if (!text.trim()) continue;
              parts.push(text.trim());
            }
            evidenceSubstrate = parts.length > 0 ? parts.join("\n\n") : null;
          }
        }
      }
    } catch (_) {
      evidenceSubstrate = null;
    }


    if (evidenceSubstrate && ConciergeService.buildConciergePrompt) {
      // When chewed substrate is available, always rebuild the prompt so the
      // evidence section is injected.  This covers both traversal-continuation
      // and recompute flows where a frozen/pre-built prompt would otherwise
      // skip the substrate.
      const userMessage = payload.originalPrompt;
      const opts = promptSeed && typeof promptSeed === "object" ? { ...promptSeed } : {};
      opts.evidenceSubstrate = evidenceSubstrate;
      singularityPrompt = ConciergeService.buildConciergePrompt(userMessage, opts);
    } else if (options?.frozenSingularityPrompt) {
      singularityPrompt = options.frozenSingularityPrompt;
    } else if (payload.conciergePrompt && typeof payload.conciergePrompt === "string") {
      singularityPrompt = payload.conciergePrompt;
    } else if (ConciergeService.buildConciergePrompt) {
      const userMessage = payload.originalPrompt;
      const opts = promptSeed && typeof promptSeed === "object" ? { ...promptSeed } : {};
      singularityPrompt = ConciergeService.buildConciergePrompt(userMessage, opts);
    }

    if (!singularityPrompt) {
      throw new Error("Could not determine or build Singularity prompt.");
    }

    const parseSingularityOutput = (text) => {
      const rawText = String(text || "");

      let cleanedText = rawText;
      let signal = null;

      try {
        if (ConciergeService && typeof ConciergeService.parseConciergeOutput === "function") {
          const parsed = ConciergeService.parseConciergeOutput(rawText);
          if (parsed) {
            cleanedText = parsed.userResponse || cleanedText;
            signal = parsed.signal || null;
          }
        }
      } catch (_) { }

      let leakageDetected = false;
      let leakageViolations = [];

      if (ConciergeService && ConciergeService.detectMachineryLeakage) {
        const leakCheck = ConciergeService.detectMachineryLeakage(cleanedText);
        leakageDetected = !!leakCheck.leaked;
        leakageViolations = leakCheck.violations || [];
        if (leakCheck.leaked) {
          console.warn("[StepExecutor] Singularity response leaked machinery:", leakCheck.violations);
        }
      }

      const pipeline = {
        userMessage: payload.originalPrompt,
        prompt: singularityPrompt,
        leakageDetected,
        leakageViolations,
        traversal: payload?.traversalMetrics || null,
        chewedSubstrateSummary: payload?.chewedSubstrate?.summary || null,
        parsed: {
          signal,
          rawText,
        },
      };

      return {
        text: cleanedText,
        providerId: payload.singularityProvider,
        timestamp: Date.now(),
        leakageDetected,
        leakageViolations,
        pipeline,
        parsed: {
          signal,
          rawText,
        },
      };
    };

    // Store on context so callers (turnemitter, handleContinueRequest) can
    // surface the actual concierge prompt in the UI / debug panel.
    if (context && typeof context === "object") {
      context.singularityPromptUsed = singularityPrompt;
    }

    return this._executeGenericSingleStep(
      step, context, payload.singularityProvider, singularityPrompt, "Singularity", { ...options, contextRole: "singularity" },
      parseSingularityOutput
    );
  }

}

import { DEFAULT_THREAD } from '../../../shared/messaging.js';
import { ArtifactProcessor } from '../../../shared/artifact-processor';
import { PROVIDER_LIMITS } from '../../../shared/provider-limits';
import { parseSemanticMapperOutput, createEmptyMapperArtifact } from '../../../shared/parsing-utils';
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
import { DEFAULT_CONFIG } from '../../clustering';
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
    const { streamingManager, sessionManager } = options;
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
    // 2.6 GEOMETRY (async, may fail gracefully)
    // ════════════════════════════════════════════════════════════════════════
    let embeddingResult = null;
    let statementEmbeddingResult = null;
    let geometryParagraphEmbeddings = null;
    let paragraphDensityScores = null;  // Map<paragraphId, number> — hoisted from paragraph embedding IIFE
    let queryDensityScore = null;       // number — hoisted from query density projection
    let queryEmbedding = null;
    let queryRelevance = null;
    let substrateSummary = null;
    let substrateGraph = null;
    let substrateDegenerate = null;
    let substrateDegenerateReason = null;
    let preSemanticInterpretation = null;
    let substrate = null;
    let enrichmentResult = null;
    let basinInversionResult = null;
    let clusteringModule = null;
    const geometryPromise = (async () => {
      const startedAtMs = nowMs();
      try {
        if (paragraphResult.paragraphs.length === 0) {
          geometryDiagnostics.stages.embeddingsSkipped = {
            startedAtMs,
            timeMs: 0,
            reason: 'no_paragraphs',
          };
          return;
        }

        const ensureOffscreenReady = async () => {
          if (typeof chrome === 'undefined' || !chrome?.runtime?.getContexts || !chrome?.offscreen) return;
          const existingContexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
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

        clusteringModule = await import('../../clustering');
        const {
          generateEmbeddings,
          generateTextEmbeddings,
          generateStatementEmbeddings,
          projectSemanticDensity,
          stripInlineMarkdown,
          structuredTruncate,
          getEmbeddingStatus,
        } = clusteringModule;
        const { buildGeometricSubstrate, isDegenerate } = await import('../../geometry');
        const { buildPreSemanticInterpretation } = await import('../../geometry/interpretation');

        /** @type {"none" | "webgpu" | "wasm"} */
        let embeddingBackend = 'none';
        try {
          const status = await getEmbeddingStatus();
          if (status?.backend === 'webgpu' || status?.backend === 'wasm') {
            embeddingBackend = status.backend;
          }
        } catch (_) { }

        const rawQuery =
          (payload && typeof payload.originalPrompt === 'string' && payload.originalPrompt) ||
          (context && typeof context.userMessage === 'string' && context.userMessage) ||
          '';
        const cleanedQuery = stripInlineMarkdown(String(rawQuery || '')).trim();
        const truncatedQuery = structuredTruncate(cleanedQuery, 1740);
        const queryTextForEmbedding =
          truncatedQuery && !truncatedQuery.toLowerCase().startsWith('represent this sentence for searching relevant passages:')
            ? `Represent this sentence for searching relevant passages: ${truncatedQuery}`
            : truncatedQuery;

        let queryRawMagnitude = null;
        let queryTextLength = null;
        const queryEmbeddingPromise = (async () => {
          try {
            await offscreenReadyPromise;
            console.log(`[StepExecutor] Query embedding: queryText length=${queryTextForEmbedding.length}, model=${DEFAULT_CONFIG?.modelId || 'unknown'}`);
            const queryEmbeddingBatch = await generateTextEmbeddings([queryTextForEmbedding], DEFAULT_CONFIG, { captureRawMagnitudes: true });
            queryEmbedding = queryEmbeddingBatch.embeddings.get('0') || null;
            queryRawMagnitude = queryEmbeddingBatch.rawMagnitudes?.get('0') ?? null;
            queryTextLength = queryEmbeddingBatch.textLengths?.get('0') ?? null;
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
            console.warn(`[StepExecutor] Query embedding failed:`, getErrorMessage(err));
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
            embeddingResult = paragraphEmbeddingResult;
            geometryParagraphEmbeddings = paragraphEmbeddingResult.embeddings;
            paragraphDensityScores = paragraphEmbeddingResult?.semanticDensityScores ?? null;
            const paraDensity = paragraphDensityScores;
            let paragraphSemanticDensity = null;
            if (paraDensity && paraDensity.size > 0) {
              const entries = Array.from(paraDensity.entries());
              const values = entries.map(([, v]) => v);
              const mean = values.reduce((a, b) => a + b, 0) / values.length;
              const sorted = entries.slice().sort((a, b) => b[1] - a[1]);
              paragraphSemanticDensity = {
                count: paraDensity.size,
                mean,
                topDense: sorted.slice(0, 3).map(([id, score]) => ({ id, score })),
                topHollow: sorted.slice(-3).reverse().map(([id, score]) => ({ id, score })),
              };
            }
            geometryDiagnostics.stages.paragraphEmbeddings = {
              status: 'ok',
              paragraphs: paragraphResult.paragraphs.length,
              paragraphEmbeddings: paragraphEmbeddingResult.embeddings.size,
              semanticDensity: paragraphSemanticDensity,
            };
          } catch (err) {
            embeddingResult = null;
            geometryParagraphEmbeddings = null;
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
            statementEmbeddingResult = null;
            return;
          }
          try {
            await offscreenReadyPromise;
            statementEmbeddingResult = await generateStatementEmbeddings(
              shadowResult.statements,
              DEFAULT_CONFIG
            );
            const densityScores = statementEmbeddingResult?.semanticDensityScores;
            let semanticDensity = null;
            if (densityScores && densityScores.size > 0) {
              const densityEntries = Array.from(densityScores.entries());
              const densityValues = densityEntries.map(([, v]) => v);
              const densityMean = densityValues.reduce((a, b) => a + b, 0) / densityValues.length;
              const sorted = densityEntries.slice().sort((a, b) => b[1] - a[1]);
              semanticDensity = {
                count: densityScores.size,
                mean: densityMean,
                topDense: sorted.slice(0, 3).map(([id, score]) => ({ id, score })),
                topHollow: sorted.slice(-3).reverse().map(([id, score]) => ({ id, score })),
              };
            }
            geometryDiagnostics.stages.statementEmbeddings = {
              status: 'ok',
              statements: shadowResult.statements.length,
              embedded: typeof statementEmbeddingResult?.statementCount === 'number' ? statementEmbeddingResult.statementCount : null,
              semanticDensity,
            };
            if (semanticDensity) {
              console.log('[StepExecutor] Semantic density:', JSON.stringify(semanticDensity));
            }
          } catch (embeddingError) {
            console.warn('[StepExecutor] Statement embedding generation failed, continuing without embeddings:', getErrorMessage(embeddingError));
            geometryDiagnostics.embeddingBackendFailure = true;
            geometryDiagnostics.stages.statementEmbeddings = {
              status: 'failed',
              error: getErrorMessage(embeddingError),
            };
            statementEmbeddingResult = null;
          }
        })();

        await queryEmbeddingPromise;
        await paragraphEmbeddingPromise;
        await statementEmbeddingPromise;

        // ── Cell-unit embeddings (table sidecar) ──────────────────────────
        let cellUnitEmbeddings = null; // Map<string, Float32Array> | null
        if (shadowResult.tableSidecar?.length > 0 && generateTextEmbeddings) {
          try {
            const { flattenCellUnits } = await import('../tableCellAllocation');
            const cellUnits = flattenCellUnits(shadowResult.tableSidecar);
            if (cellUnits.length > 0) {
              const cellTexts = cellUnits.map(cu => stripInlineMarkdown(cu.text));
              const cellIds = cellUnits.map(cu => cu.id);
              const cellBatch = await generateTextEmbeddings(cellTexts, DEFAULT_CONFIG);
              cellUnitEmbeddings = new Map();
              for (let ci = 0; ci < cellIds.length; ci++) {
                const emb = cellBatch.embeddings.get(String(ci));
                if (emb) cellUnitEmbeddings.set(cellIds[ci], emb);
              }
              console.log(`[StepExecutor] Embedded ${cellUnitEmbeddings.size} table cell-units`);
              geometryDiagnostics.stages.cellUnitEmbeddings = {
                status: 'ok',
                cellUnits: cellUnits.length,
                embedded: cellUnitEmbeddings.size,
              };
            }
          } catch (cellEmbErr) {
            console.warn('[StepExecutor] Cell-unit embedding failed:', getErrorMessage(cellEmbErr));
            geometryDiagnostics.stages.cellUnitEmbeddings = {
              status: 'failed',
              error: getErrorMessage(cellEmbErr),
            };
          }
        }

        // Post-await: project query density using statement regression model
        if (queryRawMagnitude != null && queryTextLength != null
            && statementEmbeddingResult?.densityRegressionModel) {
          const score = projectSemanticDensity(
            queryRawMagnitude,
            queryTextLength,
            statementEmbeddingResult.densityRegressionModel
          );
          queryDensityScore = score;
          const querySemanticDensity = { score, projectedFrom: 'statement-regression' };
          if (geometryDiagnostics.stages.queryEmbedding) {
            geometryDiagnostics.stages.queryEmbedding.semanticDensity = querySemanticDensity;
          }
        }

        const firstParagraphEmbedding = geometryParagraphEmbeddings?.values?.().next?.().value;
        if (queryEmbedding && firstParagraphEmbedding && firstParagraphEmbedding.length !== queryEmbedding.length) {
          throw new Error(
            `[StepExecutor] Query/paragraph embedding dimension mismatch: query=${queryEmbedding.length}, paragraph=${firstParagraphEmbedding.length}`
          );
        }

        if (!geometryParagraphEmbeddings || geometryParagraphEmbeddings.size === 0) {
          console.log(`[StepExecutor] Skipping embeddings/geometry (paragraph_embeddings_unavailable)`);
          geometryDiagnostics.stages.embeddingsSkipped = {
            startedAtMs,
            timeMs: 0,
            reason: 'paragraph_embeddings_unavailable',
          };
          return;
        }

        // ─────────────────────────────────────────────────────────────────────────
        // 2.7 Basin Inversion (Topographic Analysis)
        // ─────────────────────────────────────────────────────────────────────────
        try {
          const { computeBasinInversion } = await import('../../../shared/geometry/basinInversion');
          const paraIds = Array.from(geometryParagraphEmbeddings.keys());
          const paraVectors = paraIds.map(id => geometryParagraphEmbeddings.get(id));
          basinInversionResult = computeBasinInversion(paraIds, paraVectors);
          console.log(`[StepExecutor] Basin inversion complete: ${basinInversionResult.basinCount} basins found at Tv=${basinInversionResult.T_v?.toFixed(3) || 'null'}`);
        } catch (err) {
          console.warn(`[StepExecutor] Basin inversion failed:`, getErrorMessage(err));
        }

        substrate = buildGeometricSubstrate(
          paragraphResult.paragraphs,
          geometryParagraphEmbeddings,
          embeddingBackend,
          undefined, // config
          basinInversionResult // NEW: Pass topography to substrate
        );
        geometryDiagnostics.stages.substrate = {
          status: 'ok',
          embeddingBackend,
        };

        try {
          const { isDegenerate } = await import('../../geometry');
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
              confidence: typeof substrate?.shape?.confidence === 'number' ? substrate.shape.confidence : 0,
              signals: {
                fragmentationScore: typeof substrate?.shape?.signals?.fragmentationScore === 'number' ? substrate.shape.signals.fragmentationScore : 0,
                bimodalityScore: typeof substrate?.shape?.signals?.bimodalityScore === 'number' ? substrate.shape.signals.bimodalityScore : 0,
                parallelScore: typeof substrate?.shape?.signals?.parallelScore === 'number' ? substrate.shape.signals.parallelScore : 0,
                convergentScore: typeof substrate?.shape?.signals?.convergentScore === 'number' ? substrate.shape.signals.convergentScore : 0,
              },
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
            `[StepExecutor] Substrate shape confidence: ${substrate.shape.confidence.toFixed(2)} ` +
            `(frag=${substrate.shape.signals.fragmentationScore.toFixed(2)}, ` +
            `bim=${substrate.shape.signals.bimodalityScore.toFixed(2)}, ` +
            `par=${substrate.shape.signals.parallelScore.toFixed(2)}, ` +
            `conv=${substrate.shape.signals.convergentScore.toFixed(2)})`
          );
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
              geometryParagraphEmbeddings,
              perModelQueryRelevance,
              basinInversionResult
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
            const qrCount = queryRelevance?.statementScores?.size ?? 0;
            console.log(`[StepExecutor] Query relevance computed: ${qrCount} statements scored`);
            geometryDiagnostics.stages.queryRelevance = {
              status: queryRelevance ? 'ok' : 'failed',
              statementCount: qrCount,
              ...(queryRelevance?.meta ? { meta: queryRelevance.meta } : {}),
            };
          } else {
            queryRelevance = null;
            const skipReason = !queryEmbedding ? 'queryEmbedding=null' : !substrate ? 'substrate=null' : 'substrateDegenerate=true';
            console.warn(`[StepExecutor] Query relevance SKIPPED: ${skipReason}`);
            geometryDiagnostics.stages.queryRelevance = {
              status: 'skipped',
              reason: skipReason,
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
          if (!substrateDegenerate && geometryParagraphEmbeddings && paragraphResult?.paragraphs?.length > 0) {
            const { computeBasinInversion } = await import('../../../shared/geometry/basinInversion');
            const aligned = paragraphResult.paragraphs
              .map(p => {
                const id = p.id || p.paragraphId || String(p.index ?? '');
                const vec = geometryParagraphEmbeddings.get(id);
                return vec ? { id, vec } : null;
              })
              .filter(Boolean);
            if (aligned.length > 0) {
              const paraIds = aligned.map(a => a.id);
              const paraVectors = aligned.map(a => a.vec);
              basinInversionResult = computeBasinInversion(paraIds, paraVectors);
            }
          }
        } catch (err) {
          console.warn('[StepExecutor] Basin inversion failed:', getErrorMessage(err));
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
              similarityStats: substrate.meta?.similarityStats || null,
              extendedSimilarityStats: substrate.meta?.extendedSimilarityStats || null,
              allPairwiseSimilarities: (() => {
                const sims = substrate.meta?.allPairwiseSimilarities;
                if (!Array.isArray(sims)) return null;
                const cap = 20000;
                if (sims.length <= cap) return sims;
                const step = Math.ceil(sims.length / cap);
                const sampled = [];
                for (let i = 0; i < sims.length && sampled.length < cap; i += step) {
                  sampled.push(sims[i]);
                }
                return sampled;
              })(),
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

        try {
          if (options.sessionManager && context.canonicalAiTurnId) {
            const { packEmbeddingMap } = await import('../../persistence/embeddingCodec');
            const stmtDim = statementEmbeddingResult?.embeddings?.values?.().next?.().value?.length;
            const paraDim = geometryParagraphEmbeddings?.values?.().next?.().value?.length;
            const queryDim = queryEmbedding?.length;
            const dims = Number.isFinite(queryDim) && queryDim > 0
              ? queryDim
              : Number.isFinite(paraDim) && paraDim > 0
                ? paraDim
                : Number.isFinite(stmtDim) && stmtDim > 0
                  ? stmtDim
                  : DEFAULT_CONFIG.embeddingDimensions;

            const packedStatements = statementEmbeddingResult?.embeddings
              ? packEmbeddingMap(statementEmbeddingResult.embeddings, dims)
              : null;
            const packedParagraphs = geometryParagraphEmbeddings
              ? packEmbeddingMap(geometryParagraphEmbeddings, dims)
              : null;
            const queryBuffer = queryEmbedding
              ? queryEmbedding.buffer.slice(queryEmbedding.byteOffset, queryEmbedding.byteOffset + queryEmbedding.byteLength)
              : null;

            if (packedStatements || packedParagraphs || queryBuffer) {
              const densityMap = statementEmbeddingResult?.semanticDensityScores;
              const densityObj = densityMap && densityMap.size > 0
                ? Object.fromEntries(densityMap)
                : null;
              const paraDensityObj = paragraphDensityScores && paragraphDensityScores.size > 0
                ? Object.fromEntries(paragraphDensityScores)
                : null;
              options.sessionManager.persistEmbeddings(context.canonicalAiTurnId, {
                ...(packedStatements ? { statementEmbeddings: packedStatements.buffer } : {}),
                ...(packedParagraphs ? { paragraphEmbeddings: packedParagraphs.buffer } : {}),
                ...(queryBuffer ? { queryEmbedding: queryBuffer } : {}),
                meta: {
                  embeddingModelId: DEFAULT_CONFIG.modelId,
                  dimensions: dims,
                  hasStatements: Boolean(packedStatements),
                  hasParagraphs: Boolean(packedParagraphs),
                  hasQuery: Boolean(queryBuffer),
                  ...(packedStatements ? { statementCount: packedStatements.index.length, statementIndex: packedStatements.index } : {}),
                  ...(packedParagraphs ? { paragraphCount: packedParagraphs.index.length, paragraphIndex: packedParagraphs.index } : {}),
                  ...(densityObj ? { semanticDensityScores: densityObj } : {}),
                  ...(paraDensityObj ? { paragraphSemanticDensityScores: paraDensityObj } : {}),
                  ...(statementEmbeddingResult?.densityRegressionModel ? { densityRegressionModel: statementEmbeddingResult.densityRegressionModel } : {}),
                  ...(queryDensityScore != null ? { querySemanticDensity: queryDensityScore } : {}),
                  embeddingVersion: 2,
                  timestamp: Date.now(),
                },
              }).catch((err) => console.warn('[StepExecutor] Embedding persistence failed (non-blocking):', err));
            }
          }
        } catch (err) {
          console.warn('[StepExecutor] Embedding persistence setup failed (non-blocking):', err);
        }

      } catch (geometryError) {
        console.warn('[StepExecutor] Geometry pipeline failed, continuing without:', getErrorMessage(geometryError));
        geometryDiagnostics.embeddingBackendFailure = true;
        geometryDiagnostics.stages.geometryFailure = {
          startedAtMs,
          timeMs: 0,
          error: getErrorMessage(geometryError),
        };
      }
    })();

    // 3. Build Prompt (LLM) - pass pre-computed paragraph projection and clustering
    const orderedModelIndices = (() => {
      const observed = new Set();
      for (const p of (paragraphResult?.paragraphs || [])) {
        const mi = Number(p?.modelIndex);
        if (Number.isFinite(mi) && mi > 0) observed.add(mi);
      }
      const base = Array.from(observed).sort((a, b) => a - b);
      const all = indexedSourceData.map(s => s.modelIndex);
      if (base.length === 0) return all;
      const missing = all.filter(mi => !observed.has(mi));
      return base.concat(missing);
    })();
    const positionByModelIndex = new Map(orderedModelIndices.map((mi, pos) => [mi, pos]));
    const orderedSourceData = [...indexedSourceData].sort((a, b) => {
      const pa = positionByModelIndex.get(a.modelIndex) ?? indexedSourceData.length;
      const pb = positionByModelIndex.get(b.modelIndex) ?? indexedSourceData.length;
      return pa - pb;
    });

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

    const mappingProviderContexts = await (async () => {
      const pid = String(payload?.mappingProvider || '').trim();
      if (!pid) return undefined;

      const explicit = payload?.providerContexts;
      if (explicit && typeof explicit === 'object' && explicit[pid]) {
        const entry = explicit[pid];
        const meta =
          entry && typeof entry === 'object' && 'meta' in entry ? entry.meta : entry;
        if (meta && typeof meta === 'object' && Object.keys(meta).length > 0) {
          return { [pid]: { meta, continueThread: true } };
        }
      }

      const sourceStepIds = Array.isArray(payload?.sourceStepIds)
        ? payload.sourceStepIds
        : [];
      for (const sourceStepId of sourceStepIds) {
        const stepResult = stepResults?.get?.(sourceStepId);
        if (!stepResult || stepResult.status !== 'completed') continue;
        const providerResult = stepResult?.result?.results?.[pid];
        const meta = providerResult?.meta;
        if (meta && typeof meta === 'object' && Object.keys(meta).length > 0) {
          return { [pid]: { meta, continueThread: true } };
        }
      }

      const historicalTurnId = payload?.sourceHistorical?.turnId;
      const historicalResponseType = payload?.sourceHistorical?.responseType;
      if (
        historicalTurnId &&
        typeof historicalTurnId === 'string' &&
        sessionManager?.adapter?.getResponsesByTurnId
      ) {
        try {
          const records = await sessionManager.adapter.getResponsesByTurnId(historicalTurnId);
          const candidates = Array.isArray(records)
            ? records.filter(
              (r) =>
                r &&
                r.providerId === pid &&
                r.responseType === historicalResponseType &&
                r.meta &&
                typeof r.meta === 'object',
            )
            : [];
          candidates.sort((a, b) => {
            const ai = (a.responseIndex ?? 0);
            const bi = (b.responseIndex ?? 0);
            if (bi !== ai) return bi - ai;
            const at = (a.updatedAt ?? a.createdAt ?? 0);
            const bt = (b.updatedAt ?? b.createdAt ?? 0);
            return bt - at;
          });
          const meta = candidates[0]?.meta;
          if (meta && typeof meta === 'object' && Object.keys(meta).length > 0) {
            return { [pid]: { meta, continueThread: true } };
          }
        } catch (_) { }
      }

      try {
        if (!sessionManager?.getProviderContexts) return undefined;
        const ctxs = await sessionManager.getProviderContexts(context.sessionId, DEFAULT_THREAD, { contextRole: 'batch' });
        const meta = ctxs?.[pid]?.meta;
        if (meta && typeof meta === 'object' && Object.keys(meta).length > 0) {
          return { [pid]: { meta, continueThread: true } };
        }
      } catch (_) { }

      return undefined;
    })();

    return new Promise((resolve, reject) => {
      this.orchestrator.executeParallelFanout(
        mappingPrompt,
        [payload.mappingProvider],
        {
          sessionId: context.sessionId,
          useThinking: payload.useThinking,
          providerContexts: mappingProviderContexts,
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
            const paragraphClusteringSummary = null; // clustering not implemented in this path

            if (finalResult?.text) {
              try {
                await geometryPromise;
              } catch (_) { }
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
                // Survey gates are the sole source of conditionals — semantic mapper never produces them.
                let surveyGateConditionals = [];
                let rawGates = [];
                let gateQuestionByClaimPair = new Map();

                let enrichedClaims = [];

                const mapperClaimsForProvenance = (parseResult.output.claims || []).map((c) => ({
                  id: c.id,
                  label: c.label,
                  text: c.text,
                  supporters: Array.isArray(c.supporters) ? c.supporters : [],
                }));

                // Generate claim embeddings ONCE — reused by provenance + elbow diagnostics
                let claimEmbeddings = null;
                let claimDensityScores = null;
                try {
                  const { generateClaimEmbeddings } = await import('../../ConciergeService/claimAssembly');
                  const claimEmbResult = await generateClaimEmbeddings(
                    mapperClaimsForProvenance,
                    statementEmbeddingResult?.densityRegressionModel
                  );
                  claimEmbeddings = claimEmbResult.embeddings;
                  claimDensityScores = claimEmbResult.semanticDensityScores || null;
                } catch (claimEmbErr) {
                  console.warn('[StepExecutor] Claim embedding generation failed:', getErrorMessage(claimEmbErr));
                }

                // Persist claim embeddings keyed by provider (mapper-layer, not geometry-layer)
                try {
                  if (claimEmbeddings && claimEmbeddings.size > 0 && options.sessionManager && context.canonicalAiTurnId) {
                    const { packEmbeddingMap } = await import('../../persistence/embeddingCodec');
                    let dims = 0;
                    for (const v of claimEmbeddings.values()) {
                      const n = v?.length;
                      if (typeof n === 'number' && Number.isFinite(n) && n > 0) {
                        dims = n;
                        break;
                      }
                    }
                    if (dims > 0) {
                      const packedClaims = packEmbeddingMap(claimEmbeddings, dims);
                      options.sessionManager.persistClaimEmbeddings(
                        context.canonicalAiTurnId,
                        payload.mappingProvider,
                        {
                          claimEmbeddings: packedClaims.buffer,
                          meta: {
                            dimensions: dims,
                            claimCount: packedClaims.index.length,
                            claimIndex: packedClaims.index,
                            timestamp: Date.now(),
                          },
                        },
                      ).catch((err) => console.warn('[StepExecutor] Claim embedding persistence failed:', err));
                    } else {
                      console.warn(`[StepExecutor] Claim embedding persistence skipped: invalid dimensions (aiTurnId=${context.canonicalAiTurnId}, provider=${payload.mappingProvider})`);
                    }
                  }
                } catch (err) {
                  console.warn('[StepExecutor] Claim embedding persistence setup failed:', err);
                }

                try {
                  const provenanceResult = await reconstructProvenance(
                    mapperClaimsForProvenance,
                    shadowResult.statements,
                    paragraphResult.paragraphs,
                    embeddingResult?.embeddings || new Map(),
                    regions,
                    citationOrder.length,
                    statementEmbeddingResult?.embeddings || null,
                    claimEmbeddings,
                  );
                  enrichedClaims = provenanceResult.claims;
                  // Competitive allocation maps — kept local to avoid cross-request leakage
                  const competitiveWeights = provenanceResult.competitiveWeights;
                  const competitiveExcess = provenanceResult.competitiveExcess;
                  const competitiveThresholds = provenanceResult.competitiveThresholds;

                  // Compute claim density + densityLift
                  if (claimDensityScores && statementEmbeddingResult?.semanticDensityScores) {
                    const stmtDensity = statementEmbeddingResult.semanticDensityScores;
                    for (const claim of enrichedClaims) {
                      const claimScore = claimDensityScores.get(claim.id);
                      if (claimScore == null) continue;
                      claim.density = claimScore;
                      if (!claim.sourceStatementIds?.length) continue;
                      const assigned = claim.sourceStatementIds
                        .map(sid => stmtDensity.get(sid)).filter(v => v != null);
                      if (assigned.length === 0) continue;
                      claim.densityLift = claimScore - assigned.reduce((a, b) => a + b, 0) / assigned.length;
                    }
                  }

                  // ── DETERMINISTIC PIPELINE (shared with regenerate flow) ──
                  const { computeDerivedFields, buildTraversalData, extractForcingPointsFromGraph, assembleMapperArtifact } =
                    await import('./deterministicPipeline');

                  let derived = await computeDerivedFields({
                    enrichedClaims,
                    mapperClaimsForProvenance,
                    parsedEdges: unifiedEdges,
                    parsedConditionals: surveyGateConditionals,
                    shadowStatements: shadowResult.statements,
                    shadowParagraphs: paragraphResult.paragraphs,
                    statementEmbeddings: statementEmbeddingResult?.embeddings || new Map(),
                    paragraphEmbeddings: embeddingResult?.embeddings || new Map(),
                    claimEmbeddings: claimEmbeddings || new Map(),
                    queryEmbedding,
                    substrate,
                    preSemantic: preSemanticInterpretation,
                    regions,
                    geoRecord: null,
                    existingQueryRelevance: queryRelevance,
                    modelCount: citationOrder.length,
                    queryText: payload.originalPrompt,
                    competitiveWeights: competitiveWeights || null,
                    competitiveExcess: competitiveExcess || null,
                    competitiveThresholds: competitiveThresholds || null,
                    tableSidecar: shadowResult.tableSidecar || [],
                    cellUnitEmbeddings: cellUnitEmbeddings || null,
                  });

                  let cachedStructuralAnalysis = derived.cachedStructuralAnalysis;
                  let blastSurfaceResult = derived.blastSurfaceResult;
                  let mapperArtifact_claimProvenance = derived.claimProvenance;

                  let questionSelectionInstrumentation = null;

                  try {
                    const { computeQuestionSelectionInstrumentation } =
                      await import('../blast-radius/questionSelection');
                    questionSelectionInstrumentation = computeQuestionSelectionInstrumentation({
                      blastSurfaceResult: blastSurfaceResult ?? null,
                      edges: unifiedEdges,
                      enrichedClaims,
                      queryRelevanceScores: queryRelevance?.statementScores ?? null,
                      modelCount: citationOrder.length,
                      claimCentroids: claimEmbeddings ?? new Map(),
                      queryEmbedding: queryEmbedding ?? null,
                      statementEmbeddings: statementEmbeddingResult?.embeddings ?? null,
                    });
                  } catch (err) {
                    console.warn('[StepExecutor] Question selection instrumentation failed:', getErrorMessage(err));
                    questionSelectionInstrumentation = null;
                  }

                  let claimRouting = null;
                  try {
                    const { computeClaimRouting } =
                      await import('../blast-radius/questionSelection');
                    claimRouting = computeClaimRouting({
                      blastSurfaceResult: blastSurfaceResult ?? null,
                      edges: unifiedEdges,
                      enrichedClaims,
                      queryRelevanceScores: queryRelevance?.statementScores ?? null,
                      modelCount: citationOrder.length,
                      claimCentroids: claimEmbeddings ?? new Map(),
                      queryEmbedding: queryEmbedding ?? null,
                      statementEmbeddings: statementEmbeddingResult?.embeddings ?? null,
                    });
                    console.log(
                      `[ClaimRouting] ${claimRouting.conflictClusters.length} conflict cluster(s), ${claimRouting.damageOutliers.length} outlier(s), skip=${claimRouting.skipSurvey}`
                    );
                  } catch (err) {
                    console.warn('[ClaimRouting] Failed, falling back to old survey prompt:', getErrorMessage(err));
                    claimRouting = null;
                  }

                  let surveyRationale = null;
                  const semanticContinuationMeta = (() => {
                    try {
                      const meta = finalResult?.meta;
                      if (meta && typeof meta === 'object' && Object.keys(meta).length > 0) {
                        return { ...meta };
                      }
                    } catch (_) { }
                    return null;
                  })();
                  const useSurveyMapper = true;
                  const shouldRunSurvey = useSurveyMapper
                    && enrichedClaims.length > 0
                    ;

                  if (shouldRunSurvey) {
                    try {
                      const {
                        buildSurveyMapperPrompt,
                        buildRoutedSurveyPrompt,
                        parseSurveyMapperOutput: parseSurveyOutput,
                        validateAssessmentCoverage,
                      } =
                        await import('../../ConciergeService/surveyMapper');

                      const claimsForSurvey = enrichedClaims.map((c) => ({
                        id: String(c?.id || ''),
                        label: String(c?.label || ''),
                        text: String(c?.text || ''),
                        supporters: Array.isArray(c?.supporters) ? c.supporters : [],
                      }));

                      let surveyPrompt = null;
                      if (claimRouting) {
                        if (!claimRouting.skipSurvey) {
                          surveyPrompt = buildRoutedSurveyPrompt({
                            userQuery: payload.originalPrompt,
                            routing: claimRouting,
                            allClaims: claimsForSurvey,
                            batchTexts: indexedSourceData.map((s) => ({
                              modelIndex: s.modelIndex,
                              content: s.text,
                            })),
                            edges: unifiedEdges,
                          });
                        }
                      } else {
                        surveyPrompt = buildSurveyMapperPrompt(
                          payload.originalPrompt,
                          claimsForSurvey,
                          unifiedEdges,
                          indexedSourceData.map((s) => ({ modelIndex: s.modelIndex, content: s.text }))
                        );
                      }

                      if (!surveyPrompt) {
                        console.log('[SurveyMapper] Skipped: routing determined no survey needed');
                      } else {
                        const surveyResult = await new Promise((resolve) => {
                          let surveyText = '';
                          this.orchestrator.executeParallelFanout(
                            surveyPrompt,
                            [payload.mappingProvider],
                            {
                              sessionId: context.sessionId,
                              useThinking: false,
                              providerContexts: semanticContinuationMeta
                                ? { [payload.mappingProvider]: { meta: semanticContinuationMeta, continueThread: true } }
                                : mappingProviderContexts,
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

                          // Coverage check: did the model assess every claim it was asked about?
                          const expectedIds = claimsForSurvey.map((c) => c.id);
                          const coverage = validateAssessmentCoverage(expectedIds, parsed.assessments);
                          if (coverage.errors.length > 0) {
                            parsed.errors.push(...coverage.errors);
                          }

                          if (parsed.errors.length > 0) {
                            console.warn('[SurveyMapper] Parse warnings:', parsed.errors);
                          }
                          console.log(`[SurveyMapper] ${rawGates.length} gate(s) produced, ${parsed.assessments.length}/${expectedIds.length} claims assessed`);

                          gateQuestionByClaimPair = new Map();

                          for (const gate of rawGates) {
                            if (!gate || !gate.id) continue;
                            const affected = Array.isArray(gate.affectedClaims)
                              ? gate.affectedClaims.map((c) => String(c).trim()).filter(Boolean)
                              : [];
                            if (affected.length === 0) continue;

                            surveyGateConditionals.push({
                              id: gate.id,
                              question: String(gate.question || '').trim(),
                              affectedClaims: affected,
                              construct: null,
                              hinge: null,
                              classification: 'conditional_gate',
                            });

                          }
                        }
                      }
                    } catch (err) {
                      console.warn('[SurveyMapper] Failed, continuing without gates:', getErrorMessage(err));
                      rawGates = [];
                      surveyRationale = null;
                    }
                  }

                  if (Array.isArray(rawGates) && rawGates.length > 0) {
                    derived = await computeDerivedFields({
                      enrichedClaims,
                      mapperClaimsForProvenance,
                      parsedEdges: unifiedEdges,
                      parsedConditionals: surveyGateConditionals,
                      shadowStatements: shadowResult.statements,
                      shadowParagraphs: paragraphResult.paragraphs,
                      statementEmbeddings: statementEmbeddingResult?.embeddings || new Map(),
                      paragraphEmbeddings: embeddingResult?.embeddings || new Map(),
                      claimEmbeddings: claimEmbeddings || new Map(),
                      queryEmbedding,
                      substrate,
                      preSemantic: preSemanticInterpretation,
                      regions,
                      geoRecord: null,
                      existingQueryRelevance: queryRelevance,
                      modelCount: citationOrder.length,
                      queryText: payload.originalPrompt,
                      competitiveWeights: this._competitiveWeights || null,
                      competitiveExcess: this._competitiveExcess || null,
                      competitiveThresholds: this._competitiveThresholds || null,
                    });
                    cachedStructuralAnalysis = derived.cachedStructuralAnalysis;
                    blastSurfaceResult = derived.blastSurfaceResult;
                    mapperArtifact_claimProvenance = derived.claimProvenance;
                  }

                  // ── TRAVERSAL + ARTIFACT ASSEMBLY (uses shared pipeline) ──
                  const { traversalGraph } = buildTraversalData({
                    enrichedClaims,
                    edges: unifiedEdges,
                    conditionals: surveyGateConditionals,
                    conflictTiering: true,
                  });
                  const forcingPoints = await extractForcingPointsFromGraph(traversalGraph);

                  mapperArtifact = assembleMapperArtifact({
                    derived,
                    enrichedClaims,
                    traversalGraph,
                    forcingPoints,
                    parsedNarrative: String(parseResult.narrative || '').trim(),
                    parsedConditionals: surveyGateConditionals,
                    queryText: payload.originalPrompt,
                    modelCount: citationOrder.length,
                    shadowStatements: shadowResult.statements,
                    turn: context.turn || 0,
                    surveyGates: rawGates.length > 0 ? rawGates : undefined,
                    surveyRationale,
                    statementSemanticDensity: statementEmbeddingResult?.semanticDensityScores?.size > 0
                      ? Object.fromEntries(statementEmbeddingResult.semanticDensityScores)
                      : undefined,
                    paragraphSemanticDensity: paragraphDensityScores?.size > 0
                      ? Object.fromEntries(paragraphDensityScores)
                      : undefined,
                    claimSemanticDensity: claimDensityScores?.size > 0
                      ? Object.fromEntries(claimDensityScores)
                      : undefined,
                    querySemanticDensity: queryDensityScore,
                  });
                  // Add StepExecutor-specific fields
                  mapperArtifact.preSemantic = preSemanticInterpretation || null;
                  if (paragraphResult?.meta) mapperArtifact.paragraphProjection = paragraphResult.meta;
                  if (paragraphClusteringSummary) mapperArtifact.paragraphClustering = paragraphClusteringSummary;
                  if (substrateSummary) mapperArtifact.substrate = substrateSummary;
                  if (questionSelectionInstrumentation) {
                    mapperArtifact.questionSelectionInstrumentation = questionSelectionInstrumentation;
                  }
                  if (claimRouting) {
                    mapperArtifact.claimRouting = claimRouting;
                  }

                  let diagnosticsResult = null;
                  try {
                    if (preSemanticInterpretation && mapperArtifact) {
                      const { validateStructuralMapping } = await import('../../geometry/interpretation');
                      let postSemantic = cachedStructuralAnalysis;
                      if (!postSemantic) {
                        const { computeStructuralAnalysis } = await import('../PromptMethods');
                        const tempCognitive = buildCognitiveArtifact(JSON.parse(JSON.stringify(mapperArtifact)), null);
                        postSemantic = computeStructuralAnalysis(tempCognitive);
                      }
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
                      mapperArtifact.diagnostics = diagnosticsResult;
                      const claimMeasurements = diagnosticsResult?.measurements?.claimMeasurements;
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

                    if (mapperArtifact_claimProvenance) {
                      mapperArtifact.claimProvenance = mapperArtifact_claimProvenance;
                    }
                  }

                  console.log(`[StepExecutor] Generated mapper artifact with ${enrichedClaims.length} claims, ${(derived.semanticEdges?.length || 0) + (derived.derivedSupportEdges?.length || 0)} edges`);
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

            if (mapperArtifact && typeof mapperArtifact === 'object') {
              mapperArtifact.citationSourceOrder = citationSourceOrder;
            }

            const providerThreadMeta = (() => {
              try {
                const meta = finalResult?.meta;
                if (meta && typeof meta === 'object') return { ...meta };
              } catch (_) { }
              return {};
            })();

            const finalResultWithMeta = {
              ...finalResult,
              meta: {
                ...providerThreadMeta,
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
              ...(basinInversionResult ? { basinInversion: basinInversionResult } : {}),
            });

            try {
              if (finalResultWithMeta?.meta) {
                workflowContexts[payload.mappingProvider] =
                  providerThreadMeta;
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
      const parsed = parseSemanticMapperOutput(payload.mappingText);
      if (parsed.success && parsed.output) {
        const shell = createEmptyMapperArtifact();
        shell.claims = parsed.output.claims;
        shell.edges = parsed.output.edges;
        shell.narrative = parsed.narrative || '';
        mappingArtifact = buildCognitiveArtifact(shell, null);
      }
    }

    if (!mappingArtifact) {
      throw new Error("Singularity mode requires a mapping artifact.");
    }

    let ConciergeService;
    let handoffV2Enabled = false;
    try {
      const module = await import('../../ConciergeService/ConciergeService');
      ConciergeService = module.ConciergeService;
      handoffV2Enabled = module.HANDOFF_V2_ENABLED === true;
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
        if (handoffV2Enabled && ConciergeService && typeof ConciergeService.parseConciergeOutput === "function") {
          const parsed = ConciergeService.parseConciergeOutput(rawText);
          if (parsed) {
            cleanedText = parsed.userResponse || cleanedText;
            signal = parsed.signal || null;
          }
        }
      } catch (_) { }

      const pipeline = {
        userMessage: payload.originalPrompt,
        prompt: singularityPrompt,
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

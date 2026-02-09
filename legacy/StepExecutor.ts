import { DEFAULT_THREAD } from '../../../shared/messaging';
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

import type { ProviderError } from '../../../shared/contract';
import type {
  Orchestrator,
  HealthTracker,
  ExecutionContext,
  PromptStepOptions,
  MappingStepOptions,
  SingularityStepOptions,
  GenericStepOptions,
  ProviderResult,
  IndexedSourceData,
  RuntimePromptStepPayload,
  RuntimeMappingStepPayload,
  RuntimeSingularityStepPayload,
  PromptStepResult,
  MappingStepResult,
  GenericStepResult,
  SourceDataEntry,
  SubstrateGraphData,
  SerializedClaim,
  SingularityParsedOutput,
  RejectedResult,
  PartialChunk,
} from './types';

// computeExplore import removed (unused)
// persona signal injections removed (absorbed by Concierge)

const WORKFLOW_DEBUG = false;
const wdbg = (...args: unknown[]): void => {
  if (WORKFLOW_DEBUG) console.log(...args);
};

export class StepExecutor {
  private orchestrator: Orchestrator;
  private healthTracker: HealthTracker;

  constructor(orchestrator: Orchestrator, healthTracker: HealthTracker) {
    this.orchestrator = orchestrator;
    // MapperService deprecated; mapping handled by new semantic mapper pipeline
    // ResponseProcessor removed; providers produce normalized { text } already
    this.healthTracker = healthTracker;
  }

  async executePromptStep(
    step: { stepId: string; payload: RuntimePromptStepPayload },
    context: ExecutionContext,
    options: PromptStepOptions,
  ): Promise<PromptStepResult> {
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
        const bridge = buildReactiveBridge(prompt, step.payload.previousAnalysis as Parameters<typeof buildReactiveBridge>[1]);
        if (bridge) {
          bridgeContext = bridge.context;
          console.log(`[StepExecutor] Injected reactive bridge context: ${bridge.matched.map((m: { label: string }) => m.label).join(', ')}`);
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

    const providerStatuses: Array<{
      providerId: string;
      status: string;
      progress?: number;
      skippedReason?: string;
      error?: ProviderError | { type: string; message: string; retryable: boolean; retryAfterMs?: number };
    }> = [];
    const activeProviders: string[] = [];
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
    const allowedProviders: string[] = [];
    const skippedProviders: string[] = [];
    try {
      for (const pid of activeProviders) {
        const limits = PROVIDER_LIMITS[pid as keyof typeof PROVIDER_LIMITS];
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
      const completedProviders = new Set<string>();
      this.orchestrator.executeParallelFanout(enhancedPrompt, allowedProviders, {
        sessionId: context.sessionId,
        useThinking,
        providerContexts,
        providerMeta: step?.payload?.providerMeta as Record<string, unknown> | undefined,
        onPartial: (providerId: string, chunk: PartialChunk) => {
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
        onProviderComplete: (providerId: string, resultWrapper: unknown) => {
          const entry = providerStatuses.find((s) => s.providerId === providerId);

          if (resultWrapper && (resultWrapper as RejectedResult).status === "rejected") {
            const err = (resultWrapper as RejectedResult).reason;
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
        onError: (error: Error) => {
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
        onAllComplete: async (results: Map<string, ProviderResult>, errors: Map<string, Error>) => {
          const batchUpdates: Record<string, ProviderResult> = {};
          results.forEach((result, providerId) => {
            batchUpdates[providerId] = result;
          });

          // Update contexts async
          options.persistenceCoordinator.persistProviderContextsAsync(context.sessionId, batchUpdates, "batch");

          const formattedResults: Record<string, {
            providerId: string;
            text: string;
            status: string;
            meta: Record<string, unknown>;
            artifacts?: Array<{ title: string; identifier: string; content: string; type: string }>;
            softError?: { message: string };
          }> = {};
          const authErrors: Error[] = [];

          results.forEach((result, providerId) => {
            const processed = artifactProcessor.process(result.text || '');
            formattedResults[providerId] = {
              providerId: providerId,
              text: processed.cleanText,
              status: "completed",
              meta: (result.meta || {}) as Record<string, unknown>,
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

          errors.forEach((error: Error & { providerResponse?: { meta?: { error?: unknown; details?: unknown } }; code?: string }, providerId: string) => {
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

          // CRITICAL FIX: Ensure skipped/failed providers are included in formattedResults
          providerStatuses.forEach(p => {
            if ((p.status === 'skipped' || p.status === 'failed') && !formattedResults[p.providerId]) {
              formattedResults[p.providerId] = {
                providerId: p.providerId,
                text: "",
                status: p.status === 'skipped' ? 'skipped' : 'failed',
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

  async executeMappingStep(
    step: { stepId: string; payload: RuntimeMappingStepPayload },
    context: ExecutionContext,
    stepResults: Map<string, { status: string; result: { results: Record<string, { status: string; text?: string }> } }>,
    workflowContexts: Record<string, unknown>,
    options: MappingStepOptions,
  ): Promise<MappingStepResult> {
    const { streamingManager } = options;
    const artifactProcessor = new ArtifactProcessor();
    const payload = step.payload;
    const sourceData = await this._resolveSourceData(
      payload,
      context,
      stepResults,
      options
    );

    if (sourceData.length < 2) {
      throw new Error(
        `Mapping requires at least 2 valid sources, but found ${sourceData.length}.`,
      );
    }

    wdbg(
      `[StepExecutor] Running mapping with ${sourceData.length
      } sources: ${sourceData.map((s) => s.providerId).join(", ")} `,
    );

    const providerOrder: string[] = Array.isArray(payload.providerOrder)
      ? payload.providerOrder
      : sourceData.map((s) => s.providerId);
    const citationOrder = providerOrder.filter((pid) =>
      sourceData.some((s) => s.providerId === pid),
    );

    const indexedSourceData: IndexedSourceData[] = sourceData.map((s, idx) => {
      const modelIndex = citationOrder.findIndex((pid) => pid === s.providerId) + 1;
      return {
        providerId: s.providerId,
        modelIndex: modelIndex > 0 ? modelIndex : idx + 1,
        text: s.text,
      };
    });
    void indexedSourceData;

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

    // 2. Shadow Extraction (Mechanical)
    // Map sourceData to expected format (modelIndex, content)
    const shadowInput = sourceData.map(s => {
      const idx = citationOrder.findIndex(pid => pid === s.providerId) + 1;
      return { modelIndex: idx > 0 ? idx : 99, content: s.text };
    });

    console.log(`[StepExecutor] Extracting shadow statements from ${shadowInput.length} models...`);
    const shadowResult = extractShadowStatements(shadowInput);
    console.log(`[StepExecutor] Extracted ${shadowResult.statements.length} shadow statements.`);

    // ════════════════════════════════════════════════════════════════════════
    // 2.5 PARAGRAPH PROJECTION (sync, fast)
    // ════════════════════════════════════════════════════════════════════════
    const { projectParagraphs } = shadowModule;
    const paragraphResult = projectParagraphs(shadowResult.statements);
    console.log(`[StepExecutor] Projected ${paragraphResult.paragraphs.length} paragraphs ` +
      `${paragraphResult.meta.processingTimeMs.toFixed(1)}ms)`);

    // ════════════════════════════════════════════════════════════════════════
    // 2.6 CLUSTERING (async, may fail gracefully)
    // ════════════════════════════════════════════════════════════════════════
    let clusteringResult: Awaited<ReturnType<typeof import('../../clustering')['buildClusters']>> | null = null;
    let embeddingResult: { embeddings: Map<string, Float32Array>; dimensions: number; timeMs: number } | null = null;
    let statementEmbeddingResult: { embeddings: Map<string, Float32Array>; dimensions: number; timeMs: number } | null = null;
    let paragraphClusteringSummary: { meta: Record<string, unknown>; clusters: Array<{ id: string; size: number; cohesion: number; pairwiseCohesion: number; uncertain: boolean; uncertaintyReasons?: string[] }> } | null = null;
    let substrateSummary: Record<string, unknown> | null = null;
    let substrateGraph: SubstrateGraphData | null = null;
    let substrateDegenerate: boolean | null = null;
    let substrateDegenerateReason: string | null = null;
    let preSemanticInterpretation: Awaited<ReturnType<typeof import('../../geometry/interpretation')['buildPreSemanticInterpretation']>> | null = null;
    let substrate: Awaited<ReturnType<typeof import('../../geometry')['buildGeometricSubstrate']>> | null = null;
    let enrichmentResult: Awaited<ReturnType<typeof enrichStatementsWithGeometry>> | null = null;
    if (paragraphResult.paragraphs.length > 0) {
      try {
        const clusteringModule = await import('../../clustering');
        const { generateStatementEmbeddings, poolToParagraphEmbeddings, getEmbeddingStatus, buildClusters, DEFAULT_CONFIG } = clusteringModule;
        const { buildGeometricSubstrate, isDegenerate } = await import('../../geometry');
        const { buildPreSemanticInterpretation } = await import('../../geometry/interpretation');

        // Statement-level embeddings → pooled paragraph representations
        statementEmbeddingResult = await generateStatementEmbeddings(
          shadowResult.statements,
          DEFAULT_CONFIG
        );

        const pooledParagraphEmbeddings = poolToParagraphEmbeddings(
          paragraphResult.paragraphs,
          shadowResult.statements,
          statementEmbeddingResult.embeddings,
          DEFAULT_CONFIG.embeddingDimensions
        );

        embeddingResult = {
          embeddings: pooledParagraphEmbeddings,
          dimensions: DEFAULT_CONFIG.embeddingDimensions,
          timeMs: statementEmbeddingResult.timeMs,
        };

        let embeddingBackend: 'none' | 'webgpu' | 'wasm' = 'none';
        try {
          const status = await getEmbeddingStatus();
          if (status?.backend === 'webgpu' || status?.backend === 'wasm') {
            embeddingBackend = status.backend;
          }
        } catch (_) { }

        substrate = buildGeometricSubstrate(
          paragraphResult.paragraphs,
          embeddingResult.embeddings,
          embeddingBackend
        );

        try {
          substrateDegenerate = isDegenerate(substrate);
          substrateDegenerateReason = substrateDegenerate
            ? (substrate && typeof substrate === 'object' && 'degenerateReason' in substrate
              ? String((substrate as { degenerateReason: unknown }).degenerateReason)
              : 'unknown')
            : null;
        } catch (_) {
          substrateDegenerate = null;
          substrateDegenerateReason = null;
        }
        void substrateDegenerateReason;

        try {
          const nodeCount = Array.isArray(substrate.nodes) ? substrate.nodes.length : 0;
          const avgTop1Sim = Array.isArray(substrate.nodes) && nodeCount > 0
            ? substrate.nodes.reduce((acc: number, n: { top1Sim?: number }) => acc + (typeof n?.top1Sim === 'number' ? n.top1Sim : 0), 0) / nodeCount
            : 0;
          const avgIsolationScore = Array.isArray(substrate.nodes) && nodeCount > 0
            ? substrate.nodes.reduce((acc: number, n: { isolationScore?: number }) => acc + (typeof n?.isolationScore === 'number' ? n.isolationScore : 0), 0) / nodeCount
            : 0;

          substrateSummary = {
            shape: {
              prior: String((substrate as { shape?: { prior?: unknown } })?.shape?.prior || 'unknown'),
              confidence: typeof (substrate as { shape?: { confidence?: number } })?.shape?.confidence === 'number' ? (substrate as { shape: { confidence: number } }).shape.confidence : 0,
            },
            topology: {
              componentCount: typeof (substrate as { topology?: { componentCount?: number } })?.topology?.componentCount === 'number' ? (substrate as { topology: { componentCount: number } }).topology.componentCount : 0,
              largestComponentRatio: typeof (substrate as { topology?: { largestComponentRatio?: number } })?.topology?.largestComponentRatio === 'number' ? (substrate as { topology: { largestComponentRatio: number } }).topology.largestComponentRatio : 0,
              isolationRatio: typeof (substrate as { topology?: { isolationRatio?: number } })?.topology?.isolationRatio === 'number' ? (substrate as { topology: { isolationRatio: number } }).topology.isolationRatio : 0,
              globalStrongDensity: typeof (substrate as { topology?: { globalStrongDensity?: number } })?.topology?.globalStrongDensity === 'number' ? (substrate as { topology: { globalStrongDensity: number } }).topology.globalStrongDensity : 0,
            },
            meta: {
              embeddingSuccess: !!(substrate as { meta?: { embeddingSuccess?: boolean } })?.meta?.embeddingSuccess,
              embeddingBackend: (substrate as { meta?: { embeddingBackend?: string } })?.meta?.embeddingBackend || 'none',
              nodeCount: typeof (substrate as { meta?: { nodeCount?: number } })?.meta?.nodeCount === 'number' ? (substrate as { meta: { nodeCount: number } }).meta.nodeCount : nodeCount,
              knnEdgeCount: typeof (substrate as { meta?: { knnEdgeCount?: number } })?.meta?.knnEdgeCount === 'number' ? (substrate as { meta: { knnEdgeCount: number } }).meta.knnEdgeCount : 0,
              mutualEdgeCount: typeof (substrate as { meta?: { mutualEdgeCount?: number } })?.meta?.mutualEdgeCount === 'number' ? (substrate as { meta: { mutualEdgeCount: number } }).meta.mutualEdgeCount : 0,
              strongEdgeCount: typeof (substrate as { meta?: { strongEdgeCount?: number } })?.meta?.strongEdgeCount === 'number' ? (substrate as { meta: { strongEdgeCount: number } }).meta.strongEdgeCount : 0,
              softThreshold: typeof (substrate as { graphs?: { strong?: { softThreshold?: number } } })?.graphs?.strong?.softThreshold === 'number' ? (substrate as { graphs: { strong: { softThreshold: number } } }).graphs.strong.softThreshold : 0,
              buildTimeMs: typeof (substrate as { meta?: { buildTimeMs?: number } })?.meta?.buildTimeMs === 'number' ? (substrate as { meta: { buildTimeMs: number } }).meta.buildTimeMs : 0,
            },
            nodes: {
              avgTop1Sim,
              avgIsolationScore,
            },
          };
        } catch (_) {
          substrateSummary = null;
        }

        if (isDegenerate(substrate)) {
          console.warn(`[StepExecutor] Degenerate substrate: ${(substrate as { degenerateReason?: string }).degenerateReason}`);
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
            embeddingResult.embeddings,
            DEFAULT_CONFIG,
            substrate.graphs.mutual
          );

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

        try {
          if (!substrateDegenerate && typeof buildPreSemanticInterpretation === 'function') {
            preSemanticInterpretation = buildPreSemanticInterpretation(
              substrate,
              paragraphResult.paragraphs,
              Array.isArray(clusteringResult?.clusters) ? clusteringResult!.clusters : undefined
            );
          } else {
            preSemanticInterpretation = null;
          }
        } catch (_) {
          preSemanticInterpretation = null;
        }

        try {
          if (substrate && !substrateDegenerate && substrate.layout2d && substrate.layout2d.coordinates) {
            const coords = substrate.layout2d.coordinates || {};
            const regions = (preSemanticInterpretation as { regionization?: { regions?: Array<{ id: string; nodeIds?: string[] }> } })?.regionization?.regions || [];

            const paragraphToRegion = new Map<string, string>();
            for (const region of regions) {
              for (const nodeId of region.nodeIds || []) {
                paragraphToRegion.set(nodeId, region.id);
              }
            }

            const paragraphToComponent = new Map<string, string>();
            for (const comp of substrate.topology.components || []) {
              for (const nodeId of (comp as { nodeIds?: string[] }).nodeIds || []) {
                paragraphToComponent.set(nodeId, (comp as { id: string }).id);
              }
            }

            substrateGraph = {
              nodes: (substrate.nodes || []).map((node) => ({
                paragraphId: node.paragraphId,
                modelIndex: node.modelIndex,
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
          const regions = Array.isArray((preSemanticInterpretation as { regionization?: { regions?: unknown[] } })?.regionization?.regions)
            ? (preSemanticInterpretation as { regionization: { regions: Array<{ id: string; nodeIds: string[]; statementIds: string[]; sourceId: string; modelIndices: number[]; kind: string }> } }).regionization.regions
            : [];
          if (substrate && regions.length > 0) {
            enrichmentResult = enrichStatementsWithGeometry(
              shadowResult.statements,
              paragraphResult.paragraphs,
              substrate,
              regions as Parameters<typeof enrichStatementsWithGeometry>[3]
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
        clusteringResult = null;
      }
    } else {
      console.log('[StepExecutor] Skipping embeddings/geometry (no paragraphs)');
    }

    // 3. Build Prompt (LLM) - pass pre-computed paragraph projection and clustering
    const mappingPrompt = buildSemanticMapperPrompt(
      payload.originalPrompt,
      paragraphResult.paragraphs
    );

    const promptLength = mappingPrompt.length;
    console.log(`[StepExecutor] Semantic Mapper prompt length for ${payload.mappingProvider}: ${promptLength} chars`);

    const limits = PROVIDER_LIMITS[payload.mappingProvider as keyof typeof PROVIDER_LIMITS];
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
          providerMeta: step?.payload?.providerMeta as Record<string, unknown> | undefined,
          onPartial: (providerId: string, chunk: PartialChunk) => {
            streamingManager.dispatchPartialDelta(
              context.sessionId,
              step.stepId,
              providerId,
              chunk.text,
              "Mapping",
            );
          },
          onAllComplete: async (results: Map<string, ProviderResult>, errors: Map<string, Error>) => {
            let finalResult: ProviderResult | undefined = results.get(payload.mappingProvider);
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

            let mapperArtifact: Record<string, unknown> | null = null;
            const pipelineArtifacts: unknown = null;
            void pipelineArtifacts;
            const rawText = finalResult?.text || "";
            let shadowDelta: ReturnType<typeof computeShadowDelta> | null = null;
            let topUnindexed: ReturnType<typeof getTopUnreferenced> | null = null;
            let referencedIds: Set<string> | null = null;
            let structuralValidation: unknown = null;

            if (finalResult?.text) {
              // 4. Parse (New Parser)
              const parseResult = parseSemanticMapperOutput(rawText);

              if (parseResult.success && parseResult.output) {
                // 5. Assembly & Traversal (Mechanical)
                const regions = Array.isArray((preSemanticInterpretation as { regionization?: { regions?: unknown[] } } | null)?.regionization?.regions)
                  ? (preSemanticInterpretation as { regionization: { regions: unknown[] } }).regionization.regions
                  : [];
                const regionProfiles = Array.isArray((preSemanticInterpretation as { regionProfiles?: unknown[] } | null)?.regionProfiles)
                  ? (preSemanticInterpretation as { regionProfiles: unknown[] }).regionProfiles
                  : [];

                const unifiedEdges: Array<{ from?: string; to?: string; type?: string; question?: string }> = Array.isArray(parseResult.output.edges) ? parseResult.output.edges as Array<{ from?: string; to?: string; type?: string; question?: string }> : [];
                const unifiedConditionals: Array<{ id?: string; question?: string; affectedClaims?: string[] }> = Array.isArray(parseResult.output.conditionals) ? parseResult.output.conditionals : [];

                const mapperClaimsForProvenance = (parseResult.output.claims || []).map((c: { id: string; label: string; text: string; supporters?: number[] }) => ({
                  id: c.id,
                  label: c.label,
                  text: c.text,
                  supporters: Array.isArray(c.supporters) ? c.supporters : [],
                }));

                const enrichedClaims = await reconstructProvenance(
                  mapperClaimsForProvenance,
                  shadowResult.statements,
                  paragraphResult.paragraphs,
                  embeddingResult?.embeddings || new Map(),
                  regions as Parameters<typeof reconstructProvenance>[4],
                  regionProfiles as Parameters<typeof reconstructProvenance>[5],
                  citationOrder.length,
                  unifiedEdges as Parameters<typeof reconstructProvenance>[7],
                  statementEmbeddingResult?.embeddings || null
                );

                let completeness: { report: unknown; statementFates: Record<string, unknown>; unattendedRegions: unknown[] } | null = null;
                try {
                  if (substrate && Array.isArray(regions) && regions.length > 0) {
                    const statementFates = buildStatementFates(shadowResult.statements, enrichedClaims);
                    const unattendedRegions = findUnattendedRegions(
                      substrate,
                      paragraphResult.paragraphs,
                      enrichedClaims,
                      regions as Parameters<typeof findUnattendedRegions>[3],
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
                      statementCoverage: `${((completenessReport as { statements: { coverageRatio: number } }).statements.coverageRatio * 100).toFixed(1)}%`,
                      regionCoverage: `${((completenessReport as { regions: { coverageRatio: number } }).regions.coverageRatio * 100).toFixed(1)}%`,
                      verdict: (completenessReport as { verdict: { recommendation: string } }).verdict.recommendation,
                      estimatedMissedClaims: (completenessReport as { verdict: { estimatedMissedClaims: number } }).verdict.estimatedMissedClaims
                    });
                  }
                } catch (err) {
                  completeness = null;
                  console.warn('[Reconciliation] Failed:', getErrorMessage(err));
                }

                // ── CLAIM↔GEOMETRY ALIGNMENT ─────────────────────────────
                let alignmentResult: unknown = null;
                try {
                  if (statementEmbeddingResult?.embeddings && regions.length > 0 && enrichedClaims.length > 0) {
                    const { buildClaimVectors, computeAlignment } = await import('../../geometry');
                    // Ensure dimensions are valid (fallback to length of first embedding if dimensions missing)
                    const dimensions = (statementEmbeddingResult as { dimensions?: number }).dimensions ||
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
                        regions as Parameters<typeof computeAlignment>[1],
                        regionProfiles as Parameters<typeof computeAlignment>[2],
                        statementEmbeddingResult.embeddings
                      );
                      console.log('[Alignment]', {
                        globalCoverage: `${((alignmentResult as { globalCoverage: number }).globalCoverage * 100).toFixed(1)}%`,
                        unattended: (alignmentResult as { unattendedRegionIds: string[] }).unattendedRegionIds.length,
                        splits: (alignmentResult as { splitAlerts: unknown[] }).splitAlerts.length,
                        merges: (alignmentResult as { mergeAlerts: unknown[] }).mergeAlerts.length,
                      });
                    }
                  }
                } catch (err) {
                  alignmentResult = null;
                  console.warn('[Alignment] Failed:', getErrorMessage(err));
                }

                const claimOrder = new Map<string, number>();
                for (let i = 0; i < enrichedClaims.length; i++) {
                  const id = (enrichedClaims[i] as { id?: string })?.id;
                  if (id) claimOrder.set(id, i);
                }

                const conflictClaimIdSet = new Set<string>();
                const conflictAdj = new Map<string, Set<string>>();
                for (const e of unifiedEdges) {
                  if (!e || e.type !== 'conflict') continue;
                  const from = String(e.from || '').trim();
                  const to = String(e.to || '').trim();
                  if (!from || !to) continue;

                  conflictClaimIdSet.add(from);
                  conflictClaimIdSet.add(to);

                  if (!conflictAdj.has(from)) conflictAdj.set(from, new Set());
                  if (!conflictAdj.has(to)) conflictAdj.set(to, new Set());
                  conflictAdj.get(from)!.add(to);
                  conflictAdj.get(to)!.add(from);
                }

                const foundationClaimIds: string[] = [];
                for (const c of enrichedClaims) {
                  if (!conflictClaimIdSet.has((c as { id: string }).id)) foundationClaimIds.push((c as { id: string }).id);
                }

                const conflictComponents: string[][] = [];
                const visited = new Set<string>();
                for (const id of Array.from(conflictClaimIdSet)) {
                  if (visited.has(id)) continue;
                  const stack = [id];
                  const component: string[] = [];
                  visited.add(id);
                  while (stack.length > 0) {
                    const cur = stack.pop()!;
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
                  { tierIndex: 0, claimIds: foundationClaimIds, gates: [] as unknown[] },
                  ...conflictComponents.map((claimIds, i) => ({ tierIndex: i + 1, claimIds, gates: [] as unknown[] })),
                ];

                const tierByClaimId = new Map<string, number>();
                for (const t of tiers) {
                  const ids = Array.isArray(t?.claimIds) ? t.claimIds : [];
                  for (const id of ids) {
                    if (!tierByClaimId.has(id)) tierByClaimId.set(id, t.tierIndex);
                  }
                }

                const claimLabelById = new Map<string, string>(
                  enrichedClaims.map((c: { id: string; label?: string }) => [c.id, c.label || c.id]),
                );

                const claimSourceIdsById = new Map<string, string[]>();
                for (const c of enrichedClaims) {
                  const id = String((c as { id?: unknown }).id || '').trim();
                  if (!id) continue;
                  const src = Array.isArray((c as { sourceStatementIds?: unknown }).sourceStatementIds)
                    ? (c as { sourceStatementIds: unknown[] }).sourceStatementIds
                      .map((s) => String(s).trim())
                      .filter(Boolean)
                    : [];
                  claimSourceIdsById.set(id, Array.from(new Set(src)).sort());
                }

                const traversalConditionals = unifiedConditionals
                  .map((cond, i) => {
                    const id = String(cond?.id || '').trim() || `cond_${i}`;
                    const question = String(cond?.question || '').trim();
                    const affectedClaims = Array.isArray(cond?.affectedClaims)
                      ? cond.affectedClaims.map((cid) => String(cid).trim()).filter(Boolean)
                      : [];

                    const uniqueAffected = Array.from(new Set(affectedClaims));
                    const sourceStatementIds = Array.from(
                      new Set(uniqueAffected.flatMap((cid) => claimSourceIdsById.get(cid) || []))
                    ).sort();

                    return {
                      ...cond,
                      id,
                      question,
                      affectedClaims: uniqueAffected,
                      sourceStatementIds,
                    };
                  })
                  .filter((cond) => Array.isArray(cond.affectedClaims) && cond.affectedClaims.length > 0);

                const conditionalsByClaimId = new Map<string, typeof traversalConditionals>();
                for (const cond of traversalConditionals) {
                  for (const claimId of cond.affectedClaims) {
                    const existing = conditionalsByClaimId.get(claimId);
                    if (existing) existing.push(cond);
                    else conditionalsByClaimId.set(claimId, [cond]);
                  }
                }

                const conflictsById = new Map<string, Array<{ claimId: string; question: string; sourceStatementIds: string[] }>>();

                for (const e of unifiedEdges) {
                  if (!e) continue;
                  if (e.type === 'conflict') {
                    const from = String(e.from || '').trim();
                    const to = String(e.to || '').trim();
                    if (!from || !to) continue;
                    if (!conflictsById.has(from)) conflictsById.set(from, []);
                    const fromLabel = claimLabelById.get(from) || from;
                    const toLabel = claimLabelById.get(to) || to;

                    const sourceStatementIds = Array.from(new Set([
                      ...(claimSourceIdsById.get(from) || []),
                      ...(claimSourceIdsById.get(to) || []),
                    ])).sort();

                    conflictsById.get(from)!.push({
                      claimId: to,
                      question: String(e.question || '').trim() || `${fromLabel} vs ${toLabel}`,
                      sourceStatementIds,
                    });
                  }
                }

                const serializedClaims: SerializedClaim[] = enrichedClaims.map((c: {
                  id?: string;
                  label?: string;
                  supporters?: number[];
                  sourceStatementIds?: string[];
                  supportRatio?: number;
                  hasConditionalSignal?: boolean;
                  hasSequenceSignal?: boolean;
                  hasTensionSignal?: boolean;
                }) => {
                  const id = String(c?.id || '').trim();
                  const supporters = Array.isArray(c?.supporters) ? c.supporters : [];
                  const sourceStatementIds = Array.isArray(c?.sourceStatementIds)
                    ? c.sourceStatementIds.map((s) => String(s)).filter(Boolean)
                    : [];

                  const tier = tierByClaimId.get(id) ?? 0;
                  const conflicts = conflictsById.has(id) ? conflictsById.get(id)! : [];

                  return {
                    id,
                    label: String(c?.label || id),
                    stance: 'NEUTRAL',
                    gates: {
                      conditionals: conditionalsByClaimId.get(id) || [],
                    },
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

                const traversalGraph = {
                  claims: serializedClaims,
                  edges: unifiedEdges,
                  conditionals: traversalConditionals,
                  tiers,
                  maxTier: tiers.length - 1,
                  roots: [] as string[],
                  tensions: [] as unknown[],
                  cycles: [] as string[][],
                };

                const forcingPoints = extractForcingPoints(traversalGraph).map((fp: {
                  id?: string;
                  type?: string;
                  tier?: number;
                  question?: string;
                  condition?: string;
                  affectedClaims?: string[];
                  options?: Array<{ claimId?: string; label?: string }>;
                  blockedByGateIds?: string[];
                  sourceStatementIds?: string[];
                }) => {
                  const options = Array.isArray(fp?.options)
                    ? fp.options
                      .map((o) => ({
                        claimId: String(o?.claimId || '').trim(),
                        label: String(o?.label || '').trim(),
                      }))
                      .filter((o) => o.claimId && o.label)
                    : undefined;

                  const affectedClaims = Array.isArray(fp?.affectedClaims)
                    ? fp.affectedClaims.map((c) => String(c || '').trim()).filter(Boolean)
                    : [];

                  return {
                    id: String(fp?.id || '').trim(),
                    type: fp?.type,
                    tier: typeof fp?.tier === 'number' ? fp.tier : 0,
                    question: String(fp?.question || '').trim(),
                    condition: String(fp?.condition || '').trim(),
                    ...(options ? { options } : {}),
                    unlocks: [] as string[],
                    prunes: fp?.type === 'conditional' ? affectedClaims : ([] as string[]),
                    blockedBy: Array.isArray(fp?.blockedByGateIds)
                      ? fp.blockedByGateIds.map((g) => String(g)).filter(Boolean)
                      : [],
                    sourceStatementIds: Array.isArray(fp?.sourceStatementIds)
                      ? fp.sourceStatementIds.map((s) => String(s)).filter(Boolean)
                      : [],
                    ...(fp?.type === 'conditional' && affectedClaims.length > 0 ? { affectedClaims } : {}),
                  };
                });

                try {
                  // Shadow Delta
                  referencedIds = new Set(
                    enrichedClaims
                      .map((c: { sourceStatementIds?: string[] }) => (Array.isArray(c?.sourceStatementIds) ? c.sourceStatementIds : []))
                      .flat()
                  );
                  shadowDelta = computeShadowDelta(shadowResult, referencedIds, payload.originalPrompt);
                  topUnindexed = getTopUnreferenced(shadowDelta, 10);

                  const EDGE_SUPPORTS = 'supports';
                  const EDGE_CONFLICTS = 'conflicts';

                  const mappedEdges = unifiedEdges
                    .filter((e) => e && e.from && e.to && e.type === 'conflict')
                    .map((e) => {
                      return {
                        from: e.from!,
                        to: e.to!,
                        type: EDGE_CONFLICTS,
                      };
                    });

                  const derivedSupportEdges: Array<{ from: string; to: string; type: string }> = [];
                  const supportKey = new Set<string>();

                  // TODO: Derive support relationships from claim provenance embeddings/geometry.

                  for (const cond of traversalConditionals) {
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

                  const ghosts = null;

                  mapperArtifact = {
                    id: `artifact-${Date.now()}`,
                    query: payload.originalPrompt,
                    turn: context.turn || 0,
                    timestamp: new Date().toISOString(),
                    model_count: citationOrder.length,

                    claims: enrichedClaims,
                    edges: [...mappedEdges, ...derivedSupportEdges],
                    ghosts,
                    narrative: String((parseResult as { narrative?: string }).narrative || '').trim(),
                    conditionals: traversalConditionals,

                    // NEW DATA (not in V1)
                    traversalGraph,
                    forcingPoints,
                    preSemantic: preSemanticInterpretation || null,
                    ...(completeness ? { completeness } : {}),
                    ...(alignmentResult ? { alignment: alignmentResult } : {}),

                    // SHADOW DATA
                    shadow: {
                      statements: shadowResult.statements,
                      audit: shadowDelta.audit,
                      topUnreferenced: Array.isArray(topUnindexed)
                        ? topUnindexed.map((u: { statement?: unknown }) => u?.statement).filter(Boolean)
                        : []
                    },
                    ...(paragraphResult?.meta ? { paragraphProjection: paragraphResult.meta } : {}),
                    ...(paragraphClusteringSummary ? { paragraphClustering: paragraphClusteringSummary } : {}),
                    ...(substrateSummary ? { substrate: substrateSummary } : {}),
                  };

                  try {
                    if (preSemanticInterpretation && mapperArtifact) {
                      const { computeStructuralAnalysis } = await import('../PromptMethods');
                      const { validateStructuralMapping } = await import('../../geometry/interpretation');
                      // Convert to cognitive shape for structural analysis
                      const tempCognitive = buildCognitiveArtifact(JSON.parse(JSON.stringify(mapperArtifact)), null);
                      const postSemantic = computeStructuralAnalysis(tempCognitive);
                      structuralValidation = validateStructuralMapping(preSemanticInterpretation, postSemantic);
                    }
                  } catch (_) {
                    structuralValidation = null;
                  }
                  void structuralValidation;

                  console.log(`[StepExecutor] Generated mapper artifact with ${enrichedClaims.length} claims, ${mappedEdges.length} edges`);
                } catch (err) {
                  console.error('[StepExecutor] Mapper artifact build failed:', err);
                  console.debug('Context:', {
                    originalPrompt: payload.originalPrompt,
                    turn: context.turn,
                    citationCount: citationOrder.length,
                    error: getErrorMessage(err)
                  });
                  throw err;
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
              (finalResult as ProviderResult & { artifacts?: unknown[] }).artifacts = processed.artifacts;

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

            const citationSourceOrder: Record<number, string> = {};
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

            // Build cognitive artifact directly with only the fields it actually uses
            const cognitiveArtifact = buildCognitiveArtifact(mapperArtifact, {
              shadow: {
                extraction: shadowResult || null,
                delta: shadowDelta || null,
              },
              paragraphProjection: paragraphResult || null,
              substrate: {
                graph: substrateGraph,
              },
              preSemantic: preSemanticInterpretation || null,
            });

            try {
              if (finalResultWithMeta?.meta) {
                workflowContexts[payload.mappingProvider] =
                  finalResultWithMeta.meta;
              }
            } catch (_) { }

            resolve({
              providerId: payload.mappingProvider,
              text: finalResultWithMeta.text!,
              status: "completed",
              meta: finalResultWithMeta.meta || {},
              artifacts: (finalResult as ProviderResult & { artifacts?: Array<{ title: string; identifier: string; content: string; type: string }> }).artifacts || [],
              ...(cognitiveArtifact ? { mapping: { artifact: cognitiveArtifact } } : {}),
              ...(finalResult.softError ? { softError: finalResult.softError } : {}),
            });
          },
        },
      );
    });
  }

  async _resolveSourceData(
    payload: RuntimeMappingStepPayload,
    context: ExecutionContext,
    previousResults: Map<string, { status: string; result: { results: Record<string, { status: string; text?: string }> } }>,
    options: MappingStepOptions,
  ): Promise<SourceDataEntry[]> {
    const { sessionManager } = options;
    if (payload.sourceHistorical) {
      // Historical source
      const { turnId, responseType } = payload.sourceHistorical;
      console.log(
        `[StepExecutor] Resolving historical data from turn: ${turnId} `,
      );

      // Prefer adapter lookup
      let aiTurn: Record<string, unknown> | null = null;
      try {
        const adapter = sessionManager?.adapter;
        if (adapter?.isReady && adapter.isReady()) {
          const turn = await adapter.get!("turns", turnId) as Record<string, unknown> | null;
          if (turn && (turn.type === "ai" || turn.role === "assistant")) {
            aiTurn = turn;
          } else if (turn && turn.type === "user") {
            try {
              const sessionTurns = await adapter.getTurnsBySessionId!(context.sessionId) as Array<Record<string, unknown>>;
              if (Array.isArray(sessionTurns)) {
                const userIdx = sessionTurns.findIndex(t => t.id === turnId);
                if (userIdx !== -1) {
                  const next = sessionTurns[userIdx + 1];
                  if (next && (next.type === "ai" || next.role === "assistant")) {
                    aiTurn = next;
                  }
                }
              }
            } catch (_ignored) { }
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
            const sessionTurns = await sessionManager.adapter.getTurnsBySessionId!(context.sessionId) as Array<Record<string, unknown>>;
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

      let sourceContainer: Record<string, Array<{ status: string; text?: string; responseIndex?: number }>>;
      switch (responseType) {
        case "mapping": sourceContainer = (aiTurn.mappingResponses || {}) as typeof sourceContainer; break;
        default: sourceContainer = (aiTurn.batchResponses || {}) as typeof sourceContainer; break;
      }

      const latestMap = new Map<string, SourceDataEntry>();
      Object.keys(sourceContainer).forEach(pid => {
        const versions = (sourceContainer[pid] || [])
          .filter(r => r.status === "completed" && r.text?.trim())
          .sort((a, b) => (b.responseIndex || 0) - (a.responseIndex || 0));

        if (versions.length > 0) {
          latestMap.set(pid, {
            providerId: pid,
            text: versions[0].text!
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
          const responses = await sessionManager.adapter.getResponsesByTurnId!(
            aiTurn.id as string,
          ) as Array<{ responseType?: string; text?: string; providerId: string; responseIndex?: number }>;

          const respType = responseType || "batch";
          const dbLatestMap = new Map<string, { providerId: string; text: string; responseIndex?: number }>();

          (responses || [])
            .filter(r => r?.responseType === respType && r.text?.trim())
            .forEach(r => {
              const existing = dbLatestMap.get(r.providerId);
              if (!existing || (r.responseIndex || 0) >= (existing.responseIndex || 0)) {
                dbLatestMap.set(r.providerId, r as { providerId: string; text: string; responseIndex?: number });
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
      const sourceArray: SourceDataEntry[] = [];
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

  async _executeGenericSingleStep(
    step: { stepId: string; payload: Record<string, unknown> },
    context: ExecutionContext,
    providerId: string,
    prompt: string,
    stepType: string,
    options: GenericStepOptions,
    parseOutputFn: (text: string) => unknown,
  ): Promise<GenericStepResult> {
    const { streamingManager, persistenceCoordinator, sessionManager } = options;
    const { payload } = step;

    console.log(`[StepExecutor] ${stepType} prompt for ${providerId}: ${prompt.length} chars`);

    // 1. Check Limits
    const limits = PROVIDER_LIMITS[providerId as keyof typeof PROVIDER_LIMITS];
    if (limits && prompt.length > limits.maxInputChars) {
      console.warn(`[StepExecutor] ${stepType} prompt length ${prompt.length} exceeds limit ${limits.maxInputChars} for ${providerId}`);
      throw new Error(`INPUT_TOO_LONG: Prompt length ${prompt.length} exceeds limit ${limits.maxInputChars} for ${providerId}`);
    }

    const resolveProviderContextsForPid = async (pid: string): Promise<Record<string, { meta: unknown; continueThread?: boolean }> | undefined> => {
      const role = options.contextRole;
      const effectivePid = role ? `${pid}:${role}` : pid;
      const explicit = payload?.providerContexts as Record<string, unknown> | undefined;

      // If we have an explicit context for the scoped ID, use it
      if (explicit && typeof explicit === "object" && explicit[effectivePid]) {
        const entry = explicit[effectivePid] as Record<string, unknown>;
        const meta = (entry && typeof entry === "object" && "meta" in entry) ? entry.meta : entry;
        const continueThread = (entry && typeof entry === "object" && "continueThread" in entry) ? entry.continueThread as boolean : true;
        return { [pid]: { meta, continueThread } };
      }

      // Fallback: check for the raw pid (legacy or default)
      if (explicit && typeof explicit === "object" && explicit[pid]) {
        const entry = explicit[pid] as Record<string, unknown>;
        const meta = (entry && typeof entry === "object" && "meta" in entry) ? entry.meta : entry;
        const continueThread = (entry && typeof entry === "object" && "continueThread" in entry) ? entry.continueThread as boolean : true;
        return { [pid]: { meta, continueThread } };
      }

      try {
        if (!sessionManager?.getProviderContexts) return undefined;
        // isolation: pass contextRole (e.g. "batch") to get only the scoped thread from DB
        const ctxs = await sessionManager.getProviderContexts(context.sessionId, DEFAULT_THREAD, { contextRole: options.contextRole });
        const meta = (ctxs as Record<string, { meta?: unknown }> | undefined)?.[pid]?.meta;
        if (meta && typeof meta === "object" && Object.keys(meta as Record<string, unknown>).length > 0) {
          return { [pid]: { meta, continueThread: true } };
        }
      } catch (_) { }

      return undefined;
    };

    const runRequest = async (pid: string): Promise<GenericStepResult> => {
      const providerContexts = await resolveProviderContextsForPid(pid);

      return new Promise((resolve, reject) => {
        this.orchestrator.executeParallelFanout(
          prompt,
          [pid],
          {
            sessionId: context.sessionId,
            useThinking: options.useThinking || (payload.useThinking as boolean | undefined) || false,
            providerContexts,
            onPartial: (id: string, chunk: PartialChunk) => {
              streamingManager.dispatchPartialDelta(
                context.sessionId,
                step.stepId,
                id,
                chunk.text,
                stepType
              );
            },
            onAllComplete: (results: Map<string, ProviderResult>, errors: Map<string, Error>) => {
              let finalResult: ProviderResult | undefined = results.get(pid);
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
                let outputData: Record<string, unknown> | null = null;
                try {
                  outputData = parseOutputFn(finalResult.text) as Record<string, unknown> | null;
                  if (outputData && typeof outputData === "object") {
                    outputData.providerId = pid;
                    if (outputData.pipeline && typeof outputData.pipeline === "object") {
                      (outputData.pipeline as Record<string, unknown>).providerId = pid;
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
                  canonicalText as string,
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
                    ...(finalResult.meta as Record<string, unknown> || {}),
                    ...(outputData ? { [`${stepType.toLowerCase()}Output`]: outputData } : {})
                  },
                  output: outputData,
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
              return await runRequest(fallbackProvider as string);
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

  async executeSingularityStep(
    step: { stepId: string; payload: RuntimeSingularityStepPayload },
    context: ExecutionContext,
    _previousResults: Map<string, unknown>,
    options: SingularityStepOptions,
  ): Promise<GenericStepResult> {
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

    let ConciergeService: {
      buildConciergePrompt?: (userMessage: string, opts: Record<string, unknown>) => string;
      parseConciergeOutput?: (text: string) => { userResponse?: string; signal?: unknown } | null;
      detectMachineryLeakage?: (text: string) => { leaked: boolean; violations?: string[] };
    } | null;
    try {
      const module = await import('../../ConciergeService/ConciergeService');
      ConciergeService = module.ConciergeService;
    } catch (e) {
      console.warn("[StepExecutor] Failed to import ConciergeService:", e);
      ConciergeService = null;
    }

    let singularityPrompt: string | undefined;

    if (!ConciergeService) {
      throw new Error("ConciergeService is not available. Cannot execute Singularity step.");
    }

    // ══════════════════════════════════════════════════════════════════
    // FEATURE 3: Rebuild historical prompts for recompute (Efficient Storage)
    // ══════════════════════════════════════════════════════════════════

    const promptSeed = options?.frozenSingularityPromptSeed || payload.conciergePromptSeed;
    let evidenceSubstrate: string | null = null;
    try {
      const substrate = payload?.chewedSubstrate as Record<string, unknown> | undefined;
      if (substrate && typeof substrate === "object") {
        try {
          if (typeof formatSubstrateForPrompt === 'function') {
            const formatted = String(formatSubstrateForPrompt(substrate as unknown as Parameters<typeof formatSubstrateForPrompt>[0]) || '').trim();
            if (formatted) evidenceSubstrate = formatted;
          }
        } catch (_) { }

        if (!evidenceSubstrate) {
          const outputs = substrate && typeof substrate === "object" ? substrate.outputs as Array<{ text?: string }> | null : null;
          if (Array.isArray(outputs) && outputs.length > 0) {
            const parts: string[] = [];
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
      const opts: Record<string, unknown> = promptSeed && typeof promptSeed === "object" ? { ...(promptSeed as Record<string, unknown>) } : {};
      opts.evidenceSubstrate = evidenceSubstrate;
      singularityPrompt = ConciergeService.buildConciergePrompt(userMessage, opts);
    } else if (options?.frozenSingularityPrompt) {
      singularityPrompt = options.frozenSingularityPrompt;
    } else if (payload.conciergePrompt && typeof payload.conciergePrompt === "string") {
      singularityPrompt = payload.conciergePrompt;
    } else if (ConciergeService.buildConciergePrompt) {
      const userMessage = payload.originalPrompt;
      const opts: Record<string, unknown> = promptSeed && typeof promptSeed === "object" ? { ...(promptSeed as Record<string, unknown>) } : {};
      singularityPrompt = ConciergeService.buildConciergePrompt(userMessage, opts);
    }

    if (!singularityPrompt) {
      throw new Error("Could not determine or build Singularity prompt.");
    }

    const parseSingularityOutput = (text: string): SingularityParsedOutput => {
      const rawText = String(text || "");

      let cleanedText = rawText;
      let signal: unknown = null;

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
      let leakageViolations: string[] = [];

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
        prompt: singularityPrompt!,
        leakageDetected,
        leakageViolations,
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
      step as unknown as { stepId: string; payload: Record<string, unknown> }, context, payload.singularityProvider, singularityPrompt, "Singularity", { ...options, contextRole: "singularity" },
      parseSingularityOutput
    );
  }

}

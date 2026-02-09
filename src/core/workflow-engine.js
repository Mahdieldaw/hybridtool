import { getHealthTracker } from './provider-health-tracker.js';
import { StepExecutor } from './execution/StepExecutor';
import { StreamingManager } from './execution/StreamingManager';
import { ContextManager } from './execution/ContextManager';
import { PersistenceCoordinator } from './execution/PersistenceCoordinator';
import { TurnEmitter } from './execution/TurnEmitter';
import { CognitivePipelineHandler } from './execution/CognitivePipelineHandler';
import { parseMapperArtifact } from '../../shared/parsing-utils';
import { buildCognitiveArtifact } from '../../shared/cognitive-artifact';
import { classifyError } from './error-classifier';

export class WorkflowEngine {
  /* _options: Reserved for future configuration or interface compatibility */
  constructor(orchestrator, sessionManager, port, _options = {}) {
    this.orchestrator = orchestrator;
    this.sessionManager = sessionManager;
    this.port = port;

    // Services
    // MapperService and ResponseProcessor removed; new pipeline and provider adapters handle mapping and normalization.
    // (legacy mapperService and responseProcessor support removed)
    this.healthTracker = getHealthTracker();

    // Components
    this.stepExecutor = new StepExecutor(
      orchestrator,
      this.healthTracker
    );
    this.streamingManager = new StreamingManager(port);
    this.contextManager = new ContextManager(sessionManager);
    this.persistenceCoordinator = new PersistenceCoordinator(sessionManager);
    this.turnEmitter = new TurnEmitter(port);
    this.cognitiveHandler = new CognitivePipelineHandler(port, this.persistenceCoordinator, sessionManager);

    // Executor mapping - FOUNDATION ONLY
    // Singularity/Concierge steps are handled via handleContinueCognitiveRequest
    this._executors = {
      prompt: (step, ctx, _results, _wfCtx, _resolved, opts) =>
        this.stepExecutor.executePromptStep(step, ctx, opts),
      mapping: (step, ctx, results, wfCtx, _resolved, opts) =>
        this.stepExecutor.executeMappingStep(step, ctx, results, wfCtx, opts),
      singularity: (step, ctx, results, _wfCtx, resolved, _opts) =>
        this.cognitiveHandler.orchestrateSingularityPhase(
          this.currentRequest || {},
          ctx,
          [step],
          results,
          resolved,
          this.currentUserMessage || ctx?.userMessage || "",
          this.stepExecutor,
          this.streamingManager
        ),
    };

    // Provider key mapping for upsert
    this._providerKeys = {
      prompt: null,
      mapping: 'mappingProvider',
    };
  }

  async execute(request, resolvedContext) {
    this.currentRequest = request;
    const { context, steps } = request;
    const stepResults = new Map();
    const workflowContexts = {};

    this.currentUserMessage =
      context?.userMessage ||
      request?.context?.userMessage ||
      this.currentUserMessage ||
      "";

    if (!this.currentUserMessage?.trim()) {
      console.error("[WorkflowEngine] CRITICAL: execute() with empty userMessage!");
      return;
    }

    if (!context.sessionId || context.sessionId === "new-session") {
      context.sessionId =
        context.sessionId && context.sessionId !== "new-session"
          ? context.sessionId
          : `sid-${Date.now()}`;
    }

    try {
      try {
        await this._persistCheckpoint(request, context, resolvedContext);
      } catch (e) {
        console.warn("[WorkflowEngine] Checkpoint persistence failed (non-blocking):", e);
      }
      // VALIDATION: Ensure only foundation/singularity steps are present in the main loop
      const invalidSteps = steps.filter(s => !['prompt', 'mapping', 'singularity'].includes(s.type));
      if (invalidSteps.length > 0) {
        throw new Error(`Foundation phase received unsupported steps: ${invalidSteps.map(s => s.type).join(', ')}.`);
      }

      this._seedContexts(resolvedContext, stepResults, workflowContexts);
      this._hydrateV1Artifacts(context, resolvedContext);

      // ✅ SINGLE LOOP - Steps are already ordered by WorkflowCompiler
      for (const step of steps) {
        // Execute the step
        const result = await this._executeStep(
          step, context, stepResults, workflowContexts, resolvedContext
        );

        // Check for halt conditions
        const haltReason = await this._checkHaltConditions(
          step, result, request, context, steps, stepResults, resolvedContext
        );

        if (haltReason) {
          if (haltReason === "awaiting_traversal") {
            this.port.postMessage({
              type: "WORKFLOW_COMPLETE",
              sessionId: context.sessionId,
              workflowId: request.workflowId,
              finalResults: Object.fromEntries(stepResults),
              haltReason,
            });
            return;
          } else {
            await this._haltWorkflow(request, context, steps, stepResults, resolvedContext, haltReason);
            return;
          }
        }
      }

      // All steps completed successfully
      await this._persistAndFinalize(request, context, steps, stepResults, resolvedContext);

    } catch (error) {
      const criticalMessage = error instanceof Error ? error.message : String(error);
      console.error(`[WorkflowEngine] Critical workflow execution error:`, error);
      let finalized = false;
      try {
        await this._persistAndFinalize(request, context, steps, stepResults, resolvedContext);
        finalized = true;
      } catch (persistError) {
        const persistMessage =
          persistError instanceof Error ? persistError.message : String(persistError);
        if (context?.canonicalAiTurnId && this.sessionManager?.adapter) {
          try {
            const adapter = this.sessionManager.adapter;
            const pipelineError =
              [criticalMessage, persistMessage].filter(Boolean).join(' | ') || 'Pipeline failed';

            if (typeof adapter.update === "function") {
              await adapter.update("turns", context.canonicalAiTurnId, (turn) => {
                if (!turn) return turn;
                return {
                  ...turn,
                  pipelineStatus: "error",
                  meta: {
                    ...(turn.meta || {}),
                    pipelineError,
                  },
                };
              });
            } else {
              const maxAttempts = 3;
              for (let attempt = 0; attempt < maxAttempts; attempt++) {
                if (attempt > 0) {
                  // Exponential backoff: 50ms, 100ms, 200ms
                  await new Promise(resolve => setTimeout(resolve, 50 * Math.pow(2, attempt - 1)));
                }

                try {
                  const turn = await adapter.get("turns", context.canonicalAiTurnId);
                  if (!turn) break;

                  const updated = {
                    ...turn,
                    pipelineStatus: "error",
                    meta: {
                      ...(turn.meta || {}),
                      pipelineError,
                    },
                  };

                  await adapter.put("turns", updated);
                  break;
                } catch (retryError) {
                  const isLast = attempt === maxAttempts - 1;
                  console.error(
                    `[WorkflowEngine] Failed to mark turn as errored (attempt ${attempt + 1}/${maxAttempts}):`,
                    retryError,
                  );

                  if (isLast) {
                    console.error(
                      `[WorkflowEngine] CRITICAL: Could not mark turn ${context.canonicalAiTurnId} as errored after ${maxAttempts} attempts. Last error:`,
                      retryError
                    );
                    // We don't throw here to avoid crashing the whole process loop if possible, 
                    // but the error state is lost in persistence.
                  }
                }
              }
            }
          } catch (markError) {
            console.error('[WorkflowEngine] Failed to mark turn as errored:', markError);
          }
        }
      }
      if (!finalized) {
        this.port.postMessage({
          type: "WORKFLOW_COMPLETE",
          sessionId: context.sessionId,
          workflowId: request.workflowId,
          error: "A critical error occurred.",
        });
      }
    } finally {
      this.streamingManager.clearCache(context?.sessionId);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UNIFIED STEP EXECUTION
  // ═══════════════════════════════════════════════════════════════════════════

  async _executeStep(step, context, stepResults, workflowContexts, resolvedContext) {
    const executor = this._executors[step.type];
    if (!executor) {
      throw new Error(`Unknown step type: ${step.type}`);
    }

    const options = this._buildOptionsForStep(step.type);
    options.isRecompute = resolvedContext?.type === "recompute";

    try {
      const result = await executor(step, context, stepResults, workflowContexts, resolvedContext, options);

      stepResults.set(step.stepId, { status: "completed", result });

      if (step.type?.includes('mapping')) {
        console.log('🚨 MAPPING RESULT STRUCTURE:', {
          resultKeys: Object.keys(result || {}),
          hasMappingArtifact: !!result?.mapping?.artifact,
        });
      }
      this._emitStepUpdate(step, context, result, resolvedContext, "completed");

      if (step.type === 'prompt' && result?.results) {
        Object.entries(result.results).forEach(([pid, data]) => {
          if (data?.meta && Object.keys(data.meta).length > 0) {
            workflowContexts[pid] = data.meta;
          }
        });
      }

      if (step.type === 'mapping') {
        const mappingArtifact = result?.mapping?.artifact;
        if (mappingArtifact) {
          context.mappingArtifact = mappingArtifact;
        }
      }

      await this._persistStepResponse(step, context, result, resolvedContext);

      return result;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const classified = classifyError(error);
      stepResults.set(step.stepId, { status: "failed", error: classified });
      this._emitStepUpdate(
        step,
        context,
        { error: classified?.message || errorMessage },
        resolvedContext,
        "failed",
      );
      throw error;
    }
  }

  _buildOptionsForStep(stepType) {
    const baseOptions = {
      streamingManager: this.streamingManager,
      persistenceCoordinator: this.persistenceCoordinator,
      sessionManager: this.sessionManager,
    };

    if (stepType === 'mapping') {
      baseOptions.contextManager = this.contextManager;
    }
    // Note: refiner/antagonist options setup kept generic or handled in CognitivePipelineHandler if needed,
    // but here we are strictly Foundation phase.

    return baseOptions;
  }

  async _persistStepResponse(step, context, result, resolvedContext) {
    if (step.type === 'prompt') {
      const aiTurnId = context?.canonicalAiTurnId;
      if (!aiTurnId) return;

      const resultsObj = result?.results || {};
      const entries = Object.entries(resultsObj);
      if (entries.length === 0) return;

      await Promise.all(entries.map(async ([providerId, r]) => {
        if (!providerId) return;
        try {
          await this.persistenceCoordinator.upsertProviderResponse(
            context.sessionId,
            aiTurnId,
            String(providerId),
            "batch",
            0,
            {
              text: r?.text || "",
              status: r?.status || "completed",
              meta: r?.meta || {},
            },
          );
        } catch (err) {
          console.warn(`[WorkflowEngine] Failed to persist prompt response for provider ${providerId}:`, err);
        }
      }));

      return;
    }

    const providerKey = this._providerKeys[step.type];
    if (!providerKey) return;

    const aiTurnId = context?.canonicalAiTurnId;
    const providerId = step?.payload?.[providerKey];

    if (aiTurnId && providerId) {
      try {
        await this.persistenceCoordinator.upsertProviderResponse(
          context.sessionId,
          aiTurnId,
          providerId,
          step.type,
          0,
          {
            text: result?.text || "",
            status: result?.status || "completed",
            meta: result?.meta || {},
          }
        );
      } catch (_) { }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CONTROL FLOW
  // ═══════════════════════════════════════════════════════════════════════════

  async _checkHaltConditions(step, result, request, context, steps, stepResults, resolvedContext) {
    if (step.type === 'prompt') {
      const resultsObj = result?.results || {};
      const successfulCount = Object.values(resultsObj).filter(r => r.status === 'completed').length;
      const mappingPlanned = Array.isArray(steps) && steps.some(s => s && s.type === 'mapping');
      if (mappingPlanned && resolvedContext?.type !== 'recompute' && successfulCount < 2) {
        return "insufficient_witnesses";
      }
    }

    if (step.type === 'mapping') {
      const orchestrationResult = await this.cognitiveHandler.orchestrateSingularityPhase(
        request,
        context,
        steps,
        stepResults,
        resolvedContext,
        this.currentUserMessage,
        this.stepExecutor,
        this.streamingManager,
      );
      if (orchestrationResult === "awaiting_traversal") {
        return "awaiting_traversal";
      }
      if (orchestrationResult) {
        return "singularity_orchestration_complete";
      }
    }

    if (step.type === "singularity" && result === "awaiting_traversal") {
      return "awaiting_traversal";
    }

    return null;
  }

  async _haltWorkflow(request, context, steps, stepResults, resolvedContext, haltReason) {

    await this._persistAndFinalize(request, context, steps, stepResults, resolvedContext);

    this.port.postMessage({
      type: "WORKFLOW_COMPLETE",
      sessionId: context.sessionId,
      workflowId: request.workflowId,
      finalResults: Object.fromEntries(stepResults),
      haltReason,
    });
  }

  // --- HELPERS ---

  _seedContexts(resolvedContext, stepResults, workflowContexts) {
    if (resolvedContext && resolvedContext.type === "recompute") {
      console.log("[WorkflowEngine] Seeding frozen batch outputs for recompute");
      try {
        stepResults.set("batch", {
          status: "completed",
          result: { results: resolvedContext.frozenBatchOutputs },
        });
      } catch (e) {
        console.warn("[WorkflowEngine] Failed to seed frozen batch outputs:", e);
      }

      try {
        Object.entries(resolvedContext.providerContextsAtSourceTurn || {}).forEach(([pid, ctx]) => {
          if (ctx && typeof ctx === "object") {
            workflowContexts[pid] = ctx;
          }
        });
      } catch (e) {
        console.warn("[WorkflowEngine] Failed to cache historical provider contexts:", e);
      }
    }

    if (resolvedContext && resolvedContext.type === "extend") {
      try {
        const ctxs = resolvedContext.providerContexts || {};
        const cachedProviders = [];
        Object.entries(ctxs).forEach(([pid, meta]) => {
          if (meta && typeof meta === "object" && Object.keys(meta).length > 0) {
            workflowContexts[pid] = meta;
            cachedProviders.push(pid);
          }
        });
        if (cachedProviders.length > 0) {
          console.log(`[WorkflowEngine] Pre-cached contexts from ResolvedContext.extend for providers: ${cachedProviders.join(", ")}`);
        }
      } catch (e) {
        console.warn("[WorkflowEngine] Failed to cache provider contexts from extend:", e);
      }
    }
  }

  _hydrateV1Artifacts(context, resolvedContext) {
    if (!context.mappingArtifact) {
      try {
        const previousOutputs = resolvedContext?.providerContexts || {};
        const v1MappingText = Object.values(previousOutputs)
          .map(ctx => ctx?.text || "")
          .find(text => text.includes("<mapping_output>") || text.includes("<decision_map>"));

        if (v1MappingText) {
          const mapperArtifact = parseMapperArtifact(v1MappingText);
          context.mappingArtifact = buildCognitiveArtifact(mapperArtifact, null);
        }
      } catch (err) {
        console.warn("[WorkflowEngine] Cross-version hydration failed:", err);
      }
    }
  }

  _emitStepUpdate(step, context, result, resolvedContext, status) {
    this.port.postMessage({
      type: "WORKFLOW_STEP_UPDATE",
      sessionId: context.sessionId,
      stepId: step.stepId,
      status: status,
      result: status === 'completed' ? result : undefined,
      error: status === 'failed' ? result.error : undefined,
      isRecompute: resolvedContext?.type === "recompute",
      sourceTurnId: resolvedContext?.sourceTurnId,
    });
  }

  async _persistAndFinalize(request, context, steps, stepResults, resolvedContext) {
    const result = this.persistenceCoordinator.buildPersistenceResultFromStepResults(
      steps,
      stepResults
    );

    const batchPhase = Object.keys(result.batchOutputs || {}).length > 0
      ? {
        responses: Object.fromEntries(
          Object.entries(result.batchOutputs).map(([pid, data]) => [
            pid,
            {
              text: data.text || "",
              modelIndex: data.meta?.modelIndex ?? 0,
              status: data.status || "completed",
              meta: data.meta,
            },
          ])
        ),
      }
      : undefined;

    const cognitiveArtifact = context?.mappingArtifact || null;
    const mappingPhase = cognitiveArtifact ? { artifact: cognitiveArtifact } : undefined;
    const singularity = context?.singularityData || context?.singularityOutput;
    const singularityPhase = singularity
      ? {
        prompt: singularity?.prompt || "",
        output: singularity?.output || singularity?.text || "",
        traversalState: context.traversalState,
      }
      : undefined;


    const persistRequest = {
      type: resolvedContext?.type || "unknown",
      sessionId: context.sessionId,
      userMessage: this.currentUserMessage,
      storedAnalysis: context?.storedAnalysis,
      runId: context?.runId || request?.context?.runId,
      batch: batchPhase,
      mapping: mappingPhase,
      singularity: singularityPhase,
    };
    if (resolvedContext?.type === "recompute") {
      persistRequest.sourceTurnId = resolvedContext.sourceTurnId;
      persistRequest.stepType = resolvedContext.stepType;
      persistRequest.targetProvider = resolvedContext.targetProvider;
    }
    if (context?.canonicalUserTurnId)
      persistRequest.canonicalUserTurnId = context.canonicalUserTurnId;
    if (context?.canonicalAiTurnId)
      persistRequest.canonicalAiTurnId = context.canonicalAiTurnId;

    console.log(
      `[WorkflowEngine] Persisting (consolidated) ${persistRequest.type} workflow to SessionManager`,
    );

    const persistResult = await this.persistenceCoordinator.persistWorkflowResult(
      persistRequest,
      resolvedContext,
      result
    );

    if (persistResult) {
      if (persistResult.userTurnId)
        context.canonicalUserTurnId = persistResult.userTurnId;
      if (persistResult.aiTurnId)
        context.canonicalAiTurnId = persistResult.aiTurnId;
      if (resolvedContext?.type === "initialize" && persistResult.sessionId) {
        context.sessionId = persistResult.sessionId;
        console.log(
          `[WorkflowEngine] Initialize complete: session=${persistResult.sessionId}`,
        );
      }
    }

    this.port.postMessage({
      type: "WORKFLOW_COMPLETE",
      sessionId: context.sessionId,
      workflowId: request.workflowId,
      finalResults: Object.fromEntries(stepResults),
    });

    this.turnEmitter.emitTurnFinalized(context, steps, stepResults, resolvedContext, this.currentUserMessage);
  }

  async _persistCheckpoint(request, context, resolvedContext) {
    if (!resolvedContext || resolvedContext.type === "recompute") return;
    if (!context?.canonicalUserTurnId || !context?.canonicalAiTurnId) return;

    await this.persistenceCoordinator.persistWorkflowResult(
      {
        type: resolvedContext.type,
        sessionId: context.sessionId,
        userMessage: this.currentUserMessage,
        canonicalUserTurnId: context.canonicalUserTurnId,
        canonicalAiTurnId: context.canonicalAiTurnId,
        partial: true,
        pipelineStatus: "in_progress",
        runId: context?.runId || request?.context?.runId,
      },
      resolvedContext,
      { batchOutputs: {}, mappingOutputs: {}, singularityOutputs: {} },
    );
  }

  async handleRetryRequest(message) {
    try {
      const { sessionId, aiTurnId, providerIds, retryScope } = message || {};
      console.log(`[WorkflowEngine] Retry requested for providers = ${(providerIds || []).join(', ')} scope = ${retryScope} `);

      try {
        (providerIds || []).forEach((pid) => this.healthTracker.resetCircuit(pid));
      } catch (_) { }

      try {
        this.port.postMessage({
          type: 'WORKFLOW_PROGRESS',
          sessionId: sessionId,
          aiTurnId: aiTurnId,
          phase: retryScope || 'batch',
          providerStatuses: (providerIds || []).map((id) => ({ providerId: id, status: 'queued', progress: 0 })),
          completedCount: 0,
          totalCount: (providerIds || []).length,
        });
      } catch (_) { }
    } catch (e) {
      console.warn('[WorkflowEngine] handleRetryRequest failed:', e);
    }
  }

  async handleContinueCognitiveRequest(payload) {
    return this.cognitiveHandler.handleContinueRequest(
      payload,
      this.stepExecutor,
      this.streamingManager,
      this.contextManager
    );
  }
}

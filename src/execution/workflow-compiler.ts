// src/core/workflow-compiler.js - PHASE 3 COMPLETE
/**
 * WorkflowCompiler - PURE FUNCTION
 *
 * Phase 3 completion: Zero database access, fully synchronous.
 * All data comes from ResolvedContext parameter.
 */
import { DEFAULT_THREAD } from '../../shared/messaging';
import type { PrimitiveWorkflowRequest, ResolvedContext } from '../../shared/types/contract';

export class WorkflowCompiler {
  private defaults: { mapper: string | null };

  constructor(_sessionManager: unknown) {
    this.defaults = {
      mapper: null,
    };
  }

  /**
   * PURE COMPILE: Primitive + Context → Workflow Steps
   *
   * @param {Object} request - Initialize/Extend/Recompute primitive
   * @param {Object} resolvedContext - REQUIRED from ContextResolver
   * @returns {Object} Executable workflow
   */
  compile(request: PrimitiveWorkflowRequest, resolvedContext: ResolvedContext) {
    if (!resolvedContext) {
      throw new Error('[Compiler] resolvedContext required');
    }

    this._validateRequest(request);
    this._validateContext(resolvedContext);

    const compileRequest = this._applyBatchGating(request);

    const workflowId = this._generateWorkflowId(resolvedContext.type);
    const steps = [];
    // Track created step IDs to ensure correct linkage
    let batchStepId: string | undefined;

    console.log(`[Compiler] Compiling ${resolvedContext.type} workflow`);

    // ========================================================================
    // STEP GENERATION: Based on primitive request
    // ========================================================================
    switch (resolvedContext.type) {
      case 'initialize':
        // Initialize ALWAYS runs full batch if providers specified
        if (compileRequest.providers && compileRequest.providers.length > 0) {
          const batchStep = this._createBatchStep(compileRequest, resolvedContext);
          steps.push(batchStep);
          batchStepId = batchStep.stepId;
        }
        break;

      case 'extend': {
        // Singularity-only: user selected only the singularity provider via council orbs
        const isSingularityOnly =
          compileRequest.singularity &&
          Array.isArray(compileRequest.providers) &&
          compileRequest.providers.length === 1 &&
          compileRequest.providers[0] === compileRequest.singularity;

        if (isSingularityOnly) {
          console.log('[Compiler] Singularity-only extend: direct routing');
          const singularityStep = {
            stepId: `singularity-direct-${Date.now()}`,
            type: 'singularity',
            payload: {
              singularityProvider: compileRequest.singularity,
              originalPrompt: compileRequest.userMessage,
              // Note: mapperArtifact will be resolved from context in CognitivePipelineHandler
              useThinking: !!compileRequest.useThinking,
            },
          };
          steps.push(singularityStep);
        } else if (compileRequest.providers && compileRequest.providers.length > 0) {
          // Normal extend: generate batch step
          const batchStep = this._createBatchStep(compileRequest, resolvedContext);
          steps.push(batchStep);
          batchStepId = batchStep.stepId;
        }
        break;
      }

      case 'recompute':
        if (resolvedContext.stepType === 'batch') {
          // Generate a single-provider prompt step targeting the provider being retried
          const provider = resolvedContext.targetProvider;
          const stepId = `batch-retry-${Date.now()}`;
          // Normalize provider context shape
          const rawCtx = resolvedContext.providerContextsAtSourceTurn
            ? resolvedContext.providerContextsAtSourceTurn[provider]
            : undefined;
          const rawCtxObj = rawCtx as Record<string, unknown> | undefined;
          const meta = rawCtxObj && rawCtxObj.meta ? rawCtxObj.meta : rawCtxObj;
          const providerContexts = meta
            ? { [provider]: { meta, continueThread: true } }
            : undefined;
          const batchStep = {
            stepId,
            type: 'prompt',
            payload: {
              prompt: resolvedContext.sourceUserMessage,
              providers: [provider],
              providerContexts,
              useThinking: !!request.useThinking,
            },
          };
          steps.push(batchStep);
          batchStepId = stepId;
        } else {
          console.log('[Compiler] Recompute: Skipping batch (frozen outputs)');
        }
        break;
    }

    const singularityExplicitlyDisabled =
      Object.prototype.hasOwnProperty.call(compileRequest || {}, 'singularity') &&
      !compileRequest.singularity;

    // Mapping step, followed by singularity
    if (this._needsMappingStep(compileRequest, resolvedContext)) {
      const mappingStep = this._createMappingStep(compileRequest, resolvedContext, {
        batchStepId,
      });
      steps.push(mappingStep);

      if (!singularityExplicitlyDisabled) {
        steps.push({
          stepId: `singularity-${Date.now()}`,
          type: 'singularity',
          payload: {
            singularityProvider: compileRequest.singularity || null,
            originalPrompt: compileRequest.userMessage || (resolvedContext as any).sourceUserMessage,
            useThinking: !!compileRequest.useThinking,
          },
        });
      }
    }

    const workflowContext = this._buildWorkflowContext(compileRequest, resolvedContext);

    console.log(`[Compiler] Generated ${steps.length} steps`);

    return {
      workflowId,
      context: workflowContext,
      steps,
      singularity: (request as any).singularity,
    };
  }

  // ============================================================================
  // STEP CREATORS (Pure)
  // ============================================================================

  _createBatchStep(request: any, context: any) {
    return {
      stepId: `batch-${Date.now()}`,
      type: 'prompt',
      payload: {
        prompt: request.userMessage,
        providers: request.providers,
        providerContexts: context.type === 'extend' ? context.providerContexts : undefined,
        previousContext: context.previousContext || null,
        previousAnalysis: context.previousAnalysis || null,
        providerMeta: request.providerMeta || {},
        useThinking: !!request.useThinking,
        embeddingModelId: request.embeddingModelId,
      },
    };
  }

  _createMappingStep(request: any, context: any, linkIds: { batchStepId?: string } = {}) {
    // Include provider in stepId so UI can derive provider on failure without result payload
    const mappingProviderId =
      context.type === 'recompute'
        ? context.targetProvider
        : request.mapper || this._getDefaultMapper(request);
    const mappingStepId = `mapping-${mappingProviderId}-${Date.now()}`;

    if (context.type === 'recompute') {
      return {
        stepId: mappingStepId,
        type: 'mapping',
        payload: {
          mappingProvider: context.targetProvider,
          sourceHistorical: {
            turnId: context.sourceTurnId,
            responseType: 'batch',
          },
          originalPrompt: context.sourceUserMessage,
          useThinking: !!request.useThinking,
          attemptNumber: 1,
          embeddingModelId: request.embeddingModelId,
        },
      };
    }

    // Use mapper from primitive
    const mapper = mappingProviderId;

    return {
      stepId: mappingStepId,
      type: 'mapping',
      payload: {
        mappingProvider: mapper,
        sourceStepIds: linkIds.batchStepId ? [linkIds.batchStepId] : undefined,
        providerOrder: Array.isArray(request.providers) ? request.providers.slice() : undefined,
        originalPrompt: request.userMessage,
        useThinking: !!request.useThinking && mapper === 'chatgpt',
        attemptNumber: 1,
        embeddingModelId: request.embeddingModelId,
      },
    };
  }

  // ============================================================================
  // DECISION LOGIC (Pure)
  // ============================================================================

  _needsMappingStep(request: any, context: any) {
    if (context.type === 'recompute') {
      return context.stepType === 'mapping';
    }
    // Check primitive property
    if (!request || !request.includeMapping) return false;
    const providers = Array.isArray(request.providers) ? request.providers : [];
    return providers.length >= 2;
  }

  _applyBatchGating(request: any) {
    // No-op: gating is now fully controlled by provider selection in the UI.
    // The providers array already reflects the user's council orb choices.
    return request;
  }

  // ============================================================================
  // CONTEXT BUILDER (Pure)
  // ============================================================================

  _buildWorkflowContext(request: any, context: any) {
    let sessionId;
    let sessionCreated = false;

    switch (context.type) {
      case 'initialize':
        // Prefer sessionId passed in the primitive (set by ConnectionHandler); fallback to generate
        sessionId =
          request.sessionId || `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        sessionCreated = true;
        break;

      case 'extend':
      case 'recompute':
        sessionId = context.sessionId;
        break;

      default:
        sessionId = 'unknown-session';
    }

    const userMessage =
      context.type === 'recompute' ? context.sourceUserMessage : request.userMessage;

    const workflowControl =
      request?.workflowControl && typeof request.workflowControl === 'object'
        ? { ...request.workflowControl }
        : undefined;

    return {
      sessionId,
      threadId: DEFAULT_THREAD,
      targetUserTurnId: context.type === 'recompute' ? context.sourceTurnId : '',
      sessionCreated,
      userMessage,
      workflowControl,
    };
  }

  // ============================================================================
  // UTILITIES (Pure)
  // ============================================================================

  _getDefaultMapper(request: any) {
    return request.providers?.[0] || this.defaults.mapper;
  }

  _generateWorkflowId(contextType: any) {
    return `wf-${contextType}-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }

  // ============================================================================
  // VALIDATION
  // ============================================================================

  _validateRequest(request: any) {
    if (!request?.type) throw new Error('[Compiler] Request type required');

    const validTypes = ['initialize', 'extend', 'recompute'];
    if (!validTypes.includes(request.type)) {
      throw new Error(`[Compiler] Invalid type: ${request.type}`);
    }

    // Type-specific validation
    switch (request.type) {
      case 'initialize':
        if (!request.userMessage?.trim())
          throw new Error('[Compiler] Initialize: userMessage required');
        if (!request.providers?.length)
          throw new Error('[Compiler] Initialize: providers required');
        break;

      case 'extend':
        if (!request.sessionId) throw new Error('[Compiler] Extend: sessionId required');
        if (!request.userMessage?.trim())
          throw new Error('[Compiler] Extend: userMessage required');
        if (!request.providers?.length) throw new Error('[Compiler] Extend: providers required');
        break;

      case 'recompute':
        if (!request.sessionId) throw new Error('[Compiler] Recompute: sessionId required');
        if (!request.sourceTurnId) throw new Error('[Compiler] Recompute: sourceTurnId required');
        if (!request.stepType) throw new Error('[Compiler] Recompute: stepType required');
        if (!request.targetProvider)
          throw new Error('[Compiler] Recompute: targetProvider required');
        if (!['batch', 'mapping'].includes(request.stepType)) {
          throw new Error(
            `[Compiler] Recompute: unsupported stepType '${request.stepType}' for foundation compiler`
          );
        }
        break;
    }
  }

  _validateContext(context: any) {
    if (!context?.type) throw new Error('[Compiler] Context type required');

    const validTypes = ['initialize', 'extend', 'recompute'];
    if (!validTypes.includes(context.type)) {
      throw new Error(`[Compiler] Invalid context type: ${context.type}`);
    }

    switch (context.type) {
      case 'initialize': {
        // initialize has no additional required fields in context
        break;
      }
      case 'extend': {
        if (!context.sessionId) throw new Error('[Compiler] Extend: sessionId required');
        if (!context.lastTurnId) throw new Error('[Compiler] Extend: lastTurnId required');
        if (!context.providerContexts)
          throw new Error('[Compiler] Extend: providerContexts required');
        break;
      }
      case 'recompute': {
        if (!context.sessionId) throw new Error('[Compiler] Recompute: sessionId required');
        if (!context.sourceTurnId) throw new Error('[Compiler] Recompute: sourceTurnId required');
        if (!context.stepType) throw new Error('[Compiler] Recompute: stepType required');
        if (!context.targetProvider)
          throw new Error('[Compiler] Recompute: targetProvider required');
        // Only require frozenBatchOutputs for non-batch historical recomputes
        if (context.stepType !== 'batch' && !context.frozenBatchOutputs) {
          throw new Error(
            '[Compiler] Recompute: frozenBatchOutputs required for non-batch recompute'
          );
        }
        break;
      }
    }
  }
}

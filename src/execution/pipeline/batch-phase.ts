import { ArtifactProcessor } from '../../../shared/artifact-processor';
import { PROVIDER_LIMITS } from '../../../shared/provider-limits';
import { classifyError } from '../../errors/classifier';
import { logRetryEvent } from '../../errors/retry';
import { buildReactiveBridge } from '../utils/reactive-bridge';
import { PROMPT_TEMPLATES } from '../utils/prompt-templates.js';
import { isProviderAuthError, createMultiProviderAuthError } from '../../errors/handler';
import type { 
  WorkflowStep, 
  WorkflowContext, 
  ProviderKey, 
  ProviderStatus 
} from '../../../shared/types';

interface BatchPhaseOptions {
  streamingManager: any;
  orchestrator: any;
  healthTracker: any;
  persistenceCoordinator: any;
  [key: string]: any;
}

const WORKFLOW_DEBUG = false;
const wdbg = (...args: any[]) => {
  if (WORKFLOW_DEBUG) console.log(...args);
};

export async function executeBatchPhase(
  step: WorkflowStep, 
  context: WorkflowContext, 
  options: BatchPhaseOptions
) {
  const { streamingManager, orchestrator, healthTracker } = options;
  const artifactProcessor = new ArtifactProcessor();
  const { prompt, providers, useThinking, providerContexts, previousContext } = step.payload;

  let enhancedPrompt = prompt;
  let bridgeContext = '';

  // Reactive Bridge Injection (Priority 1)
  if (step.payload.previousAnalysis) {
    try {
      const bridge = buildReactiveBridge(prompt, step.payload.previousAnalysis);
      if (bridge) {
        bridgeContext = bridge.context;
        console.log(
          `[StepExecutor] Injected reactive bridge context: ${bridge.matched.map((m: any) => m.label).join(', ')}`
        );
      }
    } catch (err) {
      console.warn('[StepExecutor] Failed to build reactive bridge:', err);
    }
  }

  if (previousContext && bridgeContext) {
    enhancedPrompt = PROMPT_TEMPLATES.withBridgeAndPrior(prompt, bridgeContext, previousContext);
  } else if (previousContext) {
    enhancedPrompt = PROMPT_TEMPLATES.withPriorOnly(prompt, previousContext);
  } else if (bridgeContext) {
    enhancedPrompt = PROMPT_TEMPLATES.withBridgeOnly(prompt, bridgeContext);
  }

  const providerStatuses: ProviderStatus[] = [];
  const activeProviders: ProviderKey[] = [];
  try {
    for (const pid of (providers as ProviderKey[])) {
      const check = healthTracker?.shouldAttempt?.(pid) || { allowed: true };
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
  const allowedProviders: ProviderKey[] = [];
  const skippedProviders: ProviderKey[] = [];
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
            entry.error = {
              type: 'input_too_long',
              message: `Prompt length ${promptLength} exceeds limit for ${pid}`,
              retryable: true,
            };
          } else {
            providerStatuses.push({
              providerId: pid,
              status: 'skipped',
              skippedReason: 'input_too_long',
              error: {
                type: 'input_too_long',
                message: `Prompt length ${promptLength} exceeds limit for ${pid}`,
                retryable: true,
              },
            });
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
      throw new Error(
        `INPUT_TOO_LONG: Prompt length ${promptLength} exceeds limits for all selected providers`
      );
    }
  } catch (e) {
    return Promise.reject(e);
  }

  return new Promise((resolve, reject) => {
    const completedProviders = new Set<ProviderKey>();
    orchestrator.executeParallelFanout(enhancedPrompt, allowedProviders, {
      sessionId: context.sessionId,
      useThinking,
      providerContexts,
      providerMeta: step?.payload?.providerMeta,
      onPartial: (providerId: ProviderKey, chunk: any) => {
        streamingManager.dispatchPartialDelta(
          context.sessionId,
          step.stepId,
          providerId,
          chunk.text,
          'Prompt'
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
      onProviderComplete: (providerId: ProviderKey, resultWrapper: any) => {
        const entry = providerStatuses.find((s) => s.providerId === providerId);

        if (resultWrapper && resultWrapper.status === 'rejected') {
          const err = resultWrapper.reason;
          let classified = classifyError(err);
          try {
            if (!completedProviders.has(providerId)) {
              completedProviders.add(providerId);
              healthTracker?.recordFailure?.(providerId, err);
              logRetryEvent({
                providerId,
                stage: 'batch',
                attempt: 1,
                max: 1,
                errorType: (classified?.type || 'unknown') as any,
                elapsedMs: 0,
                delayMs: classified?.retryAfterMs || 0,
              });
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
            healthTracker?.recordSuccess?.(providerId);
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
      onError: (error: any) => {
        try {
          streamingManager.port.postMessage({
            type: 'WORKFLOW_STEP_UPDATE',
            sessionId: context.sessionId,
            stepId: step.stepId,
            status: 'failed',
            error: error?.message || String(error),
          });
        } catch (_) { }
      },
      onAllComplete: async (results: Map<ProviderKey, any>, errors: Map<ProviderKey, any>) => {
        const batchUpdates: Record<string, any> = {};
        results.forEach((result, providerId) => {
          batchUpdates[providerId] = result;
        });

        // Persist contexts before proceeding — mapping step must read fresh data
        try {
          await options.persistenceCoordinator.persistProviderContexts(
            context.sessionId,
            batchUpdates,
            'batch'
          );
        } catch (err) {
          const providerSummary = Object.keys(batchUpdates).join(', ') || '(none)';
          console.error(
            `[BatchPhase] Persistence failed for session ${context.sessionId} (providers: ${providerSummary}):`,
            err
          );
          reject(
            new Error(
              `[BatchPhase] Failed to persist provider contexts for session ${context.sessionId} ` +
              `(providers: ${providerSummary}): ${err instanceof Error ? err.message : String(err)}`
            )
          );
          return;
        }

        const formattedResults: Record<string, any> = {};
        const authErrors: any[] = [];

        results.forEach((result, providerId) => {
          const processed = artifactProcessor.process(result.text || '');
          formattedResults[providerId] = {
            providerId: providerId,
            text: processed.cleanText,
            status: 'completed',
            meta: result.meta || {},
            artifacts: processed.artifacts,
            ...(result.softError ? { softError: result.softError } : {}),
          };
          try {
            if (!completedProviders.has(providerId)) {
              completedProviders.add(providerId);
              healthTracker?.recordSuccess?.(providerId);
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
          let classified = classifyError(error);
          formattedResults[providerId] = {
            providerId: providerId,
            text: '',
            status: 'failed',
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
              healthTracker?.recordFailure?.(providerId, error);
              logRetryEvent({
                providerId,
                stage: 'batch',
                attempt: 1,
                max: 1,
                errorType: (classified?.type || 'unknown') as any,
                elapsedMs: 0,
                delayMs: classified?.retryAfterMs || 0,
              });
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
          (r) => r.status === 'completed' && r.text && r.text.trim().length > 0
        );

        // ✅ CRITICAL FIX: Ensure skipped/failed providers are included in formattedResults
        providerStatuses.forEach((p) => {
          if (
            (p.status === 'skipped' || p.status === 'failed') &&
            !formattedResults[p.providerId]
          ) {
            formattedResults[p.providerId] = {
              providerId: p.providerId as ProviderKey,
              text: '',
              status: p.status === 'skipped' ? 'skipped' : 'failed', // Map to valid status
              meta: {
                error: (p.error as any)?.message || p.skippedReason || 'Skipped or failed',
                skipped: p.status === 'skipped',
                reason: p.skippedReason,
              },
            };
          }
        });

        if (!hasAnyValidResults) {
          if (authErrors.length > 0 && authErrors.length === errors.size) {
            const providerIds = Array.from(errors.keys());
            reject(
              createMultiProviderAuthError(providerIds, 'Multiple authentication errors occurred.')
            );
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

          reject(new Error('All providers failed or returned empty responses'));
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
              failedProviders: failedProviders.map((p) => ({
                providerId: p.providerId,
                error: p.error,
              })),
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

import { DEFAULT_THREAD } from '../../../shared/messaging';
import { PROVIDER_LIMITS } from '../../../shared/provider-limits';
import { runWithProviderHealth } from '../../providers/health/provider-health-gate';
import { isProviderAuthError, errorHandler } from '../../errors/handler';
import { authManager } from '../../providers/auth-manager';
import type { WorkflowStep, WorkflowContext, ProviderOutput } from '../../../shared/types';
import type { ProviderKey } from '../../../shared/types/provider';
import type { HealthTrackerLike } from '../../providers/health/provider-health-gate';

// ─── Local option/interface shapes inferred from usage ───────────────────────

interface LLMRunnerOptions {
  streamingManager: {
    dispatchPartialDelta: (
      sessionId: string,
      stepId: string,
      providerId: string,
      text: string,
      stepType: string,
      isFinal?: boolean
    ) => void;
    getRecoveredText: (sessionId: string, stepId: string, providerId: string) => string | null;
  };
  persistenceCoordinator: {
    persistProviderContexts: (
      sessionId: string,
      outputs: Record<string, ProviderOutput>,
      contextRole?: string
    ) => Promise<void>;
  };
  sessionManager?: {
    getProviderContexts?: (
      sessionId: string,
      threadId: string,
      opts?: { contextRole?: string }
    ) => Promise<Record<string, { meta?: Record<string, unknown> }> | null>;
  };
  orchestrator: {
    executeParallelFanout: (
      prompt: string,
      providerIds: string[],
      opts: {
        sessionId: string;
        useThinking: boolean;
        providerContexts: Record<string, unknown> | undefined;
        onError: (err: unknown) => void;
        onPartial: (id: string, chunk: { text: string }) => void;
        onAllComplete: (
          results: Map<string, ProviderOutput & { softError?: { message: string } }>,
          errors: Map<string, unknown>
        ) => Promise<void>;
      }
    ) => void;
    registry?: {
      get?: (key: string) => { listProviders?: () => string[] } | undefined;
    };
  };
  healthTracker: HealthTrackerLike | undefined;
  contextRole?: string;
  useThinking?: boolean;
}

/**
 * Generic single-step LLM execution with partial recovery, parse, context persistence,
 * health tracking, and auth fallback. Extracted from singularity-phase.ts.
 */
export async function executeGenericSingleStep(
  step: WorkflowStep,
  context: WorkflowContext,
  providerId: ProviderKey,
  prompt: string,
  stepType: string,
  options: LLMRunnerOptions,
  parseOutputFn: (text: string) => Record<string, unknown> | null
): Promise<ProviderOutput | undefined> {
  const { streamingManager, persistenceCoordinator, sessionManager, orchestrator, healthTracker } =
    options;
  const { payload } = step;

  console.log(`[LLMRunner] ${stepType} prompt for ${providerId}: ${prompt.length} chars`);

  // 1. Check Limits
  const limits = PROVIDER_LIMITS[providerId];
  if (limits && prompt.length > limits.maxInputChars) {
    console.warn(
      `[LLMRunner] ${stepType} prompt length ${prompt.length} exceeds limit ${limits.maxInputChars} for ${providerId}`
    );
    throw new Error(
      `INPUT_TOO_LONG: Prompt length ${prompt.length} exceeds limit ${limits.maxInputChars} for ${providerId}`
    );
  }

  const resolveProviderContextsForPid = async (
    pid: string
  ): Promise<Record<string, unknown> | undefined> => {
    const role = options.contextRole;
    const effectivePid = role ? `${pid}:${role}` : pid;
    const explicit = payload?.providerContexts as Record<string, unknown> | undefined;

    // If we have an explicit context for the scoped ID, use it
    if (explicit && typeof explicit === 'object' && explicit[effectivePid]) {
      const entry = explicit[effectivePid];
      const meta = entry && typeof entry === 'object' && 'meta' in entry ? (entry as Record<string, unknown>).meta : entry;
      const continueThread =
        entry && typeof entry === 'object' && 'continueThread' in entry
          ? (entry as Record<string, unknown>).continueThread
          : true;
      return { [pid]: { meta, continueThread } };
    }

    // Fallback: check for the raw pid (legacy or default)
    if (explicit && typeof explicit === 'object' && explicit[pid]) {
      const entry = explicit[pid];
      const meta = entry && typeof entry === 'object' && 'meta' in entry ? (entry as Record<string, unknown>).meta : entry;
      const continueThread =
        entry && typeof entry === 'object' && 'continueThread' in entry
          ? (entry as Record<string, unknown>).continueThread
          : true;
      return { [pid]: { meta, continueThread } };
    }

    try {
      if (!sessionManager?.getProviderContexts) return undefined;
      // isolation: pass contextRole (e.g. "batch") to get only the scoped thread from DB
      const ctxs = await sessionManager.getProviderContexts(context.sessionId, DEFAULT_THREAD, {
        contextRole: options.contextRole,
      });
      const meta = ctxs?.[pid]?.meta;
      if (meta && typeof meta === 'object' && Object.keys(meta).length > 0) {
        return { [pid]: { meta, continueThread: true } };
      }
    } catch (err) {
      console.warn(
        `[LLMRunner] getProviderContexts failed for session=${context.sessionId} pid=${pid}:`,
        err
      );
    }

    return undefined;
  };

  const runRequest = async (pid: string): Promise<ProviderOutput> => {
    const providerContexts = await resolveProviderContextsForPid(pid);

    return new Promise((resolve, reject) => {
      orchestrator.executeParallelFanout(prompt, [pid], {
        sessionId: context.sessionId,
        useThinking: options.useThinking || (payload?.useThinking as boolean) || false,
        providerContexts,
        onError: (err: unknown) => {
          console.warn(`[LLMRunner] ${stepType} fanout error for ${pid}:`, err);
          reject(err);
        },
        onPartial: (id: string, chunk: { text: string }) => {
          streamingManager.dispatchPartialDelta(
            context.sessionId,
            step.stepId,
            id,
            chunk.text,
            stepType
          );
        },
        onAllComplete: async (
          results: Map<string, ProviderOutput & { softError?: { message: string } }>,
          errors: Map<string, unknown>
        ) => {
          try {
            let finalResult = results.get(pid);
            const providerError = errors?.get?.(pid);

            // 2. Partial Recovery
            if ((!finalResult || !finalResult.text) && providerError) {
              const recovered = streamingManager.getRecoveredText(
                context.sessionId,
                step.stepId,
                pid
              );
              if (recovered && recovered.trim().length > 0) {
                finalResult = finalResult || { providerId: pid, meta: {} };
                finalResult.text = recovered;
                (finalResult as ProviderOutput & { softError?: { message: string } }).softError =
                  (finalResult as ProviderOutput & { softError?: { message: string } }).softError || {
                    message:
                      providerError && typeof providerError === 'object' && 'message' in providerError
                        ? String((providerError as { message: unknown }).message)
                        : String(providerError),
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
                outputData = parseOutputFn(finalResult.text);
                if (outputData && typeof outputData === 'object') {
                  outputData['providerId'] = pid;
                  if (outputData['pipeline'] && typeof outputData['pipeline'] === 'object') {
                    (outputData['pipeline'] as Record<string, unknown>)['providerId'] = pid;
                  }
                }
              } catch (parseErr) {
                console.warn(`[LLMRunner] Output parsing failed for ${stepType}:`, parseErr);
              }

              // Prefer cleaned text from outputData if available
              const canonicalText =
                (outputData &&
                  typeof outputData === 'object' &&
                  (outputData['text'] || outputData['cleanedText'])) ||
                finalResult.text;

              streamingManager.dispatchPartialDelta(
                context.sessionId,
                step.stepId,
                pid,
                canonicalText as string,
                stepType,
                true
              );

              // 4. Persist Context
              await persistenceCoordinator.persistProviderContexts(
                context.sessionId,
                { [pid]: finalResult },
                options.contextRole
              );

              const softError = (finalResult as ProviderOutput & { softError?: { message: string } }).softError;

              resolve({
                providerId: pid,
                text: finalResult.text,
                status: 'completed',
                meta: {
                  ...finalResult.meta,
                  ...(outputData ? { [`${stepType.toLowerCase()}Output`]: outputData } : {}),
                },
                ...(softError ? { softError } : {}),
              } as ProviderOutput);
            } else {
              reject(new Error(`Empty response from ${stepType} provider`));
            }
          } catch (err) {
            reject(err);
          }
        },
      });
    });
  };

  const wrappedRunRequest = (pid: string): Promise<ProviderOutput | undefined> =>
    runWithProviderHealth(healthTracker, pid, stepType, () => runRequest(pid));

  // 5. Auth Fallback Wrapper
  try {
    return await wrappedRunRequest(providerId);
  } catch (error) {
    if (isProviderAuthError(error)) {
      console.warn(
        `[LLMRunner] ${stepType} failed with auth error for ${providerId}, attempting fallback...`
      );
      const fallbackStrategy = errorHandler.fallbackStrategies.get('PROVIDER_AUTH_FAILED');
      if (fallbackStrategy) {
        try {
          const providerRegistry = orchestrator?.registry?.get?.('providerRegistry');
          const availableProviders = providerRegistry?.listProviders?.() || [];
          const fallbackResolution = await fallbackStrategy(stepType.toLowerCase(), {
            failedProvider: providerId,
            availableProviders,
            authManager,
          });
          const fallbackProvider =
            typeof fallbackResolution === 'string'
              ? fallbackResolution
              : (fallbackResolution as Record<string, unknown>)?.['fallbackProvider'];
          if (fallbackProvider) {
            console.log(
              `[LLMRunner] Executing ${stepType} with fallback provider: ${fallbackProvider}`
            );
            return await wrappedRunRequest(fallbackProvider as string);
          }
        } catch (fallbackError) {
          console.warn(`[LLMRunner] Fallback failed: `, fallbackError);
        }
      }
    }
    throw error;
  }
}

// @ts-nocheck
import { DEFAULT_THREAD } from '../../../../shared/messaging.js';
import { PROVIDER_LIMITS } from '../../../../shared/provider-limits.js';
import { runWithProviderHealth } from '../../provider-health-gate.js';
import { isProviderAuthError, errorHandler } from '../../errors/handler.js';
import { authManager } from '../../auth-manager.js';

/**
 * Generic single-step LLM execution with partial recovery, parse, context persistence,
 * health tracking, and auth fallback. Extracted from singularity-phase.ts.
 */
export async function executeGenericSingleStep(
  step,
  context,
  providerId,
  prompt,
  stepType,
  options,
  parseOutputFn
) {
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

  const resolveProviderContextsForPid = async (pid) => {
    const role = options.contextRole;
    const effectivePid = role ? `${pid}:${role}` : pid;
    const explicit = payload?.providerContexts;

    // If we have an explicit context for the scoped ID, use it
    if (explicit && typeof explicit === 'object' && explicit[effectivePid]) {
      const entry = explicit[effectivePid];
      const meta = entry && typeof entry === 'object' && 'meta' in entry ? entry.meta : entry;
      const continueThread =
        entry && typeof entry === 'object' && 'continueThread' in entry
          ? entry.continueThread
          : true;
      return { [pid]: { meta, continueThread } };
    }

    // Fallback: check for the raw pid (legacy or default)
    if (explicit && typeof explicit === 'object' && explicit[pid]) {
      const entry = explicit[pid];
      const meta = entry && typeof entry === 'object' && 'meta' in entry ? entry.meta : entry;
      const continueThread =
        entry && typeof entry === 'object' && 'continueThread' in entry
          ? entry.continueThread
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
    } catch (_) {}

    return undefined;
  };

  const runRequest = async (pid) => {
    const providerContexts = await resolveProviderContextsForPid(pid);

    return new Promise((resolve, reject) => {
      orchestrator.executeParallelFanout(prompt, [pid], {
        sessionId: context.sessionId,
        useThinking: options.useThinking || payload.useThinking || false,
        providerContexts,
        onError: (err) => {
          console.warn(`[LLMRunner] ${stepType} fanout error for ${pid}:`, err);
          reject(err);
        },
        onPartial: (id, chunk) => {
          streamingManager.dispatchPartialDelta(
            context.sessionId,
            step.stepId,
            id,
            chunk.text,
            stepType
          );
        },
        onAllComplete: async (results, errors) => {
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
              if (outputData && typeof outputData === 'object') {
                outputData.providerId = pid;
                if (outputData.pipeline && typeof outputData.pipeline === 'object') {
                  outputData.pipeline.providerId = pid;
                }
              }
            } catch (parseErr) {
              console.warn(`[LLMRunner] Output parsing failed for ${stepType}:`, parseErr);
            }

            // Prefer cleaned text from outputData if available
            const canonicalText =
              (outputData &&
                typeof outputData === 'object' &&
                (outputData.text || outputData.cleanedText)) ||
              finalResult.text;

            streamingManager.dispatchPartialDelta(
              context.sessionId,
              step.stepId,
              pid,
              canonicalText,
              stepType,
              true
            );

            // 4. Persist Context — await so context is in IndexedDB before resolve
            await persistenceCoordinator.persistProviderContexts(
              context.sessionId,
              {
                [pid]: finalResult,
              },
              options.contextRole
            );

            resolve({
              providerId: pid,
              text: finalResult.text,
              status: 'completed',
              meta: {
                ...finalResult.meta,
                ...(outputData ? { [`${stepType.toLowerCase()}Output`]: outputData } : {}),
              },
              output: outputData, // Standardize output access
              ...(finalResult.softError ? { softError: finalResult.softError } : {}),
            });
          } else {
            reject(new Error(`Empty response from ${stepType} provider`));
          }
        },
      });
    });
  };

  const wrappedRunRequest = (pid) =>
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
              : fallbackResolution?.fallbackProvider;
          if (fallbackProvider) {
            console.log(
              `[LLMRunner] Executing ${stepType} with fallback provider: ${fallbackProvider}`
            );
            return await wrappedRunRequest(fallbackProvider);
          }
        } catch (fallbackError) {
          console.warn(`[LLMRunner] Fallback failed: `, fallbackError);
        }
      }
    }
    throw error;
  }
}

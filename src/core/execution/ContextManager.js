import { DEFAULT_THREAD } from '../../../shared/messaging.js';

const WORKFLOW_DEBUG = false;
const wdbg = (...args) => {
  if (WORKFLOW_DEBUG) console.log(...args);
};

export class ContextManager {
  constructor(sessionManager) {
    this.sessionManager = sessionManager;
  }

  /**
   * Resolves provider context using three-tier resolution:
   * 1. Workflow cache context (highest priority)
   * 2. Batch step context (medium priority)
   * 3. Persisted context (fallback)
   */
  async resolveProviderContext(
    providerId,
    context,
    payload,
    workflowContexts,
    previousResults,
    resolvedContext,
    stepType = "step",
  ) {
    const providerContexts = {};

    // Tier 1: Prefer workflow cache context produced within this workflow run
    if (workflowContexts && workflowContexts[providerId]) {
      providerContexts[providerId] = {
        meta: workflowContexts[providerId],
        continueThread: true,
      };
      try {
        wdbg(
          `[ContextManager] ${stepType} using workflow-cached context for ${providerId}: ${Object.keys(
            workflowContexts[providerId],
          ).join(",")}`,
        );
      } catch (_) { }
      return providerContexts;
    }

    // Tier 2: ResolvedContext (for recompute - historical contexts)
    if (resolvedContext && resolvedContext.type === "recompute") {
      const historicalContext =
        resolvedContext.providerContextsAtSourceTurn?.[providerId];
      if (historicalContext) {
        providerContexts[providerId] = {
          meta: historicalContext,
          continueThread: true,
        };
        try {
          wdbg(
            `[ContextManager] ${stepType} using historical context from ResolvedContext for ${providerId}`,
          );
        } catch (_) { }
        return providerContexts;
      }
    }

    // Tier 2: Fallback to batch step context for backwards compatibility
    if (payload.continueFromBatchStep && previousResults) {
      const batchResult = previousResults.get(payload.continueFromBatchStep);
      if (batchResult?.status === "completed" && batchResult.result?.results) {
        const providerResult = batchResult.result.results[providerId];
        if (providerResult?.meta) {
          providerContexts[providerId] = {
            meta: providerResult.meta,
            continueThread: true,
          };
          try {
            wdbg(
              `[ContextManager] ${stepType} continuing conversation for ${providerId} via batch step`,
            );
          } catch (_) { }
          return providerContexts;
        }
      }
    }

    // Tier 3: Last resort use persisted context (may be stale across workflow runs)
    try {
      const persisted = await this.sessionManager.getProviderContexts(
        context.sessionId,
        context.threadId || DEFAULT_THREAD,
      );
      const persistedMeta = persisted?.[providerId]?.meta;
      if (persistedMeta && Object.keys(persistedMeta).length > 0) {
        providerContexts[providerId] = {
          meta: persistedMeta,
          continueThread: true,
        };
        try {
          wdbg(
            `[ContextManager] ${stepType} using persisted context for ${providerId}: ${Object.keys(
              persistedMeta,
            ).join(",")}`,
          );
        } catch (_) { }
        return providerContexts;
      }
    } catch (_) { }

    return providerContexts;
  }
}

import { DEFAULT_THREAD } from '../../../../shared/messaging.js';

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
    stepType = 'step'
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
            workflowContexts[providerId]
          ).join(',')}`
        );
      } catch (_) {}
      return providerContexts;
    }

    // Tier 2: ResolvedContext (for recompute - historical contexts)
    if (resolvedContext && resolvedContext.type === 'recompute') {
      const historicalContext = resolvedContext.providerContextsAtSourceTurn?.[providerId];
      if (historicalContext) {
        providerContexts[providerId] = {
          meta: historicalContext,
          continueThread: true,
        };
        try {
          wdbg(
            `[ContextManager] ${stepType} using historical context from ResolvedContext for ${providerId}`
          );
        } catch (_) {}
        return providerContexts;
      }
    }

    // Tier 2: Fallback to batch step context for backwards compatibility
    if (payload.continueFromBatchStep && previousResults) {
      const batchResult = previousResults.get(payload.continueFromBatchStep);
      if (batchResult?.status === 'completed' && batchResult.result?.results) {
        const providerResult = batchResult.result.results[providerId];
        if (providerResult?.meta) {
          providerContexts[providerId] = {
            meta: providerResult.meta,
            continueThread: true,
          };
          try {
            wdbg(
              `[ContextManager] ${stepType} continuing conversation for ${providerId} via batch step`
            );
          } catch (_) {}
          return providerContexts;
        }
      }
    }

    // Tier 3: Last resort use persisted context (may be stale across workflow runs)
    try {
      const persisted = await this.sessionManager.getProviderContexts(
        context.sessionId,
        context.threadId || DEFAULT_THREAD
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
              persistedMeta
            ).join(',')}`
          );
        } catch (_) {}
        return providerContexts;
      }
    } catch (e) {
      console.warn(
        `[ContextManager] getProviderContexts failed for ${providerId} (session=${context.sessionId}, thread=${context.threadId || DEFAULT_THREAD}):`,
        e
      );
    }

    return providerContexts;
  }

  /**
   * Resolve source data for a mapping step from payload, historical turn, or previous step results.
   * Mirrors _resolveSourceData from mapping-phase — single source of truth for both live and recompute paths.
   */
  async resolveHistoricalSources(payload, context, previousResults) {
    const sessionManager = this.sessionManager;

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
      const { turnId, responseType } = payload.sourceHistorical;
      console.log(`[ContextManager] Resolving historical data from turn: ${turnId}`);

      let aiTurn = null;
      try {
        const adapter = sessionManager?.adapter;
        if (adapter?.isReady && adapter.isReady()) {
          const turn = await adapter.get('turns', turnId);
          if (turn && (turn.type === 'ai' || turn.role === 'assistant')) {
            aiTurn = turn;
          } else if (turn && turn.type === 'user') {
            try {
              const sessionTurns = await adapter.getTurnsBySessionId(context.sessionId);
              if (Array.isArray(sessionTurns)) {
                const userIdx = sessionTurns.findIndex((t) => t.id === turnId);
                if (userIdx !== -1) {
                  const next = sessionTurns[userIdx + 1];
                  if (next && (next.type === 'ai' || next.role === 'assistant')) {
                    aiTurn = next;
                  }
                }
              }
            } catch (ignored) {}
          }
        }
      } catch (e) {
        console.warn('[ContextManager] resolveHistoricalSources adapter lookup failed:', e);
      }

      if (!aiTurn) {
        const fallbackText = context?.userMessage || '';
        if (
          fallbackText &&
          fallbackText.trim().length > 0 &&
          sessionManager?.adapter?.isReady &&
          sessionManager.adapter.isReady()
        ) {
          try {
            const sessionTurns = await sessionManager.adapter.getTurnsBySessionId(
              context.sessionId
            );
            if (Array.isArray(sessionTurns)) {
              for (let i = 0; i < sessionTurns.length; i++) {
                const t = sessionTurns[i];
                if (t && t.type === 'user' && String(t.text || '') === String(fallbackText)) {
                  const next = sessionTurns[i + 1];
                  if (next && next.type === 'ai') {
                    aiTurn = next;
                    break;
                  }
                }
              }
            }
          } catch (e) {
            console.warn(
              `[ContextManager] Could not find corresponding AI turn for ${turnId} (text fallback failed):`,
              e
            );
            aiTurn = null;
          }
        }

        if (!aiTurn) {
          console.warn(`[ContextManager] Could not resolve AI turn for source ${turnId}`);
          return [];
        }
      }

      let sourceContainer;
      switch (responseType) {
        case 'mapping':
          sourceContainer = aiTurn.mappingResponses || {};
          break;
        default:
          sourceContainer = aiTurn.batchResponses || {};
          break;
      }

      const latestMap = new Map();
      Object.keys(sourceContainer).forEach((pid) => {
        const versions = (sourceContainer[pid] || [])
          .filter((r) => r.status === 'completed' && r.text?.trim())
          .sort((a, b) => (b.responseIndex || 0) - (a.responseIndex || 0));
        if (versions.length > 0) {
          latestMap.set(pid, { providerId: pid, text: versions[0].text });
        }
      });

      let sourceArray = Array.from(latestMap.values());

      if (
        sourceArray.length === 0 &&
        sessionManager?.adapter?.isReady &&
        sessionManager.adapter.isReady()
      ) {
        try {
          const responses = await sessionManager.adapter.getResponsesByTurnId(aiTurn.id);
          const respType = responseType || 'batch';
          const dbLatestMap = new Map();
          (responses || [])
            .filter((r) => r?.responseType === respType && r.text?.trim())
            .forEach((r) => {
              const existing = dbLatestMap.get(r.providerId);
              if (!existing || (r.responseIndex || 0) >= (existing.responseIndex || 0)) {
                dbLatestMap.set(r.providerId, r);
              }
            });
          sourceArray = Array.from(dbLatestMap.values()).map((r) => ({
            providerId: r.providerId,
            text: r.text,
          }));
          if (sourceArray.length > 0) {
            console.log(
              '[ContextManager] provider_responses fallback succeeded for historical sources'
            );
          }
        } catch (e) {
          console.warn(
            '[ContextManager] provider_responses fallback failed for historical sources:',
            e
          );
        }
      }

      console.log(`[ContextManager] Found ${sourceArray.length} historical sources`);
      return sourceArray;
    }

    if (payload.sourceStepIds) {
      const sourceArray = [];
      for (const stepId of payload.sourceStepIds) {
        const stepResult = previousResults?.get?.(stepId);
        if (!stepResult || stepResult.status !== 'completed') continue;
        const { results } = stepResult.result;
        Object.entries(results).forEach(([providerId, result]) => {
          if (result.status === 'completed' && result.text && result.text.trim().length > 0) {
            sourceArray.push({ providerId, text: result.text });
          }
        });
      }
      return sourceArray;
    }

    throw new Error('No valid source specified for step.');
  }
}

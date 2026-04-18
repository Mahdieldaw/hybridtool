import { DEFAULT_THREAD } from './../../../shared/messaging.js';
import type { SessionManager } from '../../persistence/session-manager.js';
import type { SimpleRecord } from '../../persistence/simple-indexeddb-adapter.js';
import type { ProviderResponseType } from '../../../shared/types/contract.js';

const WORKFLOW_DEBUG = false;
const wdbg = (...args: unknown[]) => {
  if (WORKFLOW_DEBUG) console.log(...args);
};

export class ContextManager {
  sessionManager: SessionManager;

  constructor(sessionManager: SessionManager) {
    this.sessionManager = sessionManager;
  }

  /**
   * Resolves provider context using three-tier resolution:
   * 1. Workflow cache context (highest priority)
   * 2. Batch step context (medium priority)
   * 3. Persisted context (fallback)
   */
  async resolveProviderContext(
    providerId: string,
    context: any,
    payload: any,
    workflowContexts: any,
    previousResults: any,
    resolvedContext: any,
    stepType = 'step'
  ) {
    const providerContexts: Record<string, any> = {};

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
      } catch (err) {
        console.warn('[ContextManager] Debug log failed (non-fatal):', String(err));
      }
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
        } catch (err) {
        console.warn('[ContextManager] Debug log failed (non-fatal):', String(err));
      }
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
          } catch (err) {
        console.warn('[ContextManager] Debug log failed (non-fatal):', String(err));
      }
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
        } catch (err) {
        console.warn('[ContextManager] Debug log failed (non-fatal):', String(err));
      }
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
  async resolveHistoricalSources(payload: any, context: any, previousResults: any) {
    const sessionManager = this.sessionManager;

    if (Array.isArray(payload?.sourceData) && payload.sourceData.length > 0) {
      return payload.sourceData
        .map((s: any) => {
          const providerId = String(s?.providerId || '').trim();
          const text = String(s?.text ?? s?.content ?? '').trim();
          return { providerId, text };
        })
        .filter((s: { providerId: string; text: string }) => s.providerId && s.text);
    }

    if (payload.sourceHistorical) {
      const { turnId, responseType }: { turnId: string; responseType: ProviderResponseType } = payload.sourceHistorical;
      console.log(`[ContextManager] Resolving historical data from turn: ${turnId}`);

      let aiTurn: SimpleRecord | null = null;
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
            } catch (err) {
              console.warn('[ContextManager] Turn lookup fallback failed (non-fatal):', String(err));
            }
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
                    console.warn(
                      `[ContextManager] Text-based fallback matched AI turn ${next.id} for source ${turnId} — duplicate messages could yield wrong turn`
                    );
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

      // Responses are stored flat in provider_responses with responseType discriminator.
      // Read directly — there is no mappingResponses/batchResponses field on the turn record.
      const respType = responseType || 'batch';
      const latestMap = new Map<string, any>();
      try {
        const responses = await sessionManager.adapter?.getResponsesByTurnId(aiTurn.id as string);
        (responses || [])
          .filter((r: any) => r?.responseType === respType && r.text?.trim())
          .forEach((r: any) => {
            const existing = latestMap.get(r.providerId);
            if (!existing || (r.responseIndex || 0) >= (existing.responseIndex || 0)) {
              latestMap.set(r.providerId, r);
            }
          });
      } catch (e) {
        console.warn('[ContextManager] getResponsesByTurnId failed for historical sources:', e);
      }

      const sourceArray = Array.from(latestMap.values()).map((r: any) => ({
        providerId: r.providerId,
        text: r.text,
      }));

      console.log(`[ContextManager] Found ${sourceArray.length} historical sources`);
      return sourceArray;
    }

    if (payload.sourceStepIds) {
      const sourceArray: { providerId: string; text: string }[] = [];
      for (const stepId of payload.sourceStepIds) {
        const stepResult = previousResults?.get?.(stepId);
        if (!stepResult || stepResult.status !== 'completed') continue;
        const results = stepResult.result?.results;
        if (!results || typeof results !== 'object') continue;
        Object.entries(results).forEach(([providerId, result]) => {
          const r = result as any;
          if (r.status === 'completed' && r.text && r.text.trim().length > 0) {
            sourceArray.push({ providerId, text: r.text });
          }
        });
      }
      return sourceArray;
    }

    throw new Error('No valid source specified for step.');
  }
}

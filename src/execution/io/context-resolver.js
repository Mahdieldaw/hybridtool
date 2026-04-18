// src/core/execution/io/context-resolver.js
import { DEFAULT_THREAD } from '../../../shared/messaging';
import { parseSemanticMapperOutput } from '../../../shared/parsing-utils';

export function aggregateBatchOutputs(providerResponses = []) {
  try {
    const frozen = {};
    const byProvider = new Map();
    for (const r of providerResponses) {
      if (!r || r.responseType !== 'batch') continue;
      const pid = r.providerId;
      const existing = byProvider.get(pid);
      const rank = (val) => (val?.status === 'completed' ? 2 : val?.status === 'streaming' ? 1 : 0);
      const currentRank = rank(r);
      const existingRank = rank(existing);
      if (
        !existing ||
        currentRank > existingRank ||
        (currentRank === existingRank && (r.updatedAt ?? 0) > (existing.updatedAt ?? 0))
      ) {
        byProvider.set(pid, r);
      }
    }
    byProvider.forEach((r, pid) => {
      frozen[pid] = {
        providerId: pid,
        text: r.text || '',
        status: r.status || 'completed',
        meta: r.meta || {},
        createdAt: r.createdAt || Date.now(),
        updatedAt: r.updatedAt || r.createdAt || Date.now(),
      };
    });
    return frozen;
  } catch (e) {
    console.warn('[ContextResolver] aggregateBatchOutputs failed:', e);
    return {};
  }
}

export function findLatestMappingOutput(providerResponses = [], preferredProvider) {
  try {
    if (!providerResponses || providerResponses.length === 0) return null;
    const mappingResponses = providerResponses.filter(
      (r) => r && r.responseType === 'mapping' && r.text && String(r.text).trim().length > 0
    );
    if (mappingResponses.length === 0) return null;
    mappingResponses.sort(
      (a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0)
    );
    if (preferredProvider) {
      const preferred = mappingResponses.find((r) => r.providerId === preferredProvider);
      if (preferred) return { providerId: preferred.providerId, text: preferred.text, meta: preferred.meta || {} };
    }
    const latest = mappingResponses[0];
    return { providerId: latest.providerId, text: latest.text, meta: latest.meta || {} };
  } catch (e) {
    console.warn('[ContextResolver] findLatestMappingOutput failed:', e);
    return null;
  }
}

export function extractUserMessage(userTurn) {
  return userTurn?.text || userTurn?.content || '';
}

/**
 * ContextResolver
 *
 * Resolves the minimal context needed for a workflow request.
 * Implements the 3 primitives: initialize, extend, recompute.
 *
 * Responsibilities:
 * - Non-blocking, targeted lookups (no full session hydration)
 * - Deterministic provider context resolution
 * - Immutable resolved context objects
 */

export class ContextResolver {
  constructor(sessionManager) {
    this.sessionManager = sessionManager;
  }

  /**
   * Resolve context for any primitive request
   * @param {Object} request initialize | extend | recompute
   * @returns {Promise<Object>} ResolvedContext
   */
  async resolve(request) {
    if (!request || !request.type) {
      throw new Error('[ContextResolver] request.type is required');
    }

    switch (request.type) {
      case 'initialize':
        return this._resolveInitialize(request);
      case 'extend':
        return this._resolveExtend(request);
      case 'recompute':
        return this._resolveRecompute(request);
      default:
        throw new Error(`[ContextResolver] Unknown request type: ${request.type}`);
    }
  }

  // initialize: starting fresh
  async _resolveInitialize(request) {
    return {
      type: 'initialize',
      providers: request.providers || [],
    };
  }

  // extend: fetch last turn and extract provider contexts for requested providers
  async _resolveExtend(request) {
    const { sessionId, threadId = DEFAULT_THREAD } = request;
    if (!sessionId) throw new Error('[ContextResolver] Extend requires sessionId');

    const session = await this._getSessionMetadata(sessionId);
    if (!session || !session.lastTurnId) {
      throw new Error(`[ContextResolver] Cannot extend: no lastTurnId for session ${sessionId}`);
    }

    const lastTurn = await this._getTurn(session.lastTurnId);
    if (!lastTurn) throw new Error(`[ContextResolver] Last turn ${session.lastTurnId} not found`);

    const sessionContexts = await this.sessionManager.getProviderContexts(sessionId, threadId, {
      contextRole: 'batch',
    });

    // PERMISSIVE EXTEND LOGIC:
    // 1. Iterate over requested providers
    // 2. If forced reset -> New Joiner
    // 3. If context exists -> Continue
    // 4. If no context -> New Joiner
    const resolvedContexts = {};
    const forcedResetSet = new Set(request.forcedContextReset || []);

    for (const pid of request.providers || []) {
      if (forcedResetSet.has(pid)) {
        // Case 1: Forced Reset
        resolvedContexts[pid] = { isNewJoiner: true };
      } else {
        const meta = sessionContexts?.[pid]?.meta;
        if (meta && typeof meta === 'object' && Object.keys(meta).length > 0) {
          resolvedContexts[pid] = meta;
          continue;
        }
        resolvedContexts[pid] = { isNewJoiner: true };
      }
    }

    return {
      type: 'extend',
      sessionId,
      lastTurnId: lastTurn.id,
      providerContexts: resolvedContexts,
      previousContext: lastTurn.lastContextSummary || null,
      previousAnalysis: await this._resolveLastStoredAnalysis(sessionId, session, lastTurn),
    };
  }

  // recompute: fetch source AI turn, gather frozen batch outputs and original user message
  async _resolveRecompute(request) {
    const { sessionId, sourceTurnId, stepType, targetProvider } = request;
    if (!sessionId || !sourceTurnId) {
      throw new Error('[ContextResolver] Recompute requires sessionId and sourceTurnId');
    }

    const sourceTurn = await this._getTurn(sourceTurnId);
    if (!sourceTurn) throw new Error(`[ContextResolver] Source turn ${sourceTurnId} not found`);

    // NEW: batch recompute - single provider retry using original user message OR custom override
    if (stepType === 'batch') {
      const turnContexts = sourceTurn.providerContexts || {};
      const batchPid = targetProvider ? `${targetProvider}:batch` : null;

      // Extract specific context for target provider, prioritizing :batch
      let targetContext = undefined;
      if (batchPid && turnContexts[batchPid]) {
        targetContext = turnContexts[batchPid];
      } else if (targetProvider && turnContexts[targetProvider]) {
        targetContext = turnContexts[targetProvider];
      }

      let normalizedTargetContext =
        targetContext && typeof targetContext === 'object' && 'meta' in targetContext
          ? targetContext.meta
          : targetContext;

      if (
        targetProvider &&
        (!normalizedTargetContext ||
          typeof normalizedTargetContext !== 'object' ||
          !('conversationId' in normalizedTargetContext))
      ) {
        try {
          const responses = await this._getProviderResponsesForTurn(sourceTurnId);
          const candidates = Array.isArray(responses)
            ? responses.filter(
                (r) =>
                  r &&
                  r.providerId === targetProvider &&
                  r.responseType === 'batch' &&
                  r.meta &&
                  typeof r.meta === 'object'
              )
            : [];
          candidates.sort((a, b) => {
            const ai = a.responseIndex ?? 0;
            const bi = b.responseIndex ?? 0;
            if (bi !== ai) return bi - ai;
            const at = a.updatedAt ?? a.createdAt ?? 0;
            const bt = b.updatedAt ?? b.createdAt ?? 0;
            return bt - at;
          });
          if (candidates[0]?.meta && typeof candidates[0].meta === 'object') {
            normalizedTargetContext = candidates[0].meta;
          }
        } catch (err) {
          console.warn('[ContextResolver] Provider response lookup failed (non-fatal):', err?.message || String(err));
        }
      }

      if (
        targetProvider &&
        (!normalizedTargetContext ||
          typeof normalizedTargetContext !== 'object' ||
          !('conversationId' in normalizedTargetContext))
      ) {
        try {
          const sessionContexts = await this.sessionManager.getProviderContexts(
            sessionId,
            DEFAULT_THREAD,
            { contextRole: 'batch' }
          );
          const meta = sessionContexts?.[targetProvider]?.meta;
          if (meta && typeof meta === 'object' && 'conversationId' in meta) {
            normalizedTargetContext = meta;
          }
        } catch (err) {
          console.warn('[ContextResolver] Session context lookup failed (non-fatal):', err?.message || String(err));
        }
      }

      const providerContextsAtSourceTurn =
        targetProvider && normalizedTargetContext
          ? { [targetProvider]: normalizedTargetContext }
          : {};

      // Prefer custom userMessage from request (targeted refinement), fallback to original turn text
      const sourceUserMessage =
        request.userMessage || (await this._getUserMessageForTurn(sourceTurn));
      return {
        type: 'recompute',
        sessionId,
        sourceTurnId,
        stepType,
        targetProvider,
        // No frozen outputs required for batch; we are re-running fresh for a single provider
        frozenBatchOutputs: {},
        providerContextsAtSourceTurn,
        latestMappingOutput: null,
        sourceUserMessage,
      };
    }

    // Build frozen outputs from provider_responses store, not embedded turn fields
    const responses = await this._getProviderResponsesForTurn(sourceTurnId);
    const frozenBatchOutputs = aggregateBatchOutputs(responses);
    if (!frozenBatchOutputs || Object.keys(frozenBatchOutputs).length === 0) {
      throw new Error(
        `[ContextResolver] Source turn ${sourceTurnId} has no batch outputs in provider_responses`
      );
    }

    // Determine the latest valid mapping output for this source turn
    const latestMappingOutput = findLatestMappingOutput(
      responses,
      request.preferredMappingProvider
    );

    const providerContextsAtSourceTurn = sourceTurn.providerContexts || {};
    const sourceUserMessage = await this._getUserMessageForTurn(sourceTurn);

    // Extract frozen prompt metadata for singularity recomputes
    const singularityResponse = responses.find((r) => r.responseType === 'singularity');
    const frozenSingularityPromptType = singularityResponse?.meta?.frozenSingularityPromptType;
    const frozenSingularityPromptSeed = singularityResponse?.meta?.frozenSingularityPromptSeed;

    return {
      type: 'recompute',
      sessionId,
      sourceTurnId,
      frozenBatchOutputs,
      latestMappingOutput,
      providerContextsAtSourceTurn,
      stepType,
      targetProvider,
      sourceUserMessage,
      frozenSingularityPromptType,
      frozenSingularityPromptSeed,
    };
  }

  // ===== helpers =====
  async _getSessionMetadata(sessionId) {
    try {
      if (this.sessionManager?.adapter?.isReady && this.sessionManager.adapter.isReady()) {
        return await this.sessionManager.adapter.get('sessions', sessionId);
      }
      return null;
    } catch (e) {
      console.error('[ContextResolver] _getSessionMetadata failed:', e);
      return null;
    }
  }

  async _resolveLastStoredAnalysis(sessionId, session, lastTurn) {
    // Try last turn first
    const fromLast = await this._parseMappingFromTurn(lastTurn?.id);
    if (fromLast) return fromLast;

    // Try structural turn
    const structuralTurnId = session?.lastStructuralTurnId;
    if (structuralTurnId) {
      const fromStructural = await this._parseMappingFromTurn(structuralTurnId);
      if (fromStructural) return fromStructural;
    }

    // Last resort: scan backwards for any turn with a mapping response
    if (!structuralTurnId) {
      const adapter = this.sessionManager?.adapter;
      const adapterReady =
        adapter && (typeof adapter.isReady === 'function' ? adapter.isReady() : true);
      if (!adapterReady) return null;

      try {
        const turns = await adapter.getTurnsBySessionId(sessionId);
        if (Array.isArray(turns)) {
          for (let i = turns.length - 1; i >= 0; i--) {
            const t = turns[i];
            if (!t || typeof t !== 'object') continue;
            if (t.type !== 'ai' && t.role !== 'assistant') continue;
            const result = await this._parseMappingFromTurn(t.id);
            if (result) return result;
          }
        }
      } catch (e) {
        console.debug('[ContextResolver] Failed to scan turns:', e);
      }
    }

    return null;
  }

  async _parseMappingFromTurn(turnId) {
    if (!turnId) return null;
    try {
      const responses = await this._getProviderResponsesForTurn(turnId);
      const mappingResp = (Array.isArray(responses) ? responses : [])
        .filter((r) => r && r.responseType === 'mapping')
        .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))[0];

      if (!mappingResp?.text) return null;

      const parsed = parseSemanticMapperOutput(String(mappingResp.text));
      if (!parsed.success || !parsed.output) return null;

      const { claims, edges } = parsed.output;
      if (!Array.isArray(claims) || claims.length === 0) return null;

      return { claims, edges: edges || [] };
    } catch (err) {
      console.warn('[ContextResolver] Mapping parse failed (non-fatal):', err?.message || String(err));
      return null;
    }
  }

  async _getTurn(turnId) {
    try {
      if (this.sessionManager?.adapter?.isReady && this.sessionManager.adapter.isReady()) {
        return await this.sessionManager.adapter.get('turns', turnId);
      }
      return null;
    } catch (e) {
      console.error('[ContextResolver] _getTurn failed:', e);
      return null;
    }
  }

  // kept for legacy compatibility if strict filtering needed
  _filterContexts(allContexts, requestedProviders) {
    const filtered = {};
    for (const pid of requestedProviders) {
      if (allContexts[pid]) {
        filtered[pid] = { meta: allContexts[pid], continueThread: true };
      }
    }
    return filtered;
  }

  async _getUserMessageForTurn(aiTurn) {
    const userTurnId = aiTurn.userTurnId;
    if (!userTurnId) return '';
    const userTurn = await this._getTurn(userTurnId);
    return extractUserMessage(userTurn);
  }

  /**
   * Fetch provider responses for a given AI turn using adapter indices if available.
   * Simplified: always use the indexed adapter.getResponsesByTurnId for high performance.
   */
  async _getProviderResponsesForTurn(aiTurnId) {
    // No more fallbacks or readiness checks. Trust the adapter.
    // If this fails, it should throw an error, which is the desired "fail fast" behavior.
    return this.sessionManager.adapter.getResponsesByTurnId(aiTurnId);
  }
}

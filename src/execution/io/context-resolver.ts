// src/core/execution/io/context-resolver.ts
import { DEFAULT_THREAD } from '../../../shared/messaging';
import { parseSemanticMapperOutput } from '../../../shared/parsing-utils';
import type { ProviderResponseRecord, SessionRecord, AiTurnRecord, TurnRecord } from '../../persistence/types';

// Minimal structural interfaces for the injected session manager
interface IAdapter {
  isReady(): boolean;
  get(store: 'sessions', id: string): Promise<SessionRecord | null>;
  get(store: 'turns', id: string): Promise<TurnRecord | null>;
  getTurnsBySessionId(sessionId: string): Promise<TurnRecord[]>;
  getResponsesByTurnId(aiTurnId: string): Promise<ProviderResponseRecord[]>;
}

interface ISessionManager {
  adapter: IAdapter;
  getProviderContexts(
    sessionId: string,
    threadId: string,
    opts: { contextRole: string }
  ): Promise<Record<string, { meta?: Record<string, unknown> }> | null>;
}

type FrozenBatchMap = Record<string, {
  providerId: string;
  text: string;
  status: string;
  meta: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}>;

export function aggregateBatchOutputs(providerResponses: ProviderResponseRecord[] = []): FrozenBatchMap {
  try {
    const frozen: FrozenBatchMap = {};
    const byProvider = new Map<string, ProviderResponseRecord>();
    for (const r of providerResponses) {
      if (!r || r.responseType !== 'batch') continue;
      const pid = r.providerId;
      const existing = byProvider.get(pid);
      const rank = (val: ProviderResponseRecord | undefined) =>
        val?.status === 'completed' ? 2 : val?.status === 'streaming' ? 1 : 0;
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
        meta: (r.meta as Record<string, unknown>) || {},
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

export function findLatestMappingOutput(
  providerResponses: ProviderResponseRecord[] = [],
  preferredProvider?: string
): { providerId: string; text: string; meta: Record<string, unknown> } | null {
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
      if (preferred) return { providerId: preferred.providerId, text: preferred.text, meta: (preferred.meta as Record<string, unknown>) || {} };
    }
    const latest = mappingResponses[0];
    return { providerId: latest.providerId, text: latest.text, meta: (latest.meta as Record<string, unknown>) || {} };
  } catch (e) {
    console.warn('[ContextResolver] findLatestMappingOutput failed:', e);
    return null;
  }
}

export function extractUserMessage(userTurn: TurnRecord | null | undefined): string {
  if (!userTurn) return '';
  if (userTurn.type === 'user') return userTurn.text || userTurn.content || '';
  return userTurn.content || '';
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
  private sessionManager: ISessionManager;

  constructor(sessionManager: ISessionManager) {
    this.sessionManager = sessionManager;
  }

  /**
   * Resolve context for any primitive request
   * @param request initialize | extend | recompute
   * @returns ResolvedContext
   */
  async resolve(request: { type: string; [key: string]: unknown }): Promise<unknown> {
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
  async _resolveInitialize(request: { providers?: string[]; [key: string]: unknown }): Promise<unknown> {
    return {
      type: 'initialize',
      providers: request.providers || [],
    };
  }

  // extend: fetch last turn and extract provider contexts for requested providers
  async _resolveExtend(request: {
    sessionId?: string;
    threadId?: string;
    providers?: string[];
    forcedContextReset?: string[];
    [key: string]: unknown;
  }): Promise<unknown> {
    const { sessionId, threadId = DEFAULT_THREAD } = request;
    if (!sessionId) throw new Error('[ContextResolver] Extend requires sessionId');

    const session = await this._getSessionMetadata(sessionId);
    if (!session || !session.lastTurnId) {
      throw new Error(`[ContextResolver] Cannot extend: no lastTurnId for session ${sessionId}`);
    }

    const lastTurn = await this._getTurn(session.lastTurnId);
    if (!lastTurn) throw new Error(`[ContextResolver] Last turn ${session.lastTurnId} not found`);

    const sessionContexts = await this.sessionManager.getProviderContexts(sessionId, threadId as string, {
      contextRole: 'batch',
    });

    // PERMISSIVE EXTEND LOGIC:
    // 1. Iterate over requested providers
    // 2. If forced reset -> New Joiner
    // 3. If context exists -> Continue
    // 4. If no context -> New Joiner
    const resolvedContexts: Record<string, unknown> = {};
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
      previousContext: (lastTurn as AiTurnRecord).lastContextSummary || null,
      previousAnalysis: await this._resolveLastStoredAnalysis(sessionId, session, lastTurn as AiTurnRecord),
    };
  }

  // recompute: fetch source AI turn, gather frozen batch outputs and original user message
  async _resolveRecompute(request: {
    sessionId?: string;
    sourceTurnId?: string;
    stepType?: string;
    targetProvider?: string;
    userMessage?: string;
    preferredMappingProvider?: string;
    forcedContextReset?: string[];
    [key: string]: unknown;
  }): Promise<unknown> {
    const { sessionId, sourceTurnId, stepType, targetProvider } = request;
    if (!sessionId || !sourceTurnId) {
      throw new Error('[ContextResolver] Recompute requires sessionId and sourceTurnId');
    }

    const sourceTurnRaw = await this._getTurn(sourceTurnId);
    if (!sourceTurnRaw) throw new Error(`[ContextResolver] Source turn ${sourceTurnId} not found`);
    const sourceTurn = sourceTurnRaw as AiTurnRecord;

    // NEW: batch recompute - single provider retry using original user message OR custom override
    if (stepType === 'batch') {
      const turnContexts = (sourceTurn as unknown as Record<string, unknown>).providerContexts as Record<string, unknown> || {};
      const batchPid = targetProvider ? `${targetProvider}:batch` : null;

      // Extract specific context for target provider, prioritizing :batch
      let targetContext: unknown = undefined;
      if (batchPid && turnContexts[batchPid]) {
        targetContext = turnContexts[batchPid];
      } else if (targetProvider && turnContexts[targetProvider]) {
        targetContext = turnContexts[targetProvider];
      }

      let normalizedTargetContext: Record<string, unknown> | undefined =
        targetContext && typeof targetContext === 'object' && 'meta' in targetContext
          ? (targetContext as { meta: Record<string, unknown> }).meta
          : (targetContext as Record<string, unknown> | undefined);

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
            normalizedTargetContext = candidates[0].meta as Record<string, unknown>;
          }
        } catch (err) {
          console.warn('[ContextResolver] Provider response lookup failed (non-fatal):', err instanceof Error ? err.message : String(err));
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
            normalizedTargetContext = meta as Record<string, unknown>;
          }
        } catch (err) {
          console.warn('[ContextResolver] Session context lookup failed (non-fatal):', err instanceof Error ? err.message : String(err));
        }
      }

      const providerContextsAtSourceTurn: Record<string, unknown> =
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

    const providerContextsAtSourceTurn = (sourceTurn as unknown as Record<string, unknown>).providerContexts || {};
    const sourceUserMessage = await this._getUserMessageForTurn(sourceTurn);

    // Extract frozen prompt metadata for singularity recomputes
    const singularityResponse = responses.find((r) => r.responseType === 'singularity');
    const frozenSingularityPromptType = (singularityResponse?.meta as Record<string, unknown>)?.frozenSingularityPromptType;
    const frozenSingularityPromptSeed = (singularityResponse?.meta as Record<string, unknown>)?.frozenSingularityPromptSeed;

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
  async _getSessionMetadata(sessionId: string): Promise<SessionRecord | null> {
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

  async _resolveLastStoredAnalysis(
    sessionId: string,
    session: SessionRecord,
    lastTurn: AiTurnRecord
  ): Promise<{ claims: unknown[]; edges: unknown[] } | null> {
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
            if (t.type !== 'ai' && (t as unknown as Record<string, unknown>).role !== 'assistant') continue;
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

  async _parseMappingFromTurn(turnId: string | null | undefined): Promise<{ claims: unknown[]; edges: unknown[] } | null> {
    if (!turnId) return null;
    try {
      const responses = await this._getProviderResponsesForTurn(turnId);
      const mappingResp = (Array.isArray(responses) ? responses : [])
        .filter((r) => r && r.responseType === 'mapping')
        .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))[0];

      if (!mappingResp?.text) return null;

      const parsed = parseSemanticMapperOutput(String(mappingResp.text));
      if (!parsed.success || !parsed.output) return null;

      const { claims, edges } = parsed.output as { claims: unknown[]; edges: unknown[] };
      if (!Array.isArray(claims) || claims.length === 0) return null;

      return { claims, edges: edges || [] };
    } catch (err) {
      console.warn('[ContextResolver] Mapping parse failed (non-fatal):', err instanceof Error ? err.message : String(err));
      return null;
    }
  }

  async _getTurn(turnId: string): Promise<TurnRecord | null> {
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
  _filterContexts(
    allContexts: Record<string, unknown>,
    requestedProviders: string[]
  ): Record<string, unknown> {
    const filtered: Record<string, unknown> = {};
    for (const pid of requestedProviders) {
      if (allContexts[pid]) {
        filtered[pid] = { meta: allContexts[pid], continueThread: true };
      }
    }
    return filtered;
  }

  async _getUserMessageForTurn(aiTurn: AiTurnRecord): Promise<string> {
    const userTurnId = aiTurn.userTurnId;
    if (!userTurnId) return '';
    const userTurn = await this._getTurn(userTurnId);
    return extractUserMessage(userTurn);
  }

  /**
   * Fetch provider responses for a given AI turn using adapter indices if available.
   * Simplified: always use the indexed adapter.getResponsesByTurnId for high performance.
   */
  async _getProviderResponsesForTurn(aiTurnId: string): Promise<ProviderResponseRecord[]> {
    // No more fallbacks or readiness checks. Trust the adapter.
    // If this fails, it should throw an error, which is the desired "fail fast" behavior.
    return this.sessionManager.adapter.getResponsesByTurnId(aiTurnId);
  }
}

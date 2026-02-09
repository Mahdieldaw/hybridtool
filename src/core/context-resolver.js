// src/core/context-resolver.js
import {
  aggregateBatchOutputs,
  findLatestMappingOutput,
  extractUserMessage
} from './context-utils.js';
import { DEFAULT_THREAD } from '../../shared/messaging.js';
import { computeStructuralAnalysis } from './PromptMethods';

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
      throw new Error("[ContextResolver] request.type is required");
    }

    switch (request.type) {
      case "initialize":
        return this._resolveInitialize(request);
      case "extend":
        return this._resolveExtend(request);
      case "recompute":
        return this._resolveRecompute(request);
      default:
        throw new Error(
          `[ContextResolver] Unknown request type: ${request.type}`,
        );
    }
  }

  // initialize: starting fresh
  async _resolveInitialize(request) {
    return {
      type: "initialize",
      providers: request.providers || [],
    };
  }

  // extend: fetch last turn and extract provider contexts for requested providers
  async _resolveExtend(request) {
    const { sessionId, threadId = DEFAULT_THREAD } = request;
    if (!sessionId)
      throw new Error("[ContextResolver] Extend requires sessionId");

    const session = await this._getSessionMetadata(sessionId);
    if (!session || !session.lastTurnId) {
      throw new Error(
        `[ContextResolver] Cannot extend: no lastTurnId for session ${sessionId}`,
      );
    }

    const lastTurn = await this._getTurn(session.lastTurnId);
    if (!lastTurn)
      throw new Error(
        `[ContextResolver] Last turn ${session.lastTurnId} not found`,
      );

    const sessionContexts = await this.sessionManager.getProviderContexts(
      sessionId,
      threadId,
      { contextRole: "batch" },
    );

    // PERMISSIVE EXTEND LOGIC:
    // 1. Iterate over requested providers
    // 2. If forced reset -> New Joiner
    // 3. If context exists -> Continue
    // 4. If no context -> New Joiner
    const resolvedContexts = {};
    const forcedResetSet = new Set(request.forcedContextReset || []);

    for (const pid of (request.providers || [])) {
      if (forcedResetSet.has(pid)) {
        // Case 1: Forced Reset
        resolvedContexts[pid] = { isNewJoiner: true };
      } else {
        const meta = sessionContexts?.[pid]?.meta;
        if (meta && typeof meta === "object" && Object.keys(meta).length > 0) {
          resolvedContexts[pid] = meta;
          continue;
        }
        resolvedContexts[pid] = { isNewJoiner: true };
      }
    }

    return {
      type: "extend",
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
      throw new Error(
        "[ContextResolver] Recompute requires sessionId and sourceTurnId",
      );
    }

    const sourceTurn = await this._getTurn(sourceTurnId);
    if (!sourceTurn)
      throw new Error(
        `[ContextResolver] Source turn ${sourceTurnId} not found`,
      );

    // NEW: batch recompute - single provider retry using original user message OR custom override
    if (stepType === "batch") {
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
        targetContext && typeof targetContext === "object" && "meta" in targetContext
          ? targetContext.meta
          : targetContext;

      if (
        targetProvider &&
        (!normalizedTargetContext ||
          typeof normalizedTargetContext !== "object" ||
          !("conversationId" in normalizedTargetContext))
      ) {
        try {
          const responses = await this._getProviderResponsesForTurn(sourceTurnId);
          const candidates = Array.isArray(responses)
            ? responses.filter(
              (r) =>
                r &&
                r.providerId === targetProvider &&
                r.responseType === "batch" &&
                r.meta &&
                typeof r.meta === "object",
            )
            : [];
          candidates.sort((a, b) => {
            const ai = (a.responseIndex ?? 0);
            const bi = (b.responseIndex ?? 0);
            if (bi !== ai) return bi - ai;
            const at = (a.updatedAt ?? a.createdAt ?? 0);
            const bt = (b.updatedAt ?? b.createdAt ?? 0);
            return bt - at;
          });
          if (candidates[0]?.meta && typeof candidates[0].meta === "object") {
            normalizedTargetContext = candidates[0].meta;
          }
        } catch (_) { }
      }

      if (
        targetProvider &&
        (!normalizedTargetContext ||
          typeof normalizedTargetContext !== "object" ||
          !("conversationId" in normalizedTargetContext))
      ) {
        try {
          const sessionContexts = await this.sessionManager.getProviderContexts(
            sessionId,
            DEFAULT_THREAD,
            { contextRole: "batch" },
          );
          const meta = sessionContexts?.[targetProvider]?.meta;
          if (meta && typeof meta === "object" && "conversationId" in meta) {
            normalizedTargetContext = meta;
          }
        } catch (_) { }
      }

      const providerContextsAtSourceTurn =
        targetProvider && normalizedTargetContext
          ? { [targetProvider]: normalizedTargetContext }
          : {};

      // Prefer custom userMessage from request (targeted refinement), fallback to original turn text
      const sourceUserMessage = request.userMessage || await this._getUserMessageForTurn(sourceTurn);
      return {
        type: "recompute",
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
        `[ContextResolver] Source turn ${sourceTurnId} has no batch outputs in provider_responses`,
      );
    }

    // Determine the latest valid mapping output for this source turn
    const latestMappingOutput = findLatestMappingOutput(
      responses,
      request.preferredMappingProvider,
    );

    const providerContextsAtSourceTurn = sourceTurn.providerContexts || {};
    const sourceUserMessage = await this._getUserMessageForTurn(sourceTurn);

    // Extract frozen prompt metadata for singularity recomputes
    const singularityResponse = responses.find(r => r.responseType === 'singularity');
    const frozenSingularityPromptType = singularityResponse?.meta?.frozenSingularityPromptType;
    const frozenSingularityPromptSeed = singularityResponse?.meta?.frozenSingularityPromptSeed;

    return {
      type: "recompute",
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
      if (
        this.sessionManager?.adapter?.isReady &&
        this.sessionManager.adapter.isReady()
      ) {
        return await this.sessionManager.adapter.get("sessions", sessionId);
      }
      return null;
    } catch (e) {
      console.error("[ContextResolver] _getSessionMetadata failed:", e);
      return null;
    }
  }

  async _resolveLastStoredAnalysis(sessionId, session, lastTurn) {
    const direct = this._extractStoredAnalysisFromTurn(lastTurn);
    if (direct) return direct;

    const structuralTurnId = session?.lastStructuralTurnId;
    let structuralTurn = null;

    if (structuralTurnId) {
      try {
        structuralTurn = await this._getTurn(structuralTurnId);
      } catch (err) {
        console.debug('[ContextResolver] Failed to fetch structural turn:', structuralTurnId, err);
      }
    }

    if (structuralTurn) {
      const fromStructural = this._extractStoredAnalysisFromTurn(structuralTurn);
      if (fromStructural) return fromStructural;
    }

    const fallbackFromArtifact = await this._computeStoredAnalysisFromArtifact(lastTurn?.mapping?.artifact);
    if (fallbackFromArtifact) return fallbackFromArtifact;

    if (structuralTurn) {
      const fromArtifact = await this._computeStoredAnalysisFromArtifact(structuralTurn.mapping?.artifact);
      if (fromArtifact) return fromArtifact;
    }

    if (!structuralTurnId) {
      // Check adapter exists and is ready before use
      const adapter = this.sessionManager?.adapter;
      const adapterReady = adapter && (
        typeof adapter.isReady === 'function' ? adapter.isReady() : true
      );

      if (!adapterReady) {
        console.debug("[ContextResolver] Adapter not ready, skipping turn scan");
        return null;
      }

      try {
        const turns = await adapter.getTurnsBySessionId(sessionId);
        if (Array.isArray(turns) && turns.length > 0) {
          for (let i = turns.length - 1; i >= 0; i--) {
            const t = turns[i];
            if (!t || typeof t !== "object") continue;
            if (t.type !== "ai" && t.role !== "assistant") continue;

            const stored = this._extractStoredAnalysisFromTurn(t);
            if (stored) return stored;

            const computed = await this._computeStoredAnalysisFromArtifact(t.mapping?.artifact);
            if (computed) return computed;
          }
        }
      } catch (e) {
        console.debug("[ContextResolver] Failed to scan turns:", e);
      }
    }

    return null;
  }

  _extractStoredAnalysisFromTurn(turn) {
    if (!turn || typeof turn !== "object") return null;
    const candidate = turn.storedAnalysis || turn.structuralAnalysis || null;
    if (!candidate || typeof candidate !== "object") return null;

    const claimsWithLeverage = candidate.claimsWithLeverage;
    const edges = candidate.edges;

    if (!Array.isArray(claimsWithLeverage) || !Array.isArray(edges)) return null;
    return { claimsWithLeverage, edges };
  }

  async _computeStoredAnalysisFromArtifact(artifact) {
    if (!artifact || typeof artifact !== "object") return null;
    const claims = artifact.semantic?.claims;
    const edges = artifact.semantic?.edges;
    if (!Array.isArray(claims) || !Array.isArray(edges)) return null;
    if (claims.length === 0 && edges.length === 0) return null;

    try {
      const analysis = computeStructuralAnalysis(artifact);
      if (!analysis || !Array.isArray(analysis.claimsWithLeverage) || !Array.isArray(analysis.edges)) return null;
      return { claimsWithLeverage: analysis.claimsWithLeverage, edges: analysis.edges };
    } catch (_) {
      return null;
    }
  }

  async _getTurn(turnId) {
    try {
      if (
        this.sessionManager?.adapter?.isReady &&
        this.sessionManager.adapter.isReady()
      ) {
        return await this.sessionManager.adapter.get("turns", turnId);
      }
      return null;
    } catch (e) {
      console.error("[ContextResolver] _getTurn failed:", e);
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
    if (!userTurnId) return "";
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

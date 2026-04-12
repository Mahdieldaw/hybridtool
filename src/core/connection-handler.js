// src/core/connection-handler.js

import { WorkflowEngine } from './workflow-engine.js';
import { runPreflight, createAuthErrorMessage } from './preflight-validator.js';
import { authManager } from './auth-manager.js';
import { DEFAULT_THREAD, PROBE_SESSION_START } from '../../shared/messaging.js';
// Note: ContextResolver is now available via services; we don't import it directly here

/**
 * ConnectionHandler
 *
 * Production-grade pattern for managing port connections.
 * Each UI connection gets its own isolated handler with proper lifecycle.
 *
 * KEY PRINCIPLES:
 * 1. Connection-scoped: Each port gets its own WorkflowEngine instance
 * 2. Async initialization: Don't attach listeners until backend is ready
 * 3. Proper cleanup: Remove listeners and free resources on disconnect
 * 4. No global state pollution: Everything is encapsulated
 * 5. AGGRESSIVE SESSION HYDRATION: Always re-hydrate from persistence for continuation requests
 */

export class ConnectionHandler {
  constructor(port, servicesOrProvider) {
    this.port = port;
    this.services = null;
    this._servicesProvider = null;
    if (typeof servicesOrProvider === 'function') {
      this._servicesProvider = servicesOrProvider;
    } else {
      this.services = servicesOrProvider;
    }
    this.workflowEngine = null;
    this.messageHandler = null;
    this.isInitialized = false;
    this.lifecycleManager = null;
    this.backendInitPromise = null;
    this._activeRecomputes = new Set();
    this._probePersistenceQueues = new Map();
  }

  /**
   * Map new primitive requests into legacy ExecuteWorkflowRequest
   * so the existing compiler/engine can process them without signature changes.
   */

  /**
   * Async initialization - waits for backend readiness
   */
  async init() {
    if (this.isInitialized) return;

    // Create message handler bound to this instance
    this.messageHandler = this._createMessageHandler();

    // Attach listener
    this.port.onMessage.addListener(this.messageHandler);

    // Attach disconnect handler
    this.port.onDisconnect.addListener(() => this._cleanup());

    this.isInitialized = true;
    console.log('[ConnectionHandler] Initialized for port:', this.port.name);

    // Signal that handler is ready to receive/queue messages
    try {
      this.port.postMessage({ type: 'HANDLER_READY' });
    } catch (_) {}

    void this._ensureBackendReady().catch((error) => {
      try {
        this.port?.postMessage({
          type: 'INITIALIZATION_FAILED',
          error: error?.message || String(error),
        });
      } catch (_) {}
    });
  }

  async _ensureBackendReady() {
    if (this.workflowEngine && this.services) return;
    if (this.backendInitPromise) return this.backendInitPromise;

    this.backendInitPromise = (async () => {
      if (!this.services) {
        if (!this._servicesProvider) throw new Error('Services provider not configured');
        this.services = await this._servicesProvider();
      }

      if (!this.services) throw new Error('Services unavailable');
      if (!this.port) throw new Error('Port closed during initialization');

      this.lifecycleManager = this.services.lifecycleManager || null;

      this.workflowEngine = new WorkflowEngine(
        this.services.orchestrator,
        this.services.sessionManager,
        this.port
      );
    })().catch((e) => {
      this.backendInitPromise = null;
      throw e;
    });

    return this.backendInitPromise;
  }

  /**
   * Build a stable idempotency key for a client-initiated request so that
   * retries on reconnect don't fan out duplicate provider requests.
   */
  _buildIdempotencyKey(executeRequest) {
    if (!executeRequest || typeof executeRequest !== 'object') return null;
    const clientUserTurnId =
      executeRequest.clientUserTurnId ||
      executeRequest.userTurnId ||
      executeRequest?.historicalContext?.userTurnId ||
      null;

    try {
      if (executeRequest.type === 'initialize') {
        if (!clientUserTurnId) return null;
        return `idem:init:${clientUserTurnId}`;
      }
      if (executeRequest.type === 'extend') {
        if (!clientUserTurnId || !executeRequest.sessionId) return null;
        return `idem:${executeRequest.sessionId}:${clientUserTurnId}`;
      }
      if (executeRequest.type === 'recompute') {
        const { sessionId, sourceTurnId, stepType, targetProvider } = executeRequest;
        if (!sessionId || !sourceTurnId || !stepType || !targetProvider) return null;
        return `idem:recompute:${sessionId}:${sourceTurnId}:${stepType}:${targetProvider}`;
      }
    } catch (_) {}
    return null;
  }

  /**
   * Emit TURN_FINALIZED constructed directly from persistence for a completed turn.
   * Used to resume UI after port reconnect when streaming was missed.
   */
  async _emitFinalizedFromPersistence(sessionId, aiTurnId) {
    try {
      const adapter = this.services?.sessionManager?.adapter;
      if (!adapter) return;

      const aiTurn = await adapter.get('turns', aiTurnId);
      if (!aiTurn || (aiTurn.type !== 'ai' && aiTurn.role !== 'assistant')) return;

      const userTurnId = aiTurn.userTurnId;
      const userTurn = userTurnId ? await adapter.get('turns', userTurnId) : null;

      const resps = await adapter.getResponsesByTurnId(aiTurnId);
      const batchResponses = {};
      for (const r of resps || []) {
        if (!r || r.responseType !== 'batch') continue;
        const entry = {
          providerId: r.providerId,
          text: r.text || '',
          status: r.status || 'completed',
          createdAt: r.createdAt || Date.now(),
          updatedAt: r.updatedAt || r.createdAt || Date.now(),
          meta: r.meta || {},
          responseIndex: r.responseIndex ?? 0,
        };
        (batchResponses[r.providerId] ||= []).push(entry);
      }

      for (const pid of Object.keys(batchResponses)) {
        batchResponses[pid].sort((a, b) => (a.responseIndex ?? 0) - (b.responseIndex ?? 0));
      }

      // Require at least some data to finalize
      const hasAny =
        Object.keys(batchResponses).length > 0 ||
        !!aiTurn.batch ||
        !!aiTurn.mapping ||
        !!aiTurn.singularity;
      if (!hasAny) return;

      const batchPhase =
        Object.keys(batchResponses || {}).length > 0
          ? {
              responses: Object.fromEntries(
                Object.entries(batchResponses).map(([pid, arr]) => {
                  const last = Array.isArray(arr) && arr.length > 0 ? arr[arr.length - 1] : arr;
                  return [
                    pid,
                    {
                      text: last?.text || '',
                      modelIndex: last?.meta?.modelIndex ?? 0,
                      status: last?.status || 'completed',
                      meta: last?.meta,
                    },
                  ];
                })
              ),
            }
          : undefined;

      const finalBatch = aiTurn.batch || batchPhase;
      const finalMapping = aiTurn.mapping;
      const finalSingularity = aiTurn.singularity;

      this.port?.postMessage({
        type: 'TURN_FINALIZED',
        sessionId: sessionId,
        userTurnId: userTurnId,
        aiTurnId: aiTurnId,
        turn: {
          user: userTurn
            ? {
                id: userTurn.id,
                type: 'user',
                text: userTurn.text || userTurn.content || '',
                createdAt: userTurn.createdAt || Date.now(),
                sessionId,
              }
            : {
                id: userTurnId || 'unknown',
                type: 'user',
                text: '',
                createdAt: Date.now(),
                sessionId,
              },
          ai: {
            id: aiTurnId,
            type: 'ai',
            userTurnId: userTurnId || 'unknown',
            sessionId,
            threadId: aiTurn.threadId || DEFAULT_THREAD,
            createdAt: aiTurn.createdAt || Date.now(),
            ...(finalBatch ? { batch: finalBatch } : {}),
            ...(finalMapping ? { mapping: finalMapping } : {}),
            ...(finalSingularity ? { singularity: finalSingularity } : {}),
            meta: aiTurn.meta || {},
            pipelineStatus: aiTurn.pipelineStatus,
          },
        },
      });
    } catch (e) {
      console.warn('[ConnectionHandler] Failed to emit TURN_FINALIZED from persistence:', e);
    }
  }

  /**
   * Create the message handler function
   * This is separate so we can properly remove it on cleanup
   */
  _createMessageHandler() {
    return async (message) => {
      if (!message || !message.type) return;

      if (message.type === 'KEEPALIVE_PING') {
        this.port.postMessage({
          type: 'KEEPALIVE_PONG',
          timestamp: Date.now(),
        });
        return;
      }

      if (message.type !== 'reconnect') {
        await this._ensureBackendReady();
      }

      try {
        if (this.lifecycleManager && typeof this.lifecycleManager.recordActivity === 'function') {
          this.lifecycleManager.recordActivity();
        }
      } catch (_) {}

      console.log(`[ConnectionHandler] Received: ${message.type}`);

      try {
        switch (message.type) {
          case 'EXECUTE_WORKFLOW':
            await this._handleExecuteWorkflow(message);
            break;
          case 'RETRY_PROVIDERS':
            await this._handleRetryProviders(message);
            break;

          case 'reconnect':
            this.port.postMessage({
              type: 'reconnect_ack',
              serverTime: Date.now(),
            });
            break;

          case 'abort':
            await this._handleAbort(message);
            break;
          case 'CONTINUE_COGNITIVE_WORKFLOW':
            if (this.workflowEngine) {
              await this.workflowEngine.handleContinueCognitiveRequest(message.payload);
            }
            break;
          case 'PROBE_QUERY':
            await this._handleProbeQuery(message);
            break;

          default:
            console.warn(`[ConnectionHandler] Unknown message type: ${message.type}`);
        }
      } catch (error) {
        console.error('[ConnectionHandler] Message handling failed:', error);
        this._sendError(message, error);
      }
    };
  }

  _buildProbePrompt(queryText, nnParagraphs) {
    const contextBlock = (Array.isArray(nnParagraphs) ? nnParagraphs : [])
      .map((p, idx) => `${idx + 1}. ${String(p || '').trim()}`)
      .filter(Boolean)
      .join('\n');

    return [
      'You are a probe model augmenting a search corpus.',
      `User Query: ${String(queryText || '').trim()}`,
      '',
      'Nearest-neighbor corpus paragraphs:',
      contextBlock || '(none)',
      '',
      'Return concise analytical paragraphs that expand or challenge the corpus context.',
    ].join('\n');
  }

  _providerDisplayName(providerId) {
    const pid = String(providerId || '').toLowerCase();
    if (pid === 'gemini') return 'Gemini';
    if (pid === 'qwen') return 'Qwen';
    return providerId;
  }

  _buildFreshProbeContexts(providerIds) {
    return Object.fromEntries(
      (providerIds || []).map((providerId) => [providerId, { meta: {}, continueThread: false }])
    );
  }

  _buildProbeSessionRecord({
    probeSessionId,
    queryText,
    searchResults,
    providerIds,
    indices,
    now,
  }) {
    const responses = Object.fromEntries(
      (providerIds || []).map((providerId) => [
        providerId,
        {
          providerId,
          modelIndex: indices?.get(providerId) || 0,
          modelName: this._providerDisplayName(providerId),
          text: '',
          paragraphs: [],
          status: 'streaming',
          createdAt: now,
          updatedAt: now,
        },
      ])
    );
    return {
      id: probeSessionId,
      queryText: String(queryText || '').trim(),
      searchResults: Array.isArray(searchResults) ? searchResults : [],
      providerIds: Array.isArray(providerIds) ? providerIds : [],
      responses,
      status: providerIds?.length ? 'probing' : 'complete',
      createdAt: now,
      updatedAt: now,
    };
  }

  _postProbeSessionStart(aiTurnId, probeSessionId, queryText, searchResults, providerIds, indices) {
    this.port?.postMessage({
      type: PROBE_SESSION_START,
      aiTurnId,
      probeSessionId,
      queryText,
      searchResults: Array.isArray(searchResults) ? searchResults : [],
      probeCount: Array.isArray(providerIds) ? providerIds.length : 0,
      providerIds: Array.isArray(providerIds) ? providerIds : [],
      modelIndices: Array.isArray(providerIds)
        ? providerIds.map((providerId) => ({
            providerId,
            modelIndex: indices?.get(providerId) || 0,
          }))
        : [],
    });
  }

  async _upsertProbeSessionOnTurn(aiTurnId, probeSessionId, updater) {
    const adapter = this.services?.sessionManager?.adapter;
    if (!adapter) return null;
    const turn = await adapter.get('turns', aiTurnId);
    if (!turn) return null;
    const probeSessions = Array.isArray(turn.probeSessions) ? [...turn.probeSessions] : [];
    const existingIndex = probeSessions.findIndex((session) => session?.id === probeSessionId);
    const nextValue = updater(existingIndex >= 0 ? probeSessions[existingIndex] : null, turn);
    if (!nextValue) return turn;
    if (existingIndex >= 0) {
      probeSessions[existingIndex] = nextValue;
    } else {
      probeSessions.push(nextValue);
    }
    const updatedTurn = {
      ...turn,
      probeSessions,
      updatedAt: nextValue.updatedAt || Date.now(),
    };
    await adapter.put('turns', updatedTurn);
    return updatedTurn;
  }

  async _enqueueProbePersistence(aiTurnId, task) {
    const previous = this._probePersistenceQueues.get(aiTurnId) || Promise.resolve();
    const current = previous.catch(() => undefined).then(task);
    this._probePersistenceQueues.set(aiTurnId, current);
    try {
      return await current;
    } finally {
      if (this._probePersistenceQueues.get(aiTurnId) === current) {
        this._probePersistenceQueues.delete(aiTurnId);
      }
    }
  }

  async _nextProbeModelIndices(aiTurnId, providerIds) {
    const adapter = this.services?.sessionManager?.adapter;
    if (!adapter) {
      const indices = new Map();
      let cursor = 1;
      for (const pid of providerIds) indices.set(pid, cursor++);
      return { indices, turn: null, responses: [] };
    }
    const turn = await adapter.get('turns', aiTurnId);
    const responses = await adapter.getResponsesByTurnId(aiTurnId);
    const used = new Set();

    const mappingOrder =
      turn?.mapping?.artifact?.citationSourceOrder || turn?.mapping?.citationSourceOrder || {};
    for (const [k] of Object.entries(mappingOrder || {})) {
      const n = Number(k);
      if (Number.isFinite(n) && n > 0) used.add(n);
    }

    for (const r of responses || []) {
      const n = Number(r?.meta?.modelIndex);
      if (Number.isFinite(n) && n > 0) used.add(n);
    }

    const shadowParagraphs = turn?.mapping?.artifact?.shadow?.paragraphs || [];
    for (const p of shadowParagraphs) {
      const n = Number(p?.modelIndex);
      if (Number.isFinite(n) && n > 0) used.add(n);
    }

    const indices = new Map();
    let cursor = used.size > 0 ? Math.max(...Array.from(used)) + 1 : 1;
    for (const pid of providerIds) {
      indices.set(pid, cursor++);
    }

    return { indices, turn, responses };
  }

  async _persistProbeResult({
    aiTurnId,
    probeSessionId,
    providerId,
    modelIndex,
    text,
    geometryResult,
    now,
  }) {
    const adapter = this.services?.sessionManager?.adapter;
    if (!adapter) return;
    const turn = await adapter.get('turns', aiTurnId);
    if (!turn) return;

    const sessionId = turn.sessionId || '';
    const existingResponses = await adapter.getResponsesByTurnId(aiTurnId);
    const sameProvider = (existingResponses || []).filter(
      (r) => r?.providerId === providerId && r?.responseType === 'probe'
    );
    const nextResponseIndex =
      sameProvider.length > 0
        ? Math.max(...sameProvider.map((r) => Number(r?.responseIndex) || 0)) + 1
        : 0;

    const citationSourceOrder = {
      ...(turn?.mapping?.artifact?.citationSourceOrder || turn?.mapping?.citationSourceOrder || {}),
      [modelIndex]: providerId,
    };

    const paragraphTexts = (geometryResult?.shadowParagraphs || [])
      .map((p) => p?._fullParagraph || '')
      .filter(Boolean);
    const probeResponseId = `pr-${sessionId}-${aiTurnId}-${providerId}-probe-${nextResponseIndex}-${now}`;
    await adapter.put('provider_responses', {
      id: probeResponseId,
      sessionId,
      aiTurnId,
      providerId,
      responseType: 'probe',
      responseIndex: nextResponseIndex,
      text: text || '',
      status: 'completed',
      meta: {
        modelIndex,
        modelName: this._providerDisplayName(providerId),
        paragraphCount: paragraphTexts.length,
        paragraphTexts,
      },
      createdAt: now,
      updatedAt: now,
      completedAt: now,
    });

    const embeddingsId = `probe:${aiTurnId}:${modelIndex}`;
    if (geometryResult?.packed?.paragraphEmbeddings && geometryResult?.packed?.meta) {
      await adapter.putBinary('embeddings', {
        id: embeddingsId,
        aiTurnId: embeddingsId,
        statementEmbeddings: geometryResult.packed.statementEmbeddings,
        paragraphEmbeddings: geometryResult.packed.paragraphEmbeddings,
        meta: {
          ...geometryResult.packed.meta,
          parentTurnId: aiTurnId,
          modelIndex,
          providerId,
          probe: true,
        },
        createdAt: now,
        updatedAt: now,
      });
    }

    await adapter.put('metadata', {
      key: embeddingsId,
      entityId: aiTurnId,
      sessionId,
      type: 'probe_geo_record',
      providerId,
      modelIndex,
      value: {
        embeddingId: embeddingsId,
        providerId,
        modelIndex,
        paragraphs: paragraphTexts,
        paragraphIds: geometryResult?.packed?.meta?.paragraphIndex || [],
      },
      createdAt: now,
      updatedAt: now,
    });

    await this._upsertProbeSessionOnTurn(aiTurnId, probeSessionId, (existingSession) => {
      const baseSession = existingSession || {
        id: probeSessionId,
        queryText: '',
        searchResults: [],
        providerIds: [providerId],
        responses: {},
        status: 'probing',
        createdAt: now,
        updatedAt: now,
      };
      const nextResponses = {
        ...(baseSession.responses || {}),
        [providerId]: {
          providerId,
          modelIndex,
          modelName: this._providerDisplayName(providerId),
          text: text || '',
          paragraphs: paragraphTexts,
          status: 'completed',
          createdAt: baseSession.responses?.[providerId]?.createdAt || baseSession.createdAt || now,
          updatedAt: now,
        },
      };
      const providerIds = Array.from(new Set([...(baseSession.providerIds || []), providerId]));
      const responseStatuses = Object.values(nextResponses).map((response) => response?.status);
      const isComplete =
        providerIds.length > 0 &&
        providerIds.every((pid) => {
          const status = nextResponses[pid]?.status;
          return status === 'completed' || status === 'error';
        });
      return {
        ...baseSession,
        providerIds,
        responses: nextResponses,
        status: isComplete ? 'complete' : 'probing',
        updatedAt: now,
      };
    });

    const refreshedTurn = await adapter.get('turns', aiTurnId);
    const updatedTurn = {
      ...(refreshedTurn || turn),
      updatedAt: now,
      mapping: {
        ...((refreshedTurn || turn).mapping || {}),
        artifact: {
          ...((refreshedTurn || turn).mapping?.artifact || {}),
          citationSourceOrder,
        },
      },
    };
    await adapter.put('turns', updatedTurn);
  }

  async _handleProbeQuery(message) {
    const {
      aiTurnId,
      queryText,
      searchResults,
      nnParagraphs,
      enabledProviders,
      probeSessionId: incomingProbeSessionId,
    } = message?.payload || {};
    if (!aiTurnId || !String(queryText || '').trim()) return;

    const orchestrator = this.services?.orchestrator;
    const providerRegistry = this.services?.providerRegistry;
    const sessionManager = this.services?.sessionManager;
    if (!orchestrator || !providerRegistry || !sessionManager?.adapter) return;

    const requestedProviders =
      Array.isArray(enabledProviders) && enabledProviders.length > 0
        ? Array.from(
            new Set(
              enabledProviders
                .map((providerId) => String(providerId || '').toLowerCase())
                .filter(Boolean)
            )
          )
        : [];
    const probeProviders = requestedProviders.filter((pid) => providerRegistry.isAvailable(pid));
    const probeSessionId =
      incomingProbeSessionId ||
      `probe-${aiTurnId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const normalizedSearchResults = Array.isArray(searchResults)
      ? searchResults.map((result) => ({
          paragraphId: result?.paragraphId || '',
          similarity: Number(result?.similarity || 0),
          normalizedSim: Number(result?.normalizedSim || 0),
          modelIndex: Number(result?.modelIndex || 0),
          paragraphIndex: Number(result?.paragraphIndex || 0),
          text: String(result?.text || ''),
        }))
      : [];
    const sessionStartedAt = Date.now();
    if (probeProviders.length === 0) {
      await this._enqueueProbePersistence(aiTurnId, () =>
        this._upsertProbeSessionOnTurn(aiTurnId, probeSessionId, () =>
          this._buildProbeSessionRecord({
            probeSessionId,
            queryText,
            searchResults: normalizedSearchResults,
            providerIds: [],
            indices: new Map(),
            now: sessionStartedAt,
          })
        )
      );
      this._postProbeSessionStart(
        aiTurnId,
        probeSessionId,
        queryText,
        normalizedSearchResults,
        [],
        new Map()
      );
      return;
    }

    const { indices } = await this._nextProbeModelIndices(aiTurnId, probeProviders);
    const providerContexts = this._buildFreshProbeContexts(probeProviders);
    await this._enqueueProbePersistence(aiTurnId, () =>
      this._upsertProbeSessionOnTurn(aiTurnId, probeSessionId, () =>
        this._buildProbeSessionRecord({
          probeSessionId,
          queryText,
          searchResults: normalizedSearchResults,
          providerIds: probeProviders,
          indices,
          now: sessionStartedAt,
        })
      )
    );
    this._postProbeSessionStart(
      aiTurnId,
      probeSessionId,
      queryText,
      normalizedSearchResults,
      probeProviders,
      indices
    );

    const prompt = this._buildProbePrompt(queryText, nnParagraphs);
    const pending = new Set(probeProviders);
    const probeAccumulated = new Map(); // track full text per provider to compute deltas

    await new Promise((resolve) => {
      orchestrator.executeParallelFanout(prompt, probeProviders, {
        sessionId: `probe-${aiTurnId}-${Date.now()}`,
        useThinking: false,
        providerContexts,
        onPartial: (providerId, chunk) => {
          const modelIndex = indices.get(providerId) || 0;
          const rawText = typeof chunk === 'string' ? chunk : chunk?.text || '';
          // Compute delta: if the new text starts with what we already sent,
          // it's a full-replacement provider (like Qwen) — only send the new suffix.
          const previousText = probeAccumulated.get(providerId) || '';
          // Detect full-replacement chunks (like Qwen) vs incremental chunks.
          // Full-replacement: new text contains all previously sent text as a prefix.
          // Incremental: new text is just the delta to append.
          const isFullReplacement =
            rawText.length >= previousText.length && rawText.startsWith(previousText);
          const newAccumulated = isFullReplacement ? rawText : previousText + rawText;
          probeAccumulated.set(providerId, newAccumulated);
          const delta =
            newAccumulated.length > previousText.length
              ? newAccumulated.slice(previousText.length)
              : '';
          if (!delta) return; // nothing new
          this.port?.postMessage({
            type: 'PROBE_CHUNK',
            aiTurnId,
            probeSessionId,
            modelIndex,
            modelName: this._providerDisplayName(providerId),
            providerId,
            chunk: delta,
          });
        },
        onProviderComplete: (providerId, resultWrapper) => {
          const modelIndex = indices.get(providerId) || 0;
          (async () => {
            try {
              let text = '';
              if (resultWrapper?.status === 'fulfilled') {
                text = String(resultWrapper?.value?.text || '').trim();
              } else {
                text = '';
              }

              const { computeProbeGeometry } = await import('./execution/deterministicPipeline');
              const geometryResult = await computeProbeGeometry({
                modelIndex,
                content: text,
              });
              const now = Date.now();
              await this._enqueueProbePersistence(aiTurnId, () =>
                this._persistProbeResult({
                  aiTurnId,
                  probeSessionId,
                  providerId,
                  modelIndex,
                  text,
                  geometryResult,
                  now,
                })
              );

              this.port?.postMessage({
                type: 'PROBE_COMPLETE',
                aiTurnId,
                probeSessionId,
                result: {
                  modelIndex,
                  modelName: this._providerDisplayName(providerId),
                  providerId,
                  text,
                  paragraphs: (geometryResult?.shadowParagraphs || [])
                    .map((p) => p?._fullParagraph || '')
                    .filter(Boolean),
                  embeddings: geometryResult?.packed?.meta
                    ? {
                        paragraphIds: geometryResult.packed.meta.paragraphIndex || [],
                        dimensions: geometryResult.packed.meta.dimensions || 0,
                      }
                    : undefined,
                },
              });
            } catch (error) {
              this.port?.postMessage({
                type: 'PROBE_COMPLETE',
                aiTurnId,
                probeSessionId,
                result: {
                  modelIndex,
                  modelName: this._providerDisplayName(providerId),
                  providerId,
                  text: '',
                  paragraphs: [],
                },
                error: error?.message || String(error),
              });
            } finally {
              pending.delete(providerId);
              if (pending.size === 0) resolve();
            }
          })();
        },
        onAllComplete: () => {
          if (pending.size === 0) resolve();
        },
        onError: () => {
          resolve();
        },
      });
    });
  }

  async _handleRetryProviders(message) {
    const { sessionId, aiTurnId, providerIds, retryScope } = message || {};
    if (!sessionId || !aiTurnId || !Array.isArray(providerIds) || providerIds.length === 0) {
      console.warn('[ConnectionHandler] Invalid RETRY_PROVIDERS payload', message);
      return;
    }

    const scope = retryScope === 'mapping' ? 'mapping' : 'batch';

    try {
      if (this.workflowEngine && typeof this.workflowEngine.handleRetryRequest === 'function') {
        await this.workflowEngine.handleRetryRequest(message);
      }
    } catch (_) {}

    for (const providerId of providerIds) {
      if (!providerId || typeof providerId !== 'string') continue;
      await this._handleExecuteWorkflow({
        payload: {
          type: 'recompute',
          sessionId,
          sourceTurnId: aiTurnId,
          stepType: scope,
          targetProvider: providerId,
        },
      });
    }
  }

  /**
   * Handle EXECUTE_WORKFLOW message
   */
  async _handleExecuteWorkflow(message) {
    let executeRequest = message.payload;
    let resolvedContext = null;

    const VALID_TYPES = ['initialize', 'extend', 'recompute'];

    // Recompute guard: prevent concurrent recomputes for the same turn+provider+step.
    let _recomputeKey = null;
    if (executeRequest?.type === 'recompute') {
      const { sessionId, sourceTurnId, stepType, targetProvider } = executeRequest;
      _recomputeKey = `${sessionId}:${sourceTurnId}:${stepType}:${targetProvider}`;
      if (this._activeRecomputes.has(_recomputeKey)) {
        console.warn(
          `[ConnectionHandler] Recompute already active for ${_recomputeKey}, skipping duplicate`
        );
        return;
      }
      this._activeRecomputes.add(_recomputeKey);
    }

    if (!executeRequest || !VALID_TYPES.includes(executeRequest.type)) {
      const errorMsg = `Invalid request type: ${executeRequest?.type}. Must be one of: ${VALID_TYPES.join(', ')}`;
      console.error(`[ConnectionHandler] ${errorMsg}`);

      try {
        this.port.postMessage({
          type: 'WORKFLOW_COMPLETE',
          sessionId: executeRequest?.sessionId || 'unknown',
          error: errorMsg,
        });
      } catch (_) {}

      return;
    }

    try {
      // ========================================================================
      // Idempotency Guard: short-circuit duplicate requests
      // Minimal behavior per invariants:
      // - If mapping exists for clientUserTurnId → re-emit TURN_CREATED
      // - If persisted results exist → emit TURN_FINALIZED from persistence
      // - Do NOT poll inflight or re-fanout providers
      // ========================================================================
      const idemKeyEarly = this._buildIdempotencyKey(executeRequest);
      if (idemKeyEarly && this.services?.sessionManager?.adapter) {
        try {
          const existing = await this.services.sessionManager.adapter.get('metadata', idemKeyEarly);
          if (existing && existing.entityId) {
            const sessionIdForEmit = existing.sessionId || executeRequest.sessionId || 'unknown';
            const histUserTurnId = executeRequest?.historicalContext?.userTurnId;
            const userTurnIdEarly =
              executeRequest?.clientUserTurnId ||
              executeRequest?.userTurnId ||
              histUserTurnId ||
              'unknown';

            try {
              if (executeRequest?.type !== 'recompute') {
                this.port.postMessage({
                  type: 'TURN_CREATED',
                  sessionId: sessionIdForEmit,
                  userTurnId: userTurnIdEarly,
                  aiTurnId: existing.entityId,
                  providers: executeRequest.providers || [],
                  mappingProvider: executeRequest.mapper || null,
                });
              }
            } catch (_) {}

            // If we already have responses → emit finalized; otherwise return without recompute
            try {
              const responses = await this.services.sessionManager.adapter.getResponsesByTurnId(
                existing.entityId
              );
              const hasAny = Array.isArray(responses) && responses.length > 0;
              if (hasAny) {
                await this._emitFinalizedFromPersistence(sessionIdForEmit, existing.entityId);
              }
            } catch (_) {}
            return; // ✅ Duplicate handled via rehydrate only
          }
        } catch (_) {}
      }

      // ========================================================================
      // PHASE 5: Primitives-only execution path (fail-fast on legacy)
      // ========================================================================
      const isPrimitive =
        executeRequest &&
        typeof executeRequest.type === 'string' &&
        ['initialize', 'extend', 'recompute'].includes(executeRequest.type);
      if (!isPrimitive) {
        const errMsg =
          '[ConnectionHandler] Non-primitive request rejected. Use {type:"initialize"|"extend"|"recompute"} primitives only.';
        console.error(errMsg, { received: executeRequest });
        try {
          this.port.postMessage({
            type: 'WORKFLOW_STEP_UPDATE',
            sessionId: executeRequest?.sessionId || 'unknown',
            stepId: 'validate-primitive',
            status: 'failed',
            error:
              'Legacy ExecuteWorkflowRequest is no longer supported. Please migrate to primitives.',
            // Attach recompute metadata when applicable
            isRecompute: executeRequest?.type === 'recompute',
            sourceTurnId: executeRequest?.sourceTurnId,
          });
          this.port.postMessage({
            type: 'WORKFLOW_COMPLETE',
            sessionId: executeRequest?.sessionId || 'unknown',
            error: 'Legacy ExecuteWorkflowRequest is no longer supported.',
          });
        } catch (_) {}
        return;
      }

      // Phase 5 path: Resolve → Map → Compile → Execute
      console.log(`[ConnectionHandler] Processing ${executeRequest.type} primitive`);

      if (executeRequest.type === 'recompute') {
        if (executeRequest.stepType === 'singularity') {
          if (
            this.workflowEngine &&
            typeof this.workflowEngine.handleContinueCognitiveRequest === 'function'
          ) {
            await this.workflowEngine.handleContinueCognitiveRequest({
              sessionId: executeRequest.sessionId,
              aiTurnId: executeRequest.sourceTurnId,
              providerId: executeRequest.targetProvider,
              isRecompute: true,
              sourceTurnId: executeRequest.sourceTurnId,
              useThinking: !!executeRequest.useThinking,
            });
          } else {
            console.warn(
              '[ConnectionHandler] Singularity recompute requested but workflowEngine is not ready'
            );
          }
          return;
        }
      }

      // Step 1: Resolve context
      try {
        resolvedContext = await this.services.contextResolver.resolve(executeRequest);
        console.log(`[ConnectionHandler] Context resolved: ${resolvedContext.type}`);
      } catch (e) {
        console.error('[ConnectionHandler] Context resolution failed:', e);
        throw e;
      }

      // Step 2: Preflight authorization + smart defaults routing (cached 60s)
      try {
        await this._applyPreflightSmartDefaults(executeRequest);
      } catch (e) {
        console.warn('[ConnectionHandler] Preflight smart-defaults failed:', e);
      }

      // Step 3: No mapping needed - compiler accepts primitives + resolvedContext
      console.log('[ConnectionHandler] Passing primitive directly to compiler');

      // ========================================================================
      // Validation
      // ========================================================================
      const histUserTurnId = executeRequest?.historicalContext?.userTurnId;
      // Prefer primitive's clientUserTurnId; fall back to legacy userTurnId
      const userTurnId =
        executeRequest?.clientUserTurnId || executeRequest?.userTurnId || histUserTurnId;
      const hasBatch =
        Array.isArray(executeRequest?.providers) && executeRequest.providers.length > 0;

      // Generate session ID if needed
      if (!executeRequest?.sessionId || executeRequest.sessionId === '') {
        executeRequest.sessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        console.log('[ConnectionHandler] Generated session ID:', executeRequest.sessionId);
      }

      // ========================================================================
      // Compile
      // ========================================================================
      const workflowRequest = this.services.compiler.compile(executeRequest, resolvedContext);

      if (executeRequest.type === 'recompute' && executeRequest.sourceTurnId) {
        workflowRequest.context = {
          ...(workflowRequest.context || {}),
          canonicalAiTurnId: executeRequest.sourceTurnId,
        };
      }

      const firstPromptStep = Array.isArray(workflowRequest?.steps)
        ? workflowRequest.steps.find((s) => s && s.type === 'prompt')
        : null;
      const effectiveProviders =
        Array.isArray(firstPromptStep?.payload?.providers) &&
        firstPromptStep.payload.providers.length > 0
          ? firstPromptStep.payload.providers
          : executeRequest.providers || [];
      // ========================================================================
      // TURN_CREATED message
      // ========================================================================
      const createsNewTurn = executeRequest.type !== 'recompute' && hasBatch;
      if (createsNewTurn) {
        const aiTurnId = `ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        workflowRequest.context = {
          ...workflowRequest.context,
          canonicalUserTurnId: userTurnId,
          canonicalAiTurnId: aiTurnId,
        };

        try {
          this.port.postMessage({
            type: 'TURN_CREATED',
            sessionId: workflowRequest.context.sessionId || executeRequest.sessionId,
            userTurnId,
            aiTurnId,
            // ✅ Include actual providers being used so UI doesn't guess from stale state
            providers: effectiveProviders,
            mappingProvider: executeRequest.mapper || null,
          });
        } catch (_) {}

        try {
          const key = `inflight:${workflowRequest.context.sessionId}:${aiTurnId}`;
          const runId = crypto.randomUUID();
          workflowRequest.context = {
            ...workflowRequest.context,
            runId,
          };
          await this.services.sessionManager.adapter.put('metadata', {
            key,
            sessionId: workflowRequest.context.sessionId,
            entityId: aiTurnId,
            type: 'inflight_workflow',
            requestType: executeRequest.type,
            userMessage: executeRequest.userMessage,
            userTurnId,
            providers: effectiveProviders,
            providerMeta: executeRequest.providerMeta || {},
            runId,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });
          // Also record idempotency mapping so reconnect retries don't duplicate fanout
          const idemKey = this._buildIdempotencyKey(executeRequest);
          if (idemKey) {
            await this.services.sessionManager.adapter.put('metadata', {
              key: idemKey,
              sessionId: workflowRequest.context.sessionId,
              entityId: aiTurnId,
              type: 'request_idempotency',
              requestType: executeRequest.type,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            });
          }
        } catch (_) {}
      }

      // ========================================================================
      // Execute
      // ========================================================================
      const engine = this.workflowEngine;
      if (!engine) {
        throw new Error('WorkflowEngine not initialized');
      }
      await engine.execute(workflowRequest, resolvedContext);

      try {
        const key = `inflight:${workflowRequest.context.sessionId}:${workflowRequest.context.canonicalAiTurnId}`;
        await this.services.sessionManager.adapter.delete('metadata', key);
      } catch (_) {}
    } catch (error) {
      console.error('[ConnectionHandler] Workflow failed:', error);
      try {
        const msg = error instanceof Error ? error.message : String(error);
        this.port?.postMessage({
          type: 'WORKFLOW_STEP_UPDATE',
          sessionId: executeRequest?.sessionId || 'unknown',
          stepId: 'handler-error',
          status: 'failed',
          error: msg,
          // Attach recompute metadata when applicable
          isRecompute: executeRequest?.type === 'recompute',
          sourceTurnId: executeRequest?.sourceTurnId,
        });
        this.port?.postMessage({
          type: 'WORKFLOW_COMPLETE',
          sessionId: executeRequest?.sessionId || 'unknown',
          error: msg,
        });
      } catch (e) {
        console.error('[ConnectionHandler] Failed to send error message:', e);
      }
    } finally {
      if (_recomputeKey) this._activeRecomputes.delete(_recomputeKey);
    }
  }

  /**
   * CRITICAL: Ensure session is fully hydrated from persistence
   * This solves the SW restart context loss bug
   */
  // Legacy hydration helper removed: session hydration now handled by persistence-backed readers

  /**
   * Preflight authorization check and smart-defaults routing.
   * - Runs after Context Resolution, before Compilation.
   * - Caches auth status for 60s to avoid repeated cookie reads.
   * - Filters unauth providers from batch.
   * - Selects mapper/refiner/antagonist defaults when missing.
   * - Applies ephemeral fallback when a locked provider is unavailable.
   */
  async _applyPreflightSmartDefaults(executeRequest) {
    // Use centralized AuthManager
    const authStatus = await authManager.getAuthStatus();
    const availableProviders = this.services.providerRegistry?.listProviders?.() || [];

    // Run preflight (handles filtering + fallbacks)
    const result = await runPreflight(
      {
        providers: executeRequest.providers,
        mapper: executeRequest.mapper,
        singularity: executeRequest.singularity,
      },
      authStatus,
      availableProviders
    );

    // Apply results
    executeRequest.providers = result.providers;
    executeRequest.mapper = result.mapper;
    executeRequest.singularity = result.singularity;

    // Emit warnings (not errors!)
    if (result.warnings.length > 0) {
      this.port.postMessage({
        type: 'PREFLIGHT_WARNINGS',
        sessionId: executeRequest.sessionId,
        warnings: result.warnings,
      });
    }

    // ONLY fail if zero providers available
    const hasAnyProvider =
      result.providers.length > 0 || result.mapper !== null || result.singularity !== null;

    if (!hasAnyProvider) {
      const attempted = [
        ...(executeRequest.providers || []),
        executeRequest.mapper,
        executeRequest.singularity,
      ].filter(Boolean);

      const errorMsg =
        createAuthErrorMessage(
          attempted,
          'Pre-workflow validation found no authorized providers'
        ) ||
        `No authorized providers available. Attempted: ${attempted.join(', ')}. Please log in to at least one AI service.`;

      throw new Error(errorMsg);
    }
  }

  /**
   * Handle abort message
   */
  async _handleAbort(message) {
    if (message.sessionId && this.services?.orchestrator) {
      this.services.orchestrator._abortRequest(message.sessionId);
    }
  }

  /**
   * Send error back to UI
   */
  _sendError(originalMessage, error) {
    this.port.postMessage({
      type: 'WORKFLOW_STEP_UPDATE',
      sessionId: originalMessage.payload?.sessionId || 'unknown',
      stepId: 'handler-error',
      status: 'failed',
      error: error.message || String(error),
    });
  }

  /**
   * Cleanup on disconnect
   */
  _cleanup() {
    console.log('[ConnectionHandler] Cleaning up connection');

    // Remove message listener
    if (this.messageHandler) {
      try {
        this.port.onMessage.removeListener(this.messageHandler);
      } catch (e) {
        // Port may already be dead
      }
    }

    // Drop any pending probe persistence queues so their promise chains
    // don't keep references to the stale services/adapter alive.
    if (this._probePersistenceQueues) {
      this._probePersistenceQueues.clear();
    }

    // Null out references for GC
    this.workflowEngine = null;
    this.messageHandler = null;
    this.port = null;
    this.services = null;
    this._servicesProvider = null;
    this.backendInitPromise = null;
    this.lifecycleManager = null;
    this.isInitialized = false;
  }
}

import { WorkflowEngine } from '../execution/workflow-engine.js';
import { runPreflight, createAuthErrorMessage } from '../execution/preflight-validator.js';
import { authManager } from '../providers/auth-manager.js';
import { DEFAULT_THREAD, PROBE_SESSION_START } from '../../shared/messaging.js';
import { getArtifactParagraphs } from '../../shared/corpus-utils.js';
import { computeProbeGeometry } from '../execution/deterministic-pipeline.js';
import { logInfraError } from '../errors';
import type { PrimitiveWorkflowRequest, ResolvedContext } from '../../shared/types/contract.js';
import type { ProbeCorpusHit } from '../../shared/types/turns.js';
import type { SessionManager } from '../persistence/session-manager.js';

// ── Local interfaces ────────────────────────────────────────────────────────

interface Orchestrator {
  executeParallelFanout(prompt: string, providerIds: string[], options: FanoutOptions): void;
  _abortRequest(sessionId: string): void;
}

interface FanoutOptions {
  sessionId?: string;
  useThinking?: boolean;
  providerContexts?: Record<string, unknown>;
  providerMeta?: Record<string, unknown>;
  onPartial?: (providerId: string, chunk: unknown) => void;
  onProviderComplete?: (
    providerId: string,
    outcome: {
      status: 'fulfilled' | 'rejected';
      value?: unknown;
      reason?: unknown;
      providerResponse?: unknown;
    }
  ) => void;
  onAllComplete?: (
    results: Map<string, unknown>,
    errors: Map<string, unknown>
  ) => void | Promise<void>;
  onError?: (error: unknown) => void;
}

interface ProviderRegistry {
  isAvailable(providerId: string): boolean;
  listProviders(): string[];
}

interface ContextResolver {
  resolve(request: { type: string; [key: string]: unknown }): Promise<ResolvedContext>;
}

interface WorkflowCompiler {
  compile(request: PrimitiveWorkflowRequest, context: ResolvedContext): CompiledWorkflowRequest;
}

interface CompiledWorkflowRequest {
  workflowId: string;
  context: WorkflowExecutionContext;
  steps: Array<{ stepId: string; type: string; payload: Record<string, unknown> }>;
}

interface WorkflowExecutionContext {
  sessionId: string;
  threadId?: string;
  targetUserTurnId?: string;
  canonicalAiTurnId?: string;
  canonicalUserTurnId?: string;
  runId?: string;
  [key: string]: unknown;
}

interface LifecycleManager {
  recordActivity(): void;
}

interface Services {
  orchestrator: Orchestrator;
  sessionManager: Pick<SessionManager, 'adapter'>;
  providerRegistry: ProviderRegistry;
  contextResolver: ContextResolver;
  compiler: WorkflowCompiler;
  lifecycleManager?: LifecycleManager | null;
}

/** Incoming payload from EXECUTE_WORKFLOW — union of all primitive fields */
interface ExecuteRequest {
  type: 'initialize' | 'extend' | 'recompute';
  sessionId?: string | null;
  userMessage?: string;
  providers?: string[];
  mapper?: string | null;
  singularity?: string | null;
  useThinking?: boolean;
  providerMeta?: Record<string, unknown>;
  clientUserTurnId?: string;
  userTurnId?: string;
  historicalContext?: { userTurnId?: string };
  // recompute-specific
  sourceTurnId?: string;
  stepType?: string;
  targetProvider?: string;
  frozenSingularityPromptType?: string;
  frozenSingularityPromptSeed?: unknown;
}

interface ProbeGeometryResult {
  shadowParagraphs?: Array<{ _fullParagraph?: string }>;
  packed?: {
    paragraphEmbeddings?: ArrayBuffer;
    statementEmbeddings?: ArrayBuffer;
    meta?: {
      modelIndex?: number;
      dimensions?: number;
      paragraphIndex?: string[];
      parentTurnId?: string;
      providerId?: string;
      probe?: boolean;
    };
  } | null;
}

interface ProbeSessionEntry {
  id: string;
  queryText: string;
  searchResults: ProbeCorpusHit[];
  providerIds: string[];
  responses: Record<string, ProbeSessionResponse>;
  status: 'searching' | 'probing' | 'complete';
  createdAt: number;
  updatedAt: number;
}

interface ProbeSessionResponse {
  providerId: string;
  modelIndex: number;
  modelName: string;
  text: string;
  paragraphs: string[];
  status: 'streaming' | 'completed' | 'error';
  createdAt?: number;
  updatedAt?: number;
}

// ── ConnectionHandler ───────────────────────────────────────────────────────

export class ConnectionHandler {
  private port: chrome.runtime.Port | null;
  private services: Services | null;
  private _servicesProvider: (() => Promise<Services>) | null;
  private workflowEngine: WorkflowEngine | null;
  private messageHandler: ((message: unknown) => Promise<void>) | null;
  private isInitialized: boolean;
  private lifecycleManager: LifecycleManager | null;
  private backendInitPromise: Promise<void> | null;
  private _activeRecomputes: Set<string>;
  private _probePersistenceQueues: Map<string, Promise<unknown>>;

  private static activeConnections = new Set<ConnectionHandler>();

  constructor(port: chrome.runtime.Port, servicesOrProvider: Services | (() => Promise<Services>)) {
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

  async init(): Promise<void> {
    if (this.isInitialized) return;
    if (!this.port) throw new Error('[ConnectionHandler] Cannot init: port is null');

    this.messageHandler = this._createMessageHandler();
    this.port.onMessage.addListener(this.messageHandler);
    this.port.onDisconnect.addListener(() => this._cleanup());
    ConnectionHandler.activeConnections.add(this);

    this.isInitialized = true;
    console.log('[ConnectionHandler] Initialized for port:', this.port.name);

    try {
      this.port.postMessage({ type: 'HANDLER_READY' });
    } catch {
      // port may already be closed
    }

    void this._ensureBackendReady().catch((error: unknown) => {
      try {
        this.port?.postMessage({
          type: 'INITIALIZATION_FAILED',
          error: error instanceof Error ? error.message : String(error),
        });
      } catch {
        // port closed
      }
    });
  }

  private async _ensureBackendReady(): Promise<void> {
    if (this.workflowEngine && this.services) return;
    if (this.backendInitPromise) return this.backendInitPromise;

    this.backendInitPromise = (async () => {
      if (!this.services) {
        if (!this._servicesProvider) throw new Error('Services provider not configured');
        this.services = await this._servicesProvider();
      }

      if (!this.services) throw new Error('Services unavailable');
      if (!this.port) throw new Error('Port closed during initialization');

      this.lifecycleManager = this.services.lifecycleManager ?? null;

      this.workflowEngine = new WorkflowEngine(
        this.services.orchestrator,
        this.services.sessionManager,
        this.port
      );
    })().catch((e: unknown) => {
      this.backendInitPromise = null;
      throw e;
    });

    return this.backendInitPromise;
  }

  private _buildIdempotencyKey(req: ExecuteRequest | null): string | null {
    if (!req || typeof req !== 'object') return null;
    const clientUserTurnId =
      req.clientUserTurnId ?? req.userTurnId ?? req.historicalContext?.userTurnId ?? null;

    try {
      if (req.type === 'initialize') {
        if (!clientUserTurnId) return null;
        return `idem:init:${clientUserTurnId}`;
      }
      if (req.type === 'extend') {
        if (!clientUserTurnId || !req.sessionId) return null;
        return `idem:${req.sessionId}:${clientUserTurnId}`;
      }
      if (req.type === 'recompute') {
        const { sessionId, sourceTurnId, stepType, targetProvider } = req;
        if (!sessionId || !sourceTurnId || !stepType || !targetProvider) return null;
        return `idem:recompute:${sessionId}:${sourceTurnId}:${stepType}:${targetProvider}`;
      }
    } catch (e: unknown) {
      console.warn('[ConnectionHandler] Error building idempotency key:', e);
    }
    return null;
  }

  private async _emitFinalizedFromPersistence(sessionId: string, aiTurnId: string): Promise<void> {
    const adapter = this.services?.sessionManager?.adapter;
    if (!adapter) return;

    const aiTurn = await adapter.get('turns', aiTurnId);
    if (!aiTurn || (aiTurn['type'] !== 'ai' && aiTurn['role'] !== 'assistant')) return;

    const userTurnId = aiTurn['userTurnId'] as string | undefined;
    const userTurn = userTurnId ? await adapter.get('turns', userTurnId) : null;

    const resps = await adapter.getResponsesByTurnId(aiTurnId);
    const batchResponses: Record<string, Array<Record<string, unknown>>> = {};
    for (const r of resps ?? []) {
      if (!r || r['responseType'] !== 'batch') continue;
      const pid = r['providerId'] as string;
      const entry = {
        providerId: pid,
        text: r['text'] ?? '',
        status: r['status'] ?? 'completed',
        createdAt: r['createdAt'] ?? Date.now(),
        updatedAt: r['updatedAt'] ?? r['createdAt'] ?? Date.now(),
        meta: r['meta'] ?? {},
        responseIndex: r['responseIndex'] ?? 0,
      };
      (batchResponses[pid] ??= []).push(entry);
    }

    for (const pid of Object.keys(batchResponses)) {
      batchResponses[pid].sort(
        (a, b) => ((a['responseIndex'] as number) ?? 0) - ((b['responseIndex'] as number) ?? 0)
      );
    }

    const hasAny =
      Object.keys(batchResponses).length > 0 ||
      !!aiTurn['batch'] ||
      !!aiTurn['mapping'] ||
      !!aiTurn['singularity'];
    if (!hasAny) return;

    const batchPhase =
      Object.keys(batchResponses).length > 0
        ? {
            responses: Object.fromEntries(
              Object.entries(batchResponses).map(([pid, arr]) => {
                const last = arr.length > 0 ? arr[arr.length - 1] : arr[0];
                return [
                  pid,
                  {
                    text: last?.['text'] ?? '',
                    modelIndex: (last?.['meta'] as Record<string, unknown>)?.['modelIndex'] ?? 0,
                    status: last?.['status'] ?? 'completed',
                    meta: last?.['meta'],
                  },
                ];
              })
            ),
          }
        : undefined;

    const finalBatch = aiTurn['batch'] ?? batchPhase;
    const finalMapping = aiTurn['mapping'];
    const finalSingularity = aiTurn['singularity'];

    try {
      this.port?.postMessage({
        type: 'TURN_FINALIZED',
        sessionId,
        userTurnId,
        aiTurnId,
        turn: {
          user: userTurn
            ? {
                id: userTurn['id'],
                type: 'user',
                text: userTurn['text'] ?? userTurn['content'] ?? '',
                createdAt: userTurn['createdAt'] ?? Date.now(),
                sessionId,
              }
            : {
                id: userTurnId ?? 'unknown',
                type: 'user',
                text: '',
                createdAt: Date.now(),
                sessionId,
              },
          ai: {
            id: aiTurnId,
            type: 'ai',
            userTurnId: userTurnId ?? 'unknown',
            sessionId,
            threadId: aiTurn['threadId'] ?? DEFAULT_THREAD,
            createdAt: aiTurn['createdAt'] ?? Date.now(),
            ...(finalBatch ? { batch: finalBatch } : {}),
            ...(finalMapping ? { mapping: finalMapping } : {}),
            ...(finalSingularity ? { singularity: finalSingularity } : {}),
            meta: aiTurn['meta'] ?? {},
            pipelineStatus: aiTurn['pipelineStatus'],
          },
        },
      });
    } catch (err) {
      console.warn('[system/connection-handler/_emitFinalizedFromPersistence] postMessage failed — port may be closed:', err);
    }
  }

  private _createMessageHandler(): (message: unknown) => Promise<void> {
    return async (message: unknown) => {
      if (!message || typeof message !== 'object') return;
      const msg = message as Record<string, unknown>;
      if (!msg['type']) return;

      if (msg['type'] === 'KEEPALIVE_PING') {
        try {
          this.port?.postMessage({ type: 'KEEPALIVE_PONG', timestamp: Date.now() });
        } catch (err) {
          console.warn('[ConnectionHandler] KEEPALIVE_PONG failed — port likely closed:', err);
        }
        return;
      }

      if (msg['type'] !== 'reconnect') {
        await this._ensureBackendReady();
      }

      try {
        this.lifecycleManager?.recordActivity();
      } catch (e: unknown) {
        console.warn('[ConnectionHandler] lifecycleManager.recordActivity failed:', e);
      }

      console.log(`[ConnectionHandler] Received: ${msg['type']}`);

      try {
        switch (msg['type']) {
          case 'EXECUTE_WORKFLOW':
            await this._handleExecuteWorkflow(msg as { payload: ExecuteRequest });
            break;
          case 'RETRY_PROVIDERS':
            await this._handleRetryProviders(msg as RetryProvidersMessage);
            break;
          case 'reconnect':
            try {
              this.port?.postMessage({ type: 'reconnect_ack', serverTime: Date.now() });
            } catch (err) {
              console.warn('[ConnectionHandler] reconnect_ack failed — port likely closed:', err);
            }
            break;
          case 'abort':
            await this._handleAbort(msg as { sessionId?: string });
            break;
          case 'CONTINUE_COGNITIVE_WORKFLOW':
            if (this.workflowEngine) {
              await this.workflowEngine.handleContinueCognitiveRequest(msg['payload']);
            }
            break;
          case 'PROBE_QUERY':
            await this._handleProbeQuery(msg as { payload?: Record<string, unknown> });
            break;
          default:
            console.warn(`[ConnectionHandler] Unknown message type: ${msg['type']}`);
        }
      } catch (error: unknown) {
        logInfraError('ConnectionHandler: Message handling failed', error);
        this._sendError(msg, error);
      }
    };
  }

  private _buildProbePrompt(queryText: string, nnParagraphs: unknown[]): string {
    const contextBlock = (Array.isArray(nnParagraphs) ? nnParagraphs : [])
      .map((p, idx) => `${idx + 1}. ${String(p ?? '').trim()}`)
      .filter(Boolean)
      .join('\n');

    return [
      'You are a probe model augmenting a search corpus.',
      `User Query: ${String(queryText ?? '').trim()}`,
      '',
      'Nearest-neighbor corpus paragraphs:',
      contextBlock || '(none)',
      '',
      'Return concise analytical paragraphs that expand or challenge the corpus context.',
    ].join('\n');
  }

  private _providerDisplayName(providerId: string): string {
    const pid = String(providerId ?? '').toLowerCase();
    if (pid === 'gemini') return 'Gemini';
    if (pid === 'qwen') return 'Qwen';
    return providerId;
  }

  private _buildFreshProbeContexts(
    providerIds: string[]
  ): Record<string, { meta: Record<string, unknown>; continueThread: boolean }> {
    return Object.fromEntries(
      providerIds.map((providerId) => [providerId, { meta: {}, continueThread: false }])
    );
  }

  private _buildProbeSessionRecord({
    probeSessionId,
    queryText,
    searchResults,
    providerIds,
    indices,
    now,
  }: {
    probeSessionId: string;
    queryText: string;
    searchResults: ProbeCorpusHit[];
    providerIds: string[];
    indices: Map<string, number>;
    now: number;
  }): ProbeSessionEntry {
    const responses: Record<string, ProbeSessionResponse> = Object.fromEntries(
      providerIds.map((providerId) => [
        providerId,
        {
          providerId,
          modelIndex: indices.get(providerId) ?? 0,
          modelName: this._providerDisplayName(providerId),
          text: '',
          paragraphs: [],
          status: 'streaming' as const,
          createdAt: now,
          updatedAt: now,
        },
      ])
    );

    return {
      id: probeSessionId,
      queryText: String(queryText ?? '').trim(),
      searchResults: Array.isArray(searchResults) ? searchResults : [],
      providerIds: Array.isArray(providerIds) ? providerIds : [],
      responses,
      status: providerIds.length ? 'probing' : 'complete',
      createdAt: now,
      updatedAt: now,
    };
  }

  private _postProbeSessionStart(
    aiTurnId: string,
    probeSessionId: string,
    queryText: string,
    searchResults: ProbeCorpusHit[],
    providerIds: string[],
    indices: Map<string, number>
  ): void {
    try {
      this.port?.postMessage({
        type: PROBE_SESSION_START,
        aiTurnId,
        probeSessionId,
        queryText,
        searchResults: Array.isArray(searchResults) ? searchResults : [],
        probeCount: providerIds.length,
        providerIds,
        modelIndices: providerIds.map((providerId) => ({
          providerId,
          modelIndex: indices.get(providerId) ?? 0,
        })),
      });
    } catch (err) {
      console.warn('[system/connection-handler/_postProbeSessionStart] postMessage failed — port may be closed:', err);
    }
  }

  private async _upsertProbeSessionOnTurn(
    aiTurnId: string,
    probeSessionId: string,
    updater: (
      existing: ProbeSessionEntry | null,
      turn: Record<string, unknown>
    ) => ProbeSessionEntry | null
  ): Promise<Record<string, unknown> | null> {
    const adapter = this.services?.sessionManager?.adapter;
    if (!adapter) return null;
    const turn = await adapter.get('turns', aiTurnId);
    if (!turn) return null;
    const probeSessions: ProbeSessionEntry[] = Array.isArray(turn['probeSessions'])
      ? [...(turn['probeSessions'] as ProbeSessionEntry[])]
      : [];
    const existingIndex = probeSessions.findIndex((s) => s?.id === probeSessionId);
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

  private async _enqueueProbePersistence<T>(aiTurnId: string, task: () => Promise<T>): Promise<T> {
    const previous = this._probePersistenceQueues.get(aiTurnId) ?? Promise.resolve();
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

  private async _nextProbeModelIndices(
    aiTurnId: string,
    providerIds: string[]
  ): Promise<{
    indices: Map<string, number>;
    turn: Record<string, unknown> | undefined;
    responses: Array<Record<string, unknown>>;
  }> {
    const adapter = this.services?.sessionManager?.adapter;
    if (!adapter) {
      const indices = new Map<string, number>();
      let cursor = 1;
      for (const pid of providerIds) indices.set(pid, cursor++);
      return { indices, turn: undefined, responses: [] };
    }
    const turn = await adapter.get('turns', aiTurnId);
    const responses = await adapter.getResponsesByTurnId(aiTurnId);
    const used = new Set<number>();

    const mapping = turn?.['mapping'] as Record<string, unknown> | undefined;
    const artifact = mapping?.['artifact'] as Record<string, unknown> | undefined;
    const mappingOrder =
      (artifact?.['citationSourceOrder'] as Record<string, unknown>) ??
      (mapping?.['citationSourceOrder'] as Record<string, unknown>) ??
      {};
    for (const k of Object.keys(mappingOrder)) {
      const n = Number(k);
      if (Number.isFinite(n) && n > 0) used.add(n);
    }

    for (const r of responses ?? []) {
      const n = Number((r?.['meta'] as Record<string, unknown>)?.['modelIndex']);
      if (Number.isFinite(n) && n > 0) used.add(n);
    }

    const shadowParagraphs = getArtifactParagraphs(artifact) as Array<{ modelIndex?: unknown }>;
    for (const p of shadowParagraphs) {
      const n = Number(p?.['modelIndex']);
      if (Number.isFinite(n) && n > 0) used.add(n);
    }

    const indices = new Map<string, number>();
    let cursor = used.size > 0 ? Math.max(...Array.from(used)) + 1 : 1;
    for (const pid of providerIds) {
      indices.set(pid, cursor++);
    }

    return { indices, turn, responses: responses ?? [] };
  }

  private async _persistProbeResult({
    aiTurnId,
    probeSessionId,
    providerId,
    modelIndex,
    text,
    geometryResult,
    now,
  }: {
    aiTurnId: string;
    probeSessionId: string;
    providerId: string;
    modelIndex: number;
    text: string;
    geometryResult: ProbeGeometryResult;
    now: number;
  }): Promise<void> {
    const adapter = this.services?.sessionManager?.adapter;
    if (!adapter) return;
    const turn = await adapter.get('turns', aiTurnId);
    if (!turn) return;

    const sessionId = (turn['sessionId'] as string) || '';
    const existingResponses = await adapter.getResponsesByTurnId(aiTurnId);
    const sameProvider = (existingResponses ?? []).filter(
      (r) => r?.['providerId'] === providerId && r?.['responseType'] === 'probe'
    );
    const nextResponseIndex =
      sameProvider.length > 0
        ? Math.max(...sameProvider.map((r) => Number(r?.['responseIndex']) || 0)) + 1
        : 0;

    const mapping = turn['mapping'] as Record<string, unknown> | undefined;
    const artifact = mapping?.['artifact'] as Record<string, unknown> | undefined;
    const citationSourceOrder = {
      ...(artifact?.['citationSourceOrder'] as Record<string, unknown> | undefined),
      ...(mapping?.['citationSourceOrder'] as Record<string, unknown> | undefined),
      [modelIndex]: providerId,
    };

    const paragraphTexts = (geometryResult?.shadowParagraphs ?? [])
      .map((p) => p?._fullParagraph ?? '')
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
        paragraphIds: geometryResult?.packed?.meta?.paragraphIndex ?? [],
      },
      createdAt: now,
      updatedAt: now,
    });

    await this._upsertProbeSessionOnTurn(aiTurnId, probeSessionId, (existingSession) => {
      const baseSession: ProbeSessionEntry = existingSession ?? {
        id: probeSessionId,
        queryText: '',
        searchResults: [],
        providerIds: [providerId],
        responses: {},
        status: 'probing',
        createdAt: now,
        updatedAt: now,
      };
      const nextResponses: Record<string, ProbeSessionResponse> = {
        ...(baseSession.responses ?? {}),
        [providerId]: {
          providerId,
          modelIndex,
          modelName: this._providerDisplayName(providerId),
          text: text || '',
          paragraphs: paragraphTexts,
          status: 'completed',
          createdAt: baseSession.responses?.[providerId]?.createdAt ?? baseSession.createdAt ?? now,
          updatedAt: now,
        },
      };
      const allProviderIds = Array.from(new Set([...(baseSession.providerIds ?? []), providerId]));
      const isComplete =
        allProviderIds.length > 0 &&
        allProviderIds.every((pid) => {
          const status = nextResponses[pid]?.status;
          return status === 'completed' || status === 'error';
        });
      return {
        ...baseSession,
        providerIds: allProviderIds,
        responses: nextResponses,
        status: isComplete ? 'complete' : 'probing',
        updatedAt: now,
      };
    });

    const refreshedTurn = await adapter.get('turns', aiTurnId);
    const base = refreshedTurn ?? turn;
    const baseMapping = (base['mapping'] as Record<string, unknown>) ?? {};
    const baseArtifact = (baseMapping['artifact'] as Record<string, unknown>) ?? {};
    const updatedTurn = {
      ...base,
      updatedAt: now,
      mapping: {
        ...baseMapping,
        artifact: {
          ...baseArtifact,
          citationSourceOrder,
        },
      },
    };
    await adapter.put('turns', updatedTurn);
  }

  private async _handleProbeQuery(message: { payload?: Record<string, unknown> }): Promise<void> {
    const payload = message?.payload ?? {};
    const aiTurnId = payload['aiTurnId'] as string | undefined;
    const queryText = String(payload['queryText'] ?? '').trim();
    if (!aiTurnId || !queryText) return;

    const orchestrator = this.services?.orchestrator;
    const providerRegistry = this.services?.providerRegistry;
    const sessionManager = this.services?.sessionManager;
    if (!orchestrator || !providerRegistry || !sessionManager?.adapter) return;

    const enabledProviders = payload['enabledProviders'];
    const requestedProviders =
      Array.isArray(enabledProviders) && enabledProviders.length > 0
        ? Array.from(
            new Set(
              (enabledProviders as unknown[])
                .map((p) => String(p ?? '').toLowerCase())
                .filter(Boolean)
            )
          )
        : [];
    const probeProviders = requestedProviders.filter((pid) => providerRegistry.isAvailable(pid));
    const incomingProbeSessionId = payload['probeSessionId'] as string | undefined;
    const probeSessionId =
      incomingProbeSessionId ??
      `probe-${aiTurnId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const rawSearchResults = payload['searchResults'];
    const normalizedSearchResults: ProbeCorpusHit[] = Array.isArray(rawSearchResults)
      ? (rawSearchResults as Array<Record<string, unknown>>).map((result) => ({
          paragraphId: (result?.['paragraphId'] as string) || '',
          similarity: Number(result?.['similarity'] || 0),
          normalizedSim: Number(result?.['normalizedSim'] || 0),
          modelIndex: Number(result?.['modelIndex'] || 0),
          paragraphIndex: Number(result?.['paragraphIndex'] || 0),
          text: String(result?.['text'] || ''),
        }))
      : [];

    const nnParagraphs = Array.isArray(payload['nnParagraphs'])
      ? (payload['nnParagraphs'] as unknown[])
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
    const probeAccumulated = new Map<string, string>();

    await new Promise<void>((resolve) => {
      orchestrator.executeParallelFanout(prompt, probeProviders, {
        sessionId: `probe-${aiTurnId}-${Date.now()}`,
        useThinking: false,
        providerContexts,
        onPartial: (providerId: string, chunk: unknown) => {
          const modelIndex = indices.get(providerId) ?? 0;
          const rawText =
            typeof chunk === 'string' ? chunk : ((chunk as { text?: string })?.text ?? '');
          const previousText = probeAccumulated.get(providerId) ?? '';
          const isFullReplacement =
            rawText.length >= previousText.length && rawText.startsWith(previousText);
          const newAccumulated = isFullReplacement ? rawText : previousText + rawText;
          probeAccumulated.set(providerId, newAccumulated);
          const delta =
            newAccumulated.length > previousText.length
              ? newAccumulated.slice(previousText.length)
              : '';
          if (!delta) return;
          try {
            this.port?.postMessage({
              type: 'PROBE_CHUNK',
              aiTurnId,
              probeSessionId,
              modelIndex,
              modelName: this._providerDisplayName(providerId),
              providerId,
              chunk: delta,
            });
          } catch {
            // port closed
          }
        },
        onProviderComplete: (
          providerId: string,
          outcome: { status: 'fulfilled' | 'rejected'; value?: unknown }
        ) => {
          const modelIndex = indices.get(providerId) ?? 0;
          void (async () => {
            try {
              let text = '';
              if (outcome?.status === 'fulfilled') {
                text = String((outcome?.value as { text?: unknown })?.text ?? '').trim();
              }

              const geometryResult = (await computeProbeGeometry({
                modelIndex,
                content: text,
              })) as ProbeGeometryResult;

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

              try {
                this.port?.postMessage({
                  type: 'PROBE_COMPLETE',
                  aiTurnId,
                  probeSessionId,
                  result: {
                    modelIndex,
                    modelName: this._providerDisplayName(providerId),
                    providerId,
                    text,
                    paragraphs: (geometryResult?.shadowParagraphs ?? [])
                      .map((p) => p?._fullParagraph ?? '')
                      .filter(Boolean),
                    embeddings: geometryResult?.packed?.meta
                      ? {
                          paragraphIds: geometryResult.packed.meta.paragraphIndex ?? [],
                          dimensions: geometryResult.packed.meta.dimensions ?? 0,
                        }
                      : undefined,
                  },
                });
              } catch {
                // port closed
              }
            } catch (error: unknown) {
              logInfraError(`ConnectionHandler: Probe provider failed for ${providerId}`, error);
              try {
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
                  error: error instanceof Error ? error.message : String(error),
                });
              } catch {
                // port closed
              }
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

  private async _handleRetryProviders(message: RetryProvidersMessage): Promise<void> {
    const { sessionId, aiTurnId, providerIds, retryScope } = message ?? {};
    if (!sessionId || !aiTurnId || !Array.isArray(providerIds) || providerIds.length === 0) {
      console.warn('[ConnectionHandler] Invalid RETRY_PROVIDERS payload', message);
      return;
    }

    const scope = retryScope === 'mapping' ? 'mapping' : 'batch';

    try {
      if (this.workflowEngine && typeof this.workflowEngine.handleRetryRequest === 'function') {
        await this.workflowEngine.handleRetryRequest(message);
      }
    } catch (e: unknown) {
      console.warn('[ConnectionHandler] handleRetryRequest failed:', e);
    }

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

  private async _handleExecuteWorkflow(message: { payload: ExecuteRequest }): Promise<void> {
    let executeRequest = message.payload;
    let resolvedContext: ResolvedContext | null = null;

    const VALID_TYPES = ['initialize', 'extend', 'recompute'] as const;

    let _recomputeKey: string | null = null;
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
        this.port!.postMessage({
          type: 'WORKFLOW_COMPLETE',
          sessionId: executeRequest?.sessionId ?? 'unknown',
          error: errorMsg,
        });
      } catch {
        // port closed
      }
      return;
    }

    try {
      // ── Idempotency guard: short-circuit duplicate requests ──────────────
      const idemKeyEarly = this._buildIdempotencyKey(executeRequest);
      if (idemKeyEarly && this.services?.sessionManager?.adapter) {
        const existing = await this.services.sessionManager.adapter.get('metadata', idemKeyEarly);
        if (existing && existing['entityId']) {
          const sessionIdForEmit =
            (existing['sessionId'] as string) ?? executeRequest.sessionId ?? 'unknown';
          const histUserTurnId = executeRequest?.historicalContext?.userTurnId;
          const userTurnIdEarly =
            executeRequest?.clientUserTurnId ??
            executeRequest?.userTurnId ??
            histUserTurnId ??
            'unknown';

          if (executeRequest?.type !== 'recompute') {
            try {
              this.port!.postMessage({
                type: 'TURN_CREATED',
                sessionId: sessionIdForEmit,
                userTurnId: userTurnIdEarly,
                aiTurnId: existing['entityId'],
                providers: executeRequest.providers ?? [],
                mappingProvider: executeRequest.mapper ?? null,
              });
            } catch {
              // port closed
            }
          }

          try {
            const responses = await this.services.sessionManager.adapter.getResponsesByTurnId(
              existing['entityId'] as string
            );
            if (Array.isArray(responses) && responses.length > 0) {
              await this._emitFinalizedFromPersistence(
                sessionIdForEmit,
                existing['entityId'] as string
              );
            }
          } catch (e: unknown) {
            console.warn('[ConnectionHandler] Failed to emit finalized from persistence:', e);
          }
          return;
        }
      }

      // ── Primitives-only path ─────────────────────────────────────────────
      const isPrimitive =
        executeRequest &&
        typeof executeRequest.type === 'string' &&
        (['initialize', 'extend', 'recompute'] as const).includes(executeRequest.type);
      if (!isPrimitive) {
        const errMsg =
          '[ConnectionHandler] Non-primitive request rejected. Use {type:"initialize"|"extend"|"recompute"} primitives only.';
        console.error(errMsg, { received: executeRequest });
        try {
          this.port!.postMessage({
            type: 'WORKFLOW_STEP_UPDATE',
            sessionId: executeRequest?.sessionId ?? 'unknown',
            stepId: 'validate-primitive',
            status: 'failed',
            error:
              'Legacy ExecuteWorkflowRequest is no longer supported. Please migrate to primitives.',
            isRecompute: executeRequest?.type === 'recompute',
            sourceTurnId: executeRequest?.sourceTurnId,
          });
          this.port!.postMessage({
            type: 'WORKFLOW_COMPLETE',
            sessionId: executeRequest?.sessionId ?? 'unknown',
            error: 'Legacy ExecuteWorkflowRequest is no longer supported.',
          });
        } catch {
          // port closed
        }
        return;
      }

      console.log(`[ConnectionHandler] Processing ${executeRequest.type} primitive`);

      if (executeRequest.type === 'recompute' && executeRequest.stepType === 'singularity') {
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

      // Step 1: Resolve context
      resolvedContext = await this.services!.contextResolver.resolve(
        executeRequest as { type: string; [key: string]: unknown }
      );
      console.log(`[ConnectionHandler] Context resolved: ${resolvedContext.type}`);

      // Step 2: Preflight authorization + smart defaults (cached 60s)
      try {
        await this._applyPreflightSmartDefaults(executeRequest);
      } catch (e: unknown) {
        console.warn('[ConnectionHandler] Preflight smart-defaults failed:', e);
      }

      // Step 3: Compile
      console.log('[ConnectionHandler] Passing primitive directly to compiler');

      const histUserTurnId = executeRequest?.historicalContext?.userTurnId;
      const userTurnId =
        executeRequest?.clientUserTurnId ?? executeRequest?.userTurnId ?? histUserTurnId;
      const hasBatch =
        Array.isArray(executeRequest?.providers) && (executeRequest.providers?.length ?? 0) > 0;

      if (!executeRequest?.sessionId) {
        executeRequest = {
          ...executeRequest,
          sessionId: `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        };
        console.log('[ConnectionHandler] Generated session ID:', executeRequest.sessionId);
      }

      const workflowRequest = this.services!.compiler.compile(
        executeRequest as unknown as PrimitiveWorkflowRequest,
        resolvedContext
      );

      if (executeRequest.type === 'recompute' && executeRequest.sourceTurnId) {
        workflowRequest.context = {
          ...workflowRequest.context,
          canonicalAiTurnId: executeRequest.sourceTurnId,
        };
      }

      const firstPromptStep = workflowRequest.steps.find((s) => s?.type === 'prompt') ?? null;
      const effectiveProviders =
        Array.isArray(firstPromptStep?.payload?.['providers']) &&
        (firstPromptStep.payload['providers'] as unknown[]).length > 0
          ? (firstPromptStep.payload['providers'] as string[])
          : (executeRequest.providers ?? []);

      const createsNewTurn = executeRequest.type !== 'recompute' && hasBatch;
      if (createsNewTurn) {
        const aiTurnId = `ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        workflowRequest.context = {
          ...workflowRequest.context,
          canonicalUserTurnId: userTurnId,
          canonicalAiTurnId: aiTurnId,
        };

        try {
          this.port!.postMessage({
            type: 'TURN_CREATED',
            sessionId: workflowRequest.context.sessionId ?? executeRequest.sessionId,
            userTurnId,
            aiTurnId,
            providers: effectiveProviders,
            mappingProvider: executeRequest.mapper ?? null,
          });
        } catch {
          // port closed
        }

        try {
          const key = `inflight:${workflowRequest.context.sessionId}:${aiTurnId}`;
          const runId = crypto.randomUUID();
          workflowRequest.context = { ...workflowRequest.context, runId };
          await this.services!.sessionManager.adapter!.put('metadata', {
            key,
            sessionId: workflowRequest.context.sessionId,
            entityId: aiTurnId,
            type: 'inflight_workflow',
            requestType: executeRequest.type,
            userMessage: executeRequest.userMessage,
            userTurnId,
            providers: effectiveProviders,
            providerMeta: executeRequest.providerMeta ?? {},
            runId,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });
          const idemKey = this._buildIdempotencyKey(executeRequest);
          if (idemKey) {
            await this.services!.sessionManager.adapter!.put('metadata', {
              key: idemKey,
              sessionId: workflowRequest.context.sessionId,
              entityId: aiTurnId,
              type: 'request_idempotency',
              requestType: executeRequest.type,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            });
          }
        } catch (e: unknown) {
          console.warn('[ConnectionHandler] Failed to write inflight metadata:', e);
        }
      }

      const engine = this.workflowEngine;
      if (!engine) throw new Error('WorkflowEngine not initialized');
      await engine.execute(workflowRequest, resolvedContext);

      try {
        const key = `inflight:${workflowRequest.context.sessionId}:${workflowRequest.context.canonicalAiTurnId}`;
        await this.services!.sessionManager.adapter!.delete('metadata', key);
      } catch (e: unknown) {
        console.warn('[ConnectionHandler] Failed to delete inflight metadata:', e);
      }
    } catch (error: unknown) {
      logInfraError('ConnectionHandler: Workflow failed', error);
      const msg = error instanceof Error ? error.message : String(error);
      try {
        this.port?.postMessage({
          type: 'WORKFLOW_STEP_UPDATE',
          sessionId: executeRequest?.sessionId ?? 'unknown',
          stepId: 'handler-error',
          status: 'failed',
          error: msg,
          isRecompute: executeRequest?.type === 'recompute',
          sourceTurnId: executeRequest?.sourceTurnId,
        });
        this.port?.postMessage({
          type: 'WORKFLOW_COMPLETE',
          sessionId: executeRequest?.sessionId ?? 'unknown',
          error: msg,
        });
      } catch (e: unknown) {
        logInfraError('ConnectionHandler: Failed to send error message', e);
      }
    } finally {
      if (_recomputeKey) this._activeRecomputes.delete(_recomputeKey);
    }
  }

  private async _applyPreflightSmartDefaults(executeRequest: ExecuteRequest): Promise<void> {
    const authStatus = await authManager.getAuthStatus();
    const availableProviders = this.services!.providerRegistry?.listProviders?.() ?? [];

    const result = await runPreflight(
      {
        providers: executeRequest.providers,
        mapper: executeRequest.mapper,
        singularity: executeRequest.singularity,
      },
      authStatus,
      availableProviders
    );

    executeRequest.providers = result.providers;
    executeRequest.mapper = result.mapper;
    executeRequest.singularity = result.singularity;

    if (result.warnings.length > 0) {
      try {
        this.port!.postMessage({
          type: 'PREFLIGHT_WARNINGS',
          sessionId: executeRequest.sessionId,
          warnings: result.warnings,
        });
      } catch {
        // port closed
      }
    }

    const hasAnyProvider =
      result.providers.length > 0 || result.mapper !== null || result.singularity !== null;

    if (!hasAnyProvider) {
      const attempted = [
        ...(executeRequest.providers ?? []),
        executeRequest.mapper,
        executeRequest.singularity,
      ].filter(Boolean) as string[];

      const errorMsg =
        createAuthErrorMessage(
          attempted,
          'Pre-workflow validation found no authorized providers'
        ) ??
        `No authorized providers available. Attempted: ${attempted.join(', ')}. Please log in to at least one AI service.`;

      throw new Error(errorMsg);
    }
  }

  private async _handleAbort(message: { sessionId?: string }): Promise<void> {
    if (message.sessionId && this.services?.orchestrator) {
      this.services.orchestrator._abortRequest(message.sessionId);
    }
  }

  private _sendError(originalMessage: Record<string, unknown>, error: unknown): void {
    if (!this.port || typeof this.port.postMessage !== 'function') return;
    try {
      this.port.postMessage({
        type: 'WORKFLOW_STEP_UPDATE',
        sessionId:
          (originalMessage['payload'] as Record<string, unknown> | undefined)?.['sessionId'] ??
          'unknown',
        stepId: 'handler-error',
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
    } catch (err) {
      console.warn('[system/connection-handler/_sendError] postMessage failed — port may be closed:', err);
    }
  }

  static broadcast(message: any): void {
    for (const connection of ConnectionHandler.activeConnections) {
      try {
        connection.port?.postMessage(message);
      } catch (e) {
        console.warn('[ConnectionHandler] Broadcast failed for a port:', e);
      }
    }
  }

  private _cleanup(): void {
    ConnectionHandler.activeConnections.delete(this);
    console.log('[ConnectionHandler] Cleaning up connection');

    if (this.messageHandler) {
      try {
        this.port!.onMessage.removeListener(this.messageHandler);
      } catch {
        // port already dead
      }
    }

    this._probePersistenceQueues.clear();

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

// ── Local message shape helpers ─────────────────────────────────────────────

interface RetryProvidersMessage {
  sessionId?: string;
  aiTurnId?: string;
  providerIds?: string[];
  retryScope?: string;
}

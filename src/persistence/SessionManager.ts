// Enhanced SessionManager with Persistence Adapter Integration
// Supports both legacy chrome.storage and new persistence layer via feature flag

import { SimpleIndexedDBAdapter } from "./SimpleIndexedDBAdapter";
import { DEFAULT_THREAD } from "../../shared/messaging";
import type {
  PersistRequest,
  PersistReturn,
  PersistenceResult,
  ProviderOutput,
  ProviderResponseType,
  ExtendContext,
  ResolvedContext,
} from "../../shared/contract";
import type {
  ProviderResponseRecord,
  SessionRecord,
  JsonSafeOpts,
} from "./types";

type LoggerLike = { error: (...args: unknown[]) => void };

const getSessionLogger = (): LoggerLike => {
  try {
    const g = globalThis as Record<string, unknown>;
    const candidate =
      g.processLogger ||
      g.logger ||
      (g.window ? (g.window as Record<string, unknown>)["processLogger"] || (g.window as Record<string, unknown>)["logger"] : null);
    if (candidate && typeof (candidate as LoggerLike).error === "function") return candidate as LoggerLike;
  } catch (err) {
    console.error("[SessionManager] Error retrieving global logger:", err);
  }
  return console;
};

const VALID_PROVIDER_STATUSES = [
  "pending",
  "streaming",
  "completed",
  "error",
  "cancelled",
] as const;

type ProviderStatus = (typeof VALID_PROVIDER_STATUSES)[number];

function normalizeStatus(value: unknown): ProviderStatus {
  if (typeof value === "string" && (VALID_PROVIDER_STATUSES as readonly string[]).includes(value)) {
    return value as ProviderStatus;
  }
  return "completed";
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isString = (value: unknown): value is string => typeof value === "string";

const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isProviderResponseType = (value: unknown): value is ProviderResponseType =>
  value === "batch" || value === "mapping" || value === "singularity";

type ExistingProviderResponse = {
  id?: string;
  sessionId?: string;
  aiTurnId?: string;
  providerId: string;
  responseType: ProviderResponseType;
  responseIndex: number;
  text?: string;
  status?: unknown;
  meta?: Record<string, unknown>;
  createdAt?: number;
  updatedAt?: number;
};

type ExistingProviderContext = {
  id?: string;
  sessionId?: string;
  providerId: string;
  threadId?: string;
  // Legacy top-level fields for migration
  meta?: unknown;
  text?: string;
  lastUpdated?: number;

  createdAt?: number;
  updatedAt?: number;
  isActive?: boolean;
  contextData?: unknown;
  metadata?: unknown;
};

export class SessionManager {
  adapter: SimpleIndexedDBAdapter | null;
  isInitialized: boolean;

  constructor() {
    this.adapter = null;
    this.isInitialized = false;
  }

  _requireAdapter(): SimpleIndexedDBAdapter {
    if (!this.adapter) throw new Error("[SessionManager] Not initialized");
    return this.adapter;
  }

  _normalizeSessionRecord(raw: unknown, sessionIdFallback: string): SessionRecord & Record<string, unknown> {
    if (!isPlainObject(raw)) throw new Error("[SessionManager] Invalid session");
    const now = Date.now();

    const id = isString(raw["id"]) ? raw["id"] : sessionIdFallback;
    const title = isString(raw["title"]) ? raw["title"] : "";
    const createdAt = isNumber(raw["createdAt"]) ? raw["createdAt"] : now;
    const updatedAt = isNumber(raw["updatedAt"]) ? raw["updatedAt"] : now;
    const lastActivity = isNumber(raw["lastActivity"]) ? raw["lastActivity"] : now;

    const defaultThreadId = isString(raw["defaultThreadId"])
      ? raw["defaultThreadId"]
      : DEFAULT_THREAD;
    const activeThreadId = isString(raw["activeThreadId"])
      ? raw["activeThreadId"]
      : DEFAULT_THREAD;
    const turnCount = isNumber(raw["turnCount"]) ? raw["turnCount"] : 0;

    const isActive =
      typeof raw["isActive"] === "boolean" ? raw["isActive"] : true;

    const lastTurnIdRaw = raw["lastTurnId"];
    const lastTurnId =
      lastTurnIdRaw === null
        ? null
        : (isString(lastTurnIdRaw) ? lastTurnIdRaw : null);

    const lastStructuralTurnIdRaw = raw["lastStructuralTurnId"];
    const lastStructuralTurnId =
      lastStructuralTurnIdRaw === null
        ? null
        : (isString(lastStructuralTurnIdRaw) ? lastStructuralTurnIdRaw : null);

    const session: SessionRecord & Record<string, unknown> = {
      ...raw,
      id,
      title,
      createdAt,
      updatedAt,
      lastActivity,
      defaultThreadId,
      activeThreadId,
      turnCount,
      isActive,
      lastTurnId,
      lastStructuralTurnId,
    };

    const userId = raw["userId"];
    if (isString(userId)) session.userId = userId;

    const provider = raw["provider"];
    if (isString(provider)) session.provider = provider;

    const conciergePhaseState = raw["conciergePhaseState"];
    if (isPlainObject(conciergePhaseState))
      session.conciergePhaseState = conciergePhaseState;

    const metadata = raw["metadata"];
    if (isPlainObject(metadata)) session.metadata = metadata;

    return session;
  }

  _safeArtifact(artifact: unknown): unknown {
    return this._toJsonSafe(artifact, { maxDepth: 20, maxStringLength: 250000 });
  }

  _safePhasePayload(value: unknown): unknown {
    return this._toJsonSafe(value);
  }

  _extractArtifacts(request: PersistRequest): {
    batch?: unknown;
    mapping?: unknown;
    singularity?: unknown;
  } {
    const batch = request?.batch ? this._toJsonSafe(request.batch) : undefined;
    const mapping = request?.mapping ? this._toJsonSafe(request.mapping) : undefined;
    const singularity = request?.singularity
      ? this._toJsonSafe(request.singularity)
      : undefined;
    return { batch, mapping, singularity };
  }

  _toJsonSafe(
    value: unknown,
    opts: JsonSafeOpts = {},
    _stack: WeakSet<object> = new WeakSet<object>(),
    _depth = 0,
  ): unknown {
    const maxDepth = typeof opts.maxDepth === "number" ? opts.maxDepth : 6;
    const maxStringLength =
      typeof opts.maxStringLength === "number" ? opts.maxStringLength : 250000;

    if (value === null || value === undefined) return value;

    if (typeof value === "string") {
      return value.length > maxStringLength
        ? value.slice(0, maxStringLength)
        : value;
    }
    if (typeof value === "number" || typeof value === "boolean") return value;
    if (typeof value === "bigint") return String(value);
    if (typeof value === "function" || typeof value === "symbol") return undefined;

    if (_depth >= maxDepth) return undefined;

    if (Array.isArray(value)) {
      try {
        if (_stack.has(value)) return "[Circular]";
        _stack.add(value);
      } catch (_) {
        return String(value);
      }
      const arr: unknown[] = [];
      for (const item of value) {
        const safe = this._toJsonSafe(item, opts, _stack, _depth + 1);
        arr.push(safe !== undefined ? safe : null);
      }
      try {
        _stack.delete(value);
      } catch (_) { }
      return arr;
    }

    if (typeof value === "object") {
      const obj = value as object;
      try {
        if (_stack.has(obj)) return "[Circular]";
        _stack.add(obj);
      } catch (_) {
        return String(value);
      }

      if (value instanceof Date) return value.toISOString();

      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        const safe = this._toJsonSafe(v, opts, _stack, _depth + 1);
        if (safe !== undefined) out[k] = safe;
      }
      try {
        _stack.delete(obj);
      } catch (_) { }
      return out;
    }

    try {
      return String(value);
    } catch (_) {
      return undefined;
    }
  }

  _safeMeta(meta: unknown): Record<string, unknown> {
    const safe = this._toJsonSafe(meta, { maxDepth: 8, maxStringLength: 250000 });
    if (safe && typeof safe === "object" && !Array.isArray(safe)) return safe as Record<string, unknown>;
    if (safe === null || safe === undefined) return {};
    return { value: safe };
  }

  /**
   * Upsert a single provider response by compound key.
   */
  async upsertProviderResponse(
    sessionId: string,
    aiTurnId: string,
    providerId: string,
    responseType: ProviderResponseType,
    responseIndex: number,
    payload: { text?: string; status?: string; meta?: unknown; createdAt?: number } = {},
  ): Promise<ProviderResponseRecord | null> {
    try {
      if (!this.adapter) throw new Error("adapter not initialized");
      const keyTuple = [aiTurnId, providerId, responseType, responseIndex];
      let existing: unknown[] = [];
      try {
        existing = await this.adapter.getByIndex(
          "provider_responses",
          "byCompoundKey",
          keyTuple,
        );
      } catch (_) {
        existing = [];
      }

      const existingFirst = existing?.[0] as ExistingProviderResponse | undefined;
      const now = Date.now();
      const base: ProviderResponseRecord = {
        id: existingFirst?.id || `pr-${sessionId}-${aiTurnId}-${providerId}-${responseType}-${responseIndex}`,
        sessionId,
        aiTurnId,
        providerId,
        responseType,
        responseIndex,
        text: payload.text || (existingFirst?.text || ""),
        status: normalizeStatus(payload.status ?? existingFirst?.status),
        meta: this._safeMeta(payload.meta ?? existingFirst?.meta ?? {}),
        createdAt: existingFirst?.createdAt || payload.createdAt || now,
        updatedAt: now,
      };

      await this.adapter.put("provider_responses", base, base.id);
      return base;
    } catch (e) {
      console.warn("[SessionManager] upsertProviderResponse failed:", e);
      return null;
    }
  }

  /**
   * Primary persistence entry point
   */
  async persist(
    request: PersistRequest,
    context: ResolvedContext,
    result: PersistenceResult,
  ): Promise<PersistReturn> {
    if (!request?.type)
      throw new Error("[SessionManager] persist() requires request.type");
    switch (request.type) {
      case "initialize":
        return this._persistInitialize(request, result);
      case "extend":
        return this._persistExtend(request, context as ExtendContext, result);
      case "recompute":
        return this._persistRecompute(request, context, result);
      default:
        throw new Error(
          `[SessionManager] Unknown request type: ${(request as { type: string }).type}`,
        );
    }
  }

  /**
   * Initialize: Create new session + first turn
   */
  async _persistInitialize(request: PersistRequest, result: PersistenceResult): Promise<PersistReturn> {
    const sessionId = request.sessionId;
    if (!sessionId) {
      throw new Error("[SessionManager] initialize requires request.sessionId");
    }
    const now = Date.now();

    const contextSummary = this._buildContextSummary(result, request);

    const userTurnId = request.canonicalUserTurnId || `user-${now}`;
    const aiTurnId = request.canonicalAiTurnId || `ai-${now}`;
    const isComplete = !request?.partial;
    const pipelineStatus = request?.partial
      ? request?.pipelineStatus
      : (request?.pipelineStatus || "complete");
    const runId = request?.runId;
    let existingUserTurnId: string | null = null;
    const adapter = this._requireAdapter();

    try {
      const existingAi = await adapter.get("turns", aiTurnId) as Record<string, unknown> | undefined;
      // TODO(types): Typed adapter overloads would eliminate this cast
      if (existingAi && (existingAi.type === "ai" || existingAi.role === "assistant")) {
        const resolvedExistingUserTurnId =
          typeof existingAi.userTurnId === "string" && existingAi.userTurnId
            ? existingAi.userTurnId
            : userTurnId;
        existingUserTurnId = resolvedExistingUserTurnId;
        try {
          const existingUser = await adapter.get("turns", resolvedExistingUserTurnId);
          if (!existingUser) {
            const userText = request.userMessage || "";
            await adapter.put("turns", {
              id: resolvedExistingUserTurnId,
              type: "user",
              role: "user",
              sessionId,
              threadId: DEFAULT_THREAD,
              createdAt: isNumber(existingAi.createdAt) ? existingAi.createdAt : now,
              updatedAt: now,
              text: userText,
              content: userText,
              sequence: Math.max(((existingAi.sequence as number) || 1) - 1, 0),
            });
          }
        } catch (err) {
          const logger = getSessionLogger();
          logger.error(
            `[SessionManager] adapter.get("turns", existingUserTurnId) failed (aiTurnId=${aiTurnId}, existingUserTurnId=${existingUserTurnId}, sessionId=${sessionId})`,
            err,
          );
        }

        const providerContexts = this._extractContextsFromResult(result);
        const { batch, mapping, singularity } = this._extractArtifacts(request);

        const updatedAi: Record<string, unknown> = {
          ...existingAi,
          updatedAt: now,
          providerContexts: {
            ...((existingAi.providerContexts as Record<string, unknown>) || {}),
            ...(providerContexts || {}),
          },
          isComplete,
          batchResponseCount: this.countResponses(result.batchOutputs),
          mappingResponseCount: this.countResponses(result.mappingOutputs),
          singularityResponseCount: this.countResponses(result.singularityOutputs),
          ...(batch !== undefined ? { batch } : {}),
          ...(mapping !== undefined ? { mapping } : {}),
          ...(singularity !== undefined ? { singularity } : {}),
          lastContextSummary: contextSummary,
          ...(pipelineStatus ? { pipelineStatus } : {}),
        };
        console.log('🔬 Phase persistence:', {
          turnId: updatedAi?.id,
          batch: !!(updatedAi as any)?.batch,
          mapping: !!(updatedAi as any)?.mapping,
          singularity: !!(updatedAi as any)?.singularity,
        });
        await adapter.put("turns", updatedAi);

        await this._persistProviderResponses(sessionId, aiTurnId, result, now, runId ?? null);

        try {
          const rawSession = await adapter.get("sessions", sessionId) as unknown;
          if (rawSession) {
            const session = this._normalizeSessionRecord(rawSession, sessionId);
            session.lastTurnId = aiTurnId;
            session.lastActivity = now;
            session.updatedAt = now;
            await adapter.put("sessions", session);
          }
        } catch (err) {
          const logger = getSessionLogger();
          logger.error(
            `[SessionManager] adapter.get("sessions", sessionId) failed (aiTurnId=${aiTurnId}, existingUserTurnId=${existingUserTurnId}, sessionId=${sessionId})`,
            err,
          );
        }

        return { sessionId, userTurnId: existingUserTurnId, aiTurnId };
      }
    } catch (err) {
      const logger = getSessionLogger();
      logger.error(
        `[SessionManager] Existing AI-turn handling failed (adapterOp=initialize existing-ai path, aiTurnId=${aiTurnId}, existingUserTurnId=${existingUserTurnId}, sessionId=${sessionId})`,
        err,
      );

      const base = err instanceof Error ? err : new Error(String(err));
      const wrapped = new Error(
        `[SessionManager] Persistence adapter failure during initialize (aiTurnId=${aiTurnId}, existingUserTurnId=${existingUserTurnId}, sessionId=${sessionId})`,
      );
      void base;
      throw wrapped;
    }

    // 1) Create session - MATCH JS EXACTLY
    const sessionRecord: SessionRecord = {
      id: sessionId,
      title: String(request.userMessage || "").slice(0, 50),
      createdAt: now,
      lastActivity: now,
      defaultThreadId: DEFAULT_THREAD,
      activeThreadId: DEFAULT_THREAD,
      turnCount: 2,
      isActive: true,
      lastTurnId: null,
      updatedAt: now,
      userId: "default-user",
      provider: "multi",
      conciergePhaseState: this._defaultConciergePhaseState(),
    };
    await adapter.put("sessions", sessionRecord);

    // 2) Default thread
    const defaultThread: Record<string, unknown> = {
      id: DEFAULT_THREAD,
      sessionId,
      parentThreadId: null,
      branchPointTurnId: null,
      title: "Main Thread",
      name: "Main Thread",
      color: "#6366f1",
      isActive: true,
      createdAt: now,
      lastActivity: now,
      updatedAt: now,
    };
    await adapter.put("threads", defaultThread);

    // 3) User turn
    const userText = request.userMessage || "";
    const userTurnRecord: Record<string, unknown> = {
      id: userTurnId,
      type: "user",
      role: "user",
      sessionId,
      threadId: DEFAULT_THREAD,
      createdAt: now,
      updatedAt: now,
      text: userText,
      content: userText,
      sequence: 0,
    };
    await adapter.put("turns", userTurnRecord);

    // 4) AI turn with contexts
    const providerContexts = this._extractContextsFromResult(result);
    const batch = request?.batch ? this._safePhasePayload(request.batch) : undefined;
    const mapping = request?.mapping ? this._safePhasePayload(request.mapping) : undefined;
    const singularity = request?.singularity
      ? this._safePhasePayload(request.singularity)
      : undefined;
    const aiTurnRecord: Record<string, unknown> = {
      id: aiTurnId,
      type: "ai",
      role: "assistant",
      sessionId,
      threadId: DEFAULT_THREAD,
      userTurnId,
      createdAt: now,
      updatedAt: now,
      providerContexts,
      isComplete,
      sequence: 1,
      batchResponseCount: this.countResponses(result.batchOutputs),
      mappingResponseCount: this.countResponses(result.mappingOutputs),
      singularityResponseCount: this.countResponses(result.singularityOutputs),
      ...(batch !== undefined ? { batch } : {}),
      ...(mapping !== undefined ? { mapping } : {}),
      ...(singularity !== undefined ? { singularity } : {}),
      lastContextSummary: contextSummary,
      meta: await this._attachRunIdMeta(aiTurnId),
      ...(pipelineStatus ? { pipelineStatus } : {}),
    };
    console.log('🔬 Phase persistence:', {
      turnId: aiTurnRecord?.id,
      batch: !!(aiTurnRecord as any)?.batch,
      mapping: !!(aiTurnRecord as any)?.mapping,
      singularity: !!(aiTurnRecord as any)?.singularity,
    });
    await adapter.put("turns", aiTurnRecord);

    // 5) Provider responses
    await this._persistProviderResponses(sessionId, aiTurnId, result, now, runId ?? null);

    // 6) Update session lastTurnId
    sessionRecord.lastTurnId = aiTurnId;
    sessionRecord.updatedAt = now;
    await adapter.put("sessions", sessionRecord);

    return { sessionId, userTurnId, aiTurnId };
  }

  /**
   * Extend: Append turn to existing session
   */
  async _persistExtend(
    request: PersistRequest,
    context: ExtendContext,
    result: PersistenceResult,
  ): Promise<PersistReturn> {
    const { sessionId } = request;
    const now = Date.now();

    const contextSummary = this._buildContextSummary(result, request);
    const userTurnId = request.canonicalUserTurnId || `user-${now}`;
    const aiTurnId = request.canonicalAiTurnId || `ai-${now}`;
    const isComplete = !request?.partial;
    const pipelineStatus = request?.partial
      ? request?.pipelineStatus
      : (request?.pipelineStatus || "complete");
    const runId = request?.runId;
    const adapter = this._requireAdapter();

    try {
      const existingAi = await adapter.get("turns", aiTurnId) as Record<string, unknown> | undefined;
      // TODO(types): Typed adapter overloads would eliminate this cast
      if (existingAi && (existingAi.type === "ai" || existingAi.role === "assistant")) {
        try {
          const existingUserTurnId: string = (existingAi.userTurnId as string) || userTurnId;
          const existingUser = await adapter.get("turns", existingUserTurnId);
          if (!existingUser) {
            const userText = request.userMessage || "";
            await adapter.put("turns", {
              id: existingUserTurnId,
              type: "user",
              role: "user",
              sessionId,
              threadId: DEFAULT_THREAD,
              createdAt: isNumber(existingAi.createdAt) ? existingAi.createdAt : now,
              updatedAt: now,
              text: userText,
              content: userText,
              sequence: Math.max(((existingAi.sequence as number) || 1) - 1, 0),
            });
          }
        } catch (_) { }

        const newContexts = this._extractContextsFromResult(result);
        const batch = request?.batch ? this._toJsonSafe(request.batch) : undefined;
        const mapping = request?.mapping ? this._toJsonSafe(request.mapping) : undefined;
        const singularity = request?.singularity
          ? this._toJsonSafe(request.singularity)
          : undefined;

        const updatedAi: Record<string, unknown> = {
          ...existingAi,
          updatedAt: now,
          providerContexts: {
            ...((existingAi.providerContexts as Record<string, unknown>) || {}),
            ...(newContexts || {}),
          },
          isComplete,
          batchResponseCount: this.countResponses(result.batchOutputs),
          mappingResponseCount: this.countResponses(result.mappingOutputs),
          singularityResponseCount: this.countResponses(result.singularityOutputs),
          ...(batch !== undefined ? { batch } : {}),
          ...(mapping !== undefined ? { mapping } : {}),
          ...(singularity !== undefined ? { singularity } : {}),
          lastContextSummary: contextSummary,
          ...(pipelineStatus ? { pipelineStatus } : {}),
        };
        await adapter.put("turns", updatedAi);

        await this._persistProviderResponses(sessionId, aiTurnId, result, now, runId ?? null);

        try {
          const rawSession = await adapter.get("sessions", sessionId) as unknown;
          if (rawSession) {
            const session = this._normalizeSessionRecord(rawSession, sessionId);
            session.lastTurnId = aiTurnId;
            session.lastActivity = now;
            session.updatedAt = now;
            await adapter.put("sessions", session);
          }
        } catch (_) { }

        return { sessionId, userTurnId: (existingAi.userTurnId as string) || userTurnId, aiTurnId };
      }
    } catch (_) { }

    // Validate last turn
    if (!context?.lastTurnId) {
      throw new Error("[SessionManager] Extend requires context.lastTurnId");
    }
    const lastTurn = await adapter.get("turns", context.lastTurnId) as Record<string, unknown> | undefined;
    if (!lastTurn)
      throw new Error(
        `[SessionManager] Last turn ${context.lastTurnId} not found`,
      );

    // Determine next sequence using session.turnCount when available
    let nextSequence = 0;
    try {
      const rawSession = await adapter.get("sessions", sessionId) as unknown;
      if (rawSession) {
        const session = this._normalizeSessionRecord(rawSession, sessionId);
        nextSequence = session.turnCount;
      } else {
        const sessionTurns = await adapter.getTurnsBySessionId(sessionId);
        nextSequence = Array.isArray(sessionTurns) ? sessionTurns.length : 0;
      }
    } catch (_e) {
      try {
        const sessionTurns = await adapter.getTurnsBySessionId(sessionId);
        nextSequence = Array.isArray(sessionTurns) ? sessionTurns.length : 0;
      } catch (_) {
        nextSequence = 0;
      }
    }

    // 1) User turn
    const userText = request.userMessage || "";
    const userTurnRecord: Record<string, unknown> = {
      id: userTurnId,
      type: "user",
      role: "user",
      sessionId,
      threadId: DEFAULT_THREAD,
      createdAt: now,
      updatedAt: now,
      text: userText,
      content: userText,
      sequence: nextSequence,
    };
    await adapter.put("turns", userTurnRecord);

    // 2) Merge contexts
    const newContexts = this._extractContextsFromResult(result);
    const mergedContexts: Record<string, unknown> = {
      ...((lastTurn.type === "ai" && lastTurn.providerContexts) ? (lastTurn.providerContexts as Record<string, unknown>) : {}),
      ...newContexts,
    };

    // 3) AI turn
    const { batch, mapping, singularity } = this._extractArtifacts(request);
    const aiTurnRecord: Record<string, unknown> = {
      id: aiTurnId,
      type: "ai",
      role: "assistant",
      sessionId,
      threadId: DEFAULT_THREAD,
      userTurnId,
      createdAt: now,
      updatedAt: now,
      providerContexts: mergedContexts,
      isComplete,
      sequence: nextSequence + 1,
      batchResponseCount: this.countResponses(result.batchOutputs),
      mappingResponseCount: this.countResponses(result.mappingOutputs),
      singularityResponseCount: this.countResponses(result.singularityOutputs),
      ...(batch !== undefined ? { batch } : {}),
      ...(mapping !== undefined ? { mapping } : {}),
      ...(singularity !== undefined ? { singularity } : {}),
      lastContextSummary: contextSummary,
      meta: await this._attachRunIdMeta(aiTurnId),
      ...(pipelineStatus ? { pipelineStatus } : {}),
    };
    await adapter.put("turns", aiTurnRecord);

    // 4) Provider responses
    await this._persistProviderResponses(sessionId, aiTurnId, result, now, runId ?? null);

    // 5) Update session
    const rawSession = await adapter.get("sessions", sessionId) as unknown;
    if (rawSession) {
      const session = this._normalizeSessionRecord(rawSession, sessionId);
      session.lastTurnId = aiTurnId;
      session.lastActivity = now;
      session.turnCount = session.turnCount + 2;
      session.updatedAt = now;
      await adapter.put("sessions", session);
    }

    return { sessionId, userTurnId, aiTurnId };
  }

  /**
   * Recompute: Create derived turn (timeline branch)
   */
  async _persistRecompute(
    request: PersistRequest,
    _context: ResolvedContext,
    result: PersistenceResult,
  ): Promise<PersistReturn> {
    const { sessionId, sourceTurnId, stepType, targetProvider } = request;
    const now = Date.now();
    const adapter = this._requireAdapter();

    // 1) Source turn exists?
    const sourceTurn = await adapter.get("turns", sourceTurnId!) as Record<string, unknown> | undefined;
    if (!sourceTurn)
      throw new Error(`[SessionManager] Source turn ${sourceTurnId} not found`);

    // 2) Extract Result Data
    let output: ProviderOutput | undefined;
    if (stepType === "batch") output = result?.batchOutputs?.[targetProvider!];
    else if (stepType === "mapping")
      output = result?.mappingOutputs?.[targetProvider!];
    else if (stepType === "singularity")
      output = result?.singularityOutputs?.[targetProvider!];

    if (!output) {
      console.warn(
        `[SessionManager] No output for ${stepType}/${targetProvider}`,
      );
      return { sessionId };
    }

    // 3) Calculate Version Index
    let nextIndex = 0;
    try {
      const existingResponses = await this._getExistingResponsesByTurnId(sourceTurnId!);
      const relevantVersions = existingResponses.filter(
        (r) => r.providerId === targetProvider && r.responseType === stepType,
      );
      if (relevantVersions.length > 0) {
        const maxIndex = Math.max(
          ...relevantVersions.map((r) => r.responseIndex || 0),
        );
        nextIndex = maxIndex + 1;
      }
    } catch (_) { }

    // 4) Persist Response
    const respId = `pr-${sessionId}-${sourceTurnId}-${targetProvider}-${stepType}-${nextIndex}-${now}`;
    await adapter.put("provider_responses", {
      id: respId,
      sessionId,
      aiTurnId: sourceTurnId,
      providerId: targetProvider,
      responseType: stepType,
      responseIndex: nextIndex,
      text: output.text || "",
      status: normalizeStatus(output.status),
      meta: {
        ...this._safeMeta(output?.meta || {}),
        isRecompute: true,
        recomputeDate: now,
      },
      createdAt: now,
      updatedAt: now,
      completedAt: now,
    });

    // 5) Update Parent Turn Metadata
    try {
      const freshTurn = await adapter.get("turns", sourceTurnId!) as Record<string, unknown> | undefined;
      if (freshTurn) {
        freshTurn.updatedAt = now;

        if (stepType === "batch")
          freshTurn.batchResponseCount = ((freshTurn.batchResponseCount as number) || 0) + 1;
        else if (stepType === "mapping")
          freshTurn.mappingResponseCount = ((freshTurn.mappingResponseCount as number) || 0) + 1;
        else if (stepType === "singularity")
          freshTurn.singularityResponseCount = ((freshTurn.singularityResponseCount as number) || 0) + 1;

        if (stepType === "batch") {
          const contexts = (freshTurn.providerContexts || {}) as Record<string, unknown>;
          const existingCtx = (contexts[targetProvider!] || {}) as Record<string, unknown>;
          contexts[targetProvider!] = {
            ...existingCtx,
            ...this._safeMeta(output?.meta || {}),
          };
          freshTurn.providerContexts = contexts;
        }

        await adapter.put("turns", freshTurn);
      }
    } catch (_) { }

    return { sessionId };
  }

  /**
   * Extract provider contexts from workflow result
   */
  _extractContextsFromResult(result: PersistenceResult): Record<string, unknown> {
    const contexts: Record<string, unknown> = {};
    try {
      Object.entries(result?.batchOutputs || {}).forEach(([pid, output]) => {
        if (output?.meta && Object.keys(output.meta).length > 0)
          contexts[`${pid}:batch`] = this._safeMeta(output.meta);
      });
      Object.entries(result?.mappingOutputs || {}).forEach(([pid, output]) => {
        if (output?.meta && Object.keys(output.meta).length > 0)
          contexts[`${pid}:mapping`] = this._safeMeta(output.meta);
      });
      Object.entries(result?.singularityOutputs || {}).forEach(([pid, output]) => {
        if (output?.meta && Object.keys(output.meta).length > 0)
          contexts[`${pid}:singularity`] = this._safeMeta(output.meta);
      });
    } catch (_) { }
    return contexts;
  }

  /**
   * Helper: Persist provider responses for a turn (BATCHED)
   */
  async _persistProviderResponses(
    sessionId: string,
    aiTurnId: string,
    result: PersistenceResult,
    now: number,
    runId: string | null = null,
  ): Promise<void> {
    const adapter = this._requireAdapter();
    const recordsToSave: ProviderResponseRecord[] = [];
    let existingResponses: ExistingProviderResponse[] = [];

    try {
      existingResponses = await this._getExistingResponsesByTurnId(aiTurnId);
    } catch (_) { }

    const getNextIndex = (providerId: string, type: ProviderResponseType): number => {
      const persisted = existingResponses.filter(
        (r) => r.providerId === providerId && r.responseType === type,
      );
      const pending = recordsToSave.filter(
        (r) => r.providerId === providerId && r.responseType === type,
      );

      const maxPersisted = persisted.length > 0
        ? Math.max(...persisted.map((r) => (typeof r.responseIndex === "number" ? r.responseIndex : 0)))
        : -1;

      const maxPending = pending.length > 0
        ? Math.max(...pending.map((r) => (typeof r.responseIndex === "number" ? r.responseIndex : 0)))
        : -1;

      return Math.max(maxPersisted, maxPending) + 1;
    };

    let count = 0;

    // 1. Batch Responses (versioned)
    for (const [providerId, output] of Object.entries(result?.batchOutputs || {})) {
      let existingForRun: ExistingProviderResponse | null = null;
      if (runId) {
        const matching = existingResponses
          .filter(
            (r) =>
              r &&
              r.providerId === providerId &&
              r.responseType === "batch" &&
              r.meta?.["runId"] === runId,
          )
          .sort((a, b) => (b.responseIndex ?? 0) - (a.responseIndex ?? 0));
        existingForRun = matching.length > 0 ? matching[0] : null;
      }

      const responseIndex = typeof existingForRun?.responseIndex === "number"
        ? existingForRun.responseIndex
        : getNextIndex(providerId, "batch");
      const respId = existingForRun?.id || `pr-${sessionId}-${aiTurnId}-${providerId}-batch-${responseIndex}-${now}-${count++}`;
      const createdAtKeep = existingForRun?.createdAt || now;

      recordsToSave.push({
        id: respId,
        sessionId,
        aiTurnId,
        providerId,
        responseType: "batch",
        responseIndex,
        text: output?.text || "",
        status: normalizeStatus(output?.status),
        meta: this._safeMeta({ ...(output?.meta || {}), ...(runId ? { runId } : {}) }),
        createdAt: createdAtKeep,
        updatedAt: now,
        completedAt: now,
      });
    }

    // 2. Mapping (idempotent/singleton per provider)
    for (const [providerId, output] of Object.entries(result?.mappingOutputs || {})) {
      const existing = existingResponses.find(
        (r) => r.providerId === providerId && r.responseType === "mapping" && r.responseIndex === 0,
      );

      const respId = existing?.id || `pr-${sessionId}-${aiTurnId}-${providerId}-mapping-0-${now}-${count++}`;
      const createdAtKeep = existing?.createdAt || now;

      recordsToSave.push({
        id: respId,
        sessionId,
        aiTurnId,
        providerId,
        responseType: "mapping",
        responseIndex: 0,
        text: output?.text || existing?.text || "",
        status: normalizeStatus(output?.status ?? existing?.status),
        meta: this._safeMeta(output?.meta ?? existing?.meta ?? {}),
        createdAt: createdAtKeep,
        updatedAt: now,
        completedAt: now,
      });
    }

    // 3. Singularity (idempotent/singleton per provider)
    for (const [providerId, output] of Object.entries(result?.singularityOutputs || {})) {
      const existing = existingResponses.find(
        (r) => r.providerId === providerId && r.responseType === "singularity" && r.responseIndex === 0,
      );

      const respId = existing?.id || `pr-${sessionId}-${aiTurnId}-${providerId}-singularity-0-${now}-${count++}`;
      const createdAtKeep = existing?.createdAt || now;

      recordsToSave.push({
        id: respId,
        sessionId,
        aiTurnId,
        providerId,
        responseType: "singularity",
        responseIndex: 0,
        text: output?.text || existing?.text || "",
        status: normalizeStatus(output?.status ?? existing?.status),
        meta: this._safeMeta(output?.meta ?? existing?.meta ?? {}),
        createdAt: createdAtKeep,
        updatedAt: now,
        completedAt: now,
      });
    }

    if (recordsToSave.length > 0) {
      await adapter.batchPut("provider_responses", recordsToSave);
    }
  }

  async _getExistingResponsesByTurnId(aiTurnId: string): Promise<ExistingProviderResponse[]> {
    const adapter = this.adapter;
    if (!adapter) return [];
    let records: unknown;
    try {
      records = await adapter.getResponsesByTurnId(aiTurnId);
    } catch (err) {
      getSessionLogger().error("[SessionManager] _getExistingResponsesByTurnId failed", err);
      return [];
    }
    if (!Array.isArray(records)) return [];
    const out: ExistingProviderResponse[] = [];
    for (const r of records) {
      const coerced = this._coerceExistingProviderResponse(r);
      if (coerced) out.push(coerced);
    }
    return out;
  }

  _coerceExistingProviderResponse(value: unknown): ExistingProviderResponse | null {
    if (!isPlainObject(value)) return null;
    const providerId = value["providerId"];
    const responseType = value["responseType"];
    const responseIndex = value["responseIndex"];
    if (!isString(providerId)) return null;
    if (!isProviderResponseType(responseType)) return null;
    if (!isNumber(responseIndex)) return null;

    const out: ExistingProviderResponse = {
      providerId,
      responseType,
      responseIndex,
    };

    const id = value["id"];
    if (isString(id)) out.id = id;

    const sessionId = value["sessionId"];
    if (isString(sessionId)) out.sessionId = sessionId;

    const aiTurnId = value["aiTurnId"];
    if (isString(aiTurnId)) out.aiTurnId = aiTurnId;

    const text = value["text"];
    if (isString(text)) out.text = text;

    out.status = value["status"];

    const meta = value["meta"];
    if (isPlainObject(meta)) out.meta = meta;

    const createdAt = value["createdAt"];
    if (isNumber(createdAt)) out.createdAt = createdAt;

    const updatedAt = value["updatedAt"];
    if (isNumber(updatedAt)) out.updatedAt = updatedAt;

    return out;
  }

  async _getExistingContextsBySessionId(sessionId: string): Promise<ExistingProviderContext[]> {
    const adapter = this.adapter;
    if (!adapter) return [];
    let records: unknown;
    try {
      records = await adapter.getContextsBySessionId(sessionId);
    } catch (err) {
      getSessionLogger().error("[SessionManager] _getExistingContextsBySessionId failed", err);
      return [];
    }
    if (!Array.isArray(records)) return [];
    const out: ExistingProviderContext[] = [];
    for (const r of records) {
      const coerced = this._coerceExistingProviderContext(r);
      if (coerced) out.push(coerced);
    }
    return out;
  }

  _coerceExistingProviderContext(value: unknown): ExistingProviderContext | null {
    if (!isPlainObject(value)) return null;
    const providerId = value["providerId"];
    if (!isString(providerId)) return null;
    const out: ExistingProviderContext = { providerId };

    const id = value["id"];
    if (isString(id)) out.id = id;

    const sessionId = value["sessionId"];
    if (isString(sessionId)) out.sessionId = sessionId;

    const threadId = value["threadId"];
    if (isString(threadId)) out.threadId = threadId;

    // Preserve legacy top-level fields for migration in updateProviderContext logic if needed,
    // or just read them here to populate contextData if missing.
    // However, ExistingProviderContext definition allows them to exist so we can read old records.
    out.meta = value["meta"];
    out.contextData = value["contextData"];
    out.metadata = value["metadata"];

    const text = value["text"];
    if (isString(text)) out.text = text;

    const lastUpdated = value["lastUpdated"];
    if (isNumber(lastUpdated)) out.lastUpdated = lastUpdated;

    const createdAt = value["createdAt"];
    if (isNumber(createdAt)) out.createdAt = createdAt;

    const updatedAt = value["updatedAt"];
    if (isNumber(updatedAt)) out.updatedAt = updatedAt;

    const isActive = value["isActive"];
    if (typeof isActive === "boolean") out.isActive = isActive;

    return out;
  }

  /**
   * Helper function to count responses in a response bucket
   */
  countResponses(responseBucket: Record<string, unknown> | undefined): number {
    return responseBucket ? Object.keys(responseBucket).length : 0;
  }

  /**
   * Initialize the session manager.
   */
  async initialize(config: { adapter?: SimpleIndexedDBAdapter | null; initTimeoutMs?: number } = {}): Promise<void> {
    if (this.isInitialized) {
      console.log("[SessionManager] Already initialized");
      return;
    }
    const { adapter = null, initTimeoutMs = 8000 } = config || {};

    console.log("[SessionManager] Initializing with persistence adapter...");

    if (adapter) {
      this.adapter = adapter;
    } else {
      this.adapter = new SimpleIndexedDBAdapter();
      await this.adapter.init({ timeoutMs: initTimeoutMs, autoRepair: true });
    }

    this.isInitialized = true;
  }

  async _attachRunIdMeta(aiTurnId: string): Promise<Record<string, unknown>> {
    try {
      const adapter = this._requireAdapter();
      const metas = await adapter.getMetadataByEntityId(aiTurnId) as unknown[];
      const inflight = (metas || []).find(
        (m) => isPlainObject(m) && m.type === "inflight_workflow",
      );
      if (isPlainObject(inflight)) {
        const runId = inflight["runId"];
        if (typeof runId === "string" && runId) return { runId };
      }
    } catch (err) {
      getSessionLogger().error("[SessionManager] _attachRunIdMeta failed", err);
    }
    return {};
  }

  /**
   * Get or create a session (persistence-backed with cache)
   */
  async getOrCreateSession(sessionId: string): Promise<SessionRecord> {
    if (!sessionId) throw new Error("sessionId required");
    const adapter = this._requireAdapter();

    const raw = await adapter.get("sessions", sessionId) as unknown;
    if (!raw) {
      const now = Date.now();
      const sessionRecord: SessionRecord = {
        id: sessionId,
        title: "",
        defaultThreadId: DEFAULT_THREAD,
        activeThreadId: DEFAULT_THREAD,
        turnCount: 0,
        isActive: true,
        createdAt: now,
        updatedAt: now,
        lastActivity: now,
        lastTurnId: null,
      };

      await adapter.put("sessions", sessionRecord);

      const defaultThread: Record<string, unknown> = {
        id: DEFAULT_THREAD,
        sessionId,
        parentThreadId: null,
        branchPointTurnId: null,
        title: "Main Thread",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      };
      await adapter.put("threads", defaultThread);

      console.log(`[SessionManager] Created new session: ${sessionId}`);
      return sessionRecord;
    }

    const normalized = this._normalizeSessionRecord(raw, sessionId);
    let needsRepair = false;
    if (isPlainObject(raw)) {
      needsRepair =
        !isString(raw["title"]) ||
        !isString(raw["defaultThreadId"]) ||
        !isString(raw["activeThreadId"]) ||
        !isNumber(raw["turnCount"]) ||
        !isNumber(raw["createdAt"]) ||
        !isNumber(raw["updatedAt"]) ||
        !isNumber(raw["lastActivity"]) ||
        typeof raw["isActive"] !== "boolean";
    }
    if (needsRepair) {
      await adapter.put("sessions", normalized);
    }

    return normalized;
  }

  /**
   * Save session (enhanced with persistence layer support)
   */
  async saveSession(sessionId: string): Promise<void> {
    try {
      const adapter = this._requireAdapter();
      const raw = await adapter.get("sessions", sessionId) as unknown;
      if (raw) {
        const sessionRecord = this._normalizeSessionRecord(raw, sessionId);
        sessionRecord.updatedAt = Date.now();
        await adapter.put("sessions", sessionRecord);
        console.log(`[SessionManager] Updated session ${sessionId} timestamp`);
      }
    } catch (error) {
      console.error(
        `[SessionManager] Failed to update session ${sessionId}:`,
        error,
      );
    }
  }

  /**
   * Delete session (enhanced with persistence layer support)
   */
  async deleteSession(sessionId: string): Promise<boolean> {
    try {
      const adapter = this._requireAdapter();

      await adapter.transaction(
        [
          "sessions",
          "threads",
          "turns",
          "provider_responses",
          "provider_contexts",
          "metadata",
        ],
        "readwrite",
        async (tx: IDBTransaction) => {
          const getAllByIndex = <T extends { id?: string; key?: string; sessionId?: string; providerId?: string }>(
            store: IDBObjectStore,
            indexName: string,
            key: IDBValidKey | IDBKeyRange,
          ): Promise<T[]> =>
            new Promise((resolve, reject) => {
              let idx: IDBIndex;
              try {
                idx = store.index(indexName);
              } catch (e) {
                return reject(e);
              }
              const req = idx.getAll(key);
              req.onsuccess = () => resolve((req.result || []) as T[]);
              req.onerror = () => reject(req.error);
            });

          // 1) Delete session record
          await new Promise<boolean>((resolve, reject) => {
            const req = tx.objectStore("sessions").delete(sessionId);
            req.onsuccess = () => resolve(true);
            req.onerror = () => reject(req.error);
          });

          // 2) Threads by session
          const threadsStore = tx.objectStore("threads");
          const threads = await getAllByIndex<{ id: string }>(
            threadsStore,
            "bySessionId",
            sessionId,
          );
          for (const t of threads) {
            await new Promise<boolean>((resolve, reject) => {
              const req = threadsStore.delete(t.id);
              req.onsuccess = () => resolve(true);
              req.onerror = () => reject(req.error);
            });
          }

          // 3) Turns by session
          const turnsStore = tx.objectStore("turns");
          const turns = await getAllByIndex<{ id: string }>(
            turnsStore,
            "bySessionId",
            sessionId,
          );
          for (const turn of turns) {
            await new Promise<boolean>((resolve, reject) => {
              const req = turnsStore.delete(turn.id);
              req.onsuccess = () => resolve(true);
              req.onerror = () => reject(req.error);
            });
          }

          // 4) Provider responses by sessionId
          const responsesStore = tx.objectStore("provider_responses");
          const responses = await getAllByIndex<{ id: string }>(
            responsesStore,
            "bySessionId",
            sessionId,
          );
          for (const r of responses) {
            await new Promise<boolean>((resolve, reject) => {
              const req = responsesStore.delete(r.id);
              req.onsuccess = () => resolve(true);
              req.onerror = () => reject(req.error);
            });
          }

          // 5) Provider contexts by session (composite key delete)
          const contextsStore = tx.objectStore("provider_contexts");
          const contexts = await getAllByIndex<{ sessionId: string; providerId: string }>(
            contextsStore,
            "bySessionId",
            sessionId,
          );
          for (const ctx of contexts) {
            await new Promise<boolean>((resolve, reject) => {
              const key = [ctx.sessionId, ctx.providerId];
              const req = contextsStore.delete(key as unknown as IDBValidKey);
              req.onsuccess = () => resolve(true);
              req.onerror = () => reject(req.error);
            });
          }

          // 6) Metadata scoped to this session
          const metaStore = tx.objectStore("metadata");
          const metasBySession = await getAllByIndex<{ key: string }>(
            metaStore,
            "bySessionId",
            sessionId,
          );
          for (const m of metasBySession) {
            await new Promise<boolean>((resolve, reject) => {
              const req = metaStore.delete(m.key);
              req.onsuccess = () => resolve(true);
              req.onerror = () => reject(req.error);
            });
          }
        },
      );

      return true;
    } catch (error) {
      console.error(
        `[SessionManager] Failed to delete session ${sessionId} from persistence layer:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Update provider context (enhanced with persistence layer support)
   * MATCHES JS BEHAVIOR - contextData.lastUpdated, not top-level lastUpdated
   */
  async updateProviderContext(
    sessionId: string,
    providerId: string,
    result: ProviderOutput = {},
  ): Promise<void> {
    if (!sessionId || !providerId) return;
    try {
      const adapter = this._requireAdapter();
      const session = await this.getOrCreateSession(sessionId);

      // Get or create provider context via indexed query by session
      let contexts: Array<Record<string, unknown>> = [];
      try {
        const rawContexts = await adapter.getContextsBySessionId(sessionId);
        contexts = (Array.isArray(rawContexts) ? rawContexts : []) as Array<Record<string, unknown>>;
        // Narrow to target provider
        contexts = contexts.filter(
          (context) => context.providerId === providerId,
        );
      } catch (e) {
        console.warn(
          "[SessionManager] updateProviderContext: contexts lookup failed, using empty set",
          e,
        );
        contexts = [];
      }

      // Select the most recent context by updatedAt (fallback createdAt)
      let contextRecord: Record<string, unknown> | null = null;
      if (contexts.length > 0) {
        const sorted = contexts.sort((a, b) => {
          const ta = (a.updatedAt as number) ?? (a.createdAt as number) ?? 0;
          const tb = (b.updatedAt as number) ?? (b.createdAt as number) ?? 0;
          return tb - ta; // newest first
        });
        contextRecord = sorted[0];
        console.log(
          `[SessionManager] updateProviderContext: selected latest context for ${providerId} in ${sessionId}`,
          {
            candidates: contexts.length,
            selectedId: contextRecord.id,
            selectedUpdatedAt: contextRecord.updatedAt,
            selectedCreatedAt: contextRecord.createdAt,
          },
        );
      }

      if (!contextRecord) {
        // Create new context - MATCH JS EXACTLY (no meta, no lastUpdated at top level)
        contextRecord = {
          id: `ctx-${sessionId}-${providerId}-${Date.now()}`,
          sessionId: sessionId,
          providerId: providerId,
          threadId: DEFAULT_THREAD,
          contextData: {},
          isActive: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
      }

      // Update context data - MATCH JS: lastUpdated goes INSIDE contextData
      const existingContext = (contextRecord.contextData || {}) as Record<string, unknown>;
      contextRecord.contextData = {
        ...existingContext,
        text: result?.text || (existingContext.text as string) || "",
        meta: {
          ...this._safeMeta(existingContext.meta || {}),
          ...this._safeMeta(result?.meta || {}),
        },
        lastUpdated: Date.now(),  // Inside contextData, not top-level
      };
      contextRecord.updatedAt = Date.now();  // This is the only top-level timestamp update

      // Save or update context
      await adapter.put("provider_contexts", contextRecord);

      // Direct session update for activity tracking
      if (session) {
        session.lastActivity = Date.now();
        session.updatedAt = Date.now();
        await adapter.put("sessions", session);
      }
    } catch (error) {
      console.error(
        `[SessionManager] Failed to update provider context in persistence layer:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Batch update multiple provider contexts in a single pass.
   */
  async updateProviderContextsBatch(
    sessionId: string,
    updates: Record<string, ProviderOutput> = {},
    options: { contextRole?: ProviderResponseType | null } = {},
  ): Promise<void> {
    const { contextRole = null } = options;
    if (!sessionId || !updates || typeof updates !== "object") return;

    try {
      const adapter = this._requireAdapter();
      const session = await this.getOrCreateSession(sessionId);
      const now = Date.now();

      // Load all existing contexts once using indexed query
      let sessionContexts: Array<Record<string, unknown>> = [];
      try {
        const rawContexts = await adapter.getContextsBySessionId(sessionId);
        sessionContexts = (Array.isArray(rawContexts) ? rawContexts : []) as Array<Record<string, unknown>>;
      } catch (e) {
        console.warn(
          "[SessionManager] updateProviderContextsBatch: contexts lookup failed; proceeding with empty list",
          e,
        );
        sessionContexts = [];
      }

      const latestByProvider: Record<string, { record: Record<string, unknown>; _ts: number }> = {};
      for (const ctx of sessionContexts) {
        const pid = ctx.providerId as string;
        const ts = (ctx.updatedAt as number) ?? (ctx.createdAt as number) ?? 0;
        const existing = latestByProvider[pid];
        if (!existing || ts > (existing._ts || 0)) {
          latestByProvider[pid] = { record: ctx, _ts: ts };
        }
      }

      // Apply updates
      for (const [providerId, result] of Object.entries(updates)) {
        const effectivePid = contextRole ? `${providerId}:${contextRole}` : providerId;

        let contextRecord: Record<string, unknown> | undefined = latestByProvider[effectivePid]?.record;
        if (!contextRecord) {
          // MATCH JS: no meta, no lastUpdated at top level in new context
          contextRecord = {
            id: `ctx-${sessionId}-${effectivePid}-${now}-${Math.random().toString(36).slice(2, 8)}`,
            sessionId,
            providerId: effectivePid,
            threadId: DEFAULT_THREAD,
            contextData: {},
            isActive: true,
            createdAt: now,
            updatedAt: now,
          };
        }

        const existingData = (contextRecord.contextData || {}) as Record<string, unknown>;
        contextRecord.contextData = {
          ...existingData,
          text: result?.text || (existingData.text as string) || "",
          meta: {
            ...this._safeMeta(existingData.meta || {}),
            ...this._safeMeta(result?.meta || {}),
          },
          lastUpdated: now,  // Inside contextData
        };
        contextRecord.updatedAt = now;

        await adapter.put("provider_contexts", contextRecord);
      }

      // Direct session update for activity tracking
      if (session) {
        session.lastActivity = now;
        session.updatedAt = now;
        await adapter.put("sessions", session);
      }
    } catch (error) {
      console.error(
        "[SessionManager] Failed to batch update provider contexts:",
        error,
      );
      throw error;
    }
  }

  /**
   * Get provider contexts (persistence-backed, backward compatible shape)
   */
  async getProviderContexts(
    sessionId: string,
    _threadId: string = DEFAULT_THREAD,
    options: { contextRole?: ProviderResponseType | null } = {},
  ): Promise<Record<string, { meta: unknown }>> {
    const { contextRole = null } = options;
    try {
      if (!sessionId) {
        console.warn(
          "[SessionManager] getProviderContexts called without sessionId",
        );
        return {};
      }
      if (!this.adapter || !this.adapter.isReady()) {
        console.warn(
          "[SessionManager] getProviderContexts called but adapter is not ready",
        );
        return {};
      }

      const rawRecords = await this.adapter.getContextsBySessionId(sessionId);
      const contextRecords = (Array.isArray(rawRecords) ? rawRecords : []) as Array<Record<string, unknown>>;
      // TODO(types): Adapter method should return typed array

      const contexts: Record<string, { meta: unknown }> = {};
      for (const record of contextRecords) {
        const contextData = record.contextData as Record<string, unknown> | undefined;
        if (record.providerId && contextData?.meta) {
          const pid = record.providerId as string;

          if (contextRole) {
            const suffix = `:${contextRole}`;
            if (pid.endsWith(suffix)) {
              const baseId = pid.slice(0, -suffix.length);
              contexts[baseId] = { meta: contextData.meta };
            }
          } else {
            if (!pid.includes(":")) {
              contexts[pid] = { meta: contextData.meta };
            }
          }
        }
      }

      return contexts;
    } catch (e) {
      console.error("[SessionManager] getProviderContexts failed:", e);
      return {};
    }
  }

  /**
   * Extract decision map context from narrative section
   */
  _extractContextFromMapping(text: string): string {
    if (!text) return "";

    const consensusMatch = text.match(/Consensus:/i);
    if (consensusMatch && consensusMatch.index !== undefined) {
      return text.slice(consensusMatch.index).trim();
    }

    return text.trim();
  }

  /**
   * Combine extracted answers + artifacts into context blob
   */
  _buildContextSummary(_result: PersistenceResult, _request: PersistRequest): string {
    // Context summary now derived from phase data, not legacy fields
    return "";
  }

  async persistContextBridge(sessionId: string, turnId: string, bridge: Record<string, unknown>): Promise<void> {
    try {
      if (!this.adapter) return;
      const record = { ...bridge, sessionId, createdAt: Date.now() };
      await this.adapter.put("context_bridges", record, turnId);
    } catch (err) {
      getSessionLogger().error("[SessionManager] persistContextBridge failed", err);
    }
  }

  async getContextBridge(turnId: string): Promise<unknown> {
    try {
      if (!this.adapter) return null;
      return await this.adapter.get("context_bridges", turnId);
    } catch (err) {
      getSessionLogger().error("[SessionManager] getContextBridge failed", err);
      return null;
    }
  }

  async getLatestContextBridge(sessionId: string): Promise<unknown> {
    try {
      if (!this.adapter) return null;
      const turns = await this.adapter.getTurnsBySessionId(sessionId) as Array<Record<string, unknown>>;
      if (!Array.isArray(turns) || turns.length === 0) return null;
      for (let i = turns.length - 1; i >= 0; i--) {
        const t = turns[i];
        if (t?.type === "ai") {
          const br = await this.getContextBridge(t.id as string);
          if (br) return br;
        }
      }
      return null;
    } catch (err) {
      getSessionLogger().error("[SessionManager] getLatestContextBridge failed", err);
      return null;
    }
  }

  _defaultConciergePhaseState(): Record<string, unknown> {
    return {
      hasRunConcierge: false,
      lastSingularityProviderId: null,
      activeWorkflow: null,
      turnInCurrentInstance: 0,
      pendingHandoff: null,
      commitPending: false,
    };
  }

  async getConciergePhaseState(sessionId: string): Promise<Record<string, unknown>> {
    try {
      if (!this.adapter || !this.adapter.isReady()) {
        return this._defaultConciergePhaseState();
      }
      const raw = await this.adapter.get("sessions", sessionId) as unknown;
      if (!raw) return this._defaultConciergePhaseState();
      const session = this._normalizeSessionRecord(raw, sessionId);
      const state = session.conciergePhaseState;
      if (!isPlainObject(state)) return this._defaultConciergePhaseState();
      return {
        ...this._defaultConciergePhaseState(),
        ...state,
      };
    } catch (_) {
      return this._defaultConciergePhaseState();
    }
  }

  async setConciergePhaseState(sessionId: string, phaseState: unknown): Promise<boolean> {
    try {
      if (!this.adapter) return false;
      const raw = await this.adapter.get("sessions", sessionId) as unknown;
      if (!raw) return false;
      const session = this._normalizeSessionRecord(raw, sessionId);
      const now = Date.now();
      const updated = {
        ...session,
        conciergePhaseState: this._toJsonSafe(phaseState) || this._defaultConciergePhaseState(),
        lastActivity: now,
        updatedAt: now,
      };
      await this.adapter.put("sessions", updated, sessionId);
      return true;
    } catch (_) {
      return false;
    }
  }

  /**
   * Get persistence adapter status
   */
  getPersistenceStatus(): { persistenceEnabled: true; isInitialized: boolean; adapterReady: boolean } {
    return {
      persistenceEnabled: true,
      isInitialized: this.isInitialized,
      adapterReady: this.adapter?.isReady() || false,
    };
  }
}

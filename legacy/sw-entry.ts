// ============================================================================
// UNIFIED SERVICE WORKER ENTRY POINT
// Combines persistence layer, provider management, and message routing
// ============================================================================
// === bg: idempotent listener registration ===

// Core Infrastructure Imports
import {
  NetRulesManager,
  CSPController,
  UserAgentController,
  ArkoseController,
  BusController,
  LifecycleManager,
} from "./core/vendor-exports.js";
import { WorkflowCompiler } from "./core/workflow-compiler.js";
import { ContextResolver } from "./core/context-resolver.js";

import { ClaudeAdapter } from "./providers/claude-adapter.js";
import { GeminiAdapter } from "./providers/gemini-adapter.js";
import { ChatGPTAdapter } from "./providers/chatgpt-adapter.js";
import { QwenAdapter } from "./providers/qwen-adapter.js";
import { GrokAdapter } from "./providers/grok-adapter.js";
import { ClaudeProviderController } from "./providers/claude.js";
import { GeminiProviderController } from "./providers/gemini.js";
import { ChatGPTProviderController } from "./providers/chatgpt.js";
import { QwenProviderController } from "./providers/qwen.js";
import { GrokProviderController } from "./providers/grok.js";
import { DNRUtils } from "./core/dnr-utils.js";
import { ConnectionHandler } from "./core/connection-handler.js";
import { authManager as authManagerImport } from './core/auth-manager.js';

import type { FanoutOptions as ExecutionFanoutOptions, ProviderResult as ExecutionProviderResult } from "./core/execution/types";
import type { PersistenceLayer } from "./persistence/index";

// Persistence Layer Imports
import { SessionManager } from "./persistence/SessionManager";
import { initializePersistenceLayer } from "./persistence/index";
import { errorHandler, getErrorMessage } from "./utils/ErrorHandler";
import { persistenceMonitor } from "./core/PersistenceMonitor.js";

// Global Services Registry
import { ServiceRegistry } from "./core/service-registry.js";

import type { ProviderOutput } from "../shared/contract";

type AuthManagerLike = {
  initialize: () => Promise<void>;
  handleCookieChange: (changeInfo: chrome.cookies.CookieChangeInfo) => Promise<void>;
  verifyProvider: (providerId: string) => Promise<boolean>;
  verifyAll: () => Promise<Record<string, boolean>>;
  getAuthStatus: (forceRefresh?: boolean) => Promise<Record<string, boolean>>;
  invalidateCache: (providerId?: string) => void;
};

type ServiceRegistryLike = {
  services: Map<string, unknown>;
  register: (name: string, instance: unknown) => void;
  get: (name: string) => unknown;
  unregister: (name: string) => boolean;
};

type ProviderChunk = string | { text?: string; [k: string]: unknown };

type ProviderAdapterResult = ExecutionProviderResult & {
  ok?: boolean;
  errorCode?: string;
  meta?: Record<string, unknown>;
  providerId?: string;
  softError?: { message: string; name?: string };
  [k: string]: unknown;
};

type ProviderAdapter = {
  controller?: unknown;
  init?: () => Promise<void> | void;
  ask?: (
    prompt: unknown,
    providerContext?: unknown | null,
    sessionId?: string,
    onChunk?: (chunk: ProviderChunk) => void,
    signal?: AbortSignal,
  ) => Promise<ProviderAdapterResult>;
  sendPrompt?: (
    request: { originalPrompt: string; sessionId: string; meta?: Record<string, unknown> },
    onChunk: (chunk: ProviderChunk) => void,
    signal: AbortSignal,
  ) => Promise<ProviderAdapterResult>;
};

type SwFanoutOptions = Omit<
  ExecutionFanoutOptions,
  "onAllComplete" | "onError" | "onProviderComplete" | "providerMeta" | "onPartial"
> & {
  providerMeta?: Record<string, unknown>;
  onError?: (error: unknown) => void;
  onPartial?: (providerId: string, chunk: unknown) => void;
  onProviderComplete?: (providerId: string, resultWrapper: unknown) => void;
  onAllComplete?: (results: Map<string, ProviderAdapterResult>, errors: Map<string, unknown>) => void;
};

type ProviderAdapterCtor = new (...args: unknown[]) => ProviderAdapter;

const authManager = authManagerImport as unknown as AuthManagerLike;

const services = ServiceRegistry.getInstance() as unknown as ServiceRegistryLike;

// ============================================================================
// FEATURE FLAGS (Source of Truth)
// ============================================================================
// HTOS_PERSISTENCE_ENABLED removed as it was unused

// Ensure fetch is correctly bound
try {
  if (typeof fetch === "function" && typeof globalThis !== "undefined") {
    globalThis.fetch = fetch.bind(globalThis);
  }
} catch (_) { }

// Initialize BusController globally (needed for message bus)
(self as unknown as Record<string, unknown>)["BusController"] = BusController as unknown;

(globalThis as unknown as Record<string, unknown>).HTOS_DEBUG = {
  verifyProvider: async (providerId: unknown) => authManager.verifyProvider(String(providerId || "")),
  verifyAll: async () => authManager.verifyAll(),
  getAuthStatus: async (forceRefresh: unknown = false) => authManager.getAuthStatus(Boolean(forceRefresh)),
  executeSingle: async (providerId: unknown, prompt: unknown, options: unknown = {}) => {
    const svcs = await initializeGlobalServices();
    const pid = String(providerId || "").toLowerCase();
    const p = String(prompt || "");
    const opts = (options && typeof options === "object" ? (options as Record<string, unknown>) : {}) as Record<string, unknown>;
    const timeout = Number.isFinite(opts?.timeout) ? (opts.timeout as number) : 60000;
    return svcs.orchestrator.executeSingle(p, pid, { timeout });
  },
  getProviderAdapter: async (providerId: unknown) => {
    const svcs = await initializeGlobalServices();
    return (svcs.providerRegistry as ProviderRegistry | undefined)?.getAdapter?.(String(providerId || "").toLowerCase()) || null;
  },
};

// Debounce map for cookie changes
const cookieChangeDebounce = new Map<string, ReturnType<typeof setTimeout>>();

// Top-level registration - ensures listener is always registered when SW loads
chrome.cookies.onChanged.addListener((changeInfo) => {
  const key = `${changeInfo.cookie.domain}:${changeInfo.cookie.name}`;

  const existingTimeout = cookieChangeDebounce.get(key);
  if (existingTimeout !== undefined) {
    clearTimeout(existingTimeout);
  }

  const timeoutId = setTimeout(() => {
    cookieChangeDebounce.delete(key);

    authManager
      .initialize()
      .then(() => authManager.handleCookieChange(changeInfo))
      .catch((err) => {
        console.error("[SW] Cookie change handler failed:", getErrorMessage(err), err);
      });
  }, 100);

  cookieChangeDebounce.set(key, timeoutId);
});

// ============================================================================
// LIFECYCLE & STARTUP HANDLERS (Unified)
// ============================================================================

/**
 * Unified startup handler
 * Drives the async initialization sequence for both install and startup events.
 */
async function handleStartup(reason: string): Promise<void> {
  console.log(`[SW] Startup detected (${reason})`);

  // 1. Initialize Auth Manager
  await authManager.initialize();

  await initializeGlobalServices();
}

chrome.runtime.onStartup.addListener(() => handleStartup("startup"));

chrome.runtime.onInstalled.addListener((details) => {
  handleStartup(`installed: ${details.reason}`);
});

// ============================================================================
// CORE SERVICE INITIALIZATION
// ============================================================================

async function initializePersistence(): Promise<PersistenceLayer> {
  // Check registry first
  if (services.get('persistenceLayer')) {
    return services.get('persistenceLayer') as PersistenceLayer;
  }

  const operationId = persistenceMonitor.startOperation(
    "INITIALIZE_PERSISTENCE",
    { useAdapter: true },
  );

  try {
    const pl = await initializePersistenceLayer();
    services.register('persistenceLayer', pl);

    // Legacy global for debug only
    (self as unknown as Record<string, unknown>)["__HTOS_PERSISTENCE_LAYER"] = pl as unknown;

    persistenceMonitor.recordConnection("HTOSPersistenceDB", 1, [
      "sessions", "threads", "turns", "provider_responses", "provider_contexts", "metadata",
    ]);
    console.log("[SW] ✅ Persistence layer initialized");
    persistenceMonitor.endOperation(operationId, { success: true });
    return pl;
  } catch (error) {
    persistenceMonitor.endOperation(operationId, null, error);
    const handledError = await errorHandler.handleError(error, {
      operation: "initializePersistence",
      context: { useAdapter: true },
    });
    console.error("[SW] ❌ Failed to initialize:", handledError);
    throw handledError;
  }
}

async function initializeSessionManager(pl?: PersistenceLayer): Promise<SessionManager> {
  // Check registry first
  const existing = services.get('sessionManager') as SessionManager | undefined;
  if (existing && existing.adapter?.isReady()) {
    return existing;
  }

  const persistence = pl || (services.get('persistenceLayer') as PersistenceLayer | undefined);
  try {
    console.log("[SW] Creating new SessionManager");
    const sm = new SessionManager();

    await sm.initialize({ adapter: persistence?.adapter });
    services.register('sessionManager', sm);
    console.log("[SW] ✅ SessionManager initialized");
    return sm;
  } catch (error) {
    console.error("[SW] ❌ Failed to initialize SessionManager:", error);
    throw error;
  }
}

// ============================================================================
// PROVIDER ADAPTER REGISTRY
// ============================================================================
class ProviderRegistry {
  private adapters: Map<string, ProviderAdapter>;
  private controllers: Map<string, unknown>;

  constructor() {
    this.adapters = new Map();
    this.controllers = new Map();
  }
  register(providerId: string, controller: unknown, adapter: ProviderAdapter): void {
    this.controllers.set(providerId, controller);
    this.adapters.set(providerId, adapter);
  }
  getAdapter(providerId: string): ProviderAdapter | undefined {
    return this.adapters.get(String(providerId).toLowerCase());
  }
  getController(providerId: string): unknown {
    return this.controllers.get(String(providerId).toLowerCase());
  }
  listProviders(): string[] {
    return Array.from(this.adapters.keys());
  }
  isAvailable(providerId: string): boolean {
    return this.adapters.has(String(providerId).toLowerCase());
  }
}

async function initializeProviders(): Promise<string[]> {
  console.log("[SW] Initializing providers...");

  if (services.get('providerRegistry')) {
    return (services.get('providerRegistry') as ProviderRegistry).listProviders();
  }

  const providerRegistry = new ProviderRegistry();

  const providerConfigs: Array<{
    name: string;
    Controller: new () => unknown;
    Adapter: ProviderAdapterCtor;
  }> = [
    { name: "claude", Controller: ClaudeProviderController, Adapter: ClaudeAdapter as unknown as ProviderAdapterCtor },
    { name: "gemini", Controller: GeminiProviderController, Adapter: GeminiAdapter as unknown as ProviderAdapterCtor },
    {
      name: "gemini-pro",
      Controller: GeminiProviderController,
      Adapter: class extends (GeminiAdapter as unknown as ProviderAdapterCtor) {
        constructor(controller: unknown) {
          super(controller, "gemini-pro");
        }
      },
    },
    {
      name: "gemini-exp",
      Controller: GeminiProviderController,
      Adapter: class extends (GeminiAdapter as unknown as ProviderAdapterCtor) {
        constructor(controller: unknown) {
          super(controller, "gemini-exp");
        }
      },
    },
    { name: "chatgpt", Controller: ChatGPTProviderController, Adapter: ChatGPTAdapter as unknown as ProviderAdapterCtor },
    { name: "qwen", Controller: QwenProviderController, Adapter: QwenAdapter as unknown as ProviderAdapterCtor },
    { name: "grok", Controller: GrokProviderController, Adapter: GrokAdapter as unknown as ProviderAdapterCtor },
  ];

  const initialized: string[] = [];
  for (const config of providerConfigs) {
    try {
      const controller = new config.Controller();
      if (typeof (controller as { init?: () => Promise<void> | void }).init === "function") {
        await (controller as { init: () => Promise<void> | void }).init();
      }
      const adapter = new config.Adapter(controller);
      if (typeof adapter.init === "function") await adapter.init();
      providerRegistry.register(config.name, controller, adapter);
      initialized.push(config.name);
    } catch (e) {
      console.error(`[SW] Failed to initialize ${config.name}:`, e);
    }
  }

  services.register('providerRegistry', providerRegistry);

  if (initialized.length > 0) {
    console.info(`[SW] ✅ Providers initialized: ${initialized.join(", ")}`);
  }
  return providerRegistry.listProviders();
}

// ============================================================================
// ORCHESTRATOR WRAPPER & INIT
// ============================================================================
class FaultTolerantOrchestrator {
  private activeRequests: Map<string, { abortControllers: Map<string, AbortController> }>;
  private registry: ServiceRegistryLike;

  constructor(registry: ServiceRegistryLike) {
    this.activeRequests = new Map();
    // Use registry directly or pass needed services
    this.registry = registry;
  }

  // Delegate lifecycle manager access to the registry (if we register it)
  get lifecycleManager(): LifecycleManager | undefined {
    return this.registry.get('lifecycleManager') as LifecycleManager | undefined;
  }

  async executeSingle(
    prompt: string,
    providerId: string,
    options: { timeout?: number } & Omit<SwFanoutOptions, "sessionId"> = {},
  ): Promise<ProviderAdapterResult> {
    const { timeout = 60000 } = options;

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Request to ${providerId} timed out after ${timeout}ms`));
      }, timeout);

      this.executeParallelFanout(prompt, [providerId], {
        ...(options as SwFanoutOptions),
        sessionId: (options as Record<string, unknown>)?.sessionId
          ? String((options as Record<string, unknown>).sessionId)
          : `req-${Date.now()}`,
        onPartial: options.onPartial || (() => { }),
        onError: (error) => {
          clearTimeout(timeoutId);
          reject(error);
        },
        onAllComplete: (results, errors) => {
          clearTimeout(timeoutId);

          if (errors.has(providerId)) {
            reject(errors.get(providerId));
          } else if (results.has(providerId)) {
            resolve(results.get(providerId)!);
          } else {
            reject(new Error(`No result from ${providerId}`));
          }
        },
      });
    });
  }

  async _prefetchGeminiTokens(
    providerRegistry: ProviderRegistry | undefined,
    providers: string[],
    providerMeta: Record<string, Record<string, unknown>>,
  ): Promise<void> {
    if (!providerRegistry) return;

    const GEMINI_VARIANT_IDS = ['gemini', 'gemini-pro', 'gemini-exp'];
    const targets = (providers || []).filter((pid) =>
      GEMINI_VARIANT_IDS.includes(String(pid).toLowerCase()),
    );

    if (targets.length < 2) return;

    const concurrencyLimit = Math.min(2, targets.length);
    const queue = [...targets];

    const worker = async (): Promise<void> => {
      while (queue.length > 0) {
        const pid = queue.shift();
        if (!pid) return;

        try {
          const controller = providerRegistry.getController(pid) as {
            geminiSession?: { _fetchToken?: () => Promise<unknown> };
          } | undefined;
          if (!controller?.geminiSession?._fetchToken) continue;

          const jitterMs = 50 + Math.floor(Math.random() * 101);
          await new Promise((resolve) => setTimeout(resolve, jitterMs));

          const token = await controller.geminiSession._fetchToken();
          if (!providerMeta[pid]) providerMeta[pid] = {};
          providerMeta[pid]._prefetchedToken = token;
        } catch (_) {
        }
      }
    };

    await Promise.all(
      Array.from({ length: concurrencyLimit }, () => worker()),
    );
  }

  async executeParallelFanout(
    prompt: string,
    providers: string[],
    options: SwFanoutOptions = {} as unknown as SwFanoutOptions,
  ): Promise<void> {
    const {
      sessionId = `req-${Date.now()}`,
      onPartial = () => { },
      onAllComplete = () => { },
      useThinking = false,
      providerContexts = {},
      providerMeta = {},
    } = options;

    if (this.lifecycleManager) this.lifecycleManager.keepalive(true);

    const results = new Map<string, ProviderAdapterResult>();
    const errors = new Map<string, unknown>();
    const abortControllers = new Map<string, AbortController>();
    this.activeRequests.set(sessionId, { abortControllers });

    const providerRegistry = this.registry.get('providerRegistry') as ProviderRegistry | undefined;

    await this._prefetchGeminiTokens(providerRegistry, providers, providerMeta as Record<string, Record<string, unknown>>);

    const providerPromises = providers.map((providerId) => {
      return (async () => {
        const abortController = new AbortController();
        abortControllers.set(providerId, abortController);

        const adapter = providerRegistry?.getAdapter(providerId);
        if (!adapter) {
          const err = new Error(`Provider ${providerId} not available`);
          try {
            if (options.onProviderComplete) {
              options.onProviderComplete(providerId, { status: "rejected", reason: err });
            }
          } catch (_) { }
          return { providerId, status: "rejected" as const, reason: err };
        }

        let aggregatedText = "";

        const request = {
          originalPrompt: prompt,
          sessionId,
          meta: {
            ...(((providerContexts as Record<string, unknown>)[providerId] as { meta?: Record<string, unknown> } | undefined)?.meta || {}),
            ...(((providerMeta as Record<string, unknown>)[providerId] as Record<string, unknown> | undefined) || {}),
            useThinking,
          },
        };

        try {
          const ctxEntry = (providerContexts as Record<string, unknown>)[providerId] as { meta?: unknown } | unknown;
          const providerContext =
            ctxEntry && typeof ctxEntry === "object" && "meta" in (ctxEntry as Record<string, unknown>)
              ? (ctxEntry as { meta?: unknown }).meta
              : (ctxEntry || null);

          const onChunk = (chunk: ProviderChunk) => {
            const textChunk = typeof chunk === "string" ? chunk : (chunk as { text?: string }).text;
            if (textChunk) aggregatedText += textChunk;
            onPartial(providerId, typeof chunk === "string" ? { text: chunk } : (chunk as { text?: string }));
          };

          if (
            (providerMeta as Record<string, unknown>)?.[providerId] &&
            (providerMeta as Record<string, unknown>)[providerId] &&
            typeof (providerMeta as Record<string, unknown>)[providerId] === "object" &&
            "_prefetchedToken" in ((providerMeta as Record<string, unknown>)[providerId] as Record<string, unknown>) &&
            (adapter as ProviderAdapter).controller &&
            typeof (adapter as ProviderAdapter).controller === "object" &&
            "geminiSession" in ((adapter as ProviderAdapter).controller as Record<string, unknown>)
          ) {
            const controller = (adapter as ProviderAdapter).controller as {
              geminiSession?: { sharedState?: Record<string, unknown> };
            };
            if (controller.geminiSession) {
              controller.geminiSession.sharedState = {
                ...(controller.geminiSession.sharedState || {}),
                prefetchedToken: (providerMeta as Record<string, Record<string, unknown>>)[providerId]._prefetchedToken,
              };
            }
          }

          let result: ProviderAdapterResult;
          if (typeof adapter.ask === "function") {
            result = await adapter.ask(request.originalPrompt, providerContext, sessionId, onChunk, abortController.signal);
          } else {
            result = await adapter.sendPrompt!(request, onChunk, abortController.signal);
          }

          if (!result.text && aggregatedText) result.text = aggregatedText;

          if (result && result.ok === false) {
            const message =
              (typeof result?.meta?.error === "string" && result.meta.error) ||
              (typeof result?.meta?.details === "string" && result.meta.details) ||
              (typeof result?.errorCode === "string" && result.errorCode) ||
              "Provider request failed";

            const err = new Error(message);
            const enrichedErr = err as Error & { code?: string; status?: number; headers?: unknown; details?: unknown; providerResponse?: unknown };
            enrichedErr.code = result?.errorCode || "unknown";
            if (result?.meta && typeof result.meta === "object") {
              const meta = result.meta as Record<string, unknown>;
              if (typeof meta.status === "number") enrichedErr.status = meta.status;
              if (meta.headers) enrichedErr.headers = meta.headers;
              if (meta.details) enrichedErr.details = meta.details;
            }
            enrichedErr.providerResponse = result;
            try {
              if (options.onProviderComplete) {
                options.onProviderComplete(providerId, { status: "rejected", reason: enrichedErr, providerResponse: result });
              }
            } catch (_) { }
            return { providerId, status: "rejected" as const, reason: enrichedErr };
          }

          if (options.onProviderComplete) {
            options.onProviderComplete(providerId, { status: "fulfilled", value: result });
          }

          return { providerId, status: "fulfilled" as const, value: result };

        } catch (error) {
          if (aggregatedText) {
            const name =
              error && typeof error === "object" && "name" in error
                ? String((error as { name?: unknown }).name)
                : "Error";
            const message =
              error && typeof error === "object" && "message" in error
                ? String((error as { message?: unknown }).message)
                : String(error);
            const val: ProviderAdapterResult = { text: aggregatedText, meta: {}, softError: { name, message } };
            if (options.onProviderComplete) {
              options.onProviderComplete(providerId, { status: "fulfilled", value: val });
            }
            return { providerId, status: "fulfilled" as const, value: val };
          }
          try {
            if (options.onProviderComplete) {
              options.onProviderComplete(providerId, { status: "rejected", reason: error });
            }
          } catch (_) { }
          return { providerId, status: "rejected" as const, reason: error };
        }
      })();
    });

    Promise.all(providerPromises).then((settledResults) => {
      settledResults.forEach((item) => {
        if (item.status === "fulfilled") results.set(item.providerId, item.value);
        else errors.set(item.providerId, item.reason);
      });
      onAllComplete(results, errors);
      this.activeRequests.delete(sessionId);
      if (this.lifecycleManager) this.lifecycleManager.keepalive(false);
    });
  }

  _abortRequest(sessionId: string): void {
    const request = this.activeRequests.get(sessionId);
    if (request) {
      request.abortControllers.forEach(c => c.abort());
      this.activeRequests.delete(sessionId);
      if (this.lifecycleManager) this.lifecycleManager.keepalive(false);
    }
  }
}

async function initializeOrchestrator(): Promise<FaultTolerantOrchestrator> {
  const existing = services.get('orchestrator') as FaultTolerantOrchestrator | undefined;
  if (existing) return existing;

  try {
    const lm = new LifecycleManager();
    services.register('lifecycleManager', lm);

    // Legacy global
    (self as unknown as Record<string, unknown>)["lifecycleManager"] = lm as unknown;

    const orchestrator = new FaultTolerantOrchestrator(services);
    services.register('orchestrator', orchestrator);

    // Legacy global
    (self as unknown as Record<string, unknown>)["faultTolerantOrchestrator"] = orchestrator as unknown;

    console.log("[SW] ✓ FaultTolerantOrchestrator initialized");
    return orchestrator;
  } catch (e) {
    console.error("[SW] Orchestrator init failed", e);
    throw e;
  }
}

// ============================================================================
// GLOBAL SERVICES (Unified Init)
// ============================================================================

let globalServicesPromise: Promise<GlobalServices> | null = null;

type GlobalServices = {
  orchestrator: FaultTolerantOrchestrator;
  sessionManager: SessionManager;
  compiler: WorkflowCompiler;
  contextResolver: ContextResolver;
  persistenceLayer: PersistenceLayer;
  authManager: AuthManagerLike;
  providerRegistry: ProviderRegistry;
};

async function initializeGlobalServices(): Promise<GlobalServices> {
  if (globalServicesPromise) return globalServicesPromise;

  const existingOrchestrator = services.get('orchestrator') as FaultTolerantOrchestrator | undefined;
  const existingSessionManager = services.get('sessionManager') as SessionManager | undefined;
  const existingCompiler = services.get('compiler') as WorkflowCompiler | undefined;
  const existingContextResolver = services.get('contextResolver') as ContextResolver | undefined;
  const existingPersistenceLayer = services.get('persistenceLayer') as PersistenceLayer | undefined;
  const existingAuthManager = services.get('authManager') as AuthManagerLike | undefined;
  const existingProviderRegistry = services.get('providerRegistry') as ProviderRegistry | undefined;

  if (
    existingOrchestrator &&
    existingSessionManager &&
    existingCompiler &&
    existingContextResolver &&
    existingPersistenceLayer &&
    existingAuthManager &&
    existingProviderRegistry
  ) {
    const ready: GlobalServices = {
      orchestrator: existingOrchestrator,
      sessionManager: existingSessionManager,
      compiler: existingCompiler,
      contextResolver: existingContextResolver,
      persistenceLayer: existingPersistenceLayer,
      authManager: existingAuthManager,
      providerRegistry: existingProviderRegistry,
    };
    globalServicesPromise = Promise.resolve(ready);
    return globalServicesPromise;
  }

  const keysBeforeInit = new Set(services.services.keys());

  globalServicesPromise = (async () => {
    try {
      console.log("[SW] 🚀 Initializing global services...");

      await authManager.initialize();
      if (!services.get('authManager')) services.register('authManager', authManager);

      await initializeGlobalInfrastructure();
      const pl = await initializePersistence();
      const sm = await initializeSessionManager(pl);
      await initializeProviders();
      await initializeOrchestrator();

      const compiler = (services.get('compiler') as WorkflowCompiler | undefined) || new WorkflowCompiler(sm);
      if (!services.get('compiler')) services.register('compiler', compiler);

      const contextResolver = (services.get('contextResolver') as ContextResolver | undefined) || new ContextResolver(sm);
      if (!services.get('contextResolver')) services.register('contextResolver', contextResolver);

      console.log("[SW] ✅ Global services registry ready");

      return {
        orchestrator: services.get('orchestrator') as FaultTolerantOrchestrator,
        sessionManager: sm,
        compiler,
        contextResolver,
        persistenceLayer: pl,
        authManager,
        providerRegistry: services.get('providerRegistry') as ProviderRegistry,
      };
    } catch (error) {
      console.error("[SW] ❌ Global services initialization failed:", error);
      for (const key of Array.from(services.services.keys())) {
        if (!keysBeforeInit.has(key)) {
          services.unregister(key);
        }
      }
      globalServicesPromise = null;
      throw error;
    }
  })();
  return globalServicesPromise;
}

async function initializeGlobalInfrastructure(): Promise<void> {
  console.log("[SW] Initializing global infrastructure...");
  try {
    await NetRulesManager.init();
    CSPController.init();
    await UserAgentController.init();
    await ArkoseController.init();
    await DNRUtils.initialize();
    await OffscreenController.init();
    await BusController.init();
    (self as unknown as Record<string, unknown>)["bus"] = BusController as unknown;
  } catch (e) {
    console.error("[SW] Infra init failed", e);
  }
}

// ============================================================================
// PERSISTENT OFFSCREEN DOCUMENT CONTROLLER
// ============================================================================
const OffscreenController: {
  _initialized: boolean;
  isReady: () => Promise<boolean>;
  init: () => Promise<void>;
} = {
  _initialized: false,
  async isReady(): Promise<boolean> {
    try {
      if (this._initialized) return true;
      if (await chrome.offscreen.hasDocument()) {
        this._initialized = true;
        return true;
      }
      return false;
    } catch (_) {
      return false;
    }
  },
  async init(): Promise<void> {
    if (this._initialized) return;
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        if (!(await chrome.offscreen.hasDocument())) {
          await chrome.offscreen.createDocument({
            url: "offscreen.html",
            reasons: [
              chrome.offscreen.Reason.BLOBS,
              chrome.offscreen.Reason.DOM_PARSER,
              chrome.offscreen.Reason.WORKERS,
            ],
            justification: "HTOS needs persistent offscreen DOM.",
          });
        }
        console.log("[SW] Offscreen document ready");
        this._initialized = true;
        return;
      } catch (e) {
        console.error(`[SW] Offscreen init failed (attempt ${attempt}/${maxAttempts})`, e);
        if (attempt < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
    }
    console.error("[SW] Offscreen init failed after all attempts");
    throw new Error("Failed to create offscreen document after max retries");
  }
};

// ============================================================================
// UNIFIED MESSAGE HANDLER
// ============================================================================
async function handleUnifiedMessage(
  message: unknown,
  _sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void,
): Promise<boolean> {
  try {
    const svcs = await initializeGlobalServices();
    const sm = svcs.sessionManager;

    if (!sm) {
      sendResponse({ success: false, error: "Service not ready" });
      return true;
    }

    const msg = message as Record<string, unknown>;
    const type = String(msg.type || "");

    switch (type) {
      case "REFRESH_AUTH_STATUS":
        authManager.getAuthStatus(true).then(s => sendResponse({ success: true, data: s })).catch(e => sendResponse({ success: false, error: getErrorMessage(e) }));
        return true;

      case "VERIFY_AUTH_TOKEN":
        (async () => {
          const payload = (msg.payload as Record<string, unknown> | undefined) || undefined;
          const pid = payload?.providerId;
          const force = !!payload?.force;
          if (force) {
            authManager.invalidateCache(typeof pid === "string" ? pid : undefined);
          }
          const res = pid
            ? { [String(pid)]: await authManager.verifyProvider(String(pid)) }
            : await authManager.verifyAll();
          sendResponse({ success: true, data: res });
        })().catch(e => sendResponse({ success: false, error: getErrorMessage(e) }));
        return true;

      case "GENERATE_EMBEDDINGS":
      case "PRELOAD_MODEL":
      case "EMBEDDING_STATUS":
        (async () => {
          await OffscreenController.init();

          const response = await new Promise<unknown>((resolve) => {
            chrome.runtime.sendMessage(
              { ...(msg as Record<string, unknown>), __fromUnified: true },
              (r) => {
                if (chrome.runtime.lastError) {
                  resolve({ success: false, error: chrome.runtime.lastError.message });
                } else {
                  resolve(r);
                }
              },
            );
          });

          sendResponse(response);
        })().catch(e => sendResponse({ success: false, error: getErrorMessage(e) }));
        return true;

      case "DEBUG_EXECUTE_SINGLE":
        (async () => {
          const payload = (msg.payload as Record<string, unknown> | undefined) || undefined;
          const providerId = String(payload?.providerId || "").toLowerCase();
          const prompt = String(payload?.prompt || "");
          const timeout = Number.isFinite(payload?.timeout) ? (payload!.timeout as number) : 60000;
          if (!providerId) throw new Error("Missing providerId");
          if (!prompt) throw new Error("Missing prompt");
          const orchestrator = svcs.orchestrator;
          if (!orchestrator || typeof orchestrator.executeSingle !== "function") {
            throw new Error("Orchestrator not available");
          }
          const result = await orchestrator.executeSingle(prompt, providerId, { timeout });
          sendResponse({ success: true, data: result });
        })().catch(e => sendResponse({ success: false, error: getErrorMessage(e) }));
        return true;

      case "GET_FULL_HISTORY": {
        const adapter = sm.adapter as NonNullable<SessionManager["adapter"]>;
        const allSessions = await adapter.getAllSessions() || [];
        const sessions = allSessions.map(r => ({
          id: (r as Record<string, unknown>).id,
          sessionId: (r as Record<string, unknown>).id,
          title: (r as Record<string, unknown>).title || "New Chat",
          startTime: (r as Record<string, unknown>).createdAt,
          lastActivity: (r as Record<string, unknown>).updatedAt || (r as Record<string, unknown>).lastActivity,
          messageCount: (r as Record<string, unknown>).turnCount || 0,
          firstMessage: ""
        })).sort((a, b) => (Number(b.lastActivity || 0) - Number(a.lastActivity || 0)));
        sendResponse({ success: true, data: { sessions } });
        return true;
      }

      case "GET_HISTORY_SESSION": {
        (async () => {
          const payload = (msg.payload as Record<string, unknown> | undefined) || undefined;
          const sessionId = (msg.sessionId as string | undefined) || (payload?.sessionId as string | undefined);
          if (!sessionId) throw new Error("Missing sessionId");

          const adapter = sm.adapter as NonNullable<SessionManager["adapter"]>;
          const sessionRecord = await adapter.get("sessions", sessionId);
          let turns = await adapter.getTurnsBySessionId(sessionId);
          turns = Array.isArray(turns) ? turns.sort((a, b) => {
            const aa = a as Record<string, unknown>;
            const bb = b as Record<string, unknown>;
            const aKey = (aa.sequence ?? aa.createdAt) as number;
            const bKey = (bb.sequence ?? bb.createdAt) as number;
            return aKey - bKey;
          }) : [];

          const rounds: unknown[] = [];
          for (let i = 0; i < turns.length; i++) {
            const user = turns[i] as Record<string, unknown> | undefined;
            if (!user || user.type !== "user") continue;

            const allAi = turns.filter(t => (t as Record<string, unknown>).type === "ai" && (t as Record<string, unknown>).userTurnId === user.id);
            if (!allAi.length) continue;

            const nextTurn = turns[i + 1] as Record<string, unknown> | undefined;
            let primaryAi: Record<string, unknown> | null = null;

            const defaultPrimary =
              (nextTurn && nextTurn.type === "ai" && nextTurn.userTurnId === user.id && !(nextTurn.meta as Record<string, unknown> | undefined)?.isHistoricalRerun && nextTurn.sequence !== -1)
                ? nextTurn
                : ((allAi.find(t => {
  const turn = t as Record<string, unknown>;
  const meta = turn.meta as Record<string, unknown> | undefined;
  return !meta?.isHistoricalRerun && turn.sequence !== -1;
}) as Record<string, unknown> | undefined) || (allAi[0] as Record<string, unknown>));
            primaryAi = defaultPrimary;

            let pipelineStatus =
              typeof (primaryAi as Record<string, unknown> | null)?.pipelineStatus === "string"
                ? (primaryAi as Record<string, unknown>).pipelineStatus
                : (typeof (primaryAi as Record<string, unknown> | null)?.meta === "object" && primaryAi?.meta && typeof (primaryAi.meta as Record<string, unknown>).pipelineStatus === "string"
                  ? (primaryAi.meta as Record<string, unknown>).pipelineStatus
                  : undefined);

            rounds.push({
              userTurnId: user.id, aiTurnId: (primaryAi as Record<string, unknown>).id,
              user: { id: user.id, text: user.text || user.content || "", createdAt: user.createdAt || 0 },
              ...((primaryAi as Record<string, unknown>).batch ? { batch: (primaryAi as Record<string, unknown>).batch } : {}),
              ...((primaryAi as Record<string, unknown>).mapping ? { mapping: (primaryAi as Record<string, unknown>).mapping } : {}),
              ...((primaryAi as Record<string, unknown>).singularity ? { singularity: (primaryAi as Record<string, unknown>).singularity } : {}),
              ...(pipelineStatus ? { pipelineStatus } : {}),
              createdAt: user.createdAt || 0, completedAt: (primaryAi as Record<string, unknown>).updatedAt || 0
            });
          }

          let providerContexts: Record<string, unknown> = {};
          try {
            if (adapter.getContextsBySessionId) {
              const ctxs = await adapter.getContextsBySessionId(sessionId);
              (ctxs || []).forEach(c => {
                const cc = c as Record<string, unknown> | null;
                if (cc?.providerId) providerContexts[String(cc.providerId)] = { ...(cc.meta as Record<string, unknown> || {}), ...(cc.contextData as Record<string, unknown> || {}), metadata: cc.metadata || null };
              });
            }
          } catch (_) { }

          sendResponse({
            success: true, data: {
              id: sessionId, sessionId,
              title: (sessionRecord as Record<string, unknown> | undefined)?.title || "Chat",
              turns: rounds,
              providerContexts
            }
          });
        })().catch(e => sendResponse({ success: false, error: getErrorMessage(e) }));
        return true;
      }

      case "GET_SESSION": {
        const payload = (msg.payload as Record<string, unknown> | undefined) || undefined;
        const operationId = persistenceMonitor.startOperation("GET_SESSION", {
          sessionId: (msg.sessionId as string | undefined) || (payload?.sessionId as string | undefined),
        });

        try {
          const sessionId = (msg.sessionId as string | undefined) || (payload?.sessionId as string | undefined);
          const session = await sm.getOrCreateSession(sessionId as unknown as string);
          persistenceMonitor.endOperation(operationId, {
            sessionFound: !!session,
          });
          sendResponse({ success: true, session });
        } catch (error) {
          persistenceMonitor.endOperation(operationId, null, error);
          const handledError = await errorHandler.handleError(error, {
            operation: "getSession",
            sessionId: (msg.sessionId as string | undefined) || (payload?.sessionId as string | undefined),
            retry: () =>
              sm.getOrCreateSession(
                ((msg.sessionId as string | undefined) || (payload?.sessionId as string | undefined)) as unknown as string,
              ),
          });
          sendResponse({ success: false, error: getErrorMessage(handledError) });
        }
        return true;
      }

      case "SAVE_TURN": {
        const payload = (msg.payload as Record<string, unknown> | undefined) || undefined;
        const sessionId = (msg.sessionId as string | undefined) || (payload?.sessionId as string | undefined);
        await sm.addTurn(sessionId as unknown as string, (msg.turn as unknown) ?? (payload?.turn as unknown));
        sendResponse({ success: true });
        return true;
      }

      case "UPDATE_PROVIDER_CONTEXT": {
        const payload = (msg.payload as Record<string, unknown> | undefined) || undefined;
        const sessionId = (msg.sessionId as string | undefined) || (payload?.sessionId as string | undefined);
        await sm.updateProviderContext(
          sessionId as unknown as string,
          ((msg.providerId as string | undefined) || (payload?.providerId as string | undefined)) as unknown as string,
          ((msg.context as unknown) ?? (payload?.context as unknown)) as ProviderOutput,
        );
        sendResponse({ success: true });
        return true;
      }

      case "CREATE_THREAD": {
        const payload = (msg.payload as Record<string, unknown> | undefined) || undefined;
        const sessionId = (msg.sessionId as string | undefined) || (payload?.sessionId as string | undefined);
        const thread = await sm.createThread(
          sessionId as unknown as string,
          ((msg.title as string | undefined) || (payload?.title as string | undefined)) as unknown as string,
          ((msg.sourceAiTurnId as string | undefined) || (payload?.sourceAiTurnId as string | undefined)) as unknown as string,
        );
        sendResponse({ success: true, thread });
        return true;
      }

      case "SWITCH_THREAD": {
        const payload = (msg.payload as Record<string, unknown> | undefined) || undefined;
        const sessionId = (msg.sessionId as string | undefined) || (payload?.sessionId as string | undefined);
        await sm.switchThread(
          sessionId as unknown as string,
          ((msg.threadId as string | undefined) || (payload?.threadId as string | undefined)) as unknown as string,
        );
        sendResponse({ success: true });
        return true;
      }

      case "DELETE_SESSION": {
        const payload = (msg.payload as Record<string, unknown> | undefined) || undefined;
        const sessionId = (msg.sessionId as string | undefined) || (payload?.sessionId as string | undefined);
        try {
          const removed = await sm.deleteSession(sessionId as unknown as string);
          sendResponse({ success: true, removed });
        } catch (e) {
          console.error("[SW] DELETE_SESSION failed:", e);
          sendResponse({ success: false, error: getErrorMessage(e) });
        }
        return true;
      }

      case "DELETE_SESSIONS": {
        try {
          const payload = (msg.payload as Record<string, unknown> | undefined) || undefined;
          const ids = (
            (msg.sessionIds as unknown[]) ||
            (payload?.sessionIds as unknown[]) ||
            []
          ).filter(Boolean);
          if (!Array.isArray(ids) || ids.length === 0) {
            sendResponse({ success: false, error: "No sessionIds provided" });
            return true;
          }

          const results = await Promise.all(
            ids.map(async (id) => {
              try {
                const removed = await sm.deleteSession(id as unknown as string);
                return { id, removed };
              } catch (err) {
                console.error("[SW] DELETE_SESSIONS item failed:", id, err);
                return { id, removed: false };
              }
            }),
          );

          const removedIds = results.filter((r) => r.removed).map((r) => r.id);
          sendResponse({
            success: true,
            removed: removedIds.length,
            ids: removedIds,
          });
        } catch (e) {
          console.error("[SW] DELETE_SESSIONS failed:", e);
          sendResponse({ success: false, error: getErrorMessage(e) });
        }
        return true;
      }

      case "RENAME_SESSION": {
        try {
          const payload = (msg.payload as Record<string, unknown> | undefined) || undefined;
          const sessionId = (msg.sessionId as string | undefined) || (payload?.sessionId as string | undefined);
          const newTitleRaw = (msg.title as unknown) ?? (payload?.title as unknown);
          if (!sessionId) {
            sendResponse({ success: false, error: "Missing sessionId" });
            return true;
          }
          const newTitle = String(newTitleRaw ?? "").trim();
          if (!newTitle) {
            sendResponse({ success: false, error: "Title cannot be empty" });
            return true;
          }

          if (sm.adapter && sm.adapter.get) {
            const record = await sm.adapter.get("sessions", sessionId);
            if (!record) {
              sendResponse({ success: false, error: `Session ${sessionId} not found` });
              return true;
            }
            (record as Record<string, unknown>).title = newTitle;
            (record as Record<string, unknown>).updatedAt = Date.now();
            await sm.adapter.put("sessions", record as Record<string, unknown>);

            if (sm.sessions && sm.sessions[sessionId]) {
              sm.sessions[sessionId].title = newTitle;
              sm.sessions[sessionId].updatedAt = (record as Record<string, unknown>).updatedAt as number;
            }
          } else {
          }

          sendResponse({
            success: true,
            updated: true,
            sessionId,
            title: newTitle,
          });
        } catch (e) {
          console.error("[SW] RENAME_SESSION failed:", e);
          sendResponse({ success: false, error: getErrorMessage(e) });
        }
        return true;
      }

      case "GET_PERSISTENCE_STATUS": {
        const layer = services.get('persistenceLayer');
        const status = {
          persistenceEnabled: true,
          sessionManagerType: (sm as unknown as { constructor?: { name?: string } })?.constructor?.name || "unknown",
          persistenceLayerAvailable: !!layer,
          adapterStatus: (sm as unknown as { getPersistenceStatus?: () => unknown })?.getPersistenceStatus
            ? (sm as unknown as { getPersistenceStatus: () => unknown }).getPersistenceStatus()
            : null,
        };
        sendResponse({ success: true, status });
        return true;
      }

      default: {
        console.warn("[SW] Unknown message type ignored:", type);
        sendResponse({ success: false, error: "Unknown message type" });
        return true;
      }
    }
  } catch (e) {
    sendResponse({ success: false, error: getErrorMessage(e) });
    return true;
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const req = request as Record<string, unknown> | undefined;
  if (req?.$bus) return false;
  if (req?.__fromUnified) return false;
  if (req?.type === "offscreen.heartbeat") {
    sendResponse({ alive: true });
    return true;
  }
  if (req?.type === "htos.keepalive") {
    sendResponse({ success: true });
    return true;
  }
  if (req?.type === "htos.activity") {
    try {
      const lm = services.get("lifecycleManager") as { recordActivity?: () => void } | undefined;
      if (lm && typeof lm.recordActivity === "function") {
        lm.recordActivity();
      }
    } catch (_) { }
    sendResponse({ success: true });
    return true;
  }
  if (req?.type === "GET_HEALTH_STATUS") {
    const health = { serviceWorker: "active", registry: Array.from(services.services.keys()) };
    sendResponse({ success: true, status: health });
    return true;
  }
  if (req?.type) {
    handleUnifiedMessage(req, sender, sendResponse)
      .catch(err => {
        try {
          sendResponse({ success: false, error: getErrorMessage(err) });
        } catch (e) { }
      });
    return true;
  }
  return false;
});

// ============================================================================
// PORT CONNECTIONS
// ============================================================================
chrome.runtime.onConnect.addListener(async (port) => {
  if (port.name !== "htos-popup") return;
  console.log("[SW] New connection...");
  try {
    const handler = new (ConnectionHandler as unknown as new (
      port: chrome.runtime.Port,
      getServices: () => Promise<GlobalServices>,
    ) => { init: () => Promise<void> })(port, () => initializeGlobalServices());
    await handler.init();
    console.log("[SW] Connection handler ready");
  } catch (error) {
    console.error("[SW] Failed to initialize connection handler:", error);
    try { port.postMessage({ type: "INITIALIZATION_FAILED", error: getErrorMessage(error) }); } catch (_) { }
  }
});

chrome.action?.onClicked.addListener(async () => {
  const url = chrome.runtime.getURL("ui/index.html");
  try {
    const urlPatterns = [url, `${url}*`];
    const existing = await chrome.tabs.query({ url: urlPatterns });
    const tab = Array.isArray(existing) && existing.length > 0 ? existing[0] : null;
    if (tab && typeof tab.id === "number") {
      if (typeof tab.windowId === "number") {
        try {
          await chrome.windows.update(tab.windowId, { focused: true });
        } catch (_) { }
      }
      await chrome.tabs.update(tab.id, { active: true });
      return;
    }
  } catch (_) { }
  await chrome.tabs.create({ url });
});

// ============================================================================
// MAIN BOOTSTRAP
// ============================================================================

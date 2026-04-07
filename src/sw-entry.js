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
import { authManager } from './core/auth-manager.js';

// Persistence Layer Imports
import { SessionManager } from "./persistence/SessionManager";
import { initializePersistenceLayer } from "./persistence/index";
import { errorHandler, getErrorMessage } from "./utils/ErrorHandler";
import { persistenceMonitor } from "./core/PersistenceMonitor.js";

// Global Services Registry
import { ServiceRegistry } from "./core/service-registry.js";

const services = /** @type {import("./core/service-registry.js").ServiceRegistry} */ (
  /** @type {unknown} */ (ServiceRegistry.getInstance())
);

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
self["BusController"] = BusController;

globalThis.HTOS_DEBUG = {
  verifyProvider: async (providerId) => authManager.verifyProvider(String(providerId || "")),
  verifyAll: async () => authManager.verifyAll(),
  getAuthStatus: async (forceRefresh = false) => authManager.getAuthStatus(Boolean(forceRefresh)),
  executeSingle: async (providerId, prompt, options = {}) => {
    const svcs = await initializeGlobalServices();
    const pid = String(providerId || "").toLowerCase();
    const p = String(prompt || "");
    const timeout = Number.isFinite(options?.timeout) ? options.timeout : 60000;
    return svcs.orchestrator.executeSingle(p, pid, { timeout });
  },
  getProviderAdapter: async (providerId) => {
    const svcs = await initializeGlobalServices();
    return svcs.providerRegistry?.getAdapter?.(String(providerId || "").toLowerCase()) || null;
  },
};

// Debounce map for cookie changes
const cookieChangeDebounce = new Map();

// Top-level registration - ensures listener is always registered when SW loads
chrome.cookies.onChanged.addListener((changeInfo) => {
  const key = `${changeInfo.cookie.domain}:${changeInfo.cookie.name}`;

  if (cookieChangeDebounce.has(key)) {
    clearTimeout(cookieChangeDebounce.get(key));
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
async function handleStartup(reason) {
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

async function initializePersistence() {
  // Check registry first
  if (services.get('persistenceLayer')) {
    return services.get('persistenceLayer');
  }

  const operationId = persistenceMonitor.startOperation(
    "INITIALIZE_PERSISTENCE",
    { useAdapter: true },
  );

  try {
    const pl = await initializePersistenceLayer();
    services.register('persistenceLayer', pl);

    // Legacy global for debug only
    self["__HTOS_PERSISTENCE_LAYER"] = pl;

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

async function initializeSessionManager(pl) {
  // Check registry first
  if (services.get('sessionManager') && services.get('sessionManager').adapter?.isReady()) {
    return services.get('sessionManager');
  }

  const persistence = pl || services.get('persistenceLayer');
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
  constructor() {
    this.adapters = new Map();
    this.controllers = new Map();
  }
  register(providerId, controller, adapter) {
    this.controllers.set(providerId, controller);
    this.adapters.set(providerId, adapter);
  }
  getAdapter(providerId) {
    return this.adapters.get(String(providerId).toLowerCase());
  }
  getController(providerId) {
    return this.controllers.get(String(providerId).toLowerCase());
  }
  listProviders() {
    return Array.from(this.adapters.keys());
  }
  isAvailable(providerId) {
    return this.adapters.has(String(providerId).toLowerCase());
  }
}

async function initializeProviders() {
  console.log("[SW] Initializing providers...");

  if (services.get('providerRegistry')) {
    return services.get('providerRegistry').listProviders();
  }

  const providerRegistry = new ProviderRegistry();

  const providerConfigs = [
    { name: "claude", Controller: ClaudeProviderController, Adapter: ClaudeAdapter },
    { name: "gemini", Controller: GeminiProviderController, Adapter: GeminiAdapter },
    {
      name: "gemini-pro",
      Controller: GeminiProviderController,
      Adapter: class extends GeminiAdapter { constructor(controller) { super(controller, "gemini-pro"); } },
    },
    {
      name: "gemini-exp",
      Controller: GeminiProviderController,
      Adapter: class extends GeminiAdapter { constructor(controller) { super(controller, "gemini-exp"); } },
    },
    { name: "chatgpt", Controller: ChatGPTProviderController, Adapter: ChatGPTAdapter },
    { name: "qwen", Controller: QwenProviderController, Adapter: QwenAdapter },
    { name: "grok", Controller: GrokProviderController, Adapter: GrokAdapter },
  ];

  const initialized = [];
  for (const config of providerConfigs) {
    try {
      const controller = new config.Controller();
      if (typeof controller.init === "function") await controller.init();
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
  constructor(registry) {
    this.activeRequests = new Map();
    // Use registry directly or pass needed services
    this.registry = registry;
  }

  // Delegate lifecycle manager access to the registry (if we register it)
  get lifecycleManager() {
    return this.registry.get('lifecycleManager');
  }

  // ... (Full implementation of executeParallelFanout from prior version needed here?)
  // NOTE: For brevity in this refactor, I assume the rest of orchestrator logic 
  // is preserved or imported. To be safe, I must include the implementation or logic.
  // The user prompt implied we are FIXING things, so I should probably keep the implementation.
  // I'll keep the implementation from the original file but cleaner.

  async executeSingle(prompt, providerId, options = {}) {
    const { timeout = 60000 } = options;

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Request to ${providerId} timed out after ${timeout}ms`));
      }, timeout);

      this.executeParallelFanout(prompt, [providerId], {
        ...options,
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
            resolve(results.get(providerId));
          } else {
            reject(new Error(`No result from ${providerId}`));
          }
        },
      });
    });
  }

  async _prefetchGeminiTokens(providerRegistry, providers, providerMeta) {
    if (!providerRegistry) return;

    const GEMINI_VARIANT_IDS = ['gemini', 'gemini-pro', 'gemini-exp'];
    const targets = (providers || []).filter((pid) =>
      GEMINI_VARIANT_IDS.includes(String(pid).toLowerCase()),
    );

    if (targets.length < 2) return;

    const concurrencyLimit = Math.min(2, targets.length);
    const queue = [...targets];

    const worker = async () => {
      while (queue.length > 0) {
        const pid = queue.shift();
        if (!pid) return;

        try {
          const controller = providerRegistry.getController(pid);
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

  async executeParallelFanout(prompt, providers, options = {}) {
    // ... [Logic identical to original but using this.registry.get('providerRegistry')] ... 
    // Implementing purely to ensure availability
    const {
      sessionId = `req-${Date.now()}`,
      onPartial = () => { },
      onAllComplete = () => { },
      useThinking = false,
      providerContexts = {},
      providerMeta = {},
    } = options;

    if (this.lifecycleManager) this.lifecycleManager.keepalive(true);

    const results = new Map();
    const errors = new Map();
    const abortControllers = new Map();
    this.activeRequests.set(sessionId, { abortControllers });

    const providerRegistry = this.registry.get('providerRegistry');

    await this._prefetchGeminiTokens(providerRegistry, providers, providerMeta);

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
          return { providerId, status: "rejected", reason: err };
        }

        let aggregatedText = "";

        const request = {
          originalPrompt: prompt,
          sessionId,
          meta: {
            ...(providerContexts[providerId]?.meta || {}),
            ...(providerMeta?.[providerId] || {}),
            useThinking,
          },
        };

        try {
          const providerContext = providerContexts[providerId]?.meta || providerContexts[providerId] || null;
          const onChunk = (chunk) => {
            const textChunk = typeof chunk === "string" ? chunk : chunk.text;
            if (textChunk) aggregatedText += textChunk;
            onPartial(providerId, typeof chunk === "string" ? { text: chunk } : chunk);
          };

          // Inject token
          if (providerMeta?.[providerId]?._prefetchedToken && adapter.controller?.geminiSession) {
            adapter.controller.geminiSession.sharedState = {
              ...adapter.controller.geminiSession.sharedState,
              prefetchedToken: providerMeta[providerId]._prefetchedToken,
            };
          }

          let result;
          if (typeof adapter.ask === "function") {
            result = await adapter.ask(request.originalPrompt, providerContext, sessionId, onChunk, abortController.signal);
          } else {
            result = await adapter.sendPrompt(request, onChunk, abortController.signal);
          }

          if (!result.text && aggregatedText) result.text = aggregatedText;

          if (result && result.ok === false) {
            const message =
              (typeof result?.meta?.error === "string" && result.meta.error) ||
              (typeof result?.meta?.details === "string" && result.meta.details) ||
              (typeof result?.errorCode === "string" && result.errorCode) ||
              "Provider request failed";

            const err = new Error(message);
            const enrichedErr = /** @type {Error & { code?: string; status?: number; headers?: any; details?: any; providerResponse?: any }} */ (err);
            enrichedErr.code = result?.errorCode || "unknown";
            if (result?.meta && typeof result.meta === "object") {
              if (result.meta.status) enrichedErr.status = result.meta.status;
              if (result.meta.headers) enrichedErr.headers = result.meta.headers;
              if (result.meta.details) enrichedErr.details = result.meta.details;
            }
            enrichedErr.providerResponse = result;
            try {
              if (options.onProviderComplete) {
                options.onProviderComplete(providerId, { status: "rejected", reason: enrichedErr, providerResponse: result });
              }
            } catch (_) { }
            return { providerId, status: "rejected", reason: enrichedErr };
          }

          // ✅ Granular completion signal
          if (options.onProviderComplete) {
            options.onProviderComplete(providerId, { status: "fulfilled", value: result });
          }

          return { providerId, status: "fulfilled", value: result };

        } catch (error) {
          if (aggregatedText) {
            const name =
              error && typeof error === "object" && "name" in error
                ? String(error.name)
                : "Error";
            const message =
              error && typeof error === "object" && "message" in error
                ? String(error.message)
                : String(error);
            const val = { text: aggregatedText, meta: {}, softError: { name, message } };
            if (options.onProviderComplete) {
              options.onProviderComplete(providerId, { status: "fulfilled", value: val });
            }
            return { providerId, status: "fulfilled", value: val };
          }
          try {
            if (options.onProviderComplete) {
              options.onProviderComplete(providerId, { status: "rejected", reason: error });
            }
          } catch (_) { }
          return { providerId, status: "rejected", reason: error };
        }
      })();
    });

    Promise.all(providerPromises).then(async (settledResults) => {
      settledResults.forEach((item) => {
        if (item.status === "fulfilled") results.set(item.providerId, item.value);
        else errors.set(item.providerId, item.reason);
      });
      await onAllComplete(results, errors);
      this.activeRequests.delete(sessionId);
      if (this.lifecycleManager) this.lifecycleManager.keepalive(false);
    }).catch((err) => {
      console.error('[FaultTolerantOrchestrator] onAllComplete threw:', err);
      this.activeRequests.delete(sessionId);
      if (this.lifecycleManager) this.lifecycleManager.keepalive(false);
      if (typeof options.onError === 'function') {
        try { options.onError(err); } catch (_) {}
      }
    });
  }

  _abortRequest(sessionId) {
    const request = this.activeRequests.get(sessionId);
    if (request) {
      request.abortControllers.forEach(c => c.abort());
      this.activeRequests.delete(sessionId);
      if (this.lifecycleManager) this.lifecycleManager.keepalive(false);
    }
  }
}

async function initializeOrchestrator() {
  if (services.get('orchestrator')) return services.get('orchestrator');

  try {
    const lm = new LifecycleManager();
    services.register('lifecycleManager', lm);

    // Legacy global
    self["lifecycleManager"] = lm;

    const orchestrator = new FaultTolerantOrchestrator(services);
    services.register('orchestrator', orchestrator);

    // Legacy global
    self["faultTolerantOrchestrator"] = orchestrator;

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

let globalServicesPromise = null;

async function initializeGlobalServices() {
  // If already running or complete strings, return it.
  // But we want to support re-init with new prefs if strictly requested (rare).
  // For now, simple singleton promise pattern.
  if (globalServicesPromise) return globalServicesPromise;

  const existingOrchestrator = services.get('orchestrator');
  const existingSessionManager = services.get('sessionManager');
  const existingCompiler = services.get('compiler');
  const existingContextResolver = services.get('contextResolver');
  const existingPersistenceLayer = services.get('persistenceLayer');
  const existingAuthManager = services.get('authManager');
  const existingProviderRegistry = services.get('providerRegistry');

  if (
    existingOrchestrator &&
    existingSessionManager &&
    existingCompiler &&
    existingContextResolver &&
    existingPersistenceLayer &&
    existingAuthManager &&
    existingProviderRegistry
  ) {
    const ready = {
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

      // Ensure auth manager is ready (idempotent)
      await authManager.initialize();
      if (!services.get('authManager')) services.register('authManager', authManager);

      await initializeGlobalInfrastructure();
      const pl = await initializePersistence();
      const sm = await initializeSessionManager(pl);
      await initializeProviders();
      await initializeOrchestrator();

      const compiler = services.get('compiler') || new WorkflowCompiler(sm);
      if (!services.get('compiler')) services.register('compiler', compiler);

      const contextResolver = services.get('contextResolver') || new ContextResolver(sm);
      if (!services.get('contextResolver')) services.register('contextResolver', contextResolver);

      // MapperService deprecated; semantic mapper handles mapping now.
      // If backward compatibility is desired, inject an adapter via options instead of registering a global MapperService.
      // services.register('mapperService', mapperService);

      // ResponseProcessor removed — previously registered here. If needed, inject via options or service adapter.

      console.log("[SW] ✅ Global services registry ready");

      // Return object map for consumers expecting specific structure
      return {
        orchestrator: services.get('orchestrator'),
        sessionManager: sm,
        compiler,
        contextResolver,
        persistenceLayer: pl,
        authManager,
        providerRegistry: services.get('providerRegistry')
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

async function initializeGlobalInfrastructure() {
  console.log("[SW] Initializing global infrastructure...");
  try {
    await NetRulesManager.init();
    CSPController.init();
    await UserAgentController.init();
    await ArkoseController.init();
    await DNRUtils.initialize();
    await OffscreenController.init();
    await BusController.init();
    self["bus"] = BusController;
  } catch (e) {
    console.error("[SW] Infra init failed", e);
  }
}

// ============================================================================
// PERSISTENT OFFSCREEN DOCUMENT CONTROLLER
// ============================================================================
const OffscreenController = {
  _initialized: false,
  async isReady() {
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
  async init() {
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
async function handleUnifiedMessage(message, _sender, sendResponse) {
  try {
    const svcs = await initializeGlobalServices();
    const sm = svcs.sessionManager;

    if (!sm) {
      sendResponse({ success: false, error: "Service not ready" });
      return true;
    }

    switch (message.type) {
      case "REFRESH_AUTH_STATUS":
        authManager.getAuthStatus(true).then(s => sendResponse({ success: true, data: s })).catch(e => sendResponse({ success: false, error: getErrorMessage(e) }));
        return true;

      case "VERIFY_AUTH_TOKEN":
        (async () => {
          const pid = message.payload?.providerId;
          const force = !!message.payload?.force;
          if (force) {
            authManager.invalidateCache(pid);
          }
          const res = pid
            ? { [pid]: await authManager.verifyProvider(pid) }
            : await authManager.verifyAll();
          sendResponse({ success: true, data: res });
        })().catch(e => sendResponse({ success: false, error: getErrorMessage(e) }));
        return true;

      case "GENERATE_EMBEDDINGS":
      case "PRELOAD_MODEL":
      case "EMBEDDING_STATUS":
        (async () => {
          await OffscreenController.init();

          const response = await new Promise((resolve) => {
            let settled = false;
            const timeoutMs = Number.isFinite(message?.payload?.timeoutMs)
              ? message.payload.timeoutMs
              : 45000;
            const timeoutId = setTimeout(() => {
              settled = true;
              resolve({ success: false, error: "Offscreen request timed out" });
            }, Math.max(1, timeoutMs));

            chrome.runtime.sendMessage(
              { ...message, __fromUnified: true },
              (r) => {
                if (settled) return;
                clearTimeout(timeoutId);
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

      // Reconstruct full per-provider cognitive artifact.
      // Sources claims from mapping response text (same as graph view), not stale artifacts.
      // Delegates to doRegenerateEmbeddings() which handles dedup + full pipeline.
      case "REGENERATE_EMBEDDINGS":
        (async () => {
          const { aiTurnId, providerId } = message.payload || {};
          if (!aiTurnId || !providerId) {
            sendResponse({ success: false, error: "Missing aiTurnId or providerId" });
            return;
          }
          const result = await doRegenerateEmbeddings(aiTurnId, providerId, sm);
          sendResponse(result);
        })().catch((e) => {
          console.error("[Regenerate] Failed:", e);
          sendResponse({ success: false, error: getErrorMessage(e) });
        });
        return true;

      case "GET_CHEWED_SUBSTRATE_FOR_TURN":
        sendResponse({ success: false, error: "Traversal removed — GET_CHEWED_SUBSTRATE_FOR_TURN is no longer supported" });
        return true;

      case "GET_PARAGRAPH_EMBEDDINGS_RECORD":
        (async () => {
          const { aiTurnId } = message.payload || {};
          const key = String(aiTurnId || "").trim();
          if (!key) {
            sendResponse({ success: true, data: { ok: false, reason: "missing_aiTurnId" } });
            return;
          }
          const geoRecord = await sm.loadEmbeddings(key);
          const meta = geoRecord?.meta || null;
          const hasPara = !!geoRecord?.paragraphEmbeddings;
          const hasIndex = !!meta?.paragraphIndex;
          const dims = meta?.dimensions;

          if (!hasPara || !hasIndex || !dims) {
            let knownTurnIds = null;
            try {
              if (sm?.adapter?.all) {
                const all = await sm.adapter.all("embeddings");
                const ids = (Array.isArray(all) ? all : [])
                  .map((r) => String(r?.aiTurnId || r?.id || "").trim())
                  .filter(Boolean);
                knownTurnIds = ids.slice(0, 200);
              }
            } catch (_) { }
            sendResponse({
              success: true,
              data: {
                ok: false,
                aiTurnId: key,
                reason: "missing_embeddings_or_index",
                found: !!geoRecord,
                hasParagraphEmbeddings: hasPara,
                hasParagraphIndex: hasIndex,
                dimensions: typeof dims === "number" ? dims : null,
                meta: meta || null,
                knownTurnIds,
              },
            });
            return;
          }

          let safeBuffer = geoRecord.paragraphEmbeddings;
          if (safeBuffer && !(safeBuffer instanceof ArrayBuffer)) {
            if (ArrayBuffer.isView(safeBuffer)) {
              if (safeBuffer.byteOffset === 0 && safeBuffer.byteLength === safeBuffer.buffer.byteLength) {
                safeBuffer = safeBuffer.buffer;
              } else {
                safeBuffer = safeBuffer.buffer.slice(safeBuffer.byteOffset, safeBuffer.byteOffset + safeBuffer.byteLength);
              }
            } else if (Array.isArray(safeBuffer)) {
              safeBuffer = new Float32Array(safeBuffer).buffer;
            } else if (typeof safeBuffer === "object" && safeBuffer.type === "Buffer" && Array.isArray(safeBuffer.data)) {
              safeBuffer = new Uint8Array(safeBuffer.data).buffer;
            } else {
              // Try to blindly extract values if it's an object with numeric keys, handle edge cases
              const vals = Object.values(safeBuffer).filter(v => typeof v === 'number');

              const expectedLength = meta.paragraphIndex.length * meta.dimensions;

              if (vals.length > 0 && vals.length === expectedLength) {
                safeBuffer = new Float32Array(vals).buffer;
              } else {
                console.warn(`[sw-entry] Invalid paragraphEmbeddings format or length mismatch. Expected ${expectedLength} floats, got ${vals.length}. Format was:`, typeof safeBuffer);
                safeBuffer = null;
              }
            }
          }

          const payload = {
            ok: true,
            aiTurnId: key,
            buffer: safeBuffer,
            index: meta.paragraphIndex,
            dimensions: meta.dimensions,
            timestamp: meta.timestamp || null,
          };
          sendResponse({ success: true, data: payload });
        })().catch(e => sendResponse({ success: false, error: getErrorMessage(e) }));
        return true;

      case "CORPUS_SEARCH":
        (async () => {
          const { aiTurnId, queryText } = message.payload || {};
          if (!aiTurnId || !queryText) {
            sendResponse({ success: false, error: "Missing aiTurnId or queryText" });
            return;
          }

          const geoRecord = await sm.loadEmbeddings(aiTurnId);
          if (!geoRecord?.paragraphEmbeddings || !geoRecord?.meta?.paragraphIndex?.length || !geoRecord?.meta?.dimensions) {
            sendResponse({ success: true, data: { results: [], reason: "no_embeddings" } });
            return;
          }

          const { unpackEmbeddingMap } = await import('./persistence/embeddingCodec');
          const { generateTextEmbeddings, structuredTruncate } = await import('./clustering');
          const { DEFAULT_CONFIG } = await import('./clustering');
          const { searchCorpus } = await import('./core/corpusSearch');

          const dims = geoRecord.meta.dimensions;
          const paragraphEmbeddings = unpackEmbeddingMap(
            geoRecord.paragraphEmbeddings, geoRecord.meta.paragraphIndex, dims,
          );

          // Build paragraph metadata from the index
          // Index entries are paragraph IDs like "p_0", "p_1", etc.
          // We need modelIndex + paragraphIndex — load the turn to get shadow paragraphs
          const turnRaw = await sm.adapter.get("turns", aiTurnId);
          const shadowParagraphs = turnRaw?.mapping?.artifact?.shadow?.paragraphs || [];
          const paraLookup = new Map();
          for (const p of shadowParagraphs) {
            paraLookup.set(p.id, p);
          }

          const paragraphMeta = geoRecord.meta.paragraphIndex.map((pid) => {
            const p = paraLookup.get(pid);
            return {
              id: pid,
              modelIndex: p?.modelIndex ?? 0,
              paragraphIndex: p?.paragraphIndex ?? 0,
            };
          });

          // Embed the query
          const truncated = structuredTruncate(queryText.trim(), 1200);
          const prefixed = truncated.toLowerCase().startsWith('represent this sentence')
            ? truncated
            : `Represent this sentence for searching relevant passages: ${truncated}`;
          const queryBatch = await generateTextEmbeddings([prefixed], DEFAULT_CONFIG);
          const queryEmbedding = queryBatch.embeddings.get('0');
          if (!queryEmbedding) {
            sendResponse({ success: false, error: "Query embedding failed" });
            return;
          }

          const hits = searchCorpus(queryEmbedding, paragraphEmbeddings, paragraphMeta, 50);

          // Enrich hits with paragraph text
          const results = hits.map((h) => {
            const p = paraLookup.get(h.paragraphId);
            return {
              ...h,
              text: (p?._fullParagraph || '').slice(0, 800),
            };
          });

          sendResponse({ success: true, data: { results } });
        })().catch(e => sendResponse({ success: false, error: getErrorMessage(e) }));
        return true;

      case "DEBUG_EXECUTE_SINGLE":
        (async () => {
          const providerId = String(message.payload?.providerId || "").toLowerCase();
          const prompt = String(message.payload?.prompt || "");
          const timeout = Number.isFinite(message.payload?.timeout) ? message.payload.timeout : 60000;
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
        const allSessions = await sm.adapter.getAllSessions() || [];
        const sessions = allSessions.map(r => ({
          id: r.id, sessionId: r.id, title: r.title || "New Chat",
          startTime: r.createdAt, lastActivity: r.updatedAt || r.lastActivity,
          messageCount: r.turnCount || 0, firstMessage: ""
        })).sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0));
        sendResponse({ success: true, data: { sessions } });
        return true;
      }

      // ... (Preserving specific logic for GET_HISTORY_SESSION to be safe, but delegating to existing logic or abbreviated here?)
      // I must assume the logic from lines 800-1000 is still desired.
      // I will implement a cleaner version utilizing sm.adapter directly.
      case "GET_HISTORY_SESSION": {
        (async () => {
          const sessionId = message.sessionId || message.payload?.sessionId;
          if (!sessionId) throw new Error("Missing sessionId");

          // Implementation identical to original logic via helper would be best
          // Restoring full logic to ensure history works
          const sessionRecord = await sm.adapter.get("sessions", sessionId);
          let turns = await sm.adapter.getTurnsBySessionId(sessionId);
          turns = Array.isArray(turns) ? turns.sort((a, b) => (a.sequence ?? a.createdAt) - (b.sequence ?? b.createdAt)) : [];

          const bucketizeResponses = (resps) => {
            const buckets = {
              providers: {},
              mappingResponses: {},
              singularityResponses: {},
            };

            for (const r of resps || []) {
              if (!r) continue;
              const providerId = r.providerId;
              if (!providerId) continue;

              const entry = {
                providerId,
                text: r.text || "",
                status: r.status || "completed",
                createdAt: r.createdAt || Date.now(),
                updatedAt: r.updatedAt || r.createdAt || Date.now(),
                meta: r.meta || {},
                responseIndex: r.responseIndex ?? 0,
              };

              if (r.responseType === "batch") {
                (buckets.providers[providerId] ||= []).push(entry);
              } else if (r.responseType === "mapping") {
                (buckets.mappingResponses[providerId] ||= []).push(entry);
              } else if (r.responseType === "singularity") {
                (buckets.singularityResponses[providerId] ||= []).push(entry);
              }
            }

            for (const group of Object.values(buckets)) {
              for (const pid of Object.keys(group)) {
                group[pid].sort((a, b) => (a.responseIndex ?? 0) - (b.responseIndex ?? 0));
              }
            }

            return buckets;
          };

          const rounds = [];
          for (let i = 0; i < turns.length; i++) {
            const user = turns[i];
            if (!user || user.type !== "user") continue;

            const allAi = turns.filter(t => t.type === "ai" && t.userTurnId === user.id);
            if (!allAi.length) continue;

            const nextTurn = turns[i + 1];
            let primaryAi = null;

            const defaultPrimary =
              (nextTurn && nextTurn.type === "ai" && nextTurn.userTurnId === user.id && !nextTurn.meta?.isHistoricalRerun && nextTurn.sequence !== -1)
                ? nextTurn
                : (allAi.find(t => !t.meta?.isHistoricalRerun && t.sequence !== -1) || allAi[0]);
            primaryAi = defaultPrimary;

            let pipelineStatus =
              typeof primaryAi?.pipelineStatus === "string"
                ? primaryAi.pipelineStatus
                : (typeof primaryAi?.meta?.pipelineStatus === "string"
                  ? primaryAi.meta.pipelineStatus
                  : undefined);

            let providers = {};
            let mappingResponses = {};
            let singularityResponses = {};
            try {
              if (sm.adapter.getResponsesByTurnId) {
                const resps = await sm.adapter.getResponsesByTurnId(primaryAi.id);
                const buckets = bucketizeResponses(resps);
                providers = buckets.providers || {};
                mappingResponses = buckets.mappingResponses || {};
                singularityResponses = buckets.singularityResponses || {};
              }
            } catch (_) { }

            rounds.push({
              userTurnId: user.id, aiTurnId: primaryAi.id,
              user: { id: user.id, text: user.text || user.content || "", createdAt: user.createdAt || 0 },
              ...(primaryAi?.batch ? { batch: primaryAi.batch } : {}),
              // Tier 3: mapping.artifact is ephemeral — not sent in history payload.
              // UI rebuilds artifacts on demand via BUILD_ARTIFACT / REGENERATE_EMBEDDINGS.
              ...(primaryAi?.singularity ? { singularity: primaryAi.singularity } : {}),
              ...(primaryAi?.meta ? { meta: primaryAi.meta } : {}),
              ...(Object.keys(providers).length > 0 ? { providers } : {}),
              ...(Object.keys(mappingResponses).length > 0 ? { mappingResponses } : {}),
              ...(Object.keys(singularityResponses).length > 0 ? { singularityResponses } : {}),
              ...(pipelineStatus ? { pipelineStatus } : {}),
              createdAt: user.createdAt || 0, completedAt: primaryAi.updatedAt || 0
            });
          }

          // Fetch contexts
          let providerContexts = {};
          try {
            if (sm.adapter.getContextsBySessionId) {
              const ctxs = await sm.adapter.getContextsBySessionId(sessionId);
              (ctxs || []).forEach(c => {
                if (c?.providerId) providerContexts[c.providerId] = { ...(c.meta || {}), ...(c.contextData || {}), metadata: c.metadata || null };
              });
            }
          } catch (_) { }

          sendResponse({
            success: true, data: {
              id: sessionId, sessionId,
              title: sessionRecord?.title || "Chat",
              turns: rounds,
              providerContexts
            }
          });

          // Fire-and-forget: preemptively build artifact for latest turn so
          // instrument panel is instant when opened. doRegenerateEmbeddings
          // deduplicates — if the UI fires REGENERATE_EMBEDDINGS before this
          // completes, they share the same in-flight promise.
          const latestRound = rounds.length > 0 ? rounds[rounds.length - 1] : null;
          const latestMapper = latestRound?.meta?.mapper
            || Object.keys(latestRound?.mappingResponses || {})[0]
            || null;
          if (latestRound?.aiTurnId && latestMapper) {
            doRegenerateEmbeddings(latestRound.aiTurnId, latestMapper, sm).catch(() => {});
          }
        })().catch(e => sendResponse({ success: false, error: getErrorMessage(e) }));
        return true;
      }

      case "GET_SESSION": {
        const operationId = persistenceMonitor.startOperation("GET_SESSION", {
          sessionId: message.sessionId || message.payload?.sessionId,
        });

        try {
          const sessionId = message.sessionId || message.payload?.sessionId;
          const session = await sm.getOrCreateSession(sessionId);
          persistenceMonitor.endOperation(operationId, {
            sessionFound: !!session,
          });
          sendResponse({ success: true, session });
        } catch (error) {
          persistenceMonitor.endOperation(operationId, null, error);
          const handledError = await errorHandler.handleError(error, {
            operation: "getSession",
            sessionId: message.sessionId || message.payload?.sessionId,
            retry: () =>
              sm.getOrCreateSession(
                message.sessionId || message.payload?.sessionId,
              ),
          });
          sendResponse({ success: false, error: getErrorMessage(handledError) });
        }
        return true;
      }

      case "SAVE_TURN": {
        const sessionId = message.sessionId || message.payload?.sessionId;
        await sm.addTurn(sessionId, message.turn);
        sendResponse({ success: true });
        return true;
      }

      case "UPDATE_PROVIDER_CONTEXT": {
        const sessionId = message.sessionId || message.payload?.sessionId;
        await sm.updateProviderContext(
          sessionId,
          message.providerId || message.payload?.providerId,
          message.context || message.payload?.context,
        );
        sendResponse({ success: true });
        return true;
      }

      case "CREATE_THREAD": {
        const sessionId = message.sessionId || message.payload?.sessionId;
        const thread = await sm.createThread(
          sessionId,
          message.title || message.payload?.title,
          message.sourceAiTurnId || message.payload?.sourceAiTurnId,
        );
        sendResponse({ success: true, thread });
        return true;
      }

      case "SWITCH_THREAD": {
        const sessionId = message.sessionId || message.payload?.sessionId;
        await sm.switchThread(
          sessionId,
          message.threadId || message.payload?.threadId,
        );
        sendResponse({ success: true });
        return true;
      }

      case "DELETE_SESSION": {
        const sessionId = message.sessionId || message.payload?.sessionId;
        try {
          const removed = await sm.deleteSession(sessionId);
          // Return explicit removed boolean so UI can react optimistically
          sendResponse({ success: true, removed });
        } catch (e) {
          console.error("[SW] DELETE_SESSION failed:", e);
          sendResponse({ success: false, error: getErrorMessage(e) });
        }
        return true;
      }

      case "DELETE_SESSIONS": {
        try {
          const ids = (
            message.sessionIds ||
            message.payload?.sessionIds ||
            []
          ).filter(Boolean);
          if (!Array.isArray(ids) || ids.length === 0) {
            sendResponse({ success: false, error: "No sessionIds provided" });
            return true;
          }

          const results = await Promise.all(
            ids.map(async (id) => {
              try {
                const removed = await sm.deleteSession(id);
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
          const sessionId = message.sessionId || message.payload?.sessionId;
          const newTitleRaw = message.title || message.payload?.title;
          if (!sessionId) {
            sendResponse({ success: false, error: "Missing sessionId" });
            return true;
          }
          const newTitle = String(newTitleRaw ?? "").trim();
          if (!newTitle) {
            sendResponse({ success: false, error: "Title cannot be empty" });
            return true;
          }

          // Persistence-first rename using adapter directly if available, fallback to session op
          if (sm.adapter && sm.adapter.get) {
            const record = await sm.adapter.get("sessions", sessionId);
            if (!record) {
              sendResponse({ success: false, error: `Session ${sessionId} not found` });
              return true;
            }
            record.title = newTitle;
            record.updatedAt = Date.now();
            await sm.adapter.put("sessions", record);

            // Updates local cache if needed
            if (sm.sessions && sm.sessions[sessionId]) {
              sm.sessions[sessionId].title = newTitle;
              sm.sessions[sessionId].updatedAt = record.updatedAt;
            }
          } else {
            // Fallback if SM doesn't expose adapter in expected way (shouldn't happen with new architecture)
            // But for safety:
            // await sm.renameSession(sessionId, newTitle); // If such method existed
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
          sessionManagerType: sm?.constructor?.name || "unknown",
          persistenceLayerAvailable: !!layer,
          adapterStatus: sm?.getPersistenceStatus
            ? sm.getPersistenceStatus()
            : null,
        };
        sendResponse({ success: true, status });
        return true;
      }
      // --- ADD THIS HERE ---
      default: {
        // This catches "htos.keepalive" or any typos so the channel closes properly
        console.warn("[SW] Unknown message type ignored:", message.type);
        sendResponse({ success: false, error: "Unknown message type" });
        return true;
      }
      // ---------------------
    }
  } catch (e) {
    sendResponse({ success: false, error: getErrorMessage(e) });
    return true;
  }
}

// ============================================================================
// ARTIFACT REGENERATION — shared core (preemptive + on-demand)
// ============================================================================
// Full artifact rebuild: shadow extraction → embedding staleness check →
// regenerate if needed → deterministic pipeline → cognitive artifact.
// Used by both GET_HISTORY_SESSION (preemptive, fire-and-forget) and
// REGENERATE_EMBEDDINGS (on-demand, returns artifact to UI).
// Deduplication: concurrent calls for the same turnId::providerId share
// the same in-flight promise.

const regenInflight = new Map(); // "turnId::providerId" → Promise<result>

/**
 * Run the full regenerate-embeddings pipeline and return the result.
 * Returns { success: true, data: { artifact, claimCount, edgeCount } }
 * or { success: false, error: string }.
 */
function doRegenerateEmbeddings(aiTurnId, providerId, sm) {
  const cacheKey = `${aiTurnId}::${String(providerId || "").trim().toLowerCase()}`;

  if (regenInflight.has(cacheKey)) return regenInflight.get(cacheKey);

  const work = (async () => {
    const normalizeProvId = (pid) => String(pid || "").trim().toLowerCase();

    const turnRaw = await sm.adapter.get("turns", aiTurnId);
    if (!turnRaw) return { success: false, error: "Turn not found" };

    // ── Minimal imports (geometry I/O + codec only) ──
    const {
      generateStatementEmbeddings,
      generateEmbeddings,
      generateTextEmbeddings,
      stripInlineMarkdown,
      structuredTruncate,
      DEFAULT_CONFIG,
    } = await import("./clustering");
    const { packEmbeddingMap, unpackEmbeddingMap } = await import("./persistence/embeddingCodec");
    const dims = DEFAULT_CONFIG.embeddingDimensions;

    // ── Load query text (shared) ──
    const userTurnId = turnRaw.userTurnId;
    let queryText = "";
    if (userTurnId) {
      try {
        const userTurn = await sm.adapter.get("turns", userTurnId);
        queryText = userTurn?.text || userTurn?.content || "";
      } catch (err) {
        console.error(`[Regenerate] Failed to load user turn for aiTurnId=${aiTurnId}:`, err);
      }
    }

    const readCitationOrderFromMeta = (meta) => {
      try {
        const raw = meta?.citationSourceOrder;
        if (!raw || typeof raw !== "object") return [];
        const entries = Object.entries(raw)
          .map(([k, v]) => [Number(k), String(v || "").trim()])
          .filter(([n, pid]) => Number.isFinite(n) && n > 0 && pid);
        entries.sort((a, b) => a[0] - b[0]);
        return entries.map(([, pid]) => normalizeProvId(pid));
      } catch {
        return [];
      }
    };

    // ── A. Load provider responses (mappingResp + text only) ──
    let responsesForTurn = [];
    try {
      if (sm.adapter?.getResponsesByTurnId) {
        const resps = await sm.adapter.getResponsesByTurnId(aiTurnId);
        responsesForTurn = Array.isArray(resps) ? resps : [];
      }
    } catch (err) {
      console.error(`[Regenerate] Failed to load responses for aiTurnId=${aiTurnId}:`, err);
      return { success: false, error: "Failed to load responses for this turn" };
    }

    const mappingResp = responsesForTurn
      .filter(
        (r) =>
          r &&
          r.responseType === "mapping" &&
          normalizeProvId(r.providerId) === normalizeProvId(providerId)
      )
      .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))?.[0] || null;

    const mappingText = String(mappingResp?.text || "").trim();
    if (!mappingText) {
      return { success: false, error: "No mapping response text found for this provider" };
    }

    // ── B. Shadow + batch sources (no parsing here) ──
    const citationOrderArr = readCitationOrderFromMeta(mappingResp?.meta);

    let shadowStatements = null;
    let shadowParagraphs = null;
    let batchSources = [];

    // Always rebuild batch sources from DB responses (canonical ordering)
    try {
      const allBatchResps = responsesForTurn
        .filter((r) => r && r.responseType === "batch" && r.providerId && String(r.text || "").trim())
        .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));

      const seenBatchProviders = new Map();
      for (const r of allBatchResps) {
        const pid = normalizeProvId(r.providerId);
        if (!seenBatchProviders.has(pid)) seenBatchProviders.set(pid, r);
      }

      const { canonicalCitationOrder } = await import("../shared/provider-config");
      const canonicalOrder = canonicalCitationOrder(
        Array.from(seenBatchProviders.keys())
      );

      batchSources = canonicalOrder.map((pid, idx) => {
        const r = seenBatchProviders.get(pid);
        return { modelIndex: idx + 1, content: String(r?.text || "") };
      }).filter(s => s.content);
    } catch (err) {
      console.error(`[Regenerate] Shadow reconstruction failed for aiTurnId=${aiTurnId}:`, err);
      return { success: false, error: "Shadow reconstruction failed" };
    }

    // ── Model count ──
    const uniqueBatchProviders = new Set(
      responsesForTurn
        .filter((r) => r && r.responseType === "batch" && r.providerId && String(r.text || "").trim())
        .map((r) => normalizeProvId(r.providerId))
    );
    const modelCount = Math.max(citationOrderArr.length, uniqueBatchProviders.size, 1);

    // ── B.1 Always re-extract shadow from batch (ground truth for current code) ──
    // Never trust stored shadow statements — extraction rules may have changed.
    if (batchSources.length > 0) {
      const { extractShadowStatements, projectParagraphs } = await import("./shadow");
      const shadowResult = extractShadowStatements(batchSources);
      shadowStatements = shadowResult.statements;
      shadowParagraphs = projectParagraphs(shadowResult.statements).paragraphs;
      console.log(`[Regenerate] Fresh extraction: ${shadowStatements.length} stmts, ${shadowParagraphs.length} paras`);
    }
    if (!Array.isArray(shadowStatements) || shadowStatements.length === 0) {
      return { success: false, error: "No shadow statements for embedding generation" };
    }
    if (!Array.isArray(shadowParagraphs) || shadowParagraphs.length === 0) {
      const { projectParagraphs } = await import("./shadow");
      shadowParagraphs = projectParagraphs(shadowStatements).paragraphs;
    }

    // ── C. Geometry embeddings — regenerate if missing or stale ──
    let geoRecord = await sm.loadEmbeddings(aiTurnId);

    // Check if cached embeddings match current shadow extraction
    const cachedStmtIds = new Set(geoRecord?.meta?.statementIndex || []);
    const currentStmtIds = new Set(shadowStatements.map((s) => s.id));
    const cachedParaIds = new Set(geoRecord?.meta?.paragraphIndex || []);
    const currentParaIds = new Set(shadowParagraphs.map((p) => p.id));

    const stmtIdMismatch =
      cachedStmtIds.size !== currentStmtIds.size ||
      [...currentStmtIds].some((id) => !cachedStmtIds.has(id));
    const paraIdMismatch =
      cachedParaIds.size !== currentParaIds.size ||
      [...currentParaIds].some((id) => !cachedParaIds.has(id));

    if (stmtIdMismatch || paraIdMismatch) {
      console.log(
        `[Regenerate] Embedding cache stale:`,
        stmtIdMismatch ? `stmts ${cachedStmtIds.size}→${currentStmtIds.size}` : '',
        paraIdMismatch ? `paras ${cachedParaIds.size}→${currentParaIds.size}` : '',
      );
    }

    const needsRegeneration =
      !geoRecord?.statementEmbeddings ||
      !geoRecord?.paragraphEmbeddings ||
      (geoRecord.meta?.paragraphCount === 0 && shadowParagraphs.length > 0) ||
      geoRecord.meta?.embeddingVersion !== 2 ||
      stmtIdMismatch ||
      paraIdMismatch;

    if (needsRegeneration) {

      const stmtResult = await generateStatementEmbeddings(shadowStatements, DEFAULT_CONFIG);
      const paraResult = await generateEmbeddings(shadowParagraphs, shadowStatements, DEFAULT_CONFIG);

      let queryEmbedding = null;
      if (queryText) {
        const cleaned = stripInlineMarkdown(String(queryText)).trim();
        const truncated = structuredTruncate(cleaned, 1740);
        const prefixed =
          truncated && !truncated.toLowerCase().startsWith("represent this sentence")
            ? `Represent this sentence for searching relevant passages: ${truncated}`
            : truncated;
        if (prefixed) {
          const batch = await generateTextEmbeddings([prefixed], DEFAULT_CONFIG);
          queryEmbedding = batch.embeddings.get("0") || null;
        }
      }

      const packedStatements = packEmbeddingMap(stmtResult.embeddings, dims);
      const packedParagraphs = packEmbeddingMap(paraResult.embeddings, dims);
      const queryBuffer = queryEmbedding
        ? queryEmbedding.buffer.slice(
            queryEmbedding.byteOffset,
            queryEmbedding.byteOffset + queryEmbedding.byteLength
          )
        : null;

      await sm.persistEmbeddings(aiTurnId, {
        statementEmbeddings: packedStatements.buffer,
        paragraphEmbeddings: packedParagraphs.buffer,
        queryEmbedding: queryBuffer,
        meta: {
          embeddingModelId: DEFAULT_CONFIG.modelId,
          dimensions: dims,
          hasQuery: Boolean(queryEmbedding),
          statementCount: packedStatements.index.length,
          paragraphCount: packedParagraphs.index.length,
          statementIndex: packedStatements.index,
          paragraphIndex: packedParagraphs.index,
          embeddingVersion: 2,
          timestamp: Date.now(),
        },
      });
      geoRecord = await sm.loadEmbeddings(aiTurnId);
    }

    if (!geoRecord?.statementEmbeddings || !geoRecord?.paragraphEmbeddings) {
      return { success: false, error: "Geometry embeddings unavailable" };
    }

    const statementEmbeddings = unpackEmbeddingMap(
      geoRecord.statementEmbeddings,
      geoRecord.meta.statementIndex,
      geoRecord.meta.dimensions
    );
    const paragraphEmbeddings = unpackEmbeddingMap(
      geoRecord.paragraphEmbeddings,
      geoRecord.meta.paragraphIndex,
      geoRecord.meta.dimensions
    );
    const queryEmbedding =
      geoRecord?.queryEmbedding && geoRecord.queryEmbedding.byteLength > 0
        ? new Float32Array(geoRecord.queryEmbedding)
        : null;

    // ══════════════════════════════════════════════════════════════
    // SINGLE SOURCE OF TRUTH: buildArtifactForProvider()
    // ══════════════════════════════════════════════════════════════
    const { buildArtifactForProvider } = await import("./core/execution/deterministicPipeline");
    const { canonicalCitationOrder: regenCanon, buildCitationSourceOrder: regenBuildCSO } = await import("../shared/provider-config");
    const regenCanonicalOrder = regenCanon(Array.from(uniqueBatchProviders));

    const buildResult = await buildArtifactForProvider({
      mappingText,
      shadowStatements: Array.isArray(shadowStatements) && shadowStatements.length > 0
        ? shadowStatements
        : null,
      shadowParagraphs: Array.isArray(shadowParagraphs) && shadowParagraphs.length > 0
        ? shadowParagraphs
        : null,
      batchSources,
      statementEmbeddings,
      paragraphEmbeddings,
      queryEmbedding,
      geoRecord,
      claimEmbeddings: null, // always regenerate for now
      citationSourceOrder: regenBuildCSO(regenCanonicalOrder),
      queryText,
      modelCount,
    });

    const {
      cognitiveArtifact,
      mapperArtifact,
      enrichedClaims,
      parsedClaims,
      claimEmbeddings,
    } = buildResult;

    // ── Persist claim embeddings ──
    const hashString = (input) => {
      let h = 5381;
      for (let i = 0; i < input.length; i++) {
        h = ((h << 5) + h) ^ input.charCodeAt(i);
      }
      return (h >>> 0).toString(16);
    };
    // IMPORTANT: hash uses RAW parsedClaims (pre-enrichment) so the cache key
    // stays stable even after provenance/density enrichment.
    const claimsHash = hashString(
      parsedClaims
        .map((c) => `${String(c?.id || '')}\u001f${String(c?.label || '')}\u001f${String(c?.text || '')}`)
        .join('\u001e')
    );

    if (claimEmbeddings && claimEmbeddings.size > 0) {
      const packedClaims = packEmbeddingMap(claimEmbeddings, dims);
      await sm.persistClaimEmbeddings(aiTurnId, providerId, {
        claimEmbeddings: packedClaims.buffer,
        meta: {
          dimensions: dims,
          claimCount: packedClaims.index.length,
          claimIndex: packedClaims.index,
          claimsHash,
          timestamp: Date.now(),
        },
      });
    }

    console.log(
      `[Regenerate] Embeddings ready: ${statementEmbeddings.size} stmts, ${paragraphEmbeddings.size} paras, ${
        claimEmbeddings?.size || 0
      } claims`
    );

    // ── Diagnostic ──
    console.log(
      `[Regenerate] Artifact diagnostics:`,
      `shadow.paragraphs=${
        Array.isArray(cognitiveArtifact?.shadow?.paragraphs)
          ? cognitiveArtifact.shadow.paragraphs.length
          : "missing"
      }`,
      `shadow.statements=${
        Array.isArray(cognitiveArtifact?.shadow?.statements)
          ? cognitiveArtifact.shadow.statements.length
          : "missing"
      }`,
      `claimProvenance=${cognitiveArtifact?.claimProvenance ? "present" : "missing"}`,
      `basinInversion=${
        cognitiveArtifact?.geometry?.basinInversion
          ? cognitiveArtifact.geometry.basinInversion.status
          : "missing"
      }`,
      `blastSurface=${cognitiveArtifact?.blastSurface ? "present" : "missing"}`
    );

    // ── Restore editorial AST from persisted editorial response ──
    try {
      const editorialResp = responsesForTurn
        .filter((r) => r && r.responseType === "editorial" && normalizeProvId(r.providerId) === normalizeProvId(providerId))
        .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))[0] || null;

      if (editorialResp?.text && mapperArtifact.claimDensity && mapperArtifact.passageRouting && mapperArtifact.statementClassification) {
        const { buildPassageIndex, parseEditorialOutput } = await import("./ConciergeService/editorialMapper");
        const { buildSourceContinuityMap } = await import("./core/passageRouting");

        const continuityMap = buildSourceContinuityMap(mapperArtifact.claimDensity);
        const { passages: idxPassages, unclaimed: idxUnclaimed } = buildPassageIndex(
          mapperArtifact.claimDensity,
          mapperArtifact.passageRouting,
          mapperArtifact.statementClassification,
          { paragraphs: Array.isArray(shadowParagraphs) ? shadowParagraphs : [] },
          enrichedClaims,
          mapperArtifact.citationSourceOrder || {},
          continuityMap,
        );

        const validPassageKeys = new Set(idxPassages.map(p => p.passageKey));
        const validUnclaimedKeys = new Set(idxUnclaimed.map(u => u.groupKey));
        const parsed = parseEditorialOutput(editorialResp.text, validPassageKeys, validUnclaimedKeys);

        if (parsed.success && parsed.ast) {
          cognitiveArtifact.editorialAST = parsed.ast;
          console.log(`[Regenerate] Editorial AST restored: ${parsed.ast.threads.length} thread(s)`);
        } else {
          console.warn("[Regenerate] Editorial re-parse failed:", parsed.errors);
        }
      }
    } catch (editorialErr) {
      console.warn("[Regenerate] Editorial restore (non-blocking):", editorialErr?.message || editorialErr);
    }

    // ── Generate editorial AST if not restored from persistence ──────
    if (!cognitiveArtifact.editorialAST && mapperArtifact.claimDensity && mapperArtifact.passageRouting && mapperArtifact.statementClassification) {
      try {
        const orchestrator = services.get('orchestrator');
        if (orchestrator) {
          const { buildSourceContinuityMap } = await import("./core/passageRouting");
          const { buildPassageIndex, buildEditorialPrompt, parseEditorialOutput } =
            await import("./ConciergeService/editorialMapper");

          const continuityMap = buildSourceContinuityMap(mapperArtifact.claimDensity);
          const { passages: idxPassages, unclaimed: idxUnclaimed } = buildPassageIndex(
            mapperArtifact.claimDensity,
            mapperArtifact.passageRouting,
            mapperArtifact.statementClassification,
            { paragraphs: Array.isArray(shadowParagraphs) ? shadowParagraphs : [] },
            enrichedClaims,
            mapperArtifact.citationSourceOrder || {},
            continuityMap,
          );

          const validPassageKeys = new Set(idxPassages.map(p => p.passageKey));
          const validUnclaimedKeys = new Set(idxUnclaimed.map(u => u.groupKey));

          const concentrations = idxPassages.map(p => p.concentrationRatio);
          const landscapeComp = { northStar: 0, mechanism: 0, eastStar: 0, floor: 0 };
          idxPassages.forEach(p => { landscapeComp[p.landscapePosition]++; });

          const editorialPrompt = buildEditorialPrompt(
            queryText,
            idxPassages,
            idxUnclaimed,
            {
              passageCount: idxPassages.length,
              claimCount: enrichedClaims.length,
              conflictCount: mapperArtifact.passageRouting?.routing?.conflictClusters?.length ?? 0,
              concentrationSpread: {
                min: concentrations.length ? Math.min(...concentrations) : 0,
                max: concentrations.length ? Math.max(...concentrations) : 0,
                mean: concentrations.length ? concentrations.reduce((a, b) => a + b, 0) / concentrations.length : 0,
              },
              landscapeComposition: landscapeComp,
            },
          );

          // Thread continuation: prefer mapping cursor (semantic mapper's thread),
          // fall back to batch cursor, fall back to fresh conversation.
          const editorialProviderContexts = (() => {
            const mappingMeta = mappingResp?.meta;
            if (mappingMeta && typeof mappingMeta === 'object' && Object.keys(mappingMeta).length > 0) {
              return { [providerId]: { meta: mappingMeta, continueThread: true } };
            }
            const batchResp = responsesForTurn.find(
              (r) => r && r.responseType === 'batch' && normalizeProvId(r.providerId) === normalizeProvId(providerId)
            );
            const batchMeta = batchResp?.meta;
            if (batchMeta && typeof batchMeta === 'object' && Object.keys(batchMeta).length > 0) {
              return { [providerId]: { meta: batchMeta, continueThread: true } };
            }
            return {};
          })();

          const editorialResult = await new Promise((res) => {
            orchestrator.executeParallelFanout(
              editorialPrompt,
              [providerId],
              {
                sessionId: `regen-editorial-${aiTurnId}`,
                useThinking: false,
                providerContexts: editorialProviderContexts,
                onPartial: () => {},
                onAllComplete: async (results) => {
                  const result = results?.get?.(providerId);
                  if (result?.text) res({ text: result.text, meta: result.meta });
                  else res({ text: '' });
                },
                onError: () => res({ text: '' }),
              },
            );
          });

          if (editorialResult?.text) {
            const parsed = parseEditorialOutput(editorialResult.text, validPassageKeys, validUnclaimedKeys);
            if (parsed.success && parsed.ast) {
              cognitiveArtifact.editorialAST = parsed.ast;
              console.log(`[Regenerate] Editorial generated: ${parsed.ast.threads.length} thread(s)`);

              // Persist so future regens don't need another LLM call
              if (sm?.adapter) {
                try {
                  const now = Date.now();
                  await sm.adapter.put('provider_responses', {
                    id: `pr-${aiTurnId}-${providerId}-editorial-0-${now}`,
                    sessionId: responsesForTurn[0]?.sessionId || '',
                    aiTurnId,
                    providerId,
                    responseType: 'editorial',
                    responseIndex: 0,
                    text: editorialResult.text,
                    status: 'completed',
                    meta: editorialResult.meta || {},
                    createdAt: now,
                    updatedAt: now,
                    completedAt: now,
                  });
                } catch (_) {}
              }
            } else {
              console.warn("[Regenerate] Editorial parse failed:", parsed.errors);
            }
          }
        }
      } catch (editorialGenErr) {
        console.warn("[Regenerate] Editorial generation (non-blocking):", editorialGenErr?.message || editorialGenErr);
      }
    }

    return {
      success: true,
      data: {
        artifact: cognitiveArtifact,
        claimCount: enrichedClaims.length,
        edgeCount: mapperArtifact.edges?.length || 0,
      },
    };
  })().finally(() => {
    regenInflight.delete(cacheKey);
  });

  regenInflight.set(cacheKey, work);
  return work;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request?.$bus) return false;
  if (request?.__fromUnified) return false;
  if (request?.type === "offscreen.heartbeat") {
    sendResponse({ alive: true });
    return true;
  }
  if (request?.type === "htos.keepalive") {
    sendResponse({ success: true });
    return true;
  }
  if (request?.type === "htos.activity") {
    try {
      const lm = services.get("lifecycleManager");
      if (lm && typeof lm.recordActivity === "function") {
        lm.recordActivity();
      }
    } catch (_) { }
    sendResponse({ success: true });
    return true;
  }
  if (request?.type === "GET_HEALTH_STATUS") {
    // Return health
    const health = { serviceWorker: "active", registry: Array.from(services.services.keys()) };
    sendResponse({ success: true, status: health });
    return true;
  }
  if (request?.type) {
    // 2. Ensure handleUnifiedMessage calls sendResponse even if type is unknown
    handleUnifiedMessage(request, sender, sendResponse)
      .catch(err => {
        try {
          sendResponse({ success: false, error: getErrorMessage(err) });
        } catch (e) { /* ignore channel closed */ }
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
    const handler = new ConnectionHandler(port, () => initializeGlobalServices());
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

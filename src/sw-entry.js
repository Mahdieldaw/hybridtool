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
      // Only embedding model call needed; everything else is deterministic math.
      case "REGENERATE_EMBEDDINGS":
        (async () => {
          const { aiTurnId, providerId, persist } = message.payload || {};
          if (!aiTurnId || !providerId) { sendResponse({ success: false, error: "Missing aiTurnId or providerId" }); return; }
          const shouldPersistArtifact = persist !== false;
          const turnRaw = await sm.adapter.get("turns", aiTurnId);
          if (!turnRaw) { sendResponse({ success: false, error: "Turn not found" }); return; }

          const { generateStatementEmbeddings, generateEmbeddings, generateTextEmbeddings, stripInlineMarkdown, structuredTruncate, DEFAULT_CONFIG } = await import('./clustering');
          const { generateClaimEmbeddings, reconstructProvenance, computeElbowDiagnosticsFromEmbeddings } = await import('./ConciergeService/claimAssembly');
          const { computeStatementOwnership, computeClaimExclusivity, computeClaimOverlap } = await import('./ConciergeService/claimProvenance');
          const { parseSemanticMapperOutput } = await import('./ConciergeService/semanticMapper');
          const { packEmbeddingMap, unpackEmbeddingMap } = await import('./persistence/embeddingCodec');
          const { buildCognitiveArtifact } = await import('../shared/cognitive-artifact');
          const { computeBasinInversion } = await import('../shared/geometry/basinInversion');
          const { extractForcingPoints } = await import('./utils/cognitive/traversalEngine');
          const { computeShadowDelta, getTopUnreferenced } = await import('./shadow/ShadowDelta');
          const { buildGeometricSubstrate } = await import('./geometry/substrate');
          const { buildPreSemanticInterpretation, computePerModelQueryRelevance } = await import('./geometry/interpretation');
          const { computeQueryRelevance } = await import('./geometry/queryRelevance');
          const { enrichStatementsWithGeometry } = await import('./geometry/enrichment');
          const dims = DEFAULT_CONFIG.embeddingDimensions;

          const normalizeProvId = (pid) => String(pid || "").trim().toLowerCase();

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

          const coerceJson = (value) => {
            if (!value) return null;
            if (typeof value === "string") { try { return JSON.parse(value); } catch { return null; } }
            return value;
          };

          const readCitationOrderFromMeta = (meta) => {
            try {
              const raw = meta?.citationSourceOrder;
              if (!raw || typeof raw !== "object") return [];
              const entries = Object.entries(raw)
                .map(([k, v]) => [Number(k), String(v || "").trim()])
                .filter(([n, pid]) => Number.isFinite(n) && n > 0 && pid);
              entries.sort((a, b) => a[0] - b[0]);
              return entries.map(([, pid]) => normalizeProvId(pid));
            } catch { return []; }
          };

          // ── A. Load provider responses and parse claims from mapping text ──
          let responsesForTurn = [];
          try {
            if (sm.adapter?.getResponsesByTurnId) {
              const resps = await sm.adapter.getResponsesByTurnId(aiTurnId);
              responsesForTurn = Array.isArray(resps) ? resps : [];
            }
          } catch (err) {
            console.error(`[Regenerate] Failed to load responses for aiTurnId=${aiTurnId}:`, err);
            sendResponse({ success: false, error: "Failed to load responses for this turn" });
            return;
          }

          const mappingResp = responsesForTurn
            .filter((r) => r && r.responseType === "mapping" && normalizeProvId(r.providerId) === normalizeProvId(providerId))
            .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))?.[0] || null;

          const mappingText = String(mappingResp?.text || "").trim();
          if (!mappingText) { sendResponse({ success: false, error: "No mapping response text found for this provider" }); return; }

          const parseResult = parseSemanticMapperOutput(mappingText);
          if (!parseResult?.success || !parseResult?.output) {
            sendResponse({ success: false, error: "Failed to parse mapping response text into claims/edges" }); return;
          }

          const parsedClaims = Array.isArray(parseResult.output.claims) ? parseResult.output.claims : [];
          const parsedEdges = Array.isArray(parseResult.output.edges) ? parseResult.output.edges : [];
          const parsedConditionals = Array.isArray(parseResult.output.conditionals) ? parseResult.output.conditionals : [];
          const parsedNarrative = String(parseResult.output?.narrative || parseResult.narrative || "").trim();
          if (parsedClaims.length === 0) { sendResponse({ success: false, error: "Parsed 0 claims from mapping text" }); return; }

          console.log(`[Regenerate] Parsed ${parsedClaims.length} claims, ${parsedEdges.length} edges from provider ${providerId}`);

          // ── B. Load immutable data (shared per turn) ──
          const mappingFromTurn = coerceJson(turnRaw.mapping);
          const turnArtifact = mappingFromTurn?.artifact || mappingFromTurn || null;

          // Shadow: reconstruct from batch responses if needed
          let shadowStatements = turnArtifact?.shadow?.statements;
          let shadowParagraphs = turnArtifact?.shadow?.paragraphs;
          const citationOrderArr = readCitationOrderFromMeta(mappingResp?.meta);

          if (!Array.isArray(shadowStatements) || shadowStatements.length === 0) {
            try {
              const batchResps = responsesForTurn
                .filter((r) => r && r.responseType === "batch" && r.providerId && String(r.text || "").trim())
                .sort((a, b) => (a.responseIndex ?? 0) - (b.responseIndex ?? 0));
              const sources = batchResps.map((r, idx) => {
                const pid = normalizeProvId(r.providerId);
                const fromCitation = citationOrderArr.length > 0 ? citationOrderArr.indexOf(pid) : -1;
                const fromMeta = Number(r?.meta?.modelIndex);
                const modelIndex = fromCitation >= 0 ? fromCitation + 1 : (Number.isFinite(fromMeta) && fromMeta > 0 ? fromMeta : idx + 1);
                return { modelIndex, content: String(r.text || "") };
              });
              if (sources.length > 0) {
                const { extractShadowStatements, projectParagraphs } = await import('./shadow');
                const shadowResult = extractShadowStatements(sources);
                const paragraphResult = projectParagraphs(shadowResult.statements);
                shadowStatements = shadowResult.statements;
                shadowParagraphs = paragraphResult.paragraphs;
              }
            } catch (err) {
              console.error(`[Regenerate] Shadow reconstruction failed for aiTurnId=${aiTurnId}:`, err);
              sendResponse({ success: false, error: "Shadow reconstruction failed" });
              return;
            }
          }

          if (!Array.isArray(shadowStatements) || shadowStatements.length === 0) {
            sendResponse({ success: false, error: "No shadow statements available" }); return;
          }
          if (!Array.isArray(shadowParagraphs) || shadowParagraphs.length === 0) {
            const { projectParagraphs } = await import('./shadow');
            shadowParagraphs = projectParagraphs(shadowStatements).paragraphs;
          }

          // Model count from batch responses
          const batchResps = responsesForTurn.filter((r) => r && r.responseType === "batch");
          const modelCount = Math.max(citationOrderArr.length, batchResps.length, 1);

          // ── C. Geometry embeddings (immutable, generate if missing) ──
          let geoRecord = await sm.loadEmbeddings(aiTurnId);

          if (!geoRecord?.statementEmbeddings || !geoRecord?.paragraphEmbeddings || (geoRecord.meta?.paragraphCount === 0 && shadowParagraphs.length > 0)) {
            // Force re-generation if missing or empty despite having paragraphs
            const stmtResult = await generateStatementEmbeddings(shadowStatements, DEFAULT_CONFIG);
            const paraResult = await generateEmbeddings(shadowParagraphs, shadowStatements, DEFAULT_CONFIG);
            let queryEmbedding = null;
            if (queryText) {
              const cleaned = stripInlineMarkdown(String(queryText)).trim();
              const truncated = structuredTruncate(cleaned, 1740);
              const prefixed = truncated && !truncated.toLowerCase().startsWith('represent this sentence')
                ? `Represent this sentence for searching relevant passages: ${truncated}` : truncated;
              if (prefixed) {
                const batch = await generateTextEmbeddings([prefixed], DEFAULT_CONFIG);
                queryEmbedding = batch.get('0') || null;
              }
            }

            const packedStatements = packEmbeddingMap(stmtResult.embeddings, dims);
            const packedParagraphs = packEmbeddingMap(paraResult.embeddings, dims);
            const queryBuffer = queryEmbedding
              ? queryEmbedding.buffer.slice(queryEmbedding.byteOffset, queryEmbedding.byteOffset + queryEmbedding.byteLength)
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
                timestamp: Date.now(),
              },
            });
            geoRecord = await sm.loadEmbeddings(aiTurnId);
          }

          if (!geoRecord?.statementEmbeddings || !geoRecord?.paragraphEmbeddings) {
            sendResponse({ success: false, error: "Geometry embeddings unavailable" }); return;
          }

          const statementEmbeddings = unpackEmbeddingMap(geoRecord.statementEmbeddings, geoRecord.meta.statementIndex, geoRecord.meta.dimensions);
          const paragraphEmbeddings = unpackEmbeddingMap(geoRecord.paragraphEmbeddings, geoRecord.meta.paragraphIndex, geoRecord.meta.dimensions);
          const queryEmbedding =
            geoRecord?.queryEmbedding && geoRecord.queryEmbedding.byteLength > 0
              ? new Float32Array(geoRecord.queryEmbedding)
              : null;

          const substrate = buildGeometricSubstrate(
            shadowParagraphs,
            paragraphEmbeddings,
            geoRecord?.meta?.embeddingBackend === 'webgpu' ? 'webgpu' : 'wasm',
          );

          const queryBoost = queryEmbedding
            ? computePerModelQueryRelevance(queryEmbedding, statementEmbeddings, shadowParagraphs)
            : null;
          const preSemantic = buildPreSemanticInterpretation(substrate, shadowParagraphs, paragraphEmbeddings, queryBoost);
          const regions = preSemantic?.regionization?.regions || [];

          try {
            enrichStatementsWithGeometry(shadowStatements, shadowParagraphs, substrate, regions);
          } catch (_) { }

          let queryRelevance = null;
          try {
            if (queryEmbedding) {
              queryRelevance = computeQueryRelevance({
                queryEmbedding,
                statements: shadowStatements,
                statementEmbeddings,
                paragraphEmbeddings,
                paragraphs: shadowParagraphs,
                substrate,
                regionization: preSemantic?.regionization || null,
                regionProfiles: preSemantic?.regionProfiles || null,
              });
            }
          } catch (_) { }

          // ── D. Claim embeddings (per-provider, from parsed claims) ──
          const mapperClaimsForProvenance = parsedClaims.map((c) => ({
            id: c.id, label: c.label, text: c.text,
            supporters: Array.isArray(c.supporters) ? c.supporters : [],
            challenges: c?.challenges || null,
          }));

          const hashString = (input) => {
            let h = 5381;
            for (let i = 0; i < input.length; i++) {
              h = ((h << 5) + h) ^ input.charCodeAt(i);
            }
            return (h >>> 0).toString(16);
          };
          const claimsHash = hashString(
            parsedClaims
              .map((c) => `${String(c?.id || '')}\u001f${String(c?.label || '')}\u001f${String(c?.text || '')}`)
              .join('\u001e')
          );

          const claimEmbeddings = await generateClaimEmbeddings(mapperClaimsForProvenance);
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

          console.log(`[Regenerate] Embeddings ready: ${statementEmbeddings.size} stmts, ${paragraphEmbeddings.size} paras, ${claimEmbeddings?.size || 0} claims`);

          // ── E. Deterministic pipeline (all math, no LLM) ──



          // 1. Reconstruct provenance (cosine math: claims × statements/paragraphs)
          const enrichedClaims = await reconstructProvenance(
            mapperClaimsForProvenance,
            shadowStatements,
            shadowParagraphs,
            paragraphEmbeddings,
            regions,
            modelCount,
            statementEmbeddings,
            claimEmbeddings,
          );

          // 2. Claim provenance (ownership/exclusivity/overlap)
          let claimProvenance = null;
          let claimProvenanceExclusivity = null;
          let claimProvenanceOverlap = null;
          try {
            const ownership = computeStatementOwnership(enrichedClaims);
            claimProvenanceExclusivity = computeClaimExclusivity(enrichedClaims, ownership);
            claimProvenanceOverlap = computeClaimOverlap(enrichedClaims);
            let elbowDiagnostics = null;
            try {
              elbowDiagnostics = computeElbowDiagnosticsFromEmbeddings(
                claimEmbeddings, paragraphEmbeddings,
                mapperClaimsForProvenance.map((c) => ({ id: c.id })),
              );
            } catch (_) { }
            claimProvenance = {
              statementOwnership: Object.fromEntries(Array.from(ownership.entries()).map(([k, v]) => [k, Array.from(v)])),
              claimExclusivity: Object.fromEntries(claimProvenanceExclusivity),
              claimOverlap: claimProvenanceOverlap,
              ...(elbowDiagnostics ? { elbowDiagnostics } : {}),
            };
          } catch (err) {
            console.warn('[Regenerate] Claim provenance failed:', getErrorMessage(err));
          }

          // 3. Structural analysis
          let cachedStructuralAnalysis = null;
          try {
            const { computeStructuralAnalysis } = await import('./core/PromptMethods');
            const tempCognitive = buildCognitiveArtifact({
              claims: enrichedClaims, edges: parsedEdges,
              conditionals: parsedConditionals, narrative: '', ghosts: null,
            }, null);
            cachedStructuralAnalysis = computeStructuralAnalysis(tempCognitive);
          } catch (err) {
            console.warn('[Regenerate] Structural analysis failed:', getErrorMessage(err));
          }

          // 4. Blast radius filter
          let blastRadiusResult = null;
          try {
            if (cachedStructuralAnalysis && claimProvenanceExclusivity && claimProvenanceOverlap) {
              const { computeBlastRadiusFilter } = await import('./core/blast-radius/blastRadiusFilter');
              const qrMap = queryRelevance?.statementScores && typeof queryRelevance.statementScores.get === 'function'
                ? queryRelevance.statementScores
                : null;
              blastRadiusResult = computeBlastRadiusFilter({
                claims: cachedStructuralAnalysis.claimsWithLeverage,
                edges: parsedEdges,
                cascadeRisks: cachedStructuralAnalysis.patterns.cascadeRisks,
                exclusivity: claimProvenanceExclusivity,
                overlap: claimProvenanceOverlap,
                articulationPoints: cachedStructuralAnalysis.graph?.articulationPoints || [],
                queryRelevanceScores: qrMap,
                modelCount,
                convergenceRatio: cachedStructuralAnalysis.landscape.convergenceRatio,
              });
            }
          } catch (err) {
            console.warn('[Regenerate] Blast radius failed:', getErrorMessage(err));
          }

          const blastRadiusActive = blastRadiusResult && !blastRadiusResult.skipSurvey;

          // 5. Shadow delta
          let shadowDelta = null;
          let topUnindexed = [];
          try {
            const referencedIds = new Set(enrichedClaims.flatMap((c) => Array.isArray(c.sourceStatementIds) ? c.sourceStatementIds : []));
            shadowDelta = computeShadowDelta({ statements: shadowStatements }, referencedIds, queryText);
            topUnindexed = getTopUnreferenced(shadowDelta, 10);
          } catch (_) { }

          // 6. Traversal assembly (mechanical — same as StepExecutor)
          const foundationClaimIds = enrichedClaims.map((c) => c.id);
          const tiers = [{ tierIndex: 0, claimIds: foundationClaimIds, gates: [] }];
          const tierByClaimId = new Map();
          for (const t of tiers) { for (const id of t.claimIds) { if (!tierByClaimId.has(id)) tierByClaimId.set(id, t.tierIndex); } }

          const serializedClaims = enrichedClaims.map((c) => {
            const supporters = Array.isArray(c.supporters) ? c.supporters : [];
            const sourceStatementIds = Array.isArray(c.sourceStatementIds) ? c.sourceStatementIds.map(String).filter(Boolean) : [];
            return {
              id: String(c.id || ''), label: String(c.label || c.id),
              stance: 'NEUTRAL', gates: { conditionals: [] },
              enables: [], conflicts: [],
              sourceStatementIds, supporterModels: supporters,
              supportRatio: typeof c.supportRatio === 'number' ? c.supportRatio : 0,
              hasConditionalSignal: Boolean(c.hasConditionalSignal),
              hasSequenceSignal: Boolean(c.hasSequenceSignal),
              hasTensionSignal: Boolean(c.hasTensionSignal),
              tier: tierByClaimId.get(c.id) ?? 0,
            };
          });

          const traversalEdges = blastRadiusActive ? [] : parsedEdges
            .filter((e) => e && e.from && e.to && String(e.type || '').trim() === 'conflicts')
            .map((e) => ({ ...e, type: 'conflicts' }));

          const traversalGraph = {
            claims: serializedClaims, edges: traversalEdges,
            conditionals: parsedConditionals, tiers,
            maxTier: tiers.length - 1, roots: [], tensions: [], cycles: [],
          };

          let forcingPoints = [];
          try {
            forcingPoints = extractForcingPoints(traversalGraph).map((fp) => ({
              id: String(fp?.id || ''), type: fp?.type, tier: typeof fp?.tier === 'number' ? fp.tier : 0,
              question: String(fp?.question || ''), condition: String(fp?.condition || ''),
              ...(Array.isArray(fp?.options) ? { options: fp.options.map((o) => ({ claimId: String(o?.claimId || ''), label: String(o?.label || '') })).filter((o) => o.claimId && o.label) } : {}),
              unlocks: [], prunes: [],
              blockedBy: Array.isArray(fp?.blockedByGateIds) ? fp.blockedByGateIds.map(String).filter(Boolean) : [],
              sourceStatementIds: Array.isArray(fp?.sourceStatementIds) ? fp.sourceStatementIds.map(String).filter(Boolean) : [],
            }));
          } catch (_) { }

          // 7. Completeness
          let completeness = null;
          try {
            if (substrate && regions.length > 0) {
              const { buildStatementFates } = await import('./geometry/interpretation/fateTracking');
              const { findUnattendedRegions } = await import('./geometry/interpretation/coverageAudit');
              const { buildCompletenessReport } = await import('./geometry/interpretation/completenessReport');
              const qrMap = queryRelevance?.statementScores && typeof queryRelevance.statementScores.get === 'function'
                ? queryRelevance.statementScores
                : null;
              const statementFates = buildStatementFates(shadowStatements, enrichedClaims, qrMap);
              const unattendedRegions = findUnattendedRegions(substrate, shadowParagraphs, enrichedClaims, regions, shadowStatements);
              const completenessReport = buildCompletenessReport(statementFates, unattendedRegions, shadowStatements, regions.length);
              completeness = { report: completenessReport, statementFates: Object.fromEntries(statementFates), unattendedRegions };
            }
          } catch (_) { }

          // 8. Semantic edges (normalize types)
          const EDGE_SUPPORTS = 'supports';
          const EDGE_CONFLICTS = 'conflicts';
          const EDGE_PREREQUISITE = 'prerequisite';
          const semanticEdges = parsedEdges
            .filter((e) => e && e.from && e.to)
            .map((e) => {
              const t = String(e.type || '').trim();
              if (t === 'conflicts') return { ...e, type: EDGE_CONFLICTS };
              if (t === 'prerequisites') return { ...e, type: EDGE_PREREQUISITE };
              return e;
            })
            .filter((e) => [EDGE_SUPPORTS, EDGE_CONFLICTS, 'tradeoff', EDGE_PREREQUISITE].includes(String(e.type || '').trim()));

          // ── D.2 Basin inversion (deterministic based on embeddings) ──
          let basinInversion = undefined;
          try {
            const paraIds = geoRecord.meta?.paragraphIndex || [];
            const paraVectors = [];
            if (geoRecord.paragraphEmbeddings && paraIds.length > 0) {
              const view = new Float32Array(geoRecord.paragraphEmbeddings);
              for (let i = 0; i < paraIds.length; i++) {
                paraVectors.push(view.subarray(i * dims, (i + 1) * dims));
              }
              basinInversion = computeBasinInversion(paraIds, paraVectors);
            }
          } catch (err) {
            console.warn('[Regenerate] Basin inversion failed:', err);
          }

          // ── F. Assemble mapper artifact (same shape as StepExecutor) ──
          const mapperArtifact = {
            id: `artifact-regen-${Date.now()}`,
            query: queryText,
            timestamp: new Date().toISOString(),
            model_count: modelCount,
            claims: enrichedClaims,
            edges: semanticEdges,
            ghosts: null,
            narrative: parsedNarrative,
            conditionals: parsedConditionals,
            traversalGraph,
            forcingPoints,
            traversalAnalysis: null,
            ...(blastRadiusResult ? { blastRadiusFilter: blastRadiusResult } : {}),
            surveyRationale: null,
            preSemantic: preSemantic || null,
            ...(completeness ? { completeness } : {}),
            shadow: {
              statements: shadowStatements,
              audit: shadowDelta?.audit ?? {},
              topUnreferenced: Array.isArray(topUnindexed) ? topUnindexed.map((u) => u?.statement).filter(Boolean) : [],
            },
            ...(claimProvenance ? { claimProvenance } : {}),
            ...(basinInversion ? { basinInversion } : {}),
          };

          // ── G. Build full cognitive artifact ──
          const coords = substrate?.layout2d?.coordinates || {};
          const regionsByNode = new Map();
          for (const r of regions) {
            for (const nodeId of r?.nodeIds || []) {
              if (nodeId && !regionsByNode.has(nodeId)) regionsByNode.set(nodeId, r.id);
            }
          }
          const componentsByNode = new Map();
          for (const c of substrate?.topology?.components || []) {
            for (const nodeId of c?.nodeIds || []) {
              if (nodeId && !componentsByNode.has(nodeId)) componentsByNode.set(nodeId, c.id);
            }
          }
          const substrateGraph = {
            nodes: (substrate?.nodes || []).map((n) => {
              const p = n.paragraphId;
              const xy = coords[p] || [0, 0];
              return {
                ...n,
                x: xy[0],
                y: xy[1],
                regionId: regionsByNode.get(p) ?? null,
                componentId: componentsByNode.get(p) ?? null,
              };
            }),
            edges: (substrate?.graphs?.knn?.edges || []).map((e) => ({ source: e.source, target: e.target, similarity: e.similarity })),
            mutualEdges: (substrate?.graphs?.mutual?.edges || []).map((e) => ({ source: e.source, target: e.target, similarity: e.similarity })),
            strongEdges: (substrate?.graphs?.strong?.edges || []).map((e) => ({ source: e.source, target: e.target, similarity: e.similarity })),
            softThreshold: substrate?.graphs?.strong?.softThreshold ?? 0,
            similarityStats: substrate?.meta?.similarityStats,
            ...(substrate?.meta?.extendedSimilarityStats ? { extendedSimilarityStats: substrate.meta.extendedSimilarityStats } : {}),
            ...(Array.isArray(substrate?.meta?.allPairwiseSimilarities)
              ? { allPairwiseSimilarities: substrate.meta.allPairwiseSimilarities.slice(0, 20000) }
              : {}),
          };

          const cognitiveArtifact = buildCognitiveArtifact(mapperArtifact, {
            shadow: { extraction: { statements: shadowStatements }, delta: shadowDelta || null },
            paragraphProjection: { paragraphs: shadowParagraphs },
            substrate: { graph: substrateGraph, shape: null },
            preSemantic: preSemantic || null,
            ...(queryRelevance ? { query: { relevance: queryRelevance } } : {}),
          });

          // ── H. Persist as provider-specific artifact ──
          const mergeArtifacts = (base, patch) => {
            if (!patch || typeof patch !== "object") return base;
            if (!base || typeof base !== "object") return patch;
            if (Array.isArray(base) || Array.isArray(patch)) {
              if (Array.isArray(patch) && patch.length > 0) return patch;
              return base;
            }
            const out = { ...base };
            for (const [k, v] of Object.entries(patch)) {
              if (v === undefined || v === null) continue;
              const prev = out[k];
              if (prev && typeof prev === "object" && !Array.isArray(prev) && typeof v === "object" && !Array.isArray(v)) {
                out[k] = mergeArtifacts(prev, v);
              } else if (Array.isArray(v)) {
                out[k] = v.length > 0 ? v : prev;
              } else {
                out[k] = v;
              }
            }
            return out;
          };

          let artifactPatched = false;
          let artifactForUi = cognitiveArtifact || null;
          if (shouldPersistArtifact && cognitiveArtifact && mappingResp?.id) {
            const existingArtifact =
              mappingResp?.artifact && typeof mappingResp.artifact === "object" ? mappingResp.artifact : null;
            const mergedArtifact = mergeArtifacts(existingArtifact, cognitiveArtifact);
            artifactForUi = mergedArtifact;

            const { dehydrateArtifact } = await import('./persistence/artifact-hydration');
            const dehydrated = dehydrateArtifact(mergedArtifact);

            const updated = { ...mappingResp, artifact: dehydrated, updatedAt: Date.now() };
            await sm.adapter.put("provider_responses", updated, mappingResp.id);
            artifactPatched = true;
            console.log(`[Regenerate] Full artifact persisted for provider ${providerId}: ${enrichedClaims.length} claims, ${semanticEdges.length} edges`);
          }

          sendResponse({ success: true, data: { artifactPatched, artifact: artifactForUi, claimCount: enrichedClaims.length, edgeCount: semanticEdges.length } });
        })().catch(e => { console.error('[Regenerate] Failed:', e); sendResponse({ success: false, error: getErrorMessage(e) }); });
        return true;

      case "DERIVE_ELBOW_DIAGNOSTICS":
        (async () => {
          const { aiTurnId, providerId } = message.payload || {};
          if (!aiTurnId || !providerId) {
            sendResponse({ success: true, data: null });
            return;
          }
          // Load geometry embeddings (turn-level) + claim embeddings (provider-level)
          const [geoRecord, claimRecord] = await Promise.all([
            sm.loadEmbeddings(aiTurnId),
            sm.loadClaimEmbeddings(aiTurnId, providerId),
          ]);
          if (!geoRecord?.paragraphEmbeddings || !geoRecord?.meta?.paragraphIndex) {
            sendResponse({ success: true, data: null });
            return;
          }
          if (!claimRecord?.claimEmbeddings || !claimRecord?.meta?.claimIndex) {
            sendResponse({ success: true, data: null });
            return;
          }
          const { unpackEmbeddingMap } = await import('./persistence/embeddingCodec');
          const { computeElbowDiagnosticsFromEmbeddings } = await import('./ConciergeService/claimAssembly');
          const geoMeta = geoRecord.meta;
          const claimMeta = claimRecord.meta;
          // Pure math — all embeddings from cache, zero ONNX calls
          const paragraphEmbeddings = unpackEmbeddingMap(geoRecord.paragraphEmbeddings, geoMeta.paragraphIndex, geoMeta.dimensions);
          const claimEmbeddings = unpackEmbeddingMap(claimRecord.claimEmbeddings, claimMeta.claimIndex, claimMeta.dimensions);
          const claims = claimMeta.claimIndex.map(id => ({ id }));
          const diagnostics = computeElbowDiagnosticsFromEmbeddings(claimEmbeddings, paragraphEmbeddings, claims);
          sendResponse({ success: true, data: diagnostics });
        })().catch(e => sendResponse({ success: false, error: getErrorMessage(e) }));
        return true;

      case "DEHYDRATE_ALL_STORED_ARTIFACTS":
        (async () => {
          const { dehydrateArtifact } = await import('./persistence/artifact-hydration');

          const summarizeBytes = (value) => {
            try {
              return new Blob([JSON.stringify(value)]).size;
            } catch {
              return 0;
            }
          };

          const adapter = sm?.adapter;
          if (!adapter) {
            sendResponse({ success: false, error: "Persistence adapter not available" });
            return;
          }

          const providerResponses = await adapter.getAll("provider_responses");
          let scannedProviderResponses = 0;
          let updatedProviderResponses = 0;
          let providerRespBytesBefore = 0;
          let providerRespBytesAfter = 0;

          for (const r of providerResponses || []) {
            scannedProviderResponses += 1;
            if (!r || typeof r !== "object") continue;
            if (!r.id) continue;
            const artifact = r.artifact;
            if (!artifact || typeof artifact !== "object") continue;
            providerRespBytesBefore += summarizeBytes(artifact);
            const dehydrated = dehydrateArtifact(artifact);
            providerRespBytesAfter += summarizeBytes(dehydrated);
            const beforeStr = JSON.stringify(artifact);
            const afterStr = JSON.stringify(dehydrated);
            if (beforeStr === afterStr) continue;
            await adapter.put("provider_responses", { ...r, artifact: dehydrated, updatedAt: Date.now() }, r.id);
            updatedProviderResponses += 1;
          }

          const turns = await adapter.getAll("turns");
          let scannedTurns = 0;
          let updatedTurns = 0;
          let turnBytesBefore = 0;
          let turnBytesAfter = 0;

          for (const t of turns || []) {
            scannedTurns += 1;
            if (!t || typeof t !== "object") continue;
            if (!t.id) continue;
            const mapping = t.mapping;
            if (!mapping || typeof mapping !== "object") continue;

            const mappingArtifact = mapping?.artifact;
            if (!mappingArtifact || typeof mappingArtifact !== "object") continue;

            turnBytesBefore += summarizeBytes(mappingArtifact);
            const dehydrated = dehydrateArtifact(mappingArtifact);
            turnBytesAfter += summarizeBytes(dehydrated);

            const beforeStr = JSON.stringify(mappingArtifact);
            const afterStr = JSON.stringify(dehydrated);
            if (beforeStr === afterStr) continue;

            const nextMapping = { ...mapping, artifact: dehydrated };
            await adapter.put("turns", { ...t, mapping: nextMapping, updatedAt: Date.now() }, t.id);
            updatedTurns += 1;
          }

          sendResponse({
            success: true,
            data: {
              providerResponses: {
                scanned: scannedProviderResponses,
                updated: updatedProviderResponses,
                approxBytesBefore: providerRespBytesBefore,
                approxBytesAfter: providerRespBytesAfter,
              },
              turns: {
                scanned: scannedTurns,
                updated: updatedTurns,
                approxBytesBefore: turnBytesBefore,
                approxBytesAfter: turnBytesAfter,
              },
            }
          });
        })().catch(e => sendResponse({ success: false, error: getErrorMessage(e) }));
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
                ...(r.artifact ? { artifact: r.artifact } : {}),
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
              ...(primaryAi?.mapping ? { mapping: primaryAi.mapping } : {}),
              ...(primaryAi?.singularity ? { singularity: primaryAi.singularity } : {}),
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

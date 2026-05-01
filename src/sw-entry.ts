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
} from './system/net-rules-manager.js';
import { BusController } from './system/bus-controller.js';
import { LifecycleManager } from './system/lifecycle-manager.js';
import { WorkflowCompiler } from './execution/workflow-compiler.js';
import { ContextResolver } from './execution/io/context-resolver.js';

import { ClaudeAdapter } from './providers/claude-adapter.js';
import { GeminiAdapter } from './providers/gemini-adapter.js';
import { ChatGPTAdapter } from './providers/chatgpt-adapter.js';
import { QwenAdapter } from './providers/qwen-adapter.js';
import { GrokAdapter } from './providers/grok-adapter.js';
import { ClaudeProviderController } from './providers/claude.js';
import { GeminiProviderController } from './providers/gemini.js';
import { ChatGPTProviderController } from './providers/chatgpt.js';
import { QwenProviderController } from './providers/qwen.js';
import { GrokProviderController } from './providers/grok.js';
import { DNRUtils } from './system/dnr-utils.js';
import { ConnectionHandler } from './system/connection-handler.js';
import { authManager } from './providers/auth-manager.js';

// Persistence Layer Imports
import { SessionManager } from './persistence/session-manager.js';
import { initializePersistenceLayer } from './persistence/index.js';
import { errorHandler, getErrorMessage } from './errors/handler.js';
import { logInfraError } from './errors/infra-logger.js';
import { persistenceMonitor } from './persistence/persistence-monitor.js';
import { unpackEmbeddingMap, packEmbeddingMap } from './persistence/embedding-codec.js';
import {
  generateTextEmbeddings,
  structuredTruncate,
  generateStatementEmbeddings,
  generateEmbeddings,
  stripInlineMarkdown,
} from './clustering/index.js';
import { getConfigForModel } from './clustering/config.js';
import { searchCorpus } from './clustering/corpus-search.js';
import { canonicalCitationOrder, buildCitationSourceOrder } from '../shared/provider-config.js';
import { extractShadowStatements, projectParagraphs } from './shadow/index.js';
import { buildArtifactForProvider } from './execution/deterministic-pipeline.js';
import { buildSourceContinuityMap } from './provenance/surface.js';
import { parseEditorialOutput, buildPassageIndex, buildEditorialPrompt } from './concierge-service/editorial-mapper.js';


// Global Services Registry
import { ServiceRegistry } from './system/service-registry.js';

// Shared types
import type { EnrichedClaim, MapperClaim, ClaimDensityResult, PassageRoutingResult, StatementClassificationResult } from '../shared/types/contract';
import type { AiTurn } from '../shared/types/turns';

// ============================================================================
// LOCAL INTERFACES
// ============================================================================

interface IServiceRegistry {
  get(name: string): unknown;
  register(name: string, instance: unknown): void;
  unregister(name: string): boolean;
  services: Map<string, unknown>;
}

interface ProviderConfig {
  name: string;
  Controller: new () => { init?: () => Promise<void> };
  Adapter: new (controller: unknown) => { init?: () => Promise<void> };
}

interface GlobalServices {
  orchestrator: FaultTolerantOrchestrator;
  sessionManager: SessionManager;
  compiler: InstanceType<typeof WorkflowCompiler>;
  contextResolver: InstanceType<typeof ContextResolver>;
  persistenceLayer: unknown;
  authManager: typeof authManager;
  providerRegistry: ProviderRegistry;
}

type RegenerateResult =
  | { success: true; data: { artifact: Record<string, unknown>; claimCount: number; edgeCount: number } }
  | { success: false; error: string };

interface BuildArtifactResult {
  cognitiveArtifact: Record<string, unknown> & { editorialAST?: unknown };
  mapperArtifact: Record<string, unknown>;
  enrichedClaims: EnrichedClaim[];
  parsedClaims: MapperClaim[];
  claimEmbeddings: Map<string, Float32Array> | null;
}

declare global {
  interface Window {
    HTOS_DEBUG: {
      verifyProvider: (providerId: unknown) => Promise<unknown>;
      verifyAll: () => Promise<unknown>;
      getAuthStatus: (forceRefresh?: boolean) => Promise<unknown>;
      executeSingle: (providerId: unknown, prompt: unknown, options?: { timeout?: number }) => Promise<unknown>;
      getProviderAdapter: (providerId: unknown) => Promise<unknown>;
    };
  }
  var HTOS_DEBUG: Window['HTOS_DEBUG'];
}

const services = ServiceRegistry.getInstance() as unknown as IServiceRegistry;

// ============================================================================
// FEATURE FLAGS (Source of Truth)
// ============================================================================
// HTOS_PERSISTENCE_ENABLED removed as it was unused

// Ensure fetch is correctly bound
try {
  if (typeof fetch === 'function' && typeof globalThis !== 'undefined') {
    globalThis.fetch = fetch.bind(globalThis);
  }
} catch (e) { logInfraError('SW: fetch.bind failed', e); }

// Initialize BusController globally (needed for message bus)
(self as unknown as Record<string, unknown>)['BusController'] = BusController;

globalThis.HTOS_DEBUG = {
  verifyProvider: async (providerId) => authManager.verifyProvider(String(providerId || '')),
  verifyAll: async () => authManager.verifyAll(),
  getAuthStatus: async (forceRefresh = false) => authManager.getAuthStatus(Boolean(forceRefresh)),
  executeSingle: async (providerId, prompt, options = {}) => {
    const svcs = await initializeGlobalServices();
    const pid = String(providerId || '').toLowerCase();
    const p = String(prompt || '');
    const timeout = Number.isFinite(options?.timeout) ? options.timeout! : 60000;
    return svcs.orchestrator.executeSingle(p, pid, { timeout });
  },
  getProviderAdapter: async (providerId) => {
    const svcs = await initializeGlobalServices();
    return svcs.providerRegistry?.getAdapter?.(String(providerId || '').toLowerCase()) ?? null;
  },
};

// Debounce map for cookie changes
const cookieChangeDebounce = new Map<string, ReturnType<typeof setTimeout>>();

// Top-level registration - ensures listener is always registered when SW loads
chrome.cookies.onChanged.addListener((changeInfo) => {
  const key = `${changeInfo.cookie.domain}:${changeInfo.cookie.name}`;

  if (cookieChangeDebounce.has(key)) {
    clearTimeout(cookieChangeDebounce.get(key)!);
  }

  const timeoutId = setTimeout(() => {
    cookieChangeDebounce.delete(key);

    authManager
      .initialize()
      .then(() => authManager.handleCookieChange(changeInfo))
      .catch((err) => {
        logInfraError('SW: Cookie change handler failed', err);
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

chrome.runtime.onStartup.addListener(() => {
  handleStartup('startup').catch((err) =>
    logInfraError('onStartup: handleStartup failed', err)
  );
});

chrome.runtime.onInstalled.addListener((details) => {
  handleStartup(`installed: ${details.reason}`).catch((err) =>
    logInfraError('onInstalled: handleStartup failed', err)
  );
});

// ============================================================================
// CORE SERVICE INITIALIZATION
// ============================================================================

async function initializePersistence(): Promise<unknown> {
  // Check registry first
  if (services.get('persistenceLayer')) {
    return services.get('persistenceLayer');
  }

  const operationId = persistenceMonitor.startOperation('INITIALIZE_PERSISTENCE', {
    useAdapter: true,
  });

  try {
    const pl = await initializePersistenceLayer();
    services.register('persistenceLayer', pl);

    // Legacy global for debug only
    (self as unknown as Record<string, unknown>)['__HTOS_PERSISTENCE_LAYER'] = pl;

    persistenceMonitor.recordConnection('HTOSPersistenceDB', 1, [
      'sessions',
      'threads',
      'turns',
      'provider_responses',
      'provider_contexts',
      'metadata',
    ]);
    console.log('[SW] ✅ Persistence layer initialized');
    persistenceMonitor.endOperation(operationId, { success: true });
    return pl;
  } catch (error) {
    persistenceMonitor.endOperation(operationId, null, error);
    const handledError = await errorHandler.handleError(error, {
      operation: 'initializePersistence',
      context: { useAdapter: true },
    });
    logInfraError('SW: Failed to initialize persistence', handledError);
    throw handledError;
  }
}

async function initializeSessionManager(pl: unknown): Promise<SessionManager> {
  // Check registry first
  const existing = services.get('sessionManager') as SessionManager | undefined;
  if (existing?.adapter?.isReady()) {
    return existing;
  }

  const persistence = (pl ?? services.get('persistenceLayer')) as { adapter?: unknown } | null;
  try {
    console.log('[SW] Creating new SessionManager');
    const sm = new SessionManager();

    await sm.initialize({ adapter: persistence?.adapter as import('./persistence/simple-indexeddb-adapter.js').SimpleIndexedDBAdapter | null | undefined });
    services.register('sessionManager', sm);
    console.log('[SW] ✅ SessionManager initialized');
    return sm;
  } catch (error) {
    logInfraError('SW: Failed to initialize SessionManager', error);
    throw error;
  }
}

// ============================================================================
// PROVIDER ADAPTER REGISTRY
// ============================================================================
class ProviderRegistry {
  private adapters = new Map<string, unknown>();
  private controllers = new Map<string, unknown>();

  register(providerId: string, controller: unknown, adapter: unknown): void {
    this.controllers.set(providerId, controller);
    this.adapters.set(providerId, adapter);
  }

  getAdapter(providerId: string): unknown {
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
  console.log('[SW] Initializing providers...');

  if (services.get('providerRegistry')) {
    return (services.get('providerRegistry') as ProviderRegistry).listProviders();
  }

  const providerRegistry = new ProviderRegistry();

  const providerConfigs: ProviderConfig[] = [
    { name: 'claude', Controller: ClaudeProviderController, Adapter: ClaudeAdapter },
    { name: 'gemini', Controller: GeminiProviderController, Adapter: GeminiAdapter },
    {
      name: 'gemini-pro',
      Controller: GeminiProviderController,
      Adapter: class extends GeminiAdapter {
        constructor(controller: unknown) {
          super(controller, 'gemini-pro');
        }
      },
    },
    {
      name: 'gemini-exp',
      Controller: GeminiProviderController,
      Adapter: class extends GeminiAdapter {
        constructor(controller: unknown) {
          super(controller, 'gemini-exp');
        }
      },
    },
    { name: 'chatgpt', Controller: ChatGPTProviderController, Adapter: ChatGPTAdapter },
    { name: 'qwen', Controller: QwenProviderController, Adapter: QwenAdapter },
    { name: 'grok', Controller: GrokProviderController, Adapter: GrokAdapter },
  ];

  const initialized: string[] = [];
  for (const config of providerConfigs) {
    try {
      const controller = new config.Controller();
      if (typeof controller.init === 'function') await controller.init();
      const adapter = new config.Adapter(controller);
      if (typeof adapter.init === 'function') await adapter.init();
      providerRegistry.register(config.name, controller, adapter);
      initialized.push(config.name);
    } catch (e) {
      logInfraError(`SW: Failed to initialize ${config.name}`, e);
    }
  }

  services.register('providerRegistry', providerRegistry);

  if (initialized.length > 0) {
    console.info(`[SW] ✅ Providers initialized: ${initialized.join(', ')}`);
  }
  return providerRegistry.listProviders();
}

// ============================================================================
// ORCHESTRATOR WRAPPER & INIT
// ============================================================================
interface ExecuteSingleOptions {
  timeout?: number;
  onPartial?: (providerId: string, chunk: unknown) => void;
  [key: string]: unknown;
}

interface ExecuteParallelFanoutOptions {
  sessionId?: string;
  onPartial?: (providerId: string, chunk: unknown) => void;
  onAllComplete?: (results: Map<string, unknown>, errors: Map<string, unknown>) => void | Promise<void>;
  onProviderComplete?: (providerId: string, outcome: { status: 'fulfilled' | 'rejected'; value?: unknown; reason?: unknown; providerResponse?: unknown }) => void;
  onError?: (err: unknown) => void;
  useThinking?: boolean;
  providerContexts?: Record<string, unknown>;
  providerMeta?: Record<string, unknown>;
}

class FaultTolerantOrchestrator {
  private activeRequests = new Map<string, { abortControllers: Map<string, AbortController> }>();
  private registry: IServiceRegistry;

  constructor(registry: IServiceRegistry) {
    this.registry = registry;
  }

  private get lifecycleManager(): InstanceType<typeof LifecycleManager> | undefined {
    return this.registry.get('lifecycleManager') as InstanceType<typeof LifecycleManager> | undefined;
  }

  async executeSingle(prompt: string, providerId: string, options: ExecuteSingleOptions = {}): Promise<unknown> {
    const { timeout = 60000 } = options;

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Request to ${providerId} timed out after ${timeout}ms`));
      }, timeout);

      this.executeParallelFanout(prompt, [providerId], {
        ...options,
        onPartial: options.onPartial ?? (() => { }),
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

  async _prefetchGeminiTokens(
    providerRegistry: ProviderRegistry | undefined,
    providers: string[],
    providerMeta: Record<string, Record<string, unknown>>
  ): Promise<void> {
    if (!providerRegistry) return;

    const GEMINI_VARIANT_IDS = ['gemini', 'gemini-pro', 'gemini-exp'];
    const targets = (providers || []).filter((pid) =>
      GEMINI_VARIANT_IDS.includes(String(pid).toLowerCase())
    );

    if (targets.length < 2) return;

    const concurrencyLimit = Math.min(2, targets.length);
    const queue = [...targets];

    const worker = async (): Promise<void> => {
      while (queue.length > 0) {
        const pid = queue.shift();
        if (!pid) return;

        try {
          const controller = providerRegistry.getController(pid) as { geminiSession?: { _fetchToken?: () => Promise<unknown> } } | null;
          if (!controller?.geminiSession?._fetchToken) continue;

          const jitterMs = 50 + Math.floor(Math.random() * 101);
          await new Promise<void>((resolve) => setTimeout(resolve, jitterMs));

          const token = await controller.geminiSession._fetchToken();
          if (!providerMeta[pid]) providerMeta[pid] = {};
          providerMeta[pid]._prefetchedToken = token;
        } catch (e) {
          console.warn(`[SW] Gemini token prefetch failed for ${pid}:`, e);
        }
      }
    };

    await Promise.all(Array.from({ length: concurrencyLimit }, () => worker()));
  }

  executeParallelFanout(prompt: string, providers: string[], options: ExecuteParallelFanoutOptions = {}): void {
    const {
      sessionId = `req-${Date.now()}`,
      onPartial = () => { },
      onAllComplete = () => { },
      useThinking = false,
      providerContexts = {},
      providerMeta = {},
    } = options;

    if (this.lifecycleManager) this.lifecycleManager.keepalive(true);

    const results = new Map<string, unknown>();
    const errors = new Map<string, unknown>();
    const abortControllers = new Map<string, AbortController>();
    this.activeRequests.set(sessionId, { abortControllers });

    const providerRegistry = this.registry.get('providerRegistry') as ProviderRegistry | undefined;

    this._prefetchGeminiTokens(
      providerRegistry,
      providers,
      providerMeta as Record<string, Record<string, unknown>>
    ).then(() => {
      const providerPromises = providers.map((providerId) => {
        return (async () => {
          const abortController = new AbortController();
          abortControllers.set(providerId, abortController);

          const adapter = providerRegistry?.getAdapter(providerId) as {
            ask?: (prompt: string, ctx: unknown, sessionId: string, onChunk: (chunk: unknown) => void, signal: AbortSignal) => Promise<{ text?: string; ok?: boolean; errorCode?: string; meta?: Record<string, unknown>;[key: string]: unknown }>;
            sendPrompt?: (req: unknown, onChunk: (chunk: unknown) => void, signal: AbortSignal) => Promise<{ text?: string; ok?: boolean;[key: string]: unknown }>;
            controller?: { geminiSession?: { sharedState?: Record<string, unknown> } };
          } | undefined;

          if (!adapter) {
            const err = new Error(`Provider ${providerId} not available`);
            try {
              if (options.onProviderComplete) {
                options.onProviderComplete(providerId, { status: 'rejected', reason: err });
              }
            } catch (cbErr) {
              console.warn('[SW] onProviderComplete threw (unavailable provider):', cbErr);
            }
            return { providerId, status: 'rejected' as const, reason: err };
          }

          let aggregatedText = '';

          const request = {
            originalPrompt: prompt,
            sessionId,
            meta: {
              ...((providerContexts[providerId] as { meta?: Record<string, unknown> })?.meta ?? {}),
              ...((providerMeta as Record<string, Record<string, unknown>>)[providerId] ?? {}),
              useThinking,
            },
          };

          try {
            const providerContext =
              (providerContexts[providerId] as { meta?: unknown })?.meta ??
              providerContexts[providerId] ??
              null;
            const onChunk = (chunk: unknown): void => {
              const textChunk = typeof chunk === 'string' ? chunk : (chunk as { text?: string }).text;
              if (textChunk) aggregatedText += textChunk;
              onPartial(providerId, typeof chunk === 'string' ? { text: chunk } : chunk);
            };

            // Inject token
            const pMeta = (providerMeta as Record<string, Record<string, unknown>>)[providerId];
            if (pMeta?._prefetchedToken && adapter.controller?.geminiSession) {
              adapter.controller.geminiSession.sharedState = {
                ...adapter.controller.geminiSession.sharedState,
                prefetchedToken: pMeta._prefetchedToken,
              };
            }

            let result: { text?: string; ok?: boolean; errorCode?: string; meta?: Record<string, unknown>;[key: string]: unknown };
            if (typeof adapter.ask === 'function') {
              result = await adapter.ask(
                request.originalPrompt,
                providerContext,
                sessionId,
                onChunk,
                abortController.signal
              );
            } else {
              result = await adapter.sendPrompt!(request, onChunk, abortController.signal);
            }

            if (!result.text && aggregatedText) result.text = aggregatedText;

            if (result && result.ok === false) {
              const message =
                (typeof result?.meta?.error === 'string' && result.meta.error) ||
                (typeof result?.meta?.details === 'string' && result.meta.details) ||
                (typeof result?.errorCode === 'string' && result.errorCode) ||
                'Provider request failed';

              const enrichedErr = new Error(message) as Error & {
                code?: string;
                status?: number;
                headers?: unknown;
                details?: unknown;
                providerResponse?: unknown;
              };
              enrichedErr.code = result?.errorCode ?? 'unknown';
              if (result?.meta && typeof result.meta === 'object') {
                if (result.meta.status) enrichedErr.status = result.meta.status as number;
                if (result.meta.headers) enrichedErr.headers = result.meta.headers;
                if (result.meta.details) enrichedErr.details = result.meta.details;
              }
              enrichedErr.providerResponse = result;
              try {
                if (options.onProviderComplete) {
                  options.onProviderComplete(providerId, {
                    status: 'rejected',
                    reason: enrichedErr,
                    providerResponse: result,
                  });
                }
              } catch (cbErr) {
                console.warn('[SW] onProviderComplete threw (error result):', cbErr);
              }
              return { providerId, status: 'rejected' as const, reason: enrichedErr };
            }

            // ✅ Granular completion signal
            try {
              if (options.onProviderComplete) {
                options.onProviderComplete(providerId, { status: 'fulfilled', value: result });
              }
            } catch (cbErr) {
              console.warn('[SW] onProviderComplete threw (fulfilled):', cbErr);
            }

            return { providerId, status: 'fulfilled' as const, value: result };
          } catch (error) {
            if (aggregatedText) {
              const name =
                error && typeof error === 'object' && 'name' in error ? String((error as { name: unknown }).name) : 'Error';
              const message =
                error && typeof error === 'object' && 'message' in error
                  ? String((error as { message: unknown }).message)
                  : String(error);
              const val = { text: aggregatedText, meta: {}, softError: { name, message } };
              try {
                if (options.onProviderComplete) {
                  options.onProviderComplete(providerId, { status: 'fulfilled', value: val });
                }
              } catch (cbErr) {
                console.warn('[SW] onProviderComplete threw (soft error):', cbErr);
              }
              return { providerId, status: 'fulfilled' as const, value: val };
            }
            try {
              if (options.onProviderComplete) {
                options.onProviderComplete(providerId, { status: 'rejected', reason: error });
              }
            } catch (cbErr) {
              console.warn('[SW] onProviderComplete threw (caught error):', cbErr);
            }
            return { providerId, status: 'rejected' as const, reason: error };
          }
        })();
      });

      Promise.all(providerPromises)
        .then(async (settledResults) => {
          settledResults.forEach((item) => {
            if (item.status === 'fulfilled') results.set(item.providerId, (item as { providerId: string; status: 'fulfilled'; value: unknown }).value);
            else errors.set(item.providerId, (item as { providerId: string; status: 'rejected'; reason: unknown }).reason);
          });
          await onAllComplete(results, errors);
          this.activeRequests.delete(sessionId);
          if (this.lifecycleManager) this.lifecycleManager.keepalive(false);
        })
        .catch((err) => {
          logInfraError('FaultTolerantOrchestrator: onAllComplete threw', err);
          this.activeRequests.delete(sessionId);
          if (this.lifecycleManager) this.lifecycleManager.keepalive(false);
          if (typeof options.onError === 'function') {
            try {
              options.onError(err);
            } catch (cbErr) {
              console.warn('[SW] onError callback threw:', cbErr);
            }
          }
        });
    });
  }

  _abortRequest(sessionId: string): void {
    const request = this.activeRequests.get(sessionId);
    if (request) {
      request.abortControllers.forEach((c) => c.abort());
      this.activeRequests.delete(sessionId);
      if (this.lifecycleManager) this.lifecycleManager.keepalive(false);
    }
  }
}

async function initializeOrchestrator(): Promise<FaultTolerantOrchestrator> {
  if (services.get('orchestrator')) return services.get('orchestrator') as FaultTolerantOrchestrator;

  try {
    const lm = new LifecycleManager();
    services.register('lifecycleManager', lm);

    // Legacy global
    (self as unknown as Record<string, unknown>)['lifecycleManager'] = lm;

    const orchestrator = new FaultTolerantOrchestrator(services);
    services.register('orchestrator', orchestrator);

    // Legacy global
    (self as unknown as Record<string, unknown>)['faultTolerantOrchestrator'] = orchestrator;

    console.log('[SW] ✓ FaultTolerantOrchestrator initialized');
    return orchestrator;
  } catch (e) {
    logInfraError('SW: Orchestrator init failed', e);
    throw e;
  }
}

// ============================================================================
// GLOBAL SERVICES (Unified Init)
// ============================================================================

let globalServicesPromise: Promise<GlobalServices> | null = null;

async function initializeGlobalServices(): Promise<GlobalServices> {
  // If already running or complete, return it.
  if (globalServicesPromise) return globalServicesPromise;

  const existingOrchestrator = services.get('orchestrator') as FaultTolerantOrchestrator | undefined;
  const existingSessionManager = services.get('sessionManager') as SessionManager | undefined;
  const existingCompiler = services.get('compiler');
  const existingContextResolver = services.get('contextResolver');
  const existingPersistenceLayer = services.get('persistenceLayer');
  const existingAuthManager = services.get('authManager');
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
      compiler: existingCompiler as InstanceType<typeof WorkflowCompiler>,
      contextResolver: existingContextResolver as InstanceType<typeof ContextResolver>,
      persistenceLayer: existingPersistenceLayer,
      authManager,
      providerRegistry: existingProviderRegistry,
    };
    globalServicesPromise = Promise.resolve(ready);
    return globalServicesPromise;
  }

  const keysBeforeInit = new Set(services.services.keys());

  globalServicesPromise = (async () => {
    try {
      console.log('[SW] 🚀 Initializing global services...');

      // Ensure auth manager is ready (idempotent)
      await authManager.initialize();
      if (!services.get('authManager')) services.register('authManager', authManager);

      await initializeGlobalInfrastructure();
      const pl = await initializePersistence();
      const sm = await initializeSessionManager(pl);
      await initializeProviders();
      await initializeOrchestrator();

      const compiler = (services.get('compiler') as InstanceType<typeof WorkflowCompiler> | undefined) ?? new WorkflowCompiler(sm);
      if (!services.get('compiler')) services.register('compiler', compiler);

      const contextResolver = (services.get('contextResolver') as InstanceType<typeof ContextResolver> | undefined) ?? new ContextResolver(sm as never);
      if (!services.get('contextResolver')) services.register('contextResolver', contextResolver);

      // MapperService deprecated; semantic mapper handles mapping now.
      // ResponseProcessor removed — previously registered here.

      console.log('[SW] ✅ Global services registry ready');

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
      logInfraError('SW: Global services initialization failed', error);
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
  console.log('[SW] Initializing global infrastructure...');

  const run = async (name: string, fn: () => Promise<void> | void) => {
    try {
      await fn();
    } catch (e) {
      logInfraError(`SW: Infra init failed — ${name}`, e);
    }
  };

  await run('NetRulesManager', () => NetRulesManager.init());
  await run('CSPController', () => CSPController.init());
  await run('UserAgentController', () => UserAgentController.init());
  await run('ArkoseController', () => ArkoseController.init());
  await run('DNRUtils', () => DNRUtils.initialize());
  await run('OffscreenController', () => OffscreenController.init());
  await run('BusController', () => BusController.init());
  (self as unknown as Record<string, unknown>)['bus'] = BusController;
}

// ============================================================================
// PERSISTENT OFFSCREEN DOCUMENT CONTROLLER
// ============================================================================
const OffscreenController = {
  _initialized: false,
  async isReady(): Promise<boolean> {
    try {
      if (this._initialized) return true;
      if (await chrome.offscreen.hasDocument()) {
        this._initialized = true;
        return true;
      }
      return false;
    } catch (e) {
      logInfraError('SW: offscreen.hasDocument check failed', e);
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
            url: 'offscreen.html',
            reasons: [
              chrome.offscreen.Reason.BLOBS,
              chrome.offscreen.Reason.DOM_PARSER,
              chrome.offscreen.Reason.WORKERS,
            ],
            justification: 'HTOS needs persistent offscreen DOM.',
          });
        }
        console.log('[SW] Offscreen document ready');
        this._initialized = true;
        return;
      } catch (e) {
        logInfraError(`SW: Offscreen init failed (attempt ${attempt}/${maxAttempts})`, e);
        if (attempt < maxAttempts) {
          await new Promise<void>((resolve) => setTimeout(resolve, 1000));
        }
      }
    }
    console.error('[SW] Offscreen init failed after all attempts');
    throw new Error('Failed to create offscreen document after max retries');
  },
};

// ============================================================================
// UNIFIED MESSAGE HANDLER
// ============================================================================
async function handleUnifiedMessage(
  message: Record<string, unknown>,
  _sender: chrome.runtime.MessageSender,
  sendResponse: (response: unknown) => void
): Promise<boolean> {
  try {
    const svcs = await initializeGlobalServices();
    const sm = svcs.sessionManager;

    if (!sm) {
      sendResponse({ success: false, error: 'Service not ready' });
      return true;
    }

    switch (message.type) {
      case 'REFRESH_AUTH_STATUS':
        authManager
          .getAuthStatus(true)
          .then((s) => sendResponse({ success: true, data: s }))
          .catch((e) => sendResponse({ success: false, error: getErrorMessage(e) }));
        return true;

      case 'VERIFY_AUTH_TOKEN':
        (async () => {
          const pid = (message.payload as { providerId?: string; force?: boolean } | undefined)?.providerId;
          const force = !!((message.payload as { force?: boolean } | undefined)?.force);
          if (force) {
            authManager.invalidateCache(pid);
          }
          const res = pid
            ? { [pid]: await authManager.verifyProvider(pid) }
            : await authManager.verifyAll();
          sendResponse({ success: true, data: res });
        })().catch((e) => sendResponse({ success: false, error: getErrorMessage(e) }));
        return true;

      case 'GENERATE_EMBEDDINGS':
      case 'PRELOAD_MODEL':
      case 'EMBEDDING_STATUS':
        (async () => {
          await OffscreenController.init();

          const response = await new Promise<unknown>((resolve) => {
            let settled = false;
            const payload = message?.payload as { timeoutMs?: number } | undefined;
            const timeoutMs = Number.isFinite(payload?.timeoutMs) ? payload!.timeoutMs! : 45000;
            const timeoutId = setTimeout(
              () => {
                settled = true;
                resolve({ success: false, error: 'Offscreen request timed out' });
              },
              Math.max(1, timeoutMs)
            );

            chrome.runtime.sendMessage({ ...message, __fromUnified: true }, (r) => {
              if (settled) return;
              clearTimeout(timeoutId);
              if (chrome.runtime.lastError) {
                resolve({ success: false, error: chrome.runtime.lastError.message });
              } else {
                resolve(r);
              }
            });
          });

          sendResponse(response);
        })().catch((e) => sendResponse({ success: false, error: getErrorMessage(e) }));
        return true;

      // Reconstruct full per-provider cognitive artifact.
      // Sources claims from mapping response text (same as graph view), not stale artifacts.
      // Delegates to doRegenerateEmbeddings() which handles dedup + full pipeline.
      case 'REGENERATE_EMBEDDINGS':
        (async () => {
          const payload = message.payload as { aiTurnId?: string; providerId?: string; embeddingModelId?: string } | undefined;
          const { aiTurnId, providerId, embeddingModelId } = payload ?? {};
          if (!aiTurnId || !providerId) {
            sendResponse({ success: false, error: 'Missing aiTurnId or providerId' });
            return;
          }
          const result = await doRegenerateEmbeddings(aiTurnId, providerId, sm, embeddingModelId, { broadcast: false });
          sendResponse(result);
        })().catch((e) => {
          logInfraError('Regenerate: Failed', e);
          sendResponse({ success: false, error: getErrorMessage(e) });
        });
        return true;

      case 'GET_PARAGRAPH_EMBEDDINGS_RECORD':
        (async () => {
          const payload = message.payload as { aiTurnId?: string } | undefined;
          const key = String(payload?.aiTurnId ?? '').trim();
          if (!key) {
            sendResponse({ success: true, data: { ok: false, reason: 'missing_aiTurnId' } });
            return;
          }
          const geoRecord = await sm.loadEmbeddings(key) as Record<string, unknown> & { meta?: Record<string, unknown>; paragraphEmbeddings?: unknown } | null;
          const meta = (geoRecord?.meta as Record<string, unknown> | undefined) ?? null;
          const hasPara = !!geoRecord?.paragraphEmbeddings;
          const hasIndex = !!(meta?.paragraphIndex);
          const dims = meta?.dimensions;

          if (!hasPara || !hasIndex || !dims) {
            let knownTurnIds: string[] | null = null;
            try {
              const adapter = (sm as unknown as { adapter?: { all?: (store: string) => Promise<unknown[]> } }).adapter;
              if (adapter?.all) {
                const all = await adapter.all('embeddings');
                const ids = (Array.isArray(all) ? all : [])
                  .map((r) => String((r as Record<string, unknown>)?.aiTurnId ?? (r as Record<string, unknown>)?.id ?? '').trim())
                  .filter(Boolean);
                knownTurnIds = ids.slice(0, 200);
              }
            } catch (e) {
              console.warn('[SW] GET_PARAGRAPH_EMBEDDINGS_RECORD: failed to list known turn IDs:', e);
            }
            sendResponse({
              success: true,
              data: {
                ok: false,
                aiTurnId: key,
                reason: 'missing_embeddings_or_index',
                found: !!geoRecord,
                hasParagraphEmbeddings: hasPara,
                hasParagraphIndex: hasIndex,
                dimensions: typeof dims === 'number' ? dims : null,
                meta: meta ?? null,
                knownTurnIds,
              },
            });
            return;
          }

          let safeBuffer: ArrayBuffer | null = geoRecord.paragraphEmbeddings as ArrayBuffer;
          if (safeBuffer && !(safeBuffer instanceof ArrayBuffer)) {
            const raw = safeBuffer as unknown;
            if (ArrayBuffer.isView(raw as ArrayBufferView)) {
              const view = raw as ArrayBufferView;
              if (
                view.byteOffset === 0 &&
                view.byteLength === view.buffer.byteLength
              ) {
                safeBuffer = view.buffer as ArrayBuffer;
              } else {
                safeBuffer = view.buffer.slice(
                  view.byteOffset,
                  view.byteOffset + view.byteLength
                ) as ArrayBuffer;
              }
            } else if (Array.isArray(raw)) {
              safeBuffer = new Float32Array(raw as number[]).buffer;
            } else if (
              typeof raw === 'object' &&
              raw !== null &&
              (raw as { type?: string }).type === 'Buffer' &&
              Array.isArray((raw as { data?: unknown }).data)
            ) {
              safeBuffer = new Uint8Array((raw as { data: number[] }).data).buffer;
            } else {
              const vals = Object.values(raw as Record<string, unknown>).filter((v) => typeof v === 'number') as number[];
              const paragraphIndex = meta!.paragraphIndex as string[];
              const dimensions = meta!.dimensions as number;
              const expectedLength = paragraphIndex.length * dimensions;

              if (vals.length > 0 && vals.length === expectedLength) {
                safeBuffer = new Float32Array(vals).buffer;
              } else {
                console.warn(
                  `[sw-entry] Invalid paragraphEmbeddings format or length mismatch. Expected ${expectedLength} floats, got ${vals.length}. Format was:`,
                  typeof raw
                );
                safeBuffer = null;
              }
            }
          }

          const payload2 = {
            ok: true,
            aiTurnId: key,
            buffer: safeBuffer,
            index: (meta as Record<string, unknown>).paragraphIndex,
            dimensions: (meta as Record<string, unknown>).dimensions,
            timestamp: (meta as Record<string, unknown>).timestamp ?? null,
          };
          sendResponse({ success: true, data: payload2 });
        })().catch((e) => sendResponse({ success: false, error: getErrorMessage(e) }));
        return true;

      case 'CORPUS_SEARCH':
        (async () => {
          const payload = message.payload as { aiTurnId?: string; queryText?: string } | undefined;
          const { aiTurnId, queryText } = payload ?? {};
          if (!aiTurnId || !queryText) {
            sendResponse({ success: false, error: 'Missing aiTurnId or queryText' });
            return;
          }
          const geoRecord = await sm.loadEmbeddings(aiTurnId) as Record<string, unknown> | null;
          // CORPUS_SEARCH logic
          const adapter = (sm as unknown as { adapter: { get: (store: string, id: string) => Promise<unknown> } }).adapter;
          const turnRaw = await adapter.get('turns', aiTurnId) as Record<string, unknown> | null;
          const corpusTree = (turnRaw?.mapping as Record<string, unknown> | undefined)?.artifact
            ? ((turnRaw!.mapping as Record<string, unknown>).artifact as Record<string, unknown>).corpus as { models?: unknown[] } | null
            : null;
          console.log(
            `[CORPUS_SEARCH] DB corpus models: ${corpusTree?.models?.length ?? 0}, artifact exists: ${!!(turnRaw as Record<string, unknown> | null)?.mapping}`
          );

          // Build paragraph lookup from corpus tree. If corpus is absent (old session),
          // rebuild from batch responses using shadow extraction.
          const paraLookup = new Map<string, { id: string; modelIndex: number; paragraphIndex: number; _fullParagraph?: string; statements?: Array<{ text: string }> }>();
          if ((corpusTree?.models?.length ?? 0) > 0) {
            for (const model of corpusTree!.models!) {
              const m = model as { paragraphs?: Array<{ paragraphId: string; modelIndex: number; paragraphOrdinal: number; _fullParagraph?: string }> };
              for (const para of m.paragraphs ?? []) {
                paraLookup.set(para.paragraphId, {
                  id: para.paragraphId,
                  modelIndex: para.modelIndex,
                  paragraphIndex: para.paragraphOrdinal,
                  _fullParagraph: para._fullParagraph,
                });
              }
            }
          } else {
            console.log('[CORPUS_SEARCH] No corpus tree in DB — rebuilding from batch responses...');
            try {
              let responsesForTurn: unknown[] = [];
              const smAdapter = (sm as unknown as { adapter?: { getResponsesByTurnId?: (id: string) => Promise<unknown[]> } }).adapter;
              if (smAdapter?.getResponsesByTurnId) {
                responsesForTurn = (await smAdapter.getResponsesByTurnId(aiTurnId)) ?? [];
                console.log(`[CORPUS_SEARCH] Loaded ${responsesForTurn.length} responses for turn`);
              } else {
                console.warn('[CORPUS_SEARCH] adapter.getResponsesByTurnId not available!');
              }
              type RespRecord = { responseType?: string; providerId?: string; text?: string; updatedAt?: number; createdAt?: number };
              const allBatchResps = (responsesForTurn as RespRecord[])
                .filter(
                  (r) =>
                    r && r.responseType === 'batch' && r.providerId && String(r.text || '').trim()
                )
                .sort(
                  (a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0)
                );
              console.log(`[CORPUS_SEARCH] Batch responses found: ${allBatchResps.length}`);

              const seenBatchProviders = new Map<string, RespRecord>();
              for (const r of allBatchResps) {
                const pid = String(r.providerId || '').trim().toLowerCase();
                if (!seenBatchProviders.has(pid)) seenBatchProviders.set(pid, r);
              }
              console.log(
                `[CORPUS_SEARCH] Unique batch providers: ${Array.from(seenBatchProviders.keys()).join(', ')}`
              );

              if (seenBatchProviders.size > 0) {
                const canonicalOrder = canonicalCitationOrder(Array.from(seenBatchProviders.keys()));
                const batchSources = canonicalOrder
                  .map((pid, i) => {
                    const r = seenBatchProviders.get(pid);
                    return { modelIndex: i + 1, content: String(r?.text || '') };
                  })
                  .filter((s) => s.content);

                if (batchSources.length > 0) {
                  const shadowResult = extractShadowStatements(batchSources);
                  const shadowParagraphs = projectParagraphs(shadowResult.statements).paragraphs || [];
                  for (const p of shadowParagraphs) {
                    paraLookup.set(p.id, p as unknown as { id: string; modelIndex: number; paragraphIndex: number; _fullParagraph?: string });
                  }
                  console.log(
                    `[CORPUS_SEARCH] Rebuilt ${shadowParagraphs.length} paragraphs from ${batchSources.length} batch sources`
                  );
                  if (shadowParagraphs.length > 0) {
                    const sampleIds = shadowParagraphs.slice(0, 5).map((p) => `${p.id}(m${(p as { modelIndex?: number }).modelIndex})`);
                    console.log(`[CORPUS_SEARCH] Sample rebuilt IDs: ${sampleIds.join(', ')}`);
                  }
                }
              }
            } catch (err) {
              console.warn('[CORPUS_SEARCH] rebuild paragraphs failed:', err);
            }
          }

          // Diagnostic: show embedding index IDs vs paraLookup IDs
          const embeddingParaIds = (geoRecord?.meta as Record<string, unknown> | undefined)?.paragraphIndex as string[] || [];
          const matchCount = embeddingParaIds.filter((id) => paraLookup.has(id)).length;
          console.log(
            `[CORPUS_SEARCH] paraLookup size: ${paraLookup.size}, embedding index IDs: ${embeddingParaIds.length}, matched: ${matchCount}/${embeddingParaIds.length}`
          );
          if (embeddingParaIds.length > 0 && matchCount === 0) {
            const sampleEmbIds = embeddingParaIds.slice(0, 5);
            const sampleParaIds = Array.from(paraLookup.keys()).slice(0, 5);
            console.warn(
              `[CORPUS_SEARCH] ID MISMATCH — embedding IDs: [${sampleEmbIds}] vs paraLookup IDs: [${sampleParaIds}]`
            );
          }

          type EmbeddingRecord = { paragraphEmbeddings?: unknown; meta?: { paragraphIndex?: string[]; dimensions?: number } };
          const paragraphEmbeddings = new Map<string, Float32Array>();
          const paragraphMeta: Array<{ id: string; modelIndex: number; paragraphIndex: number }> = [];
          const paragraphMetaSeen = new Set<string>();
          const appendEmbeddingRecord = (record: EmbeddingRecord | null, probeMeta: { modelIndex?: number } | null = null): void => {
            if (
              !record?.paragraphEmbeddings ||
              !record?.meta?.paragraphIndex?.length ||
              !record?.meta?.dimensions
            )
              return;
            const dims = record.meta.dimensions;
            const unpacked = unpackEmbeddingMap(
              record.paragraphEmbeddings as ArrayBuffer,
              record.meta.paragraphIndex,
              dims
            ) as Map<string, Float32Array>;
            for (const [pid, vec] of unpacked.entries()) {
              if (paragraphMetaSeen.has(pid)) continue;
              paragraphMetaSeen.add(pid);
              paragraphEmbeddings.set(pid, vec);
              const p = paraLookup.get(pid);
              paragraphMeta.push({
                id: pid,
                modelIndex: p?.modelIndex ?? probeMeta?.modelIndex ?? 0,
                paragraphIndex: p?.paragraphIndex ?? paragraphMeta.length,
              });
            }
          };

          appendEmbeddingRecord(geoRecord as EmbeddingRecord);

          const smAdapter2 = (sm as unknown as { adapter: { getByIndex: (store: string, index: string, key: string) => Promise<unknown[]>; get: (store: string, id: string) => Promise<unknown> } }).adapter;
          const probeRecords = await smAdapter2
            .getByIndex('metadata', 'byEntityId', aiTurnId)
            .catch((e: unknown) => { console.warn('[CORPUS_SEARCH] getByIndex failed:', e); return [] as unknown[]; });

          for (const rec of (probeRecords ?? []) as Array<Record<string, unknown>>) {
            if (rec?.type !== 'probe_geo_record') continue;
            const probeValue = (rec?.value as Record<string, unknown>) ?? {};
            const embeddingId = (probeValue?.embeddingId as string) || (rec?.key as string);
            if (!embeddingId) continue;
            const probeEmbeddingRecord = await smAdapter2
              .get('embeddings', embeddingId)
              .catch((e: unknown) => { console.warn('[CORPUS_SEARCH] get probe embedding failed:', e); return null; });
            if (!probeEmbeddingRecord) continue;
            const probeParagraphIds = Array.isArray(probeValue?.paragraphIds)
              ? (probeValue.paragraphIds as string[])
              : [];
            const probeParagraphs = Array.isArray(probeValue?.paragraphs)
              ? (probeValue.paragraphs as string[])
              : [];
            for (let i = 0; i < probeParagraphIds.length; i++) {
              const pid = probeParagraphIds[i];
              if (!pid || paraLookup.has(pid)) continue;
              paraLookup.set(pid, {
                id: pid,
                modelIndex: Number(probeValue?.modelIndex) || 0,
                paragraphIndex: i,
                _fullParagraph: String(probeParagraphs[i] || ''),
              });
            }
            appendEmbeddingRecord(probeEmbeddingRecord as EmbeddingRecord, {
              modelIndex: Number(probeValue?.modelIndex) || 0,
            });
          }

          if (paragraphEmbeddings.size === 0 || paragraphMeta.length === 0) {
            sendResponse({ success: true, data: { results: [], reason: 'no_embeddings' } });
            return;
          }

          // Embed the query using the same model that was used for the corpus
          const corpusModelId = (geoRecord?.meta as Record<string, unknown> | undefined)?.embeddingModelId as string || 'bge-base-en-v1.5';
          const corpusEmbeddingConfig = getConfigForModel(corpusModelId);
          const truncated = structuredTruncate(queryText.trim(), 1200);
          const prefixed = truncated.toLowerCase().startsWith('represent this sentence')
            ? truncated
            : `Represent this sentence for searching relevant passages: ${truncated}`;
          const queryBatch = await generateTextEmbeddings([prefixed], corpusEmbeddingConfig);
          const queryEmbedding = (queryBatch.embeddings as Map<string, Float32Array>).get('0');
          if (!queryEmbedding) {
            sendResponse({ success: false, error: 'Query embedding failed' });
            return;
          }

          const hits = (searchCorpus(queryEmbedding, paragraphEmbeddings, paragraphMeta, 50) as unknown) as Array<{ paragraphId: string;[key: string]: unknown }>;

          // Enrich hits with paragraph text
          const results = hits.map((h) => {
            const p = paraLookup.get(h.paragraphId);
            let text = p?._fullParagraph || '';
            if (!text && p?.statements && Array.isArray(p.statements)) {
              text = p.statements.map((s) => s.text).join(' ');
            }
            return {
              ...h,
              text: text.slice(0, 800),
            };
          });

          sendResponse({ success: true, data: { results } });
        })().catch((e) => sendResponse({ success: false, error: getErrorMessage(e) }));
        return true;

      case 'DEBUG_EXECUTE_SINGLE':
        (async () => {
          const payload = message.payload as { providerId?: string; prompt?: string; timeout?: number } | undefined;
          const providerId = String(payload?.providerId || '').toLowerCase();
          const prompt = String(payload?.prompt || '');
          const timeout = Number.isFinite(payload?.timeout) ? payload!.timeout! : 60000;
          if (!providerId) throw new Error('Missing providerId');
          if (!prompt) throw new Error('Missing prompt');
          const orchestrator = svcs.orchestrator;
          if (!orchestrator || typeof orchestrator.executeSingle !== 'function') {
            throw new Error('Orchestrator not available');
          }
          const result = await orchestrator.executeSingle(prompt, providerId, { timeout });
          sendResponse({ success: true, data: result });
        })().catch((e) => sendResponse({ success: false, error: getErrorMessage(e) }));
        return true;

      case 'GET_FULL_HISTORY': {
        const smAdapter = (sm as unknown as { adapter: { getAllSessions: () => Promise<Array<Record<string, unknown>>> } }).adapter;
        const allSessions = (await smAdapter.getAllSessions()) ?? [];
        const sessions = allSessions
          .map((r) => ({
            id: r.id,
            sessionId: r.id,
            title: (r.title as string | undefined) || 'New Chat',
            startTime: r.createdAt,
            lastActivity: r.updatedAt || r.lastActivity,
            messageCount: (r.turnCount as number | undefined) || 0,
            firstMessage: '',
          }))
          .sort((a, b) => ((b.lastActivity as number) || 0) - ((a.lastActivity as number) || 0));
        sendResponse({ success: true, data: { sessions } });
        return true;
      }

      case 'GET_HISTORY_SESSION': {
        (async () => {
          const payload = (message.payload || {}) as { sessionId?: string; embeddingModelId?: string };
          const sessionId = (message.sessionId as string | undefined) || payload.sessionId;
          const embeddingModelId = (message.embeddingModelId as string | undefined) || payload.embeddingModelId;

          if (!sessionId) throw new Error('Missing sessionId');

          const smAdapter = (sm as unknown as {
            adapter: {
              get: (store: string, id: string) => Promise<Record<string, unknown> | null>;
              getTurnsBySessionId: (id: string) => Promise<Array<Record<string, unknown>>>;
              getResponsesByTurnId?: (id: string) => Promise<Array<Record<string, unknown>>>;
              getContextsBySessionId?: (id: string) => Promise<Array<Record<string, unknown>>>;
            };
          }).adapter;

          const sessionRecord = await smAdapter.get('sessions', sessionId);
          let turns = await smAdapter.getTurnsBySessionId(sessionId);
          turns = Array.isArray(turns)
            ? turns.sort((a, b) => ((a.sequence as number) ?? (a.createdAt as number)) - ((b.sequence as number) ?? (b.createdAt as number)))
            : [];

          type ResponseBucket = { providerId: string; text: string; status: string; createdAt: number; updatedAt: number; meta: Record<string, unknown>; responseIndex: number };
          type Buckets = { providers: Record<string, ResponseBucket[]>; mappingResponses: Record<string, ResponseBucket[]>; singularityResponses: Record<string, ResponseBucket[]> };

          const bucketizeResponses = (resps: Array<Record<string, unknown>>): Buckets => {
            const buckets: Buckets = {
              providers: {},
              mappingResponses: {},
              singularityResponses: {},
            };

            for (const r of resps ?? []) {
              if (!r) continue;
              const providerId = r.providerId as string;
              if (!providerId) continue;

              const entry: ResponseBucket = {
                providerId,
                text: (r.text as string) || '',
                status: (r.status as string) || 'completed',
                createdAt: (r.createdAt as number) || Date.now(),
                updatedAt: (r.updatedAt as number) || (r.createdAt as number) || Date.now(),
                meta: (r.meta as Record<string, unknown>) || {},
                responseIndex: (r.responseIndex as number) ?? 0,
              };

              if (r.responseType === 'batch') {
                (buckets.providers[providerId] ||= []).push(entry);
              } else if (r.responseType === 'mapping') {
                (buckets.mappingResponses[providerId] ||= []).push(entry);
              } else if (r.responseType === 'singularity') {
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

          const rounds: unknown[] = [];
          for (let i = 0; i < turns.length; i++) {
            const user = turns[i];
            if (!user || user.type !== 'user') continue;

            const allAi = turns.filter((t) => t.type === 'ai' && t.userTurnId === user.id);
            if (!allAi.length) continue;

            const nextTurn = turns[i + 1];
            let primaryAi: Record<string, unknown> | null = null;

            const defaultPrimary =
              nextTurn &&
                nextTurn.type === 'ai' &&
                nextTurn.userTurnId === user.id &&
                !(nextTurn.meta as AiTurn['meta'])?.isHistoricalRerun &&
                nextTurn.sequence !== -1
                ? nextTurn
                : allAi.find((t) => !(t.meta as AiTurn['meta'])?.isHistoricalRerun && t.sequence !== -1) || allAi[0];
            primaryAi = defaultPrimary;

            let pipelineStatus: string | undefined =
              typeof primaryAi?.pipelineStatus === 'string'
                ? primaryAi.pipelineStatus as string
                : typeof (primaryAi?.meta as Record<string, unknown> | undefined)?.pipelineStatus === 'string'
                  ? (primaryAi.meta as Record<string, unknown>).pipelineStatus as string
                  : undefined;

            let providers: Record<string, ResponseBucket[]> = {};
            let mappingResponses: Record<string, ResponseBucket[]> = {};
            let singularityResponses: Record<string, ResponseBucket[]> = {};
            try {
              if (smAdapter.getResponsesByTurnId) {
                const resps = await smAdapter.getResponsesByTurnId(primaryAi!.id as string);
                const buckets = bucketizeResponses(resps);
                providers = buckets.providers || {};
                mappingResponses = buckets.mappingResponses || {};
                singularityResponses = buckets.singularityResponses || {};
              }
            } catch (e) {
              console.warn('[SW] GET_HISTORY_SESSION: failed to load responses for turn:', primaryAi?.id, e);
            }

            rounds.push({
              userTurnId: user.id,
              aiTurnId: primaryAi!.id,
              user: {
                id: user.id,
                text: (user.text as string) || (user.content as string) || '',
                createdAt: (user.createdAt as number) || 0,
              },
              ...(primaryAi?.batch ? { batch: primaryAi.batch } : {}),
              // Tier 3: mapping.artifact is ephemeral — not sent in history payload.
              // UI rebuilds artifacts on demand via BUILD_ARTIFACT / REGENERATE_EMBEDDINGS.
              ...(primaryAi?.singularity ? { singularity: primaryAi.singularity } : {}),
              ...(primaryAi?.meta ? { meta: primaryAi.meta } : {}),
              ...(Array.isArray(primaryAi?.probeSessions) && (primaryAi!.probeSessions as unknown[]).length > 0
                ? { probeSessions: primaryAi!.probeSessions }
                : {}),
              ...(Object.keys(providers).length > 0 ? { providers } : {}),
              ...(Object.keys(mappingResponses).length > 0 ? { mappingResponses } : {}),
              ...(Object.keys(singularityResponses).length > 0 ? { singularityResponses } : {}),
              ...(pipelineStatus ? { pipelineStatus } : {}),
              createdAt: (user.createdAt as number) || 0,
              completedAt: (primaryAi!.updatedAt as number) || 0,
            });
          }

          // Fetch contexts
          let providerContexts: Record<string, unknown> = {};
          try {
            if (smAdapter.getContextsBySessionId) {
              const ctxs = await smAdapter.getContextsBySessionId(sessionId);
              (ctxs || []).forEach((c) => {
                if (c?.providerId)
                  providerContexts[c.providerId as string] = {
                    ...(c.meta as Record<string, unknown> || {}),
                    ...(c.contextData as Record<string, unknown> || {}),
                    metadata: (c.metadata as unknown) || null,
                  };
              });
            }
          } catch (e) {
            console.warn('[SW] GET_HISTORY_SESSION: failed to load provider contexts for session:', sessionId, e);
          }

          sendResponse({
            success: true,
            data: {
              id: sessionId,
              sessionId,
              title: (sessionRecord?.title as string) || 'Chat',
              turns: rounds,
              providerContexts,
            },
          });

          // Fire-and-forget: preemptively build artifact for latest turn so
          // instrument panel is instant when opened. doRegenerateEmbeddings
          // deduplicates — if the UI fires REGENERATE_EMBEDDINGS before this
          // completes, they share the same in-flight promise.
          const latestRound = rounds.length > 0 ? rounds[rounds.length - 1] as Record<string, unknown> : null;
          const latestMapper =
            (latestRound?.meta as Record<string, unknown> | undefined)?.mapper as string ||
            Object.keys((latestRound?.mappingResponses as Record<string, unknown> | undefined) ?? {})[0] ||
            null;
          if (latestRound?.aiTurnId && latestMapper) {
            doRegenerateEmbeddings(latestRound.aiTurnId as string, latestMapper, sm, embeddingModelId, { broadcast: true }).catch((err) => { logInfraError('sw-entry/doRegenerateEmbeddings-fire-forget', err); });
          }
        })().catch((e) => sendResponse({ success: false, error: getErrorMessage(e) }));
        return true;
      }

      case 'GET_SESSION': {
        const operationId = persistenceMonitor.startOperation('GET_SESSION', {
          sessionId: (message.sessionId as string | undefined) || (message.payload as { sessionId?: string } | undefined)?.sessionId,
        });

        try {
          const sessionId = (message.sessionId as string | undefined) || (message.payload as { sessionId?: string } | undefined)?.sessionId;
          if (!sessionId) {
            console.warn('[GET_SESSION] sessionId is undefined — cannot retrieve session');
            sendResponse({ success: false, error: 'sessionId missing' });
            return true;
          }
          const session = await sm.getOrCreateSession(sessionId);
          persistenceMonitor.endOperation(operationId, {
            sessionFound: !!session,
          });
          sendResponse({ success: true, session });
        } catch (error) {
          persistenceMonitor.endOperation(operationId, null, error);
          const handledError = await errorHandler.handleError(error, {
            operation: 'getSession',
            sessionId: (message.sessionId as string | undefined) || (message.payload as { sessionId?: string } | undefined)?.sessionId,
            retry: () => sm.getOrCreateSession(((message.sessionId as string | undefined) || (message.payload as { sessionId?: string } | undefined)?.sessionId)!),
          });
          sendResponse({ success: false, error: getErrorMessage(handledError) });
        }
        return true;
      }

      case 'UPDATE_PROVIDER_CONTEXT': {
        const sessionId = (message.sessionId as string | undefined) || (message.payload as { sessionId?: string } | undefined)?.sessionId;
        await sm.updateProviderContext(
          sessionId || '',
          (message.providerId as string | undefined) || (message.payload as { providerId?: string } | undefined)?.providerId || '',
          ((message.context as unknown) || (message.payload as { context?: unknown } | undefined)?.context) as import('../shared/types').ProviderOutput | undefined
        );
        sendResponse({ success: true });
        return true;
      }

      case 'DELETE_SESSION': {
        const sessionId = (message.sessionId as string | undefined) || (message.payload as { sessionId?: string } | undefined)?.sessionId;
        try {
          const removed = await sm.deleteSession(sessionId || '');
          // Return explicit removed boolean so UI can react optimistically
          sendResponse({ success: true, removed });
        } catch (e) {
          logInfraError('SW: DELETE_SESSION failed', e);
          sendResponse({ success: false, error: getErrorMessage(e) });
        }
        return true;
      }

      case 'DELETE_SESSIONS': {
        try {
          const ids = ((message.sessionIds as string[] | undefined) || (message.payload as { sessionIds?: string[] } | undefined)?.sessionIds || []).filter(Boolean);
          if (!Array.isArray(ids) || ids.length === 0) {
            sendResponse({ success: false, error: 'No sessionIds provided' });
            return true;
          }

          const results = await Promise.all(
            ids.map(async (id) => {
              try {
                const removed = await sm.deleteSession(id);
                return { id, removed };
              } catch (err) {
                logInfraError(`SW: DELETE_SESSIONS item failed for ${id}`, err);
                return { id, removed: false };
              }
            })
          );

          const removedIds = results.filter((r) => r.removed).map((r) => r.id);
          sendResponse({
            success: true,
            removed: removedIds.length,
            ids: removedIds,
          });
        } catch (e) {
          logInfraError('SW: DELETE_SESSIONS failed', e);
          sendResponse({ success: false, error: getErrorMessage(e) });
        }
        return true;
      }

      case 'RENAME_SESSION': {
        try {
          const sessionId = (message.sessionId as string | undefined) || (message.payload as { sessionId?: string } | undefined)?.sessionId;
          const newTitleRaw = (message.title as string | undefined) || (message.payload as { title?: string } | undefined)?.title;
          if (!sessionId) {
            sendResponse({ success: false, error: 'Missing sessionId' });
            return true;
          }
          const newTitle = String(newTitleRaw ?? '').trim();
          if (!newTitle) {
            sendResponse({ success: false, error: 'Title cannot be empty' });
            return true;
          }

          // Persistence-first rename using adapter directly if available, fallback to session op
          const smAdapter = sm as unknown as { adapter?: { get?: (store: string, id: string) => Promise<Record<string, unknown> | null>; put?: (store: string, record: Record<string, unknown>) => Promise<void> }; sessions?: Record<string, Record<string, unknown>> };
          if (smAdapter.adapter?.get && smAdapter.adapter?.put) {
            const record = await smAdapter.adapter.get('sessions', sessionId);
            if (!record) {
              sendResponse({ success: false, error: `Session ${sessionId} not found` });
              return true;
            }
            record.title = newTitle;
            record.updatedAt = Date.now();
            await smAdapter.adapter.put('sessions', record);

            // Updates local cache if needed
            if (smAdapter.sessions?.[sessionId]) {
              smAdapter.sessions[sessionId].title = newTitle;
              smAdapter.sessions[sessionId].updatedAt = record.updatedAt;
            }
          }

          sendResponse({
            success: true,
            updated: true,
            sessionId,
            title: newTitle,
          });
        } catch (e) {
          logInfraError('SW: RENAME_SESSION failed', e);
          sendResponse({ success: false, error: getErrorMessage(e) });
        }
        return true;
      }

      case 'GET_PERSISTENCE_STATUS': {
        const layer = services.get('persistenceLayer');
        const status = {
          persistenceEnabled: true,
          sessionManagerType: (sm as unknown as { constructor?: { name?: string } })?.constructor?.name || 'unknown',
          persistenceLayerAvailable: !!layer,
          adapterStatus: (sm as unknown as { getPersistenceStatus?: () => unknown })?.getPersistenceStatus?.() ?? null,
        };
        sendResponse({ success: true, status });
        return true;
      }

      default: {
        // Catches "htos.keepalive" or any typos so the channel closes properly
        console.warn('[SW] Unknown message type ignored:', message.type);
        sendResponse({ success: false, error: 'Unknown message type' });
        return true;
      }
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

const regenInflight = new Map<string, Promise<RegenerateResult>>();

/**
 * Run the full regenerate-embeddings pipeline and return the result.
 * Returns { success: true, data: { artifact, claimCount, edgeCount } }
 * or { success: false, error: string }.
 */
function doRegenerateEmbeddings(
  aiTurnId: string,
  providerId: string,
  sm: SessionManager,
  requestedModelId?: string,
  options: { broadcast: boolean } = { broadcast: true }
): Promise<RegenerateResult> {
  const resolvedModelId = requestedModelId || 'bge-base-en-v1.5';
  const cacheKey = `${aiTurnId}::${String(providerId || '')
    .trim()
    .toLowerCase()}::${resolvedModelId}`;

  if (regenInflight.has(cacheKey)) return regenInflight.get(cacheKey)!;

  const work = (async (): Promise<RegenerateResult> => {
    const normalizeProvId = (pid: unknown): string =>
      String(pid || '')
        .trim()
        .toLowerCase();

    type SmAdapterFull = {
      get: (store: string, id: string) => Promise<Record<string, unknown> | null>;
      getResponsesByTurnId?: (id: string) => Promise<Array<Record<string, unknown>>>;
      put: (store: string, record: Record<string, unknown>) => Promise<void>;
    };
    const smAdapter = (sm as unknown as { adapter: SmAdapterFull }).adapter;

    const turnRaw = await smAdapter.get('turns', aiTurnId);
    if (!turnRaw) return { success: false, error: 'Turn not found' };

    // ── Minimal imports (geometry I/O + codec only) ──
    const embeddingConfig = getConfigForModel(resolvedModelId);
    const dims = embeddingConfig.embeddingDimensions;

    // ── Load query text (shared) ──
    const userTurnId = turnRaw.userTurnId as string | undefined;
    let queryText = '';
    if (userTurnId) {
      try {
        const userTurn = await smAdapter.get('turns', userTurnId);
        queryText = (userTurn?.text as string) || (userTurn?.content as string) || '';
      } catch (err) {
        logInfraError(`Regenerate: Failed to load user turn for aiTurnId=${aiTurnId}`, err);
      }
    }

    const readCitationOrderFromMeta = (meta: Record<string, unknown> | null | undefined): string[] => {
      try {
        const raw = meta?.citationSourceOrder;
        if (!raw || typeof raw !== 'object') return [];
        const entries = Object.entries(raw as Record<string, string>)
          .map(([k, v]) => [Number(k), String(v || '').trim()] as [number, string])
          .filter(([n, pid]) => Number.isFinite(n) && n > 0 && pid);
        entries.sort((a, b) => a[0] - b[0]);
        return entries.map(([, pid]) => normalizeProvId(pid));
      } catch (err) {
        logInfraError('sw-entry/readCitationOrderFromMeta', err);
        return [];
      }
    };

    // ── A. Load provider responses (mappingResp + text only) ──
    let responsesForTurn: Array<Record<string, unknown>> = [];
    try {
      if (smAdapter?.getResponsesByTurnId) {
        const resps = await smAdapter.getResponsesByTurnId(aiTurnId);
        responsesForTurn = Array.isArray(resps) ? resps : [];
      }
    } catch (err) {
      logInfraError(`Regenerate: Failed to load responses for aiTurnId=${aiTurnId}`, err);
      return { success: false, error: 'Failed to load responses for this turn' };
    }

    const mappingResp =
      responsesForTurn
        .filter(
          (r) =>
            r &&
            r.responseType === 'mapping' &&
            normalizeProvId(r.providerId) === normalizeProvId(providerId)
        )
        .sort(
          (a, b) => ((b.updatedAt as number) || (b.createdAt as number) || 0) - ((a.updatedAt as number) || (a.createdAt as number) || 0)
        )?.[0] || null;

    const mappingText = String(mappingResp?.text || '').trim();
    if (!mappingText) {
      return { success: false, error: 'No mapping response text found for this provider' };
    }

    // ── B. Shadow + batch sources (no parsing here) ──
    const citationOrderArr = readCitationOrderFromMeta(mappingResp?.meta as Record<string, unknown> | null);

    let shadowStatements: import('./shadow/index.js').ShadowStatement[] | null = null;
    let shadowParagraphs: import('./shadow/index.js').ShadowParagraph[] | null = null;
    let batchSources: Array<{ modelIndex: number; content: string }> = [];

    // Always rebuild batch sources from DB responses (canonical ordering)
    try {
      const allBatchResps = responsesForTurn
        .filter(
          (r) => r && r.responseType === 'batch' && r.providerId && String(r.text || '').trim()
        )
        .sort((a, b) => ((b.updatedAt as number) || (b.createdAt as number) || 0) - ((a.updatedAt as number) || (a.createdAt as number) || 0));

      const seenBatchProviders = new Map<string, Record<string, unknown>>();
      for (const r of allBatchResps) {
        const pid = normalizeProvId(r.providerId);
        if (!seenBatchProviders.has(pid)) seenBatchProviders.set(pid, r);
      }

      const canonicalOrder = canonicalCitationOrder(Array.from(seenBatchProviders.keys()));

      batchSources = canonicalOrder
        .map((pid, idx) => {
          const r = seenBatchProviders.get(pid);
          return { modelIndex: idx + 1, content: String(r?.text || '') };
        })
        .filter((s) => s.content);
    } catch (err) {
      logInfraError(`Regenerate: Shadow reconstruction failed for aiTurnId=${aiTurnId}`, err);
      return { success: false, error: 'Shadow reconstruction failed' };
    }

    // ── Model count ──
    const uniqueBatchProviders = new Set(
      responsesForTurn
        .filter(
          (r) => r && r.responseType === 'batch' && r.providerId && String(r.text || '').trim()
        )
        .map((r) => normalizeProvId(r.providerId))
    );
    const modelCount = Math.max(citationOrderArr.length, uniqueBatchProviders.size, 1);

    // ── B.1 Always re-extract shadow from batch (ground truth for current code) ──
    // Never trust stored shadow statements — extraction rules may have changed.
    if (batchSources.length > 0) {
      const shadowResult = extractShadowStatements(batchSources);
      shadowStatements = shadowResult.statements;
      shadowParagraphs = projectParagraphs(shadowResult.statements).paragraphs;
      console.log(
        `[Regenerate] Fresh extraction: ${shadowStatements.length} stmts, ${shadowParagraphs.length} paras`
      );
    }
    if (!Array.isArray(shadowStatements) || shadowStatements.length === 0) {
      return { success: false, error: 'No shadow statements for embedding generation' };
    }
    if (!Array.isArray(shadowParagraphs) || shadowParagraphs.length === 0) {
      shadowParagraphs = projectParagraphs(shadowStatements).paragraphs;
    }

    // ── C. Geometry embeddings — regenerate if missing or stale ──
    type GeoRecord = {
      statementEmbeddings?: unknown;
      paragraphEmbeddings?: unknown;
      queryEmbedding?: ArrayBuffer;
      meta?: {
        statementIndex?: string[];
        paragraphIndex?: string[];
        embeddingModelId?: string;
        embeddingVersion?: number;
        dimensions?: number;
        paragraphCount?: number;
      };
    };
    let geoRecord = await sm.loadEmbeddings(aiTurnId) as GeoRecord | null;

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

    const cachedModelId = geoRecord?.meta?.embeddingModelId || 'bge-base-en-v1.5';
    const modelMismatch = cachedModelId !== resolvedModelId;

    if (stmtIdMismatch || paraIdMismatch || modelMismatch) {
      console.log(
        `[Regenerate] Embedding cache stale:`,
        stmtIdMismatch ? `stmts ${cachedStmtIds.size}→${currentStmtIds.size}` : '',
        paraIdMismatch ? `paras ${cachedParaIds.size}→${currentParaIds.size}` : '',
        modelMismatch ? `model ${cachedModelId}→${resolvedModelId}` : ''
      );
    }

    const needsRegeneration =
      !geoRecord?.statementEmbeddings ||
      !geoRecord?.paragraphEmbeddings ||
      (geoRecord.meta?.paragraphCount === 0 && shadowParagraphs.length > 0) ||
      geoRecord.meta?.embeddingVersion !== 2 ||
      stmtIdMismatch ||
      paraIdMismatch ||
      modelMismatch;

    if (needsRegeneration) {
      const stmtResult = await generateStatementEmbeddings(shadowStatements, embeddingConfig);
      const paraResult = await generateEmbeddings(
        shadowParagraphs,
        shadowStatements,
        embeddingConfig
      );

      let queryEmbedding: Float32Array | null = null;
      if (queryText) {
        const cleaned = stripInlineMarkdown(String(queryText)).trim();
        const truncated = structuredTruncate(cleaned, 1740);
        const prefixed =
          truncated && !truncated.toLowerCase().startsWith('represent this sentence')
            ? `Represent this sentence for searching relevant passages: ${truncated}`
            : truncated;
        if (prefixed) {
          const batch = await generateTextEmbeddings([prefixed], embeddingConfig);
          queryEmbedding = (batch.embeddings as Map<string, Float32Array>).get('0') || null;
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
        queryEmbedding: queryBuffer as ArrayBuffer | null,
        meta: {
          embeddingModelId: resolvedModelId,
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
      geoRecord = await sm.loadEmbeddings(aiTurnId) as GeoRecord | null;
    }

    if (!geoRecord?.statementEmbeddings || !geoRecord?.paragraphEmbeddings) {
      return { success: false, error: 'Geometry embeddings unavailable' };
    }

    const statementEmbeddings = unpackEmbeddingMap(
      geoRecord.statementEmbeddings as ArrayBuffer,
      geoRecord.meta!.statementIndex!,
      geoRecord.meta!.dimensions!
    ) as Map<string, Float32Array>;
    const paragraphEmbeddings = unpackEmbeddingMap(
      geoRecord.paragraphEmbeddings as ArrayBuffer,
      geoRecord.meta!.paragraphIndex!,
      geoRecord.meta!.dimensions!
    ) as Map<string, Float32Array>;
    const queryEmbedding: Float32Array | null =
      geoRecord?.queryEmbedding && geoRecord.queryEmbedding.byteLength > 0
        ? new Float32Array(geoRecord.queryEmbedding)
        : null;

    // ══════════════════════════════════════════════════════════════
    // SINGLE SOURCE OF TRUTH: buildArtifactForProvider()
    // ══════════════════════════════════════════════════════════════
    // Load cached claim embeddings

    const regenCanonicalOrder = canonicalCitationOrder(Array.from(uniqueBatchProviders));

    const buildResultRaw = await buildArtifactForProvider({
      mappingText,
      shadowStatements:
        Array.isArray(shadowStatements) && shadowStatements.length > 0 ? shadowStatements : null,
      shadowParagraphs:
        Array.isArray(shadowParagraphs) && shadowParagraphs.length > 0 ? shadowParagraphs : null,
      batchSources,
      statementEmbeddings,
      paragraphEmbeddings,
      queryEmbedding,
      geoRecord: geoRecord as Record<string, unknown>,
      claimEmbeddings: null, // always regenerate for now
      citationSourceOrder: buildCitationSourceOrder(regenCanonicalOrder),
      queryText,
      modelCount,
      embeddingModelId: resolvedModelId,
    }) as Record<string, unknown>;

    const buildResult = buildResultRaw as unknown as BuildArtifactResult;
    const { cognitiveArtifact, mapperArtifact, enrichedClaims, parsedClaims, claimEmbeddings } = buildResult;

    // ── Persist claim embeddings ──
    const hashString = (input: string): string => {
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
        .map(
          (c) =>
            `${String(c?.id || '')}\u001f${String(c?.label || '')}\u001f${String(c?.text || '')}`
        )
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
      `[Regenerate] Embeddings ready: ${statementEmbeddings.size} stmts, ${paragraphEmbeddings.size} paras, ${claimEmbeddings?.size || 0
      } claims`
    );

    // ── Diagnostic ──
    console.log(
      `[Regenerate] Artifact diagnostics:`,
      `corpus.models=${(cognitiveArtifact?.corpus as { models?: unknown[] } | undefined)?.models?.length ?? 'missing'}`,
      `claimProvenance=${cognitiveArtifact?.claimProvenance ? 'present' : 'missing'}`,
      `basinInversion=${(cognitiveArtifact?.geometry as { basinInversion?: { status?: string } } | undefined)?.basinInversion
        ? (cognitiveArtifact.geometry as { basinInversion: { status?: string } }).basinInversion.status
        : 'missing'
      }`,
      `blastSurface=${cognitiveArtifact?.blastSurface ? 'present' : 'missing'}`
    );

    // ── Restore editorial AST from persisted editorial response ──
    try {
      const editorialResp =
        responsesForTurn
          .filter(
            (r) =>
              r &&
              r.responseType === 'editorial' &&
              normalizeProvId(r.providerId) === normalizeProvId(providerId)
          )
          .sort(
            (a, b) => ((b.updatedAt as number) || (b.createdAt as number) || 0) - ((a.updatedAt as number) || (a.createdAt as number) || 0)
          )[0] || null;

      if (
        editorialResp?.text &&
        mapperArtifact.claimDensity &&
        mapperArtifact.passageRouting &&
        mapperArtifact.statementClassification
      ) {
        const continuityMap = buildSourceContinuityMap(mapperArtifact.claimDensity as ClaimDensityResult);
        const { passages: idxPassages, unclaimed: idxUnclaimed } = buildPassageIndex(
          mapperArtifact.claimDensity as ClaimDensityResult,
          mapperArtifact.passageRouting as PassageRoutingResult,
          mapperArtifact.statementClassification as StatementClassificationResult,
          (mapperArtifact.corpus as any) ?? { models: [] },
          enrichedClaims,
          (mapperArtifact.citationSourceOrder as Record<string, string>) || {},
          continuityMap
        );

        const validPassageKeys = new Set(idxPassages.map((p: { passageKey: string }) => p.passageKey));
        const validUnclaimedKeys = new Set(idxUnclaimed.map((u: { groupKey: string }) => u.groupKey));
        const parsed = parseEditorialOutput(
          editorialResp.text as string,
          validPassageKeys,
          validUnclaimedKeys
        );

        if (parsed.success && parsed.ast) {
          cognitiveArtifact.editorialAST = parsed.ast;
          console.log(
            `[Regenerate] Editorial AST restored: ${(parsed.ast as { threads: unknown[] }).threads.length} thread(s)`
          );
        } else {
          console.warn('[Regenerate] Editorial re-parse failed:', parsed.errors);
        }
      }
    } catch (editorialErr) {
      console.warn(
        '[Regenerate] Editorial restore (non-blocking):',
        (editorialErr as { message?: string })?.message || editorialErr
      );
    }

    // ── Generate editorial AST if not restored from persistence ──────
    if (
      !cognitiveArtifact.editorialAST &&
      mapperArtifact.claimDensity &&
      mapperArtifact.passageRouting &&
      mapperArtifact.statementClassification
    ) {
      try {
        const orchestrator = services.get('orchestrator') as FaultTolerantOrchestrator | undefined;
        if (orchestrator) {
          const continuityMap = buildSourceContinuityMap(mapperArtifact.claimDensity as ClaimDensityResult);
          const { passages: idxPassages, unclaimed: idxUnclaimed } = buildPassageIndex(
            mapperArtifact.claimDensity as ClaimDensityResult,
            mapperArtifact.passageRouting as PassageRoutingResult,
            mapperArtifact.statementClassification as StatementClassificationResult,
            (mapperArtifact.corpus as any) ?? { models: [] },
            enrichedClaims,
            (mapperArtifact.citationSourceOrder as Record<string, string>) || {},
            continuityMap
          );

          const validPassageKeys = new Set(idxPassages.map((p: { passageKey: string }) => p.passageKey));
          const validUnclaimedKeys = new Set(idxUnclaimed.map((u: { groupKey: string }) => u.groupKey));

          const routePlan = (mapperArtifact.passageRouting as PassageRoutingResult | undefined)
            ?.routing?.routePlan;

          const editorialPrompt = buildEditorialPrompt(queryText, idxPassages, idxUnclaimed, {
            passageCount: idxPassages.length,
            claimCount: enrichedClaims.length,
            conflictCount: (mapperArtifact.passageRouting as { routing?: { conflictClusters?: unknown[] } } | undefined)?.routing?.conflictClusters?.length ?? 0,
            routePlanSummary: {
              includedCount: routePlan?.includedClaimIds?.length ?? 0,
              nonPrimaryCount: routePlan?.nonPrimaryClaimIds?.length ?? 0,
            },
          });

          // Thread continuation: prefer mapping cursor (semantic mapper's thread),
          // fall back to batch cursor, fall back to fresh conversation.
          const editorialProviderContexts = (() => {
            const mappingMeta = mappingResp?.meta as Record<string, unknown> | undefined;
            if (
              mappingMeta &&
              typeof mappingMeta === 'object' &&
              Object.keys(mappingMeta).length > 0
            ) {
              return { [providerId]: { meta: mappingMeta, continueThread: true } };
            }
            const batchResp = responsesForTurn.find(
              (r) =>
                r &&
                r.responseType === 'batch' &&
                normalizeProvId(r.providerId) === normalizeProvId(providerId)
            );
            const batchMeta = batchResp?.meta as Record<string, unknown> | undefined;
            if (batchMeta && typeof batchMeta === 'object' && Object.keys(batchMeta).length > 0) {
              return { [providerId]: { meta: batchMeta, continueThread: true } };
            }
            return {};
          })();

          const editorialResult = await new Promise<{ text: string; meta?: unknown }>((res) => {
            orchestrator.executeParallelFanout(editorialPrompt, [providerId], {
              sessionId: `regen-editorial-${aiTurnId}`,
              useThinking: false,
              providerContexts: editorialProviderContexts,
              onPartial: () => { },
              onAllComplete: async (results) => {
                const result = results?.get?.(providerId) as { text?: string; meta?: unknown } | undefined;
                if (result?.text) res({ text: result.text, meta: result.meta });
                else res({ text: '' });
              },
              onError: () => res({ text: '' }),
            });
          });

          if (editorialResult?.text) {
            const parsed = parseEditorialOutput(
              editorialResult.text,
              validPassageKeys,
              validUnclaimedKeys
            );
            if (parsed.success && parsed.ast) {
              cognitiveArtifact.editorialAST = parsed.ast;
              console.log(
                `[Regenerate] Editorial generated: ${(parsed.ast as { threads: unknown[] }).threads.length} thread(s)`
              );

              // Persist so future regens don't need another LLM call
              if (smAdapter) {
                try {
                  const now = Date.now();
                  await smAdapter.put('provider_responses', {
                    id: `pr-${aiTurnId}-${providerId}-editorial-0-${now}`,
                    sessionId: responsesForTurn[0]?.sessionId || '',
                    aiTurnId,
                    providerId,
                    responseType: 'editorial',
                    responseIndex: 0,
                    text: editorialResult.text,
                    status: 'completed',
                    meta: (editorialResult.meta as Record<string, unknown>) || {},
                    createdAt: now,
                    updatedAt: now,
                    completedAt: now,
                  });
                } catch (persistErr) {
                  console.warn('[Regenerate] Failed to persist editorial response:', persistErr);
                }
              }
            } else {
              console.warn('[Regenerate] Editorial parse failed:', parsed.errors);
            }
          }
        }
      } catch (editorialGenErr) {
        console.warn(
          '[Regenerate] Editorial generation (non-blocking):',
          (editorialGenErr as { message?: string })?.message || editorialGenErr
        );
      }
    }

    if (options.broadcast) {
      ConnectionHandler.broadcast({
        type: 'MAPPER_ARTIFACT_READY',
        aiTurnId,
        providerId,
        mapping: { artifact: cognitiveArtifact },
        embeddingModelId: resolvedModelId,
      });
    }

    return {
      success: true,
      data: {
        artifact: cognitiveArtifact,
        claimCount: enrichedClaims.length,
        edgeCount: (mapperArtifact.edges as unknown[] | undefined)?.length || 0,
      },
    };
  })().finally(() => {
    regenInflight.delete(cacheKey);
  });

  regenInflight.set(cacheKey, work);
  return work;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if ((request as Record<string, unknown>)?.$bus) return false;
  if ((request as Record<string, unknown>)?.__fromUnified) return false;
  if ((request as Record<string, unknown>)?.type === 'offscreen.heartbeat') {
    sendResponse({ alive: true });
    return true;
  }
  if ((request as Record<string, unknown>)?.type === 'htos.keepalive') {
    sendResponse({ success: true });
    return true;
  }
  if ((request as Record<string, unknown>)?.type === 'htos.activity') {
    try {
      const lm = services.get('lifecycleManager') as { recordActivity?: () => void } | undefined;
      if (lm && typeof lm.recordActivity === 'function') {
        lm.recordActivity();
      }
    } catch (e) {
      console.warn('[SW] htos.activity handler failed:', e);
    }
    sendResponse({ success: true });
    return true;
  }
  if ((request as Record<string, unknown>)?.type === 'GET_HEALTH_STATUS') {
    // Return health
    const health = { serviceWorker: 'active', registry: Array.from(services.services.keys()) };
    sendResponse({ success: true, status: health });
    return true;
  }
  if ((request as Record<string, unknown>)?.type) {
    handleUnifiedMessage(request as Record<string, unknown>, sender, sendResponse).catch((err) => {
      try {
        sendResponse({ success: false, error: getErrorMessage(err) });
      } catch (e) {
        console.warn('[SW] sendResponse after channel close:', e);
      }
    });
    return true;
  }
  return false;
});

// ============================================================================
// PORT CONNECTIONS
// ============================================================================
chrome.runtime.onConnect.addListener(async (port) => {
  if (port.name !== 'htos-popup') return;
  console.log('[SW] New connection...');
  try {
    const handler = new ConnectionHandler(port, () => initializeGlobalServices());
    await handler.init();
    console.log('[SW] Connection handler ready');
  } catch (error) {
    logInfraError('SW: Failed to initialize connection handler', error);
    try {
      port.postMessage({ type: 'INITIALIZATION_FAILED', error: getErrorMessage(error) });
    } catch (e) {
      console.warn('[SW] Failed to send INITIALIZATION_FAILED to port:', e);
    }
  }
});

chrome.action?.onClicked.addListener(async () => {
  const url = chrome.runtime.getURL('ui/index.html');
  try {
    const urlPatterns = [url, `${url}*`];
    const existing = await chrome.tabs.query({ url: urlPatterns });
    const tab = Array.isArray(existing) && existing.length > 0 ? existing[0] : null;
    if (tab && typeof tab.id === 'number') {
      if (typeof tab.windowId === 'number') {
        try {
          await chrome.windows.update(tab.windowId, { focused: true });
        } catch (e) { logInfraError('SW: chrome.windows.update failed', e); }
      }
      await chrome.tabs.update(tab.id, { active: true });
      return;
    }
  } catch (e) { logInfraError('SW: chrome.tabs.query failed', e); }
  await chrome.tabs.create({ url });
});

// ============================================================================
// MAIN BOOTSTRAP
// ============================================================================

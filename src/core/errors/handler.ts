/**
 * HTOS Error Handler with Fallback Mechanisms
 * Provides comprehensive error handling, recovery strategies, and fallback mechanisms
 */

import { persistenceMonitor } from '../persistence-monitor';
import { classifyError, isRateLimitError, isNetworkError, isProviderAuthError } from './classifier';
import { getPolicy } from './retry';
import { HTOSError, ProviderAuthError, type HTOSErrorCode } from '../../../shared/types/provider';

// ============================================================
// Inline types to avoid contract.ts dependencies
// ============================================================

interface ProviderConfigEntry {
  displayName: string;
  loginUrl: string;
  maxInputChars: number;
}

interface RetryPolicy {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  jitter: boolean;
}

type FallbackStrategy = (operation: unknown, context: Record<string, unknown>) => Promise<unknown>;

interface RecoveryStrategy {
  name: string;
  execute: (error: HTOSError, context: Record<string, unknown>) => Promise<unknown>;
}

type OperationFn = (context: Record<string, unknown>) => Promise<unknown>;

// ============================================================
// Provider configuration
// ============================================================

export const PROVIDER_CONFIG: Record<string, ProviderConfigEntry> = {
  claude: {
    displayName: 'Claude',
    loginUrl: 'https://claude.ai',
    maxInputChars: 100000,
  },
  chatgpt: {
    displayName: 'ChatGPT',
    loginUrl: 'https://chatgpt.com',
    maxInputChars: 32000,
  },
  gemini: {
    displayName: 'Gemini',
    loginUrl: 'https://gemini.google.com',
    maxInputChars: 30000,
  },
  'gemini-pro': {
    displayName: 'Gemini Pro',
    loginUrl: 'https://gemini.google.com',
    maxInputChars: 120000,
  },
  'gemini-exp': {
    displayName: 'Gemini 2.0',
    loginUrl: 'https://gemini.google.com',
    maxInputChars: 30000,
  },
  qwen: {
    displayName: 'Qwen',
    loginUrl: 'https://qianwen.com',
    maxInputChars: 30000,
  },
  grok: {
    displayName: 'Grok',
    loginUrl: 'https://grok.com',
    maxInputChars: 120000,
  },
};

// ============================================================
// Provider auth error factory
// ============================================================

export function createProviderAuthError(
  providerId: string,
  originalError: unknown,
  context: Record<string, unknown> = {}
): ProviderAuthError {
  const config = PROVIDER_CONFIG[providerId] || { displayName: providerId, loginUrl: '' };
  const errorObj = originalError as Record<string, unknown> | null;
  return new ProviderAuthError(providerId, undefined, {
    ...context,
    displayName: config.displayName,
    loginUrl: config.loginUrl,
    originalError,
    originalMessage: errorObj?.message,
    originalStatus: errorObj?.status,
  });
}

export function createMultiProviderAuthError(
  providerIds: string[] | null | undefined,
  context = ''
): HTOSError | null {
  if (!providerIds?.length) return null;

  if (providerIds.length === 1) {
    const pid = providerIds[0];
    const cfg = PROVIDER_CONFIG[pid] || { displayName: pid, loginUrl: '' };
    return new ProviderAuthError(pid, undefined, { displayName: cfg.displayName, loginUrl: cfg.loginUrl });
  }

  const lines = providerIds.map((pid) => {
    const config = PROVIDER_CONFIG[pid] || { displayName: pid, loginUrl: '' };
    return `• ${config.displayName}: ${config.loginUrl}`;
  });

  const message = context
    ? `${context}\n\nPlease log in to:\n${lines.join('\n')}`
    : `Multiple providers need authentication:\n${lines.join('\n')}`;

  return new HTOSError(
    message,
    'MULTI_AUTH_REQUIRED',
    {
      providerIds,
      loginUrls: providerIds.map((pid) => PROVIDER_CONFIG[pid]?.loginUrl),
    },
    false
  );
}

// ============================================================
// Standalone utility functions (for direct import)
// ============================================================

/**
 * Extract a user-friendly error message from any error type
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof HTOSError) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  const errorObj = error as Record<string, unknown> | null;
  if (errorObj?.message && typeof errorObj.message === 'string') {
    return errorObj.message;
  }

  return String(error);
}

/**
 * Standalone normalizeError function for direct import
 * Creates an HTOSError from any error type with appropriate classification
 */
export function normalizeError(error: unknown, context: Record<string, unknown> = {}): HTOSError {
  // Already an HTOS error
  if (error instanceof HTOSError) {
    return error;
  }

  const errorObj = error as Record<string, unknown> | null;
  let code: HTOSErrorCode = 'UNKNOWN_ERROR';
  let recoverable = true;

  // Check for provider auth errors first
  if (isProviderAuthError(error)) {
    code = 'AUTH_REQUIRED';
    recoverable = false;
  } else if (isRateLimitError(error)) {
    code = 'RATE_LIMITED';
    recoverable = true;
  } else if (isNetworkError(error)) {
    code = 'NETWORK_ERROR';
    recoverable = true;
  }
  // Categorize common errors
  else if (errorObj?.name === 'QuotaExceededError') {
    code = 'STORAGE_QUOTA_EXCEEDED';
    recoverable = false;
  } else if (errorObj?.name === 'InvalidStateError') {
    code = 'INVALID_STATE';
  } else if (errorObj?.name === 'NotFoundError') {
    code = 'NOT_FOUND';
  } else if (errorObj?.name === 'NetworkError') {
    code = 'NETWORK_ERROR';
  } else if (errorObj?.name === 'TimeoutError') {
    code = 'TIMEOUT';
  } else if (typeof errorObj?.message === 'string' && errorObj.message.includes('IndexedDB')) {
    code = 'INDEXEDDB_ERROR';
  } else if (typeof errorObj?.message === 'string' && errorObj.message.includes('Service Worker')) {
    code = 'SERVICE_WORKER_ERROR';
  } else if (
    (typeof errorObj?.message === 'string' && errorObj.message.includes('INPUT_TOO_LONG')) ||
    errorObj?.code === 'INPUT_TOO_LONG'
  ) {
    code = 'INPUT_TOO_LONG';
    recoverable = false;
  }

  return new HTOSError(
    (errorObj?.message as string) || String(error),
    code,
    { ...context, originalError: error },
    recoverable
  );
}

// ============================================================
// ErrorHandler class
// ============================================================

export class ErrorHandler {
  fallbackStrategies: Map<string, FallbackStrategy>;
  retryPolicies: Map<string, RetryPolicy>;
  errorCounts: Map<string, number>;

  constructor() {
    this.fallbackStrategies = new Map();
    this.retryPolicies = new Map();
    this.errorCounts = new Map();

    this.setupDefaultStrategies();
    this.setupDefaultRetryPolicies();
    this.setupProviderStrategies();
  }

  setupProviderStrategies(): void {
    this.retryPolicies.set('PROVIDER_RATE_LIMIT', getPolicy('RATE_LIMIT').toLegacyShape());
  }

  setupDefaultStrategies(): void {
    this.fallbackStrategies.set('PROVIDER_AUTH_FAILED', async (_operation, context) => {
      const { failedProvider, availableProviders, authManager } = context;

      console.warn(`🔄 Provider ${failedProvider} auth failed, checking alternatives`);

      if (!Array.isArray(availableProviders) || !availableProviders.length || !authManager) {
        throw createProviderAuthError(failedProvider as string, null);
      }

      const authStatus = await (
        authManager as { getAuthStatus: () => Promise<Record<string, boolean>> }
      ).getAuthStatus();

      const fallbackProvider = (availableProviders as string[]).find(
        (pid) => pid !== failedProvider && authStatus[pid] === true
      );

      if (fallbackProvider) {
        console.log(`🔄 Falling back to ${fallbackProvider}`);
        return { fallbackProvider, authStatus };
      }

      throw createProviderAuthError(failedProvider as string, null);
    });

    this.fallbackStrategies.set('INDEXEDDB_UNAVAILABLE', async (operation, context) => {
      console.warn('🔄 Falling back to localStorage for:', operation);

      try {
        switch (operation) {
          case 'save':
            return this.saveToLocalStorage(context.key as string, context.data);
          case 'load':
            return this.loadFromLocalStorage(context.key as string);
          case 'delete':
            return this.deleteFromLocalStorage(context.key as string);
          case 'list':
            return this.listFromLocalStorage(context.prefix as string);
          default:
            throw new HTOSError('Unsupported fallback operation', 'FALLBACK_UNSUPPORTED');
        }
      } catch (error) {
        throw new HTOSError('Fallback strategy failed', 'FALLBACK_FAILED', {
          originalError: error,
        });
      }
    });

    this.fallbackStrategies.set('NETWORK_UNAVAILABLE', async (operation, context) => {
      console.warn('🔄 Falling back to cache for network operation:', operation);

      const cacheKey = `htos_cache_${context.url || context.key}`;
      const cached = localStorage.getItem(cacheKey);

      if (cached) {
        try {
          return JSON.parse(cached) as unknown;
        } catch (parseError) {
          throw new HTOSError('Cached data corrupted', 'CACHE_CORRUPTED', {
            parseError,
          });
        }
      }

      throw new HTOSError('No cached data available', 'NO_CACHE_AVAILABLE');
    });

    this.fallbackStrategies.set('SERVICE_WORKER_UNAVAILABLE', async (operation, context) => {
      console.warn('🔄 Falling back to direct operation (no service worker):', operation);

      switch (operation) {
        case 'persistence':
          return this.directPersistenceOperation(context);
        case 'session':
          return this.directSessionOperation(context);
        default:
          throw new HTOSError('Direct operation not supported', 'DIRECT_UNSUPPORTED');
      }
    });
  }

  setupDefaultRetryPolicies(): void {
    this.retryPolicies.set('STANDARD', getPolicy('NETWORK').toLegacyShape());

    this.retryPolicies.set('CRITICAL', {
      maxRetries: 5,
      baseDelay: 500,
      maxDelay: 5000,
      backoffMultiplier: 1.5,
      jitter: true,
    });

    this.retryPolicies.set('CONSERVATIVE', getPolicy('NETWORK_CONSERVATIVE').toLegacyShape());
  }

  async handleError(error: unknown, context: Record<string, unknown> = {}): Promise<unknown> {
    const htosError = this.normalizeError(error, context);

    persistenceMonitor.recordError(htosError, context);
    this.incrementErrorCount(htosError.code);

    if (htosError.recoverable) {
      try {
        return await this.attemptRecovery(htosError, context);
      } catch (recoveryError) {
        console.error('🚨 Recovery failed:', recoveryError);
      }
    }

    throw htosError;
  }

  /**
   * Instance method that delegates to standalone function
   */
  normalizeError(error: unknown, context: Record<string, unknown> = {}): HTOSError {
    return normalizeError(error, context);
  }

  async attemptRecovery(error: HTOSError, context: Record<string, unknown>): Promise<unknown> {
    const strategy = this.getRecoveryStrategy(error.code);

    if (strategy) {
      console.log(`🔧 Attempting recovery for ${error.code} using strategy:`, strategy.name);
      return await strategy.execute(error, context);
    }

    const fallbackStrategy = this.getFallbackStrategy(error.code);
    if (fallbackStrategy) {
      console.log(`🔄 Using fallback strategy for ${error.code}`);
      return await fallbackStrategy(context.operation, context);
    }

    throw new HTOSError('No recovery strategy available', 'NO_RECOVERY_STRATEGY', {
      originalError: error,
    });
  }

  getRecoveryStrategy(errorCode: HTOSErrorCode): RecoveryStrategy | undefined {
    const strategies: Record<string, RecoveryStrategy> = {
      AUTH_REQUIRED: {
        name: 'Provider Auth Recovery',
        execute: async (error, context) => {
          if (context.authManager && context.providerId) {
            const authManager = context.authManager as {
              markUnauthenticated: (pid: string) => Promise<void>;
            };
            await authManager.markUnauthenticated(context.providerId as string);
          }
          throw error;
        },
      },

      RATE_LIMITED: {
        name: 'Rate Limit Recovery',
        execute: async (_error, context) => {
          console.log(`⏳ Rate limited by ${context.providerId}, waiting...`);
          return await this.retryWithBackoff(
            context.operation as OperationFn,
            context,
            'PROVIDER_RATE_LIMIT'
          );
        },
      },

      INDEXEDDB_ERROR: {
        name: 'IndexedDB Recovery',
        execute: async (error, context) => {
          if (context.reinitialize) {
            await (context.reinitialize as () => Promise<unknown>)();
            return await (context.retry as () => Promise<unknown>)();
          }
          throw error;
        },
      },

      TIMEOUT: {
        name: 'Timeout Recovery',
        execute: async (_error, context) => {
          const newContext = {
            ...context,
            timeout: ((context.timeout as number) || 5000) * 2,
          };
          return await this.retryWithBackoff(
            context.operation as OperationFn,
            newContext,
            'CONSERVATIVE'
          );
        },
      },
    };

    return strategies[errorCode];
  }

  getFallbackStrategy(errorCode: HTOSErrorCode): FallbackStrategy | null {
    const fallbackMap: Record<string, string> = {
      INDEXEDDB_ERROR: 'INDEXEDDB_UNAVAILABLE',
      INDEXEDDB_UNAVAILABLE: 'INDEXEDDB_UNAVAILABLE',
      NETWORK_ERROR: 'NETWORK_UNAVAILABLE',
      SERVICE_WORKER_ERROR: 'SERVICE_WORKER_UNAVAILABLE',
    };

    const fallbackKey = fallbackMap[errorCode];
    return fallbackKey ? (this.fallbackStrategies.get(fallbackKey) ?? null) : null;
  }

  async retryWithBackoff(
    operation: OperationFn,
    context: Record<string, unknown>,
    policyName = 'STANDARD'
  ): Promise<unknown> {
    const policy = this.retryPolicies.get(policyName);
    if (!policy) {
      throw new HTOSError(`Retry policy '${policyName}' not found`, 'INVALID_RETRY_POLICY', {
        policyName,
      });
    }
    let lastError: unknown;

    for (let attempt = 0; attempt < policy.maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          const delay = this.calculateDelay(attempt, policy);
          console.log(`⏳ Retrying in ${delay}ms (attempt ${attempt + 1}/${policy.maxRetries})`);
          await this.sleep(delay);
        }

        return await operation(context);
      } catch (error) {
        const classified = classifyError(error);
        if (!classified.retryable) {
          console.warn(`[ErrorHandler] Non-retryable error in ${policyName}; aborting retry loop`);
          throw error;
        }
        lastError = error;
        console.warn(`❌ Attempt ${attempt + 1} failed:`, (error as { message?: string })?.message);
      }
    }

    throw new HTOSError('All retry attempts failed', 'RETRY_EXHAUSTED', {
      attempts: policy.maxRetries,
      lastError,
    });
  }

  calculateDelay(attempt: number, policy: RetryPolicy): number {
    let delay = policy.baseDelay * Math.pow(policy.backoffMultiplier, attempt);
    delay = Math.min(delay, policy.maxDelay);

    if (policy.jitter) {
      delay = delay * (0.5 + Math.random() * 0.5);
    }

    return Math.floor(delay);
  }

  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  incrementErrorCount(errorCode: string): void {
    const count = this.errorCounts.get(errorCode) || 0;
    this.errorCounts.set(errorCode, count + 1);
  }

  async saveToLocalStorage(key: string, data: unknown): Promise<{ success: true; fallback: true }> {
    try {
      const serialized = JSON.stringify(data);
      localStorage.setItem(`htos_fallback_${key}`, serialized);
      return { success: true, fallback: true };
    } catch (error) {
      throw new HTOSError('localStorage save failed', 'LOCALSTORAGE_SAVE_FAILED', { error });
    }
  }

  async loadFromLocalStorage(key: string): Promise<unknown> {
    try {
      const data = localStorage.getItem(`htos_fallback_${key}`);
      return data ? (JSON.parse(data) as unknown) : null;
    } catch (error) {
      throw new HTOSError('localStorage load failed', 'LOCALSTORAGE_LOAD_FAILED', { error });
    }
  }

  async deleteFromLocalStorage(key: string): Promise<{ success: true; fallback: true }> {
    try {
      localStorage.removeItem(`htos_fallback_${key}`);
      return { success: true, fallback: true };
    } catch (error) {
      throw new HTOSError('localStorage delete failed', 'LOCALSTORAGE_DELETE_FAILED', { error });
    }
  }

  async listFromLocalStorage(prefix: string): Promise<string[]> {
    try {
      const keys: string[] = [];
      const fullPrefix = `htos_fallback_${prefix}`;

      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(fullPrefix)) {
          keys.push(key.substring(fullPrefix.length));
        }
      }

      return keys;
    } catch (error) {
      throw new HTOSError('localStorage list failed', 'LOCALSTORAGE_LIST_FAILED', { error });
    }
  }

  async directPersistenceOperation(_context: Record<string, unknown>): Promise<never> {
    throw new HTOSError('Direct persistence not implemented', 'DIRECT_PERSISTENCE_NOT_IMPLEMENTED');
  }

  async directSessionOperation(_context: Record<string, unknown>): Promise<never> {
    throw new HTOSError(
      'Direct session management not implemented',
      'DIRECT_SESSION_NOT_IMPLEMENTED'
    );
  }

  async handleProviderError(
    error: unknown,
    providerId: string,
    context: Record<string, unknown> = {}
  ): Promise<unknown> {
    const htosError = this.normalizeError(error, {
      ...context,
      providerId,
    });

    persistenceMonitor.recordError(htosError, { providerId, ...context });
    this.incrementErrorCount(`${providerId}_${htosError.code}`);

    if (htosError.code === 'AUTH_REQUIRED') {
      throw createProviderAuthError(providerId, error, context);
    }

    if (htosError.code === 'RATE_LIMITED') {
      throw htosError;
    }

    if (htosError.recoverable) {
      try {
        return await this.attemptRecovery(htosError, { ...context, providerId });
      } catch (recoveryError) {
        if (recoveryError instanceof HTOSError && recoveryError.code === 'NO_RECOVERY_STRATEGY') {
          throw htosError;
        }
        throw recoveryError;
      }
    }

    throw htosError;
  }

  getProviderErrorStats(providerId: string): {
    providerId: string;
    errors: Record<string, number>;
  } {
    const prefix = `${providerId}_`;
    const stats: { providerId: string; errors: Record<string, number> } = {
      providerId,
      errors: {},
    };

    for (const [code, count] of Array.from(this.errorCounts.entries())) {
      if (code.startsWith(prefix)) {
        stats.errors[code.substring(prefix.length)] = count;
      }
    }

    return stats;
  }

  getErrorStats(): {
    totalErrors: number;
    errorsByCode: Record<string, number>;
  } {
    const stats: { totalErrors: number; errorsByCode: Record<string, number> } = {
      totalErrors: 0,
      errorsByCode: {},
    };

    for (const [code, count] of Array.from(this.errorCounts.entries())) {
      stats.errorsByCode[code] = count;
      stats.totalErrors += count;
    }

    return stats;
  }

  reset(): void {
    this.errorCounts.clear();
    console.log('🔄 Error handler reset');
  }
}

// Create global instance
export const errorHandler = new ErrorHandler();

// Make it available globally for debugging
if (typeof globalThis !== 'undefined') {
  (globalThis as Record<string, unknown>).__HTOS_ERROR_HANDLER = errorHandler;
}

export default errorHandler;

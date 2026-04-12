// ============================================================================
// PROVIDER TYPES — src error handling → UI state boundary
// ============================================================================

export type ProviderKey = 'claude' | 'gemini' | 'gemini-pro' | 'gemini-exp' | 'chatgpt' | 'qwen';

/**
 * Error classification for user-facing messaging and retry logic
 */
export type ProviderErrorType =
  | 'rate_limit' // 429 - Retryable after cooldown
  | 'auth_expired' // 401/403 - Requires re-login
  | 'timeout' // Request took too long - Retryable
  | 'circuit_open' // Too many recent failures - Auto-retry later
  | 'content_filter' // Response blocked by provider - Not retryable
  | 'input_too_long' // Input exceeds provider limit - Not retryable
  | 'network' // Connection failed - Retryable
  | 'unknown'; // Catch-all - Maybe retryable

export interface ProviderError {
  type: ProviderErrorType;
  message: string;
  retryable: boolean;
  retryAfterMs?: number; // For rate limits
  requiresReauth?: boolean; // For auth errors
}

// ============ Runtime Error Classes ============

export type HTOSErrorCode =
  | 'AUTH_REQUIRED'
  | 'MULTI_AUTH_REQUIRED'
  | 'RATE_LIMITED'
  | 'NETWORK_ERROR'
  | 'STORAGE_QUOTA_EXCEEDED'
  | 'INVALID_STATE'
  | 'NOT_FOUND'
  | 'TIMEOUT'
  | 'INDEXEDDB_ERROR'
  | 'INDEXEDDB_UNAVAILABLE'
  | 'SERVICE_WORKER_ERROR'
  | 'INPUT_TOO_LONG'
  | 'UNKNOWN_ERROR'
  | 'CIRCUIT_BREAKER_OPEN'
  | 'FALLBACK_UNSUPPORTED'
  | 'FALLBACK_FAILED'
  | 'CACHE_CORRUPTED'
  | 'NO_CACHE_AVAILABLE'
  | 'DIRECT_UNSUPPORTED'
  | 'NO_RECOVERY_STRATEGY'
  | 'INVALID_RETRY_POLICY'
  | 'RETRY_EXHAUSTED'
  | 'LOCALSTORAGE_SAVE_FAILED'
  | 'LOCALSTORAGE_LOAD_FAILED'
  | 'LOCALSTORAGE_DELETE_FAILED'
  | 'LOCALSTORAGE_LIST_FAILED'
  | 'DIRECT_PERSISTENCE_NOT_IMPLEMENTED'
  | 'DIRECT_SESSION_NOT_IMPLEMENTED';

export class HTOSError extends Error {
  name: string;
  code: HTOSErrorCode;
  context: Record<string, unknown>;
  recoverable: boolean;
  timestamp: number;
  id: string;

  constructor(
    message: string,
    code: HTOSErrorCode,
    context: Record<string, unknown> = {},
    recoverable = true
  ) {
    super(message);
    this.name = 'HTOSError';
    this.code = code;
    this.context = context;
    this.recoverable = recoverable;
    this.timestamp = Date.now();
    this.id = `error_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  }

  get details(): Record<string, unknown> {
    return this.context;
  }

  toJSON(): Record<string, unknown> {
    return {
      id: this.id,
      name: this.name,
      message: this.message,
      code: this.code,
      context: this.context,
      recoverable: this.recoverable,
      timestamp: this.timestamp,
      stack: this.stack,
    };
  }
}

export class ProviderAuthError extends HTOSError {
  providerId: string;
  loginUrl: string;

  constructor(providerId: string, message?: string | null, context: Record<string, unknown> = {}) {
    const displayName = (context.displayName as string) || providerId;
    const loginUrl = (context.loginUrl as string) || '';

    super(
      message || `${displayName} session expired. Please log in${loginUrl ? ` at ${loginUrl}` : ''}`,
      'AUTH_REQUIRED',
      { ...context, providerId, loginUrl, displayName },
      false
    );

    this.name = 'ProviderAuthError';
    this.providerId = providerId;
    this.loginUrl = loginUrl;
  }
}

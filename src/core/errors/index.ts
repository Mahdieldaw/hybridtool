// Consolidated error handling and retry logic barrel export

// Classifier: predicates and display helpers
export {
  classifyError,
  formatRetryAfter,
  ERROR_DISPLAY_TEXT,
  isProviderAuthError,
  isDefinitiveAuthError,
  isRateLimitError,
  isNetworkError,
} from './classifier';

// Handler: factory functions, error handler class, provider config
export {
  errorHandler,
  createProviderAuthError,
  createMultiProviderAuthError,
  getErrorMessage,
  normalizeError,
  ErrorHandler,
  PROVIDER_CONFIG,
} from './handler';

// Error classes live in shared/types so UI and shared code can import them
// without pulling in core/errors. Re-exported here for convenience.
export { HTOSError, ProviderAuthError, type HTOSErrorCode } from '../../../shared/types/provider';

// Retry: policy, telemetry, orchestration (consolidated)
export {
  getPolicy,
  policyForErrorType,
  computeBackoffMs,
  retryWithPolicy,
  logRetryEvent,
  type RetryPolicy,
  type RetryPolicyName,
  type RetryContext,
  type RetryEvent,
} from './retry';

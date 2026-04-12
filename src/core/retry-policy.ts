import type { ProviderErrorType } from '../../shared/contract';

export type RetryPolicyName = 'COLD_START' | 'NETWORK' | 'NETWORK_CONSERVATIVE' | 'RATE_LIMIT';

export interface RetryPolicy {
  name: RetryPolicyName;
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  multiplier: number;
  jitter: boolean;
  delayOverrides?: Record<string, number>;
  retryableTypes: readonly ProviderErrorType[];
  honorRetryAfter: boolean;
  toLegacyShape(): {
    maxRetries: number;
    baseDelay: number;
    maxDelay: number;
    backoffMultiplier: number;
    jitter: boolean;
  };
}

type RetryPolicyConfig = Omit<RetryPolicy, 'toLegacyShape'>;

function makePolicy(config: RetryPolicyConfig): RetryPolicy {
  return {
    ...config,
    toLegacyShape() {
      return {
        maxRetries: Math.max(0, config.maxAttempts - 1),
        baseDelay: config.baseDelayMs,
        maxDelay: config.maxDelayMs,
        backoffMultiplier: config.multiplier,
        jitter: config.jitter,
      };
    },
  };
}

function getEnvNumber(name: string): number | undefined {
  const root = typeof globalThis !== 'undefined' ? (globalThis as any) : {};
  const env = root?.process?.env || {};
  if (!Object.prototype.hasOwnProperty.call(env, name)) return undefined;
  const raw = env[name];
  const parsed = parseInt(String(raw), 10);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.max(0, Math.floor(parsed));
}

const coldStartOverrides = {
  maxAttempts: getEnvNumber('HTOS_GEMINI_COLD_START_MAX_RETRIES'),
  baseDelayMs: getEnvNumber('HTOS_GEMINI_COLD_START_BACKOFF_BASE_MS'),
  maxDelayMs: getEnvNumber('HTOS_GEMINI_COLD_START_BACKOFF_MAX_MS'),
  multiplier: getEnvNumber('HTOS_GEMINI_COLD_START_BACKOFF_MULTIPLIER'),
  jitterRaw: getEnvNumber('HTOS_GEMINI_COLD_START_BACKOFF_JITTER'),
  coldEventWindowMs: getEnvNumber('HTOS_GEMINI_COLD_START_RETRY_DELAY_MS'),
};

const POLICY_TABLE: Record<RetryPolicyName, RetryPolicy> = {
  COLD_START: makePolicy({
    name: 'COLD_START',
    maxAttempts: coldStartOverrides.maxAttempts ?? 6,
    baseDelayMs: coldStartOverrides.baseDelayMs ?? 750,
    maxDelayMs: coldStartOverrides.maxDelayMs ?? 5000,
    multiplier: coldStartOverrides.multiplier ?? 2,
    jitter: (coldStartOverrides.jitterRaw ?? 1) > 0,
    delayOverrides: {
      cold_event_window: coldStartOverrides.coldEventWindowMs ?? 10000,
    },
    retryableTypes: ['unknown', 'network', 'timeout'],
    honorRetryAfter: false,
  }),
  NETWORK: makePolicy({
    name: 'NETWORK',
    maxAttempts: 4,
    baseDelayMs: 1000,
    maxDelayMs: 10000,
    multiplier: 2,
    jitter: true,
    retryableTypes: ['network', 'timeout', 'unknown'],
    honorRetryAfter: false,
  }),
  NETWORK_CONSERVATIVE: makePolicy({
    name: 'NETWORK_CONSERVATIVE',
    maxAttempts: 3,
    baseDelayMs: 2000,
    maxDelayMs: 15000,
    multiplier: 3,
    jitter: false,
    retryableTypes: ['network', 'timeout', 'unknown'],
    honorRetryAfter: false,
  }),
  RATE_LIMIT: makePolicy({
    name: 'RATE_LIMIT',
    maxAttempts: 3,
    baseDelayMs: 5000,
    maxDelayMs: 30000,
    multiplier: 2,
    jitter: true,
    retryableTypes: ['rate_limit'],
    honorRetryAfter: true,
  }),
};

export function getPolicy(name: RetryPolicyName): RetryPolicy {
  return POLICY_TABLE[name];
}

export function policyForErrorType(type: ProviderErrorType): RetryPolicy | null {
  if (type === 'rate_limit') return POLICY_TABLE.RATE_LIMIT;
  if (type === 'network' || type === 'timeout' || type === 'unknown') {
    return POLICY_TABLE.NETWORK;
  }
  return null;
}

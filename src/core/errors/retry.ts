import { classifyError } from './classifier';
import type { ProviderErrorType } from '../../../shared/types';

// ============ Policy ============

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

// ============ Telemetry ============

export interface RetryEvent {
  providerId: string;
  stage: string;
  attempt: number;
  max: number;
  errorType: string;
  elapsedMs: number;
  delayMs: number;
  model?: string;
}

export function logRetryEvent(event: RetryEvent): void {
  console.warn('[retry]', JSON.stringify(event));
}

// ============ Orchestration ============

export interface RetryContext {
  providerId: string;
  stage: string;
  model?: string;
  signal?: AbortSignal;
}

export function computeBackoffMs(
  policy: RetryPolicy,
  attempt: number,
  retryAfterMs?: number,
  retryStage?: string
): number {
  const stageOverride =
    retryStage && policy.delayOverrides ? policy.delayOverrides[retryStage] : undefined;
  if (typeof stageOverride === 'number' && Number.isFinite(stageOverride) && stageOverride >= 0) {
    return Math.floor(stageOverride);
  }
  if (
    policy.honorRetryAfter &&
    typeof retryAfterMs === 'number' &&
    Number.isFinite(retryAfterMs) &&
    retryAfterMs > 0
  ) {
    return Math.floor(retryAfterMs);
  }
  const exponent = Math.max(0, attempt - 1);
  const base = Math.max(0, policy.baseDelayMs);
  const max = Math.max(base, policy.maxDelayMs);
  const multiplier = Math.max(1, policy.multiplier);
  const rawDelay = Math.min(max, Math.floor(base * Math.pow(multiplier, exponent)));
  if (!policy.jitter) return rawDelay;
  const jitterFactor = 0.5 + Math.random() * 0.5;
  return Math.floor(rawDelay * jitterFactor);
}

function getRetryStage(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const candidate = error as {
    stage?: unknown;
    details?: { stage?: unknown };
  };
  if (typeof candidate.stage === 'string' && candidate.stage.length > 0) {
    return candidate.stage;
  }
  if (typeof candidate.details?.stage === 'string' && candidate.details.stage.length > 0) {
    return candidate.details.stage;
  }
  return undefined;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export async function retryWithPolicy<T>(
  fn: () => Promise<T>,
  context: RetryContext,
  policyName?: RetryPolicyName
): Promise<T> {
  const startedAt = Date.now();
  let attempt = 1;
  while (true) {
    try {
      return await fn();
    } catch (error) {
      const classified = classifyError(error);
      if (!classified.retryable) {
        throw error;
      }
      const retryStage = getRetryStage(error);
      const policy = policyName ? getPolicy(policyName) : policyForErrorType(classified.type);
      if (!policy) {
        throw error;
      }
      if (attempt >= policy.maxAttempts) {
        throw error;
      }
      const delayMs = computeBackoffMs(policy, attempt, classified.retryAfterMs, retryStage);
      logRetryEvent({
        providerId: context.providerId,
        stage: retryStage || context.stage,
        attempt,
        max: policy.maxAttempts,
        errorType: classified.type,
        elapsedMs: Date.now() - startedAt,
        delayMs,
        model: context.model,
      });
      await sleep(delayMs, context.signal);
      attempt += 1;
    }
  }
}

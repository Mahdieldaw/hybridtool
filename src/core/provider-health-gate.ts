import { classifyError } from './errors/classifier';
import { logRetryEvent } from './errors/retry';

export interface RunWithHealthOptions {
  nonBlocking?: boolean;
  model?: string;
}

type HealthCheckResult = {
  allowed: boolean;
  reason?: string;
  retryAfterMs?: number;
};

type HealthTrackerLike = {
  shouldAttempt?: (providerId: string) => HealthCheckResult;
  recordSuccess?: (providerId: string) => void;
  recordFailure?: (providerId: string, error: unknown) => void;
};

function createBlockedError(providerId: string, stage: string, check: HealthCheckResult): Error {
  const reason = check.reason || 'circuit_open';
  const error = new Error(`[StepExecutor] ${stage} skipped for ${providerId}: ${reason}`);
  (error as any).providerId = providerId;
  (error as any).reason = reason;
  if (typeof check.retryAfterMs === 'number') {
    (error as any).retryAfterMs = check.retryAfterMs;
  }
  if (reason === 'auth_invalid') {
    (error as any).code = 'AUTH_REQUIRED';
  } else if (reason === 'rate_limited') {
    (error as any).code = 'RATE_LIMITED';
  } else {
    (error as any).code = 'CIRCUIT_BREAKER_OPEN';
  }
  return error;
}

function mapReasonToErrorType(reason?: string): string {
  if (reason === 'auth_invalid') return 'auth_expired';
  if (reason === 'rate_limited') return 'rate_limit';
  return 'circuit_open';
}

export async function runWithProviderHealth<T>(
  tracker: HealthTrackerLike | undefined,
  providerId: string,
  stage: string,
  fn: () => Promise<T>,
  options?: RunWithHealthOptions
): Promise<T | undefined> {
  const startedAt = Date.now();
  const check = tracker?.shouldAttempt?.(providerId);
  if (check && !check.allowed) {
    if (!options?.nonBlocking) {
      throw createBlockedError(providerId, stage, check);
    }
    logRetryEvent({
      providerId,
      stage,
      attempt: 1,
      max: 1,
      errorType: mapReasonToErrorType(check.reason),
      elapsedMs: 0,
      delayMs: typeof check.retryAfterMs === 'number' ? Math.max(0, check.retryAfterMs) : 0,
      model: options?.model,
    });
    return undefined;
  }

  try {
    const result = await fn();
    tracker?.recordSuccess?.(providerId);
    return result;
  } catch (error) {
    const classified = classifyError(error);
    tracker?.recordFailure?.(providerId, error);
    logRetryEvent({
      providerId,
      stage,
      attempt: 1,
      max: 1,
      errorType: classified.type,
      elapsedMs: Date.now() - startedAt,
      delayMs: 0,
      model: options?.model,
    });
    throw error;
  }
}

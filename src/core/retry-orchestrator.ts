import { classifyError } from './error-classifier';
import { logRetryEvent } from './retry-telemetry';
import {
  getPolicy,
  policyForErrorType,
  type RetryPolicy,
  type RetryPolicyName,
} from './retry-policy';

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

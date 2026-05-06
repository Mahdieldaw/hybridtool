/**
 * Tests for ProviderHealthTracker — circuit breaker + error-type differentiation
 *
 * Coverage:
 *  1. Generic failures: 3 failures → circuit opens, other providers unaffected
 *  2. Circuit lifts: after cooldown, probe succeeds → circuit closes
 *  3. Auth errors (401/message patterns): sticky block, requires clearAuthInvalid to resume
 *  4. Rate limit errors (429): exponential back-off, not a permanent block
 *  5. Error type isolation: auth, rate-limit, generic each handled differently
 */

import { ProviderHealthTracker } from './provider-health-tracker.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeTracker(options = {}) {
  return new ProviderHealthTracker({
    failureThreshold: 3,
    failureWindowMs: 60_000,
    cooldownMs: 30_000,
    ...options,
  });
}

const authError = {
  name: 'ProviderAuthError',
  code: 'AUTH_REQUIRED',
  message: 'Unauthorized',
  status: 401,
};
const rateLimitError = { status: 429, message: 'Too many requests' };
const genericError = new Error('Network timeout');

// ─── 1. Generic failures open the circuit after threshold ────────────────────

describe('generic failures', () => {
  test('allows requests when circuit is closed', () => {
    const t = makeTracker();
    expect(t.shouldAttempt('claude').allowed).toBe(true);
  });

  test('circuit stays closed below threshold', () => {
    const t = makeTracker();
    t.recordFailure('claude', genericError);
    t.recordFailure('claude', genericError);
    expect(t.shouldAttempt('claude').allowed).toBe(true);
  });

  test('circuit opens after 3 generic failures', () => {
    const t = makeTracker();
    t.recordFailure('claude', genericError);
    t.recordFailure('claude', genericError);
    t.recordFailure('claude', genericError);
    const result = t.shouldAttempt('claude');
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('circuit_open');
    expect(typeof result.retryAfterMs).toBe('number');
  });

  test('failures on one provider do not affect others', () => {
    const t = makeTracker();
    t.recordFailure('claude', genericError);
    t.recordFailure('claude', genericError);
    t.recordFailure('claude', genericError);
    // claude is blocked, but chatgpt and gemini are open
    expect(t.shouldAttempt('claude').allowed).toBe(false);
    expect(t.shouldAttempt('chatgpt').allowed).toBe(true);
    expect(t.shouldAttempt('gemini').allowed).toBe(true);
  });

  test('success resets failures and closes circuit', () => {
    const t = makeTracker();
    t.recordFailure('claude', genericError);
    t.recordFailure('claude', genericError);
    t.recordFailure('claude', genericError);
    t.recordSuccess('claude');
    expect(t.shouldAttempt('claude').allowed).toBe(true);
  });
});

// ─── 2. Circuit lifts after cooldown ─────────────────────────────────────────

describe('half-open / probe recovery', () => {
  test('transitions to half-open after cooldown and allows one probe', () => {
    const t = makeTracker({ cooldownMs: 0 }); // instant cooldown for test
    t.recordFailure('claude', genericError);
    t.recordFailure('claude', genericError);
    t.recordFailure('claude', genericError);
    // cooldown is 0ms, so immediately probe-eligible
    const result = t.shouldAttempt('claude');
    expect(result.allowed).toBe(true);
    expect(result.isProbe).toBe(true);
  });

  test('second call during half-open is blocked', () => {
    const t = makeTracker({ cooldownMs: 0 });
    t.recordFailure('claude', genericError);
    t.recordFailure('claude', genericError);
    t.recordFailure('claude', genericError);
    t.shouldAttempt('claude'); // first call → half-open
    const second = t.shouldAttempt('claude');
    expect(second.allowed).toBe(false);
    expect(second.reason).toBe('circuit_half_open');
  });

  test('successful probe closes circuit permanently', () => {
    const t = makeTracker({ cooldownMs: 0 });
    t.recordFailure('claude', genericError);
    t.recordFailure('claude', genericError);
    t.recordFailure('claude', genericError);
    t.shouldAttempt('claude'); // transitions to half-open
    t.recordSuccess('claude'); // probe succeeded
    expect(t.shouldAttempt('claude').allowed).toBe(true);
    // multiple subsequent calls also allowed
    expect(t.shouldAttempt('claude').allowed).toBe(true);
  });

  test('failed probe re-opens circuit', () => {
    jest.useFakeTimers();
    const t = makeTracker({ cooldownMs: 30_000 });
    t.recordFailure('claude', genericError);
    t.recordFailure('claude', genericError);
    t.recordFailure('claude', genericError);
    // Advance past cooldown to trigger half-open
    jest.advanceTimersByTime(31_000);
    t.shouldAttempt('claude'); // transitions to half-open
    t.recordFailure('claude', genericError); // probe failed → re-opens
    // Reset fake timers so cooldown is in effect again
    jest.useRealTimers();
    const result = t.shouldAttempt('claude');
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('circuit_open');
  });
});

// ─── 3. Auth errors (401/message patterns) ────────────────────────────────────

describe('auth error handling', () => {
  test('auth error immediately blocks with auth_invalid reason', () => {
    const t = makeTracker();
    t.recordFailure('claude', authError);
    const result = t.shouldAttempt('claude');
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('auth_invalid');
    expect(result.requiresReauth).toBe(true);
  });

  test('auth block is sticky — does not lift on its own after cooldown', () => {
    const t = makeTracker({ cooldownMs: 0 });
    t.recordFailure('claude', authError);
    // Even with 0ms cooldown, auth block persists
    const result = t.shouldAttempt('claude');
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('auth_invalid');
  });

  test('clearAuthInvalid removes the sticky block and closes circuit', () => {
    const t = makeTracker();
    t.recordFailure('claude', authError);
    t.clearAuthInvalid('claude');
    expect(t.shouldAttempt('claude').allowed).toBe(true);
  });

  test('auth block on one provider does not affect others', () => {
    const t = makeTracker();
    t.recordFailure('claude', authError);
    expect(t.shouldAttempt('chatgpt').allowed).toBe(true);
    expect(t.shouldAttempt('gemini').allowed).toBe(true);
  });

  test('403 status does not become a sticky auth block', () => {
    const t = makeTracker();
    t.recordFailure('claude', { status: 403, message: 'Forbidden' });
    expect(t.shouldAttempt('claude').allowed).toBe(true);
    expect(t._get('claude').authInvalid).toBe(false);
  });

  test('auth block triggers on message pattern', () => {
    const t = makeTracker();
    t.recordFailure('claude', new Error('session expired, please log in'));
    expect(t.shouldAttempt('claude').allowed).toBe(false);
    expect(t.shouldAttempt('claude').reason).toBe('auth_invalid');
  });
});

// ─── 4. Rate limit errors (429) ───────────────────────────────────────────────

describe('rate limit handling', () => {
  test('rate limit error sets a timed back-off (not permanent)', () => {
    const t = makeTracker();
    t.recordFailure('claude', rateLimitError);
    const result = t.shouldAttempt('claude');
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('rate_limited');
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  test('rate limit back-off lifts after delay', () => {
    jest.useFakeTimers();
    const t = makeTracker();
    t.recordFailure('claude', rateLimitError);
    // Advance past the initial 5s back-off
    jest.advanceTimersByTime(6000);
    expect(t.shouldAttempt('claude').allowed).toBe(true);
    jest.useRealTimers();
  });

  test('rate limit does not affect other providers', () => {
    const t = makeTracker();
    t.recordFailure('claude', rateLimitError);
    expect(t.shouldAttempt('chatgpt').allowed).toBe(true);
  });

  test('repeated rate limits apply exponential back-off', () => {
    const t = makeTracker();
    t.recordFailure('claude', rateLimitError); // 1st → 5s
    t.recordFailure('claude', rateLimitError); // 2nd → 10s
    const result = t.shouldAttempt('claude');
    // retryAfterMs should be roughly 10s (± jitter/timing)
    expect(result.retryAfterMs).toBeGreaterThan(5000);
  });
});

// ─── 5. Error type isolation ──────────────────────────────────────────────────

describe('error type differentiation', () => {
  test('generic errors count toward circuit, auth errors do not use sliding window', () => {
    const t = makeTracker();
    // Two generic failures (below threshold)
    t.recordFailure('claude', genericError);
    t.recordFailure('claude', genericError);
    expect(t.shouldAttempt('claude').allowed).toBe(true); // still open
    // Now an auth error — immediately sticky
    t.recordFailure('claude', authError);
    expect(t.shouldAttempt('claude').reason).toBe('auth_invalid');
  });

  test('rate limit failure does not increment generic failure count', () => {
    const t = makeTracker();
    // Rate limit twice — should not open circuit via sliding window
    t.recordFailure('claude', rateLimitError);
    t.recordFailure('claude', rateLimitError);
    t.recordFailure('claude', rateLimitError);
    // Back-off will expire; after that, circuit should be closed (not open from generic path)
    const s = t._get('claude');
    expect(s.failures.length).toBe(0); // rate-limit didn't push to generic window
  });

  test('resetCircuit fully clears all state for a provider', () => {
    const t = makeTracker();
    t.recordFailure('claude', authError);
    t.resetCircuit('claude');
    expect(t.shouldAttempt('claude').allowed).toBe(true);
  });

  test('getHealthReport reflects current state', () => {
    const t = makeTracker();
    t.recordFailure('claude', genericError);
    t.recordFailure('claude', genericError);
    t.recordFailure('claude', genericError);
    t.recordFailure('chatgpt', authError);

    const report = t.getHealthReport() as Record<string, { circuit: string; authInvalid: boolean }>;
    expect(report['claude'].circuit).toBe('open');
    expect(report['chatgpt'].authInvalid).toBe(true);
  });
});

// src/core/provider-health-tracker.js

/**
 * Circuit Breaker implementation for provider reliability.
 *
 * States:
 * - closed:    Normal operation, requests pass through
 * - open:      Too many failures, requests blocked for cooldown period
 * - half-open: Testing if provider recovered, allow 1 probe through
 *
 * Extended with error-type awareness:
 * - authInvalid: sticky flag for 401/403 — no retry until clearAuthInvalid() is called
 * - rateLimitUntil: dynamic timestamp for 429 exponential back-off
 */

import { isProviderAuthError, isRateLimitError } from '../utils/error-classification.ts';

// Exponential back-off for rate limits: 5s → 10s → 20s → 40s, capped at 60s
const RATE_LIMIT_BACKOFF_BASE_MS = 5000;
const RATE_LIMIT_BACKOFF_MAX_MS  = 60000;

export class ProviderHealthTracker {
  constructor(options = {}) {
    this.failureThreshold = options.failureThreshold ?? 3;   // Failures before opening
    this.failureWindowMs  = options.failureWindowMs  ?? 60000; // 1 minute window
    this.cooldownMs       = options.cooldownMs       ?? 30000; // 30 second cooldown

    // providerId → ProviderState
    this._state = new Map();
  }

  // ─── Internal state helpers ──────────────────────────────────────────────

  _get(providerId) {
    if (!this._state.has(providerId)) {
      this._state.set(providerId, {
        circuit: 'closed',   // 'closed' | 'open' | 'half-open'
        openedAt: null,
        failures: [],        // timestamps in the sliding window
        lastSuccess: null,
        authInvalid: false,  // sticky: 401/403 → no retry until clearAuthInvalid()
        rateLimitUntil: null, // timestamp: dynamic back-off for 429
        rateLimitCount: 0,   // consecutive 429s (for exponential back-off)
      });
    }
    return this._state.get(providerId);
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  /**
   * Check if we should attempt a request to this provider.
   * Returns { allowed, reason?, retryAfterMs?, requiresReauth? }
   */
  shouldAttempt(providerId) {
    const s = this._get(providerId);
    const now = Date.now();

    // 1. Sticky auth block — requires explicit clearAuthInvalid()
    if (s.authInvalid) {
      return { allowed: false, reason: 'auth_invalid', requiresReauth: true };
    }

    // 2. Rate limit back-off window
    if (s.rateLimitUntil && now < s.rateLimitUntil) {
      return { allowed: false, reason: 'rate_limited', retryAfterMs: s.rateLimitUntil - now };
    }

    // 3. Circuit open → maybe transition to half-open
    if (s.circuit === 'open') {
      const elapsed = now - s.openedAt;
      if (elapsed >= this.cooldownMs) {
        s.circuit = 'half-open';
        return { allowed: true, isProbe: true };
      }
      return { allowed: false, reason: 'circuit_open', retryAfterMs: this.cooldownMs - elapsed };
    }

    // 4. Already probing — block additional requests
    if (s.circuit === 'half-open') {
      return { allowed: false, reason: 'circuit_half_open' };
    }

    return { allowed: true };
  }

  /**
   * Record a successful request — resets failures and closes circuit.
   */
  recordSuccess(providerId) {
    const s = this._get(providerId);
    s.lastSuccess = Date.now();
    s.failures = [];
    s.circuit = 'closed';
    s.rateLimitUntil = null;
    s.rateLimitCount = 0;
    console.log(`[HealthTracker] ${providerId}: Circuit closed (success)`);
  }

  /**
   * Record a failed request — differentiates auth, rate-limit, and generic errors.
   * @param {string} providerId
   * @param {unknown} [error]  — the raw error; used for type detection
   */
  recordFailure(providerId, error) {
    const s = this._get(providerId);
    const now = Date.now();

    // ── Auth failure (401/403) — sticky, requires manual clear ──────────────
    if (error && isProviderAuthError(error)) {
      s.authInvalid = true;
      s.circuit = 'open';
      s.openedAt = now;
      console.warn(`[HealthTracker] ${providerId}: Auth invalid — circuit OPENED (sticky)`);
      return;
    }

    // ── Rate limit (429) — exponential back-off ──────────────────────────────
    if (error && isRateLimitError(error)) {
      s.rateLimitCount += 1;
      const backoff = Math.min(
        RATE_LIMIT_BACKOFF_BASE_MS * Math.pow(2, s.rateLimitCount - 1),
        RATE_LIMIT_BACKOFF_MAX_MS,
      );
      s.rateLimitUntil = now + backoff;
      console.warn(`[HealthTracker] ${providerId}: Rate limited — back-off ${backoff}ms (attempt ${s.rateLimitCount})`);
      return;
    }

    // ── Half-open probe failed → re-open ─────────────────────────────────────
    if (s.circuit === 'half-open') {
      s.circuit = 'open';
      s.openedAt = now;
      console.warn(`[HealthTracker] ${providerId}: Circuit re-opened (probe failed)`);
      return;
    }

    // ── Generic failure — sliding window ─────────────────────────────────────
    const recent = s.failures.filter(ts => now - ts < this.failureWindowMs);
    recent.push(now);
    s.failures = recent;

    if (recent.length >= this.failureThreshold) {
      s.circuit = 'open';
      s.openedAt = now;
      console.warn(`[HealthTracker] ${providerId}: Circuit OPENED after ${recent.length} failures`);
    }
  }

  /**
   * Clear the sticky auth-invalid flag — call after the user re-authenticates.
   */
  clearAuthInvalid(providerId) {
    const s = this._get(providerId);
    s.authInvalid = false;
    s.circuit = 'closed';
    s.openedAt = null;
    s.failures = [];
    console.log(`[HealthTracker] ${providerId}: Auth-invalid cleared — circuit closed`);
  }

  /**
   * Get health status for all tracked providers.
   */
  getHealthReport() {
    const report = {};
    for (const [providerId, s] of this._state) {
      report[providerId] = {
        circuit: s.circuit,
        authInvalid: s.authInvalid,
        rateLimitUntil: s.rateLimitUntil,
        recentFailures: s.failures.length,
        lastSuccess: s.lastSuccess,
      };
    }
    return report;
  }

  /**
   * Manually reset a provider's circuit (admin / test action).
   */
  resetCircuit(providerId) {
    this._state.delete(providerId);
    console.log(`[HealthTracker] ${providerId}: Circuit manually reset`);
  }

  // ── Legacy compat shims (old callers used separate Maps) ─────────────────

  /** @deprecated Use getHealthReport() */
  get failures() {
    const m = new Map();
    for (const [id, s] of this._state) m.set(id, s.failures);
    return m;
  }

  /** @deprecated Use getHealthReport() */
  get circuitState() {
    const m = new Map();
    for (const [id, s] of this._state) m.set(id, { state: s.circuit, openedAt: s.openedAt });
    return m;
  }

  /** @deprecated Use getHealthReport() */
  get lastSuccess() {
    const m = new Map();
    for (const [id, s] of this._state) m.set(id, s.lastSuccess);
    return m;
  }
}

// Singleton instance
let instance = null;
export function getHealthTracker() {
  if (!instance) {
    instance = new ProviderHealthTracker();
  }
  return instance;
}

// src/core/provider-health-tracker.js

/**
 * Circuit Breaker implementation for provider reliability
 *
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Too many failures, requests blocked for cooldown period
 * - HALF_OPEN: Testing if provider recovered, allow 1 request through
 */
export class ProviderHealthTracker {
  constructor(options = {}) {
    this.failureThreshold = options.failureThreshold || 3;  // Failures before opening
    this.failureWindowMs = options.failureWindowMs || 60000; // 1 minute window
    this.cooldownMs = options.cooldownMs || 30000;          // 30 second cooldown

    this.failures = new Map();      // providerId -> [timestamps]
    this.circuitState = new Map();  // providerId -> { state, openedAt }
    this.lastSuccess = new Map();   // providerId -> timestamp
  }

  /**
   * Check if we should attempt a request to this provider
   */
  shouldAttempt(providerId) {
    const state = this.circuitState.get(providerId);

    if (!state || state.state === 'closed') {
      return { allowed: true };
    }

    if (state.state === 'open') {
      const elapsed = Date.now() - state.openedAt;
      if (elapsed >= this.cooldownMs) {
        // Transition to half-open, allow one test request
        this.circuitState.set(providerId, { state: 'half-open', openedAt: state.openedAt });
        return { allowed: true, isProbe: true };
      }
      return {
        allowed: false,
        reason: 'circuit_open',
        retryAfterMs: this.cooldownMs - elapsed
      };
    }

    if (state.state === 'half-open') {
      // Already have a probe in flight, block additional requests
      return { allowed: false, reason: 'circuit_half_open' };
    }

    return { allowed: true };
  }

  /**
   * Record a successful request
   */
  recordSuccess(providerId) {
    this.lastSuccess.set(providerId, Date.now());
    this.failures.delete(providerId);
    this.circuitState.set(providerId, { state: 'closed' });

    console.log(`[HealthTracker] ${providerId}: Circuit closed (success)`);
  }

  /**
   * Record a failed request
   */
  recordFailure(providerId, _error) {
    const now = Date.now();
    const state = this.circuitState.get(providerId);

    // If this was a half-open probe that failed, go back to open
    if (state?.state === 'half-open') {
      this.circuitState.set(providerId, { state: 'open', openedAt: now });
      console.warn(`[HealthTracker] ${providerId}: Circuit re-opened (probe failed)`);
      return;
    }

    // Track failures in sliding window
    const recentFailures = (this.failures.get(providerId) || [])
      .filter(ts => now - ts < this.failureWindowMs);
    recentFailures.push(now);
    this.failures.set(providerId, recentFailures);

    // Check if we should open the circuit
    if (recentFailures.length >= this.failureThreshold) {
      this.circuitState.set(providerId, { state: 'open', openedAt: now });
      console.warn(`[HealthTracker] ${providerId}: Circuit OPENED after ${recentFailures.length} failures`);
    }
  }

  /**
   * Get health status for all tracked providers
   */
  getHealthReport() {
    const report = {};
    this.circuitState.forEach((state, providerId) => {
      report[providerId] = {
        state: state.state,
        recentFailures: this.failures.get(providerId)?.length || 0,
        lastSuccess: this.lastSuccess.get(providerId) || null
      };
    });
    return report;
  }

  /**
   * Manually reset a provider's circuit (admin action)
   */
  resetCircuit(providerId) {
    this.failures.delete(providerId);
    this.circuitState.set(providerId, { state: 'closed' });
    console.log(`[HealthTracker] ${providerId}: Circuit manually reset`);
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

/**
 * HTOS Lifecycle Manager - Simplified
 * 
 * Strategy: Track activity for business logic only.
 * Keep-alive is handled by the offscreen document heartbeat.
 */

export class LifecycleManager {
  constructor() {
    this.lastActivity = Date.now();
    this.INACTIVITY_THRESHOLD = 20 * 60 * 1000; // 20 minutes
  }

  recordActivity() {
    this.lastActivity = Date.now();
  }

  isIdle() {
    return Date.now() - this.lastActivity > this.INACTIVITY_THRESHOLD;
  }

  getIdleTime() {
    return Date.now() - this.lastActivity;
  }

  keepalive(enable) {
    if (enable) {
      this.recordActivity();
    }
  }
}

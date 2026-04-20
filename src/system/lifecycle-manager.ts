/**
 * HTOS Lifecycle Manager - Simplified
 *
 * Strategy: Track activity for business logic only.
 * Keep-alive is handled by the offscreen document heartbeat.
 */

export class LifecycleManager {
  private lastActivity: number;
  private readonly INACTIVITY_THRESHOLD: number;

  constructor() {
    this.lastActivity = Date.now();
    this.INACTIVITY_THRESHOLD = 20 * 60 * 1000; // 20 minutes
  }

  recordActivity(): void {
    this.lastActivity = Date.now();
  }

  isIdle(): boolean {
    return Date.now() - this.lastActivity > this.INACTIVITY_THRESHOLD;
  }

  getIdleTime(): number {
    return Date.now() - this.lastActivity;
  }

  keepalive(enable: boolean): void {
    if (enable) {
      this.recordActivity();
    }
  }
}

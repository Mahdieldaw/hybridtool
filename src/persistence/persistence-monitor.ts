/**
 * HTOS Persistence Layer Monitor
 * Provides debugging, monitoring, diagnostic capabilities, and wrapper helpers
 * for persistence operations.
 */

declare global {
  interface GlobalThis {
    HTOS_DEBUG_MODE?: boolean;
    __HTOS_PERSISTENCE_MONITOR?: PersistenceMonitor;
  }
}

export interface PersistenceOperationRecord {
  id: string;
  type: string;
  details: Record<string, unknown>;
  startTime: number;
  timestamp: number;
  endTime?: number;
  duration?: number;
  result?: unknown;
  error?: unknown;
  success?: boolean;
}

export interface PersistencePerformanceMetrics {
  count: number;
  totalDuration: number;
  avgDuration: number;
  minDuration: number;
  maxDuration: number;
  errors: number;
  successRate: number;
}

export interface PersistenceErrorRecord {
  timestamp: number;
  message: string;
  stack?: string;
  context: Record<string, unknown> | PersistenceOperationRecord;
  id: string;
}

export interface PersistenceConnectionRecord {
  name: string;
  version: number;
  stores: string[];
  connectedAt: number;
  lastActivity: number;
}

export interface PersistenceMonitorMetrics {
  operations: Map<string, PersistenceOperationRecord>;
  errors: PersistenceErrorRecord[];
  performance: Map<string, PersistencePerformanceMetrics>;
  connections: Map<string, PersistenceConnectionRecord>;
}

export class PersistenceMonitor {
  private metrics: PersistenceMonitorMetrics;
  private isEnabled: boolean;
  private maxLogEntries: number;
  private startTime: number;

  constructor() {
    this.metrics = {
      operations: new Map<string, PersistenceOperationRecord>(),
      errors: [],
      performance: new Map<string, PersistencePerformanceMetrics>(),
      connections: new Map<string, PersistenceConnectionRecord>(),
    };

    this.isEnabled = (globalThis as any).HTOS_DEBUG_MODE || false;
    this.maxLogEntries = 1000;
    this.startTime = Date.now();

    if (this.isEnabled) {
      console.log('🔍 HTOS Persistence Monitor initialized');
    }
  }

  /**
   * Record an operation start
   */
  startOperation(operationType: string, details: Record<string, unknown> = {}): string | null {
    if (!this.isEnabled) return null;

    const operationId = `${operationType}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const operation: PersistenceOperationRecord = {
      id: operationId,
      type: operationType,
      details,
      startTime: performance.now(),
      timestamp: Date.now(),
    };

    this.metrics.operations.set(operationId, operation);

    // Clean up old operations
    if (this.metrics.operations.size > this.maxLogEntries) {
      const oldestKey = this.metrics.operations.keys().next().value;
      if (oldestKey) {
        this.metrics.operations.delete(oldestKey);
      }
    }

    return operationId;
  }

  /**
   * Record an operation completion
   */
  endOperation(operationId: string | null, result: unknown = null, error: unknown = null): void {
    if (!this.isEnabled || !operationId) return;

    const operation = this.metrics.operations.get(operationId);
    if (!operation) return;

    operation.endTime = performance.now();
    operation.duration = operation.endTime - operation.startTime;
    operation.result = result;
    operation.error = error;
    operation.success = !error;

    // Update performance metrics
    const perfKey = operation.type;
    if (!this.metrics.performance.has(perfKey)) {
      this.metrics.performance.set(perfKey, {
        count: 0,
        totalDuration: 0,
        avgDuration: 0,
        minDuration: Infinity,
        maxDuration: 0,
        errors: 0,
        successRate: 100,
      });
    }

    const perf = this.metrics.performance.get(perfKey);
    if (!perf) return;

    perf.count++;
    perf.totalDuration += operation.duration;
    perf.avgDuration = perf.totalDuration / perf.count;
    perf.minDuration = Math.min(perf.minDuration, operation.duration);
    perf.maxDuration = Math.max(perf.maxDuration, operation.duration);

    if (error) {
      perf.errors++;
      this.recordError(error, operation);
    }

    perf.successRate = ((perf.count - perf.errors) / perf.count) * 100;

    // Log slow operations
    if (operation.duration > 1000) {
      // > 1 second
      console.warn(
        `🐌 Slow operation detected: ${operation.type} took ${operation.duration.toFixed(2)}ms`,
        operation
      );
    }
  }

  /**
   * Record an error
   */
  recordError(
    error: unknown,
    context: Record<string, unknown> | PersistenceOperationRecord = {}
  ): void {
    if (!this.isEnabled) return;

    const errorRecord: PersistenceErrorRecord = {
      timestamp: Date.now(),
      message:
        typeof error === 'object' && error !== null && 'message' in error
          ? String((error as { message?: unknown }).message)
          : String(error),
      stack:
        typeof error === 'object' && error !== null && 'stack' in error
          ? String((error as { stack?: unknown }).stack)
          : undefined,
      context,
      id: `error_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    };

    this.metrics.errors.push(errorRecord);

    // Keep only recent errors
    if (this.metrics.errors.length > this.maxLogEntries) {
      this.metrics.errors = this.metrics.errors.slice(-this.maxLogEntries);
    }

    console.error('🚨 HTOS Persistence Error:', errorRecord);
  }

  /**
   * Record database connection info
   */
  recordConnection(dbName: string, version: number, stores: string[] = []): void {
    if (!this.isEnabled) return;

    this.metrics.connections.set(dbName, {
      name: dbName,
      version,
      stores,
      connectedAt: Date.now(),
      lastActivity: Date.now(),
    });
  }

  // Migration tracking removed

  /**
   * Get comprehensive health report
   */
  getHealthReport() {
    const now = Date.now();
    const uptime = now - this.startTime;

    const report: {
      timestamp: number;
      uptime: number;
      enabled: boolean;
      summary: {
        totalOperations: number;
        totalErrors: number;
        activeConnections: number;
      };
      performance: Record<string, PersistencePerformanceMetrics>;
      recentErrors: PersistenceErrorRecord[];
      connections: PersistenceConnectionRecord[];
    } = {
      timestamp: now,
      uptime,
      enabled: this.isEnabled,
      summary: {
        totalOperations: this.metrics.operations.size,
        totalErrors: this.metrics.errors.length,
        activeConnections: this.metrics.connections.size,
      },
      performance: {},
      recentErrors: this.metrics.errors.slice(-10),
      connections: Array.from(this.metrics.connections.values()),
    };

    // Convert performance metrics to plain objects
    this.metrics.performance.forEach((value, key) => {
      report.performance[key] = { ...value };
    });

    return report;
  }

  /**
   * Get performance metrics for specific operation type
   */
  getPerformanceMetrics(operationType: string): PersistencePerformanceMetrics | null {
    return this.metrics.performance.get(operationType) || null;
  }

  /**
   * Get recent operations
   */
  getRecentOperations(limit = 50): PersistenceOperationRecord[] {
    const operations = Array.from(this.metrics.operations.values())
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);

    return operations;
  }

  /**
   * Get error statistics
   */
  getErrorStats() {
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;
    const oneDay = 24 * oneHour;

    const recentErrors = this.metrics.errors.filter((e) => now - e.timestamp < oneHour);
    const dailyErrors = this.metrics.errors.filter((e) => now - e.timestamp < oneDay);

    const errorsByType: Record<string, number> = {};
    this.metrics.errors.forEach((error) => {
      const type = (error.context?.type as string) || 'unknown';
      errorsByType[type] = (errorsByType[type] || 0) + 1;
    });

    return {
      total: this.metrics.errors.length,
      lastHour: recentErrors.length,
      lastDay: dailyErrors.length,
      byType: errorsByType,
      mostRecent: this.metrics.errors[this.metrics.errors.length - 1] || null,
    };
  }

  /**
   * Export diagnostics data
   */
  exportDiagnostics() {
    const report = this.getHealthReport();
    const errorStats = this.getErrorStats();
    const recentOps = this.getRecentOperations(100);

    return {
      ...report,
      errorStats,
      recentOperations: recentOps,
      exportedAt: Date.now(),
      version: '1.0.0',
    };
  }

  /**
   * Clear all metrics (useful for testing)
   */
  clearMetrics() {
    this.metrics.operations.clear();
    this.metrics.errors = [];
    this.metrics.performance.clear();
    this.metrics.connections.clear();

    if (this.isEnabled) {
      console.log('🧹 HTOS Persistence Monitor metrics cleared');
    }
  }

  /**
   * Enable/disable monitoring
   */
  setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
    if (enabled) {
      console.log('🔍 HTOS Persistence Monitor enabled');
    } else {
      console.log('🔍 HTOS Persistence Monitor disabled');
    }
  }

  /**
   * Create a monitoring wrapper for any function
   */
  wrapFunction<T extends (...args: any[]) => Promise<any>>(
    fn: T,
    operationType: string,
    context: Record<string, unknown> = {}
  ): T {
    if (!this.isEnabled) return fn;

    const wrapped = (async (...args: Parameters<T>): Promise<ReturnType<T>> => {
      const operationId = this.startOperation(operationType, {
        context,
        args: args.length,
      });

      try {
        const result = await fn(...args);
        this.endOperation(operationId, result);
        return result as ReturnType<T>;
      } catch (error) {
        this.endOperation(operationId, null, error);
        throw error;
      }
    }) as unknown as T;

    return wrapped;
  }

  /**
   * Create a monitoring wrapper for IndexedDB operations
   */
  wrapIndexedDBOperation(
    operation: any,
    operationType: string,
    details: Record<string, unknown> = {}
  ): Promise<unknown> | any {
    if (!this.isEnabled) return operation;

    const operationId = this.startOperation(operationType, details);

    // If already done, handle immediately
    if (operation.readyState === 'done') {
      if (operation.error) {
        this.endOperation(operationId, null, operation.error);
      } else {
        this.endOperation(operationId, operation.result);
      }
      return operation.error ? Promise.reject(operation.error) : Promise.resolve(operation.result);
    }

    return new Promise((resolve, reject) => {
      operation.onsuccess = (event: any) => {
        this.endOperation(operationId, event.target.result);
        resolve(event.target.result);
      };

      operation.onerror = (event: any) => {
        const error = event.target.error || new Error('IndexedDB operation failed');
        this.endOperation(operationId, null, error);
        reject(error);
      };
    });
  }

  /**
   * Log a custom event
   */
  logEvent(eventType: string, details: Record<string, unknown> = {}): void {
    if (!this.isEnabled) return;

    console.log(`📊 HTOS Event [${eventType}]:`, details);
  }

  /**
   * Get system information
   */
  getSystemInfo() {
    const nav = globalThis.navigator;
    return {
      userAgent: nav?.userAgent,
      platform: nav?.platform,
      language: nav?.language,
      cookieEnabled: nav?.cookieEnabled,
      onLine: nav?.onLine,
      indexedDBSupported: !!globalThis.indexedDB,
      webWorkersSupported: !!globalThis.Worker,
      serviceWorkerSupported: !!nav?.serviceWorker,
      timestamp: Date.now(),
    };
  }
}

// Create global instance
export const persistenceMonitor = new PersistenceMonitor();

// Make it available globally for debugging
if (typeof globalThis !== 'undefined') {
  (globalThis as any).__HTOS_PERSISTENCE_MONITOR = persistenceMonitor;
}

export default persistenceMonitor;

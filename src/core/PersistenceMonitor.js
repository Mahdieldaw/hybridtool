/**
 * HTOS Persistence Layer Monitor
 * Provides debugging, monitoring, and diagnostic capabilities for the persistence layer
 */

export class PersistenceMonitor {
  constructor() {
    this.metrics = {
      operations: new Map(),
      errors: new Array(),
      performance: new Map(),
      connections: new Map(),
    };

    this.isEnabled = globalThis.HTOS_DEBUG_MODE || false;
    this.maxLogEntries = 1000;
    this.startTime = Date.now();

    if (this.isEnabled) {
      console.log("🔍 HTOS Persistence Monitor initialized");
    }
  }

  /**
   * Record an operation start
   */
  startOperation(operationType, details = {}) {
    if (!this.isEnabled) return null;

    const operationId = `${operationType}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const operation = {
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
      this.metrics.operations.delete(oldestKey);
    }

    return operationId;
  }

  /**
   * Record an operation completion
   * @param {string|null} operationId
   * @param {any} [result]
   * @param {any} [error]
   */
  endOperation(operationId, result = null, error = null) {
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
        operation,
      );
    }
  }

  /**
   * Record an error
   */
  recordError(error, context = {}) {
    if (!this.isEnabled) return;

    const errorRecord = {
      timestamp: Date.now(),
      message: error.message || String(error),
      stack: error.stack,
      context,
      id: `error_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    };

    this.metrics.errors.push(errorRecord);

    // Keep only recent errors
    if (this.metrics.errors.length > this.maxLogEntries) {
      this.metrics.errors = this.metrics.errors.slice(-this.maxLogEntries);
    }

    console.error("🚨 HTOS Persistence Error:", errorRecord);
  }

  /**
   * Record database connection info
   */
  recordConnection(dbName, version, stores = []) {
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

    const report = {
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
  getPerformanceMetrics(operationType) {
    return this.metrics.performance.get(operationType) || null;
  }

  /**
   * Get recent operations
   */
  getRecentOperations(limit = 50) {
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

    const recentErrors = this.metrics.errors.filter(
      (e) => now - e.timestamp < oneHour,
    );
    const dailyErrors = this.metrics.errors.filter(
      (e) => now - e.timestamp < oneDay,
    );

    const errorsByType = {};
    this.metrics.errors.forEach((error) => {
      const type = error.context?.type || "unknown";
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
      version: "1.0.0",
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
      console.log("🧹 HTOS Persistence Monitor metrics cleared");
    }
  }

  /**
   * Enable/disable monitoring
   */
  setEnabled(enabled) {
    this.isEnabled = enabled;
    if (enabled) {
      console.log("🔍 HTOS Persistence Monitor enabled");
    } else {
      console.log("🔍 HTOS Persistence Monitor disabled");
    }
  }

  /**
   * Create a monitoring wrapper for any function
   */
  wrapFunction(fn, operationType, context = {}) {
    if (!this.isEnabled) return fn;

    return async (...args) => {
      const operationId = this.startOperation(operationType, {
        context,
        args: args.length,
      });

      try {
        const result = await fn(...args);
        this.endOperation(operationId, result);
        return result;
      } catch (error) {
        this.endOperation(operationId, null, error);
        throw error;
      }
    };
  }

  /**
   * Create a monitoring wrapper for IndexedDB operations
   */
  wrapIndexedDBOperation(operation, operationType, details = {}) {
    if (!this.isEnabled) return operation;

    const operationId = this.startOperation(operationType, details);

    // If already done, handle immediately
    if (operation.readyState === "done") {
      if (operation.error) {
        this.endOperation(operationId, null, operation.error);
      } else {
        this.endOperation(operationId, operation.result);
      }
      return operation.error ? Promise.reject(operation.error) : Promise.resolve(operation.result);
    }

    return new Promise((resolve, reject) => {
      operation.onsuccess = (event) => {
        this.endOperation(operationId, event.target.result);
        resolve(event.target.result);
      };

      operation.onerror = (event) => {
        const error =
          event.target.error || new Error("IndexedDB operation failed");
        this.endOperation(operationId, null, error);
        reject(error);
      };
    });
  }

  /**
   * Log a custom event
   */
  logEvent(eventType, details = {}) {
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
if (typeof globalThis !== "undefined") {
  globalThis.__HTOS_PERSISTENCE_MONITOR = persistenceMonitor;
}

export default persistenceMonitor;

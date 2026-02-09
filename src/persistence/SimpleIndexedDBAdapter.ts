// Simplified IndexedDB Adapter with minimal API for HTOS persistence
// Provides init(), get(), put(), delete(), getAll() methods with auto-population of key fields

import { openDatabase } from "./database";
import { verifySchemaAndRepair } from "./schemaVerification";
import { withTransaction } from "./transactions";

export interface SimpleRecord {
  id?: string;
  createdAt?: number;
  updatedAt?: number;
  [key: string]: any;
}

/**
 * Simplified IndexedDB adapter with minimal API surface
 */
export class SimpleIndexedDBAdapter {
  private db: IDBDatabase | null = null;
  private isInitialized = false;
  private initTimeoutMs = 8000;

  /**
   * Initialize the adapter and open the database
   * Only returns after onupgradeneeded completes and DB is fully open
   */
  async init(options?: {
    timeoutMs?: number;
    autoRepair?: boolean;
  }): Promise<void> {
    this.initTimeoutMs = options?.timeoutMs ?? this.initTimeoutMs;
    const autoRepair = options?.autoRepair ?? true;

    try {
      // Open DB with timeout protection
      const dbPromise = openDatabase();
      this.db = await this.withTimeout(
        dbPromise,
        this.initTimeoutMs,
        "Timeout opening IndexedDB database",
      );

      // Runtime assertions - verify DB is properly opened
      if (!this.db) {
        console.error("persistence:init - Database failed to open");
        throw new Error("IndexedDB failed to open - database is null");
      }

      // Verify/repair schema if needed
      const { repaired, db: repairedDb } =
        await verifySchemaAndRepair(autoRepair);
      if (repaired && repairedDb) {
        // Replace db handle with repaired instance
        if (this.db) {
          try {
            this.db.close();
          } catch (e) {
            console.warn("Error closing old DB connection:", e);
          }
        }
        this.db = repairedDb;
      }
      if (!repaired) {
        // verify required object stores exist if no repair was needed
        const requiredStores = [
          "sessions",
          "threads",
          "turns",
          "provider_responses",
          "provider_contexts",
          "metadata",
          "context_bridges",
        ];
        const missingStores = requiredStores.filter(
          (storeName) => !this.db!.objectStoreNames.contains(storeName),
        );
        if (missingStores.length > 0) {
          console.error(
            "persistence:init - Missing required object stores:",
            missingStores,
          );
          throw new Error(
            `IndexedDB missing required object stores: ${missingStores.join(", ")}`,
          );
        }
      }

      this.isInitialized = true;
    } catch (error) {
      console.error("persistence:init - Initialization failed:", error);
      throw error;
    }
  }

  /**
   * Get a record by key from the specified store
   * Returns undefined if record is not found (safe behavior)
   */
  async get(storeName: string, key: string): Promise<SimpleRecord | undefined> {
    this.ensureReady();
    const resolved = this.resolveStoreName(storeName);
    try {
      const result = await withTransaction(
        this.db!,
        [resolved],
        "readonly",
        async (tx) => {
          const store = tx.objectStore(resolved);
          return new Promise<SimpleRecord | undefined>((resolve, reject) => {
            const request = store.get(key);
            request.onsuccess = () => resolve(request.result || undefined);
            request.onerror = () => reject(request.error);
          });
        },
      );

      return result;
    } catch (error) {
      console.error(`persistence:get(${resolved}, ${key}) - error:`, error);
      throw error;
    }
  }

  /**
   * Put a record into the specified store
   * Auto-populates id, createdAt, updatedAt fields if missing
   */
  async put(
    storeName: string,
    value: SimpleRecord,
    key?: string,
  ): Promise<SimpleRecord> {
    this.ensureReady();
    const resolved = this.resolveStoreName(storeName);
    try {
      // Defensive deep-clone to prevent mutation issues
      const clonedValue = JSON.parse(JSON.stringify(value));

      // Auto-populate required fields
      const now = Date.now();
      if (!clonedValue.id && !key) {
        clonedValue.id = crypto.randomUUID();
      }
      if (key && !clonedValue.id) {
        clonedValue.id = key;
      }
      if (!clonedValue.createdAt) {
        clonedValue.createdAt = now;
      }
      clonedValue.updatedAt = now;

      const result = await withTransaction(
        this.db!,
        [resolved],
        "readwrite",
        async (tx) => {
          const store = tx.objectStore(resolved);
          return new Promise<SimpleRecord>((resolve, reject) => {
            // If the store has a keyPath defined, IndexedDB requires that we DO NOT provide
            // an explicit key argument to put(). Passing a key would raise a DataError DOMException.
            const hasKeyPath = store.keyPath !== null && store.keyPath !== undefined;
            const request = hasKeyPath
              ? store.put(clonedValue)
              : (key ? store.put(clonedValue, key) : store.put(clonedValue));
            request.onsuccess = () => resolve(clonedValue);
            request.onerror = () => reject(request.error);
          });
        },
      );

      return result;
    } catch (error) {
      console.error(
        `persistence:put(${resolved}, ${key || value.id}) - error:`,
        error,
      );
      throw error;
    }
  }

  async update(
    storeName: string,
    key: string,
    updater: (current: SimpleRecord | undefined) => SimpleRecord | undefined,
  ): Promise<SimpleRecord | undefined> {
    this.ensureReady();
    const resolved = this.resolveStoreName(storeName);
    try {
      const result = await withTransaction(
        this.db!,
        [resolved],
        "readwrite",
        async (tx) => {
          const store = tx.objectStore(resolved);
          const current = await new Promise<SimpleRecord | undefined>(
            (resolve, reject) => {
              const request = store.get(key);
              request.onsuccess = () => resolve(request.result || undefined);
              request.onerror = () => reject(request.error);
            },
          );

          const next = updater(
            current ? JSON.parse(JSON.stringify(current)) : undefined,
          );
          if (!next) return undefined;

          const clonedValue = JSON.parse(JSON.stringify(next));
          const now = Date.now();
          if (!clonedValue.id) clonedValue.id = key;
          if (!clonedValue.createdAt) clonedValue.createdAt = current?.createdAt || now;
          clonedValue.updatedAt = now;

          await new Promise<void>((resolve, reject) => {
            const hasKeyPath = store.keyPath !== null && store.keyPath !== undefined;
            const request = hasKeyPath
              ? store.put(clonedValue)
              : store.put(clonedValue, key);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
          });

          return clonedValue;
        },
      );

      return result;
    } catch (error) {
      console.error(`persistence:update(${resolved}, ${key}) - error:`, error);
      throw error;
    }
  }

  /**
   * Batch put records into the specified store in a single transaction
   */
  async batchPut(
    storeName: string,
    values: SimpleRecord[],
  ): Promise<void> {
    this.ensureReady();
    if (!values || values.length === 0) return;

    const resolved = this.resolveStoreName(storeName);
    const now = Date.now();

    try {
      await withTransaction(
        this.db!,
        [resolved],
        "readwrite",
        async (tx) => {
          const store = tx.objectStore(resolved);
          const hasKeyPath = store.keyPath !== null && store.keyPath !== undefined;

          // Process all puts within the single transaction
          const promises = values.map(value => {
            return new Promise<void>((resolve, reject) => {
              // Clone and auto-populate
              const clonedValue = JSON.parse(JSON.stringify(value));
              if (!clonedValue.id) clonedValue.id = crypto.randomUUID();
              if (!clonedValue.createdAt) clonedValue.createdAt = now;
              clonedValue.updatedAt = now;

              const request = hasKeyPath
                ? store.put(clonedValue)
                : store.put(clonedValue, clonedValue.id);

              request.onsuccess = () => resolve();
              request.onerror = () => reject(request.error);
            });
          });

          await Promise.all(promises);
        }
      );
    } catch (error) {
      console.error(`persistence:batchPut(${resolved}) - error:`, error);
      throw error;
    }
  }

  /**
   * Delete a record by key from the specified store
   */
  async delete(storeName: string, key: string): Promise<boolean> {
    this.ensureReady();
    const resolved = this.resolveStoreName(storeName);
    try {
      await withTransaction(this.db!, [resolved], "readwrite", async (tx) => {
        const store = tx.objectStore(resolved);
        return new Promise<void>((resolve, reject) => {
          const request = store.delete(key);
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error);
        });
      });

      return true;
    } catch (error) {
      console.error(`persistence:delete(${resolved}, ${key}) - error:`, error);
      throw error;
    }
  }

  /**
   * Get all records from the specified store
   * Returns empty array if no records found (safe behavior)
   */
  async getAll(storeName: string): Promise<SimpleRecord[]> {
    this.ensureReady();
    const resolved = this.resolveStoreName(storeName);
    try {
      const result = await withTransaction(
        this.db!,
        [resolved],
        "readonly",
        async (tx) => {
          const store = tx.objectStore(resolved);
          return new Promise<SimpleRecord[]>((resolve, reject) => {
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
          });
        },
      );

      return result;
    } catch (error) {
      console.error(`persistence:getAll(${resolved}) - error:`, error);
      throw error;
    }
  }

  /**
   * Generic indexed query helper using an object store index.
   * Returns all matching records.
   */
  async getByIndex(
    storeName: string,
    indexName: string,
    key: IDBValidKey | IDBKeyRange,
  ): Promise<SimpleRecord[]> {
    this.ensureReady();
    const resolved = this.resolveStoreName(storeName);
    try {
      const result = await withTransaction(
        this.db!,
        [resolved],
        "readonly",
        async (tx) => {
          const store = tx.objectStore(resolved);
          let index: IDBIndex;
          try {
            index = store.index(indexName);
          } catch (e) {
            console.error(
              `persistence:getByIndex(${resolved}.${indexName}) - missing index`,
              e,
            );
            throw e;
          }
          return new Promise<SimpleRecord[]>((resolve, reject) => {
            const request = index.getAll(key);
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
          });
        },
      );
      return result;
    } catch (error) {
      console.error(
        `persistence:getByIndex(${resolved}.${indexName}) - error:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Convenience wrappers for common indexed queries
   */
  async getThreadsBySessionId(sessionId: string): Promise<SimpleRecord[]> {
    return this.getByIndex("threads", "bySessionId", sessionId);
  }

  async getTurnsBySessionId(sessionId: string): Promise<SimpleRecord[]> {
    return this.getByIndex("turns", "bySessionId", sessionId);
  }

  async getResponsesByTurnId(aiTurnId: string): Promise<SimpleRecord[]> {
    // provider_responses.byAiTurnId
    return this.getByIndex("provider_responses", "byAiTurnId", aiTurnId);
  }

  async getContextsBySessionId(sessionId: string): Promise<SimpleRecord[]> {
    // provider_contexts.bySessionId
    return this.getByIndex("provider_contexts", "bySessionId", sessionId);
  }

  async getResponsesBySessionId(sessionId: string): Promise<SimpleRecord[]> {
    // provider_responses.bySessionId
    return this.getByIndex("provider_responses", "bySessionId", sessionId);
  }

  async getMetadataBySessionId(sessionId: string): Promise<SimpleRecord[]> {
    // metadata.bySessionId
    return this.getByIndex("metadata", "bySessionId", sessionId);
  }

  async getMetadataByEntityId(entityId: string): Promise<SimpleRecord[]> {
    // metadata.byEntityId
    return this.getByIndex("metadata", "byEntityId", entityId);
  }

  async getAllSessions(): Promise<SimpleRecord[]> {
    // Convenience wrapper for listing sessions; full-scan is acceptable for sessions catalog
    return this.getAll("sessions");
  }

  async getIncompleteTurns(): Promise<SimpleRecord[]> {
    const aiTurns = await this.getByIndex("turns", "byType", "ai");
    return (aiTurns || []).filter((t) => t && t.isComplete !== true);
  }

  /**
   * Execute an operation inside a single transaction spanning given stores.
   */
  async transaction<T>(
    storeNames: string[],
    mode: "readonly" | "readwrite",
    operation: (tx: IDBTransaction) => Promise<T>,
  ): Promise<T> {
    this.ensureReady();
    const resolvedStores = storeNames.map((s) => this.resolveStoreName(s));
    return withTransaction(this.db!, resolvedStores, mode, operation);
  }

  /**
   * Check if the adapter is ready for use
   */
  isReady(): boolean {
    return this.isInitialized && this.db !== null;
  }

  /**
   * Close the database connection
   */
  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.isInitialized = false;
    }
  }

  /**
   * Ensure the adapter is ready before operations
   */
  private ensureReady(): void {
    if (!this.isReady()) {
      throw new Error(
        "SimpleIndexedDBAdapter is not initialized. Call init() first.",
      );
    }
  }

  /**
   * Resolve canonical store name to actual IndexedDB object store name
   * Supports both camelCase and snake_case aliases
   */
  private resolveStoreName(name: string): string {
    const map: Record<string, string> = {
      providerResponses: "provider_responses",
      providerContexts: "provider_contexts",
    };
    return map[name] || name;
  }

  /**
   * Verifies the schema is healthy; if not and autoRepair=true, attempts delete-and-recreate.
   * Returns true if a repair was performed, false if no repair was needed.
   */
  // verifySchemaAndRepair extracted to standalone utility in schemaVerification.ts

  /**
   * Helper to add timeout to promises to avoid hanging initialization
   */
  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    timeoutMessage: string,
  ): Promise<T> {
    let timeoutHandle: any;
    const timeoutPromise = new Promise<T>((_, reject) => {
      timeoutHandle = setTimeout(
        () => reject(new Error(timeoutMessage)),
        timeoutMs,
      );
    });
    try {
      const result = await Promise.race([promise, timeoutPromise]);
      return result as T;
    } finally {
      clearTimeout(timeoutHandle);
    }
  }
}

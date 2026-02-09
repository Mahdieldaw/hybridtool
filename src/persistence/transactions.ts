// Transaction Utilities for IndexedDB Operations

import { VersionConflictResult, BatchWriteResult } from "./types";

/**
 * Maximum number of retry attempts for transient failures
 */
const MAX_RETRY_ATTEMPTS = 3;

/**
 * Delay between retry attempts (in milliseconds)
 */
const RETRY_DELAY_MS = 100;

/**
 * Wraps IndexedDB transactions with automatic retry logic and error handling
 */
export async function withTransaction<T>(
  db: IDBDatabase,
  storeNames: string | string[],
  mode: IDBTransactionMode,
  work: (tx: IDBTransaction) => Promise<T>,
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
    try {
      return await executeTransaction(db, storeNames, mode, work);
    } catch (error) {
      lastError = error as Error;

      // Don't retry certain types of errors
      if (isNonRetryableError(error)) {
        throw error;
      }

      // Don't retry on the last attempt
      if (attempt === MAX_RETRY_ATTEMPTS) {
        break;
      }

      console.warn(`Transaction attempt ${attempt} failed, retrying...`, error);

      // Wait before retrying
      await new Promise((resolve) =>
        setTimeout(resolve, RETRY_DELAY_MS * attempt),
      );
    }
  }

  throw (
    lastError || new Error("Transaction failed after maximum retry attempts")
  );
}

/**
 * Executes a single transaction attempt
 */
function executeTransaction<T>(
  db: IDBDatabase,
  storeNames: string | string[],
  mode: IDBTransactionMode,
  work: (tx: IDBTransaction) => Promise<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let transaction: IDBTransaction;
    // Attempt to create the transaction, but provide schema-aware errors if it fails
    try {
      transaction = db.transaction(storeNames, mode);
    } catch (err) {
      const error = err as DOMException;
      const existingStores = Array.from(db.objectStoreNames);
      const targetStores = Array.isArray(storeNames)
        ? storeNames
        : [storeNames];
      const missing = targetStores.filter(
        (name) => !existingStores.includes(name),
      );
      if (missing.length > 0) {
        const friendly = new Error(
          `SchemaError: Missing object stores [${missing.join(", ")}]; requested=[${targetStores.join(", ")}], existing=[${existingStores.join(", ")}]`,
        );
        (friendly as any).name = "NotFoundError";
        return reject(friendly);
      }
      return reject(error || new Error("Failed to create transaction"));
    }
    let workResult: T;
    let workCompleted = false;
    let workRejected = false;

    // Set up transaction event handlers
    transaction.oncomplete = () => {
      if (workCompleted && !workRejected) {
        resolve(workResult);
      } else if (!workRejected) {
        reject(
          new Error("Transaction completed but work function did not complete"),
        );
      }
      // If work was rejected, the rejection was already handled in the catch block
    };

    transaction.onerror = () => {
      if (!workRejected) {
        // Enhance error with schema context if NotFoundError
        const existingStores = Array.from(db.objectStoreNames);
        const targetStores = Array.isArray(storeNames)
          ? storeNames
          : [storeNames];
        const missing = targetStores.filter(
          (name) => !existingStores.includes(name),
        );
        const baseError =
          transaction.error ||
          new Error("Transaction failed with unknown error");
        if ((baseError as any).name === "NotFoundError" || missing.length > 0) {
          const friendly = new Error(
            `SchemaError: Missing object stores [${missing.join(", ")}]; requested=[${targetStores.join(", ")}], existing=[${existingStores.join(", ")}]`,
          );
          (friendly as any).name = "NotFoundError";
          return reject(friendly);
        }
        reject(baseError);
      }
    };

    transaction.onabort = () => {
      if (!workRejected) {
        reject(new Error("Transaction was aborted"));
      }
    };

    // Execute the work function
    work(transaction)
      .then((result) => {
        workResult = result;
        workCompleted = true;
        // Don't resolve here - wait for transaction.oncomplete
      })
      .catch((error) => {
        workRejected = true;
        // Abort the transaction if the work function fails
        try {
          transaction.abort();
        } catch (abortError) {
          console.warn("Failed to abort transaction:", abortError);
        }
        reject(error);
      });
  });
}

/**
 * Determines if an error should not be retried
 */
function isNonRetryableError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const nonRetryableErrors = [
    "QuotaExceededError",
    "ConstraintError",
    "DataError",
    "InvalidStateError",
    "NotFoundError",
    "ReadOnlyError",
    "VersionError",
  ];

  return nonRetryableErrors.includes(error.name);
}

/**
 * Batch write operation for multiple records to a single store
 */
export async function batchWrite<T>(
  db: IDBDatabase,
  storeName: string,
  records: T[],
): Promise<BatchWriteResult> {
  if (records.length === 0) {
    return { success: true };
  }

  return withTransaction(db, storeName, "readwrite", async (tx) => {
    const store = tx.objectStore(storeName);
    const errors: Error[] = [];

    // Execute all writes
    const promises = records.map((record, index) => {
      return new Promise<void>((resolve) => {
        const request = store.put(record);

        request.onsuccess = () => resolve();
        request.onerror = (event) => {
          event.preventDefault(); // Prevent transaction abort
          const error = new Error(
            `Failed to write record at index ${index}: ${request.error?.message}`,
          );
          errors.push(error);
          resolve(); // Don't reject individual failures
        };
      });
    });

    await Promise.all(promises);

    if (errors.length > 0) {
      return { success: false, errors };
    }

    return { success: true };
  });
}

/**
 * Batch delete operation for multiple keys from a single store
 */
export async function batchDelete(
  db: IDBDatabase,
  storeName: string,
  keys: (string | string[] | number)[],
): Promise<BatchWriteResult> {
  if (keys.length === 0) {
    return { success: true };
  }

  return withTransaction(db, storeName, "readwrite", async (tx) => {
    const store = tx.objectStore(storeName);
    const errors: Error[] = [];

    // Execute all deletes
    const promises = keys.map((key, index) => {
      return new Promise<void>((resolve) => {
        const request = store.delete(key as IDBValidKey);

        request.onsuccess = () => resolve();
        request.onerror = (event) => {
          event.preventDefault(); // Prevent transaction abort
          const error = new Error(
            `Failed to delete record at index ${index}: ${request.error?.message}`,
          );
          errors.push(error);
          resolve(); // Don't reject individual failures
        };
      });
    });

    await Promise.all(promises);

    if (errors.length > 0) {
      return { success: false, errors };
    }

    return { success: true };
  });
}

/**
 * Updates a record with optimistic locking based on version number
 */
export async function updateWithVersionCheck<T extends { version: number }>(
  db: IDBDatabase,
  storeName: string,
  id: string | string[],
  updates: Partial<T>,
  expectedVersion: number,
): Promise<VersionConflictResult> {
  return withTransaction(db, storeName, "readwrite", async (tx) => {
    const store = tx.objectStore(storeName);

    // Get current record
    const getRequest = store.get(id as IDBValidKey);
    const currentRecord = await new Promise<T | undefined>(
      (resolve, reject) => {
        getRequest.onsuccess = () => resolve(getRequest.result);
        getRequest.onerror = () => reject(getRequest.error);
      },
    );

    if (!currentRecord) {
      throw new Error("Record not found");
    }

    // Check version
    if (currentRecord.version !== expectedVersion) {
      return {
        success: false,
        currentVersion: currentRecord.version,
      };
    }

    // Apply updates and increment version
    const updatedRecord: T = {
      ...currentRecord,
      ...updates,
      version: currentRecord.version + 1,
    };

    // Save updated record
    const putRequest = store.put(updatedRecord);
    await new Promise<void>((resolve, reject) => {
      putRequest.onsuccess = () => resolve();
      putRequest.onerror = () => reject(putRequest.error);
    });

    return { success: true };
  });
}

/**
 * Executes multiple operations across different stores in a single transaction
 */
export async function multiStoreTransaction<T>(
  db: IDBDatabase,
  storeNames: string[],
  operations: (stores: Record<string, IDBObjectStore>) => Promise<T>,
): Promise<T> {
  return withTransaction(db, storeNames, "readwrite", async (tx) => {
    // Create a map of store names to store objects
    const stores: Record<string, IDBObjectStore> = {};
    for (const storeName of storeNames) {
      stores[storeName] = tx.objectStore(storeName);
    }

    return operations(stores);
  });
}

/**
 * Helper to promisify IndexedDB requests
 */
export function promisifyRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Helper to promisify IndexedDB cursor operations
 */
export function promisifyCursor<T>(
  request: IDBRequest<IDBCursorWithValue | null>,
  processor: (cursor: IDBCursorWithValue) => T | Promise<T>,
): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const results: T[] = [];
    const promises: Promise<void>[] = [];

    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        try {
          const p = Promise.resolve(processor(cursor)).then((res) => {
            results.push(res);
          });
          promises.push(p);
          cursor.continue();
        } catch (error) {
          reject(error);
        }
      } else {
        Promise.all(promises)
          .then(() => resolve(results))
          .catch(reject);
      }
    };

    request.onerror = () => reject(request.error);
  });
}

/**
 * Utility for counting records in a store or index
 */
export async function countRecords(
  db: IDBDatabase,
  storeName: string,
  indexName?: string,
  query?: IDBValidKey | IDBKeyRange,
): Promise<number> {
  return withTransaction(db, storeName, "readonly", async (tx) => {
    const store = tx.objectStore(storeName);
    const target = indexName ? store.index(indexName) : store;

    const request = target.count(query);
    return promisifyRequest(request);
  });
}

/**
 * Utility for checking if a record exists
 */
export async function recordExists(
  db: IDBDatabase,
  storeName: string,
  key: IDBValidKey,
): Promise<boolean> {
  return withTransaction(db, storeName, "readonly", async (tx) => {
    const store = tx.objectStore(storeName);
    const request = store.getKey(key);
    const result = await promisifyRequest(request);
    return result !== undefined;
  });
}

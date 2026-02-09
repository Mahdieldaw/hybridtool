// IndexedDB Database Initialization for HTOS Document Composition System

import { StoreConfig, MetadataRecord } from "./types";

export const DB_NAME = "OpusDeusDB";
export const DB_VERSION = 7;
export const SCHEMA_VERSION = 7;

// Store configurations - conversation-only architecture
export const STORE_CONFIGS: StoreConfig[] = [
  // 1. Sessions Store
  {
    name: "sessions",
    keyPath: "id",
    indices: [
      { name: "byCreatedAt", keyPath: "createdAt", unique: false },
      { name: "byLastActivity", keyPath: "lastActivity", unique: false },
    ],
  },

  // 2. Threads Store
  {
    name: "threads",
    keyPath: "id",
    indices: [
      { name: "bySessionId", keyPath: "sessionId", unique: false },
      { name: "byParentThreadId", keyPath: "parentThreadId", unique: false },
      {
        name: "bySessionId_createdAt",
        keyPath: ["sessionId", "createdAt"],
        unique: false,
      },
    ],
  },

  // 3. Turns Store
  {
    name: "turns",
    keyPath: "id",
    indices: [
      { name: "bySessionId", keyPath: "sessionId", unique: false },
      { name: "byThreadId", keyPath: "threadId", unique: false },
      { name: "byType", keyPath: "type", unique: false },
      {
        name: "bySessionId_createdAt",
        keyPath: ["sessionId", "createdAt"],
        unique: false,
      },
      {
        name: "byThreadId_createdAt",
        keyPath: ["threadId", "createdAt"],
        unique: false,
      },
      { name: "byUserTurnId", keyPath: "userTurnId", unique: false },
      { name: "byIsComplete", keyPath: "isComplete", unique: false },
    ],
  },

  // 4. Provider Responses Store
  {
    name: "provider_responses",
    keyPath: "id",
    autoIncrement: true,
    indices: [
      { name: "byAiTurnId", keyPath: "aiTurnId", unique: false },
      { name: "byProviderId", keyPath: "providerId", unique: false },
      { name: "byResponseType", keyPath: "responseType", unique: false },
      {
        name: "byCompoundKey",
        keyPath: ["aiTurnId", "providerId", "responseType", "responseIndex"],
        unique: true,
      },
      {
        name: "bySessionId_providerId",
        keyPath: ["sessionId", "providerId"],
        unique: false,
      },
      { name: "bySessionId", keyPath: "sessionId", unique: false },
    ],
  },

  // 5. Provider Contexts Store
  {
    name: "provider_contexts",
    keyPath: ["sessionId", "providerId"],
    indices: [
      { name: "bySessionId", keyPath: "sessionId", unique: false },
      { name: "byProviderId", keyPath: "providerId", unique: false },
    ],
  },

  // 6. Metadata Store (generic key-value for system data)
  {
    name: "metadata",
    keyPath: "key",
    indices: [
      { name: "bySessionId", keyPath: "sessionId", unique: false },
      { name: "byEntityId", keyPath: "entityId", unique: false },
    ],
  },

  // 7. Context Bridges Store
  {
    name: "context_bridges",
    keyPath: "turnId",
    indices: [
      { name: "bySessionId", keyPath: "sessionId", unique: false },
    ],
  },
];

/**
 * Opens the IndexedDB database with proper schema initialization
 */
export async function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
      const db = (event.target as IDBOpenDBRequest).result;
      const oldVersion = event.oldVersion;
      const transaction = (event.target as IDBOpenDBRequest).transaction!;

      console.log(
        `Upgrading database from version ${oldVersion} to ${DB_VERSION}`,
      );

      // Initial schema creation
      if (oldVersion < 1) {
        createInitialSchema(db);

        const metadataStore = transaction.objectStore("metadata");
        const now = Date.now();
        const schemaVersionRecord: MetadataRecord = {
          id: "schema_version_record",
          key: "schema_version",
          value: SCHEMA_VERSION,
          createdAt: now,
          updatedAt: now,
        };
        metadataStore.add(schemaVersionRecord);
      }

      // Migration to v5: Remove document-related stores only
      if (oldVersion < 5 && oldVersion > 0) {
        // Delete document stores (documents, canvas_blocks, ghosts)
        const storesToDelete = ["documents", "canvas_blocks", "ghosts"];

        for (const storeName of storesToDelete) {
          if (db.objectStoreNames.contains(storeName)) {
            db.deleteObjectStore(storeName);
            console.log(`Deleted document store: ${storeName}`);
          }
        }

        // Verify/reconcile all remaining stores and indices
        reconcileSchema(db, transaction);

        // Update schema version in metadata
        const metadataStore = transaction.objectStore("metadata");
        const now = Date.now();
        const rec: MetadataRecord = {
          id: "schema_version_record",
          key: "schema_version",
          value: SCHEMA_VERSION,
          createdAt: now,
          updatedAt: now,
        };
        metadataStore.put(rec);
      }

      // Migration to v6: Add byIsComplete index to turns store
      if (oldVersion < 6) {
        try {
          const turnsStore = transaction.objectStore("turns");
          const existing = new Set(Array.from(turnsStore.indexNames));
          if (!existing.has("byIsComplete")) {
            turnsStore.createIndex("byIsComplete", "isComplete", {
              unique: false,
            });
            console.log("Created index turns.byIsComplete during v6 migration");
          }
        } catch (e) {
          console.warn(
            "Failed to create turns.byIsComplete during v6 migration:",
            e,
          );
        }
        try {
          const metadataStore = transaction.objectStore("metadata");
          const now = Date.now();
          const rec: MetadataRecord = {
            id: "schema_version_record",
            key: "schema_version",
            value: SCHEMA_VERSION,
            createdAt: now,
            updatedAt: now,
          };
          metadataStore.put(rec);
        } catch (_) { }
      }

      // Migration to v7: Add context_bridges store
      if (oldVersion < 7) {
        try {
          if (!db.objectStoreNames.contains("context_bridges")) {
            const bridgeStore = db.createObjectStore("context_bridges", {
              keyPath: "turnId",
            });
            bridgeStore.createIndex("bySessionId", "sessionId", {
              unique: false,
            });
            console.log("Created context_bridges store during v7 migration");
          }

          const metadataStore = transaction.objectStore("metadata");
          const now = Date.now();
          const rec: MetadataRecord = {
            id: "schema_version_record",
            key: "schema_version",
            value: SCHEMA_VERSION,
            createdAt: now,
            updatedAt: now,
          };
          metadataStore.put(rec);
        } catch (e) {
          console.warn("Failed to complete v7 migration:", e);
        }
      }
    };

    request.onsuccess = () => {
      const db = request.result;

      db.onerror = (event) => {
        console.error("Database error:", (event.target as IDBRequest).error);
      };

      db.onversionchange = () => {
        db.close();
        console.warn(
          "Database schema was upgraded in another tab. Please reload.",
        );
      };

      resolve(db);
    };

    request.onerror = () => {
      const error = request.error;
      console.error("Failed to open database:", error);

      if (error?.name === "QuotaExceededError") {
        reject(
          new Error(
            "Storage quota exceeded. Please free up space and try again.",
          ),
        );
      } else {
        reject(error);
      }
    };

    request.onblocked = () => {
      console.warn(
        "Database upgrade blocked by another tab. Please close other tabs.",
      );
    };
  });
}

/**
 * Creates the initial database schema with all stores and indices
 */
function createInitialSchema(db: IDBDatabase): void {
  console.log("Creating initial database schema...");

  for (const config of STORE_CONFIGS) {
    console.log(`Creating store: ${config.name}`);

    const storeOptions: IDBObjectStoreParameters = {
      keyPath: config.keyPath,
    };

    if (config.autoIncrement) {
      storeOptions.autoIncrement = true;
    }

    const store = db.createObjectStore(config.name, storeOptions);

    for (const indexConfig of config.indices) {
      console.log(`  Creating index: ${indexConfig.name}`);

      const indexOptions: IDBIndexParameters = {
        unique: indexConfig.unique || false,
        multiEntry: indexConfig.multiEntry || false,
      };

      store.createIndex(indexConfig.name, indexConfig.keyPath, indexOptions);
    }
  }

  console.log("Initial schema creation completed");
}

/**
 * Reconciles existing schema with expected schema
 * Creates missing stores and indices, useful for recovery from corruption
 */
function reconcileSchema(db: IDBDatabase, transaction: IDBTransaction): void {
  console.log("Reconciling database schema...");

  for (const config of STORE_CONFIGS) {
    let store: IDBObjectStore;

    // Create store if missing
    if (!db.objectStoreNames.contains(config.name)) {
      console.log(`Creating missing store: ${config.name}`);

      const storeOptions: IDBObjectStoreParameters = {
        keyPath: config.keyPath,
      };

      if (config.autoIncrement) {
        storeOptions.autoIncrement = true;
      }

      store = db.createObjectStore(config.name, storeOptions);
    } else {
      store = transaction.objectStore(config.name);
    }

    // Verify/create indices
    const existingIndices = new Set(Array.from(store.indexNames));

    for (const indexConfig of config.indices) {
      if (!existingIndices.has(indexConfig.name)) {
        console.log(
          `  Creating missing index: ${indexConfig.name} in ${config.name}`,
        );
        const indexOptions: IDBIndexParameters = {
          unique: indexConfig.unique || false,
          multiEntry: indexConfig.multiEntry || false,
        };
        store.createIndex(indexConfig.name, indexConfig.keyPath, indexOptions);
      }
    }
  }

  console.log("Schema reconciliation completed");
}

/**
 * Gets the current schema version from the metadata store
 */
export async function getCurrentSchemaVersion(
  db: IDBDatabase,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("metadata", "readonly");
    const store = transaction.objectStore("metadata");
    const request = store.get("schema_version");

    request.onsuccess = () => {
      const record = request.result as MetadataRecord | undefined;
      resolve(record?.value || 0);
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}

/**
 * Checks if the database needs to be upgraded
 */
export async function checkDatabaseHealth(): Promise<{
  isHealthy: boolean;
  currentVersion: number;
  expectedVersion: number;
  issues: string[];
}> {
  try {
    const db = await openDatabase();
    const issues: string[] = [];

    // Check if all expected stores exist
    const storeNames = Array.from(db.objectStoreNames);
    const expectedStores = STORE_CONFIGS.map((config) => config.name);

    for (const expectedStore of expectedStores) {
      if (!storeNames.includes(expectedStore)) {
        issues.push(`Missing object store: ${expectedStore}`);
      }
    }

    db.close();

    return {
      isHealthy: issues.length === 0 && db.version === DB_VERSION,
      currentVersion: db.version,
      expectedVersion: DB_VERSION,
      issues,
    };
  } catch (error) {
    return {
      isHealthy: false,
      currentVersion: 0,
      expectedVersion: DB_VERSION,
      issues: [
        `Database error: ${error instanceof Error ? error.message : "Unknown error"}`,
      ],
    };
  }
}

/**
 * Utility to delete the entire database (for development/testing)
 */
export async function deleteDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const deleteRequest = indexedDB.deleteDatabase(DB_NAME);

    deleteRequest.onsuccess = () => {
      console.log("Database deleted successfully");
      resolve();
    };

    deleteRequest.onerror = () => {
      reject(deleteRequest.error);
    };

    deleteRequest.onblocked = () => {
      console.warn(
        "Database deletion blocked. Please close all tabs using this database.",
      );
    };
  });
}

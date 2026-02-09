// src/persistence/index.ts

export * from "./types";
export * from "./database";
export * from "./transactions";
export * from "./SessionManager";

import { openDatabase, STORE_CONFIGS, SCHEMA_VERSION } from "./database";
import { SimpleIndexedDBAdapter } from "./SimpleIndexedDBAdapter";

// Simplified PersistenceLayer interface
export interface PersistenceLayer {
  adapter: SimpleIndexedDBAdapter;
  close: () => Promise<void>;
}

export async function initializePersistenceLayer(): Promise<PersistenceLayer> {
  const db = await openDatabase();
  const storeNames = Array.from(db.objectStoreNames);
  const expectedStores = STORE_CONFIGS.map((cfg) => cfg.name);
  const missingStores = expectedStores.filter(
    (name) => !storeNames.includes(name),
  );

  if (missingStores.length > 0) {
    db.close();
    throw new Error(
      `SchemaError: Missing object stores: ${missingStores.join(", ")}`,
    );
  }

  try {
    const tx = db.transaction("metadata", "readonly");
    const store = tx.objectStore("metadata");
    const versionReq = store.get("schema_version");
    const version: number = await new Promise((resolve, reject) => {
      versionReq.onsuccess = () =>
        resolve((versionReq.result && versionReq.result.value) || 0);
      versionReq.onerror = () => reject(versionReq.error);
    });

    if (version !== SCHEMA_VERSION) {
      db.close();
      throw new Error(
        `SchemaError: schema_version mismatch (current=${version}, expected=${SCHEMA_VERSION})`,
      );
    }
  } catch (e) {
    db.close();
    if (e instanceof Error && e.message && e.message.includes("schema_version mismatch")) {
      throw e;
    }
    throw new Error(
      `SchemaError: unable to read metadata schema_version: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
  }

  const adapter = new SimpleIndexedDBAdapter();
  await adapter.init({ autoRepair: true });

  return {
    adapter,
    close: async () => {
      await adapter.close();
      db.close();
    },
  };
}

export function isPersistenceAvailable(): boolean {
  return typeof indexedDB !== "undefined" && typeof IDBDatabase !== "undefined";
}

export async function getPersistenceHealth(): Promise<{
  available: boolean;
  adapterReady: boolean;
  databaseOpen: boolean;
  error?: string;
}> {
  try {
    const available = isPersistenceAvailable();
    if (!available) {
      return {
        available: false,
        adapterReady: false,
        databaseOpen: false,
        error: "IndexedDB not available",
      };
    }

    const db = await openDatabase();
    let databaseOpen = false;
    let adapterReady = false;
    
    try {
      try {
        const tx = db.transaction(["sessions"], "readonly");
        databaseOpen = tx !== null;
      } catch (error) {
        databaseOpen = false;
      }

      // Test the SimpleIndexedDBAdapter
      const adapter = new SimpleIndexedDBAdapter();
      let initSuccess = false;
      try {
        await adapter.init();
        initSuccess = true;
        adapterReady = await adapter.isReady();
      } finally {
        if (initSuccess) {
          await adapter.close();
        }
      }
      
      return {
        available: true,
        adapterReady,
        databaseOpen,
      };
    } finally {
      db.close();
    }
  } catch (error) {
    return {
      available: false,
      adapterReady: false,
      databaseOpen: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

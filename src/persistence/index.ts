// src/persistence/index.ts

export * from './types';
export * from './database';
export * from './transactions';
export * from './session-manager';

import { openDatabase, STORE_CONFIGS, SCHEMA_VERSION } from './database';
import { SimpleIndexedDBAdapter } from './simple-indexeddb-adapter';

// Simplified PersistenceLayer interface
interface PersistenceLayer {
  adapter: SimpleIndexedDBAdapter;
  close: () => Promise<void>;
}

export async function initializePersistenceLayer(): Promise<PersistenceLayer> {
  const dbPromise = openDatabase();
  const db = await Promise.race([
    dbPromise,
    new Promise<never>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error('Timeout: openDatabase did not resolve within 10s (upgrade may be blocked)')
          ),
        10_000
      )
    ),
  ]);
  const storeNames = Array.from(db.objectStoreNames);
  const expectedStores = STORE_CONFIGS.map((cfg) => cfg.name);
  const missingStores = expectedStores.filter((name) => !storeNames.includes(name));

  if (missingStores.length > 0) {
    db.close();
    throw new Error(`SchemaError: Missing object stores: ${missingStores.join(', ')}`);
  }

  try {
    const tx = db.transaction('metadata', 'readonly');
    const store = tx.objectStore('metadata');
    const versionReq = store.get('schema_version');
    const version: number = await new Promise((resolve, reject) => {
      versionReq.onsuccess = () => resolve((versionReq.result && versionReq.result.value) || 0);
      versionReq.onerror = () => reject(versionReq.error);
    });

    if (version !== SCHEMA_VERSION) {
      db.close();
      throw new Error(
        `SchemaError: schema_version mismatch (current=${version}, expected=${SCHEMA_VERSION})`
      );
    }
  } catch (e) {
    db.close();
    if (e instanceof Error && e.message && e.message.includes('schema_version mismatch')) {
      throw e;
    }
    throw new Error(
      `SchemaError: unable to read metadata schema_version: ${
        e instanceof Error ? e.message : String(e)
      }`
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

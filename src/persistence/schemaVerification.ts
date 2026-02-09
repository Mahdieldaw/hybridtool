import { checkDatabaseHealth, deleteDatabase, openDatabase } from "./database";

export interface SchemaHealth {
  isHealthy: boolean;
  currentVersion: number;
  expectedVersion: number;
  issues: string[];
}

/**
 * Verifies database schema health; if unhealthy and autoRepair=true, performs delete-and-recreate.
 * Returns whether a repair was performed, the new database if repaired, and the health report.
 */
export async function verifySchemaAndRepair(autoRepair: boolean): Promise<{
  repaired: boolean;
  db?: IDBDatabase;
  health: SchemaHealth;
}> {
  const health = await checkDatabaseHealth();
  if (health.isHealthy) {
    return { repaired: false, health };
  }


  const versionMismatch = health.currentVersion !== health.expectedVersion;
  if (!autoRepair) {
    const msg = `SchemaError: ${versionMismatch ? "schema_version mismatch" : "missing stores"}; issues=${health.issues?.join("; ")}`;
    throw new Error(msg);
  }

  console.warn(
    "[SchemaVerification] Schema unhealthy, attempting auto-repair...",
    health,
  );
  try {
    // Best effort close if a DB is open elsewhere; deletion will proceed regardless
    await deleteDatabase();
    const db = await openDatabase();
    console.log(
      "[SchemaVerification] Auto-repair completed: database recreated",
    );
    const freshHealth = await checkDatabaseHealth();
    return { repaired: true, db, health: freshHealth };
  } catch (error) {
    console.error("[SchemaVerification] verifySchemaAndRepair failed:", error);
    throw error instanceof Error ? error : new Error(String(error));
  }
}

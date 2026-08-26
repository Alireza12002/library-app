/**
 * Migration runner — ARCHITECTURE.md §4.
 *
 * Uses SQLite's `user_version` pragma as the schema version: no bookkeeping
 * table required, and it is written atomically with the migration itself.
 *
 * Each pending migration runs inside its own transaction, so a failure leaves
 * the database at the last successfully applied version rather than half-migrated.
 */
import type { DatabaseConnection } from './connection';
import { LATEST_VERSION, MIGRATIONS, type Migration } from './migrations';

export async function getSchemaVersion(db: DatabaseConnection): Promise<number> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version', []);
  return row?.user_version ?? 0;
}

/**
 * Applies every migration newer than the current schema version, in order.
 * Returns the version the database is on afterwards. Safe to call repeatedly:
 * it is a no-op once the schema is current.
 */
export async function runMigrations(db: DatabaseConnection): Promise<number> {
  const current = await getSchemaVersion(db);

  if (current > LATEST_VERSION) {
    throw new Error(
      `Database schema version ${current} is newer than this build supports (${LATEST_VERSION}). ` +
        'Downgrades are not supported.',
    );
  }

  const pending = [...MIGRATIONS]
    .filter((migration) => migration.version > current)
    .sort((a, b) => a.version - b.version);

  for (const migration of pending) {
    await applyMigration(db, migration);
  }

  return getSchemaVersion(db);
}

async function applyMigration(db: DatabaseConnection, migration: Migration): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.execAsync(migration.sql);
    // PRAGMA does not accept bound parameters; version is an integer literal
    // from our own registry, never user input.
    await db.execAsync(`PRAGMA user_version = ${migration.version}`);
  });
}

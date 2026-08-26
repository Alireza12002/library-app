/**
 * Database client — the single SQLite connection for the whole app
 * (ARCHITECTURE.md §4, R10).
 *
 * Responsibilities: open the database once, enable WAL and foreign keys, run
 * pending migrations, and hand out the connection. Nothing else in the app may
 * call `openDatabaseAsync`.
 */
import * as SQLite from 'expo-sqlite';

import type { DatabaseConnection } from './connection';
import { runMigrations } from './migrate';

export const DATABASE_NAME = 'library.db';

let connection: DatabaseConnection | null = null;
let opening: Promise<DatabaseConnection> | null = null;

/**
 * Returns the shared connection, opening and migrating it on first call.
 * Concurrent callers await the same initialisation rather than racing to open
 * a second connection.
 */
export function getDatabase(): Promise<DatabaseConnection> {
  if (connection) return Promise.resolve(connection);
  opening ??= open();
  return opening;
}

async function open(): Promise<DatabaseConnection> {
  try {
    const db = await SQLite.openDatabaseAsync(DATABASE_NAME);

    // WAL survives interrupted writes better than the default journal (R10).
    // Foreign keys are OFF by default in SQLite and must be set per connection,
    // otherwise ON DELETE CASCADE silently does nothing.
    await db.execAsync('PRAGMA journal_mode = WAL');
    await db.execAsync('PRAGMA foreign_keys = ON');

    await runMigrations(db);

    connection = db;
    return db;
  } catch (error) {
    // Let the next call retry instead of caching a rejected promise.
    opening = null;
    throw error;
  }
}

/**
 * Drops the cached connection. Intended for tests and for teardown; the app
 * itself keeps one connection for its whole lifetime.
 */
export function resetDatabaseForTesting(): void {
  connection = null;
  opening = null;
}

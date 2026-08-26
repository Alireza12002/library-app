/**
 * In-memory DatabaseConnection for repository tests (ARCHITECTURE.md §9).
 *
 * Backed by Node's built-in `node:sqlite` — the same SQLite engine expo-sqlite
 * wraps on device, so schema, constraints, FK cascades and collations behave
 * identically. This keeps repository tests runnable with no emulator, no
 * native build and no extra dependency.
 *
 * Test-only: nothing in the app imports this file. It lives outside src/ so the
 * app's tsconfig never sees a Node-only import, and it is never bundled.
 */
import { DatabaseSync } from 'node:sqlite';

import type { DatabaseConnection, SqlParams, SqlRunResult } from '@/data/db/connection';
import { runMigrations } from '@/data/db/migrate';

type SqliteValue = string | number | bigint | null | Uint8Array;

/**
 * Wraps node:sqlite's synchronous API in the async connection port.
 *
 * Note: written without TypeScript parameter properties or enums — Node runs
 * these files in strip-only mode, which rejects syntax that needs real codegen.
 */
class NodeSqliteConnection implements DatabaseConnection {
  readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  async execAsync(source: string): Promise<void> {
    this.db.exec(source);
  }

  async runAsync(source: string, params: SqlParams): Promise<SqlRunResult> {
    const result = this.db.prepare(source).run(...(params as SqliteValue[]));
    return {
      lastInsertRowId: Number(result.lastInsertRowid),
      changes: Number(result.changes),
    };
  }

  async getFirstAsync<T>(source: string, params: SqlParams): Promise<T | null> {
    const row = this.db.prepare(source).get(...(params as SqliteValue[]));
    return (row as T | undefined) ?? null;
  }

  async getAllAsync<T>(source: string, params: SqlParams): Promise<T[]> {
    return this.db.prepare(source).all(...(params as SqliteValue[])) as T[];
  }

  async withTransactionAsync(task: () => Promise<void>): Promise<void> {
    this.db.exec('BEGIN');
    try {
      await task();
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}

export interface TestDatabase {
  connection: DatabaseConnection;
  close(): void;
}

/** Adapts a raw node:sqlite database to the connection port. */
export function wrapConnection(db: DatabaseSync): DatabaseConnection {
  return new NodeSqliteConnection(db);
}

/**
 * Opens a fresh in-memory database with foreign keys enabled and all
 * migrations applied — the same sequence src/data/db/client.ts performs.
 */
export async function createTestDatabase(): Promise<TestDatabase> {
  const db = new DatabaseSync(':memory:');
  // Must match client.ts: without this, ON DELETE CASCADE is silently inert.
  db.exec('PRAGMA foreign_keys = ON');

  const connection = new NodeSqliteConnection(db);
  await runMigrations(connection);

  return {
    connection,
    close: () => db.close(),
  };
}

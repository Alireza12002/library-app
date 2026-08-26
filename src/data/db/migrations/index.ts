/**
 * Migration registry — ARCHITECTURE.md §4.
 *
 * Forward-only and append-only: add a new entry with the next version number;
 * never edit or reorder a shipped migration. `runMigrations` applies every
 * entry whose version exceeds the database's current `user_version`.
 */
import { MIGRATION_001 } from './001_initial';

export interface Migration {
  /** Sequential, starting at 1. Stored in SQLite's `user_version`. */
  version: number;
  name: string;
  /** SQL executed inside a transaction. */
  sql: string;
}

export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: 'initial', sql: MIGRATION_001 },
];

/** Target schema version — the highest registered migration. */
export const LATEST_VERSION: number = MIGRATIONS.reduce(
  (max, migration) => Math.max(max, migration.version),
  0,
);

/**
 * Migration registry — ARCHITECTURE.md §4.
 *
 * Forward-only and append-only: add a new entry with the next version number;
 * never edit or reorder a shipped migration. `runMigrations` applies every
 * entry whose version exceeds the database's current `user_version`.
 */
import { MIGRATION_001 } from './001_initial';
import { MIGRATION_002 } from './002_text_cache';
import { MIGRATION_003 } from './003_bookmark_reflow';
import { MIGRATION_004 } from './004_reflow_documents';
import { MIGRATION_005 } from './005_reflow_reading_position';
import { MIGRATION_006 } from './006_reading_settings_columns';

export interface Migration {
  /** Sequential, starting at 1. Stored in SQLite's `user_version`. */
  version: number;
  name: string;
  /** SQL executed inside a transaction. */
  sql: string;
}

export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: 'initial', sql: MIGRATION_001 },
  { version: 2, name: 'text_cache', sql: MIGRATION_002 },
  { version: 3, name: 'bookmark_reflow', sql: MIGRATION_003 },
  { version: 4, name: 'reflow_documents', sql: MIGRATION_004 },
  { version: 5, name: 'reflow_reading_position', sql: MIGRATION_005 },
  { version: 6, name: 'reading_settings_columns', sql: MIGRATION_006 },
];

/** Target schema version — the highest registered migration. */
export const LATEST_VERSION: number = MIGRATIONS.reduce(
  (max, migration) => Math.max(max, migration.version),
  0,
);

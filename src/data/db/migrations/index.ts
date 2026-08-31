/**
 * Migration registry — ARCHITECTURE.md §4.
 *
 * Forward-only and append-only: add a new entry with the next version number;
 * never edit or reorder a shipped migration. `runMigrations` applies every
 * entry whose version exceeds the database's current `user_version`.
 */
import { MIGRATION_001 } from './001_initial';
import { MIGRATION_002 } from './002_text_cache';


export const MIGRATION_003 = `
-- Add Reflow bookmark position columns (nullable for backward compat)
ALTER TABLE bookmarks ADD COLUMN block_index INTEGER;
ALTER TABLE bookmarks ADD COLUMN char_offset INTEGER;
ALTER TABLE bookmarks ADD COLUMN text_anchor TEXT;

-- Index for fast Reflow position lookups by book
CREATE INDEX idx_bookmarks_book_block ON bookmarks (book_id, block_index);
`;

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
];

/** Target schema version — the highest registered migration. */
export const LATEST_VERSION: number = MIGRATIONS.reduce(
  (max, migration) => Math.max(max, migration.version),
  0,
);

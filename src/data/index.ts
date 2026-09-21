/**
 * Data layer entry point (ARCHITECTURE.md §3).
 *
 * Services import from here. Nothing above the service layer may import this
 * module — the UI reaches data only through services (enforced by
 * eslint.config.js).
 */
import { getDatabase } from './db/client';
import {
  createBookmarkRepository,
  type BookmarkRepository,
} from './repositories/bookmarkRepository';
import { createBookRepository, type BookRepository } from './repositories/bookRepository';
import {
  createReadingSettingsRepository,
  type ReadingSettingsRepository,
} from './repositories/readingSettingsRepository';
import {
  createReflowDocumentRepository,
  type ReflowDocumentRepository,
} from './repositories/reflowDocumentRepository';
import {
  createTextCacheRepository,
  type TextCacheRepository,
} from './repositories/textCacheRepository';

export { getDatabase, resetDatabaseForTesting, DATABASE_NAME } from './db/client';
export { runMigrations, getSchemaVersion } from './db/migrate';
export { LATEST_VERSION, MIGRATIONS, type Migration } from './db/migrations';
export type { DatabaseConnection, SqlParams, SqlRunResult } from './db/connection';
export { createBookRepository, type BookRepository } from './repositories/bookRepository';
export {
  createBookmarkRepository,
  type BookmarkRepository,
} from './repositories/bookmarkRepository';
export {
  createTextCacheRepository,
  type TextCacheRepository,
} from './repositories/textCacheRepository';
export {
  createReflowDocumentRepository,
  type NewReflowDocument,
  type ReflowDocumentRepository,
} from './repositories/reflowDocumentRepository';
export {
  createReadingSettingsRepository,
  type ReadingSettingsRepository,
} from './repositories/readingSettingsRepository';

export interface Repositories {
  books: BookRepository;
  bookmarks: BookmarkRepository;
  textCache: TextCacheRepository;
  reflowDocuments: ReflowDocumentRepository;
  readingSettings: ReadingSettingsRepository;
}

let cached: Repositories | null = null;

/**
 * Repositories bound to the shared connection. Opens and migrates the database
 * on first call.
 */
export async function getRepositories(): Promise<Repositories> {
  if (cached) return cached;
  const db = await getDatabase();
  cached = {
    books: createBookRepository(db),
    bookmarks: createBookmarkRepository(db),
    textCache: createTextCacheRepository(db),
    reflowDocuments: createReflowDocumentRepository(db),
    readingSettings: createReadingSettingsRepository(db),
  };
  return cached;
}

/** Test/teardown seam — drops the memoised repositories. */
export function resetRepositoriesForTesting(): void {
  cached = null;
}

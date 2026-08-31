/**
 * Migration 002 — text extraction cache (ARCHITECTURE.md §4).
 *
 * Stores extracted page text for Reflow Reader.
 * - book_id + page is unique (one cached extraction per page)
 * - Indexed for fast lookups by book_id and page
 * - extracted_at for cache invalidation/debugging
 */
export const MIGRATION_002 = `
CREATE TABLE text_cache (
  id            TEXT PRIMARY KEY NOT NULL,
  book_id       TEXT NOT NULL,
  page          INTEGER NOT NULL CHECK (page >= 0),
  text          TEXT NOT NULL,
  extracted_at  INTEGER NOT NULL,
  UNIQUE (book_id, page)
);

-- Fast lookup by book and page
CREATE INDEX idx_text_cache_book_page ON text_cache (book_id, page);

-- Listing all cached pages for a book (e.g., for deletion)
CREATE INDEX idx_text_cache_book_id ON text_cache (book_id);
`;

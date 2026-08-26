/**
 * Migration 001 — initial schema (ARCHITECTURE.md §4).
 *
 * Conventions:
 * - Timestamps are unix milliseconds (INTEGER), never ISO strings.
 * - Page numbers are 0-based, matching the domain and the PDF engine.
 * - Forward-only: once shipped, this file is never edited. Corrections ship
 *   as a new numbered migration.
 */
export const MIGRATION_001 = `
CREATE TABLE books (
  id             TEXT PRIMARY KEY NOT NULL,
  title          TEXT NOT NULL CHECK (length(trim(title)) > 0),
  author         TEXT,
  file_uri       TEXT NOT NULL UNIQUE,
  file_name      TEXT NOT NULL,
  file_size      INTEGER NOT NULL CHECK (file_size >= 0),
  page_count     INTEGER CHECK (page_count IS NULL OR page_count > 0),
  last_page      INTEGER NOT NULL DEFAULT 0 CHECK (last_page >= 0),
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  last_opened_at INTEGER
);

-- Library list ordering: most recently read first, then newest import.
CREATE INDEX idx_books_last_opened_at ON books (last_opened_at DESC);
CREATE INDEX idx_books_created_at ON books (created_at DESC);
CREATE INDEX idx_books_title ON books (title COLLATE NOCASE);

CREATE TABLE bookmarks (
  id         TEXT PRIMARY KEY NOT NULL,
  book_id    TEXT NOT NULL REFERENCES books (id) ON DELETE CASCADE,
  page       INTEGER NOT NULL CHECK (page >= 0),
  title      TEXT,
  note       TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (book_id, page)
);

-- Listing a book's bookmarks in page order.
CREATE INDEX idx_bookmarks_book_id_page ON bookmarks (book_id, page);

CREATE TABLE reading_settings (
  id           TEXT PRIMARY KEY NOT NULL CHECK (id = 'default'),
  mode         TEXT NOT NULL DEFAULT 'pdf' CHECK (mode IN ('pdf', 'reflow')),
  theme        TEXT NOT NULL DEFAULT 'light' CHECK (theme IN ('light', 'sepia', 'dark')),
  font_family  TEXT NOT NULL DEFAULT 'system',
  font_size_pt REAL NOT NULL DEFAULT 16 CHECK (font_size_pt > 0),
  line_height  REAL NOT NULL DEFAULT 1.5 CHECK (line_height > 0),
  invert_pages INTEGER NOT NULL DEFAULT 0 CHECK (invert_pages IN (0, 1))
);

INSERT INTO reading_settings (id) VALUES ('default');
`;

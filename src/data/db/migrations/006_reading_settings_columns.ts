/**
 * Migration 006 — complete the `reading_settings` row (ARCHITECTURE.md §4).
 *
 * Migration 001 created the single-row settings table but without the three
 * fields the reader has since grown: PDF fit mode, reflow column width and page
 * gap. Reader settings — most importantly the reading MODE — were meanwhile
 * "persisted" through a storage module that is not part of the app, so the mode
 * never survived a restart and a book always reopened in PDF mode, ignoring its
 * saved Reflow position. Settings now live in this table, read and written
 * through the settings repository like every other persisted value.
 *
 * Forward-only: this file is never edited once shipped.
 */
export const MIGRATION_006 = `
ALTER TABLE reading_settings ADD COLUMN fit_mode TEXT NOT NULL DEFAULT 'width'
  CHECK (fit_mode IN ('width', 'height', 'both'));
ALTER TABLE reading_settings ADD COLUMN content_width_pt REAL NOT NULL DEFAULT 640
  CHECK (content_width_pt > 0);
ALTER TABLE reading_settings ADD COLUMN page_gap REAL NOT NULL DEFAULT 0
  CHECK (page_gap >= 0);
`;

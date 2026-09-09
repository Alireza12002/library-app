/**
 * Migration 005 — independent Reflow reading position (ARCHITECTURE.md §4).
 *
 * Reflow keeps its own reading position per book, separate from the PDF page
 * (`last_page`). Two nullable columns on `books` — the same home as `last_page`,
 * because reading progress is one row per book with one write per update:
 *
 * - reflow_block_index: index into the book's reflow document `blocks` array.
 * - reflow_page_index:  the source PDF page that block came from, so a stale
 *                       block index (regenerated document) can be re-resolved
 *                       semantically from the page anchor instead of crashing.
 *
 * NULL means "no reflow position saved yet"; the reader then falls back to
 * mapping the current PDF page through the document's page index.
 * Forward-only: this file is never edited once shipped.
 */
export const MIGRATION_005 = `
ALTER TABLE books ADD COLUMN reflow_block_index INTEGER;
ALTER TABLE books ADD COLUMN reflow_page_index INTEGER;
`;

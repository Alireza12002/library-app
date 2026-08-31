/**
 * Migration 003 — bookmark schema extension for Reflow text-position bookmarks (ARCHITECTURE.md §4).
 *
 * Adds columns for Reflow-specific bookmark data:
 * - block_index: which text block the bookmark maps to
 * - char_offset: character offset within that block
 * - text_anchor: first ~50 chars for position verification on restore
 *
 * Existing PDF page bookmarks remain compatible — new columns are nullable.
 * Forward-only: this file is never edited once shipped.
 */
export const MIGRATION_003 = `\n-- Add Reflow bookmark position columns (nullable for backward compat)\nALTER TABLE bookmarks ADD COLUMN block_index INTEGER;\nALTER TABLE bookmarks ADD COLUMN char_offset INTEGER;\nALTER TABLE bookmarks ADD COLUMN text_anchor TEXT;\n\n-- Index for fast Reflow position lookups by book\nCREATE INDEX idx_bookmarks_book_block ON bookmarks (book_id, block_index);\n`;

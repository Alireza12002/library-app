/**
 * Migration 004 — full-book reflow documents (ARCHITECTURE.md §4).
 *
 * One row per book holds the ENTIRE generated reflow document as JSON, so
 * switching into reflow mode is a single indexed read rather than a re-extraction
 * of the whole PDF.
 *
 * Why one JSON blob and not a `reflow_blocks` table: the document is always read
 * and written whole (the reader needs every block to build its page index and to
 * scroll anywhere), it is never queried by block, and a 500-page book is tens of
 * thousands of rows that would each cost a row read. A single row keeps the load
 * to one query. The PDF-page relationship is preserved *inside* the JSON — every
 * block carries its `pageIndex` — so no mapping information is lost by storing it
 * this way.
 *
 * Staleness is handled by two columns rather than a timestamp heuristic:
 *  - `format_version` invalidates every document when the pipeline changes;
 *  - `source_fingerprint` invalidates one book when its PDF is replaced.
 *
 * ON DELETE CASCADE ties the document's lifetime to the book, so removing a book
 * cannot leave orphaned reflow data behind.
 */
export const MIGRATION_004 = `
CREATE TABLE reflow_documents (
  book_id            TEXT PRIMARY KEY NOT NULL
                       REFERENCES books (id) ON DELETE CASCADE,
  format_version     INTEGER NOT NULL,
  source_fingerprint TEXT NOT NULL,
  page_count         INTEGER NOT NULL CHECK (page_count >= 0),
  block_count        INTEGER NOT NULL CHECK (block_count >= 0),
  -- JSON array of blocks, each with its source pageIndex.
  blocks             TEXT NOT NULL,
  generated_at       INTEGER NOT NULL
);

-- Lets the "is a usable document already stored?" check hit an index instead of
-- deserializing the blocks column.
CREATE INDEX idx_reflow_documents_validity
  ON reflow_documents (book_id, format_version, source_fingerprint);
`;

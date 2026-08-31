/**
 * Text cache repository — all SQL touching `text_cache` lives here
 * (ARCHITECTURE.md §3).
 *
 * Stores extracted page text for Reflow Reader.
 * - book_id + page is unique (one cached extraction per page)
 * - Indexed for fast lookups by book_id and page
 * - extracted_at for cache invalidation/debugging
 */
import type { DatabaseConnection } from '@/data/db/connection';
import { newId } from '@/core/ids';

export interface CachedPageText {
  id: string;
  bookId: string;
  page: number;
  text: string;
  extractedAt: Date;
}

export interface TextCacheRepository {
  /** Get cached text for a specific page. Returns null if not cached. */
  getPage(bookId: string, page: number): Promise<CachedPageText | null>;
  /** Save or update cached text for a page. */
  savePage(bookId: string, page: number, text: string, now?: Date): Promise<CachedPageText>;
  /** Check if a page is cached. */
  hasPage(bookId: string, page: number): Promise<boolean>;
  /** Delete cached text for a specific page. Returns true if a row was deleted. */
  deletePage(bookId: string, page: number): Promise<boolean>;
  /** Delete all cached text for a book. Returns number of rows deleted. */
  deleteForBook(bookId: string): Promise<number>;
  /** List all cached pages for a book in page order. */
  listForBook(bookId: string): Promise<CachedPageText[]>;
}

const COLUMNS = 'id, book_id, page, text, extracted_at';

function toCachedPageText(row: {
  id: string;
  book_id: string;
  page: number;
  text: string;
  extracted_at: number;
}): CachedPageText {
  return {
    id: row.id,
    bookId: row.book_id,
    page: row.page,
    text: row.text,
    extractedAt: new Date(row.extracted_at),
  };
}

export function createTextCacheRepository(db: DatabaseConnection): TextCacheRepository {
  return {
    async getPage(bookId, page) {
      const row = await db.getFirstAsync<{
        id: string;
        book_id: string;
        page: number;
        text: string;
        extracted_at: number;
      }>(`SELECT ${COLUMNS} FROM text_cache WHERE book_id = ? AND page = ?`, [bookId, page]);
      return row ? toCachedPageText(row) : null;
    },

    async savePage(bookId, page, text, now = new Date()) {
      const id = newId();
      const timestamp = now.getTime();

      // UPSERT: insert or replace on unique conflict (book_id, page)
      await db.runAsync(
        `INSERT INTO text_cache (id, book_id, page, text, extracted_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(book_id, page) DO UPDATE SET
           text = excluded.text,
           extracted_at = excluded.extracted_at`,
        [id, bookId, page, text, timestamp],
      );

      // Return the saved row
      const row = await db.getFirstAsync<{
        id: string;
        book_id: string;
        page: number;
        text: string;
        extracted_at: number;
      }>(`SELECT ${COLUMNS} FROM text_cache WHERE book_id = ? AND page = ?`, [bookId, page]);
      if (!row) {
        throw new Error(
          `Text cache entry vanished immediately after upsert for book ${bookId} page ${page}`,
        );
      }
      return toCachedPageText(row);
    },

    async hasPage(bookId, page) {
      const row = await db.getFirstAsync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM text_cache WHERE book_id = ? AND page = ?',
        [bookId, page],
      );
      return (row?.count ?? 0) > 0;
    },

    async deletePage(bookId, page) {
      const result = await db.runAsync('DELETE FROM text_cache WHERE book_id = ? AND page = ?', [
        bookId,
        page,
      ]);
      return result.changes > 0;
    },

    async deleteForBook(bookId) {
      const result = await db.runAsync('DELETE FROM text_cache WHERE book_id = ?', [bookId]);
      return result.changes;
    },

    async listForBook(bookId) {
      const rows = await db.getAllAsync<{
        id: string;
        book_id: string;
        page: number;
        text: string;
        extracted_at: number;
      }>(`SELECT ${COLUMNS} FROM text_cache WHERE book_id = ? ORDER BY page ASC`, [bookId]);
      return rows.map(toCachedPageText);
    },
  };
}

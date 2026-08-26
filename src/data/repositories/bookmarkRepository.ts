/**
 * Bookmark repository — all SQL touching `bookmarks` lives here
 * (ARCHITECTURE.md §3).
 *
 * `page` is a 0-based index. UNIQUE(book_id, page) means a page can hold at
 * most one bookmark; `create` surfaces that as a domain error rather than
 * leaking the SQLite constraint message.
 */
import type { Bookmark, NewBookmark } from '@/core/entities/bookmark';
import { DomainError } from '@/core/errors';
import { newId } from '@/core/ids';
import type { DatabaseConnection } from '@/data/db/connection';
import { toBookmark, type BookmarkRow } from './mappers';

const COLUMNS = 'id, book_id, page, title, note, created_at';

export interface BookmarkRepository {
  create(input: NewBookmark, now?: Date): Promise<Bookmark>;
  listForBook(bookId: string): Promise<Bookmark[]>;
  findById(id: string): Promise<Bookmark | null>;
  remove(id: string): Promise<boolean>;
  removeForBook(bookId: string): Promise<number>;
}

export function createBookmarkRepository(db: DatabaseConnection): BookmarkRepository {
  async function findById(id: string): Promise<Bookmark | null> {
    const row = await db.getFirstAsync<BookmarkRow>(
      `SELECT ${COLUMNS} FROM bookmarks WHERE id = ?`,
      [id],
    );
    return row ? toBookmark(row) : null;
  }

  return {
    async create(input, now = new Date()) {
      if (!Number.isInteger(input.page) || input.page < 0) {
        throw new DomainError(
          'unknown',
          `page must be a non-negative integer, received ${input.page}`,
        );
      }

      const id = input.id ?? newId();

      try {
        await db.runAsync(`INSERT INTO bookmarks (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?)`, [
          id,
          input.bookId,
          input.page,
          input.title ?? null,
          input.note ?? null,
          now.getTime(),
        ]);
      } catch (error) {
        // Both the FK failure (unknown book) and the UNIQUE failure (page
        // already bookmarked) arrive as opaque SQLite errors; translate them.
        const message = error instanceof Error ? error.message : String(error);
        if (/FOREIGN KEY/i.test(message)) {
          throw new DomainError('book_not_found', `No book with id ${input.bookId}`, error);
        }
        if (/UNIQUE/i.test(message)) {
          throw new DomainError(
            'unknown',
            `Page ${input.page} of book ${input.bookId} is already bookmarked`,
            error,
          );
        }
        throw error;
      }

      const created = await findById(id);
      if (!created) {
        throw new DomainError('unknown', `Bookmark ${id} vanished immediately after insert`);
      }
      return created;
    },

    listForBook(bookId) {
      return db
        .getAllAsync<BookmarkRow>(
          `SELECT ${COLUMNS} FROM bookmarks WHERE book_id = ? ORDER BY page ASC`,
          [bookId],
        )
        .then((rows) => rows.map(toBookmark));
    },

    findById,

    async remove(id) {
      const result = await db.runAsync('DELETE FROM bookmarks WHERE id = ?', [id]);
      return result.changes > 0;
    },

    async removeForBook(bookId) {
      const result = await db.runAsync('DELETE FROM bookmarks WHERE book_id = ?', [bookId]);
      return result.changes;
    },
  };
}

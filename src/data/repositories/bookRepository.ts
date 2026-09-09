/**
 * Book repository — all SQL touching `books` lives here (ARCHITECTURE.md §3).
 *
 * Contract:
 * - Takes and returns domain entities; callers never see rows or SQL.
 * - Every statement binds parameters; no string interpolation of values.
 * - Timestamps are supplied by the caller-visible `now` seam so services can
 *   use a fake clock in tests (§9).
 * - Page numbers are 0-based.
 */
import type { Book, BookMetadataPatch, BookSort, BookSummary, NewBook } from '@/core/entities/book';
import type { ReflowPosition } from '@/core/entities/reflowDocument';
import { DomainError } from '@/core/errors';
import { newId } from '@/core/ids';
import type { DatabaseConnection } from '@/data/db/connection';
import { toBook, toBookSummary, type BookRow } from './mappers';

const COLUMNS =
  'id, title, author, file_uri, file_name, file_size, page_count, last_page, reflow_block_index, reflow_page_index, created_at, updated_at, last_opened_at';

const ORDER_BY: Record<BookSort, string> = {
  // Most recently opened first; never-opened books fall to the back, newest import first.
  recent: 'last_opened_at IS NULL, last_opened_at DESC, created_at DESC',
  title: 'title COLLATE NOCASE ASC',
  added: 'created_at DESC',
};

export interface BookRepository {
  create(input: NewBook, now?: Date): Promise<Book>;
  findById(id: string): Promise<Book | null>;
  list(sort?: BookSort): Promise<BookSummary[]>;
  updateMetadata(id: string, patch: BookMetadataPatch, now?: Date): Promise<Book>;
  updateProgress(id: string, lastPage: number, now?: Date): Promise<Book>;
  /**
   * Persists the book's Reflow reading position WITHOUT touching `last_page` —
   * the two modes' positions are independent. Null clears the position.
   */
  updateReflowPosition(id: string, position: ReflowPosition | null, now?: Date): Promise<Book>;
  /** Stamps lastOpenedAt/updatedAt without touching the page position. */
  markOpened(id: string, now?: Date): Promise<Book>;
  remove(id: string): Promise<boolean>;
  count(): Promise<number>;
}

export function createBookRepository(db: DatabaseConnection): BookRepository {
  async function requireById(id: string): Promise<Book> {
    const book = await findById(id);
    if (!book) throw new DomainError('book_not_found', `No book with id ${id}`);
    return book;
  }

  async function findById(id: string): Promise<Book | null> {
    const row = await db.getFirstAsync<BookRow>(`SELECT ${COLUMNS} FROM books WHERE id = ?`, [id]);
    return row ? toBook(row) : null;
  }

  return {
    async create(input, now = new Date()) {
      const id = input.id ?? newId();
      const timestamp = now.getTime();

      await db.runAsync(
        `INSERT INTO books (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, ?, ?, NULL)`,
        [
          id,
          input.title,
          input.author ?? null,
          input.fileUri,
          input.fileName,
          input.fileSize,
          input.pageCount ?? null,
          timestamp,
          timestamp,
        ],
      );

      return requireById(id);
    },

    findById,

    async list(sort = 'recent') {
      const rows = await db.getAllAsync<BookRow>(
        `SELECT ${COLUMNS} FROM books ORDER BY ${ORDER_BY[sort]}`,
        [],
      );
      return rows.map(toBookSummary);
    },

    async updateMetadata(id, patch, now = new Date()) {
      const assignments: string[] = [];
      const params: (string | number | null)[] = [];

      if (patch.title !== undefined) {
        assignments.push('title = ?');
        params.push(patch.title);
      }
      if (patch.author !== undefined) {
        assignments.push('author = ?');
        params.push(patch.author);
      }
      if (patch.pageCount !== undefined) {
        assignments.push('page_count = ?');
        params.push(patch.pageCount);
      }

      // Nothing to change: still assert the book exists, so callers get the
      // same not-found signal either way.
      if (assignments.length === 0) return requireById(id);

      assignments.push('updated_at = ?');
      params.push(now.getTime(), id);

      const result = await db.runAsync(
        `UPDATE books SET ${assignments.join(', ')} WHERE id = ?`,
        params,
      );
      if (result.changes === 0) {
        throw new DomainError('book_not_found', `No book with id ${id}`);
      }

      return requireById(id);
    },

    async updateProgress(id, lastPage, now = new Date()) {
      if (!Number.isInteger(lastPage) || lastPage < 0) {
        throw new DomainError(
          'unknown',
          `lastPage must be a non-negative integer, received ${lastPage}`,
        );
      }

      const timestamp = now.getTime();
      const result = await db.runAsync(
        'UPDATE books SET last_page = ?, last_opened_at = ?, updated_at = ? WHERE id = ?',
        [lastPage, timestamp, timestamp, id],
      );
      if (result.changes === 0) {
        throw new DomainError('book_not_found', `No book with id ${id}`);
      }

      return requireById(id);
    },

    async updateReflowPosition(id, position, now = new Date()) {
      if (position !== null) {
        const valid = (value: number) => Number.isInteger(value) && value >= 0;
        if (!valid(position.blockIndex) || !valid(position.pageIndex)) {
          throw new DomainError(
            'unknown',
            `reflow position must be non-negative integers, received ${position.blockIndex}/${position.pageIndex}`,
          );
        }
      }

      const timestamp = now.getTime();
      const blockIndex = position === null ? null : position.blockIndex;
      const pageIndex = position === null ? null : position.pageIndex;
      const result = await db.runAsync(
        `UPDATE books SET reflow_block_index = ?, reflow_page_index = ?, last_opened_at = ?, updated_at = ? WHERE id = ?`,
        [blockIndex, pageIndex, timestamp, timestamp, id],
      );
      if (result.changes === 0) {
        throw new DomainError('book_not_found', `No book with id ${id}`);
      }

      return requireById(id);
    },

    async markOpened(id, now = new Date()) {
      const timestamp = now.getTime();
      const result = await db.runAsync(
        'UPDATE books SET last_opened_at = ?, updated_at = ? WHERE id = ?',
        [timestamp, timestamp, id],
      );
      if (result.changes === 0) {
        throw new DomainError('book_not_found', `No book with id ${id}`);
      }

      return requireById(id);
    },

    async remove(id) {
      // Bookmarks are removed by ON DELETE CASCADE (requires PRAGMA foreign_keys = ON).
      const result = await db.runAsync('DELETE FROM books WHERE id = ?', [id]);
      return result.changes > 0;
    },

    async count() {
      const row = await db.getFirstAsync<{ total: number }>(
        'SELECT COUNT(*) AS total FROM books',
        [],
      );
      return row?.total ?? 0;
    },
  };
}

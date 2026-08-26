/**
 * Book service — the business rules for books (ARCHITECTURE.md §3, L4).
 *
 * The UI reaches data only through this module. It composes the repositories
 * with the storage port; the UI never sees SQL or file paths.
 *
 * Delete ordering follows §7/R10: **file first, row second.** If the file
 * delete fails we abort before touching SQLite (no orphaned rows); if the app
 * dies between the two steps an orphaned file remains, which §7 accepts
 * ("orphaned files are acceptable, orphaned rows are not").
 */
import type { Book, BookSort, BookSummary } from '@/core/entities/book';
import { DomainError } from '@/core/errors';
import type { StoragePort } from '@/core/ports';

export interface BookServiceDeps {
  /** Narrowed to exactly what the service uses — keeps fakes tiny in tests. */
  listBooks(sort?: BookSort): Promise<BookSummary[]>;
  getBook(id: string): Promise<Book | null>;
  deleteBookRow(id: string): Promise<boolean>;
  markOpened(id: string, at: Date): Promise<Book>;
  storage: StoragePort;
}

export interface BookService {
  /** The library list, ordered per `sort` (default: recently opened). */
  listBooks(sort?: BookSort): Promise<BookSummary[]>;
  /** Resolves a book by id, or null when it does not exist. */
  getBook(id: string): Promise<Book | null>;
  /** True when the stored PDF is still on disk. */
  isFileAvailable(id: string): Promise<boolean>;
  /** Records that the user opened the book now. */
  openBook(id: string): Promise<void>;
  /**
   * Deletes a book completely: stored PDF first, then its SQLite record.
   * Throws if either half fails so the caller can show an error state.
   */
  deleteBook(id: string): Promise<void>;
}

export function createBookService(deps: BookServiceDeps): BookService {
  return {
    listBooks(sort?: BookSort): Promise<BookSummary[]> {
      return deps.listBooks(sort);
    },

    async getBook(id: string): Promise<Book | null> {
      return deps.getBook(id);
    },

    async isFileAvailable(id: string): Promise<boolean> {
      const book = await deps.getBook(id);
      if (!book) return false;
      try {
        return await deps.storage.exists(book.fileUri);
      } catch {
        // An unreadable storage layer means we cannot promise the file exists.
        return false;
      }
    },

    async openBook(id: string): Promise<void> {
      // updateProgress stamps last_opened_at + updated_at and keeps last_page.
      await deps.markOpened(id, new Date());
    },

    async deleteBook(id: string): Promise<void> {
      const book = await deps.getBook(id);
      if (!book) throw new DomainError('book_not_found', `No book with id ${id}`);

      try {
        // Resolves false when the file was already gone; tolerate that and
        // still remove the dead row rather than leaving it undeletable.
        await deps.storage.deleteStoredFile(book.fileUri);
      } catch (error) {
        throw new DomainError(
          'storage_write_failed',
          `Could not delete the PDF file for "${book.title}". The book was kept.`,
          error,
        );
      }

      const removed = await deps.deleteBookRow(id);
      if (!removed) {
        throw new DomainError('book_not_found', `No book with id ${id}`);
      }
    },
  };
}

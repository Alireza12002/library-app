/**
 * Configurable @/services double for hook tests (ARCHITECTURE.md §9).
 *
 * The reader hooks reach the data layer only through `getServices()`, so this
 * is the whole seam needed to drive them off-device. Every call is recorded, so
 * a test can assert not just the final state but how many round-trips the flow
 * made — the signature of a self-retriggering effect.
 *
 * Test-only: nothing in the app imports this file. `scripts/test-resolver.mjs`
 * maps the `@/services` barrel here while tests run.
 */
import type { Book, BookSummary } from '@/core/entities/book';

export interface ServicesStubConfig {
  /** Returned by books.getBook. `null` models a deleted row. */
  book: Book | null;
  /** Returned by books.isFileAvailable. */
  fileAvailable: boolean;
  /** When set, books.getBook rejects with it. */
  getBookError: Error | null;
}

/** Every service method invoked, in order, as `"books.getBook(id)"` strings. */
export const serviceCalls: string[] = [];

const DEFAULT_BOOK: Book = {
  id: 'book-1',
  title: 'Test Book',
  author: null,
  fileUri: 'file:///documents/library/test.pdf',
  fileName: 'test.pdf',
  fileSize: 2048,
  pageCount: 10,
  lastPage: 3,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  lastOpenedAt: new Date('2026-01-02T00:00:00.000Z'),
};

let config: ServicesStubConfig = {
  book: DEFAULT_BOOK,
  fileAvailable: true,
  getBookError: null,
};

/** Resets calls and applies `patch` over the defaults. Call in beforeEach. */
export function configureServices(patch: Partial<ServicesStubConfig> = {}): void {
  serviceCalls.length = 0;
  config = {
    book: DEFAULT_BOOK,
    fileAvailable: true,
    getBookError: null,
    ...patch,
  };
}

/** A Book with `overrides` applied — a fresh object, like the repository returns. */
export function makeBook(overrides: Partial<Book> = {}): Book {
  return { ...DEFAULT_BOOK, ...overrides };
}

export async function getServices(): Promise<{
  books: {
    listBooks(): Promise<BookSummary[]>;
    getBook(id: string): Promise<Book | null>;
    isFileAvailable(id: string): Promise<boolean>;
    openBook(id: string): Promise<void>;
    updateProgress(id: string, lastPage: number): Promise<void>;
    deleteBook(id: string): Promise<void>;
  };
}> {
  serviceCalls.push('getServices');
  return {
    books: {
      async listBooks(): Promise<BookSummary[]> {
        serviceCalls.push('books.listBooks');
        return [];
      },

      async getBook(id: string): Promise<Book | null> {
        serviceCalls.push(`books.getBook(${id})`);
        if (config.getBookError) throw config.getBookError;
        // A fresh object per call, exactly like bookRepository.findById →
        // toBook(row). Reusing one instance here would hide identity-based
        // dependency bugs in the hooks under test.
        return config.book === null ? null : { ...config.book };
      },

      async isFileAvailable(id: string): Promise<boolean> {
        serviceCalls.push(`books.isFileAvailable(${id})`);
        return config.fileAvailable;
      },

      async openBook(id: string): Promise<void> {
        serviceCalls.push(`books.openBook(${id})`);
      },

      async updateProgress(id: string, lastPage: number): Promise<void> {
        serviceCalls.push(`books.updateProgress(${id},${lastPage})`);
      },

      async deleteBook(id: string): Promise<void> {
        serviceCalls.push(`books.deleteBook(${id})`);
      },
    },
  };
}

/** Counts how many times a recorded call name occurred. */
export function countCalls(name: string): number {
  return serviceCalls.filter((call) => call === name).length;
}

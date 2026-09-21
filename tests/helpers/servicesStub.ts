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
import {
  buildPageStarts,
  reflowSourceFingerprint,
  REFLOW_FORMAT_VERSION,
  type ReflowDocument,
  type TextBlock,
} from '@/core/entities/reflowDocument';
import { DEFAULT_READING_SETTINGS, type ReadingSettings } from '@/core/entities/readingSettings';

/** Mirrors the real service's progress shape. */
export interface ReflowProgress {
  processedPages: number;
  totalPages: number;
  blockCount: number;
}

export interface ServicesStubConfig {
  /** Returned by books.getBook. `null` models a deleted row. */
  book: Book | null;
  /** Returned by books.isFileAvailable. */
  fileAvailable: boolean;
  /** When set, books.getBook rejects with it. */
  getBookError: Error | null;
  /**
   * Document returned by reflow.getStored. `null` models "never generated",
   * which sends the hook down the generate path.
   */
  reflowStored: ReflowDocument | null;
  /** Document produced by reflow.getDocument (the generate path). */
  reflowGenerated: ReflowDocument | null;
  /** When set, reflow.getStored rejects with it. */
  reflowError: Error | null;
  /** Settings returned by settings.getSettings. */
  readingSettings: ReadingSettings;
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
  reflowBlockIndex: null,
  reflowPageIndex: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  lastOpenedAt: new Date('2026-01-02T00:00:00.000Z'),
};

let config: ServicesStubConfig = {
  book: DEFAULT_BOOK,
  fileAvailable: true,
  getBookError: null,
  reflowStored: null,
  reflowGenerated: null,
  reflowError: null,
  readingSettings: { ...DEFAULT_READING_SETTINGS },
};

/** Resets calls and applies `patch` over the defaults. Call in beforeEach. */
export function configureServices(patch: Partial<ServicesStubConfig> = {}): void {
  serviceCalls.length = 0;
  config = {
    book: DEFAULT_BOOK,
    fileAvailable: true,
    getBookError: null,
    reflowStored: null,
    reflowGenerated: null,
    reflowError: null,
    readingSettings: { ...DEFAULT_READING_SETTINGS },
    ...patch,
  };
}

/** A Book with `overrides` applied — a fresh object, like the repository returns. */
export function makeBook(overrides: Partial<Book> = {}): Book {
  return { ...DEFAULT_BOOK, ...overrides };
}

/**
 * Builds a reflow document with an UNEVEN blocks-per-page distribution, so a
 * test that accidentally assumes `page N === block N` fails instead of passing
 * by coincidence.
 *
 * `blocksPerPage(page)` decides how many blocks each page contributes; returning
 * 0 models a blank or image-only page.
 */
export function makeReflowDocument(options: {
  bookId?: string;
  pageCount: number;
  blocksPerPage: (page: number) => number;
  book?: Book;
}): ReflowDocument {
  const book = options.book ?? DEFAULT_BOOK;
  const bookId = options.bookId ?? book.id;
  const blocks: TextBlock[] = [];

  for (let page = 0; page < options.pageCount; page++) {
    const count = options.blocksPerPage(page);
    for (let n = 0; n < count; n++) {
      blocks.push({
        type: n === 0 ? 'heading' : 'paragraph',
        text: `page ${page} block ${n}`,
        pageIndex: page,
      });
    }
  }

  return {
    bookId,
    formatVersion: REFLOW_FORMAT_VERSION,
    sourceFingerprint: reflowSourceFingerprint({
      fileUri: book.fileUri,
      fileSize: book.fileSize,
      pageCount: book.pageCount,
    }),
    pageCount: options.pageCount,
    blocks,
    pageStarts: buildPageStarts(blocks, options.pageCount),
    generatedAt: new Date('2026-02-01T00:00:00.000Z'),
  };
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
  reflow: {
    getStored(book: Book): Promise<ReflowDocument | null>;
    getDocument(
      book: Book,
      options?: { signal?: AbortSignal; onProgress?: (progress: ReflowProgress) => void },
    ): Promise<ReflowDocument>;
    invalidate(bookId: string): Promise<void>;
  };
  settings: {
    getSettings(): Promise<ReadingSettings>;
    saveSettings(settings: ReadingSettings): Promise<ReadingSettings>;
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

    reflow: {
      async getStored(book: Book): Promise<ReflowDocument | null> {
        serviceCalls.push(`reflow.getStored(${book.id})`);
        if (config.reflowError) throw config.reflowError;
        return config.reflowStored;
      },

      async getDocument(
        book: Book,
        options: { signal?: AbortSignal; onProgress?: (progress: ReflowProgress) => void } = {},
      ): Promise<ReflowDocument> {
        serviceCalls.push(`reflow.getDocument(${book.id})`);
        if (config.reflowError) throw config.reflowError;
        const generated = config.reflowGenerated;
        if (!generated) throw new Error('no generated document configured');
        options.onProgress?.({
          processedPages: generated.pageCount,
          totalPages: generated.pageCount,
          blockCount: generated.blocks.length,
        });
        return generated;
      },

      async invalidate(bookId: string): Promise<void> {
        serviceCalls.push(`reflow.invalidate(${bookId})`);
        config.reflowStored = null;
      },
    },

    settings: {
      async getSettings(): Promise<ReadingSettings> {
        serviceCalls.push('settings.getSettings');
        return { ...config.readingSettings };
      },

      async saveSettings(settings: ReadingSettings): Promise<ReadingSettings> {
        serviceCalls.push(`settings.saveSettings(${settings.mode})`);
        config.readingSettings = { ...settings };
        return { ...settings };
      },
    },
  };
}

/** Counts how many times a recorded call name occurred. */
export function countCalls(name: string): number {
  return serviceCalls.filter((call) => call === name).length;
}

/**
 * Book service behaviour — especially the two-sided delete contract:
 * removing a book must remove BOTH the stored PDF and the SQLite row,
 * and must not remove the row when the file deletion fails (R10/§7).
 */
import assert from 'node:assert/strict';
import { beforeEach, afterEach, test } from 'node:test';

import type { Book } from '@/core/entities/book';
import { DomainError } from '@/core/errors';
import type { StoragePort } from '@/core/ports';
import { createBookService, type BookServiceDeps } from '@/services/bookService';

/** In-memory StoragePort double: records calls, can be made to fail. */
class FakeStorage implements StoragePort {
  readonly deleted: string[] = [];
  failOnDelete = false;
  private files = new Set<string>();

  seed(uri: string): void {
    this.files.add(uri);
  }

  async copyIntoLibrary(sourceUri: string): Promise<string> {
    const uri = `file:///fake/${sourceUri}`;
    this.files.add(uri);
    return uri;
  }

  async deleteStoredFile(storedPath: string): Promise<boolean> {
    if (this.failOnDelete) throw new Error('disk error');
    this.deleted.push(storedPath);
    return this.files.delete(storedPath);
  }

  async exists(storedPath: string): Promise<boolean> {
    return this.files.has(storedPath);
  }
}

function makeBook(overrides: Partial<Book> = {}): Book {
  return {
    id: 'book-1',
    title: 'A Quiet Corner of the World',
    author: null,
    fileUri: 'file:///library/abc-quiet.pdf',
    fileName: 'quiet.pdf',
    fileSize: 1234,
    pageCount: null,
    lastPage: 0,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    lastOpenedAt: null,
    ...overrides,
  };
}

function makeDeps(book: Book | null, storage: FakeStorage): BookServiceDeps {
  const removedRows: string[] = [];
  return {
    listBooks: async () => [],
    getBook: async () => book,
    deleteBookRow: async (id) => {
      if (!book || id !== book.id) return false;
      removedRows.push(id);
      return true;
    },
    markOpened: async () => book ?? makeBook(),
    updateProgress: async () => book ?? makeBook(),
    storage,
    ...(removedRows.length === -1 ? {} : {}),
  };
}

beforeEach(() => {
  // fresh doubles per test
});

afterEach(() => {
  // nothing persistent
});

test('deleteBook removes the file BEFORE the row', async () => {
  const storage = new FakeStorage();
  const book = makeBook();
  storage.seed(book.fileUri);

  const order: string[] = [];
  const deps: BookServiceDeps = {
    ...makeDeps(book, storage),
    deleteBookRow: async (id) => {
      order.push('row');
      return true;
    },
    storage: {
      async copyIntoLibrary(sourceUri: string, fileName: string) {
        return storage.copyIntoLibrary(sourceUri);
      },
      async deleteStoredFile(path: string) {
        order.push('file');
        return storage.deleteStoredFile(path);
      },
      async exists(storedPath: string) {
        return storage.exists(storedPath);
      },
    },
  };

  const service = createBookService(deps);
  await service.deleteBook(book.id);

  assert.deepEqual(order, ['file', 'row'], 'file must be deleted before the DB row (§7/R10)');
});

test('deleteBook removes both the file and the row on success', async () => {
  const storage = new FakeStorage();
  const book = makeBook();
  storage.seed(book.fileUri);

  let rowRemoved = false;
  const service = createBookService({
    listBooks: async () => [],
    getBook: async () => book,
    deleteBookRow: async () => {
      rowRemoved = true;
      return true;
    },
    markOpened: async () => book,
    updateProgress: async () => book,
    storage,
  });

  await service.deleteBook(book.id);

  assert.deepEqual(storage.deleted, [book.fileUri], 'PDF file must be deleted');
  assert.equal(rowRemoved, true, 'SQLite record must be deleted');
});

test('deleteBook tolerates an already-missing file but still removes the row', async () => {
  const storage = new FakeStorage(); // file never seeded
  const book = makeBook();

  let rowRemoved = false;
  const service = createBookService({
    listBooks: async () => [],
    getBook: async () => book,
    deleteBookRow: async () => {
      rowRemoved = true;
      return true;
    },
    markOpened: async () => book,
    updateProgress: async () => book,
    storage,
  });

  await service.deleteBook(book.id);
  assert.equal(rowRemoved, true, 'a missing file must not block row removal');
});

test('deleteBook KEEPS the row when the file delete fails', async () => {
  const storage = new FakeStorage();
  storage.failOnDelete = true;
  const book = makeBook();
  storage.seed(book.fileUri);

  let rowRemoved = false;
  const service = createBookService({
    listBooks: async () => [],
    getBook: async () => book,
    deleteBookRow: async () => {
      rowRemoved = true;
      return true;
    },
    markOpened: async () => book,
    updateProgress: async () => book,
    storage,
  });

  await assert.rejects(
    () => service.deleteBook(book.id),
    (error: unknown) => error instanceof DomainError && error.code === 'storage_write_failed',
  );
  assert.equal(rowRemoved, false, 'row must survive when the file could not be deleted');
});

test('deleteBook of an unknown book raises book_not_found', async () => {
  const service = createBookService(makeDeps(null, new FakeStorage()));
  await assert.rejects(
    () => service.deleteBook('ghost'),
    (error: unknown) => error instanceof DomainError && error.code === 'book_not_found',
  );
});

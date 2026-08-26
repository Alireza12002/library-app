/**
 * Bookmark repository behaviour (ARCHITECTURE.md §9), including the
 * ON DELETE CASCADE relationship with books.
 */
import assert from 'node:assert/strict';
import { beforeEach, afterEach, test } from 'node:test';

import { DomainError } from '@/core/errors';
import {
  createBookmarkRepository,
  type BookmarkRepository,
} from '@/data/repositories/bookmarkRepository';
import { createBookRepository, type BookRepository } from '@/data/repositories/bookRepository';

import { createTestDatabase, type TestDatabase } from './helpers/testDb';

let db: TestDatabase;
let books: BookRepository;
let bookmarks: BookmarkRepository;
let bookId: string;

beforeEach(async () => {
  db = await createTestDatabase();
  books = createBookRepository(db.connection);
  bookmarks = createBookmarkRepository(db.connection);

  const book = await books.create({
    title: 'Tales from the Dusty Shelf',
    fileUri: 'file:///library/dusty.pdf',
    fileName: 'dusty.pdf',
    fileSize: 2048,
  });
  bookId = book.id;
});

afterEach(() => {
  db.close();
});

test('create stores a bookmark with optional fields defaulted to null', async () => {
  const now = new Date('2026-04-01T09:00:00.000Z');
  const bookmark = await bookmarks.create({ bookId, page: 12 }, now);

  assert.ok(bookmark.id.length > 0);
  assert.equal(bookmark.bookId, bookId);
  assert.equal(bookmark.page, 12);
  assert.equal(bookmark.title, null);
  assert.equal(bookmark.note, null);
  assert.deepEqual(bookmark.createdAt, now);
});

test('create keeps a supplied title and note', async () => {
  const bookmark = await bookmarks.create({
    bookId,
    page: 3,
    title: 'The gilded conservatory',
    note: 'Compare with chapter 2.',
  });

  assert.equal(bookmark.title, 'The gilded conservatory');
  assert.equal(bookmark.note, 'Compare with chapter 2.');
});

test('listForBook returns bookmarks in ascending page order', async () => {
  await bookmarks.create({ bookId, page: 30 });
  await bookmarks.create({ bookId, page: 2 });
  await bookmarks.create({ bookId, page: 11 });

  const pages = (await bookmarks.listForBook(bookId)).map((b) => b.page);
  assert.deepEqual(pages, [2, 11, 30]);
});

test('listForBook is scoped to one book', async () => {
  const other = await books.create({
    title: 'Second',
    fileUri: 'file:///library/second.pdf',
    fileName: 'second.pdf',
    fileSize: 10,
  });

  await bookmarks.create({ bookId, page: 1 });
  await bookmarks.create({ bookId: other.id, page: 5 });

  assert.equal((await bookmarks.listForBook(bookId)).length, 1);
  assert.equal((await bookmarks.listForBook(other.id)).length, 1);
  assert.deepEqual(await bookmarks.listForBook('unknown-book'), []);
});

test('a page can only be bookmarked once per book', async () => {
  await bookmarks.create({ bookId, page: 7 });

  await assert.rejects(
    () => bookmarks.create({ bookId, page: 7 }),
    (error: unknown) => error instanceof DomainError && /already bookmarked/.test(error.message),
  );
});

test('the same page in a different book is allowed', async () => {
  const other = await books.create({
    title: 'Second',
    fileUri: 'file:///library/second.pdf',
    fileName: 'second.pdf',
    fileSize: 10,
  });

  await bookmarks.create({ bookId, page: 7 });
  const second = await bookmarks.create({ bookId: other.id, page: 7 });
  assert.equal(second.page, 7);
});

test('bookmarking an unknown book raises book_not_found', async () => {
  await assert.rejects(
    () => bookmarks.create({ bookId: 'ghost', page: 1 }),
    (error: unknown) => error instanceof DomainError && error.code === 'book_not_found',
  );
});

test('page must be a non-negative integer', async () => {
  await assert.rejects(() => bookmarks.create({ bookId, page: -1 }), DomainError);
  await assert.rejects(() => bookmarks.create({ bookId, page: 2.5 }), DomainError);
});

test('remove reports whether a row was deleted', async () => {
  const bookmark = await bookmarks.create({ bookId, page: 4 });

  assert.equal(await bookmarks.remove(bookmark.id), true);
  assert.equal(await bookmarks.remove(bookmark.id), false);
  assert.deepEqual(await bookmarks.listForBook(bookId), []);
});

test('deleting a book cascades to its bookmarks', async () => {
  await bookmarks.create({ bookId, page: 1 });
  await bookmarks.create({ bookId, page: 2 });

  await books.remove(bookId);

  assert.deepEqual(
    await bookmarks.listForBook(bookId),
    [],
    'ON DELETE CASCADE should have removed both bookmarks',
  );
});

test('removeForBook deletes every bookmark and reports the count', async () => {
  await bookmarks.create({ bookId, page: 1 });
  await bookmarks.create({ bookId, page: 2 });

  assert.equal(await bookmarks.removeForBook(bookId), 2);
  assert.equal(await bookmarks.removeForBook(bookId), 0);
});

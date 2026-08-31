/**
 * TextCacheRepository tests (ARCHITECTURE.md §9).
 * Uses Node's native test runner with in-memory SQLite.
 */
import assert from 'node:assert/strict';
import { beforeEach, afterEach, test, describe } from 'node:test';

import {
  createTextCacheRepository,
  type TextCacheRepository,
} from '@/data/repositories/textCacheRepository';
import { createTestDatabase, type TestDatabase } from './helpers/testDb';

let db: TestDatabase;
let repo: TextCacheRepository;

beforeEach(async () => {
  db = await createTestDatabase();
  repo = createTextCacheRepository(db.connection);
});

afterEach(() => {
  db.close();
});

describe('TextCacheRepository', () => {
  test('should save and retrieve a page', async () => {
    const bookId = 'book-1';
    const page = 0;
    const text = 'Page 1 text content';

    const saved = await repo.savePage(bookId, page, text);
    assert.equal(saved.bookId, bookId);
    assert.equal(saved.page, page);
    assert.equal(saved.text, text);
    assert.ok(saved.extractedAt instanceof Date);

    const retrieved = await repo.getPage(bookId, page);
    assert.ok(retrieved !== null);
    assert.equal(retrieved?.text, text);
    assert.equal(retrieved?.page, page);
  });

  test('should update existing page (upsert)', async () => {
    const bookId = 'book-1';
    const page = 0;
    const originalText = 'Original text';
    const updatedText = 'Updated text';

    await repo.savePage(bookId, page, originalText);
    const updated = await repo.savePage(bookId, page, updatedText);

    assert.equal(updated.text, updatedText);
    const retrieved = await repo.getPage(bookId, page);
    assert.ok(retrieved !== null);
    assert.ok(updated.extractedAt.getTime() >= retrieved!.extractedAt.getTime());
  });

  test('should return null for non-existent page', async () => {
    const result = await repo.getPage('non-existent', 0);
    assert.equal(result, null);
  });

  test('should check if page exists', async () => {
    const bookId = 'book-1';
    const page = 0;

    assert.equal(await repo.hasPage(bookId, page), false);
    await repo.savePage(bookId, page, 'text');
    assert.equal(await repo.hasPage(bookId, page), true);
  });

  test('should delete a specific page', async () => {
    const bookId = 'book-1';
    const page = 0;

    await repo.savePage(bookId, page, 'text');
    assert.equal(await repo.hasPage(bookId, page), true);

    const deleted = await repo.deletePage(bookId, page);
    assert.equal(deleted, true);
    assert.equal(await repo.hasPage(bookId, page), false);

    // Deleting again should return false
    const deletedAgain = await repo.deletePage(bookId, page);
    assert.equal(deletedAgain, false);
  });

  test('should delete all pages for a book', async () => {
    const bookId = 'book-1';
    await repo.savePage(bookId, 0, 'page 0');
    await repo.savePage(bookId, 1, 'page 1');
    await repo.savePage(bookId, 2, 'page 2');

    const deletedCount = await repo.deleteForBook(bookId);
    assert.equal(deletedCount, 3);

    const remaining = await repo.listForBook(bookId);
    assert.equal(remaining.length, 0);
  });

  test('should list pages in page order', async () => {
    const bookId = 'book-1';
    await repo.savePage(bookId, 2, 'page 2');
    await repo.savePage(bookId, 0, 'page 0');
    await repo.savePage(bookId, 1, 'page 1');

    const pages = await repo.listForBook(bookId);
    assert.equal(pages.length, 3);
    assert.ok(pages[0]);
    assert.ok(pages[1]);
    assert.ok(pages[2]);
    assert.equal(pages[0].page, 0);
    assert.equal(pages[1].page, 1);
    assert.equal(pages[2].page, 2);
  });

  test('should isolate books from each other', async () => {
    await repo.savePage('book-1', 0, 'book 1 page 0');
    await repo.savePage('book-2', 0, 'book 2 page 0');

    const book1Pages = await repo.listForBook('book-1');
    const book2Pages = await repo.listForBook('book-2');

    assert.equal(book1Pages.length, 1);
    assert.equal(book2Pages.length, 1);
    assert.ok(book1Pages[0]);
    assert.ok(book2Pages[0]);
    assert.equal(book1Pages[0].text, 'book 1 page 0');
    assert.equal(book2Pages[0].text, 'book 2 page 0');
  });

  test('should enforce unique constraint on (book_id, page) via upsert', async () => {
    const bookId = 'book-1';
    const page = 0;

    await repo.savePage(bookId, page, 'first');
    await repo.savePage(bookId, page, 'second'); // upsert should succeed

    const pages = await repo.listForBook(bookId);
    assert.equal(pages.length, 1);
    assert.ok(pages[0]);
    assert.equal(pages[0].text, 'second');
  });

  test('should handle empty text', async () => {
    const bookId = 'book-1';
    const page = 0;

    await repo.savePage(bookId, page, '');
    const retrieved = await repo.getPage(bookId, page);
    assert.equal(retrieved?.text, '');
  });
});

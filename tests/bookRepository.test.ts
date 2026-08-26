/**
 * Book repository behaviour (ARCHITECTURE.md §9).
 * Real SQLite via node:sqlite, so constraints and indexes are genuinely exercised.
 */
import assert from 'node:assert/strict';
import { beforeEach, afterEach, test } from 'node:test';

import { DomainError } from '@/core/errors';
import { createBookRepository, type BookRepository } from '@/data/repositories/bookRepository';

import { createTestDatabase, type TestDatabase } from './helpers/testDb';

let db: TestDatabase;
let books: BookRepository;

beforeEach(async () => {
  db = await createTestDatabase();
  books = createBookRepository(db.connection);
});

afterEach(() => {
  db.close();
});

const sample = (overrides: Partial<Parameters<BookRepository['create']>[0]> = {}) => ({
  title: 'The Midnight Greenhouse',
  fileUri: 'file:///library/one.pdf',
  fileName: 'one.pdf',
  fileSize: 1024,
  ...overrides,
});

test('create returns the stored book with defaults applied', async () => {
  const now = new Date('2026-01-01T10:00:00.000Z');
  const book = await books.create(sample({ author: 'Elena Rostova' }), now);

  assert.ok(book.id.length > 0);
  assert.equal(book.title, 'The Midnight Greenhouse');
  assert.equal(book.author, 'Elena Rostova');
  assert.equal(book.fileSize, 1024);
  // Unknown at import time, 0-based progress starts at the first page.
  assert.equal(book.pageCount, null);
  assert.equal(book.lastPage, 0);
  assert.equal(book.lastOpenedAt, null);
  assert.deepEqual(book.createdAt, now);
  assert.deepEqual(book.updatedAt, now);
});

test('create honours a caller-supplied id', async () => {
  const book = await books.create(sample({ id: 'fixed-id' }));
  assert.equal(book.id, 'fixed-id');
  assert.equal((await books.findById('fixed-id'))?.id, 'fixed-id');
});

test('findById returns null for an unknown id', async () => {
  assert.equal(await books.findById('nope'), null);
});

test('file_uri is unique — importing the same path twice fails', async () => {
  await books.create(sample());
  await assert.rejects(() => books.create(sample({ fileName: 'other.pdf' })), /UNIQUE/i);
});

test('title must not be blank', async () => {
  await assert.rejects(() => books.create(sample({ title: '   ' })), /CHECK|constraint/i);
});

test('list orders by recently opened, then newest import', async () => {
  const t0 = new Date('2026-01-01T00:00:00.000Z');
  const t1 = new Date('2026-01-02T00:00:00.000Z');
  const t2 = new Date('2026-01-03T00:00:00.000Z');

  const a = await books.create(sample({ title: 'A', fileUri: 'file:///a.pdf' }), t0);
  await books.create(sample({ title: 'B', fileUri: 'file:///b.pdf' }), t1);
  const c = await books.create(sample({ title: 'C', fileUri: 'file:///c.pdf' }), t2);

  // Never-opened books sort by created_at DESC: C, B, A.
  assert.deepEqual(
    (await books.list()).map((b) => b.title),
    ['C', 'B', 'A'],
  );

  // Opening A promotes it to the front; C and B keep their relative order.
  await books.updateProgress(a.id, 4, new Date('2026-01-04T00:00:00.000Z'));
  assert.deepEqual(
    (await books.list()).map((b) => b.title),
    ['A', 'C', 'B'],
  );

  // Opening C later puts it ahead of A.
  await books.updateProgress(c.id, 2, new Date('2026-01-05T00:00:00.000Z'));
  assert.deepEqual(
    (await books.list()).map((b) => b.title),
    ['C', 'A', 'B'],
  );
});

test('list supports title and added ordering', async () => {
  await books.create(sample({ title: 'banana', fileUri: 'file:///b.pdf' }), new Date(1));
  await books.create(sample({ title: 'Apple', fileUri: 'file:///a.pdf' }), new Date(2));

  // NOCASE collation: Apple before banana despite the capital.
  assert.deepEqual(
    (await books.list('title')).map((b) => b.title),
    ['Apple', 'banana'],
  );
  assert.deepEqual(
    (await books.list('added')).map((b) => b.title),
    ['Apple', 'banana'],
  );
});

test('updateMetadata changes only the provided fields and bumps updatedAt', async () => {
  const created = await books.create(
    sample({ author: 'Original' }),
    new Date('2026-01-01T00:00:00.000Z'),
  );
  const later = new Date('2026-02-01T00:00:00.000Z');

  const updated = await books.updateMetadata(created.id, { title: 'Renamed' }, later);

  assert.equal(updated.title, 'Renamed');
  assert.equal(updated.author, 'Original', 'author must be untouched');
  assert.deepEqual(updated.createdAt, created.createdAt);
  assert.deepEqual(updated.updatedAt, later);
});

test('updateMetadata can clear a nullable field', async () => {
  const created = await books.create(sample({ author: 'Someone' }));
  const updated = await books.updateMetadata(created.id, { author: null });
  assert.equal(updated.author, null);
});

test('updateMetadata with an empty patch still validates existence', async () => {
  const created = await books.create(sample());
  const same = await books.updateMetadata(created.id, {});
  assert.equal(same.id, created.id);

  await assert.rejects(
    () => books.updateMetadata('missing', {}),
    (error: unknown) => error instanceof DomainError && error.code === 'book_not_found',
  );
});

test('updateProgress stores the page and stamps lastOpenedAt', async () => {
  const created = await books.create(sample());
  const openedAt = new Date('2026-03-01T12:00:00.000Z');

  const updated = await books.updateProgress(created.id, 17, openedAt);

  assert.equal(updated.lastPage, 17);
  assert.deepEqual(updated.lastOpenedAt, openedAt);
  assert.deepEqual(updated.updatedAt, openedAt);
});

test('updateProgress rejects negative and non-integer pages', async () => {
  const created = await books.create(sample());
  await assert.rejects(() => books.updateProgress(created.id, -1), DomainError);
  await assert.rejects(() => books.updateProgress(created.id, 1.5), DomainError);
});

test('updateProgress on a missing book raises book_not_found', async () => {
  await assert.rejects(
    () => books.updateProgress('missing', 3),
    (error: unknown) => error instanceof DomainError && error.code === 'book_not_found',
  );
});

test('remove reports whether a row was deleted', async () => {
  const created = await books.create(sample());
  assert.equal(await books.remove(created.id), true);
  assert.equal(await books.remove(created.id), false, 'second delete affects no rows');
  assert.equal(await books.count(), 0);
});

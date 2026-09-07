/**
 * Reflow document persistence tests (ARCHITECTURE.md §9).
 *
 * Runs against real SQLite (node:sqlite, the same engine expo-sqlite wraps), so
 * migrations, constraints and FK cascades behave as they will on device.
 *
 * These cover the requirement that a generated document survives leaving the
 * reader, reopening the book and restarting the app: "restart" is modelled by
 * building a fresh repository over the same database file, which is exactly what
 * the app does on launch.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';

import {
  isReflowDocumentUsable,
  REFLOW_FORMAT_VERSION,
  type TextBlock,
} from '@/core/entities/reflowDocument';
import { createBookRepository } from '@/data/repositories/bookRepository';
import { createReflowDocumentRepository } from '@/data/repositories/reflowDocumentRepository';
import type { DatabaseConnection } from '@/data/db/connection';
import { createTestDatabase, type TestDatabase } from './helpers/testDb';

let db: TestDatabase;
let connection: DatabaseConnection;

/** Inserts a book so FK constraints are satisfied. */
async function seedBook(bookId = 'book-1'): Promise<void> {
  const books = createBookRepository(connection);
  await books.create({
    id: bookId,
    title: 'Test Book',
    fileUri: `file:///books/${bookId}.pdf`,
    fileName: `${bookId}.pdf`,
    fileSize: 4096,
    pageCount: 3,
  });
}

function blocksFor(pages: number[]): TextBlock[] {
  const blocks: TextBlock[] = [];
  pages.forEach((count, pageIndex) => {
    for (let i = 0; i < count; i++) {
      blocks.push({ type: 'paragraph', text: `page ${pageIndex} block ${i}`, pageIndex });
    }
  });
  return blocks;
}

beforeEach(async () => {
  db = await createTestDatabase();
  connection = db.connection;
});

afterEach(() => {
  db.close();
});

describe('reflow document persistence', () => {
  test('saves and loads a whole-book document', async () => {
    await seedBook();
    const repo = createReflowDocumentRepository(connection);

    const blocks = blocksFor([2, 3, 1]);
    await repo.save({ bookId: 'book-1', sourceFingerprint: 'fp-1', pageCount: 3, blocks });

    const loaded = await repo.findByBook('book-1');
    assert.ok(loaded);
    assert.equal(loaded.bookId, 'book-1');
    assert.equal(loaded.pageCount, 3);
    assert.equal(loaded.blocks.length, 6);
    assert.equal(loaded.formatVersion, REFLOW_FORMAT_VERSION);
  });

  test('preserves each block’s source page through a round trip', async () => {
    await seedBook();
    const repo = createReflowDocumentRepository(connection);

    await repo.save({
      bookId: 'book-1',
      sourceFingerprint: 'fp-1',
      pageCount: 3,
      blocks: blocksFor([2, 3, 1]),
    });

    const loaded = await repo.findByBook('book-1');
    assert.ok(loaded);
    assert.deepEqual(
      loaded.blocks.map((block) => block.pageIndex),
      [0, 0, 1, 1, 1, 2],
      'the PDF-page relationship must survive persistence',
    );
  });

  test('rebuilds the page index on load rather than storing it', async () => {
    await seedBook();
    const repo = createReflowDocumentRepository(connection);

    await repo.save({
      bookId: 'book-1',
      sourceFingerprint: 'fp-1',
      pageCount: 3,
      blocks: blocksFor([2, 3, 1]),
    });

    const loaded = await repo.findByBook('book-1');
    assert.ok(loaded);
    assert.deepEqual(loaded.pageStarts, [0, 2, 5]);
  });

  test('preserves image blocks with their URIs', async () => {
    await seedBook();
    const repo = createReflowDocumentRepository(connection);

    const blocks: TextBlock[] = [
      { type: 'paragraph', text: 'Before the figure.', pageIndex: 0 },
      {
        type: 'image',
        text: '',
        pageIndex: 0,
        image: { uri: 'file:///cache/fig.png', width: 640, height: 480 },
      },
    ];
    await repo.save({ bookId: 'book-1', sourceFingerprint: 'fp-1', pageCount: 1, blocks });

    const loaded = await repo.findByBook('book-1');
    assert.ok(loaded);
    const image = loaded.blocks.find((block) => block.type === 'image');
    assert.ok(image?.image);
    assert.equal(image.image.uri, 'file:///cache/fig.png');
    assert.equal(image.image.width, 640);
  });

  test('returns null when no document is stored', async () => {
    await seedBook();
    const repo = createReflowDocumentRepository(connection);
    assert.equal(await repo.findByBook('book-1'), null);
  });

  test('replaces an existing document instead of duplicating it', async () => {
    await seedBook();
    const repo = createReflowDocumentRepository(connection);

    await repo.save({
      bookId: 'book-1',
      sourceFingerprint: 'fp-1',
      pageCount: 2,
      blocks: blocksFor([1, 1]),
    });
    await repo.save({
      bookId: 'book-1',
      sourceFingerprint: 'fp-2',
      pageCount: 3,
      blocks: blocksFor([2, 2, 2]),
    });

    const rows = await connection.getAllAsync<{ count: number }>(
      'SELECT COUNT(*) AS count FROM reflow_documents WHERE book_id = ?',
      ['book-1'],
    );
    assert.equal(rows[0]!.count, 1);

    const loaded = await repo.findByBook('book-1');
    assert.ok(loaded);
    assert.equal(loaded.sourceFingerprint, 'fp-2');
    assert.equal(loaded.blocks.length, 6);
  });

  test('rejects a document for a book that does not exist', async () => {
    const repo = createReflowDocumentRepository(connection);
    await assert.rejects(
      () =>
        repo.save({
          bookId: 'ghost',
          sourceFingerprint: 'fp',
          pageCount: 1,
          blocks: blocksFor([1]),
        }),
      /No book with id ghost/,
    );
  });

  test('deleting a book removes its reflow document', async () => {
    await seedBook();
    const repo = createReflowDocumentRepository(connection);
    const books = createBookRepository(connection);

    await repo.save({
      bookId: 'book-1',
      sourceFingerprint: 'fp-1',
      pageCount: 1,
      blocks: blocksFor([2]),
    });
    await books.remove('book-1');

    assert.equal(await repo.findByBook('book-1'), null);
  });

  test('handles a large document without truncation', async () => {
    await seedBook();
    const repo = createReflowDocumentRepository(connection);

    // ~400 pages × 6 blocks: the shape of a real book, and enough JSON to catch a
    // column-size or serialization problem.
    const pages = new Array<number>(400).fill(6);
    const blocks = blocksFor(pages);
    await repo.save({
      bookId: 'book-1',
      sourceFingerprint: 'fp-big',
      pageCount: pages.length,
      blocks,
    });

    const loaded = await repo.findByBook('book-1');
    assert.ok(loaded);
    assert.equal(loaded.blocks.length, 2400);
    assert.equal(loaded.blocks.at(-1)!.pageIndex, 399);
    assert.equal(loaded.pageStarts.length, 400);
  });
});

describe('staleness at the storage boundary', () => {
  test('findUsable returns a document matching the fingerprint', async () => {
    await seedBook();
    const repo = createReflowDocumentRepository(connection);

    await repo.save({
      bookId: 'book-1',
      sourceFingerprint: 'fp-1',
      pageCount: 1,
      blocks: blocksFor([2]),
    });

    const loaded = await repo.findUsable('book-1', 'fp-1');
    assert.ok(loaded);
    assert.equal(loaded.blocks.length, 2);
  });

  test('findUsable returns null when the source changed', async () => {
    await seedBook();
    const repo = createReflowDocumentRepository(connection);

    await repo.save({
      bookId: 'book-1',
      sourceFingerprint: 'fp-1',
      pageCount: 1,
      blocks: blocksFor([2]),
    });

    // The book was replaced by a different PDF at the same path.
    assert.equal(await repo.findUsable('book-1', 'fp-2'), null);
  });

  test('a stored document from an older format version is not usable', async () => {
    await seedBook();
    const repo = createReflowDocumentRepository(connection);

    await repo.save({
      bookId: 'book-1',
      sourceFingerprint: 'fp-1',
      pageCount: 1,
      blocks: blocksFor([2]),
    });

    // Simulate a pipeline change by ageing the stored row.
    await connection.runAsync('UPDATE reflow_documents SET format_version = ? WHERE book_id = ?', [
      REFLOW_FORMAT_VERSION - 1,
      'book-1',
    ]);

    assert.equal(await repo.findUsable('book-1', 'fp-1'), null);

    const raw = await repo.findByBook('book-1');
    assert.ok(raw, 'the row still exists — validity is the caller’s decision');
    assert.equal(
      isReflowDocumentUsable(raw, { bookId: 'book-1', sourceFingerprint: 'fp-1' }),
      false,
    );
  });

  test('deleteStaleVersions clears documents from older pipelines', async () => {
    await seedBook('book-1');
    await seedBook('book-2');
    const repo = createReflowDocumentRepository(connection);

    await repo.save({
      bookId: 'book-1',
      sourceFingerprint: 'fp-1',
      pageCount: 1,
      blocks: blocksFor([1]),
    });
    await repo.save({
      bookId: 'book-2',
      sourceFingerprint: 'fp-2',
      pageCount: 1,
      blocks: blocksFor([1]),
    });
    await connection.runAsync('UPDATE reflow_documents SET format_version = ? WHERE book_id = ?', [
      REFLOW_FORMAT_VERSION - 1,
      'book-1',
    ]);

    const removed = await repo.deleteStaleVersions();

    assert.equal(removed, 1);
    assert.equal(await repo.findByBook('book-1'), null);
    assert.ok(await repo.findByBook('book-2'), 'current-version documents must survive');
  });

  test('a corrupt blocks payload reads as a miss, not a crash', async () => {
    await seedBook();
    const repo = createReflowDocumentRepository(connection);

    await repo.save({
      bookId: 'book-1',
      sourceFingerprint: 'fp-1',
      pageCount: 1,
      blocks: blocksFor([2]),
    });
    await connection.runAsync('UPDATE reflow_documents SET blocks = ? WHERE book_id = ?', [
      '{not json',
      'book-1',
    ]);

    // Regenerating is strictly better than an unreadable book.
    assert.equal(await repo.findByBook('book-1'), null);
  });
});

describe('survives an app restart', () => {
  test('a fresh repository over the same database sees the document', async () => {
    await seedBook();

    // Session 1: generate and persist.
    const first = createReflowDocumentRepository(connection);
    await first.save({
      bookId: 'book-1',
      sourceFingerprint: 'fp-1',
      pageCount: 3,
      blocks: blocksFor([2, 3, 1]),
    });

    // Session 2: a new repository instance, as after a relaunch.
    const second = createReflowDocumentRepository(connection);
    const loaded = await second.findUsable('book-1', 'fp-1');

    assert.ok(loaded, 'the document must be reusable after a restart');
    assert.equal(loaded.blocks.length, 6);
    assert.deepEqual(loaded.pageStarts, [0, 2, 5]);
  });
});

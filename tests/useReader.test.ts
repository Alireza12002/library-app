/**
 * useReader tests — the reader's open flow (ARCHITECTURE.md §9).
 *
 * These drive the real hook through tests/helpers/hookHarness.ts, a minimal
 * React runtime that repeats renders while state keeps changing. That makes the
 * property this suite cares about directly observable: the open flow must reach
 * a FIXED POINT. A hook whose effect re-triggers itself never settles, and on
 * device that shows up as a screen stuck on "Opening…" while the native PDF view
 * is torn down and remounted on every pass.
 *
 * `settled` and the service call counts are the assertions that matter — final
 * state alone looks correct even while the flow loops forever.
 */
import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';

import { useReader } from '@/features/reader/hooks/useReader';
import { driveHook, unmountHook } from './helpers/hookHarness';
import { configureServices, countCalls, makeBook, serviceCalls } from './helpers/servicesStub';

interface ReaderSnapshot {
  isResolving: boolean;
  fatal: string | null;
  bookId: string | null;
  currentPage: number;
  isLoaded: boolean;
}

/** Runs useReader to a fixed point and returns the harness result. */
async function openBook(bookId = 'book-1') {
  const result = await driveHook<ReaderSnapshot>(() => {
    const reader = useReader(bookId, 0);
    return {
      isResolving: reader.isResolving,
      fatal: reader.fatal,
      bookId: reader.book?.id ?? null,
      currentPage: reader.currentPage,
      isLoaded: reader.isLoaded,
    };
  });

  const final = result.snapshots.at(-1);
  assert.ok(final, 'expected at least one render pass');
  return { ...result, final };
}

beforeEach(() => {
  unmountHook();
  configureServices();
});

describe('useReader open flow', () => {
  test('settles after resolving the book — never re-triggers its own effect', async () => {
    const { settled, passes, final } = await openBook();

    // The regression this pins: the resolve effect used to depend on a callback
    // derived from the book it resolves, so every pass produced a new callback
    // identity and re-entered isResolving=true forever.
    assert.equal(
      settled,
      true,
      `open flow never settled (${passes} render passes, calls: ${serviceCalls.join(' → ')})`,
    );
    assert.equal(final.isResolving, false, 'still showing "Opening…" after settling');
    assert.equal(final.fatal, null);
    assert.equal(final.bookId, 'book-1');
  });

  test('resolves the book exactly once per open', async () => {
    await openBook();

    // A self-retriggering effect shows up here as N identical round-trips.
    assert.equal(countCalls('books.getBook(book-1)'), 1);
    assert.equal(countCalls('books.isFileAvailable(book-1)'), 1);
  });

  test('restores the saved reading position', async () => {
    configureServices({ book: makeBook({ lastPage: 3, pageCount: 10 }) });

    const { final } = await openBook();

    assert.equal(final.currentPage, 3);
  });

  test('clamps a saved page beyond the last page', async () => {
    configureServices({ book: makeBook({ lastPage: 99, pageCount: 10 }) });

    const { final } = await openBook();

    assert.equal(final.currentPage, 9);
  });

  test('trusts the saved page when the page count is unknown', async () => {
    configureServices({ book: makeBook({ lastPage: 4, pageCount: null }) });

    const { final } = await openBook();

    assert.equal(final.currentPage, 4);
  });

  test('is not loaded until the renderer reports a page count', async () => {
    const { final } = await openBook();

    // isLoaded gates the reader controls; it must not be true from resolution
    // alone, only once onLoaded fires.
    assert.equal(final.isLoaded, false);
  });

  test('reports a deleted book as fatal and stops loading', async () => {
    configureServices({ book: null });

    const { settled, final } = await openBook();

    assert.equal(settled, true);
    assert.equal(final.isResolving, false);
    assert.equal(final.fatal, 'This book no longer exists in your library.');
    assert.equal(final.bookId, null);
  });

  test('reports a missing PDF file as fatal and stops loading', async () => {
    configureServices({ fileAvailable: false });

    const { settled, final } = await openBook();

    assert.equal(settled, true);
    assert.equal(final.isResolving, false);
    assert.equal(final.fatal, 'The PDF file for this book is missing or was deleted.');
  });

  test('surfaces a repository failure instead of loading forever', async () => {
    configureServices({ getBookError: new Error('database is locked') });

    const { settled, final } = await openBook();

    assert.equal(settled, true);
    assert.equal(final.isResolving, false);
    assert.equal(final.fatal, 'database is locked');
  });

  test('falls back to generic copy when the failure carries no message', async () => {
    configureServices({ getBookError: new Error('') });

    const { final } = await openBook();

    assert.equal(final.isResolving, false);
    assert.equal(final.fatal, 'Could not open this book.');
  });

  test('every outcome leaves loading finished — book or error, never both null', async () => {
    const cases = [
      { name: 'happy path', patch: {} },
      { name: 'deleted row', patch: { book: null } },
      { name: 'missing file', patch: { fileAvailable: false } },
      { name: 'repository error', patch: { getBookError: new Error('boom') } },
    ] as const;

    for (const { name, patch } of cases) {
      unmountHook();
      configureServices(patch);

      const { settled, final } = await openBook();

      assert.equal(settled, true, `${name}: never settled`);
      assert.equal(final.isResolving, false, `${name}: stuck on "Opening…"`);
      assert.ok(
        final.bookId !== null || final.fatal !== null,
        `${name}: finished loading with neither a book nor an error`,
      );
    }
  });
});

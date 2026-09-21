/**
 * useReflowReader position behaviour (ARCHITECTURE.md §9).
 *
 * These are the two reported bugs, pinned at the hook that fixes them:
 *
 *   BUG 1 — Reflow must OPEN AT the target block, never mount at the start of
 *           the book and scroll there. The hook must therefore publish
 *           `initialBlockIndex` in the SAME committed state that first reports
 *           `status: 'ready'` — if a frame is ever ready with a null or 0 target
 *           while the real target is elsewhere, the list mounts at the top and
 *           the visible scroll journey is back.
 *
 *   BUG 2 — Reflow keeps its OWN persisted position. Writes must go to
 *           `updateReflowPosition` and never to `updateProgress` (the PDF page),
 *           must be throttled rather than one-per-scroll-event, and must survive
 *           a restart.
 *
 * The documents here deliberately use an UNEVEN blocks-per-page distribution, so
 * any implementation that assumes `page N === block N` fails these tests instead
 * of passing by coincidence.
 */
import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';

import { REFLOW_PROGRESS_MIN_INTERVAL_MS } from '@/config';
import type { Book } from '@/core/entities/book';
import { useReflowReader } from '@/features/reader/hooks/useReflowReader';

import { driveHook, settleHook, unmountHook } from './helpers/hookHarness';
import { repositoryCalls, resetRepositories, savedReflowPositions } from './helpers/dataStub';
import { configureServices, makeBook, makeReflowDocument } from './helpers/servicesStub';

/**
 * Uneven layout: page 0 → 3 blocks, page 1 → 1, page 2 → 0 (blank), then a
 * repeating 1/4/2/0 cycle. Nothing lines up with the page number.
 */
const blocksPerPage = (page: number): number => {
  if (page === 0) return 3;
  if (page === 1) return 1;
  if (page === 2) return 0;
  return [1, 4, 2, 0][page % 4] ?? 1;
};

const PAGE_COUNT = 140;

function bookWith(overrides: Partial<Book> = {}): Book {
  return makeBook({ pageCount: PAGE_COUNT, ...overrides });
}

function documentFor(book: Book) {
  return makeReflowDocument({ pageCount: PAGE_COUNT, blocksPerPage, book });
}

/** First block index belonging to `page`, computed independently of the hook. */
function expectedBlockForPage(page: number): number {
  let index = 0;
  for (let p = 0; p < page; p++) index += blocksPerPage(p);
  // A page with no blocks of its own resolves forward to the next page's first.
  return index;
}

beforeEach(() => {
  resetRepositories();
  unmountHook();
});

describe('Test 1 — direct opening (no scroll journey from page 1)', () => {
  test('entering reflow at PDF page 35 opens at that page’s first block', async () => {
    const book = bookWith({ lastPage: 35 });
    configureServices({ book, reflowStored: documentFor(book) });

    const result = await driveHook(() => useReflowReader(book, true, 35, false));

    assert.equal(result.settled, true, 'hook must reach a fixed point');
    const final = result.snapshots.at(-1)!;
    assert.equal(final.state.status, 'ready');

    const expected = expectedBlockForPage(35);
    assert.equal(final.state.initialBlockIndex, expected);
    // The whole point of the fix: the target is NOT the top of the book.
    assert.ok(expected > 0, 'fixture must place page 35 away from block 0');
    unmountHook();
  });

  test('every frame that reports ready already carries the final target', async () => {
    // This is the regression guard for the visible scroll journey: if any ready
    // frame published a different (or null) target, the list would mount there
    // first and then move.
    const book = bookWith({ lastPage: 35 });
    configureServices({ book, reflowStored: documentFor(book) });

    const result = await driveHook(() => useReflowReader(book, true, 35, false));
    const expected = expectedBlockForPage(35);

    const readyFrames = result.snapshots.filter((snap) => snap.state.status === 'ready');
    assert.ok(readyFrames.length > 0, 'expected at least one ready frame');
    for (const frame of readyFrames) {
      assert.equal(
        frame.state.initialBlockIndex,
        expected,
        'a ready frame published a target other than the resolved one',
      );
    }
    unmountHook();
  });

  test('the target resolves the same way on the generate path', async () => {
    // No stored document: the hook generates, and the target must still be
    // published atomically with the ready state.
    const book = bookWith({ lastPage: 90 });
    configureServices({ book, reflowStored: null, reflowGenerated: documentFor(book) });

    const result = await driveHook(() => useReflowReader(book, true, 90, false));
    const final = result.snapshots.at(-1)!;

    assert.equal(final.state.status, 'ready');
    assert.equal(final.state.initialBlockIndex, expectedBlockForPage(90));
    unmountHook();
  });

  test('a page with no blocks of its own still opens at real content', async () => {
    // Page 2 is blank in the fixture. The reader must land on the nearest
    // following page that has content, not fall back to the start of the book.
    const book = bookWith({ lastPage: 2 });
    configureServices({ book, reflowStored: documentFor(book) });

    const result = await driveHook(() => useReflowReader(book, true, 2, false));
    const final = result.snapshots.at(-1)!;

    // Derived, not hardcoded: several pages in a row can be blank.
    let nextWithContent = 3;
    while (nextWithContent < PAGE_COUNT && blocksPerPage(nextWithContent) === 0) nextWithContent++;

    const target = final.state.initialBlockIndex!;
    assert.ok(target > 0, 'blank page must not resolve to block 0');
    assert.equal(
      final.state.blocks[target]!.pageIndex,
      nextWithContent,
      'should land on the next page that actually has content',
    );
    unmountHook();
  });
});

describe('Test 2 + 5 — reflow position persists, independently, across restart', () => {
  test('scrolling writes the reflow position, never the PDF page', async () => {
    const book = bookWith({ lastPage: 90 });
    configureServices({ book, reflowStored: documentFor(book) });

    const rendered = await driveHook(() => useReflowReader(book, true, 90, false));
    const target = expectedBlockForPage(100);

    // The user reads on to content from PDF page 100.
    rendered.snapshots.at(-1)!.reportVisibleBlock(target);
    await settleHook(() => useReflowReader(book, true, 90, false));

    const reflowWrites = repositoryCalls.filter((call) =>
      call.startsWith('books.updateReflowPosition'),
    );
    const pdfWrites = repositoryCalls.filter((call) => call.startsWith('books.updateProgress'));

    assert.ok(reflowWrites.length > 0, 'expected the reflow position to be written');
    assert.equal(pdfWrites.length, 0, 'reflow must never write the PDF page position');

    const saved = savedReflowPositions.get(book.id);
    assert.ok(saved, 'a reflow position should be stored');
    assert.equal(saved.blockIndex, target);
    assert.equal(saved.pageIndex, 100, 'the source page anchor must be the block’s own page');
    unmountHook();
  });

  test('a restart into reflow restores the saved position, not the PDF page', async () => {
    // Simulates app restart: the book row now carries the persisted reflow
    // position, PDF page is still 90, and reflow is the restored mode.
    const savedBlock = expectedBlockForPage(100);
    const book = bookWith({
      lastPage: 90,
      reflowBlockIndex: savedBlock,
      reflowPageIndex: 100,
    });
    configureServices({ book, reflowStored: documentFor(book) });

    // restoreSavedPosition = true is what the screen passes when reflow is the
    // mode the session restored rather than an in-session toggle.
    const result = await driveHook(() => useReflowReader(book, true, 90, true));
    const final = result.snapshots.at(-1)!;

    assert.equal(final.state.initialBlockIndex, savedBlock);
    assert.notEqual(
      final.state.initialBlockIndex,
      expectedBlockForPage(90),
      'the PDF page must not win over the saved reflow position on restore',
    );
    unmountHook();
  });

  test('with no saved position, restore falls back to mapping the PDF page', async () => {
    const book = bookWith({ lastPage: 35, reflowBlockIndex: null, reflowPageIndex: null });
    configureServices({ book, reflowStored: documentFor(book) });

    const result = await driveHook(() => useReflowReader(book, true, 35, true));

    assert.equal(result.snapshots.at(-1)!.state.initialBlockIndex, expectedBlockForPage(35));
    unmountHook();
  });
});

describe('Test 3 + 4 — PDF and reflow positions stay independent', () => {
  test('leaving reflow reports the visible block’s own PDF page', async () => {
    const book = bookWith({ lastPage: 90 });
    configureServices({ book, reflowStored: documentFor(book) });

    const rendered = await driveHook(() => useReflowReader(book, true, 90, false));
    const hook = rendered.snapshots.at(-1)!;

    hook.reportVisibleBlock(expectedBlockForPage(100));
    // This is what the screen calls on Reflow → PDF to command the renderer.
    assert.equal(hook.getCurrentPdfPage(), 100);
    unmountHook();
  });

  test('re-entering after an in-session toggle follows the CURRENT pdf page', async () => {
    // Test 4: read reflow to p100, switch to PDF, move to p120, switch back.
    // With restoreSavedPosition=false (the user toggled deliberately), reflow
    // must open at 120 — the saved position must not override a deliberate move.
    const savedBlock = expectedBlockForPage(100);
    const book = bookWith({
      lastPage: 120,
      reflowBlockIndex: savedBlock,
      reflowPageIndex: 100,
    });
    configureServices({ book, reflowStored: documentFor(book) });

    const result = await driveHook(() => useReflowReader(book, true, 120, false));
    const final = result.snapshots.at(-1)!;

    assert.equal(final.state.initialBlockIndex, expectedBlockForPage(120));
    assert.notEqual(final.state.initialBlockIndex, savedBlock);
    unmountHook();
  });

  test('a stale saved block index re-resolves instead of crashing', async () => {
    // The document was regenerated and is now much shorter than the saved index.
    const book = bookWith({
      lastPage: 90,
      reflowBlockIndex: 999_999,
      reflowPageIndex: 100,
    });
    configureServices({
      book,
      reflowStored: makeReflowDocument({ pageCount: PAGE_COUNT, blocksPerPage, book }),
    });

    const result = await driveHook(() => useReflowReader(book, true, 90, true));
    const final = result.snapshots.at(-1)!;

    assert.equal(final.state.status, 'ready');
    const target = final.state.initialBlockIndex!;
    assert.ok(target >= 0 && target < final.state.blocks.length, 'target must be in range');
    // Re-resolved from the page anchor (100), not from the dead index.
    assert.equal(final.state.blocks[target]!.pageIndex, 100);
    unmountHook();
  });
});

describe('position writes are throttled, not per-frame', () => {
  test('a burst of scroll reports produces at most one immediate write', async () => {
    const book = bookWith({ lastPage: 0 });
    configureServices({ book, reflowStored: documentFor(book) });

    const rendered = await driveHook(() => useReflowReader(book, true, 0, false));
    const hook = rendered.snapshots.at(-1)!;

    // 40 reports in one tick — what continuous scrolling looks like.
    for (let i = 1; i <= 40; i++) hook.reportVisibleBlock(i);
    await settleHook(() => useReflowReader(book, true, 0, false));

    const writes = repositoryCalls.filter((call) => call.startsWith('books.updateReflowPosition'));
    assert.ok(
      writes.length <= 2,
      `expected throttled writes, got ${writes.length} for 40 scroll reports`,
    );
    assert.ok(REFLOW_PROGRESS_MIN_INTERVAL_MS > 0, 'throttle interval must be configured');
    unmountHook();
  });

  test('unmount flushes the last position so nothing is lost on exit', async () => {
    const book = bookWith({ lastPage: 0 });
    configureServices({ book, reflowStored: documentFor(book) });

    const rendered = await driveHook(() => useReflowReader(book, true, 0, false));
    const hook = rendered.snapshots.at(-1)!;

    const target = expectedBlockForPage(7);
    hook.reportVisibleBlock(target);
    unmountHook();
    // The unmount cleanup fires the flush; let its promise resolve.
    await new Promise((resolve) => setTimeout(resolve, 0));

    const saved = savedReflowPositions.get(book.id);
    assert.ok(saved, 'unmount must flush the pending reflow position');
    assert.equal(saved.blockIndex, target);
  });
});

describe('PDF mode pays nothing for reflow', () => {
  test('a disabled hook loads no document and writes no position', async () => {
    const book = bookWith({ lastPage: 35 });
    configureServices({ book, reflowStored: documentFor(book) });

    const result = await driveHook(() => useReflowReader(book, false, 35, false));
    const final = result.snapshots.at(-1)!;

    assert.equal(final.state.status, 'idle');
    assert.equal(final.state.initialBlockIndex, null);
    assert.equal(final.state.blocks.length, 0);
    assert.equal(repositoryCalls.length, 0, 'PDF mode must not write a reflow position');
    unmountHook();
  });
});

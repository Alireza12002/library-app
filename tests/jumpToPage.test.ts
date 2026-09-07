/**
 * Jump-to-page tests (ARCHITECTURE.md §9).
 *
 * Two halves, matching where the logic lives:
 *  - input validation in JumpToPageSheet (pure, so tested directly);
 *  - clamping and native dispatch in useReader.setPage, driven through the hook
 *    harness so the real hook runs.
 *
 * The load-bearing property for performance is that a jump goes through the
 * engine controller — a native command — and never changes a renderer prop, which
 * would make react-native-pdf reopen and re-rasterize the document.
 */
import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';

import { validatePageInput } from '@/features/reader/pageNavigation';
import { useReader } from '@/features/reader/hooks/useReader';
import { driveHook, settleHook, unmountHook } from './helpers/hookHarness';
import { configureServices, makeBook } from './helpers/servicesStub';

describe('jump-to-page input validation', () => {
  test('accepts a page in range and converts to a 0-based index', () => {
    const result = validatePageInput('7', 100);
    assert.deepEqual(result, { ok: true, pageIndex: 6 });
  });

  test('accepts the first page', () => {
    assert.deepEqual(validatePageInput('1', 10), { ok: true, pageIndex: 0 });
  });

  test('accepts the last page', () => {
    assert.deepEqual(validatePageInput('10', 10), { ok: true, pageIndex: 9 });
  });

  test('tolerates surrounding whitespace', () => {
    assert.deepEqual(validatePageInput('  4  ', 10), { ok: true, pageIndex: 3 });
  });

  test('rejects an empty entry', () => {
    const result = validatePageInput('', 10);
    assert.equal(result.ok, false);
  });

  test('rejects page zero — pages are 1-based in the UI', () => {
    const result = validatePageInput('0', 10);
    assert.equal(result.ok, false);
    assert.match(result.ok === false ? result.error : '', /start at 1/i);
  });

  test('rejects a page past the end and says how many there are', () => {
    const result = validatePageInput('11', 10);
    assert.equal(result.ok, false);
    assert.match(result.ok === false ? result.error : '', /10 pages/);
  });

  test('uses the singular in the error for a one-page document', () => {
    const result = validatePageInput('5', 1);
    assert.equal(result.ok, false);
    assert.match(result.ok === false ? result.error : '', /1 page\./);
  });

  test('rejects non-numeric input', () => {
    for (const input of ['abc', '1.5', '-3', '1e5', '٧', '12a']) {
      const result = validatePageInput(input, 100);
      assert.equal(result.ok, false, `"${input}" should be rejected`);
    }
  });

  test('accepts any positive page when the count is unknown', () => {
    // pageCount is null until the renderer reports it; blocking entry then would
    // make the feature unusable on the first frames after opening.
    assert.deepEqual(validatePageInput('999', null), { ok: true, pageIndex: 998 });
  });

  test('rejects an absurdly large number safely', () => {
    const result = validatePageInput('999999999999999999999999', 100);
    assert.equal(result.ok, false);
  });
});

interface Probe {
  currentPage: number;
  initialPage: number;
  pageCount: number | null;
  setPage: (pageIndex: number) => void;
  onLoaded: (info: { pageCount: number }) => void;
  onPageChanged: (position: { pageIndex: number }) => void;
  controllerBox: { current: { setPage(n: number): void } | null };
}

function probe() {
  return () => {
    const reader = useReader('book-1', 0);
    return {
      currentPage: reader.currentPage,
      initialPage: reader.initialPage,
      pageCount: reader.pageCount,
      setPage: reader.setPage,
      onLoaded: reader.onLoaded,
      onPageChanged: reader.onPageChanged,
      controllerBox: reader.controllerBox as Probe['controllerBox'],
    } satisfies Probe;
  };
}

/** Opens a book, attaches a fake native controller, reports the jump log. */
async function openWithController(pageCount: number) {
  const render = probe();
  const mounted = await driveHook<Probe>(render);
  const snapshot = mounted.snapshots.at(-1);
  assert.ok(snapshot);

  const jumps: number[] = [];
  snapshot.controllerBox.current = { setPage: (n) => jumps.push(n) };
  // The renderer reports the document loaded, which is what publishes pageCount.
  snapshot.onLoaded({ pageCount });
  const ready = (await settleHook<Probe>(render)).snapshots.at(-1);
  assert.ok(ready);

  return { render, jumps, snapshot: ready };
}

beforeEach(() => {
  unmountHook();
  configureServices();
});

describe('useReader.setPage', () => {
  test('dispatches the requested page to the native controller', async () => {
    const { jumps, snapshot } = await openWithController(50);

    snapshot.setPage(20);

    assert.deepEqual(jumps, [20]);
  });

  test('clamps a negative index to the first page', async () => {
    const { jumps, snapshot } = await openWithController(50);

    snapshot.setPage(-5);

    assert.deepEqual(jumps, [0]);
  });

  test('clamps past-the-end to the last page', async () => {
    const { jumps, snapshot } = await openWithController(10);

    snapshot.setPage(999);

    assert.deepEqual(jumps, [9], 'should clamp to the last 0-based index');
  });

  test('floors a fractional index', async () => {
    const { jumps, snapshot } = await openWithController(50);

    snapshot.setPage(12.9);

    assert.deepEqual(jumps, [12]);
  });

  test('ignores NaN and Infinity instead of dispatching garbage', async () => {
    const { jumps, snapshot } = await openWithController(50);

    snapshot.setPage(Number.NaN);
    snapshot.setPage(Number.POSITIVE_INFINITY);
    snapshot.setPage(Number.NEGATIVE_INFINITY);

    assert.deepEqual(jumps, [], 'no navigation should be attempted');
  });

  test('is a no-op when the renderer is not mounted', async () => {
    const render = probe();
    const mounted = await driveHook<Probe>(render);
    const snapshot = mounted.snapshots.at(-1);
    assert.ok(snapshot);

    // controllerBox.current is null until the adapter mounts the native view.
    assert.equal(snapshot.controllerBox.current, null);
    assert.doesNotThrow(() => snapshot.setPage(5));
  });

  test('a jump does not change the frozen open-at page', async () => {
    configureServices({ book: makeBook({ lastPage: 2, pageCount: 40 }) });
    const { render, snapshot } = await openWithController(40);

    assert.equal(snapshot.initialPage, 2);

    snapshot.setPage(30);
    // The renderer confirms the move, exactly as the native view would.
    snapshot.onPageChanged({ pageIndex: 30 });
    const after = (await settleHook<Probe>(render)).snapshots.at(-1);
    assert.ok(after);

    assert.equal(after.currentPage, 30, 'UI must reflect the new page');
    assert.equal(
      after.initialPage,
      2,
      'initialPage must stay frozen — it is a native prop, and changing it ' +
        'reloads and re-rasterizes the whole document',
    );
  });

  test('setPage identity survives page changes', async () => {
    const { render, snapshot } = await openWithController(20);
    const before = snapshot.setPage;

    snapshot.onPageChanged({ pageIndex: 4 });
    const after = (await settleHook<Probe>(render)).snapshots.at(-1);
    assert.ok(after);

    // A changing identity would invalidate every memoized caller each page turn.
    assert.equal(after.setPage, before);
  });

  test('repeated jumps all reach the controller in order', async () => {
    const { jumps, snapshot } = await openWithController(100);

    for (const page of [10, 0, 99, 50]) snapshot.setPage(page);

    assert.deepEqual(jumps, [10, 0, 99, 50]);
  });
});

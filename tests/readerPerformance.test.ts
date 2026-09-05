/**
 * Reader performance regression tests (ARCHITECTURE.md §9).
 *
 * These pin the property that makes the reader smooth: turning a page must not
 * change the identity of anything the native PDF view receives as a prop.
 *
 * Why identity and not "looks right": react-native-pdf's Android ViewManager
 * reloads and re-rasterizes the whole document on ANY prop update
 * (PdfManager.onAfterUpdateTransaction → PdfView.drawPdf →
 * fromUri().defaultPage(...)). A new `source` object, a new `initialPosition`, or
 * a new callback closure per render therefore turns each page turn into a full
 * document reopen from disk — invisible in a screenshot, devastating to frame
 * timing. A unit test on identity is the only cheap way to catch a regression
 * here, since the cost is paid natively.
 *
 * The screen composes these values with useMemo; this suite exercises the hook
 * contract those memos depend on (`initialPage` frozen at resolve, callbacks
 * stable across page changes).
 */
import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';

import { useReader } from '@/features/reader/hooks/useReader';
import { driveHook, settleHook, unmountHook } from './helpers/hookHarness';
import { configureServices, makeBook } from './helpers/servicesStub';

interface Probe {
  currentPage: number;
  initialPage: number;
  pageCount: number | null;
  onPageChanged: (position: { pageIndex: number }) => void;
  onLoaded: (info: { pageCount: number }) => void;
  onError: unknown;
  controllerBox: unknown;
}

function probeReader() {
  return () => {
    const reader = useReader('book-1', 0);
    return {
      currentPage: reader.currentPage,
      initialPage: reader.initialPage,
      pageCount: reader.pageCount,
      onPageChanged: reader.onPageChanged,
      onLoaded: reader.onLoaded,
      onError: reader.onError,
      controllerBox: reader.controllerBox,
    } satisfies Probe;
  };
}

beforeEach(() => {
  unmountHook();
  configureServices();
});

describe('reader page turns do not invalidate native props', () => {
  test('initialPage stays frozen while currentPage advances', async () => {
    configureServices({ book: makeBook({ lastPage: 3, pageCount: 100 }) });
    const render = probeReader();

    const mounted = await driveHook<Probe>(render);
    const afterOpen = mounted.snapshots.at(-1);
    assert.ok(afterOpen);
    assert.equal(afterOpen.currentPage, 3, 'opens at the restored page');
    assert.equal(afterOpen.initialPage, 3, 'initialPage captures the restored page');

    // The renderer reports the document loaded, then the user scrolls forward.
    afterOpen.onLoaded({ pageCount: 100 });
    afterOpen.onPageChanged({ pageIndex: 4 });
    const afterTurn = await settleHook<Probe>(render);
    const turned = afterTurn.snapshots.at(-1);
    assert.ok(turned);

    assert.equal(turned.currentPage, 4, 'currentPage follows the scroll');
    assert.equal(
      turned.initialPage,
      3,
      'initialPage must NOT follow currentPage — feeding it back into the ' +
        'renderer prop reloads and re-rasterizes the document on every page turn',
    );
  });

  test('several page turns never move initialPage', async () => {
    configureServices({ book: makeBook({ lastPage: 0, pageCount: 50 }) });
    const render = probeReader();

    const mounted = await driveHook<Probe>(render);
    let snapshot = mounted.snapshots.at(-1);
    assert.ok(snapshot);
    snapshot.onLoaded({ pageCount: 50 });

    for (const page of [1, 2, 3, 7, 20]) {
      snapshot!.onPageChanged({ pageIndex: page });
      const result = await settleHook<Probe>(render);
      snapshot = result.snapshots.at(-1);
      assert.ok(snapshot);
      assert.equal(snapshot.currentPage, page);
      assert.equal(snapshot.initialPage, 0, `initialPage drifted at page ${page}`);
    }
  });

  test('renderer callbacks keep their identity across page turns', async () => {
    const render = probeReader();

    const mounted = await driveHook<Probe>(render);
    const before = mounted.snapshots.at(-1);
    assert.ok(before);

    before.onLoaded({ pageCount: 10 });
    before.onPageChanged({ pageIndex: 5 });
    const after = (await settleHook<Probe>(render)).snapshots.at(-1);
    assert.ok(after);

    // Each of these is spread into the native view's props by the reader screen.
    assert.equal(after.onPageChanged, before.onPageChanged, 'onPageChange identity changed');
    assert.equal(after.onLoaded, before.onLoaded, 'onLoad identity changed');
    assert.equal(after.onError, before.onError, 'onError identity changed');
    assert.equal(after.controllerBox, before.controllerBox, 'controllerBox identity changed');
  });

  test('the controller box survives page turns so imperative jumps keep working', async () => {
    const render = probeReader();
    const mounted = await driveHook<Probe>(render);
    const snapshot = mounted.snapshots.at(-1);
    assert.ok(snapshot);

    // The adapter fills the box on mount; the screen calls setPage() through it
    // instead of changing props. Simulate the adapter, then a page turn.
    const box = snapshot.controllerBox as { current: { setPage(n: number): void } | null };
    const jumps: number[] = [];
    box.current = { setPage: (n) => jumps.push(n) };

    snapshot.onLoaded({ pageCount: 10 });
    snapshot.onPageChanged({ pageIndex: 2 });
    const after = (await settleHook<Probe>(render)).snapshots.at(-1);
    assert.ok(after);

    const boxAfter = after.controllerBox as { current: { setPage(n: number): void } | null };
    boxAfter.current?.setPage(6);
    assert.deepEqual(jumps, [6], 'imperative navigation must survive a page turn');
  });

  test('a page turn does not re-resolve the book', async () => {
    const render = probeReader();
    const mounted = await driveHook<Probe>(render);
    const snapshot = mounted.snapshots.at(-1);
    assert.ok(snapshot);

    const { serviceCalls } = await import('./helpers/servicesStub');
    const callsAfterOpen = serviceCalls.length;

    snapshot.onLoaded({ pageCount: 10 });
    snapshot.onPageChanged({ pageIndex: 1 });
    await settleHook<Probe>(render);

    // onLoaded stamps recency once (openBook); nothing may re-read the row.
    const newCalls = serviceCalls.slice(callsAfterOpen);
    assert.equal(
      newCalls.filter((call) => call.startsWith('books.getBook')).length,
      0,
      `a page turn re-read the book row: ${JSON.stringify(newCalls)}`,
    );
  });
});

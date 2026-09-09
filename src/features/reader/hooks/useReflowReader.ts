/**
 * useReflowReader — Reflow Reader state machine (ARCHITECTURE.md §3, L5).
 *
 * Owns loading (and, on first use, generating) the WHOLE-BOOK reflow document plus
 * the reading position that survives mode switches and app restarts. The
 * ReflowReader component renders; this decides.
 *
 * WHOLE-BOOK, GENERATED ONCE
 * --------------------------
 * The document comes from `reflowService.getDocument`, which returns a persisted
 * document when one is usable and only extracts when it is not. So a mode switch, a
 * remount, or a re-render is a single indexed SQLite read — never a re-parse of the
 * PDF. Generation is batched with a yield between batches and reports progress, so
 * it cannot block scrolling.
 *
 * DIRECT OPENING (no visible scroll from the start)
 * -------------------------------------------------
 * `initialBlockIndex` is published ATOMICALLY with the ready state, and the
 * ReflowReader hands it to FlatList as `initialScrollIndex`: the virtualized list
 * renders its first window AT the target block — blocks 0..target-1 are never
 * rendered — and lands on the exact offset with one internal non-animated scroll
 * after layout. The reader therefore appears directly at the target position.
 *
 * POSITION MAPPING
 * ----------------
 * Every block carries the PDF page it came from, and the document's `pageStarts`
 * index maps page → first block in O(1). Entering reflow at PDF page N therefore
 * opens at a real block, and leaving reflow reads the current block's own page.
 * No pixel offsets, no synthesized page boundaries.
 *
 * INDEPENDENT POSITION PERSISTENCE
 * --------------------------------
 * Reflow keeps its own persisted position ({blockIndex, sourcePage}) on the book
 * row, written through the same throttling discipline as PDF page progress: at
 * most one write per REFLOW_PROGRESS_MIN_INTERVAL_MS while reading, plus flushes
 * on app background, on leaving reflow mode, and on unmount. The PDF page
 * (`lastPage`) is never touched from here, and the PDF path never writes the
 * reflow position — the two modes' positions stay independent.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { AppStateStatus } from 'react-native';

import { REFLOW_PROGRESS_MIN_INTERVAL_MS } from '@/config';
import type { Book } from '@/core/entities/book';
import {
  blockIndexToPdfPage,
  pdfPageToBlockIndex,
  resolveSavedReflowPosition,
  type ReflowDocument,
  type ReflowPosition,
  type TextBlock,
} from '@/core/entities/reflowDocument';
import { getServices, type ReflowProgress } from '@/services';

export type ReflowStatus =
  /** Reflow is not the active mode; the hook is inert. */
  | 'idle'
  /** Checking for a stored document. */
  | 'loading'
  /** No usable document existed; processing the book. */
  | 'generating'
  /** A document is available. */
  | 'ready'
  /** Reflow cannot proceed. */
  | 'error';

export interface ReflowReaderState {
  status: ReflowStatus;
  /** Progress while `status === 'generating'`; null otherwise. */
  progress: ReflowProgress | null;
  /** Error message when `status === 'error'`. */
  error: string | null;
  /** Blocks of the whole book, in reading order. Empty until ready. */
  blocks: TextBlock[];
  /** Source page count. */
  pageCount: number | null;
  /**
   * Block the reader must OPEN at, resolved from the entry position before the
   * list mounts. Fed to FlatList as `initialScrollIndex`, so the first rendered
   * window is already the target — no mount-at-top-then-scroll. Null only in the
   * brief window while an activation is resolving its target.
   */
  initialBlockIndex: number | null;
  /** True when the book has no extractable text (scanned/image-only). */
  isTextless: boolean;
}

export interface UseReflowReaderResult {
  state: ReflowReaderState;
  /**
   * PDF page for the block currently at the top of the viewport, or null when no
   * document is loaded.
   *
   * A function rather than a value: the visible block is tracked in a ref (it
   * changes on every scroll frame and must not re-render), so the answer has to be
   * computed at the moment of the mode switch. Stable identity.
   */
  getCurrentPdfPage: () => number | null;
  /**
   * Records the topmost visible block as the reader scrolls, and schedules the
   * throttled persistence of the Reflow reading position.
   */
  reportVisibleBlock: (blockIndex: number) => void;
  /** Discards the stored document and processes the book again. */
  regenerate: () => void;
}

/** Everything the load effect publishes, in one atomic state update. */
interface LoadState {
  /** Book these fields describe; a mismatch means the state is stale. */
  bookId: string | null;
  status: ReflowStatus;
  document: ReflowDocument | null;
  progress: ReflowProgress | null;
  error: string | null;
  initialBlockIndex: number | null;
}

const IDLE_LOAD_STATE: LoadState = {
  bookId: null,
  status: 'idle',
  document: null,
  progress: null,
  error: null,
  initialBlockIndex: null,
};

const NO_BLOCKS: TextBlock[] = [];

/** The book's saved Reflow position, or null when none was ever persisted. */
function savedPositionFrom(book: Book | null): ReflowPosition | null {
  if (book === null || book.reflowBlockIndex === null || book.reflowPageIndex === null) {
    return null;
  }
  return { blockIndex: book.reflowBlockIndex, pageIndex: book.reflowPageIndex };
}

/**
 * Resolves the block Reflow must open at.
 *
 * Fresh app open in Reflow mode restores the persisted Reflow position (validated
 * against the current document). An in-session mode switch — or a book with no
 * saved Reflow position — maps the current PDF page through the document's page
 * index instead. Both paths produce a real block index; never a pixel guess.
 */
function resolveEntryTarget(
  document: ReflowDocument,
  restoreSaved: boolean,
  saved: ReflowPosition | null,
  entryPage: number,
): number {
  if (restoreSaved) {
    const restored = resolveSavedReflowPosition(document, saved);
    if (restored !== null) return restored;
  }
  // Empty documents yield -1; the reader shows the textless notice, so the
  // clamped 0 is never rendered as a position.
  return Math.max(0, pdfPageToBlockIndex(document, entryPage));
}

/**
 * @param book      Resolved book, or null while the reader is still opening.
 * @param enabled   True only while reflow mode is showing.
 * @param entryPage PDF page the user was on when reflow was entered. The document
 *                  is opened at the content originating from this page.
 * @param restoreSavedPosition True when reflow was entered by session restore
 *                  (the reader opened with Reflow as the persisted mode) rather
 *                  than by an in-session mode toggle — the saved Reflow position
 *                  is then preferred over the current PDF page.
 */
export function useReflowReader(
  book: Book | null,
  enabled: boolean,
  entryPage: number,
  restoreSavedPosition = false,
): UseReflowReaderResult {
  const [load, setLoad] = useState<LoadState>(IDLE_LOAD_STATE);
  /** Bumped by `regenerate` to re-run the load effect. */
  const [reloadToken, setReloadToken] = useState(0);

  const bookId = book?.id ?? null;

  /**
   * Entry page and visible block live in refs.
   *
   * Entry page changes on every page turn in PDF mode; depending on it would re-run
   * the load effect each turn. Visible block changes on every scroll frame; making
   * it state would re-render the reader continuously. Both are written in effects,
   * never during render (a render-phase ref write is unsafe under concurrent
   * rendering, and ESLint's react-hooks rules reject it).
   */
  const entryPageRef = useRef(entryPage);
  useEffect(() => {
    entryPageRef.current = entryPage;
  }, [entryPage]);

  const visibleBlockRef = useRef(0);

  /** Live document for the stable `getCurrentPdfPage` callback. */
  const documentRef = useRef<ReflowDocument | null>(null);

  /**
   * Activation transitions are resolved DURING RENDER (React's "adjust state when
   * a prop changes" pattern) so the first committed frame of a reflow activation
   * already carries its open-at block — the list never mounts at the top of the
   * book and then scrolls.
   */
  const [lastEnabled, setLastEnabled] = useState(enabled);
  if (lastEnabled !== enabled) {
    setLastEnabled(enabled);
    if (enabled && book !== null) {
      if (load.bookId === book.id && load.status === 'ready' && load.document !== null) {
        // RE-ENTRY: the document is already in memory from a previous activation
        // this session, so the target is resolved synchronously from where the
        // user is NOW — the current PDF page for an in-session switch, or the
        // saved position when reflow is the mode the session restored. No
        // re-read, no re-parse, no spinner.
        setLoad({
          ...load,
          initialBlockIndex: resolveEntryTarget(
            load.document,
            restoreSavedPosition,
            savedPositionFrom(book),
            entryPage,
          ),
        });
      } else {
        // First activation (or retry after a failed load): the async load path
        // below resolves the document and publishes the target with it.
        setLoad({ ...IDLE_LOAD_STATE, bookId: book.id, status: 'loading' });
      }
    } else if (!enabled) {
      // Leaving reflow: drop the open-at target so the next activation resolves
      // a fresh one before the list mounts. The document stays cached for the
      // re-entry path above.
      setLoad((current) =>
        current.initialBlockIndex === null ? current : { ...current, initialBlockIndex: null },
      );
    }
  }

  /**
   * Last committed load state. Synced BEFORE the load effect (declaration order is
   * effect order) so the effect below observes the render-phase activation update
   * and can tell a re-entry — already fully resolved — from a fresh load.
   */
  const loadRef = useRef<LoadState>(IDLE_LOAD_STATE);
  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  useEffect(() => {
    // Nothing to reset when disabled: `state` derives 'idle' from `enabled`, and
    // keeping the loaded document means re-entering reflow reuses it instead of
    // reloading. (A setState here would also be a synchronous cascade in an effect.)
    if (!enabled || !book) return;

    const controller = new AbortController();
    const targetBookId = book.id;
    let cancelled = false;

    // The render-phase activation above already resolved everything this effect
    // would do for an in-memory document, so a re-entry with a live document and
    // a published target skips the storage round-trip entirely. (`regenerate`
    // resets the load to idle, which re-arms the full flow below.)
    const inMemory = loadRef.current;
    if (
      inMemory.bookId === targetBookId &&
      inMemory.status === 'ready' &&
      inMemory.document !== null &&
      inMemory.initialBlockIndex !== null
    ) {
      return;
    }

    // Marking the load in flight happens inside the async body (after an await),
    // so no setState runs synchronously during the effect.
    void (async () => {
      try {
        const { reflow } = await getServices();
        if (cancelled) return;

        setLoad((current) =>
          current.bookId === targetBookId && current.status === 'ready'
            ? current
            : { ...IDLE_LOAD_STATE, bookId: targetBookId, status: 'loading' },
        );

        // Fast path: a persisted document for this exact file and format version.
        const stored = await reflow.getStored(book);
        if (cancelled) return;

        if (stored) {
          setLoad({
            bookId: targetBookId,
            status: 'ready',
            document: stored,
            progress: null,
            error: null,
            initialBlockIndex: resolveEntryTarget(
              stored,
              restoreSavedPosition,
              savedPositionFrom(book),
              entryPageRef.current,
            ),
          });
          return;
        }

        // Slow path, taken once per book: process the whole PDF.
        setLoad({
          bookId: targetBookId,
          status: 'generating',
          document: null,
          progress: { processedPages: 0, totalPages: book.pageCount ?? 0, blockCount: 0 },
          error: null,
          initialBlockIndex: null,
        });

        const generated = await reflow.getDocument(book, {
          signal: controller.signal,
          onProgress: (next) => {
            if (cancelled) return;
            setLoad((current) =>
              current.bookId === targetBookId && current.status === 'generating'
                ? { ...current, progress: next }
                : current,
            );
          },
        });
        if (cancelled) return;

        setLoad({
          bookId: targetBookId,
          status: 'ready',
          document: generated,
          progress: null,
          error: null,
          initialBlockIndex: resolveEntryTarget(
            generated,
            restoreSavedPosition,
            savedPositionFrom(book),
            entryPageRef.current,
          ),
        });
      } catch (caught) {
        if (cancelled || controller.signal.aborted) return;

        const message =
          caught && typeof caught === 'object' && 'message' in caught
            ? String((caught as { message: unknown }).message)
            : 'Could not prepare this book for reflow reading.';

        setLoad((current) =>
          // A document already on screen for this book stays; only report the error.
          current.bookId === targetBookId && current.document !== null
            ? { ...current, progress: null, error: message }
            : {
                bookId: targetBookId,
                status: 'error',
                document: null,
                progress: null,
                error: message,
                initialBlockIndex: null,
              },
        );
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [enabled, book, reloadToken, restoreSavedPosition]);

  useEffect(() => {
    documentRef.current = load.bookId === bookId ? load.document : null;
  }, [load.bookId, load.document, bookId]);

  const state = useMemo<ReflowReaderState>(() => {
    if (!enabled) {
      return {
        status: 'idle',
        progress: null,
        error: null,
        blocks: NO_BLOCKS,
        pageCount: null,
        initialBlockIndex: null,
        isTextless: false,
      };
    }

    // State from a previous book is ignored rather than cleared in an effect.
    const fresh = load.bookId === bookId;
    const document = fresh ? load.document : null;

    return {
      status: fresh ? load.status : 'loading',
      progress: fresh ? load.progress : null,
      error: fresh ? load.error : null,
      blocks: document?.blocks ?? NO_BLOCKS,
      pageCount: document?.pageCount ?? null,
      initialBlockIndex: fresh ? load.initialBlockIndex : null,
      // Only a finished document with no blocks is genuinely textless.
      isTextless: fresh && load.status === 'ready' && (document?.blocks.length ?? 0) === 0,
    };
  }, [enabled, load, bookId]);

  // ---------------------------------------------------------------------------
  // Reflow position persistence — throttled leading+trailing writes.
  // ---------------------------------------------------------------------------

  const pendingBlockRef = useRef<number | null>(null);
  /** Block index already persisted, so unchanged positions skip the write. */
  const lastSavedBlockRef = useRef<number | null>(null);
  const lastWriteAtRef = useRef(0);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushReflowPosition = useCallback(async () => {
    const pending = pendingBlockRef.current;
    const document = documentRef.current;
    const id = bookId;
    if (pending === null || document === null || !id) return;

    if (pending === lastSavedBlockRef.current) {
      pendingBlockRef.current = null;
      return;
    }

    try {
      const repos = await getRepositories();
      await repos.books.updateReflowPosition(id, {
        blockIndex: pending,
        // The source page is persisted alongside the block so a stale index
        // (regenerated document) can be re-resolved semantically on restore.
        pageIndex: blockIndexToPdfPage(document, pending),
      });
      lastSavedBlockRef.current = pending;
      pendingBlockRef.current = null;
    } catch {
      // Persistence failed; keep the pending block so the next flush retries.
      // Never blocks the UI.
    }
  }, [bookId]);

  /**
   * Throttle: write immediately if the last write is old enough, else schedule
   * one trailing write. At most one storage write per interval while scrolling —
   * never one per frame — and the final position lands after scrolling stops.
   */
  const scheduleReflowPositionWrite = useCallback(() => {
    const elapsed = Date.now() - lastWriteAtRef.current;
    if (elapsed >= REFLOW_PROGRESS_MIN_INTERVAL_MS) {
      lastWriteAtRef.current = Date.now();
      void flushReflowPosition();
      return;
    }
    if (saveTimerRef.current === null) {
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null;
        lastWriteAtRef.current = Date.now();
        void flushReflowPosition();
      }, REFLOW_PROGRESS_MIN_INTERVAL_MS - elapsed);
    }
  }, [flushReflowPosition]);

  /** Records the topmost visible block and schedules the position write. */
  const reportVisibleBlock = useCallback(
    (blockIndex: number) => {
      visibleBlockRef.current = blockIndex;
      if (documentRef.current === null) return;
      pendingBlockRef.current = blockIndex;
      scheduleReflowPositionWrite();
    },
    [scheduleReflowPositionWrite],
  );

  // Flush on AppState change (active -> background/inactive), like PDF progress.
  useEffect(() => {
    const handleAppStateChange = (nextState: AppStateStatus) => {
      if (nextState === 'background' || nextState === 'inactive') {
        if (saveTimerRef.current !== null) {
          clearTimeout(saveTimerRef.current);
          saveTimerRef.current = null;
        }
        void flushReflowPosition();
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => {
      subscription.remove();
    };
  }, [flushReflowPosition]);

  // Flush on unmount and stop any scheduled trailing write.
  useEffect(() => {
    return () => {
      if (saveTimerRef.current !== null) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      void flushReflowPosition();
    };
  }, [flushReflowPosition]);

  // Leaving reflow mode flushes any pending position write immediately — the
  // Reflow position is stored independently and must survive the mode switch.
  // (Dropping the open-at target happens in the render-phase activation above.)
  useEffect(() => {
    if (enabled) return;
    if (saveTimerRef.current !== null) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    void flushReflowPosition();
  }, [enabled, flushReflowPosition]);

  const regenerate = useCallback(() => {
    if (!book) return;
    void (async () => {
      const { reflow } = await getServices();
      await reflow.invalidate(book.id);
      setLoad(IDLE_LOAD_STATE);
      setReloadToken((token) => token + 1);
    })();
  }, [book]);

  /**
   * PDF page corresponding to the current reflow position.
   *
   * Read from the block itself, so it is the page the extractor actually recorded —
   * no division, no estimation. A callback because the visible block lives in a ref
   * that updates during scrolling without re-rendering; the value is only needed at
   * the instant the user switches modes. Both inputs come from refs, so the identity
   * is stable and the screen's memoized mode-switch handler is never invalidated.
   */
  const getCurrentPdfPage = useCallback((): number | null => {
    const document = documentRef.current;
    if (!document || document.blocks.length === 0) return null;
    return blockIndexToPdfPage(document, visibleBlockRef.current);
  }, []);

  return { state, getCurrentPdfPage, reportVisibleBlock, regenerate };
}

// Repositories are reached through a lazy import so this hook keeps a single
// service seam at import time (same discipline as useReadingProgress, which
// goes through getServices()); the persistence write itself is throttled.
async function getRepositories() {
  const { getRepositories: getRepos } = await import('@/data');
  return getRepos();
}

/**
 * useReflowReader — Reflow Reader state machine (ARCHITECTURE.md §3, L5).
 *
 * Owns loading (and, on first use, generating) the WHOLE-BOOK reflow document plus
 * the reading position that survives mode switches. The ReflowReader component
 * renders; this decides.
 *
 * WHOLE-BOOK, GENERATED ONCE
 * --------------------------
 * The document comes from `reflowService.getDocument`, which returns a persisted
 * document when one is usable and only extracts when it is not. So a mode switch, a
 * remount, or a re-render is a single indexed SQLite read — never a re-parse of the
 * PDF. Generation is batched with a yield between batches and reports progress, so
 * it cannot block scrolling.
 *
 * POSITION MAPPING
 * ----------------
 * Every block carries the PDF page it came from, and the document's `pageStarts`
 * index maps page → first block in O(1). Entering reflow at PDF page N therefore
 * scrolls to a real block, and leaving reflow reads the current block's own page.
 * No pixel offsets, no synthesized page boundaries.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { Book } from '@/core/entities/book';
import {
  blockIndexToPdfPage,
  pdfPageToBlockIndex,
  type ReflowDocument,
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
   * Block the reader should scroll to, derived from the PDF page the user was on.
   * Null once consumed, so a later scroll is not overridden.
   */
  scrollToBlock: number | null;
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
  /** Records the topmost visible block as the reader scrolls. */
  reportVisibleBlock: (blockIndex: number) => void;
  /** Marks the pending scroll target as consumed. */
  consumeScrollTarget: () => void;
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
  scrollToBlock: number | null;
}

const IDLE_LOAD_STATE: LoadState = {
  bookId: null,
  status: 'idle',
  document: null,
  progress: null,
  error: null,
  scrollToBlock: null,
};

const NO_BLOCKS: TextBlock[] = [];

/**
 * @param book      Resolved book, or null while the reader is still opening.
 * @param enabled   True only while reflow mode is showing.
 * @param entryPage PDF page the user was on when reflow was entered. The document
 *                  is scrolled to the content originating from this page.
 */
export function useReflowReader(
  book: Book | null,
  enabled: boolean,
  entryPage: number,
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

  useEffect(() => {
    // Nothing to reset when disabled: `state` derives 'idle' from `enabled`, and
    // keeping the loaded document means re-entering reflow reuses it instead of
    // reloading. (A setState here would also be a synchronous cascade in an effect.)
    if (!enabled || !book) return;

    const controller = new AbortController();
    const targetBookId = book.id;
    let cancelled = false;

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
            scrollToBlock: pdfPageToBlockIndex(stored, entryPageRef.current),
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
          scrollToBlock: null,
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
          scrollToBlock: pdfPageToBlockIndex(generated, entryPageRef.current),
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
                scrollToBlock: null,
              },
        );
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [enabled, book, reloadToken]);

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
        scrollToBlock: null,
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
      scrollToBlock: fresh ? load.scrollToBlock : null,
      // Only a finished document with no blocks is genuinely textless.
      isTextless: fresh && load.status === 'ready' && (document?.blocks.length ?? 0) === 0,
    };
  }, [enabled, load, bookId]);

  const reportVisibleBlock = useCallback((blockIndex: number) => {
    visibleBlockRef.current = blockIndex;
  }, []);

  const consumeScrollTarget = useCallback(() => {
    setLoad((current) => (current.scrollToBlock === null ? current : { ...current, scrollToBlock: null }));
  }, []);

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

  return { state, getCurrentPdfPage, reportVisibleBlock, consumeScrollTarget, regenerate };
}

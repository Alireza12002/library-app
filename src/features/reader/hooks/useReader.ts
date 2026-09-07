/**
 * useReader — the Reader screen's state machine (ARCHITECTURE.md §3, L5).
 *
 * Owns: book resolution, file-availability check, load/page/error tracking and
 * the imperative navigation box. The screen renders; this decides.
 * Reading progress persistence is delegated to useReadingProgress.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import type { Book } from '@/core/entities/book';
import type { PdfEngineController, PdfEngineError } from '@/core/ports/pdfEngine';
import { getServices } from '@/services';
import { useReadingProgress } from './useReadingProgress';

export interface UseReaderResult {
  book: Book | null;
  /** True until the book row + file are resolved (or fail). */
  isResolving: boolean;
  /** Set when the book/file cannot be used at all — render the fatal state. */
  fatal: string | null;
  pageCount: number | null;
  currentPage: number;
  /**
   * The page the document should be OPENED at, captured once when the book
   * resolves and never updated afterwards.
   *
   * Deliberately separate from `currentPage`: feeding the live page back into
   * the renderer's `initialPosition`/`page` prop makes every page turn a native
   * prop change, and react-native-pdf reloads and re-rasterizes the whole
   * document on any prop update (PdfManager.onAfterUpdateTransaction →
   * PdfView.drawPdf). Post-mount navigation must go through
   * `controllerBox.setPage()` instead, which issues a native command without
   * touching props.
   */
  initialPage: number;
  renderError: PdfEngineError | null;
  isLoaded: boolean;
  controllerBox: { current: PdfEngineController | null };
  /**
   * Navigates the mounted document to a 0-based page index, clamped to the
   * document's range.
   *
   * This is the only navigation path callers should use. It issues a native
   * command through the engine controller, so the document is NOT reopened or
   * re-rasterized the way a prop change would force
   * (PdfManager.onAfterUpdateTransaction → PdfView.drawPdf). Stable identity, so
   * it is safe in a memoized callback's dependency list.
   *
   * No-op when the renderer is not mounted yet. `currentPage` is not written
   * here: the renderer's onPageChange remains the single source of truth.
   */
  setPage: (pageIndex: number) => void;
  onLoaded: (info: { pageCount: number }) => void;
  onPageChanged: (position: { pageIndex: number }) => void;
  onError: (error: PdfEngineError) => void;
}

export function useReader(bookId: string, initialPageIndex: number): UseReaderResult {
  const [book, setBook] = useState<Book | null>(null);
  const [isResolving, setIsResolving] = useState(true);
  const [fatal, setFatal] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState(initialPageIndex);
  const [renderError, setRenderError] = useState<PdfEngineError | null>(null);
  // Captured once per resolved document; see UseReaderResult.initialPage.
  const [initialPage, setInitialPage] = useState(initialPageIndex);

  // Stable mutable box; the adapter fills it while the native view is mounted.
  //
  // useRef, not useMemo: both give a stable object, but only useRef is recognised
  // as a ref by the React Compiler, which lets callers read `.current` inside a
  // useCallback without it being inferred as a dependency. With useMemo the
  // compiler treats `.current` as ordinary state and refuses to memoize the
  // navigation callbacks (react-hooks/preserve-manual-memoization).
  const controllerBox = useRef<PdfEngineController | null>(null);

  // Recency stamping lives here because this hook knows when the document has
  // actually rendered. (Recency data only — NOT persistent reading progress.)
  // A ref, not state: resetting it must not re-render anything.
  const hasStampedOpenRef = useRef(false);

  // Reading progress persistence hook.
  const { onPageChange: persistPageChange, getInitialPage } = useReadingProgress(book);

  // Live page count for callbacks that must not change identity when it moves.
  // Synced in an effect, never during render (unsafe under concurrent rendering).
  const pageCountRef = useRef<number | null>(null);
  useEffect(() => {
    pageCountRef.current = pageCount;
  }, [pageCount]);

  const onLoaded = useCallback(
    (info: { pageCount: number }) => {
      setPageCount(info.pageCount);
      // Keep the ref current immediately: onPageChanged can fire in the same
      // native batch as onLoad, before the sync effect above has run.
      pageCountRef.current = info.pageCount;
      if (!hasStampedOpenRef.current) {
        hasStampedOpenRef.current = true;
        void getServices()
          .then(({ books }) => books.openBook(bookId))
          .catch(() => {
            // Recency is cosmetic; never block reading on it.
          });
      }
    },
    [bookId],
  );

  // Page change handler: update local state AND persist via useReadingProgress.
  //
  // Identity must survive page turns: this function is spread into the native
  // PDF view's props, and react-native-pdf re-rasterizes the document on any
  // prop change. Hence pageCount is read from a ref instead of being a
  // dependency.
  const onPageChanged = useCallback(
    (position: { pageIndex: number }) => {
      setCurrentPage(position.pageIndex);
      // Fire-and-forget persistence (debounced inside the hook).
      persistPageChange(position.pageIndex, pageCountRef.current);
    },
    [persistPageChange],
  );

  useEffect(() => {
    let cancelled = false;

    async function resolve() {
      setIsResolving(true);
      setFatal(null);
      setRenderError(null);
      setPageCount(null);

      try {
        const { books } = await getServices();
        const resolved = await books.getBook(bookId);

        if (cancelled) return;
        if (!resolved) {
          setFatal('This book no longer exists in your library.');
          setIsResolving(false);
          return;
        }

        const fileAvailable = await books.isFileAvailable(bookId);
        if (cancelled) return;
        if (!fileAvailable) {
          setFatal('The PDF file for this book is missing or was deleted.');
          setIsResolving(false);
          return;
        }

        // Set the book first so downstream hooks see the resolved entity.
        setBook(resolved);

        // Compute the restored page from saved progress (validated against
        // pageCount). The resolved book is passed explicitly: reading it from
        // state here would make this effect depend on its own output.
        const restored = getInitialPage(resolved);
        setCurrentPage(restored);
        // Frozen open-at page: this is what the renderer receives as a prop.
        setInitialPage(restored);

        setIsResolving(false);
      } catch (resolveError) {
        if (!cancelled) {
          setFatal(
            resolveError instanceof Error && resolveError.message
              ? resolveError.message
              : 'Could not open this book.',
          );
          setIsResolving(false);
        }
      }
    }

    void resolve();
    return () => {
      cancelled = true;
    };
  }, [bookId, getInitialPage]);

  const onError = useCallback((error: PdfEngineError) => {
    if (error.code === 'file_missing') {
      setFatal('The PDF file for this book is missing or was deleted.');
    }
    setRenderError(error);
  }, []);

  /**
   * Imperative navigation. Clamping lives here rather than in each caller so
   * every entry point (prev/next buttons, jump-to-page, bookmark jump) shares one
   * validated path into the renderer.
   */
  const setPage = useCallback((pageIndex: number) => {
    if (!Number.isFinite(pageIndex)) return;

    const count = pageCountRef.current;
    const upperBound = count === null ? Number.MAX_SAFE_INTEGER : Math.max(0, count - 1);
    const target = Math.min(Math.max(0, Math.floor(pageIndex)), upperBound);

    controllerBox.current?.setPage(target);
  }, []);

  return {
    book,
    isResolving,
    fatal,
    pageCount,
    currentPage,
    initialPage,
    renderError,
    isLoaded: pageCount !== null,
    controllerBox,
    setPage,
    onLoaded,
    onPageChanged,
    onError,
  };
}

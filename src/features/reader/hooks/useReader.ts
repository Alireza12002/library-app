/**
 * useReader — the Reader screen's state machine (ARCHITECTURE.md §3, L5).
 *
 * Owns: book resolution, file-availability check, load/page/error tracking and
 * the imperative navigation box. The screen renders; this decides.
 * Reading progress persistence is delegated to useReadingProgress.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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
  const controllerBox = useMemo<{ current: PdfEngineController | null }>(
    () => ({ current: null }),
    [],
  );

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
    onLoaded,
    onPageChanged,
    onError,
  };
}

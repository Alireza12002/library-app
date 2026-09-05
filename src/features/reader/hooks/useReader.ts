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

  const onLoaded = useCallback(
    (info: { pageCount: number }) => {
      setPageCount(info.pageCount);
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
  const onPageChanged = useCallback(
    (position: { pageIndex: number }) => {
      setCurrentPage(position.pageIndex);
      // Fire-and-forget persistence (debounced inside the hook).
      persistPageChange(position.pageIndex, pageCount);
    },
    [pageCount, persistPageChange],
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
        setCurrentPage(getInitialPage(resolved));

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
    renderError,
    isLoaded: pageCount !== null,
    controllerBox,
    onLoaded,
    onPageChanged,
    onError,
  };
}

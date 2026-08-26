/**
 * useLibrary — the Library screen's single source of truth (ARCHITECTURE.md §3).
 *
 * Owns the loading/empty/error/data state machine; the screen stays purely
 * presentational. All persistence flows through the service layer, never
 * directly from the component.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import type { BookSummary } from '@/core/entities/book';
import { getServices, type ImportResult } from '@/services';

export interface UseLibraryResult {
  books: BookSummary[];
  isLoading: boolean;
  /** True while an import round-trip is in flight. */
  isImporting: boolean;
  /** Set when list/delete/import fails; message is user-facing. */
  error: string | null;
  refresh: () => void;
  addBooks: () => Promise<void>;
  /** Marks the book opened (stamps lastOpenedAt) and returns once done. */
  openBook: (id: string) => Promise<void>;
  deleteBook: (id: string) => Promise<void>;
}

type Status = 'loading' | 'ready' | 'error';

function toUserMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function useLibrary(): UseLibraryResult {
  const [books, setBooks] = useState<BookSummary[]>([]);
  const [status, setStatus] = useState<Status>('loading');
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  // Services resolve async (open/migrate SQLite on first call); a ref keeps one
  // instance for the hook's lifetime without re-triggering effects.
  const servicesRef = useRef<ReturnType<typeof getServices> | null>(null);
  const getServicesOnce = useCallback(() => {
    servicesRef.current ??= getServices();
    return servicesRef.current;
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setStatus('loading');
      setError(null);
      try {
        const { books: bookService } = await getServicesOnce();
        const result = await bookService.listBooks();
        if (!cancelled) {
          setBooks(result);
          setStatus('ready');
        }
      } catch (loadError) {
        if (!cancelled) {
          setStatus('error');
          setError(toUserMessage(loadError, 'Could not load your library.'));
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [getServicesOnce, reloadToken]);

  const refresh = useCallback(() => setReloadToken((token) => token + 1), []);

  const addBooks = useCallback(async () => {
    setIsImporting(true);
    try {
      const { imports } = await getServicesOnce();

      let outcome: ImportResult;
      try {
        outcome = await imports.importFromPicker();
      } catch (importError) {
        setError(toUserMessage(importError, 'Could not add the book.'));
        return;
      }

      switch (outcome.status) {
        case 'canceled':
          // A cancellation is not an error; nothing happened, say nothing.
          break;
        case 'invalid':
          setError(outcome.reason);
          break;
        case 'imported':
          // Quiet success per product decision: refresh and let recency order
          // surface the new book at the top. No dialog.
          setError(null);
          await new Promise<void>((resolve) => {
            setReloadToken((token) => token + 1);
            resolve();
          });
          break;
      }
    } finally {
      setIsImporting(false);
    }
  }, [getServicesOnce]);

  const openBook = useCallback(
    async (id: string) => {
      const { books: bookService } = await getServicesOnce();
      await bookService.openBook(id);
    },
    [getServicesOnce],
  );

  const deleteBook = useCallback(
    async (id: string) => {
      try {
        const { books: bookService } = await getServicesOnce();
        await bookService.deleteBook(id);
        setBooks((current) => current.filter((book) => book.id !== id));
        setError(null);
      } catch (deleteError) {
        setError(toUserMessage(deleteError, 'Could not delete the book.'));
        setReloadToken((token) => token + 1); // re-sync with what actually happened on disk
      }
    },
    [getServicesOnce],
  );

  return {
    books,
    isLoading: status === 'loading',
    isImporting,
    error,
    refresh,
    addBooks,
    openBook,
    deleteBook,
  };
}

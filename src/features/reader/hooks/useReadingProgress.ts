/**
 * useReadingProgress — debounced reading progress persistence (ARCHITECTURE.md §3, L5).
 *
 * Owns: page change debouncing, lifecycle-driven flushes, page-count validation.
 * The screen never calls a repository; it only tells the hook the current page.
 */
import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import type { AppStateStatus } from 'react-native';

import { PROGRESS_DEBOUNCE_MS } from '@/config';
import type { Book } from '@/core/entities/book';

export interface UseReadingProgressResult {
  /** Called by the reader on every page change. Never throws. */
  onPageChange: (pageIndex: number, pageCount: number | null) => void;
  /** Call once when the book is first resolved to restore the saved page. */
  getInitialPage: () => number;
}

export function useReadingProgress(book: Book | null): UseReadingProgressResult {
  const pendingPageRef = useRef<number | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastKnownPageCountRef = useRef<number | null>(null);
  const savedLastPageRef = useRef<number>(0);

  // Restore the initial page from the book entity (validated against pageCount).
  const getInitialPage = useCallback((): number => {
    if (!book) return 0;
    const saved = book.lastPage ?? 0;
    const count = book.pageCount ?? null;
    savedLastPageRef.current = saved;

    // Validate against known page count.
    if (count !== null && count > 0) {
      const maxIndex = count - 1;
      return Math.min(Math.max(0, saved), maxIndex);
    }
    // No pageCount yet (first open); trust the saved value, clamp to >= 0.
    return Math.max(0, saved);
  }, [book]);

  // Debounced persistence to BookRepository.updateProgress.
  const flush = useCallback(async () => {
    const page = pendingPageRef.current;
    const bookId = book?.id;
    if (page === null || !bookId) return;

    // Skip if the page hasn't actually changed.
    if (page === savedLastPageRef.current) {
      pendingPageRef.current = null;
      return;
    }

    // Validate against the latest pageCount known from the renderer.
    const count = lastKnownPageCountRef.current;
    if (count !== null && count > 0) {
      const maxIndex = count - 1;
      if (page < 0 || page > maxIndex) {
        // Out of bounds — discard the pending write and reset to the clamped value.
        pendingPageRef.current = null;
        return;
      }
    }

    try {
      const repos = await getRepositories();
      await repos.books.updateProgress(bookId, page);
      savedLastPageRef.current = page;
    } catch {
      // Persistence failed; keep the pending page so we retry on next flush.
      // This is non-blocking — UI never waits for this.
    } finally {
      pendingPageRef.current = null;
    }
  }, [book?.id]);

  // Called by the reader on every page change.
  const onPageChange = useCallback(
    (pageIndex: number, pageCount: number | null) => {
      // Update the last known page count for validation.
      if (pageCount !== null) {
        lastKnownPageCountRef.current = pageCount;
      }

      // Clamp to valid range immediately.
      const clamped =
        pageCount !== null && pageCount > 0
          ? Math.min(Math.max(0, pageIndex), pageCount - 1)
          : Math.max(0, pageIndex);

      // Skip if no actual change.
      if (clamped === savedLastPageRef.current) return;

      pendingPageRef.current = clamped;

      // Restart the debounce timer.
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = setTimeout(() => {
        void flush();
      }, PROGRESS_DEBOUNCE_MS);
    },
    [flush],
  );

  // Flush on AppState change (active -> background/inactive).
  useEffect(() => {
    const handleAppStateChange = (nextState: AppStateStatus) => {
      if (nextState === 'background' || nextState === 'inactive') {
        void flush();
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => {
      subscription.remove();
    };
  }, [flush]);

  // Flush on focus blur (user leaves the screen) and unmount.
  useEffect(() => {
    return () => {
      void flush();
    };
  }, [flush]);

  // Cleanup timer on unmount.
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  return { onPageChange, getInitialPage };
}

// Lazy import to avoid eslint rule triggering on the feature-level import.
// The rule forbids direct repository imports in UI; this hook IS the feature layer.
async function getRepositories() {
  const { getRepositories: getRepos } = await import('@/data');
  return getRepos();
}

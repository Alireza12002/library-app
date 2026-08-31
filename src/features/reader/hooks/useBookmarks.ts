/**
 * useBookmarks — bookmark management for a single book (ARCHITECTURE.md §3, L5).
 *
 * Owns: bookmark list state, add/remove operations, current-page bookmark detection.
 * The screen renders; this decides.
 */
import { useCallback, useEffect, useState } from 'react';

import type { Bookmark } from '@/core/entities/bookmark';
import { getServices } from '@/services';

export interface UseBookmarksResult {
  /** All bookmarks for the current book, sorted by page then createdAt. */
  bookmarks: Bookmark[];
  /** True while the initial load is in flight. */
  isLoading: boolean;
  /** True if the current page has a bookmark. */
  isCurrentPageBookmarked: boolean;
  /** The bookmark on the current page (if any). */
  currentPageBookmark: Bookmark | null;
  /** Add a bookmark at the given page. */
  addBookmark: (pageIndex: number) => Promise<void>;
  /** Remove a bookmark by id. */
  removeBookmark: (bookmarkId: string) => Promise<void>;
  /** Toggle bookmark on the current page. */
  toggleBookmark: (pageIndex: number) => Promise<void>;
  /** Jump to a bookmark (returns the page index). */
  jumpToBookmark: (bookmarkId: string) => number | null;
  /** Refresh the bookmark list. */
  refresh: () => void;
}

export function useBookmarks(bookId: string | null, currentPageIndex: number): UseBookmarksResult {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const loadBookmarks = useCallback(async () => {
    if (!bookId) {
      setBookmarks([]);
      return;
    }

    setIsLoading(true);
    try {
      const { bookmarks: bookmarkService } = await getServices();
      const result = await bookmarkService.listByBook(bookId);
      setBookmarks(result);
    } catch {
      // Bookmarks are non-critical; fail silently and show empty list.
      setBookmarks([]);
    } finally {
      setIsLoading(false);
    }
  }, [bookId]);

  // Load on mount and when bookId changes.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!bookId) {
        if (!cancelled) setBookmarks([]);
        return;
      }

      setIsLoading(true);
      try {
        const { bookmarks: bookmarkService } = await getServices();
        const result = await bookmarkService.listByBook(bookId);
        if (!cancelled) setBookmarks(result);
      } catch {
        if (!cancelled) setBookmarks([]);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [bookId, loadBookmarks]);

  // Recompute current-page bookmark whenever bookmarks or currentPage change.
  const currentPageBookmark = bookmarks.find((bm) => bm.page === currentPageIndex) ?? null;
  const isCurrentPageBookmarked = currentPageBookmark !== null;

  const addBookmark = useCallback(
    async (pageIndex: number) => {
      if (!bookId) return;

      // Prevent duplicate bookmarks on the same page.
      const exists = bookmarks.some((bm) => bm.page === pageIndex);
      if (exists) return;

      try {
        const { bookmarks: bookmarkService } = await getServices();
        await bookmarkService.create({ bookId, page: pageIndex });
        loadBookmarks();
      } catch {
        // Silently ignore; bookmarks are non-critical.
      }
    },
    [bookId, bookmarks, loadBookmarks],
  );

  const removeBookmark = useCallback(
    async (bookmarkId: string) => {
      if (!bookId) return;

      try {
        const { bookmarks: bookmarkService } = await getServices();
        await bookmarkService.remove(bookmarkId);
        setBookmarks((current) => current.filter((bm) => bm.id !== bookmarkId));
      } catch {
        // Silently ignore; bookmarks are non-critical.
      }
    },
    [bookId],
  );

  const toggleBookmark = useCallback(
    async (pageIndex: number) => {
      const existing = bookmarks.find((bm) => bm.page === pageIndex);
      if (existing) {
        await removeBookmark(existing.id);
      } else {
        await addBookmark(pageIndex);
      }
    },
    [bookmarks, addBookmark, removeBookmark],
  );

  const jumpToBookmark = useCallback(
    (bookmarkId: string): number | null => {
      const bm = bookmarks.find((b) => b.id === bookmarkId);
      return bm?.page ?? null;
    },
    [bookmarks],
  );

  const refresh = useCallback(() => {
    loadBookmarks();
  }, [loadBookmarks]);

  return {
    bookmarks,
    isLoading,
    isCurrentPageBookmarked,
    currentPageBookmark,
    addBookmark,
    removeBookmark,
    toggleBookmark,
    jumpToBookmark,
    refresh,
  };
}

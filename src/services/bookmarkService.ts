/**
 * Bookmark service — orchestrates the bookmark repository (ARCHITECTURE.md §3).
 *
 * The UI never touches the repository directly; it calls this service.
 */
import { DomainError } from '@/core/errors';
import type { Bookmark, NewBookmark } from '@/core/entities/bookmark';

export type BookmarkSort = 'page';

export interface BookmarkServiceDeps {
  listForBook(bookId: string): Promise<Bookmark[]>;
  findById(id: string): Promise<Bookmark | null>;
  create(input: NewBookmark): Promise<Bookmark>;
  remove(id: string): Promise<boolean>;
  removeForBook(bookId: string): Promise<number>;
}

export interface BookmarkService {
  /** All bookmarks for a book, ordered by page index. */
  listByBook(bookId: string): Promise<Bookmark[]>;
  /** Creates a bookmark. Throws if the page is already bookmarked. */
  create(input: NewBookmark): Promise<Bookmark>;
  /** Removes a bookmark by id. Returns true if a row was deleted. */
  remove(id: string): Promise<void>;
  /** Removes all bookmarks for a book. Returns the number of rows deleted. */
  removeForBook(bookId: string): Promise<number>;
}

export function createBookmarkService(deps: BookmarkServiceDeps): BookmarkService {
  return {
    async listByBook(bookId: string): Promise<Bookmark[]> {
      return deps.listForBook(bookId);
    },

    async create(input: NewBookmark): Promise<Bookmark> {
      return deps.create(input);
    },

    async remove(id: string): Promise<void> {
      const removed = await deps.remove(id);
      if (!removed) {
        throw new DomainError('bookmark_not_found', `No bookmark with id ${id}`);
      }
    },

    async removeForBook(bookId: string): Promise<number> {
      return deps.removeForBook(bookId);
    },
  };
}

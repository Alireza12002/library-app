/**
 * Bookmark entity — ARCHITECTURE.md §4.
 * Uniqueness of (bookId, page) is enforced by the schema, not here.
 *
 * `page` is a 0-based index, consistent with Book.lastPage and the PDF engine.
 */
export interface Bookmark {
  id: string;
  bookId: string;
  /** 0-based page index. */
  page: number;
  /** Optional user-supplied heading. */
  title: string | null;
  /** Optional longer annotation. */
  note: string | null;
  createdAt: Date;
}

export interface NewBookmark {
  /** Optional: generated when omitted. */
  id?: string;
  bookId: string;
  page: number;
  title?: string | null;
  note?: string | null;
}

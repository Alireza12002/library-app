/**
 * Bookmark entity — ARCHITECTURE.md §4.
 * Uniqueness of (bookId, pageIndex) is enforced by the schema, not here.
 */
export interface Bookmark {
  id: string;
  bookId: string;
  pageIndex: number;
  label?: string;
  createdAt: Date;
}

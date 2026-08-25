/**
 * Reading progress value object — ARCHITECTURE.md §4.
 * One-to-one with a book; last page is 0-based everywhere in the domain.
 */
export interface ReadingProgress {
  bookId: string;
  lastPageIndex: number;
  lastReadAt: Date;
}

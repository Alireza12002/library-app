/**
 * Book entity — ARCHITECTURE.md §4.
 * Pure data. No framework imports allowed in core/ (enforced by ESLint).
 *
 * Page numbers are 0-based everywhere in the domain, matching the PDF engine's
 * `onPageChange` pageIndex. UI must add 1 when displaying.
 */

/** Lightweight projection used by list screens; never the full file path. */
export interface BookSummary {
  id: string;
  title: string;
  author: string | null;
  pageCount: number | null;
  lastPage: number;
  lastOpenedAt: Date | null;
}

export interface Book {
  /** UUID v4 */
  id: string;
  title: string;
  /** Unknown until metadata is parsed. */
  author: string | null;
  /** Absolute file:// URI of the private copy inside app storage. */
  fileUri: string;
  fileName: string;
  fileSize: number;
  /** Unknown until the reader reports it via onLoad. */
  pageCount: number | null;
  /** 0-based index of the last page the reader was on. */
  lastPage: number;
  /**
   * The book's persisted Reflow reading position, kept INDEPENDENT of `lastPage`
   * (which is the PDF mode's position). Null until the user has read in Reflow.
   *
   * `reflowBlockIndex` is an index into the book's reflow document blocks;
   * `reflowPageIndex` is the source PDF page that block came from, so the
   * position can be re-resolved semantically if the document is regenerated.
   */
  reflowBlockIndex: number | null;
  reflowPageIndex: number | null;
  createdAt: Date;
  updatedAt: Date;
  /** Null until the book is opened for the first time. */
  lastOpenedAt: Date | null;
}

/** Fields accepted when importing a book. The rest are derived or defaulted. */
export interface NewBook {
  /** Optional: generated when omitted. */
  id?: string;
  title: string;
  author?: string | null;
  fileUri: string;
  fileName: string;
  fileSize: number;
  pageCount?: number | null;
}

/** Editable metadata. Progress is updated separately. */
export interface BookMetadataPatch {
  title?: string;
  author?: string | null;
  pageCount?: number | null;
}

/** Ordering options for listing the library. */
export type BookSort = 'recent' | 'title' | 'added';

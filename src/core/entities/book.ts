/**
 * Book entity — ARCHITECTURE.md §4.
 * Pure data. No framework imports allowed in core/ (enforced by ESLint).
 */

/** Lightweight projection used by list screens; never the full file path. */
export interface BookSummary {
  id: string;
  title: string;
}

export interface Book {
  /** UUID v4 */
  id: string;
  title: string;
  fileName: string;
  /** Absolute file:// URI of the private copy inside app storage. */
  storedPath: string;
  fileSizeBytes: number;
  addedAt: Date;
  updatedAt: Date;
}

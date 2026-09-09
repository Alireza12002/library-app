/**
 * Reflow document entity and PDF ↔ reflow position mapping (ARCHITECTURE.md §4).
 *
 * Pure data and pure functions. No framework imports allowed in core/ (enforced
 * by ESLint), which is also what makes the mapping fully unit-testable.
 *
 * WHAT A "PAGE" MEANS HERE
 * -----------------------
 * A reflow document has no physical pages — text wraps to the device. So pages are
 * never invented: every block keeps the `pageIndex` of the PDF page its text was
 * extracted from, and `pageStarts` indexes that relation for O(1) lookup in both
 * directions. User-facing navigation stays in original PDF page numbers.
 *
 * Page numbers are 0-based, matching the rest of the domain.
 */

/**
 * One region of reflowed content, tied to the PDF page it came from.
 *
 * Defined here rather than in the feature layer because the position mapping below
 * is domain logic and core/ may not depend on features/. `features/reader/
 * textParser` re-exports this type, so existing call sites are unaffected.
 */
export interface TextBlock {
  /** Block type for rendering. */
  type: 'paragraph' | 'heading' | 'list_item' | 'code' | 'blockquote' | 'image';
  /** Clean text content. For an image block: alt/caption text (may be empty). */
  text: string;
  /** 0-based index of the PDF page this block's content came from. */
  pageIndex: number;
  /**
   * Set only on image blocks: where the extracted bitmap lives and its intrinsic
   * size, so the renderer can scale it to the reading column while keeping its
   * aspect ratio.
   */
  image?: {
    /** file:// URI of the cached bitmap. */
    uri: string;
    /** Intrinsic pixel width. */
    width: number;
    /** Intrinsic pixel height. */
    height: number;
  };
}

/**
 * Bumped whenever the extraction pipeline or block shape changes in a way that
 * makes previously generated documents wrong. A mismatch forces regeneration
 * rather than rendering stale output.
 */
export const REFLOW_FORMAT_VERSION = 1;

export interface ReflowDocument {
  bookId: string;
  /** Format version this document was generated with. */
  formatVersion: number;
  /**
   * Identity of the PDF this was generated from. A change means the underlying
   * file was replaced, so the document must be discarded.
   */
  sourceFingerprint: string;
  /** Page count of the source PDF. */
  pageCount: number;
  /** Every block of the whole book, in reading order. */
  blocks: TextBlock[];
  /**
   * `pageStarts[p]` = index of the first block originating from PDF page `p`, or
   * -1 when that page produced no blocks (blank, or image-only with no figures).
   *
   * Derived from the blocks, never stored independently, so it cannot drift.
   */
  pageStarts: number[];
  generatedAt: Date;
}

/** A reflow reading position, expressed structurally rather than in pixels. */
export interface ReflowPosition {
  /** Index into `blocks`. */
  blockIndex: number;
  /** PDF page the block at `blockIndex` came from. */
  pageIndex: number;
}

/**
 * Builds the page index from blocks.
 *
 * Blocks must already be in reading order (page order, then within-page order),
 * which is what the extraction pipeline produces.
 */
export function buildPageStarts(blocks: TextBlock[], pageCount: number): number[] {
  const starts = new Array<number>(Math.max(0, pageCount)).fill(-1);

  for (let i = 0; i < blocks.length; i++) {
    const page = blocks[i]!.pageIndex;
    if (page < 0 || page >= starts.length) continue;
    // First block wins: later blocks on the same page must not overwrite it.
    if (starts[page] === -1) starts[page] = i;
  }

  return starts;
}

/**
 * Fingerprint identifying the source PDF.
 *
 * File URI plus size plus page count: cheap to compute (no hashing of a
 * multi-megabyte file) and sufficient to catch the cases that matter — the book
 * being replaced by a different file, or re-imported at a different path. A
 * byte-identical file edited in place with the same length would not be caught;
 * that is a deliberate trade against reading the whole file on every open.
 */
export function reflowSourceFingerprint(input: {
  fileUri: string;
  fileSize: number;
  pageCount: number | null;
}): string {
  return `${input.fileUri}|${input.fileSize}|${input.pageCount ?? 0}`;
}

/**
 * True when a stored document can still be used for this book.
 *
 * Checks format version and source identity — the two ways a cached document goes
 * stale — so a mismatch triggers regeneration instead of showing text from the
 * wrong PDF.
 */
export function isReflowDocumentUsable(
  document: ReflowDocument,
  expected: { bookId: string; sourceFingerprint: string },
): boolean {
  return (
    document.formatVersion === REFLOW_FORMAT_VERSION &&
    document.bookId === expected.bookId &&
    document.sourceFingerprint === expected.sourceFingerprint
  );
}

/**
 * PDF page → reflow block index.
 *
 * When the requested page produced no blocks of its own (a blank page, or a plate
 * whose figure could not be decoded), the search moves FORWARD to the next page
 * that did, so the reader lands on the nearest following content rather than
 * jumping back to the start. If no later page has content, it falls back to the
 * nearest earlier one, and finally to 0.
 *
 * Returns -1 only for an empty document.
 */
export function pdfPageToBlockIndex(document: ReflowDocument, pageIndex: number): number {
  const { pageStarts, blocks } = document;
  if (blocks.length === 0) return -1;

  const clamped = Math.max(0, Math.min(Math.floor(pageIndex), pageStarts.length - 1));

  const direct = pageStarts[clamped];
  if (direct !== undefined && direct >= 0) return direct;

  for (let page = clamped + 1; page < pageStarts.length; page++) {
    const start = pageStarts[page]!;
    if (start >= 0) return start;
  }

  for (let page = clamped - 1; page >= 0; page--) {
    const start = pageStarts[page]!;
    if (start >= 0) return start;
  }

  return 0;
}

/**
 * Reflow block index → PDF page.
 *
 * Reads the page straight off the block, so the answer is whatever the extractor
 * actually recorded — no division, no estimation.
 */
export function blockIndexToPdfPage(document: ReflowDocument, blockIndex: number): number {
  const { blocks } = document;
  if (blocks.length === 0) return 0;

  const clamped = Math.max(0, Math.min(Math.floor(blockIndex), blocks.length - 1));
  return blocks[clamped]!.pageIndex;
}

/**
 * Restores a persisted Reflow position against the current document.
 *
 * The saved position is a pair (blockIndex, pageIndex). It is trusted only when
 * the block it names still exists AND still belongs to the page it was saved
 * with — otherwise the document was regenerated or the file replaced, and the
 * page anchor is re-resolved semantically instead of crashing or landing on the
 * wrong content. Returns null when nothing was saved.
 */
export function resolveSavedReflowPosition(
  document: ReflowDocument,
  saved: ReflowPosition | null | undefined,
): number | null {
  if (!saved) return null;

  const { blockIndex, pageIndex } = saved;
  if (!Number.isInteger(blockIndex) || blockIndex < 0) {
    // Corrupt block index with a usable page anchor: degrade to the page.
    if (Number.isInteger(pageIndex) && pageIndex >= 0) {
      return pdfPageToBlockIndex(document, pageIndex);
    }
    return null;
  }
  if (!Number.isInteger(pageIndex) || pageIndex < 0) return null;

  // The block no longer exists (the document shrank on regeneration): fall back
  // to the page anchor, which pdfPageToBlockIndex clamps into range.
  if (blockIndex >= document.blocks.length) {
    return pdfPageToBlockIndex(document, pageIndex);
  }

  // The block exists but the extractor now assigns it to a different page: the
  // block structure changed, so trust the page anchor rather than the index.
  if (document.blocks[blockIndex]!.pageIndex !== pageIndex) {
    return pdfPageToBlockIndex(document, pageIndex);
  }

  return blockIndex;
}

/** Blocks belonging to one PDF page, as a half-open [start, end) range. */
export function blockRangeForPdfPage(
  document: ReflowDocument,
  pageIndex: number,
): { start: number; end: number } | null {
  const { pageStarts, blocks } = document;
  if (pageIndex < 0 || pageIndex >= pageStarts.length) return null;

  const start = pageStarts[pageIndex];
  if (start === undefined || start < 0) return null;

  // The range ends where the next page with content begins.
  for (let page = pageIndex + 1; page < pageStarts.length; page++) {
    const next = pageStarts[page]!;
    if (next >= 0) return { start, end: next };
  }

  return { start, end: blocks.length };
}

/** Pages that produced at least one block. */
export function extractedPageCount(document: ReflowDocument): number {
  let count = 0;
  for (const start of document.pageStarts) {
    if (start >= 0) count++;
  }
  return count;
}

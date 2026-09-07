/**
 * Page-navigation input validation (ARCHITECTURE.md §3, L5).
 *
 * Pure logic, kept out of the component file so it is unit-testable: Node's
 * type-stripping test runner cannot load `.tsx`, and validation rules are worth
 * pinning independently of the sheet that renders them.
 *
 * PAGE NUMBERING: the UI is 1-based (what the user reads on the page); everything
 * above the PdfEngine port is 0-based. This module is the conversion point.
 */

export type PageInputResult =
  | { ok: true; pageIndex: number }
  | { ok: false; error: string };

/**
 * Validates a user-entered page number against the document.
 *
 * @param raw       Text as typed.
 * @param pageCount Total pages, or null before the renderer has reported it.
 * @returns The 0-based target index, or a user-facing error message.
 */
export function validatePageInput(raw: string, pageCount: number | null): PageInputResult {
  const trimmed = raw.trim();

  if (trimmed.length === 0) {
    return { ok: false, error: 'Enter a page number.' };
  }

  // Digits only: rejects '1.5', '-3', '1e5', non-ASCII digits and stray letters
  // in one rule, so no odd input reaches parseInt.
  if (!/^\d+$/.test(trimmed)) {
    return { ok: false, error: 'Page numbers are digits only.' };
  }

  const humanPage = Number.parseInt(trimmed, 10);

  if (!Number.isSafeInteger(humanPage) || humanPage < 1) {
    return { ok: false, error: 'Pages start at 1.' };
  }

  if (pageCount !== null && humanPage > pageCount) {
    return {
      ok: false,
      error: `This book has ${pageCount} page${pageCount === 1 ? '' : 's'}.`,
    };
  }

  // pageCount === null means the document has not reported its length yet;
  // accepting the entry keeps the feature usable on the first frames after open,
  // and useReader.setPage clamps once the real count arrives.
  return { ok: true, pageIndex: humanPage - 1 };
}

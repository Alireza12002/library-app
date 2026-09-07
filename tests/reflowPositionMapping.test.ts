/**
 * PDF ↔ reflow position mapping tests (ARCHITECTURE.md §9).
 *
 * The mapping is the load-bearing part of switching modes without losing your
 * place, and it is pure — so it is pinned directly rather than through the hook.
 *
 * The property under test is that mapping is driven by the `pageIndex` each block
 * actually carries. Nothing here may depend on block counts being uniform per page,
 * because real books are not uniform.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  blockIndexToPdfPage,
  blockRangeForPdfPage,
  buildPageStarts,
  extractedPageCount,
  isReflowDocumentUsable,
  pdfPageToBlockIndex,
  reflowSourceFingerprint,
  REFLOW_FORMAT_VERSION,
  type ReflowDocument,
  type TextBlock,
} from '@/core/entities/reflowDocument';

/** Builds a document whose blocks-per-page distribution is deliberately uneven. */
function makeDocument(blocksPerPage: number[]): ReflowDocument {
  const blocks: TextBlock[] = [];
  blocksPerPage.forEach((count, pageIndex) => {
    for (let i = 0; i < count; i++) {
      blocks.push({ type: 'paragraph', text: `p${pageIndex} block ${i}`, pageIndex });
    }
  });

  return {
    bookId: 'book-1',
    formatVersion: REFLOW_FORMAT_VERSION,
    sourceFingerprint: 'fp',
    pageCount: blocksPerPage.length,
    blocks,
    pageStarts: buildPageStarts(blocks, blocksPerPage.length),
    generatedAt: new Date(0),
  };
}

describe('buildPageStarts', () => {
  test('points each page at its first block', () => {
    // 2 blocks on page 0, 3 on page 1, 1 on page 2.
    const document = makeDocument([2, 3, 1]);
    assert.deepEqual(document.pageStarts, [0, 2, 5]);
  });

  test('marks pages with no blocks as -1', () => {
    const document = makeDocument([2, 0, 3]);
    assert.deepEqual(document.pageStarts, [0, -1, 2]);
  });

  test('handles a document whose first pages are empty', () => {
    const document = makeDocument([0, 0, 4]);
    assert.deepEqual(document.pageStarts, [-1, -1, 0]);
  });

  test('handles an empty document', () => {
    const document = makeDocument([0, 0]);
    assert.deepEqual(document.pageStarts, [-1, -1]);
    assert.equal(document.blocks.length, 0);
  });

  test('ignores blocks whose page is out of range', () => {
    const blocks: TextBlock[] = [
      { type: 'paragraph', text: 'ok', pageIndex: 0 },
      { type: 'paragraph', text: 'bogus', pageIndex: 99 },
    ];
    assert.deepEqual(buildPageStarts(blocks, 2), [0, -1]);
  });
});

describe('PDF page → reflow block', () => {
  test('maps a page to the first block of its own content', () => {
    const document = makeDocument([2, 3, 1, 4]);

    assert.equal(pdfPageToBlockIndex(document, 0), 0);
    assert.equal(pdfPageToBlockIndex(document, 1), 2);
    assert.equal(pdfPageToBlockIndex(document, 2), 5);
    assert.equal(pdfPageToBlockIndex(document, 3), 6);
  });

  test('does not assume a uniform blocks-per-page ratio', () => {
    // Page 0 is dense, page 1 is sparse. A "blocks × page / pageCount" estimate
    // would land in the wrong place; reading the recorded page cannot.
    const document = makeDocument([50, 1, 1]);

    assert.equal(pdfPageToBlockIndex(document, 1), 50);
    assert.equal(pdfPageToBlockIndex(document, 2), 51);
  });

  test('a mid-book page maps to a mid-book block, not the start', () => {
    // 60 pages, ~4 blocks each: the reported symptom was reflow opening at page 1.
    const document = makeDocument(new Array<number>(60).fill(4));

    const target = pdfPageToBlockIndex(document, 44); // PDF page 45, 0-based
    assert.equal(target, 176);
    assert.ok(target > 0, 'must not reset to the beginning');
    assert.equal(document.blocks[target]!.pageIndex, 44);
  });

  test('an empty page falls forward to the next page with content', () => {
    // A blank page or an image-only plate: land on the next real content rather
    // than jumping back to the start.
    const document = makeDocument([2, 0, 0, 3]);

    assert.equal(pdfPageToBlockIndex(document, 1), 2);
    assert.equal(pdfPageToBlockIndex(document, 2), 2);
    assert.equal(document.blocks[2]!.pageIndex, 3);
  });

  test('a trailing empty page falls back to the last page with content', () => {
    const document = makeDocument([2, 3, 0, 0]);
    assert.equal(pdfPageToBlockIndex(document, 3), 2);
  });

  test('clamps a page beyond the document', () => {
    const document = makeDocument([2, 2]);
    assert.equal(pdfPageToBlockIndex(document, 999), 2);
  });

  test('clamps a negative page', () => {
    const document = makeDocument([2, 2]);
    assert.equal(pdfPageToBlockIndex(document, -5), 0);
  });

  test('returns -1 for a document with no blocks', () => {
    assert.equal(pdfPageToBlockIndex(makeDocument([0, 0]), 0), -1);
  });
});

describe('reflow block → PDF page', () => {
  test('reads the page recorded on the block', () => {
    const document = makeDocument([2, 3, 1]);

    assert.equal(blockIndexToPdfPage(document, 0), 0);
    assert.equal(blockIndexToPdfPage(document, 1), 0);
    assert.equal(blockIndexToPdfPage(document, 2), 1);
    assert.equal(blockIndexToPdfPage(document, 4), 1);
    assert.equal(blockIndexToPdfPage(document, 5), 2);
  });

  test('a mid-document position maps to its own page, not page 0', () => {
    const document = makeDocument(new Array<number>(60).fill(4));
    assert.equal(blockIndexToPdfPage(document, 176), 44);
  });

  test('clamps an index past the end', () => {
    const document = makeDocument([2, 2]);
    assert.equal(blockIndexToPdfPage(document, 999), 1);
  });

  test('clamps a negative index', () => {
    const document = makeDocument([2, 2]);
    assert.equal(blockIndexToPdfPage(document, -3), 0);
  });
});

describe('round-tripping a position', () => {
  test('page → block → page is stable for every page with content', () => {
    const document = makeDocument([3, 1, 7, 2, 5, 1, 4]);

    for (let page = 0; page < document.pageCount; page++) {
      const block = pdfPageToBlockIndex(document, page);
      assert.equal(blockIndexToPdfPage(document, block), page, `page ${page} did not round-trip`);
    }
  });

  test('round-trips across an uneven distribution', () => {
    const document = makeDocument([1, 40, 1, 1, 25, 1]);

    for (let page = 0; page < document.pageCount; page++) {
      const block = pdfPageToBlockIndex(document, page);
      assert.equal(blockIndexToPdfPage(document, block), page);
    }
  });

  test('block → page → block returns to the START of that page', () => {
    // Not identity: mapping back gives the page's first block, which is the
    // intended behaviour for resuming a page.
    const document = makeDocument([5, 5, 5]);

    const page = blockIndexToPdfPage(document, 7); // middle of page 1
    assert.equal(page, 1);
    assert.equal(pdfPageToBlockIndex(document, page), 5);
  });
});

describe('block ranges per page', () => {
  test('reports the half-open range of a page', () => {
    const document = makeDocument([2, 3, 1]);

    assert.deepEqual(blockRangeForPdfPage(document, 0), { start: 0, end: 2 });
    assert.deepEqual(blockRangeForPdfPage(document, 1), { start: 2, end: 5 });
    assert.deepEqual(blockRangeForPdfPage(document, 2), { start: 5, end: 6 });
  });

  test('skips empty pages when computing the end', () => {
    const document = makeDocument([2, 0, 0, 3]);
    assert.deepEqual(blockRangeForPdfPage(document, 0), { start: 0, end: 2 });
  });

  test('returns null for a page with no content', () => {
    const document = makeDocument([2, 0, 3]);
    assert.equal(blockRangeForPdfPage(document, 1), null);
  });

  test('returns null for a page outside the document', () => {
    assert.equal(blockRangeForPdfPage(makeDocument([1]), 5), null);
  });

  test('every block belongs to exactly one page range', () => {
    const document = makeDocument([3, 2, 4, 1]);
    const covered = new Set<number>();

    for (let page = 0; page < document.pageCount; page++) {
      const range = blockRangeForPdfPage(document, page);
      if (!range) continue;
      for (let i = range.start; i < range.end; i++) {
        assert.ok(!covered.has(i), `block ${i} covered twice`);
        covered.add(i);
      }
    }

    assert.equal(covered.size, document.blocks.length);
  });
});

describe('staleness detection', () => {
  const base = { fileUri: 'file:///books/a.pdf', fileSize: 1024, pageCount: 10 };

  test('the same file yields the same fingerprint', () => {
    assert.equal(reflowSourceFingerprint(base), reflowSourceFingerprint({ ...base }));
  });

  test('a different file path changes the fingerprint', () => {
    assert.notEqual(
      reflowSourceFingerprint(base),
      reflowSourceFingerprint({ ...base, fileUri: 'file:///books/b.pdf' }),
    );
  });

  test('a different file size changes the fingerprint', () => {
    // The book being replaced at the same path is the case that must be caught.
    assert.notEqual(
      reflowSourceFingerprint(base),
      reflowSourceFingerprint({ ...base, fileSize: 2048 }),
    );
  });

  test('a different page count changes the fingerprint', () => {
    assert.notEqual(
      reflowSourceFingerprint(base),
      reflowSourceFingerprint({ ...base, pageCount: 11 }),
    );
  });

  test('accepts a document matching book and fingerprint', () => {
    const document = makeDocument([1, 1]);
    assert.equal(
      isReflowDocumentUsable(document, { bookId: 'book-1', sourceFingerprint: 'fp' }),
      true,
    );
  });

  test('rejects a document generated from a different file', () => {
    const document = makeDocument([1, 1]);
    assert.equal(
      isReflowDocumentUsable(document, { bookId: 'book-1', sourceFingerprint: 'other' }),
      false,
    );
  });

  test('rejects a document belonging to another book', () => {
    const document = makeDocument([1, 1]);
    assert.equal(
      isReflowDocumentUsable(document, { bookId: 'book-2', sourceFingerprint: 'fp' }),
      false,
    );
  });

  test('rejects a document from an older format version', () => {
    const document = { ...makeDocument([1, 1]), formatVersion: REFLOW_FORMAT_VERSION - 1 };
    assert.equal(
      isReflowDocumentUsable(document, { bookId: 'book-1', sourceFingerprint: 'fp' }),
      false,
    );
  });
});

describe('extractedPageCount', () => {
  test('counts only pages that produced blocks', () => {
    assert.equal(extractedPageCount(makeDocument([2, 0, 3, 0, 1])), 3);
  });

  test('is zero for an empty document', () => {
    assert.equal(extractedPageCount(makeDocument([0, 0])), 0);
  });
});

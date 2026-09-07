/**
 * PDF text extraction tests (ARCHITECTURE.md §9).
 *
 * Exercises the whole extraction pipeline against real PDF bytes built by
 * tests/helpers/pdfBuilder.ts — object syntax, FlateDecode content streams and
 * text operators — because that is the only way to know reflow will have anything
 * to render on device.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { createPdfKitTextExtractionEngine } from '@/pdf/adapters/text/pdfKitTextExtractionAdapter';
import { PdfDocument } from '@/pdf/adapters/text/pdfkit/document';
import { extractTextRuns } from '@/pdf/adapters/text/pdfkit/contentText';
import { layoutRunsToText, medianFontSize } from '@/pdf/adapters/text/pdfkit/layout';
import { buildPdf, prosePage, type PageSpec } from './helpers/pdfBuilder';

/** Extracts page text directly, bypassing the engine's file reader. */
function textOfPage(bytes: Uint8Array, pageIndex: number): string {
  const document = PdfDocument.parse(bytes);
  const page = document.getPageContent(pageIndex);
  assert.ok(page, `page ${pageIndex} should exist`);
  return layoutRunsToText(extractTextRuns(page.content, page.fonts));
}

/** Builds an engine whose reader serves in-memory bytes. */
function engineFor(bytes: Uint8Array) {
  return createPdfKitTextExtractionEngine({
    readBytes: async () => bytes,
  });
}

const SOURCE = { kind: 'file', uri: 'file:///test/book.pdf' } as const;

describe('PdfDocument structure', () => {
  test('reports the page count from the pages tree', () => {
    const pdf = buildPdf([
      prosePage(['Page one.']),
      prosePage(['Page two.']),
      prosePage(['Page three.']),
    ]);

    assert.equal(PdfDocument.parse(pdf).pageCount, 3);
  });

  test('rejects a file with no PDF header', () => {
    assert.throws(() => PdfDocument.parse(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9])));
  });

  test('rejects an encrypted document rather than emitting garbage', () => {
    const pdf = buildPdf([prosePage(['Secret.'])], { encrypted: true });
    assert.throws(() => PdfDocument.parse(pdf), /encrypted/i);
  });

  test('reads uncompressed content streams', () => {
    const pdf = buildPdf([prosePage(['Uncompressed stream text.'])], { compress: false });
    assert.match(textOfPage(pdf, 0), /Uncompressed stream text\./);
  });

  test('reads FlateDecode content streams', () => {
    const pdf = buildPdf([prosePage(['Compressed stream text.'])], { compress: true });
    assert.match(textOfPage(pdf, 0), /Compressed stream text\./);
  });
});

describe('text extraction — content and structure', () => {
  test('extracts a single line verbatim', () => {
    const pdf = buildPdf([prosePage(['The quick brown fox jumps over the lazy dog.'])]);
    assert.equal(textOfPage(pdf, 0).trim(), 'The quick brown fox jumps over the lazy dog.');
  });

  test('preserves line order top to bottom', () => {
    // PDF Y grows upward, so the writer emits descending Y for later lines. If the
    // layout pass sorted the wrong way, the page would read bottom-up.
    const pdf = buildPdf([prosePage(['First line.', 'Second line.', 'Third line.'])]);
    const lines = textOfPage(pdf, 0)
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    assert.deepEqual(lines, ['First line.', 'Second line.', 'Third line.']);
  });

  test('groups runs on the same baseline into one line', () => {
    // Three separate Tj operators at the same Y must read as one line.
    const page: PageSpec = {
      lines: [
        { text: 'Alpha', x: 72, y: 700 },
        { text: 'Beta', x: 130, y: 700 },
        { text: 'Gamma', x: 190, y: 700 },
      ],
    };
    const text = textOfPage(buildPdf([page]), 0);

    assert.equal(text.split('\n').filter((l) => l.trim()).length, 1);
    assert.match(text, /Alpha/);
    assert.match(text, /Beta/);
    assert.match(text, /Gamma/);
  });

  test('inserts a space between runs separated by a horizontal gap', () => {
    const page: PageSpec = {
      lines: [
        { text: 'Hello', x: 72, y: 700 },
        // Far enough right that a word space is implied, with no space character
        // in either string — the case PDF writers produce constantly.
        { text: 'world', x: 140, y: 700 },
      ],
    };
    assert.match(textOfPage(buildPdf([page]), 0), /Hello world/);
  });

  test('marks a paragraph break when the vertical gap is large', () => {
    const page: PageSpec = {
      lines: [
        { text: 'End of the first paragraph.', x: 72, y: 700 },
        // ~3× leading below: a paragraph boundary, not a wrapped line.
        { text: 'Start of the second paragraph.', x: 72, y: 650 },
      ],
    };
    const text = textOfPage(buildPdf([page]), 0);

    assert.match(
      text,
      /first paragraph\.\n\nStart of the second/,
      `expected a blank line between paragraphs, got:\n${JSON.stringify(text)}`,
    );
  });

  test('does not break a paragraph across normally-wrapped lines', () => {
    const pdf = buildPdf([
      prosePage(
        ['This sentence continues', 'across a wrapped line', 'without a paragraph break.'],
        { leading: 14 },
      ),
    ]);
    const text = textOfPage(pdf, 0);

    assert.ok(!text.includes('\n\n'), `unexpected paragraph break in:\n${JSON.stringify(text)}`);
  });

  test('extracts every page of a multi-page document independently', () => {
    const pdf = buildPdf([
      prosePage(['Chapter one begins here.']),
      prosePage(['Chapter two begins here.']),
      prosePage(['Chapter three begins here.']),
    ]);

    assert.match(textOfPage(pdf, 0), /Chapter one/);
    assert.match(textOfPage(pdf, 1), /Chapter two/);
    assert.match(textOfPage(pdf, 2), /Chapter three/);
  });

  test('handles escaped parentheses and backslashes in strings', () => {
    const pdf = buildPdf([prosePage(['A note (with parens) and a backslash \\ inside.'])]);
    assert.match(textOfPage(pdf, 0), /\(with parens\)/);
  });

  test('returns empty text for a page with no text operators', () => {
    const pdf = buildPdf([{ lines: [] }]);
    assert.equal(textOfPage(pdf, 0).trim(), '');
  });
});

describe('font-size analysis', () => {
  test('medianFontSize ignores heading outliers', () => {
    const page: PageSpec = {
      lines: [
        { text: 'A Very Large Heading', x: 72, y: 720, size: 28 },
        { text: 'Body text line one.', x: 72, y: 690, size: 11 },
        { text: 'Body text line two.', x: 72, y: 676, size: 11 },
        { text: 'Body text line three.', x: 72, y: 662, size: 11 },
      ],
    };

    const document = PdfDocument.parse(buildPdf([page]));
    const content = document.getPageContent(0);
    assert.ok(content);
    const runs = extractTextRuns(content.content, content.fonts);

    // Median must land on body size, not be dragged up by the 28pt heading.
    assert.equal(medianFontSize(runs), 11);
  });

  test('run font sizes reflect the Tf operand', () => {
    const page: PageSpec = {
      lines: [
        { text: 'Heading', x: 72, y: 720, size: 24 },
        { text: 'Body', x: 72, y: 700, size: 12 },
      ],
    };
    const document = PdfDocument.parse(buildPdf([page]));
    const content = document.getPageContent(0);
    assert.ok(content);
    const runs = extractTextRuns(content.content, content.fonts);

    const heading = runs.find((run) => run.text.includes('Heading'));
    const body = runs.find((run) => run.text.includes('Body'));
    assert.ok(heading && body);
    assert.equal(Math.round(heading.fontSize), 24);
    assert.equal(Math.round(body.fontSize), 12);
  });
});

describe('TextExtractionEngine port behaviour', () => {
  test('reports capabilities as extraction-capable', () => {
    const engine = engineFor(buildPdf([prosePage(['x'])]));
    assert.equal(engine.capabilities.extractText, true);
  });

  test('getPageCount matches the document', async () => {
    const pdf = buildPdf([prosePage(['one']), prosePage(['two'])]);
    assert.equal(await engineFor(pdf).getPageCount(SOURCE), 2);
  });

  test('extractPageText returns that page only', async () => {
    const pdf = buildPdf([prosePage(['Alpha page.']), prosePage(['Beta page.'])]);
    const engine = engineFor(pdf);

    assert.match(await engine.extractPageText(SOURCE, 0), /Alpha page/);
    assert.match(await engine.extractPageText(SOURCE, 1), /Beta page/);
  });

  test('extractPageRange returns a half-open range in order', async () => {
    const pdf = buildPdf([
      prosePage(['P0']),
      prosePage(['P1']),
      prosePage(['P2']),
      prosePage(['P3']),
    ]);

    const range = await engineFor(pdf).extractPageRange(SOURCE, 1, 3);

    assert.equal(range.startIndex, 1);
    assert.equal(range.endIndex, 3);
    assert.deepEqual(range.pages.map((page) => page.pageIndex), [1, 2]);
    assert.match(range.pages[0]!.text, /P1/);
    assert.match(range.pages[1]!.text, /P2/);
  });

  test('clamps a range that runs past the last page', async () => {
    const pdf = buildPdf([prosePage(['only page'])]);
    const range = await engineFor(pdf).extractPageRange(SOURCE, 0, 50);

    assert.equal(range.endIndex, 1);
    assert.equal(range.pages.length, 1);
  });

  test('parses the file once no matter how many pages are read', async () => {
    const pdf = buildPdf([prosePage(['a']), prosePage(['b']), prosePage(['c'])]);
    let reads = 0;

    const engine = createPdfKitTextExtractionEngine({
      readBytes: async () => {
        reads++;
        return pdf;
      },
    });

    await engine.getPageCount(SOURCE);
    await engine.extractPageText(SOURCE, 0);
    await engine.extractPageText(SOURCE, 1);
    await engine.extractPageRange(SOURCE, 0, 3);

    assert.equal(reads, 1, 'document bytes must be read and parsed once per URI');
  });

  test('concurrent first reads share a single parse', async () => {
    const pdf = buildPdf([prosePage(['a']), prosePage(['b'])]);
    let reads = 0;

    const engine = createPdfKitTextExtractionEngine({
      readBytes: async () => {
        reads++;
        await new Promise((resolve) => setTimeout(resolve, 5));
        return pdf;
      },
    });

    await Promise.all([
      engine.getPageCount(SOURCE),
      engine.extractPageText(SOURCE, 0),
      engine.extractPageText(SOURCE, 1),
    ]);

    assert.equal(reads, 1, 'concurrent requests must not each parse the document');
  });

  test('surfaces a corrupt file as invalid_document', async () => {
    const engine = createPdfKitTextExtractionEngine({
      readBytes: async () => new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]),
    });

    await assert.rejects(
      () => engine.getPageCount(SOURCE),
      (error: unknown) =>
        typeof error === 'object' && error !== null && 'code' in error && error.code === 'invalid_document',
    );
  });

  test('surfaces an encrypted file as password_required', async () => {
    const engine = engineFor(buildPdf([prosePage(['secret'])], { encrypted: true }));

    await assert.rejects(
      () => engine.getPageCount(SOURCE),
      (error: unknown) =>
        typeof error === 'object' && error !== null && 'code' in error && error.code === 'password_required',
    );
  });

  test('rejects a page index outside the document', async () => {
    const engine = engineFor(buildPdf([prosePage(['only'])]));
    await assert.rejects(() => engine.extractPageText(SOURCE, 7));
  });
});

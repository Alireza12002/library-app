/**
 * End-to-end reflow pipeline tests (ARCHITECTURE.md §9).
 *
 * Real PDF bytes → extraction → parser → block model. This is the contract the
 * reflow renderer depends on, and it is the difference between reflow that shows
 * reconstructed content and reflow that merely restyles a PDF page: if the block
 * model is empty or mis-shaped, there is nothing to reflow.
 *
 * The renderer itself (wrapping to device width) is a React Native layout concern
 * and cannot be asserted without a device; what is verified here is that the
 * document model handed to it is correct, ordered and page-attributed.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { createPdfKitTextExtractionEngine } from '@/pdf/adapters/text/pdfKitTextExtractionAdapter';
import { parseExtractedText, flattenParsedPages } from '@/features/reader/textParser';
import { buildPdf, prosePage, type PageSpec } from './helpers/pdfBuilder';

const SOURCE = { kind: 'file', uri: 'file:///test/reflow.pdf' } as const;

/** Runs the full pipeline over a built PDF and returns flattened blocks. */
async function pipeline(pages: PageSpec[]) {
  const pdf = buildPdf(pages);
  const engine = createPdfKitTextExtractionEngine({ readBytes: async () => pdf });

  const count = await engine.getPageCount(SOURCE);
  const range = await engine.extractPageRange(SOURCE, 0, count);
  const parsed = parseExtractedText(
    range.pages.map((page) => ({ pageIndex: page.pageIndex, text: page.text })),
  );

  return { blocks: flattenParsedPages(parsed), parsed, count };
}

describe('reflow pipeline — document model', () => {
  test('produces readable blocks from a real PDF', async () => {
    const { blocks } = await pipeline([
      prosePage([
        'Reflow mode reconstructs the document as a',
        'continuous stream of text blocks so that the',
        'reader can wrap lines to the screen width.',
      ]),
    ]);

    assert.ok(blocks.length > 0, 'pipeline produced no blocks — reflow would be empty');
    const text = blocks.map((block) => block.text).join(' ');
    assert.match(text, /Reflow mode reconstructs/);
    assert.match(text, /wrap lines to the screen width/);
  });

  test('joins wrapped lines into one paragraph block', async () => {
    // The whole point of reflow: the PDF's hard line breaks must NOT survive as
    // block boundaries, or the text could not re-wrap to a narrow screen.
    const { blocks } = await pipeline([
      prosePage([
        'This sentence begins on one line and',
        'continues onto a second line before it',
        'finally reaches its end.',
      ]),
    ]);

    const paragraphs = blocks.filter((block) => block.type === 'paragraph');
    assert.equal(paragraphs.length, 1, `expected one joined paragraph, got ${paragraphs.length}`);
    assert.match(paragraphs[0]!.text, /begins on one line and continues onto a second line/);
    assert.ok(
      !paragraphs[0]!.text.includes('\n'),
      'a reflow block must not carry the original line breaks',
    );
  });

  test('keeps separate paragraphs separate', async () => {
    const page: PageSpec = {
      lines: [
        { text: 'First paragraph ends here.', x: 72, y: 700 },
        // Large vertical gap ⇒ paragraph boundary.
        { text: 'Second paragraph starts here.', x: 72, y: 650 },
      ],
    };

    const { blocks } = await pipeline([page]);
    const paragraphs = blocks.filter((block) => block.type === 'paragraph');

    assert.equal(paragraphs.length, 2);
    assert.match(paragraphs[0]!.text, /First paragraph/);
    assert.match(paragraphs[1]!.text, /Second paragraph/);
  });

  test('identifies a heading as its own block type', async () => {
    const page: PageSpec = {
      lines: [
        { text: 'Chapter One', x: 72, y: 720, size: 20 },
        { text: 'The body text of the chapter begins after', x: 72, y: 680 },
        { text: 'the heading and continues normally.', x: 72, y: 666 },
      ],
    };

    const { blocks } = await pipeline([page]);
    const heading = blocks.find((block) => block.type === 'heading');

    assert.ok(heading, `no heading detected in: ${JSON.stringify(blocks.map((b) => b.type))}`);
    assert.equal(heading.text, 'Chapter One');
  });

  test('identifies list items', async () => {
    const page: PageSpec = {
      lines: [
        { text: 'Shopping list for the week.', x: 72, y: 700 },
        { text: '- first item', x: 72, y: 660 },
        { text: '- second item', x: 72, y: 640 },
        { text: '- third item', x: 72, y: 620 },
      ],
    };

    const { blocks } = await pipeline([page]);
    const items = blocks.filter((block) => block.type === 'list_item');

    assert.equal(items.length, 3, `expected 3 list items, got ${items.length}`);
  });

  test('every block carries the page it came from', async () => {
    // Page attribution drives incremental extraction and reading-position
    // mapping; without it the reader cannot tell what to load next.
    const { blocks } = await pipeline([
      prosePage(['Content from the first page.']),
      prosePage(['Content from the second page.']),
      prosePage(['Content from the third page.']),
    ]);

    const pagesSeen = new Set(blocks.map((block) => block.pageIndex));
    assert.deepEqual([...pagesSeen].sort((a, b) => a - b), [0, 1, 2]);

    const first = blocks.find((block) => block.text.includes('first page'));
    const third = blocks.find((block) => block.text.includes('third page'));
    assert.equal(first?.pageIndex, 0);
    assert.equal(third?.pageIndex, 2);
  });

  test('blocks arrive in reading order across pages', async () => {
    const { blocks } = await pipeline([
      prosePage(['Alpha comes first.']),
      prosePage(['Bravo comes second.']),
      prosePage(['Charlie comes third.']),
    ]);

    const joined = blocks.map((block) => block.text).join(' | ');
    const alpha = joined.indexOf('Alpha');
    const bravo = joined.indexOf('Bravo');
    const charlie = joined.indexOf('Charlie');

    assert.ok(alpha >= 0 && bravo >= 0 && charlie >= 0, `missing content in: ${joined}`);
    assert.ok(alpha < bravo && bravo < charlie, `wrong reading order: ${joined}`);
  });

  test('drops a repeated running header across many pages', async () => {
    // Running heads are noise in a continuous reading view.
    const pages = Array.from({ length: 5 }, (_, i) => ({
      lines: [
        { text: 'A History of Typography', x: 72, y: 740, size: 9 },
        { text: `Body content unique to page ${i + 1} goes here.`, x: 72, y: 690 },
      ],
    }));

    const { blocks } = await pipeline(pages);
    const headerBlocks = blocks.filter((block) => block.text === 'A History of Typography');

    assert.ok(
      headerBlocks.length <= 1,
      `running header survived on ${headerBlocks.length} pages`,
    );
    // Real content must remain untouched.
    for (let i = 1; i <= 5; i++) {
      assert.ok(
        blocks.some((block) => block.text.includes(`unique to page ${i}`)),
        `lost body content of page ${i}`,
      );
    }
  });

  test('a page with no text contributes no blocks', async () => {
    const { blocks } = await pipeline([
      prosePage(['Real content here.']),
      { lines: [] },
      prosePage(['More real content.']),
    ]);

    assert.ok(blocks.length > 0);
    assert.ok(blocks.every((block) => block.text.trim().length > 0));
  });

  test('an image-only document yields zero blocks (textless case)', async () => {
    // What the reader shows as "No extractable text" rather than a blank page.
    const { blocks } = await pipeline([{ lines: [] }, { lines: [] }]);
    assert.equal(blocks.length, 0);
  });

  test('block text is plain — no positioning survives into the model', async () => {
    // Any leftover coordinate or fixed-width artifact would defeat reflow.
    const { blocks } = await pipeline([
      prosePage(['Text with    irregular    inner spacing preserved by the PDF.']),
    ]);

    const block = blocks.find((b) => b.text.includes('irregular'));
    assert.ok(block);
    assert.ok(!/ {2,}/.test(block.text), `runs of spaces survived: ${JSON.stringify(block.text)}`);
  });

  test('handles a long document without losing pages', async () => {
    const pageCount = 30;
    const pages = Array.from({ length: pageCount }, (_, i) =>
      prosePage([`Page ${i + 1} sentence one.`, `Page ${i + 1} sentence two.`]),
    );

    const { blocks, count } = await pipeline(pages);

    assert.equal(count, pageCount);
    const pagesRepresented = new Set(blocks.map((block) => block.pageIndex));
    assert.equal(
      pagesRepresented.size,
      pageCount,
      `only ${pagesRepresented.size} of ${pageCount} pages produced blocks`,
    );
  });
});

describe('reflow pipeline — incremental extraction', () => {
  test('extracting a window does not require the whole document', async () => {
    const pages = Array.from({ length: 40 }, (_, i) => prosePage([`Page ${i + 1} content.`]));
    const pdf = buildPdf(pages);
    const engine = createPdfKitTextExtractionEngine({ readBytes: async () => pdf });

    const window = await engine.extractPageRange(SOURCE, 10, 14);

    assert.equal(window.pages.length, 4);
    assert.deepEqual(window.pages.map((page) => page.pageIndex), [10, 11, 12, 13]);
    assert.match(window.pages[0]!.text, /Page 11 content/);
  });

  test('re-reading the same pages is served from memory', async () => {
    const pages = Array.from({ length: 10 }, (_, i) => prosePage([`Page ${i + 1}.`]));
    const pdf = buildPdf(pages);
    let reads = 0;
    const engine = createPdfKitTextExtractionEngine({
      readBytes: async () => {
        reads++;
        return pdf;
      },
    });

    // Simulates scrolling forward then back.
    await engine.extractPageRange(SOURCE, 0, 4);
    await engine.extractPageRange(SOURCE, 4, 8);
    await engine.extractPageRange(SOURCE, 0, 4);

    assert.equal(reads, 1, 'scrolling must not re-read or re-parse the file');
  });
});

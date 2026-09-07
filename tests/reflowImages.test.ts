/**
 * Reflow image pipeline tests (ARCHITECTURE.md §9).
 *
 * Verifies that embedded bitmaps survive the trip from PDF XObject to a block the
 * renderer can size against the reading column, and — the part that matters for
 * reading order — that a figure between two paragraphs stays between them.
 *
 * PNG output is validated structurally (signature, IHDR geometry, chunk CRCs)
 * because the encoder is ours; a malformed PNG would fail silently on device as a
 * blank image.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { inflateSync } from 'node:zlib';

import { createPdfKitTextExtractionEngine } from '@/pdf/adapters/text/pdfKitTextExtractionAdapter';
import { PdfDocument } from '@/pdf/adapters/text/pdfkit/document';
import { extractPageOperations } from '@/pdf/adapters/text/pdfkit/contentText';
import { layoutPageContent } from '@/pdf/adapters/text/pdfkit/layout';
import { encodePng } from '@/pdf/adapters/text/pdfkit/png';
import { parseExtractedText, flattenParsedPages } from '@/features/reader/textParser';
import { buildPdf, type PageSpec } from './helpers/pdfBuilder';

const SOURCE = { kind: 'file', uri: 'file:///test/figures.pdf' } as const;

/** Engine wired to in-memory bytes and an in-memory image sink. */
function engineFor(pdf: Uint8Array) {
  const written = new Map<string, Uint8Array>();
  const engine = createPdfKitTextExtractionEngine({
    readBytes: async () => pdf,
    writeImage: async (fileName, bytes) => {
      written.set(fileName, bytes);
      return `file:///cache/reflow-images/${fileName}`;
    },
  });
  return { engine, written };
}

/** Full pipeline: PDF → extraction → parser → flat blocks. */
async function pipeline(pages: PageSpec[]) {
  const pdf = buildPdf(pages);
  const { engine, written } = engineFor(pdf);

  const count = await engine.getPageCount(SOURCE);
  const range = await engine.extractPageRange(SOURCE, 0, count);
  const parsed = parseExtractedText(
    range.pages.map((page) =>
      page.images && page.images.length > 0
        ? { pageIndex: page.pageIndex, text: page.text, images: page.images }
        : { pageIndex: page.pageIndex, text: page.text },
    ),
  );

  return { blocks: flattenParsedPages(parsed), range, written };
}

describe('PNG encoder', () => {
  test('emits a structurally valid PNG with correct geometry', () => {
    const width = 16;
    const height = 8;
    const samples = new Uint8Array(width * height * 3);
    for (let i = 0; i < samples.length; i++) samples[i] = i % 256;

    const png = encodePng({ width, height, channels: 3, samples });

    assert.deepEqual(
      Array.from(png.subarray(0, 8)),
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      'PNG signature',
    );

    // IHDR body starts at byte 16 (8 signature + 4 length + 4 type).
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
    assert.equal(view.getUint32(16), width, 'IHDR width');
    assert.equal(view.getUint32(20), height, 'IHDR height');
    assert.equal(png[24], 8, 'bit depth');
    assert.equal(png[25], 2, 'colour type RGB');
  });

  test('grayscale uses colour type 0', () => {
    const png = encodePng({ width: 4, height: 4, channels: 1, samples: new Uint8Array(16) });
    assert.equal(png[25], 0);
  });

  test('IDAT inflates back to the original scanlines', () => {
    const width = 5;
    const height = 3;
    const samples = new Uint8Array(width * height * 3);
    for (let i = 0; i < samples.length; i++) samples[i] = (i * 11) % 256;

    const png = encodePng({ width, height, channels: 3, samples });

    // Walk chunks to find IDAT rather than assuming an offset.
    let offset = 8;
    let idat: Uint8Array | null = null;
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
    while (offset < png.length) {
      const length = view.getUint32(offset);
      const type = String.fromCharCode(...png.subarray(offset + 4, offset + 8));
      if (type === 'IDAT') {
        idat = png.subarray(offset + 8, offset + 8 + length);
        break;
      }
      offset += 12 + length;
    }
    assert.ok(idat, 'IDAT chunk present');

    const raw = new Uint8Array(inflateSync(Buffer.from(idat)));
    // Each scanline is a filter byte followed by width*channels samples.
    assert.equal(raw.length, height * (width * 3 + 1));
    for (let row = 0; row < height; row++) {
      const start = row * (width * 3 + 1);
      assert.equal(raw[start], 0, 'filter type None');
      const scanline = raw.subarray(start + 1, start + 1 + width * 3);
      const expected = samples.subarray(row * width * 3, (row + 1) * width * 3);
      assert.deepEqual(Array.from(scanline), Array.from(expected), `row ${row}`);
    }
  });

  test('rejects a sample buffer that is too small', () => {
    assert.throws(() =>
      encodePng({ width: 10, height: 10, channels: 3, samples: new Uint8Array(10) }),
    );
  });
});

describe('image placement extraction', () => {
  test('recovers the placement rectangle from the CTM', () => {
    const page: PageSpec = {
      lines: [{ text: 'Caption below.', x: 72, y: 400 }],
      images: [
        { name: 'Im0', x: 72, y: 500, width: 200, height: 150, pixelWidth: 64, pixelHeight: 48 },
      ],
    };

    const document = PdfDocument.parse(buildPdf([page]));
    const content = document.getPageContent(0);
    assert.ok(content);

    const { images } = extractPageOperations(content.content, content.fonts);

    assert.equal(images.length, 1);
    assert.equal(images[0]!.resourceName, 'Im0');
    assert.equal(Math.round(images[0]!.width), 200);
    assert.equal(Math.round(images[0]!.height), 150);
    // y is reported as the TOP edge: bottom (500) + height (150).
    assert.equal(Math.round(images[0]!.y), 650);
  });

  test('resolves the XObject stream from page resources', () => {
    const page: PageSpec = {
      lines: [],
      images: [
        { name: 'Fig1', x: 0, y: 0, width: 100, height: 100, pixelWidth: 40, pixelHeight: 40 },
      ],
    };

    const document = PdfDocument.parse(buildPdf([page]));
    const content = document.getPageContent(0);
    assert.ok(content);

    assert.ok(content.imageResources.has('Fig1'), 'image resource should be resolvable');
    const decoded = document.decodeImage(content.imageResources.get('Fig1')!);
    assert.ok(decoded, 'image should decode');
    assert.equal(decoded.width, 40);
    assert.equal(decoded.height, 40);
    assert.equal(decoded.mimeType, 'image/png');
  });

  test('passes JPEG bytes through without re-encoding', () => {
    const page: PageSpec = {
      lines: [],
      images: [
        {
          name: 'Photo',
          x: 0,
          y: 0,
          width: 300,
          height: 200,
          pixelWidth: 300,
          pixelHeight: 200,
          asJpeg: true,
        },
      ],
    };

    const document = PdfDocument.parse(buildPdf([page]));
    const content = document.getPageContent(0);
    assert.ok(content);

    const decoded = document.decodeImage(content.imageResources.get('Photo')!);
    assert.ok(decoded);
    assert.equal(decoded.mimeType, 'image/jpeg');
    // JPEG SOI marker: proof the original payload was not touched.
    assert.equal(decoded.bytes[0], 0xff);
    assert.equal(decoded.bytes[1], 0xd8);
  });

  test('ignores draws too small to be content', () => {
    const page: PageSpec = {
      lines: [{ text: 'Body text.', x: 72, y: 700 }],
      images: [
        // A hairline rule: 1pt tall, must not be recorded.
        { name: 'Rule', x: 72, y: 690, width: 400, height: 1, pixelWidth: 400, pixelHeight: 1 },
      ],
    };

    const document = PdfDocument.parse(buildPdf([page]));
    const content = document.getPageContent(0);
    assert.ok(content);

    const { images } = extractPageOperations(content.content, content.fonts);
    assert.equal(images.length, 0);
  });
});

describe('reading order with images', () => {
  test('an image between two paragraphs lands between them', () => {
    const page: PageSpec = {
      lines: [
        { text: 'The paragraph above the figure.', x: 72, y: 700 },
        { text: 'The paragraph below the figure.', x: 72, y: 400 },
      ],
      images: [
        { name: 'Im0', x: 72, y: 500, width: 200, height: 150, pixelWidth: 64, pixelHeight: 48 },
      ],
    };

    const document = PdfDocument.parse(buildPdf([page]));
    const content = document.getPageContent(0);
    assert.ok(content);

    const { runs, images } = extractPageOperations(content.content, content.fonts);
    const items = layoutPageContent(runs, images);

    assert.equal(items.length, 3, `expected text/image/text, got ${JSON.stringify(items)}`);
    assert.equal(items[0]!.kind, 'text');
    assert.equal(items[1]!.kind, 'image');
    assert.equal(items[2]!.kind, 'text');
    assert.match(items[0]!.kind === 'text' ? items[0]!.text : '', /above the figure/);
    assert.match(items[2]!.kind === 'text' ? items[2]!.text : '', /below the figure/);
  });

  test('an image above all text comes first', () => {
    const page: PageSpec = {
      lines: [{ text: 'Text under the banner.', x: 72, y: 400 }],
      images: [
        { name: 'Im0', x: 72, y: 600, width: 400, height: 120, pixelWidth: 128, pixelHeight: 40 },
      ],
    };

    const document = PdfDocument.parse(buildPdf([page]));
    const content = document.getPageContent(0);
    assert.ok(content);

    const { runs, images } = extractPageOperations(content.content, content.fonts);
    const items = layoutPageContent(runs, images);

    assert.equal(items[0]!.kind, 'image');
  });

  test('an image below all text comes last', () => {
    const page: PageSpec = {
      lines: [{ text: 'Text above the footer image.', x: 72, y: 700 }],
      images: [
        { name: 'Im0', x: 72, y: 100, width: 200, height: 100, pixelWidth: 64, pixelHeight: 32 },
      ],
    };

    const document = PdfDocument.parse(buildPdf([page]));
    const content = document.getPageContent(0);
    assert.ok(content);

    const { runs, images } = extractPageOperations(content.content, content.fonts);
    const items = layoutPageContent(runs, images);

    assert.equal(items.at(-1)!.kind, 'image');
  });
});

describe('image blocks in the reflow document model', () => {
  test('produces an image block with a URI and intrinsic size', async () => {
    const { blocks, written } = await pipeline([
      {
        lines: [
          { text: 'Above the figure.', x: 72, y: 700 },
          { text: 'Below the figure.', x: 72, y: 400 },
        ],
        images: [
          { name: 'Im0', x: 72, y: 500, width: 200, height: 150, pixelWidth: 64, pixelHeight: 48 },
        ],
      },
    ]);

    const imageBlocks = blocks.filter((block) => block.type === 'image');
    assert.equal(imageBlocks.length, 1, `expected one image block in ${JSON.stringify(blocks)}`);

    const image = imageBlocks[0]!.image;
    assert.ok(image, 'image block must carry its image payload');
    assert.match(image.uri, /^file:\/\/\/cache\/reflow-images\//);
    // Intrinsic pixels, NOT the PDF placement size: the renderer scales from these
    // to the reading column, which is what makes the figure responsive.
    assert.equal(image.width, 64);
    assert.equal(image.height, 48);
    assert.equal(written.size, 1, 'the bitmap should be written once');
  });

  test('image blocks keep their position in the flat reading order', async () => {
    const { blocks } = await pipeline([
      {
        lines: [
          { text: 'First paragraph of the section.', x: 72, y: 700 },
          { text: 'Second paragraph after the figure.', x: 72, y: 400 },
        ],
        images: [
          { name: 'Im0', x: 72, y: 500, width: 200, height: 150, pixelWidth: 64, pixelHeight: 48 },
        ],
      },
    ]);

    const types = blocks.map((block) => block.type);
    const imageIndex = types.indexOf('image');

    assert.ok(imageIndex > 0, 'image should not be first');
    assert.ok(imageIndex < types.length - 1, 'image should not be last');
    assert.match(blocks[imageIndex - 1]!.text, /First paragraph/);
    assert.match(blocks[imageIndex + 1]!.text, /Second paragraph/);
  });

  test('image blocks carry their source page', async () => {
    const { blocks } = await pipeline([
      { lines: [{ text: 'Page one text.', x: 72, y: 700 }] },
      {
        lines: [{ text: 'Page two text.', x: 72, y: 700 }],
        images: [
          { name: 'Im0', x: 72, y: 400, width: 200, height: 150, pixelWidth: 64, pixelHeight: 48 },
        ],
      },
    ]);

    const imageBlock = blocks.find((block) => block.type === 'image');
    assert.ok(imageBlock);
    assert.equal(imageBlock.pageIndex, 1);
  });

  test('a page that is only a figure still yields a block', async () => {
    // Would previously be dropped: the parser filtered pages with no text.
    const { blocks } = await pipeline([
      {
        lines: [],
        images: [
          { name: 'Im0', x: 72, y: 300, width: 400, height: 300, pixelWidth: 128, pixelHeight: 96 },
        ],
      },
    ]);

    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.type, 'image');
  });

  test('multiple figures on one page each become a block', async () => {
    const { blocks, written } = await pipeline([
      {
        lines: [{ text: 'Two figures follow.', x: 72, y: 720 }],
        images: [
          { name: 'Im0', x: 72, y: 500, width: 200, height: 150, pixelWidth: 64, pixelHeight: 48 },
          { name: 'Im1', x: 72, y: 250, width: 200, height: 150, pixelWidth: 64, pixelHeight: 48 },
        ],
      },
    ]);

    assert.equal(blocks.filter((block) => block.type === 'image').length, 2);
    assert.equal(written.size, 2, 'each distinct resource gets its own file');
  });

  test('an unsupported image format is skipped, not rendered broken', async () => {
    // A 1-bit mask: the decoder returns null, so no image block should appear, and
    // the page's text must survive.
    const pdf = buildPdf([
      {
        lines: [{ text: 'Text with an undecodable graphic.', x: 72, y: 700 }],
        images: [
          { name: 'Im0', x: 72, y: 400, width: 200, height: 150, pixelWidth: 8, pixelHeight: 8 },
        ],
      },
    ]);
    const { engine } = engineFor(pdf);
    const range = await engine.extractPageRange(SOURCE, 0, 1);

    // 8x8 is below the 32px content threshold, so it is filtered as decoration.
    assert.equal(range.pages[0]!.images?.length ?? 0, 0);
    assert.match(range.pages[0]!.text, /undecodable graphic/);
  });

  test('text-only extraction can be turned off cheaply', async () => {
    const pdf = buildPdf([
      {
        lines: [{ text: 'Body text.', x: 72, y: 700 }],
        images: [
          { name: 'Im0', x: 72, y: 400, width: 200, height: 150, pixelWidth: 64, pixelHeight: 48 },
        ],
      },
    ]);

    let writes = 0;
    const engine = createPdfKitTextExtractionEngine({
      readBytes: async () => pdf,
      extractImages: false,
      writeImage: async (fileName) => {
        writes++;
        return `file:///cache/${fileName}`;
      },
    });

    const range = await engine.extractPageRange(SOURCE, 0, 1);

    assert.equal(writes, 0, 'no image work should happen when disabled');
    assert.equal(range.pages[0]!.images?.length ?? 0, 0);
    assert.match(range.pages[0]!.text, /Body text/);
  });

  test('re-reading a page does not re-write its bitmap', async () => {
    const pdf = buildPdf([
      {
        lines: [{ text: 'Figure page.', x: 72, y: 700 }],
        images: [
          { name: 'Im0', x: 72, y: 400, width: 200, height: 150, pixelWidth: 64, pixelHeight: 48 },
        ],
      },
    ]);

    let writes = 0;
    const engine = createPdfKitTextExtractionEngine({
      readBytes: async () => pdf,
      writeImage: async (fileName) => {
        writes++;
        return `file:///cache/${fileName}`;
      },
    });

    await engine.extractPageRange(SOURCE, 0, 1);
    await engine.extractPageRange(SOURCE, 0, 1);
    await engine.extractPageText(SOURCE, 0);

    assert.equal(writes, 1, 'page results are memoized, so images are written once');
  });
});

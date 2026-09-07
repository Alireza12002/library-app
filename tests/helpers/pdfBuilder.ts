/**
 * Builds small, valid PDFs in memory for tests (ARCHITECTURE.md §9).
 *
 * The extraction pipeline can only be trusted if it is exercised against real PDF
 * bytes — object syntax, xref, FlateDecode streams and text operators — rather
 * than hand-written fixtures of the intermediate types. This writer emits the
 * minimum structure a conforming reader needs, with byte offsets computed as the
 * file is assembled.
 *
 * Test-only: nothing in the app imports this file.
 */
import { deflateSync } from 'node:zlib';

export interface TextLine {
  /** Text to show. */
  text: string;
  /** Baseline X in PDF user units (points from the left edge). */
  x: number;
  /** Baseline Y in PDF user units (points from the BOTTOM edge). */
  y: number;
  /** Font size in points. */
  size?: number;
}

/** An image drawn on the page via a `Do` operator. */
export interface ImageSpec {
  /** Resource name in /XObject (e.g. 'Im0'). */
  name: string;
  /** Left edge in user units. */
  x: number;
  /** BOTTOM edge in user units. */
  y: number;
  /** Placed width in user units. */
  width: number;
  /** Placed height in user units. */
  height: number;
  /** Intrinsic pixel width of the bitmap. */
  pixelWidth: number;
  /** Intrinsic pixel height of the bitmap. */
  pixelHeight: number;
  /** 1 = DeviceGray, 3 = DeviceRGB. Defaults to 3. */
  channels?: 1 | 3;
  /** Emit as DCTDecode (a fake JPEG payload) to test the pass-through path. */
  asJpeg?: boolean;
}

export interface PageSpec {
  lines: TextLine[];
  images?: ImageSpec[];
  width?: number;
  height?: number;
}

export interface BuildOptions {
  /** Compress content streams with FlateDecode. Defaults to true. */
  compress?: boolean;
  /** Emit `/Encrypt` in the trailer so encryption handling can be tested. */
  encrypted?: boolean;
}

/** Escapes a string for a PDF literal string. */
function escapeText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/** Emits the content stream for one page. */
function buildContent(page: PageSpec): string {
  const parts: string[] = [];

  // Images first in stream order; the extractor orders by position, not by
  // appearance, so this also proves the vertical merge works.
  for (const image of page.images ?? []) {
    parts.push('q');
    // Map the unit square onto the placement rectangle (PDF 32000-1 §8.9.5.2).
    parts.push(`${image.width} 0 0 ${image.height} ${image.x} ${image.y} cm`);
    parts.push(`/${image.name} Do`);
    parts.push('Q');
  }

  parts.push('BT');
  for (const line of page.lines) {
    const size = line.size ?? 12;
    parts.push(`/F1 ${size} Tf`);
    parts.push(`1 0 0 1 ${line.x} ${line.y} Tm`);
    parts.push(`(${escapeText(line.text)}) Tj`);
  }
  parts.push('ET');

  return parts.join('\n');
}

/** Deterministic RGB/gray sample data for a test bitmap. */
function buildSamples(width: number, height: number, channels: 1 | 3): Uint8Array {
  const samples = new Uint8Array(width * height * channels);
  for (let i = 0; i < samples.length; i++) {
    samples[i] = (i * 37) % 256;
  }
  return samples;
}

/**
 * Assembles a single-file PDF with one font and the given pages.
 *
 * Structure: catalog → pages tree → page objects → content streams → font.
 */
export function buildPdf(pages: PageSpec[], options: BuildOptions = {}): Uint8Array {
  const compress = options.compress ?? true;

  const chunks: Uint8Array[] = [];
  let length = 0;
  const offsets: number[] = [];

  const pushRaw = (bytes: Uint8Array): void => {
    chunks.push(bytes);
    length += bytes.length;
  };
  const push = (text: string): void => pushRaw(Buffer.from(text, 'latin1'));

  push('%PDF-1.7\n');
  // Binary comment line: marks the file as containing binary data.
  pushRaw(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  // Object numbering: 1 catalog, 2 pages tree, 3 font, then per page a page
  // object and a content stream, then one object per image across all pages.
  const catalogNum = 1;
  const pagesNum = 2;
  const fontNum = 3;
  const firstPageNum = 4;

  const pageNums = pages.map((_, i) => firstPageNum + i * 2);
  const contentNums = pages.map((_, i) => firstPageNum + i * 2 + 1);

  // Assign an object number to every image, keyed by page and resource name.
  let nextImageNum = firstPageNum + pages.length * 2;
  const imageNums = new Map<string, number>();
  pages.forEach((page, pageIndex) => {
    for (const image of page.images ?? []) {
      imageNums.set(`${pageIndex}:${image.name}`, nextImageNum++);
    }
  });

  const startObject = (num: number): void => {
    offsets[num] = length;
    push(`${num} 0 obj\n`);
  };
  const endObject = (): void => push('endobj\n');

  // 1: catalog
  startObject(catalogNum);
  push(`<< /Type /Catalog /Pages ${pagesNum} 0 R >>\n`);
  endObject();

  // 2: pages tree
  startObject(pagesNum);
  push(
    `<< /Type /Pages /Count ${pages.length} /Kids [${pageNums
      .map((n) => `${n} 0 R`)
      .join(' ')}] >>\n`,
  );
  endObject();

  // 3: font (standard Type1, no embedded program needed)
  startObject(fontNum);
  push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\n');
  endObject();

  pages.forEach((page, index) => {
    const width = page.width ?? 612;
    const height = page.height ?? 792;

    const xobjectEntries = (page.images ?? [])
      .map((image) => `/${image.name} ${imageNums.get(`${index}:${image.name}`)!} 0 R`)
      .join(' ');
    const xobjectResource =
      xobjectEntries.length > 0 ? ` /XObject << ${xobjectEntries} >>` : '';

    startObject(pageNums[index]!);
    push(
      `<< /Type /Page /Parent ${pagesNum} 0 R /MediaBox [0 0 ${width} ${height}] ` +
        `/Resources << /Font << /F1 ${fontNum} 0 R >>${xobjectResource} >> ` +
        `/Contents ${contentNums[index]!} 0 R >>\n`,
    );
    endObject();

    const content = buildContent(page);
    const raw = Buffer.from(content, 'latin1');
    const body = compress ? deflateSync(raw) : raw;

    startObject(contentNums[index]!);
    push(
      `<< /Length ${body.length}${compress ? ' /Filter /FlateDecode' : ''} >>\nstream\n`,
    );
    pushRaw(new Uint8Array(body));
    push('\nendstream\n');
    endObject();
  });

  // Image XObjects.
  pages.forEach((page, pageIndex) => {
    for (const image of page.images ?? []) {
      const num = imageNums.get(`${pageIndex}:${image.name}`)!;
      const channels = image.channels ?? 3;
      const colorSpace = channels === 1 ? '/DeviceGray' : '/DeviceRGB';

      let body: Uint8Array;
      let filter: string;

      if (image.asJpeg) {
        // SOI + minimal marker soup. The extractor passes DCTDecode bytes through
        // untouched, so the payload only has to be identifiable, not decodable.
        body = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9]);
        filter = ' /Filter /DCTDecode';
      } else {
        const samples = buildSamples(image.pixelWidth, image.pixelHeight, channels);
        body = new Uint8Array(deflateSync(Buffer.from(samples)));
        filter = ' /Filter /FlateDecode';
      }

      startObject(num);
      push(
        `<< /Type /XObject /Subtype /Image /Width ${image.pixelWidth} ` +
          `/Height ${image.pixelHeight} /ColorSpace ${colorSpace} ` +
          `/BitsPerComponent 8 /Length ${body.length}${filter} >>\nstream\n`,
      );
      pushRaw(body);
      push('\nendstream\n');
      endObject();
    }
  });

  // xref table
  const xrefStart = length;
  const allNums = [catalogNum, pagesNum, fontNum, ...pageNums, ...contentNums, ...imageNums.values()];
  const highest = Math.max(...allNums);
  push(`xref\n0 ${highest + 1}\n`);
  push('0000000000 65535 f \n');
  for (let num = 1; num <= highest; num++) {
    const offset = offsets[num] ?? 0;
    push(`${String(offset).padStart(10, '0')} 00000 n \n`);
  }

  const encryptEntry = options.encrypted ? ' /Encrypt 99 0 R' : '';
  push(
    `trailer\n<< /Size ${highest + 1} /Root ${catalogNum} 0 R${encryptEntry} >>\n` +
      `startxref\n${xrefStart}\n%%EOF\n`,
  );

  const out = new Uint8Array(length);
  let cursor = 0;
  for (const chunk of chunks) {
    out.set(chunk, cursor);
    cursor += chunk.length;
  }
  return out;
}

/**
 * A page of prose laid out as wrapped lines at a fixed leading — the shape real
 * documents have, and what paragraph detection must cope with.
 */
export function prosePage(
  lines: string[],
  options: { startY?: number; leading?: number; size?: number; x?: number } = {},
): PageSpec {
  const startY = options.startY ?? 700;
  const leading = options.leading ?? 14;
  const size = options.size ?? 12;
  const x = options.x ?? 72;

  return {
    lines: lines.map((text, index) => ({
      text,
      x,
      y: startY - index * leading,
      size,
    })),
  };
}

/**
 * PDF document structure: object resolution and page enumeration.
 *
 * Locating objects in a PDF normally means walking the cross-reference table, but
 * xref tables are frequently wrong in the wild (incremental updates, linearized
 * files, generators that miscount bytes), and PDF 32000-1 permits both classic
 * tables and cross-reference streams plus object streams. Rather than implement
 * three fragile paths, this scans the file once for `N G obj` headers and indexes
 * them, then expands any object streams it finds. That is the same recovery
 * strategy real readers fall back to, it tolerates damaged xrefs, and it is a
 * single deterministic pass.
 *
 * Layer note: PDF technology behind the TextExtractionEngine port
 * (ARCHITECTURE.md §6).
 */
import { inflate } from './inflate';
import { encodePng } from './png';
import {
  arrayOf,
  dictOf,
  nameOf,
  numberOf,
  PdfLexer,
  PDF_NULL,
  type PdfObject,
} from './objects';

export class PdfStructureError extends Error {
  readonly code: 'invalid_document' | 'encrypted' | 'no_pages';

  constructor(code: 'invalid_document' | 'encrypted' | 'no_pages', message: string) {
    super(message);
    this.name = 'PdfStructureError';
    this.code = code;
  }
}

/** A page's content plus the resources needed to decode its text and images. */
export interface PdfPageContent {
  /** Concatenated, decoded content streams for the page. */
  content: Uint8Array;
  /** Font resources by resource name (e.g. 'F1'), for encoding decisions. */
  fonts: Map<string, PdfFontInfo>;
  /** Image XObject streams by resource name (e.g. 'Im0'), undecoded. */
  imageResources: Map<string, Extract<PdfObject, { kind: 'stream' }>>;
  /** Page box as [x0, y0, x1, y1] in user units, for normalizing positions. */
  mediaBox: [number, number, number, number];
}

/** A decoded bitmap, in a container React Native's Image can display. */
export interface DecodedImage {
  mimeType: 'image/jpeg' | 'image/png';
  bytes: Uint8Array;
  width: number;
  height: number;
}

export interface PdfFontInfo {
  /** Base font name, when declared. */
  baseFont: string | null;
  /** True when text bytes are 2-per-glyph (Identity-H and friends). */
  twoByte: boolean;
  /** CID → Unicode map parsed from an embedded ToUnicode CMap, when present. */
  toUnicode: Map<number, string> | null;
}

interface IndexedObject {
  offset: number;
  /** Parsed lazily and memoized: most objects are never touched. */
  cached?: PdfObject;
}

export class PdfDocument {
  private readonly data: Uint8Array;
  private readonly objects = new Map<number, IndexedObject>();
  /** Objects recovered from object streams, already parsed. */
  private readonly embedded = new Map<number, PdfObject>();
  private pageRefs: PdfObject[] | null = null;

  private constructor(data: Uint8Array) {
    this.data = data;
  }

  static parse(data: Uint8Array): PdfDocument {
    if (data.length < 8) {
      throw new PdfStructureError('invalid_document', 'File is too small to be a PDF.');
    }

    // %PDF- must appear near the start; some files carry junk before it.
    const headerWindow = data.subarray(0, Math.min(1024, data.length));
    if (indexOfBytes(headerWindow, '%PDF-') < 0) {
      throw new PdfStructureError('invalid_document', 'Missing %PDF header.');
    }

    const doc = new PdfDocument(data);
    doc.indexObjects();
    doc.expandObjectStreams();
    doc.assertNotEncrypted();
    return doc;
  }

  /** Scans for `N G obj` headers and records their offsets. */
  private indexObjects(): void {
    const data = this.data;
    // 'obj' = 0x6f 0x62 0x6a
    for (let i = 0; i + 2 < data.length; i++) {
      if (data[i] !== 0x6f || data[i + 1] !== 0x62 || data[i + 2] !== 0x6a) continue;

      // Walk backwards over: whitespace, generation digits, whitespace, object digits.
      let cursor = i - 1;
      cursor = skipBackWhitespace(data, cursor);
      const genEnd = cursor;
      while (cursor >= 0 && isDigitByte(data[cursor]!)) cursor--;
      if (cursor === genEnd) continue; // no generation number

      cursor = skipBackWhitespace(data, cursor);
      const numEnd = cursor;
      while (cursor >= 0 && isDigitByte(data[cursor]!)) cursor--;
      if (cursor === numEnd) continue; // no object number

      const numStart = cursor + 1;
      const objectNumber = parseDigits(data, numStart, numEnd);
      if (objectNumber === null) continue;

      // Later definitions win: that is how incremental updates override objects.
      this.objects.set(objectNumber, { offset: i + 3 });
    }

    if (this.objects.size === 0) {
      throw new PdfStructureError('invalid_document', 'No PDF objects found.');
    }
  }

  /** Decodes /Type /ObjStm containers so their contents become resolvable. */
  private expandObjectStreams(): void {
    for (const [number] of [...this.objects]) {
      let object: PdfObject;
      try {
        object = this.resolveIndexed(number);
      } catch {
        continue;
      }
      if (object.kind !== 'stream') continue;
      if (nameOf(object.dict.get('Type')) !== 'ObjStm') continue;

      let decoded: Uint8Array;
      try {
        decoded = this.decodeStream(object);
      } catch {
        continue; // a broken object stream must not sink the whole document
      }

      const count = numberOf(this.resolve(object.dict.get('N')));
      const first = numberOf(this.resolve(object.dict.get('First')));
      if (count === null || first === null) continue;

      // Header: pairs of (object number, offset relative to First).
      const header = new PdfLexer(decoded, 0);
      const pairs: { num: number; offset: number }[] = [];
      for (let i = 0; i < count; i++) {
        const numToken = header.readToken();
        const offsetToken = header.readToken();
        const num = Number.parseInt(numToken, 10);
        const offset = Number.parseInt(offsetToken, 10);
        if (!Number.isFinite(num) || !Number.isFinite(offset)) break;
        pairs.push({ num, offset });
      }

      for (const pair of pairs) {
        const start = first + pair.offset;
        if (start < 0 || start >= decoded.length) continue;
        // Only fill gaps: a top-level definition of the same number takes
        // precedence, matching incremental-update semantics.
        if (this.objects.has(pair.num)) continue;
        try {
          const lexer = new PdfLexer(decoded, start);
          this.embedded.set(pair.num, lexer.parseObject());
        } catch {
          // skip this entry
        }
      }
    }
  }

  private assertNotEncrypted(): void {
    // /Encrypt lives in the trailer. Without a full xref parse, detect it by
    // looking for the trailer keyword near the end of the file.
    const tailStart = Math.max(0, this.data.length - 4096);
    const tail = this.data.subarray(tailStart);
    if (indexOfBytes(tail, '/Encrypt') >= 0) {
      throw new PdfStructureError(
        'encrypted',
        'This PDF is encrypted; text extraction is not supported.',
      );
    }
  }

  private resolveIndexed(number: number): PdfObject {
    const entry = this.objects.get(number);
    if (!entry) return PDF_NULL;
    if (entry.cached) return entry.cached;

    const lexer = new PdfLexer(this.data, entry.offset);
    const parsed = lexer.parseObject();
    entry.cached = parsed;
    return parsed;
  }

  /** Follows indirect references (with a cycle guard) to a direct object. */
  resolve(object: PdfObject | undefined): PdfObject {
    let current = object ?? PDF_NULL;
    const seen = new Set<number>();

    while (current.kind === 'ref') {
      if (seen.has(current.num)) return PDF_NULL; // reference cycle
      seen.add(current.num);
      const embedded = this.embedded.get(current.num);
      current = embedded ?? this.resolveIndexed(current.num);
    }

    return current;
  }

  /**
   * Decodes a stream's bytes, applying the filter chain.
   *
   * Supports FlateDecode (the overwhelmingly common case) with PNG/TIFF
   * predictors, and passes through unfiltered streams. Unsupported filters throw,
   * so the caller can report an honest "cannot extract" rather than emit garbage.
   */
  decodeStream(stream: Extract<PdfObject, { kind: 'stream' }>): Uint8Array {
    let bytes = this.data.subarray(stream.rawStart, stream.rawEnd);

    const filterObject = this.resolve(stream.dict.get('Filter'));
    const filters: string[] = [];
    if (filterObject.kind === 'name') {
      filters.push(filterObject.name);
    } else if (filterObject.kind === 'array') {
      for (const item of filterObject.items) {
        const name = nameOf(this.resolve(item));
        if (name) filters.push(name);
      }
    }

    for (const filter of filters) {
      switch (filter) {
        case 'FlateDecode':
        case 'Fl':
          bytes = inflate(bytes);
          bytes = this.applyPredictor(bytes, stream);
          break;
        case 'ASCIIHexDecode':
        case 'AHx':
          bytes = decodeAsciiHex(bytes);
          break;
        case 'ASCII85Decode':
        case 'A85':
          bytes = decodeAscii85(bytes);
          break;
        default:
          throw new PdfStructureError(
            'invalid_document',
            `Unsupported stream filter: ${filter}.`,
          );
      }
    }

    return bytes;
  }

  /** Reverses PNG/TIFF predictors used by cross-reference and image streams. */
  private applyPredictor(
    bytes: Uint8Array,
    stream: Extract<PdfObject, { kind: 'stream' }>,
  ): Uint8Array {
    const parms = dictOf(this.resolve(stream.dict.get('DecodeParms')));
    if (!parms) return bytes;

    const predictor = numberOf(this.resolve(parms.get('Predictor'))) ?? 1;
    if (predictor <= 1) return bytes;

    const colors = numberOf(this.resolve(parms.get('Colors'))) ?? 1;
    const bpc = numberOf(this.resolve(parms.get('BitsPerComponent'))) ?? 8;
    const columns = numberOf(this.resolve(parms.get('Columns'))) ?? 1;
    const bytesPerPixel = Math.max(1, Math.ceil((colors * bpc) / 8));
    const rowLength = Math.ceil((colors * bpc * columns) / 8);

    if (predictor === 2) {
      // TIFF predictor 2, 8-bit components only.
      if (bpc !== 8) return bytes;
      const rows = Math.floor(bytes.length / rowLength);
      for (let row = 0; row < rows; row++) {
        const base = row * rowLength;
        for (let i = bytesPerPixel; i < rowLength; i++) {
          bytes[base + i] = (bytes[base + i]! + bytes[base + i - bytesPerPixel]!) & 0xff;
        }
      }
      return bytes;
    }

    // PNG predictors: each row is prefixed with a filter-type byte.
    const stride = rowLength + 1;
    const rows = Math.floor(bytes.length / stride);
    const out = new Uint8Array(rows * rowLength);

    for (let row = 0; row < rows; row++) {
      const type = bytes[row * stride]!;
      const src = row * stride + 1;
      const dst = row * rowLength;
      const prev = dst - rowLength;

      for (let i = 0; i < rowLength; i++) {
        const raw = bytes[src + i]!;
        const left = i >= bytesPerPixel ? out[dst + i - bytesPerPixel]! : 0;
        const up = row > 0 ? out[prev + i]! : 0;
        const upLeft = row > 0 && i >= bytesPerPixel ? out[prev + i - bytesPerPixel]! : 0;

        let value: number;
        switch (type) {
          case 0: value = raw; break;
          case 1: value = raw + left; break;
          case 2: value = raw + up; break;
          case 3: value = raw + ((left + up) >> 1); break;
          case 4: {
            const p = left + up - upLeft;
            const pa = Math.abs(p - left);
            const pb = Math.abs(p - up);
            const pc = Math.abs(p - upLeft);
            value = raw + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft);
            break;
          }
          default: value = raw;
        }
        out[dst + i] = value & 0xff;
      }
    }

    return out;
  }

  /**
   * Page references in document order.
   *
   * Walks the /Pages tree from the catalog when possible; falls back to scanning
   * every indexed object for /Type /Page, which keeps damaged documents readable.
   */
  private collectPages(): PdfObject[] {
    if (this.pageRefs) return this.pageRefs;

    const fromTree = this.collectPagesFromCatalog();
    if (fromTree.length > 0) {
      this.pageRefs = fromTree;
      return fromTree;
    }

    // Fallback: object-number order approximates document order well enough to
    // read, and is far better than refusing to open the book.
    const scanned: { num: number; object: PdfObject }[] = [];
    for (const [num] of this.objects) {
      const object = this.resolveIndexed(num);
      const dict = dictOf(object);
      if (dict && nameOf(this.resolve(dict.get('Type'))) === 'Page') {
        scanned.push({ num, object });
      }
    }
    for (const [num, object] of this.embedded) {
      const dict = dictOf(object);
      if (dict && nameOf(this.resolve(dict.get('Type'))) === 'Page') {
        scanned.push({ num, object });
      }
    }

    scanned.sort((a, b) => a.num - b.num);
    this.pageRefs = scanned.map((entry) => entry.object);
    return this.pageRefs;
  }

  private collectPagesFromCatalog(): PdfObject[] {
    // Find a catalog among the indexed objects.
    let pagesRoot: PdfObject | null = null;
    for (const [num] of this.objects) {
      const dict = dictOf(this.resolveIndexed(num));
      if (dict && nameOf(this.resolve(dict.get('Type'))) === 'Catalog') {
        const pages = this.resolve(dict.get('Pages'));
        if (dictOf(pages)) {
          pagesRoot = pages;
          break;
        }
      }
    }
    if (!pagesRoot) return [];

    const pages: PdfObject[] = [];
    const visited = new Set<PdfObject>();

    const walk = (node: PdfObject, depth: number): void => {
      if (depth > 64 || visited.has(node)) return; // malformed/looping tree
      visited.add(node);

      const dict = dictOf(node);
      if (!dict) return;

      const type = nameOf(this.resolve(dict.get('Type')));
      if (type === 'Page') {
        pages.push(node);
        return;
      }

      const kids = arrayOf(this.resolve(dict.get('Kids')));
      if (!kids) return;
      for (const kid of kids) {
        walk(this.resolve(kid), depth + 1);
      }
    };

    walk(pagesRoot, 0);
    return pages;
  }

  get pageCount(): number {
    return this.collectPages().length;
  }

  /**
   * Content bytes and font info for one 0-based page index.
   *
   * Inherited attributes (/Resources on a parent Pages node) are honoured, since
   * many generators declare fonts once at the tree root.
   */
  getPageContent(pageIndex: number): PdfPageContent | null {
    const pages = this.collectPages();
    const page = pages[pageIndex];
    if (!page) return null;

    const dict = dictOf(page);
    if (!dict) return null;

    const chunks: Uint8Array[] = [];
    const contents = this.resolve(dict.get('Contents'));

    const pushStream = (candidate: PdfObject): void => {
      const resolved = this.resolve(candidate);
      if (resolved.kind !== 'stream') return;
      try {
        chunks.push(this.decodeStream(resolved));
      } catch {
        // One unreadable stream should not lose the rest of the page.
      }
    };

    if (contents.kind === 'array') {
      for (const item of contents.items) pushStream(item);
    } else {
      pushStream(contents);
    }

    const content = concatBytes(chunks);
    const fonts = this.collectFonts(dict);
    const imageResources = this.collectImageResources(dict);
    const mediaBox = this.resolveMediaBox(dict);

    return { content, fonts, imageResources, mediaBox };
  }

  /**
   * Page box, honouring inheritance from parent /Pages nodes.
   *
   * Falls back to US Letter, which is what readers do when /MediaBox is missing or
   * malformed.
   */
  private resolveMediaBox(pageDict: Map<string, PdfObject>): [number, number, number, number] {
    let dict: Map<string, PdfObject> | null = pageDict;
    let depth = 0;

    while (dict && depth++ < 32) {
      const box = arrayOf(this.resolve(dict.get('MediaBox')));
      if (box && box.length >= 4) {
        const values = box.slice(0, 4).map((item) => numberOf(this.resolve(item)));
        if (values.every((value): value is number => value !== null)) {
          const [x0, y0, x1, y1] = values as [number, number, number, number];
          // Normalize: the spec allows the corners in either order.
          return [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)];
        }
      }
      dict = dictOf(this.resolve(dict.get('Parent')));
    }

    return [0, 0, 612, 792];
  }

  /**
   * Resolves /Resources /XObject entries of /Subtype /Image, walking up /Parent
   * for inheritance the same way fonts do.
   *
   * Streams are returned undecoded: a page can reference a 4MB photo that reflow
   * never shows, so decoding is deferred to `decodeImage`.
   */
  private collectImageResources(
    pageDict: Map<string, PdfObject>,
  ): Map<string, Extract<PdfObject, { kind: 'stream' }>> {
    const images = new Map<string, Extract<PdfObject, { kind: 'stream' }>>();

    let dict: Map<string, PdfObject> | null = pageDict;
    let depth = 0;

    while (dict && depth++ < 32) {
      const resources = dictOf(this.resolve(dict.get('Resources')));
      const xobjects = resources ? dictOf(this.resolve(resources.get('XObject'))) : null;

      if (xobjects) {
        for (const [name, ref] of xobjects) {
          if (images.has(name)) continue; // nearest declaration wins
          const stream = this.resolve(ref);
          if (stream.kind !== 'stream') continue;
          if (nameOf(this.resolve(stream.dict.get('Subtype'))) !== 'Image') continue;
          images.set(name, stream);
        }
      }

      dict = dictOf(this.resolve(dict.get('Parent')));
    }

    return images;
  }

  /**
   * Decodes an image XObject into a displayable bitmap, or null when the format
   * is not something we can hand to React Native.
   *
   * Two paths:
   *  - `DCTDecode` (JPEG) is passed through verbatim — RN's Image decodes JPEG
   *    natively, so re-encoding would only lose quality and time.
   *  - `FlateDecode`d raw samples are re-wrapped as PNG, because RN cannot display
   *    bare component data.
   *
   * Anything else (JPX, JBIG2, CCITT fax) returns null: reflow shows a placeholder
   * rather than a broken image. Masks and 1-bit images are also skipped — they are
   * almost always page decoration, not content worth reflowing.
   */
  decodeImage(stream: Extract<PdfObject, { kind: 'stream' }>): DecodedImage | null {
    const width = numberOf(this.resolve(stream.dict.get('Width')));
    const height = numberOf(this.resolve(stream.dict.get('Height')));
    if (width === null || height === null || width <= 0 || height <= 0) return null;

    // Guard against absurd allocations from a malformed dictionary.
    if (width * height > 40_000_000) return null;

    const filters: string[] = [];
    const filterObject = this.resolve(stream.dict.get('Filter'));
    if (filterObject.kind === 'name') {
      filters.push(filterObject.name);
    } else if (filterObject.kind === 'array') {
      for (const item of filterObject.items) {
        const name = nameOf(this.resolve(item));
        if (name) filters.push(name);
      }
    }

    // JPEG: hand the original bytes over untouched.
    if (filters.includes('DCTDecode') || filters.includes('DCT')) {
      return {
        mimeType: 'image/jpeg',
        bytes: this.data.slice(stream.rawStart, stream.rawEnd),
        width,
        height,
      };
    }

    // Unsupported compressed formats.
    if (
      filters.some((filter) =>
        ['JPXDecode', 'JBIG2Decode', 'CCITTFaxDecode', 'CCF'].includes(filter),
      )
    ) {
      return null;
    }

    const bitsPerComponent = numberOf(this.resolve(stream.dict.get('BitsPerComponent'))) ?? 8;
    if (bitsPerComponent !== 8) return null; // 1/2/4-bit is decoration in practice

    const isMask = this.resolve(stream.dict.get('ImageMask'));
    if (isMask.kind === 'boolean' && isMask.value) return null;

    const channels = this.imageChannels(stream);
    if (channels === null) return null;

    let samples: Uint8Array;
    try {
      samples = this.decodeStream(stream);
    } catch {
      return null;
    }

    const expected = width * height * channels;
    if (samples.length < expected) return null; // truncated data

    try {
      const png = encodePng({
        width,
        height,
        channels: channels === 1 ? 1 : 3,
        samples:
          channels === 3
            ? samples
            : channels === 1
              ? samples
              : cmykToRgb(samples, width * height),
      });
      return { mimeType: 'image/png', bytes: png, width, height };
    } catch {
      return null;
    }
  }

  /** Component count implied by the image's colour space. */
  private imageChannels(stream: Extract<PdfObject, { kind: 'stream' }>): 1 | 3 | 4 | null {
    const space = this.resolve(stream.dict.get('ColorSpace'));

    const fromName = (name: string): 1 | 3 | 4 | null => {
      switch (name) {
        case 'DeviceGray':
        case 'CalGray':
        case 'G':
          return 1;
        case 'DeviceRGB':
        case 'CalRGB':
        case 'RGB':
          return 3;
        case 'DeviceCMYK':
        case 'CMYK':
          return 4;
        default:
          return null;
      }
    };

    if (space.kind === 'name') return fromName(space.name);

    if (space.kind === 'array') {
      const family = nameOf(this.resolve(space.items[0]));
      // ICCBased carries its component count in the stream dictionary.
      if (family === 'ICCBased') {
        const iccStream = this.resolve(space.items[1]);
        const n = iccStream.kind === 'stream' ? numberOf(this.resolve(iccStream.dict.get('N'))) : null;
        if (n === 1 || n === 3 || n === 4) return n;
        return null;
      }
      // Indexed/Separation/Lab need palette or conversion work that is not worth
      // it for reflow; treat as unsupported.
      if (family) return fromName(family);
    }

    return null;
  }

  /** Resolves /Resources /Font for a page, walking up /Parent for inheritance. */
  private collectFonts(pageDict: Map<string, PdfObject>): Map<string, PdfFontInfo> {
    const fonts = new Map<string, PdfFontInfo>();

    let dict: Map<string, PdfObject> | null = pageDict;
    let depth = 0;

    while (dict && depth++ < 32) {
      const resources = dictOf(this.resolve(dict.get('Resources')));
      const fontDict = resources ? dictOf(this.resolve(resources.get('Font'))) : null;

      if (fontDict) {
        for (const [name, ref] of fontDict) {
          if (fonts.has(name)) continue; // nearest declaration wins
          const font = this.readFont(this.resolve(ref));
          if (font) fonts.set(name, font);
        }
      }

      const parent = dictOf(this.resolve(dict.get('Parent')));
      dict = parent;
    }

    return fonts;
  }

  private readFont(fontObject: PdfObject): PdfFontInfo | null {
    const dict = dictOf(fontObject);
    if (!dict) return null;

    const baseFont = nameOf(this.resolve(dict.get('BaseFont')));
    const subtype = nameOf(this.resolve(dict.get('Subtype')));
    const encoding = this.resolve(dict.get('Encoding'));
    const encodingName = nameOf(encoding);

    // Composite fonts (Type0) address glyphs with 2-byte codes.
    const twoByte =
      subtype === 'Type0' ||
      encodingName === 'Identity-H' ||
      encodingName === 'Identity-V';

    let toUnicode: Map<number, string> | null = null;
    const toUnicodeStream = this.resolve(dict.get('ToUnicode'));
    if (toUnicodeStream.kind === 'stream') {
      try {
        toUnicode = parseToUnicodeCMap(this.decodeStream(toUnicodeStream));
      } catch {
        toUnicode = null; // fall back to raw byte interpretation
      }
    }

    return { baseFont, twoByte, toUnicode };
  }
}

/**
 * Parses a ToUnicode CMap into CID → string.
 *
 * Only the two constructs that matter for text recovery are handled:
 * `beginbfchar`/`endbfchar` pairs and `beginbfrange`/`endbfrange` triples.
 */
export function parseToUnicodeCMap(bytes: Uint8Array): Map<number, string> {
  const map = new Map<number, string>();
  const lexer = new PdfLexer(bytes, 0);

  const hexToCode = (object: PdfObject): number | null => {
    if (object.kind !== 'string') return null;
    let value = 0;
    for (const byte of object.bytes) value = (value << 8) | byte;
    return value;
  };

  const hexToString = (object: PdfObject): string | null => {
    if (object.kind !== 'string') return null;
    // UTF-16BE code units, per the CMap spec.
    let out = '';
    for (let i = 0; i + 1 < object.bytes.length; i += 2) {
      out += String.fromCharCode((object.bytes[i]! << 8) | object.bytes[i + 1]!);
    }
    if (object.bytes.length === 1) out = String.fromCharCode(object.bytes[0]!);
    return out;
  };

  while (!lexer.atEnd) {
    const token = lexer.peekToken();

    if (token === 'beginbfchar') {
      lexer.readToken();
      for (;;) {
        lexer.skipWhitespace();
        if (lexer.atEnd || lexer.peekToken() === 'endbfchar') {
          lexer.readToken();
          break;
        }
        const src = lexer.parseObject();
        const dst = lexer.parseObject();
        const code = hexToCode(src);
        const text = hexToString(dst);
        if (code !== null && text) map.set(code, text);
      }
      continue;
    }

    if (token === 'beginbfrange') {
      lexer.readToken();
      for (;;) {
        lexer.skipWhitespace();
        if (lexer.atEnd || lexer.peekToken() === 'endbfrange') {
          lexer.readToken();
          break;
        }
        const lowObject = lexer.parseObject();
        const highObject = lexer.parseObject();
        const target = lexer.parseObject();

        const low = hexToCode(lowObject);
        const high = hexToCode(highObject);
        if (low === null || high === null) continue;
        // Guard against absurd ranges in malformed CMaps.
        const span = Math.min(high - low, 65535);

        if (target.kind === 'array') {
          for (let i = 0; i <= span && i < target.items.length; i++) {
            const text = hexToString(target.items[i]!);
            if (text) map.set(low + i, text);
          }
        } else {
          const base = hexToString(target);
          if (!base) continue;
          const baseCode = base.charCodeAt(base.length - 1);
          const prefix = base.slice(0, -1);
          for (let i = 0; i <= span; i++) {
            map.set(low + i, prefix + String.fromCharCode(baseCode + i));
          }
        }
      }
      continue;
    }

    if (lexer.readToken() === '') break;
  }

  return map;
}

/* ---- byte helpers ---- */

function isDigitByte(byte: number): boolean {
  return byte >= 0x30 && byte <= 0x39;
}

function skipBackWhitespace(data: Uint8Array, from: number): number {
  let cursor = from;
  while (cursor >= 0) {
    const byte = data[cursor]!;
    if (byte === 0x20 || byte === 0x0a || byte === 0x0d || byte === 0x09 || byte === 0x00) {
      cursor--;
      continue;
    }
    break;
  }
  return cursor;
}

function parseDigits(data: Uint8Array, start: number, end: number): number | null {
  if (start > end) return null;
  let value = 0;
  for (let i = start; i <= end; i++) {
    const byte = data[i]!;
    if (!isDigitByte(byte)) return null;
    value = value * 10 + (byte - 0x30);
    if (value > Number.MAX_SAFE_INTEGER) return null;
  }
  return value;
}

function indexOfBytes(haystack: Uint8Array, needle: string): number {
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle.charCodeAt(j)) continue outer;
    }
    return i;
  }
  return -1;
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  if (chunks.length === 1) return chunks[0]!;
  let total = 0;
  for (const chunk of chunks) total += chunk.length + 1; // +1 for a separator newline
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
    out[offset++] = 0x0a; // keep operators from adjacent streams apart
  }
  return out;
}

function decodeAsciiHex(bytes: Uint8Array): Uint8Array {
  const out: number[] = [];
  let high = -1;
  for (const byte of bytes) {
    if (byte === 0x3e) break; // '>'
    let value = -1;
    if (byte >= 0x30 && byte <= 0x39) value = byte - 0x30;
    else if (byte >= 0x41 && byte <= 0x46) value = byte - 0x41 + 10;
    else if (byte >= 0x61 && byte <= 0x66) value = byte - 0x61 + 10;
    else continue;

    if (high < 0) high = value;
    else {
      out.push((high << 4) | value);
      high = -1;
    }
  }
  if (high >= 0) out.push(high << 4);
  return new Uint8Array(out);
}

/**
 * Converts CMYK samples to RGB.
 *
 * Naive inversion, not a colour-managed conversion: reflow shows figures inline at
 * a few hundred points wide, where an ICC-accurate transform is not worth the code.
 */
function cmykToRgb(samples: Uint8Array, pixelCount: number): Uint8Array {
  const rgb = new Uint8Array(pixelCount * 3);
  for (let i = 0; i < pixelCount; i++) {
    const c = samples[i * 4]! / 255;
    const m = samples[i * 4 + 1]! / 255;
    const y = samples[i * 4 + 2]! / 255;
    const k = samples[i * 4 + 3]! / 255;

    rgb[i * 3] = Math.round(255 * (1 - Math.min(1, c + k)));
    rgb[i * 3 + 1] = Math.round(255 * (1 - Math.min(1, m + k)));
    rgb[i * 3 + 2] = Math.round(255 * (1 - Math.min(1, y + k)));
  }
  return rgb;
}

function decodeAscii85(bytes: Uint8Array): Uint8Array {
  const out: number[] = [];
  let tuple: number[] = [];

  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i]!;
    if (byte === 0x7e) break; // '~' begins the EOD marker
    if (byte === 0x7a && tuple.length === 0) {
      out.push(0, 0, 0, 0); // 'z' shorthand for four zero bytes
      continue;
    }
    if (byte < 0x21 || byte > 0x75) continue; // whitespace and junk

    tuple.push(byte - 0x21);
    if (tuple.length === 5) {
      let value = 0;
      for (const digit of tuple) value = value * 85 + digit;
      out.push((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
      tuple = [];
    }
  }

  if (tuple.length > 1) {
    const count = tuple.length;
    for (let i = count; i < 5; i++) tuple.push(84); // pad with 'u'
    let value = 0;
    for (const digit of tuple) value = value * 85 + digit;
    const full = [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
    for (let i = 0; i < count - 1; i++) out.push(full[i]!);
  }

  return new Uint8Array(out);
}

/**
 * TextExtractionEngine implementation over the in-repo PDF parser.
 *
 * Replaces the stub adapter that threw `unsupported_operation` for everything,
 * which is why Reflow mode could never show content. Pipeline per page:
 *
 *   file bytes → PdfDocument (objects, pages, fonts, image XObjects)
 *              → content streams (FlateDecode via pure-JS inflate)
 *              → text + image operators → positioned runs & placements
 *              → vertical merge → page text with image markers in reading order
 *
 * Why in-repo rather than a dependency: no JS PDF text extractor works under
 * Hermes without either a native module or a DOM/worker shim, and adding a native
 * module changes the build. This is deterministic, testable off-device, and
 * confined behind the port — swapping in a native extractor later means editing
 * only src/pdf/textEngine.ts.
 *
 * CACHING. Document bytes are read and parsed ONCE per file URI and memoized, and
 * page text is memoized per index, so paging through a book never re-parses it.
 * Extracted bitmaps are written to the cache directory once and reused by URI.
 */
import type {
  ExtractedPageImage,
  ExtractedPageRange,
  ExtractedPageText,
  TextExtractionCapabilities,
  TextExtractionEngine,
  TextExtractionError,
  TextExtractionSource,
} from '@/core/ports/textExtraction';

import { extractPageOperations } from './pdfkit/contentText';
import { PdfDocument, PdfStructureError } from './pdfkit/document';
import { layoutPageContent } from './pdfkit/layout';

export const PDFKIT_TEXT_EXTRACTION_CAPABILITIES: TextExtractionCapabilities = {
  extractText: true,
  extractImages: true,
  /** Batch cap: keeps a single extraction call off the frame budget. */
  maxBatchPages: 8,
};

/** Reads a file:// URI into memory. Injected so tests can run off-device. */
export type PdfBytesReader = (uri: string) => Promise<Uint8Array>;

/**
 * Writes an extracted bitmap and returns its file:// URI. Injected for the same
 * reason as the reader — the default touches the device filesystem.
 */
export type ImageWriter = (
  fileName: string,
  bytes: Uint8Array,
) => Promise<string>;

/** Default reader built on expo-file-system's new API (ARCHITECTURE.md §0/R6). */
async function readFileBytes(uri: string): Promise<Uint8Array> {
  const { File } = await import('expo-file-system');
  const buffer = await new File(uri).arrayBuffer();
  return new Uint8Array(buffer);
}

/**
 * Default writer: caches bitmaps under <cache>/reflow-images/.
 *
 * The cache directory, not documents: these are derived artifacts that the OS may
 * reclaim and that re-extract on demand.
 */
async function writeImageFile(fileName: string, bytes: Uint8Array): Promise<string> {
  const { Directory, File, Paths } = await import('expo-file-system');

  const directory = new Directory(Paths.cache, 'reflow-images');
  if (!directory.exists) directory.create({ intermediates: true });

  const file = new File(directory, fileName);
  if (!file.exists) {
    file.create();
    file.write(bytes);
  }
  return file.uri;
}

function fail(code: TextExtractionError['code'], message: string): never {
  const error: TextExtractionError = { code, message };
  throw error;
}

/** Maps parser failures onto the port's normalized error codes. */
function toPortError(error: unknown): never {
  if (error instanceof PdfStructureError) {
    if (error.code === 'encrypted') fail('password_required', error.message);
    fail('invalid_document', error.message);
  }
  if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
    throw error; // already a TextExtractionError
  }
  const message = error instanceof Error ? error.message : 'Could not read this PDF.';
  fail('extraction_failed', message);
}

/** Stable per-(uri, page, resource) file name for a cached bitmap. */
function imageFileName(
  uri: string,
  pageIndex: number,
  resourceName: string,
  extension: string,
): string {
  // Cheap deterministic hash of the URI: enough to separate books in one folder,
  // and it keeps the file name short and filesystem-safe.
  let hash = 2166136261;
  for (let i = 0; i < uri.length; i++) {
    hash ^= uri.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const book = (hash >>> 0).toString(36);
  const safeResource = resourceName.replace(/[^A-Za-z0-9_-]/g, '');
  return `${book}-p${pageIndex}-${safeResource}.${extension}`;
}

interface PageResult {
  text: string;
  images: ExtractedPageImage[];
}

interface CachedDocument {
  document: PdfDocument;
  /** Page results memoized per index; extraction is the expensive part. */
  pages: Map<number, PageResult>;
}

export interface PdfKitTextExtractionOptions {
  /** Override the byte reader (tests inject a local reader). */
  readBytes?: PdfBytesReader;
  /** Override the image writer (tests inject an in-memory writer). */
  writeImage?: ImageWriter;
  /**
   * Extract embedded bitmaps. Defaults to true; set false to skip image work
   * entirely (text-only extraction is measurably cheaper).
   */
  extractImages?: boolean;
}

export function createPdfKitTextExtractionEngine(
  options: PdfKitTextExtractionOptions = {},
): TextExtractionEngine {
  const readBytes = options.readBytes ?? readFileBytes;
  const writeImage = options.writeImage ?? writeImageFile;
  const wantImages = options.extractImages ?? true;

  // One parsed document per URI. A reader session touches a single book, so this
  // holds at most a couple of entries in practice.
  const documents = new Map<string, CachedDocument>();
  // In-flight parses, so concurrent page requests share one parse.
  const pending = new Map<string, Promise<CachedDocument>>();

  async function open(source: TextExtractionSource): Promise<CachedDocument> {
    const cached = documents.get(source.uri);
    if (cached) return cached;

    const inFlight = pending.get(source.uri);
    if (inFlight) return inFlight;

    const parse = (async () => {
      try {
        const bytes = await readBytes(source.uri);
        const document = PdfDocument.parse(bytes);
        const entry: CachedDocument = { document, pages: new Map() };
        documents.set(source.uri, entry);
        return entry;
      } catch (error) {
        toPortError(error);
      } finally {
        pending.delete(source.uri);
      }
    })();

    pending.set(source.uri, parse);
    return parse;
  }

  async function pageResult(
    source: TextExtractionSource,
    pageIndex: number,
  ): Promise<PageResult> {
    const { document, pages } = await open(source);

    const memoized = pages.get(pageIndex);
    if (memoized !== undefined) return memoized;

    if (pageIndex < 0 || pageIndex >= document.pageCount) {
      fail('extraction_failed', `Page ${pageIndex + 1} is outside this document.`);
    }

    let result: PageResult = { text: '', images: [] };

    try {
      const page = document.getPageContent(pageIndex);
      if (page && page.content.length > 0) {
        const { runs, images } = extractPageOperations(page.content, page.fonts);
        const items = layoutPageContent(runs, wantImages ? images : []);

        const lines: string[] = [];
        const extracted: ExtractedPageImage[] = [];

        for (const item of items) {
          if (item.kind === 'text') {
            lines.push(item.text);
            continue;
          }

          const stream = page.imageResources.get(item.resourceName);
          if (!stream) continue;

          const decoded = document.decodeImage(stream);
          if (!decoded) continue; // unsupported format: skip rather than break

          // Ignore anything too small to be content — rules, bullets, logos.
          if (decoded.width < 32 || decoded.height < 32) continue;

          const extension = decoded.mimeType === 'image/jpeg' ? 'jpg' : 'png';
          const fileName = imageFileName(source.uri, pageIndex, item.resourceName, extension);

          try {
            const uri = await writeImage(fileName, decoded.bytes);
            // A marker on its own line: the parser turns it back into an image
            // block at exactly this point in the reading order.
            const marker = `\u0000IMG:${fileName}\u0000`;
            lines.push(marker);
            extracted.push({
              marker,
              uri,
              width: decoded.width,
              height: decoded.height,
            });
          } catch {
            // Failing to cache one bitmap must not lose the page's text.
          }
        }

        result = { text: lines.join('\n\n'), images: extracted };
      }
    } catch (error) {
      // A single unreadable page should not abort the book: report it as empty and
      // let the reflow layer's textless/partial handling take over.
      if (error instanceof PdfStructureError && error.code === 'encrypted') {
        toPortError(error);
      }
      result = { text: '', images: [] };
    }

    pages.set(pageIndex, result);
    return result;
  }

  function toExtracted(pageIndex: number, result: PageResult): ExtractedPageText {
    return result.images.length > 0
      ? { pageIndex, text: result.text, images: result.images }
      : { pageIndex, text: result.text };
  }

  return {
    capabilities: PDFKIT_TEXT_EXTRACTION_CAPABILITIES,

    async getPageCount(source: TextExtractionSource): Promise<number> {
      const { document } = await open(source);
      const count = document.pageCount;
      if (count === 0) {
        fail('invalid_document', 'This PDF reports no pages.');
      }
      return count;
    },

    async extractPageText(source: TextExtractionSource, pageIndex: number): Promise<string> {
      return (await pageResult(source, pageIndex)).text;
    },

    async extractPageRange(
      source: TextExtractionSource,
      startIndex: number,
      endIndex: number,
    ): Promise<ExtractedPageRange> {
      const { document } = await open(source);
      const total = document.pageCount;

      const start = Math.max(0, Math.min(startIndex, total));
      const end = Math.max(start, Math.min(endIndex, total));

      const pages: ExtractedPageText[] = [];
      for (let index = start; index < end; index++) {
        pages.push(toExtracted(index, await pageResult(source, index)));
      }

      return { startIndex: start, endIndex: end, pages };
    },
  };
}

/**
 * TextExtractionService — orchestrates text extraction, caching, and parsing.
 * Layer: services (ARCHITECTURE.md §3)
 * UI never touches engine/cache/parser directly; only this service.
 */
import type {
  TextExtractionEngine,
  ExtractedPageText,
  ExtractedPageRange,
  TextExtractionSource,
} from '@/core/ports';
import type { TextCacheRepository } from '@/data/repositories/textCacheRepository';
import { DomainError } from '@/core/errors';
import { parseExtractedText, type ParsedPage, type TextBlock } from '@/features/reader/textParser';

export interface TextExtractionServiceDeps {
  /** Engine abstraction — resolved once at app start (src/pdf/textEngine.ts) */
  engine: TextExtractionEngine;
  /** Cache repository for extracted page text */
  cache: TextCacheRepository;
}

export interface TextExtractionService {
  /** Extract text from a page (uses cache if available, falls back to engine) */
  getPageText(source: TextExtractionSource, page: number): Promise<ExtractedPageText>;
  /** Extract text from a page range (uses cache where available) */
  getPageRangeText(
    source: TextExtractionSource,
    startPage: number,
    endPage: number,
  ): Promise<ExtractedPageRange>;
  /** Get parsed, readable blocks for a page */
  getParsedPage(source: TextExtractionSource, page: number): Promise<ParsedPage>;
  /** Get parsed, readable blocks for a page range */
  getParsedPageRange(
    source: TextExtractionSource,
    startPage: number,
    endPage: number,
  ): Promise<ParsedPage[]>;
  /** Get flattened blocks for continuous reading (Reflow Reader) */
  getFlattenedBlocks(
    source: TextExtractionSource,
    startPage: number,
    endPage: number,
  ): Promise<TextBlock[]>;
  /** Invalidate cache for a specific page */
  invalidatePage(source: TextExtractionSource, page: number): Promise<void>;
  /** Invalidate all cached text for a book */
  invalidateBook(source: TextExtractionSource): Promise<void>;
  /** Get cache statistics for a book */
  getCacheStats(source: TextExtractionSource): Promise<{ cachedPages: number; totalPages: number }>;
}

/**
 * Converts a TextExtractionSource to bookId for cache operations
 */
function getBookIdFromSource(source: TextExtractionSource): string {
  // For now, we use the URI as the cache key. In practice, we might map to a book ID.
  return source.uri;
}

/**
 * Shapes an extracted page for the parser.
 *
 * `images` is omitted rather than set to undefined: the project builds with
 * `exactOptionalPropertyTypes`, so an explicit undefined is not assignable to an
 * optional property.
 */
function toParserInput(page: ExtractedPageText): {
  pageIndex: number;
  text: string;
  images?: { marker: string; uri: string; width: number; height: number }[];
} {
  return page.images && page.images.length > 0
    ? { pageIndex: page.pageIndex, text: page.text, images: page.images }
    : { pageIndex: page.pageIndex, text: page.text };
}

export function createTextExtractionService(
  deps: TextExtractionServiceDeps,
): TextExtractionService {
  const { engine, cache } = deps;

  return {
    async getPageText(source, page) {
      const bookId = getBookIdFromSource(source);

      // Check cache first
      const cached = await cache.getPage(bookId, page);
      if (cached) {
        return { pageIndex: page, text: cached.text };
      }

      // Not cached — extract from engine
      if (!engine.capabilities.extractText) {
        throw new DomainError('unknown', 'Text extraction not supported by current PDF engine');
      }

      const extracted = await engine.extractPageText(source, page);
      // Save to cache
      await cache.savePage(bookId, page, extracted);
      return { pageIndex: page, text: extracted };
    },

    async getPageRangeText(source, startPage, endPage) {
      // Delegated to the engine in one call rather than looped page-by-page: the
      // engine parses the document once and can batch, and the SQLite cache is
      // consulted first for the whole span. Looping here re-entered the service
      // per page, which is what made the first reflow batch slow.
      const bookId = getBookIdFromSource(source);

      const cachedPages = new Map<number, string>();
      for (let page = startPage; page <= endPage; page++) {
        const cached = await cache.getPage(bookId, page);
        if (cached) cachedPages.set(page, cached.text);
      }

      const results: ExtractedPageText[] = [];
      const missing: number[] = [];
      for (let page = startPage; page <= endPage; page++) {
        if (!cachedPages.has(page)) missing.push(page);
      }

      // Images are not persisted in the text cache, so any page whose images are
      // needed must come from the engine. Cached text is still used for pages the
      // engine is not asked about.
      if (missing.length > 0) {
        if (!engine.capabilities.extractText) {
          throw new DomainError('unknown', 'Text extraction not supported by current PDF engine');
        }

        // One engine call spanning the missing pages (half-open at the port).
        const first = missing[0]!;
        const last = missing[missing.length - 1]!;
        const range = await engine.extractPageRange(source, first, last + 1);

        for (const page of range.pages) {
          await cache.savePage(bookId, page.pageIndex, page.text);
          cachedPages.set(page.pageIndex, page.text);
        }

        // Return engine results (with images) for extracted pages, cache for the rest.
        const engineByIndex = new Map(range.pages.map((page) => [page.pageIndex, page]));
        for (let page = startPage; page <= endPage; page++) {
          const fromEngine = engineByIndex.get(page);
          if (fromEngine) {
            results.push(fromEngine);
            continue;
          }
          results.push({ pageIndex: page, text: cachedPages.get(page) ?? '' });
        }

        return { startIndex: startPage, endIndex: endPage + 1, pages: results };
      }

      for (let page = startPage; page <= endPage; page++) {
        results.push({ pageIndex: page, text: cachedPages.get(page) ?? '' });
      }

      return { startIndex: startPage, endIndex: endPage + 1, pages: results };
    },

    async getParsedPage(source, page) {
      const extracted = await this.getPageText(source, page);
      const parsed = parseExtractedText([toParserInput(extracted)]);
      return parsed[0] ?? { pageIndex: page, blocks: [] };
    },

    async getParsedPageRange(source, startPage, endPage) {
      const range = await this.getPageRangeText(source, startPage, endPage);
      return parseExtractedText(range.pages.map(toParserInput));
    },

    async getFlattenedBlocks(source, startPage, endPage) {
      const pages = await this.getParsedPageRange(source, startPage, endPage);
      return pages.flatMap((page) => page.blocks);
    },

    async invalidatePage(source, page) {
      const bookId = getBookIdFromSource(source);
      await cache.deletePage(bookId, page);
    },

    async invalidateBook(source) {
      const bookId = getBookIdFromSource(source);
      await cache.deleteForBook(bookId);
    },

    async getCacheStats(source) {
      const bookId = getBookIdFromSource(source);
      const totalPages = await engine.getPageCount(source);
      const cached = await cache.listForBook(bookId);
      return { cachedPages: cached.length, totalPages };
    },
  };
}

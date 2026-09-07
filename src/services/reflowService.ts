/**
 * ReflowService — generates, persists and serves whole-book reflow documents.
 * Layer: services (ARCHITECTURE.md §3).
 *
 * The UI asks for a book's reflow document; this decides whether a stored one can
 * be reused or the book must be processed. It is the only place that knows the
 * generation cost exists.
 *
 * GENERATION IS ONCE PER BOOK
 * ---------------------------
 * `getDocument` is a read. `generate` is the expensive path, and it is only reached
 * when no usable document is stored — meaning never on a mode switch, a remount, or
 * a re-render. Concurrent callers share one in-flight generation rather than
 * starting a second pass over the same PDF.
 *
 * STALENESS
 * ---------
 * A stored document is used only when its format version matches the current
 * pipeline AND its source fingerprint matches the book's current file. Either
 * mismatch regenerates, so a replaced PDF can never render the previous book's text.
 */
import type { Book } from '@/core/entities/book';
import {
  buildPageStarts,
  isReflowDocumentUsable,
  reflowSourceFingerprint,
  type ReflowDocument,
  type TextBlock,
} from '@/core/entities/reflowDocument';
import { DomainError } from '@/core/errors';
import type { TextExtractionSource } from '@/core/ports/textExtraction';
import type { NewReflowDocument, ReflowDocumentRepository } from '@/data/repositories/reflowDocumentRepository';

import type { TextExtractionService } from './textExtractionService';

/** Progress while the whole book is processed. */
export interface ReflowProgress {
  /** Pages processed so far. */
  processedPages: number;
  /** Total pages to process. */
  totalPages: number;
  /** Blocks produced so far — lets the UI show something real, not a fake bar. */
  blockCount: number;
}

export interface ReflowGenerationOptions {
  /** Called after each batch. Never called after `signal` aborts. */
  onProgress?: (progress: ReflowProgress) => void;
  /** Cancels generation — the reader aborts when the user leaves. */
  signal?: AbortSignal;
}

export interface ReflowServiceDeps {
  textExtraction: TextExtractionService;
  repository: ReflowDocumentRepository;
  /** Page count of the source, when the caller already knows it. */
  getPageCount: (source: TextExtractionSource) => Promise<number>;
  /**
   * Pages per extraction batch. Small enough that the JS thread yields between
   * batches, so generation never blocks scrolling.
   */
  batchSize?: number;
}

export interface ReflowService {
  /** Stored document for a book if one is usable, else null. Cheap. */
  getStored(book: Book): Promise<ReflowDocument | null>;
  /**
   * The book's reflow document, generating and persisting it if needed.
   *
   * Safe to call from a mode switch: it is a read when a usable document exists.
   */
  getDocument(book: Book, options?: ReflowGenerationOptions): Promise<ReflowDocument>;
  /** Forces regeneration, discarding any stored document. */
  regenerate(book: Book, options?: ReflowGenerationOptions): Promise<ReflowDocument>;
  /** Drops a book's document (used when a book is deleted or replaced). */
  invalidate(bookId: string): Promise<void>;
  /** Drops every document from an older pipeline version. */
  pruneStale(): Promise<number>;
}

const DEFAULT_BATCH_SIZE = 8;

/** Yields to the event loop so extraction cannot monopolize the JS thread. */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function abortError(): DomainError {
  return new DomainError('unknown', 'Reflow generation was cancelled.');
}

export function createReflowService(deps: ReflowServiceDeps): ReflowService {
  const { textExtraction, repository, getPageCount } = deps;
  const batchSize = deps.batchSize ?? DEFAULT_BATCH_SIZE;

  /** In-flight generations by book id, so two callers never duplicate the work. */
  const inFlight = new Map<string, Promise<ReflowDocument>>();

  function sourceFor(book: Book): TextExtractionSource {
    return { kind: 'file', uri: book.fileUri };
  }

  function fingerprintFor(book: Book, pageCount: number | null): string {
    return reflowSourceFingerprint({
      fileUri: book.fileUri,
      fileSize: book.fileSize,
      pageCount,
    });
  }

  async function loadStored(book: Book): Promise<ReflowDocument | null> {
    // The fingerprint includes page count, which the book row may not have yet.
    // Fall back to a full read + validity check so a book whose pageCount was
    // filled in after generation is not needlessly regenerated.
    const stored = await repository.findByBook(book.id);
    if (!stored) return null;

    const expected = fingerprintFor(book, book.pageCount ?? stored.pageCount);
    return isReflowDocumentUsable(stored, { bookId: book.id, sourceFingerprint: expected })
      ? stored
      : null;
  }

  async function generate(
    book: Book,
    options: ReflowGenerationOptions,
  ): Promise<ReflowDocument> {
    const { onProgress, signal } = options;
    const source = sourceFor(book);

    if (signal?.aborted) throw abortError();

    const pageCount = await getPageCount(source);
    if (signal?.aborted) throw abortError();

    const blocks: TextBlock[] = [];

    // Batched, with a yield between batches: a 500-page book must not freeze the
    // UI, and the caller can render progress as it goes.
    for (let start = 0; start < pageCount; start += batchSize) {
      if (signal?.aborted) throw abortError();

      const end = Math.min(start + batchSize - 1, pageCount - 1);
      const pages = await textExtraction.getParsedPageRange(source, start, end);

      for (const page of pages) {
        blocks.push(...page.blocks);
      }

      if (signal?.aborted) throw abortError();

      onProgress?.({
        processedPages: end + 1,
        totalPages: pageCount,
        blockCount: blocks.length,
      });

      await yieldToEventLoop();
    }

    if (signal?.aborted) throw abortError();

    const input: NewReflowDocument = {
      bookId: book.id,
      sourceFingerprint: fingerprintFor(book, pageCount),
      pageCount,
      blocks,
    };

    // Persisted before returning, so the next open is a read even if the reader
    // is closed immediately after generation finishes.
    return repository.save(input);
  }

  function generateOnce(book: Book, options: ReflowGenerationOptions): Promise<ReflowDocument> {
    const existing = inFlight.get(book.id);
    if (existing) return existing;

    const promise = generate(book, options).finally(() => {
      inFlight.delete(book.id);
    });
    inFlight.set(book.id, promise);
    return promise;
  }

  return {
    getStored: loadStored,

    async getDocument(book, options = {}) {
      const stored = await loadStored(book);
      if (stored) return stored;
      return generateOnce(book, options);
    },

    async regenerate(book, options = {}) {
      await repository.deleteForBook(book.id);
      return generateOnce(book, options);
    },

    async invalidate(bookId) {
      await repository.deleteForBook(bookId);
    },

    pruneStale() {
      return repository.deleteStaleVersions();
    },
  };
}

/**
 * Rebuilds the derived page index for a document assembled in memory.
 *
 * Exposed for callers that construct a document without going through the
 * repository (tests, and any future import path).
 */
export function withPageStarts(
  document: Omit<ReflowDocument, 'pageStarts'>,
): ReflowDocument {
  return { ...document, pageStarts: buildPageStarts(document.blocks, document.pageCount) };
}

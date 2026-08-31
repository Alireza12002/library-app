/**
 * TextExtractionEngine port — ARCHITECTURE.md §6.
 * Abstraction for native text extraction from PDF documents.
 * Concrete adapters live in src/pdf/adapters/text/ and are resolved via src/pdf/textEngine.ts.
 *
 * PAGE NUMBERING: 0-based domain page indexes everywhere above this port.
 * Adapters convert to/from native numbering at the boundary.
 */
export interface TextExtractionSource {
  kind: 'file';
  /** Absolute file:// URI of a PDF inside app storage. */
  uri: string;
}

export interface TextExtractionCapabilities {
  /** Can the engine extract text from pages? */
  extractText: boolean;
  /** Maximum pages that can be extracted in one batch (for performance). */
  maxBatchPages?: number;
}

export interface ExtractedPageText {
  /** 0-based page index */
  pageIndex: number;
  /** Raw text as extracted from the page */
  text: string;
}

export interface ExtractedPageRange {
  /** 0-based start page index (inclusive) */
  startIndex: number;
  /** 0-based end page index (exclusive) */
  endIndex: number;
  /** Extracted pages in order */
  pages: ExtractedPageText[];
}

export type TextExtractionErrorCode =
  | 'invalid_uri'
  | 'invalid_document'
  | 'password_required'
  | 'password_incorrect'
  | 'extraction_failed'
  | 'unsupported_operation'
  | 'unknown';

export interface TextExtractionError {
  code: TextExtractionErrorCode;
  message: string;
}

export interface TextExtractionEngine {
  /** Engine capabilities */
  capabilities: TextExtractionCapabilities;
  /** Get total page count without extracting text */
  getPageCount(source: TextExtractionSource): Promise<number>;
  /** Extract text from a single page */
  extractPageText(source: TextExtractionSource, pageIndex: number): Promise<string>;
  /** Extract text from a range of pages [startIndex, endIndex) */
  extractPageRange(
    source: TextExtractionSource,
    startIndex: number,
    endIndex: number,
  ): Promise<ExtractedPageRange>;
}

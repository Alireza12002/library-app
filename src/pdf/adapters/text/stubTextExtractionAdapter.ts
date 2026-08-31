/**
 * TextExtractionEngine port implementation — STUB ADAPTER.
 *
 * react-native-pdf 7.0.5 does NOT expose programmatic text extraction APIs.
 * It only supports UI-based text selection (onTextSelectionChange), which is
 * insufficient for Reflow Reader's batch extraction needs.
 *
 * This stub throws 'unsupported_operation' for all extraction methods.
 * When a proper text extraction library (e.g., PDFium via expo module) is
 * integrated, replace this file with a real implementation.
 *
 * PAGE NUMBERING: 0-based domain page indexes at the port boundary.
 */
import type {
  ExtractedPageRange,
  TextExtractionCapabilities,
  TextExtractionEngine,
  TextExtractionError,
  TextExtractionSource,
} from '@/core/ports/textExtraction';

export const STUB_TEXT_EXTRACTION_CAPABILITIES: TextExtractionCapabilities = {
  extractText: false,
};

function unsupported(op: string): never {
  const error: TextExtractionError = {
    code: 'unsupported_operation',
    message: `Text extraction ${op} not supported by current engine. Install a text extraction library (e.g., PDFium) to enable Reflow Reader.`,
  };
  throw error;
}

export function createStubTextExtractionEngine(): TextExtractionEngine {
  return {
    capabilities: STUB_TEXT_EXTRACTION_CAPABILITIES,

    async getPageCount(_source: TextExtractionSource): Promise<number> {
      return unsupported('getPageCount');
    },

    async extractPageText(_source: TextExtractionSource, _pageIndex: number): Promise<string> {
      return unsupported('extractPageText');
    },

    async extractPageRange(
      _source: TextExtractionSource,
      _startIndex: number,
      _endIndex: number,
    ): Promise<ExtractedPageRange> {
      return unsupported('extractPageRange');
    },
  };
}

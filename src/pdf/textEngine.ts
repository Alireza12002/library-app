/**
 * Single resolution point for the app's TextExtractionEngine (ARCHITECTURE.md §2, src/pdf).
 * Swapping libraries later means editing ONLY this file plus adding an adapter.
 *
 * Currently the in-repo parser (src/pdf/adapters/text/pdfkit): it is the only
 * option that runs under Hermes without adding a native module. The previous stub
 * threw `unsupported_operation` for everything, which is why Reflow mode had
 * nothing to render.
 */
import type { TextExtractionEngine } from '@/core/ports/textExtraction';

import { createPdfKitTextExtractionEngine } from './adapters/text/pdfKitTextExtractionAdapter';

let cached: TextExtractionEngine | null = null;

export function getTextExtractionEngine(): TextExtractionEngine {
  cached ??= createPdfKitTextExtractionEngine();
  return cached;
}

/** Test seam: drops the memoized engine so a fresh one is built. */
export function resetTextExtractionEngineForTesting(): void {
  cached = null;
}

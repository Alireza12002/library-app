/**
 * Single resolution point for the app's TextExtractionEngine (ARCHITECTURE.md §2, src/pdf).
 * Swapping libraries later means editing ONLY this file plus adding an adapter.
 */
import type { TextExtractionEngine } from '@/core/ports/textExtraction';

import { createStubTextExtractionEngine } from './adapters/text/stubTextExtractionAdapter';

let cached: TextExtractionEngine | null = null;

export function getTextExtractionEngine(): TextExtractionEngine {
  cached ??= createStubTextExtractionEngine();
  return cached;
}

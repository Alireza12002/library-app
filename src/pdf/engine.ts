/**
 * Single resolution point for the app's PDF engine (ARCHITECTURE.md §2, src/pdf).
 * Swapping libraries later means editing ONLY this file plus adding an adapter.
 */
import type { PdfEngine } from '@/core/ports/pdfEngine';

import { createExpoPdfAdapter } from './adapters/reactNativePdfAdapter';

let cached: PdfEngine | null = null;

export function getPdfEngine(): PdfEngine {
  cached ??= createExpoPdfAdapter();
  return cached;
}

/**
 * PdfEngine port implementation backed by @kishannareshpal/expo-pdf.
 *
 * Verified against expo-pdf 0.3.2 source (docs/ARCHITECTURE.md §0):
 * - no imperative jump-to-page and no initial-page prop →
 *   capabilities.jumpToInitialPage stays FALSE until the Phase 4 spike lands;
 * - no text extraction → capabilities.textExtraction is FALSE until Phase 7.
 * The rest of the app must rely only on the PdfEngine contract.
 */
import type { ComponentType } from 'react';

import type { PdfEngine, PdfEngineCapabilities, PdfEngineViewProps } from '@/core/ports';

export const EXPO_PDF_CAPABILITIES: PdfEngineCapabilities = {
  jumpToInitialPage: false,
  programmaticNavigation: false,
  pinchZoom: false,
  textExtraction: false,
  invertPages: false,
  pageGap: false,
  fitModes: [],
};

/**
 * Maps our engine-neutral view props onto <PdfView />.
 * Implemented as a plain component (no JSX in core-adjacent adapter files);
 * the real native view is wired when the reader feature mounts it in Phase 3.
 */
export function createExpoPdfEngine(): PdfEngine {
  const ViewComponent: ComponentType<PdfEngineViewProps> = () => null;

  return {
    ViewComponent,
    capabilities: EXPO_PDF_CAPABILITIES,
  };
}

/**
 * PdfEngine port — ARCHITECTURE.md §6.
 * The ONLY contract through which the app touches PDF technology.
 * Concrete adapters live in src/pdf/adapters/ and are resolved via src/pdf/engine.ts.
 */
import type { ComponentType } from 'react';

/** Where the document bytes come from. v1 is local-only. */
export interface PdfSource {
  kind: 'file';
  /** Absolute file:// URI of a PDF inside app storage. */
  uri: string;
}

export interface PdfPagePosition {
  /** 0-based page index, consistent with the domain (ReadingProgress). */
  pageIndex: number;
  pageCount: number;
}

export interface PdfLoadInfo {
  pageCount: number;
}

/** Normalized error codes — adapters must map native codes onto these. */
export type PdfEngineErrorCode =
  | 'invalid_uri'
  | 'invalid_document'
  | 'password_required'
  | 'password_incorrect'
  | 'unknown';

export interface PdfEngineError {
  code: PdfEngineErrorCode;
  message: string;
}

/**
 * Props of the engine-provided view component.
 * Adapters translate these to the underlying library's props; screens never
 * see library-specific prop names.
 */
export interface PdfEngineViewProps {
  source: PdfSource;
  /**
   * Position to open the document at. OPTIONAL AND CAPABILITY-GATED:
   * engines that cannot jump to a page may ignore it (see
   * `PdfEngineCapabilities.jumpToInitialPage`). Known gap in
   * @kishannareshpal/expo-pdf 0.3.2 — Phase 4 spike (ARCHITECTURE.md R1).
   */
  initialPosition?: { pageIndex: number };
  horizontal?: boolean;
  pagingEnabled?: boolean;
  fitMode?: 'width' | 'height' | 'both';
  inverted?: boolean;
  doubleTapZoom?: boolean;
  onLoad?: (info: PdfLoadInfo) => void;
  onPageChange?: (position: PdfPagePosition) => void;
  onError?: (error: PdfEngineError) => void;
}

/** Thrown by capability accessors when an engine lacks a feature. */
export class UnsupportedCapabilityError extends Error {
  constructor(capability: string) {
    super(`PDF engine does not support: ${capability}`);
    this.name = 'UnsupportedCapabilityError';
  }
}

export interface PdfEngineCapabilities {
  /** Can the engine open a document at a given page? */
  jumpToInitialPage: boolean;
  /** Can the engine extract raw text from pages? */
  textExtraction: boolean;
}

export interface PdfEngine {
  /** Native view component rendered by the reader screen. */
  ViewComponent: ComponentType<PdfEngineViewProps>;
  capabilities: PdfEngineCapabilities;
}

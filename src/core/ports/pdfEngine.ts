/**
 * PdfEngine port — ARCHITECTURE.md §6.
 * The ONLY contract through which the app touches PDF technology.
 * Concrete adapters live in src/pdf/adapters/ and are resolved via src/pdf/engine.ts.
 *
 * PAGE NUMBERING: domain page indexes are 0-BASED (Book.lastPage, onPageChange).
 * `PdfEngineController.setPage` is 1-BASED to match renderer conventions; the
 * adapter converts at this boundary. Screens never do arithmetic.
 */
import type { ComponentType } from 'react';

/** Where the document bytes come from. v1 is local-only. */
export interface PdfSource {
  kind: 'file';
  /** Absolute file:// URI of a PDF inside app storage. */
  uri: string;
}

export interface PdfPagePosition {
  /** 0-based page index, consistent with the domain (Book.lastPage). */
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
  | 'file_missing'
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
   * Position to open the document at (0-based). Honored only when
   * `capabilities.jumpToInitialPage` is true; otherwise ignored.
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
  /**
   * Adapter-only escape hatch: the host's mutable box that receives the
   * imperative navigation handle. Screens pass it through opaquely; it is NOT
   * part of the engine-neutral surface and adapters may ignore it.
   */
  controllerBox?: { current: PdfEngineController | null };
}

/**
 * Imperative handle for engines with programmatic navigation
 * (`capabilities.programmaticNavigation === true`).
 *
 * PAGE CONVENTION: takes a 0-BASED domain page index, exactly like everything
 * else above the port. Any conversion to renderer-native numbering happens
 * INSIDE the adapter — never in a screen.
 */
export interface PdfEngineController {
  setPage(pageIndex: number): void;
}

export interface PdfEngineCapabilities {
  /** Can the engine open a document directly at a given page? */
  jumpToInitialPage: boolean;
  /** Can the caller navigate to an arbitrary page after mount? */
  programmaticNavigation: boolean;
  /** Does the engine provide native pinch-to-zoom? */
  pinchZoom: boolean;
  /** Can the engine extract raw text from pages? */
  textExtraction: boolean;
}

export interface PdfEngine {
  /** Native view component rendered by the reader screen. */
  ViewComponent: ComponentType<PdfEngineViewProps>;
  capabilities: PdfEngineCapabilities;
}

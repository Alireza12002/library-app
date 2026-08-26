/**
 * Core ports (ARCHITECTURE.md §6) — the ONLY contracts through which the app
 * reaches PDF technology, storage and the document picker. Concrete adapters
 * live in src/pdf/adapters and src/files; swapping a library means writing a
 * new adapter, nothing else changes.
 */
import type { DomainError } from '@/core/errors';

// ---------------------------------------------------------------------------
// PDF engine
// ---------------------------------------------------------------------------

export interface PdfSource {
  kind: 'file';
  uri: string;
}

export interface PdfPagePosition {
  pageIndex: number;
  pageCount: number;
}

export interface PdfEngineError {
  code:
    | DomainErrorCode
    | 'invalid_uri'
    | 'invalid_document'
    | 'password_required'
    | 'password_incorrect';
  message: string;
}

type DomainErrorCode = 'unsupported_capability';

export interface PdfEngineViewProps {
  source: PdfSource;
  /**
   * Requested landing position when the view mounts.
   * Engines that cannot honor it report so via PdfEngineCapabilities.
   */
  initialPosition?: { pageIndex: number };
  horizontal?: boolean;
  pagingEnabled?: boolean;
  fitMode?: 'width' | 'height' | 'both';
  inverted?: boolean;
  doubleTapZoom?: boolean;
  onLoad?: (info: { pageCount: number }) => void;
  onPageChange?: (position: PdfPagePosition) => void;
  onError?: (error: PdfEngineError) => void;
}

export interface PdfEngineCapabilities {
  jumpToInitialPage: boolean;
  textExtraction: boolean;
}

export interface PdfEngine {
  /** Native view component mapped onto the underlying library. */
  ViewComponent: React.ComponentType<PdfEngineViewProps>;
  capabilities: PdfEngineCapabilities;
  /** Optional capability — present only when capabilities.textExtraction. */
  extractPageText?(uri: string, pageIndex: number): Promise<string>;
}

// ---------------------------------------------------------------------------
// File storage
// ---------------------------------------------------------------------------

export interface StoragePort {
  /** Copies a picked document into the private library dir; returns its file:// URI. */
  copyIntoLibrary(sourceUri: string, fileName: string): Promise<string>;
  /** Deletes a stored book file. Resolves false if it was already gone. */
  deleteStoredFile(storedPath: string): Promise<boolean>;
  /** True if the file still exists on disk (used before opening a book). */
  exists(storedPath: string): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Document picker
// ---------------------------------------------------------------------------

export interface PickedDocument {
  uri: string;
  name: string;
  sizeBytes: number | null;
}

export interface DocumentPickerPort {
  /** Opens the system picker filtered to PDFs; null when the user cancels. */
  pickPdf(): Promise<PickedDocument | null>;
}

// Convenience re-export so ports can be referenced without importing errors.ts everywhere.
export type { DomainError };

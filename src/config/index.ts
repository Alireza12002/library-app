/**
 * Central runtime constants (ARCHITECTURE.md §2, src/config).
 * Feature phases extend this file; no imports from other layers.
 */

/** Debounce window for persisting reading progress on page change (ms). */
export const PROGRESS_DEBOUNCE_MS = 800;

/** Hard upper bound for a single imported PDF (bytes). 300 MB. */
export const MAX_IMPORT_BYTES = 300 * 1024 * 1024;

/** Name of the app-private directory that holds imported PDFs. */
export const LIBRARY_DIR_NAME = 'library';

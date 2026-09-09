/**
 * Central runtime constants (ARCHITECTURE.md §2, src/config).
 * Feature phases extend this file; no imports from other layers.
 */

/** Debounce window for persisting reading progress on page change (ms). */
export const PROGRESS_DEBOUNCE_MS = 800;

/**
 * Minimum interval between persisted Reflow position writes (ms).
 *
 * Reflow reports the visible block on every scroll frame; this throttles the
 * storage writes to at most one per interval (leading + trailing), never one
 * per frame. A trailing write flushes the final position after scrolling stops.
 */
export const REFLOW_PROGRESS_MIN_INTERVAL_MS = 1500;

/** Hard upper bound for a single imported PDF (bytes). 300 MB. */
export const MAX_IMPORT_BYTES = 300 * 1024 * 1024;

/** Name of the app-private directory that holds imported PDFs. */
export const LIBRARY_DIR_NAME = 'library';

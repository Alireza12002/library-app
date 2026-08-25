/**
 * App-wide constants — ARCHITECTURE.md §2 (src/config).
 * Values here are referenced by services in later phases.
 */

/** Debounce window for persisting reading progress while pages turn. */
export const PROGRESS_DEBOUNCE_MS = 1_500;

/** Hard cap for imported PDFs (200 MB) — guards against accidental huge picks. */
export const MAX_IMPORT_BYTES = 200 * 1024 * 1024;

/** Name of the app-private directory that holds imported PDFs. */
export const LIBRARY_DIR_NAME = 'library';

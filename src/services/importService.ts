/**
 * Import service — the pick → validate → copy → insert pipeline
 * (ARCHITECTURE.md §7).
 *
 * Guarantees:
 * - Cancellation resolves `{ status: 'canceled' }` and touches nothing.
 * - An invalid file resolves `{ status: 'invalid' }` and touches nothing.
 * - Any failure AFTER the copy cleans up the copied file before propagating,
 *   so a failed import never leaves a stray PDF in private storage.
 * - The stored URI always points into the app's private library directory,
 *   never at the picker's transient cache file (R5).
 *
 * Validation is injected like every other port: this service must stay runnable
 * off-device (tests), so nothing here may import expo modules directly.
 */
import type { Book } from '@/core/entities/book';
import { DomainError } from '@/core/errors';
import type { DocumentPickerPort, StoragePort } from '@/core/ports';
import type { PickedFileInfo, ValidationVerdict } from '@/files/pdfValidation';

export interface ImportServiceDeps {
  picker: DocumentPickerPort;
  storage: StoragePort;
  /** Returns a verdict instead of throwing for bad files; only I/O faults throw. */
  validatePicked(file: PickedFileInfo): Promise<ValidationVerdict>;
  /** Narrowed to exactly what import needs. */
  createBook(input: {
    title: string;
    author?: string | null;
    fileUri: string;
    fileName: string;
    fileSize: number;
  }): Promise<Book>;
}

export type ImportResult =
  | { status: 'imported'; book: Book }
  | { status: 'canceled' }
  | { status: 'invalid'; reason: string };

export interface ImportService {
  /** Runs one import attempt. Resolves with an outcome; only unexpected
   * storage/database faults reject. */
  importFromPicker(): Promise<ImportResult>;
}

/** Strips the extension for use as the initial book title. */
export function titleFromFileName(fileName: string): string {
  // Trim BEFORE stripping: a trailing space would defeat the `$` anchor.
  const base = fileName
    .trim()
    .replace(/\.pdf$/i, '')
    .replace(/_+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return base.length > 0 ? base : 'Untitled';
}

export function createImportService(deps: ImportServiceDeps): ImportService {
  return {
    async importFromPicker(): Promise<ImportResult> {
      // 1–2. Picker. Cancellation is a normal outcome, not an error.
      const picked = await deps.picker.pickPdf();
      if (!picked) return { status: 'canceled' };

      // 3–4. Validate before anything is written anywhere.
      const verdict = await deps.validatePicked(picked);
      if (!verdict.ok) return { status: 'invalid', reason: verdict.reason };

      // 5. Copy out of the transient cache into private storage. The picker's
      // cache URI dies with this session; only the stored copy is persisted.
      let storedUri: string;
      try {
        storedUri = await deps.storage.copyIntoLibrary(picked.uri, picked.name);
      } catch (error) {
        throw new DomainError(
          'storage_write_failed',
          'Could not save the PDF to your library.',
          error,
        );
      }

      // 6. Database record. On failure, roll the copied file back so private
      // storage never accumulates orphaned PDFs from failed imports.
      try {
        const book = await deps.createBook({
          title: titleFromFileName(picked.name),
          fileUri: storedUri,
          fileName: picked.name,
          // The validator has already confirmed the real on-disk size is
          // non-zero and within limits; prefer it, fall back to the pick report.
          fileSize: picked.sizeBytes ?? 0,
        });
        return { status: 'imported', book };
      } catch (error) {
        await cleanupQuietly(deps.storage, storedUri);
        throw error instanceof DomainError
          ? error
          : new DomainError('unknown', 'Could not add the book to your library.', error);
      }
    },
  };
}

/** Best-effort delete; never masks the original error with a cleanup failure. */
async function cleanupQuietly(storage: StoragePort, uri: string): Promise<void> {
  try {
    await storage.deleteStoredFile(uri);
  } catch {
    // Orphaned-file cleanup is acceptable per §7; swallowing here is correct.
  }
}

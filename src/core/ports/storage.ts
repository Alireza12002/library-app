/**
 * File storage port — ARCHITECTURE.md §6.
 * The ONLY contract through which the app touches file storage.
 * Concrete adapters live in src/files/.
 */
export interface StoragePort {
  /** Copies a picked document into the private library dir; returns its file:// URI. */
  copyIntoLibrary(sourceUri: string, fileName: string): Promise<string>;
  /** Deletes a stored book file. Resolves false if it was already gone. */
  deleteStoredFile(storedPath: string): Promise<boolean>;
  /** True if the file still exists on disk (used before opening a book). */
  exists(storedPath: string): Promise<boolean>;
}

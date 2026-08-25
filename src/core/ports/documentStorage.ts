/**
 * Storage port — ARCHITECTURE.md §3/§6.
 * Implemented by src/files/storage.ts; faked in service tests.
 *
 * All paths are absolute file:// URIs inside app-private storage so the
 * domain never depends on Android SAF specifics.
 */

export interface StoredDocumentInfo {
  /** Absolute file:// URI where the copy now lives. */
  storedPath: string;
  fileSizeBytes: number;
}

export interface DocumentStoragePort {
  /**
   * Copy a picked document into the app's private library directory.
   * Must be called during the picker session (SAF grants are transient).
   * Implementations should clean up partial artifacts on failure.
   */
  importDocument(sourceUri: string, suggestedName: string): Promise<StoredDocumentInfo>;
  /** Delete a stored document. Resolves true if something was deleted. */
  deleteDocument(storedPath: string): Promise<boolean>;
  /** True if the file exists at the given path. */
  exists(storedPath: string): Promise<boolean>;
}

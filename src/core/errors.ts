/**
 * Domain error taxonomy (ARCHITECTURE.md §1, core layer).
 * Pure TypeScript — no React Native / Expo imports allowed here
 * (enforced by eslint.config.js).
 */

export type ErrorCode =
  | 'import_validation_failed'
  | 'file_too_large'
  | 'book_not_found'
  | 'storage_write_failed'
  | 'pdf_invalid_document'
  | 'pdf_password_required'
  | 'pdf_password_incorrect'
  | 'unsupported_capability'
  | 'bookmark_not_found'
  | 'unknown';

export class DomainError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message?: string, cause?: unknown) {
    super(message ?? code, cause !== undefined ? { cause } : undefined);
    this.name = 'DomainError';
    this.code = code;
  }
}

import { DomainError, type ErrorCode } from '@/core/errors';
import type {
  DocumentPickerPort,
  PdfEngine,
  PdfEngineViewProps,
  StoragePort,
} from '@/core/ports';

// ---------------------------------------------------------------------------
// Test doubles used across service unit tests (Phase 1+).
// Kept in core so both tests and future phases share one source of truth.
// ---------------------------------------------------------------------------

export const aUuid = (n = 0): string =>
  '00000000-0000-4000-8000-' + String(n).padStart(12, '0');

export class FakeStorage implements StoragePort {
  readonly files = new Map<string, string>();

  async copyIntoLibrary(sourceUri: string, fileName: string): Promise<string> {
    const storedPath = `file:///fake-library/${aUuid(this.files.size)}.pdf`;
    this.files.set(storedPath, sourceUri);
    return storedPath;
  }

  async deleteStoredFile(storedPath: string): Promise<boolean> {
    return this.files.delete(storedPath);
  }

  async exists(storedPath: string): Promise<boolean> {
    return this.files.has(storedPath);
  }
}

export class FakePicker implements DocumentPickerPort {
  next: PickedDocumentResult | null | Error = null;
  calls = 0;

  async pickPdf(): Promise<PickedDocumentResult | null> {
    this.calls += 1;
    if (this.next instanceof Error) throw this.next;
    return this.next;
  }
}

type PickedDocumentResult = import('@/core/ports').PickedDocument;

export function makeFakePdfEngine(
  overrides?: Partial<PdfEngine>,
): PdfEngine {
  const ViewComponent =
    (_props: PdfEngineViewProps): null =>
    null;

  return {
    ViewComponent,
    capabilities: { jumpToInitialPage: true, textExtraction: true },
    extractPageText: async () => '',
    ...overrides,
  };
}

export const expectDomainError = async (
  promise: Promise<unknown>,
  code: ErrorCode,
): Promise<void> => {
  try {
    await promise;
  } catch (e) {
    if (e instanceof DomainError && e.code === code) return;
    throw new Error(`expected DomainError(${code}), got ${String(e)}`);
  }
  throw new Error(`expected DomainError(${code}), but promise resolved`);
};

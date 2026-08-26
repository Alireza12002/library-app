/**
 * Import service behaviour — the pick → validate → copy → insert pipeline.
 * Validation is injected, so the whole pipeline runs here with no filesystem.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Book, NewBook } from '@/core/entities/book';
import { DomainError } from '@/core/errors';
import type { DocumentPickerPort, PickedDocument, StoragePort } from '@/core/ports';
import type { PickedFileInfo, ValidationVerdict } from '@/files/pdfValidation';
import { createImportService, titleFromFileName } from '@/services/importService';

// ---------------------------------------------------------------------------
// Doubles
// ---------------------------------------------------------------------------

function makeBook(input: NewBook): Book {
  return {
    id: 'generated-id',
    title: input.title,
    author: input.author ?? null,
    fileUri: input.fileUri,
    fileName: input.fileName,
    fileSize: input.fileSize,
    pageCount: null,
    lastPage: 0,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    lastOpenedAt: null,
  };
}

class FakePicker implements DocumentPickerPort {
  next: PickedDocument | null | Error = null;
  calls = 0;

  async pickPdf(): Promise<PickedDocument | null> {
    this.calls += 1;
    if (this.next instanceof Error) throw this.next;
    return this.next;
  }
}

class FakeStorage implements StoragePort {
  readonly files = new Map<string, string>();
  readonly deleted: string[] = [];
  failCopy = false;
  failDelete = false;

  async copyIntoLibrary(sourceUri: string): Promise<string> {
    if (this.failCopy) throw new Error('ENOSPC: no space left on device');
    const stored = `file:///library/${this.files.size}-copy.pdf`;
    this.files.set(stored, sourceUri);
    return stored;
  }

  async deleteStoredFile(storedPath: string): Promise<boolean> {
    if (this.failDelete) throw new Error('EBUSY');
    this.deleted.push(storedPath);
    return this.files.delete(storedPath);
  }

  async exists(storedPath: string): Promise<boolean> {
    return this.files.has(storedPath);
  }
}

interface Harness {
  readonly picker: FakePicker;
  readonly storage: FakeStorage;
  readonly created: NewBook[];
  readonly validateCalls: PickedFileInfo[];
  readonly deleted: string[];
  verdict: ValidationVerdict;
  failCreateWith: Error | null;
  run(): ReturnType<ReturnType<typeof createImportService>['importFromPicker']>;
}

const okVerdict: ValidationVerdict = { ok: true };

function makeHarness(): Harness {
  const picker = new FakePicker();
  const storage = new FakeStorage();
  const created: NewBook[] = [];
  const validateCalls: PickedFileInfo[] = [];
  let currentVerdict: ValidationVerdict = okVerdict;
  let failingCreate: Error | null = null;

  const service = createImportService({
    picker,
    storage,
    validatePicked: async (file) => {
      validateCalls.push(file);
      return currentVerdict;
    },
    createBook: async (input) => {
      if (failingCreate) throw failingCreate;
      created.push(input);
      return makeBook({ ...input, id: `book-${created.length}` });
    },
  });

  return {
    picker,
    storage,
    created,
    validateCalls,
    get deleted() {
      return storage.deleted;
    },
    get verdict() {
      return currentVerdict;
    },
    set verdict(value: ValidationVerdict) {
      currentVerdict = value;
    },
    get failCreateWith() {
      return failingCreate;
    },
    set failCreateWith(value: Error | null) {
      failingCreate = value;
    },
    run: () => service.importFromPicker(),
  };
}

const aPdf: PickedDocument = {
  uri: 'file:///cache/report.pdf',
  name: 'report.pdf',
  sizeBytes: 12345,
};

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

test('cancellation touches nothing', async () => {
  const h = makeHarness();
  h.picker.next = null;

  const outcome = await h.run();

  assert.deepEqual(outcome, { status: 'canceled' });
  assert.equal(h.picker.calls, 1);
  assert.equal(h.validateCalls.length, 0, 'validator must not run on cancel');
  assert.equal(h.created.length, 0, 'no DB record on cancel');
  assert.equal(h.storage.files.size, 0, 'nothing copied on cancel');
});

test('a happy path copies into private storage and inserts the row', async () => {
  const h = makeHarness();
  h.picker.next = aPdf;

  const outcome = await h.run();

  assert.equal(outcome.status, 'imported');
  if (outcome.status !== 'imported') return;
  assert.match(outcome.book.fileUri, /^file:\/\/\/library\//, 'must point at private storage');
  assert.notEqual(outcome.book.fileUri, aPdf.uri, 'must not point at the cache file');

  assert.equal(h.created.length, 1);
  assert.equal(h.created[0]?.title, 'report'); // extension stripped
  assert.equal(h.created[0]?.fileName, 'report.pdf');
  assert.equal(h.created[0]?.fileSize, 12345);
});

test('an invalid file is rejected before anything is copied or written', async () => {
  const h = makeHarness();
  h.verdict = { ok: false, reason: 'not a real PDF' };
  h.picker.next = aPdf;

  const outcome = await h.run();

  assert.deepEqual(outcome, { status: 'invalid', reason: 'not a real PDF' });
  assert.equal(h.validateCalls.length, 1, 'validation ran once');
  assert.equal(h.storage.files.size, 0, 'no copy happened');
  assert.equal(h.created.length, 0, 'no DB record');
});

test('storage failure surfaces storage_write_failed and writes no record', async () => {
  const h = makeHarness();
  h.picker.next = aPdf;
  h.storage.failCopy = true;

  await assert.rejects(
    () => h.run(),
    (error: unknown): error is DomainError =>
      error instanceof DomainError && error.code === 'storage_write_failed',
  );
  assert.equal(h.created.length, 0);
});

test('database failure rolls back the copied file and rethrows as DomainError', async () => {
  const h = makeHarness();
  h.picker.next = aPdf;
  h.failCreateWith = new Error('UNIQUE constraint failed: books.file_uri');

  // Raw driver text must NOT leak into .message (users see it); it is kept as cause.
  await assert.rejects(
    () => h.run(),
    (error: unknown): error is DomainError =>
      error instanceof DomainError && error.code === 'unknown',
  );
  assert.equal(h.deleted.length >= 1, true, 'rollback delete was attempted');
  assert.equal(h.storage.files.size, 0, 'no orphaned PDF remains in private storage');
  assert.equal(h.created.length, 0, 'no DB record');
});

test('the raw database error survives as the cause for logging', async () => {
  const h = makeHarness();
  h.picker.next = aPdf;
  h.failCreateWith = new Error('db exploded');
  h.storage.failDelete = true;

  let caught: unknown;
  try {
    await h.run();
  } catch (error) {
    caught = error;
  }
  if (!(caught instanceof DomainError)) {
    throw new Error(`expected DomainError, got ${String(caught)}`);
  }
  assert.equal(caught.message, 'Could not add the book to your library.');
  const cause: unknown = caught.cause;
  assert.ok(cause instanceof Error);
  assert.match(String((cause as Error).message), /db exploded/);
});

test('picker crash propagates (caller decides how to surface it)', async () => {
  const h = makeHarness();
  h.picker.next = new Error('SecurityException: provider gone');
  await assert.rejects(() => h.run(), /provider gone/);
  assert.equal(h.created.length, 0);
});

// ---------------------------------------------------------------------------
// Title derivation + duplicate policy
// ---------------------------------------------------------------------------

test('titleFromFileName strips the extension and underscores', () => {
  assert.equal(titleFromFileName('my_cool_report.pdf'), 'my cool report');
  assert.equal(titleFromFileName('UPPER.PDF'), 'UPPER');
  assert.equal(titleFromFileName('.pdf'), 'Untitled');
  assert.equal(titleFromFileName('   spaced.pdf '), 'spaced');
});

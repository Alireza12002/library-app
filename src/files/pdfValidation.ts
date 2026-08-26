/**
 * Imported-PDF validation (files layer — this is byte/file work, not business
 * logic; importService decides what to do with the verdict).
 *
 * Three checks, cheapest first:
 *   1. name/extension looks like a PDF;
 *   2. declared size exists and is under MAX_IMPORT_BYTES;
 *   3. the file actually starts with "%PDF-" — the only trustworthy signal,
 *      since Android SAF may report no useful mime type and names can lie.
 */
import { File } from 'expo-file-system';

import { MAX_IMPORT_BYTES } from '@/config';

/** Every real PDF starts with these five bytes. */
const PDF_MAGIC = '%PDF-';
/** Enough bytes to hold the magic string; read via FileHandle, not whole-file. */
const HEADER_BYTES = 5;

export type ValidationVerdict = { ok: true } | { ok: false; reason: string };

export interface PickedFileInfo {
  uri: string;
  /** Original display name from the picker. */
  name: string;
}

function hasPdfExtension(name: string): boolean {
  return /\.pdf$/i.test(name.trim());
}

/**
 * Validates a picked document. Never throws for a "bad file" — a bad file is
 * an `{ ok: false }` verdict. Only unexpected I/O failures propagate to the
 * caller as exceptions.
 */
export async function validatePickedPdf(file: PickedFileInfo): Promise<ValidationVerdict> {
  const name = file.name.trim();

  if (!hasPdfExtension(name)) {
    return { ok: false, reason: '“' + name + '” is not a PDF file.' };
  }

  const handle = new File(file.uri);
  if (!handle.exists) {
    return { ok: false, reason: 'The selected file could not be read.' };
  }

  if (handle.size <= 0) {
    return { ok: false, reason: 'The selected file is empty.' };
  }

  if (handle.size > MAX_IMPORT_BYTES) {
    const limitMb = Math.round(MAX_IMPORT_BYTES / (1024 * 1024));
    return {
      ok: false,
      reason: `That file is larger than the ${limitMb} MB limit.`,
    };
  }

  const head = await readHeaderBytes(file.uri, HEADER_BYTES);
  if (head !== PDF_MAGIC) {
    return { ok: false, reason: '“' + name + '” doesn’t look like a valid PDF.' };
  }

  return { ok: true };
}

/** Reads the first `length` bytes as ASCII without buffering the whole file. */
async function readHeaderBytes(uri: string, length: number): Promise<string> {
  // File.open() is sync; wrap in a promise-shaped helper so callers stay async
  // and a future native async open needs no call-site change.
  const handle = new File(uri).open();
  try {
    const bytes = handle.readBytes(length);
    let out = '';
    for (const byte of bytes) out += String.fromCharCode(byte);
    return out;
  } finally {
    handle.close();
  }
}

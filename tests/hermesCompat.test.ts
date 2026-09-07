/**
 * Hermes runtime-compatibility tests (ARCHITECTURE.md §9).
 *
 * The app runs on Hermes, which is NOT Node: it ships a UTF-8-only `TextDecoder`,
 * no `Buffer`, and no zlib. Node's test runner has all three, so a module that
 * works in tests can still crash the app at import time — which is exactly what
 * `new TextDecoder('latin1')` did, taking down the services barrel and every route
 * that imported it.
 *
 * These tests scan the PDF parser's source for constructs Hermes cannot run, and
 * pin the hand-rolled Latin-1 helpers that replaced the decoder.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { decodeLatin1, encodeLatin1 } from '@/pdf/adapters/text/pdfkit/bytes';

/**
 * Strips comments so the scans below cannot match prose.
 *
 * The rules that explain a banned construct necessarily quote it — bytes.ts
 * documents `new TextDecoder('latin1')` as the thing not to do — and a comment
 * cannot crash at runtime.
 *
 * Deliberately naive: block comments, line comments, then string literals. It can
 * over-strip inside a string containing `//`, which risks a false NEGATIVE, not a
 * false positive. That is the right direction for a guard whose failure mode is
 * blocking a build.
 */
function stripCommentsAndStrings(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

/** Source files that ship to the device (app code, not tests). */
function appSourceFiles(): { path: string; source: string }[] {
  const roots = ['src'];
  const files: { path: string; source: string }[] = [];

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else if (/\.tsx?$/.test(entry.name)) {
        files.push({ path, source: stripCommentsAndStrings(readFileSync(path, 'utf8')) });
      }
    }
  };

  for (const root of roots) walk(root);
  return files;
}

describe('Hermes compatibility of shipped source', () => {
  const files = appSourceFiles();

  test('scans a non-trivial number of files', () => {
    // Guards the guard: a broken walk would make every check below vacuous.
    assert.ok(files.length > 20, `only found ${files.length} source files`);
  });

  test('never constructs a TextDecoder with a non-UTF-8 encoding', () => {
    // Hermes throws `RangeError: Unknown encoding` at construction, and these are
    // usually module-scope constants, so the whole import graph dies.
    const offenders = files.filter(({ source }) =>
      /new TextDecoder\(\s*['"](?!utf-?8['"])/i.test(source),
    );

    assert.deepEqual(
      offenders.map((file) => file.path),
      [],
      'use decodeLatin1() from pdfkit/bytes instead',
    );
  });

  test('does not use Node Buffer', () => {
    const offenders = files.filter(({ source }) =>
      /\bBuffer\s*\.\s*(from|alloc|concat)\b/.test(source),
    );

    assert.deepEqual(offenders.map((file) => file.path), [], 'Buffer does not exist on Hermes');
  });

  test('does not use node: builtins', () => {
    const offenders = files.filter(({ source }) => /from\s+['"]node:/.test(source));
    assert.deepEqual(offenders.map((file) => file.path), []);
  });

  test('does not use zlib or DecompressionStream at runtime', () => {
    const offenders = files.filter(
      ({ source }) =>
        /require\(\s*['"]zlib['"]\s*\)/.test(source) ||
        /from\s+['"]zlib['"]/.test(source) ||
        /new\s+DecompressionStream\b/.test(source),
    );
    assert.deepEqual(offenders.map((file) => file.path), []);
  });
});

describe('Latin-1 byte helpers', () => {
  test('decodes every byte value to the same code point', () => {
    const bytes = new Uint8Array(256);
    for (let i = 0; i < 256; i++) bytes[i] = i;

    const decoded = decodeLatin1(bytes);

    assert.equal(decoded.length, 256);
    for (let i = 0; i < 256; i++) {
      assert.equal(decoded.charCodeAt(i), i, `byte ${i} mapped to ${decoded.charCodeAt(i)}`);
    }
  });

  test('handles an empty buffer', () => {
    assert.equal(decodeLatin1(new Uint8Array(0)), '');
  });

  test('decodes ASCII exactly, which is what PDF keywords rely on', () => {
    const text = 'obj endobj stream /Type /Page 12 0 R';
    assert.equal(decodeLatin1(encodeLatin1(text)), text);
  });

  test('round-trips high bytes losslessly', () => {
    const bytes = new Uint8Array([0x80, 0x92, 0xa9, 0xe9, 0xff, 0x00, 0x7f]);
    const decoded = decodeLatin1(bytes);
    assert.deepEqual(Array.from(encodeLatin1(decoded)), Array.from(bytes));
  });

  test('decodes buffers larger than the chunk size without corruption', () => {
    // The chunked spread is where an off-by-one would silently drop or duplicate
    // bytes; a PDF content stream is routinely this big.
    const size = 4096 * 3 + 137;
    const bytes = new Uint8Array(size);
    for (let i = 0; i < size; i++) bytes[i] = i % 256;

    const decoded = decodeLatin1(bytes);

    assert.equal(decoded.length, size);
    for (let i = 0; i < size; i += 97) {
      assert.equal(decoded.charCodeAt(i), i % 256, `mismatch at ${i}`);
    }
    // Boundaries specifically.
    for (const boundary of [4095, 4096, 4097, 8191, 8192, 8193, size - 1]) {
      assert.equal(decoded.charCodeAt(boundary), boundary % 256, `mismatch at ${boundary}`);
    }
  });

  test('does not throw on a very large buffer (argument-limit guard)', () => {
    // A single String.fromCharCode(...bytes) spread of this size overflows the
    // engine's call stack; the chunked loop must not.
    const bytes = new Uint8Array(500_000);
    assert.doesNotThrow(() => decodeLatin1(bytes));
    assert.equal(decodeLatin1(bytes).length, 500_000);
  });

  test('encodeLatin1 truncates code points above 0xFF', () => {
    // Only used for ASCII keyword patterns, but the behaviour should be defined.
    assert.deepEqual(Array.from(encodeLatin1('A\u0100')), [0x41, 0x00]);
  });
});

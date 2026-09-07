/**
 * Inflate tests (ARCHITECTURE.md §9).
 *
 * The inflate implementation is the foundation of reflow text extraction: PDF
 * content streams are FlateDecode, so a bug here silently yields empty or
 * corrupted text for every book. Node's zlib produces the reference data, so
 * these are true round-trip tests against a known-good compressor rather than
 * assertions about our own output.
 */
import assert from 'node:assert/strict';
import { deflateSync, deflateRawSync, gzipSync } from 'node:zlib';
import { describe, test } from 'node:test';

import { inflate, inflateRaw, InflateError } from '@/pdf/adapters/text/pdfkit/inflate';

const decoder = new TextDecoder();

function roundTrip(text: string): string {
  const compressed = deflateSync(Buffer.from(text, 'utf8'));
  return decoder.decode(inflate(new Uint8Array(compressed)));
}

describe('inflate — zlib wrapped', () => {
  test('round-trips a short ASCII string', () => {
    const text = 'Hello, PDF text extraction.';
    assert.equal(roundTrip(text), text);
  });

  test('round-trips text with heavy repetition (exercises back-references)', () => {
    // Long runs force LZ77 matches, which is where copyBack bugs surface.
    const text = 'the quick brown fox '.repeat(500);
    assert.equal(roundTrip(text), text);
  });

  test('round-trips a realistic page of prose', () => {
    const paragraph =
      'Reflow mode reconstructs the document as a continuous stream of text ' +
      'blocks, so the reader can wrap lines to the width of the screen rather ' +
      'than the width of the original page. ';
    const text = Array.from({ length: 40 }, (_, i) => `${i + 1}. ${paragraph}`).join('\n\n');
    assert.equal(roundTrip(text), text);
  });

  test('round-trips multi-byte UTF-8', () => {
    const text = 'árvíztűrő tükörfúrógép — naïve café — 日本語のテキスト';
    assert.equal(roundTrip(text), text);
  });

  test('round-trips incompressible random bytes (stored blocks)', () => {
    // Random data cannot be compressed, so zlib emits stored blocks — the path
    // that has to reseat the bit cursor to a byte boundary mid-stream.
    const random = new Uint8Array(9000);
    for (let i = 0; i < random.length; i++) {
      random[i] = (i * 2654435761) % 251;
    }
    const compressed = deflateSync(Buffer.from(random));
    const out = inflate(new Uint8Array(compressed));
    assert.deepEqual(Array.from(out), Array.from(random));
  });

  test('round-trips data that mixes compressible and random regions', () => {
    const parts: number[] = [];
    for (let i = 0; i < 4000; i++) parts.push(65); // long run of 'A'
    for (let i = 0; i < 4000; i++) parts.push((i * 7919) % 253);
    for (let i = 0; i < 4000; i++) parts.push(66);
    const input = new Uint8Array(parts);

    const compressed = deflateSync(Buffer.from(input), { level: 9 });
    assert.deepEqual(Array.from(inflate(new Uint8Array(compressed))), Array.from(input));
  });

  test('handles an empty payload', () => {
    const compressed = deflateSync(Buffer.alloc(0));
    assert.equal(inflate(new Uint8Array(compressed)).length, 0);
  });

  test('round-trips a large stream without truncating', () => {
    // ~1MB: guards the geometric buffer growth in ByteSink.
    const text = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(20000);
    const out = roundTrip(text);
    assert.equal(out.length, text.length);
    assert.equal(out, text);
  });
});

describe('inflate — raw DEFLATE', () => {
  test('inflateRaw round-trips a headerless stream', () => {
    const text = 'Some PDF writers emit raw deflate with no zlib header.';
    const compressed = deflateRawSync(Buffer.from(text, 'utf8'));
    assert.equal(decoder.decode(inflateRaw(new Uint8Array(compressed))), text);
  });

  test('inflate() falls back to raw when no zlib header is present', () => {
    const text = 'fallback path';
    const compressed = deflateRawSync(Buffer.from(text, 'utf8'));
    assert.equal(decoder.decode(inflate(new Uint8Array(compressed))), text);
  });
});

describe('inflate — failure handling', () => {
  test('rejects a stream that is too short to hold a header', () => {
    assert.throws(() => inflate(new Uint8Array([0x78])), InflateError);
  });

  test('rejects truncated compressed data instead of returning partial output', () => {
    const compressed = deflateSync(Buffer.from('a'.repeat(5000), 'utf8'));
    const truncated = new Uint8Array(compressed).subarray(0, 12);
    assert.throws(() => inflate(truncated), InflateError);
  });

  test('rejects garbage that is not deflate at all', () => {
    // A gzip stream: valid compression, wrong container. Must fail loudly rather
    // than silently producing nonsense text.
    const gz = new Uint8Array(gzipSync(Buffer.from('not zlib', 'utf8')));
    assert.throws(() => inflate(gz), InflateError);
  });
});

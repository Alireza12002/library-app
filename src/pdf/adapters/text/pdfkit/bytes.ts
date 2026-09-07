/**
 * Byte ↔ string helpers for the PDF parser.
 *
 * Hermes ships a `TextDecoder` that supports UTF-8 ONLY: constructing one with any
 * other label throws `RangeError: Unknown encoding`. That happens at module scope,
 * so a single `new TextDecoder('latin1')` anywhere in this directory takes down the
 * whole services barrel and every route that imports it.
 *
 * Latin-1 needs no decoder table anyway — byte value equals code point by
 * definition (ISO-8859-1 is the first 256 Unicode code points), so the conversion
 * is a direct `String.fromCharCode`.
 *
 * Layer note: PDF technology behind the TextExtractionEngine port
 * (ARCHITECTURE.md §6).
 */

/**
 * Chunk size for `String.fromCharCode(...spread)`.
 *
 * Spreading a large array blows the JS engine's argument limit (~65k on Hermes,
 * lower under stress), and PDF content streams routinely exceed that. 4096 is well
 * inside every engine's limit while keeping the loop count low.
 */
const CHUNK = 4096;

/**
 * Decodes bytes as Latin-1 (ISO-8859-1 / the PDF "raw byte" interpretation).
 *
 * Every byte maps to the code point of the same value, so this is lossless and
 * round-trips through `encodeLatin1`.
 */
export function decodeLatin1(bytes: Uint8Array): string {
  const length = bytes.length;
  if (length === 0) return '';

  // Fast path: short runs (names, keywords, operators) are the common case.
  if (length <= CHUNK) {
    return String.fromCharCode(...bytes);
  }

  let out = '';
  for (let offset = 0; offset < length; offset += CHUNK) {
    out += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + CHUNK, length)));
  }
  return out;
}

/**
 * Encodes a string as Latin-1 bytes, truncating any code point above 0xFF.
 *
 * Only used for building byte patterns to search for; PDF keywords and operators
 * are ASCII, so truncation never bites in practice.
 */
export function encodeLatin1(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    bytes[i] = text.charCodeAt(i) & 0xff;
  }
  return bytes;
}

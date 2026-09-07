/**
 * Raw DEFLATE / zlib inflate (RFC 1950 + 1951), pure TypeScript.
 *
 * Needed because PDF content streams are almost always `FlateDecode`, and the
 * React Native runtime (Hermes) ships no zlib and no `DecompressionStream`.
 * Adding a native module just for this would mean a new native build dependency;
 * a few hundred lines of well-understood bit twiddling keeps text extraction pure
 * JS and testable off-device.
 *
 * Allocation-conscious on purpose: a single PDF content stream can be hundreds of
 * KB, so the output buffer grows geometrically instead of per byte.
 */

/** Thrown for malformed or unsupported compressed data. */
export class InflateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InflateError';
  }
}

/** Code-length order for the dynamic-Huffman header (RFC 1951 §3.2.7). */
const CODE_LENGTH_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

const LENGTH_BASE = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131,
  163, 195, 227, 258,
];

const LENGTH_EXTRA = [
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0,
];

const DIST_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049,
  3073, 4097, 6145, 8193, 12289, 16385, 24577,
];

const DIST_EXTRA = [
  0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13,
];

/**
 * Canonical Huffman decode table: `counts[len]` is how many codes have that bit
 * length, `symbols` lists symbols ordered by (length, symbol).
 */
interface HuffmanTable {
  counts: Uint16Array;
  symbols: Uint16Array;
}

function buildHuffman(lengths: Uint8Array, count: number): HuffmanTable {
  const counts = new Uint16Array(16);
  for (let i = 0; i < count; i++) {
    const len = lengths[i] ?? 0;
    counts[len] = (counts[len] ?? 0) + 1;
  }
  // Length 0 means "symbol unused"; it must not participate in code assignment.
  counts[0] = 0;

  const offsets = new Uint16Array(16);
  for (let len = 1; len < 16; len++) {
    offsets[len] = (offsets[len - 1] ?? 0) + (counts[len - 1] ?? 0);
  }

  const symbols = new Uint16Array(count);
  for (let symbol = 0; symbol < count; symbol++) {
    const len = lengths[symbol] ?? 0;
    if (len !== 0) {
      symbols[offsets[len]!] = symbol;
      offsets[len] = offsets[len]! + 1;
    }
  }

  return { counts, symbols };
}

/** Growable output sink supporting LZ77 back-references. */
class ByteSink {
  private buffer: Uint8Array;
  private length = 0;

  constructor(initialCapacity: number) {
    this.buffer = new Uint8Array(Math.max(64, initialCapacity));
  }

  private ensure(extra: number): void {
    const needed = this.length + extra;
    if (needed <= this.buffer.length) return;
    let capacity = this.buffer.length;
    while (capacity < needed) capacity *= 2;
    const grown = new Uint8Array(capacity);
    grown.set(this.buffer.subarray(0, this.length));
    this.buffer = grown;
  }

  pushByte(byte: number): void {
    this.ensure(1);
    this.buffer[this.length++] = byte;
  }

  pushBytes(bytes: Uint8Array): void {
    this.ensure(bytes.length);
    this.buffer.set(bytes, this.length);
    this.length += bytes.length;
  }

  /** Copies `count` bytes from `distance` behind the write head. */
  copyBack(distance: number, count: number): void {
    if (distance <= 0 || distance > this.length) {
      throw new InflateError('back-reference outside output window');
    }
    this.ensure(count);
    let from = this.length - distance;
    for (let i = 0; i < count; i++) {
      this.buffer[this.length++] = this.buffer[from++]!;
    }
  }

  get size(): number {
    return this.length;
  }

  toUint8Array(): Uint8Array {
    return this.buffer.slice(0, this.length);
  }
}

let fixedTablesCache: { literal: HuffmanTable; distance: HuffmanTable } | null = null;

function fixedTables(): { literal: HuffmanTable; distance: HuffmanTable } {
  if (fixedTablesCache) return fixedTablesCache;

  const literalLengths = new Uint8Array(288);
  for (let i = 0; i < 144; i++) literalLengths[i] = 8;
  for (let i = 144; i < 256; i++) literalLengths[i] = 9;
  for (let i = 256; i < 280; i++) literalLengths[i] = 7;
  for (let i = 280; i < 288; i++) literalLengths[i] = 8;

  const distanceLengths = new Uint8Array(30).fill(5);

  fixedTablesCache = {
    literal: buildHuffman(literalLengths, 288),
    distance: buildHuffman(distanceLengths, 30),
  };
  return fixedTablesCache;
}

/**
 * Single-pass DEFLATE decoder. Keeps the bit cursor and the byte cursor in one
 * object so a stored (uncompressed) block can reseat to a byte boundary and the
 * same loop continues — the earlier recursive approach lost sink state.
 */
class Inflater {
  private readonly data: Uint8Array;
  private pos: number;
  private bitBuffer = 0;
  private bitCount = 0;
  private readonly sink: ByteSink;

  constructor(data: Uint8Array, offset: number) {
    this.data = data;
    this.pos = offset;
    this.sink = new ByteSink((data.length - offset) * 4);
  }

  private bits(count: number): number {
    while (this.bitCount < count) {
      if (this.pos >= this.data.length) {
        throw new InflateError('unexpected end of compressed data');
      }
      this.bitBuffer |= this.data[this.pos++]! << this.bitCount;
      this.bitCount += 8;
    }
    const value = this.bitBuffer & ((1 << count) - 1);
    this.bitBuffer >>>= count;
    this.bitCount -= count;
    return value;
  }

  /** Drops buffered bits and rewinds the byte cursor to the boundary. */
  private alignToByte(): void {
    const wholeBytesBuffered = this.bitCount >> 3;
    this.pos -= wholeBytesBuffered;
    this.bitBuffer = 0;
    this.bitCount = 0;
  }

  private decode(table: HuffmanTable): number {
    let code = 0;
    let first = 0;
    let index = 0;

    for (let len = 1; len < 16; len++) {
      code |= this.bits(1);
      const count = table.counts[len] ?? 0;
      if (code - first < count) {
        return table.symbols[index + (code - first)]!;
      }
      index += count;
      first = (first + count) << 1;
      code <<= 1;
    }

    throw new InflateError('invalid Huffman code');
  }

  private storedBlock(): void {
    this.alignToByte();
    if (this.pos + 4 > this.data.length) {
      throw new InflateError('truncated stored block header');
    }
    const length = this.data[this.pos]! | (this.data[this.pos + 1]! << 8);
    const nlength = this.data[this.pos + 2]! | (this.data[this.pos + 3]! << 8);
    if ((length ^ 0xffff) !== nlength) {
      throw new InflateError('stored block length check failed');
    }
    this.pos += 4;
    if (this.pos + length > this.data.length) {
      throw new InflateError('truncated stored block payload');
    }
    this.sink.pushBytes(this.data.subarray(this.pos, this.pos + length));
    this.pos += length;
  }

  private dynamicTables(): { literal: HuffmanTable; distance: HuffmanTable } {
    const literalCount = this.bits(5) + 257;
    const distanceCount = this.bits(5) + 1;
    const codeLengthCount = this.bits(4) + 4;

    const codeLengthLengths = new Uint8Array(19);
    for (let i = 0; i < codeLengthCount; i++) {
      codeLengthLengths[CODE_LENGTH_ORDER[i]!] = this.bits(3);
    }
    const codeLengthTable = buildHuffman(codeLengthLengths, 19);

    const lengths = new Uint8Array(literalCount + distanceCount);
    let index = 0;

    while (index < lengths.length) {
      const symbol = this.decode(codeLengthTable);

      if (symbol < 16) {
        lengths[index++] = symbol;
      } else if (symbol === 16) {
        if (index === 0) throw new InflateError('repeat code with no previous length');
        const previous = lengths[index - 1]!;
        const repeat = 3 + this.bits(2);
        for (let i = 0; i < repeat && index < lengths.length; i++) lengths[index++] = previous;
      } else if (symbol === 17) {
        index += 3 + this.bits(3); // zeros; array is already zero-filled
      } else {
        index += 11 + this.bits(7);
      }
    }

    if (index > lengths.length) throw new InflateError('code length table overflow');

    return {
      literal: buildHuffman(lengths.subarray(0, literalCount), literalCount),
      distance: buildHuffman(lengths.subarray(literalCount), distanceCount),
    };
  }

  private compressedBlock(tables: { literal: HuffmanTable; distance: HuffmanTable }): void {
    const { literal, distance } = tables;

    for (;;) {
      const symbol = this.decode(literal);

      if (symbol < 256) {
        this.sink.pushByte(symbol);
        continue;
      }
      if (symbol === 256) return; // end of block

      const lengthIndex = symbol - 257;
      if (lengthIndex >= LENGTH_BASE.length) throw new InflateError('invalid length symbol');
      const length = LENGTH_BASE[lengthIndex]! + this.bits(LENGTH_EXTRA[lengthIndex]!);

      const distanceSymbol = this.decode(distance);
      if (distanceSymbol >= DIST_BASE.length) throw new InflateError('invalid distance symbol');
      const backDistance = DIST_BASE[distanceSymbol]! + this.bits(DIST_EXTRA[distanceSymbol]!);

      this.sink.copyBack(backDistance, length);
    }
  }

  run(): Uint8Array {
    for (;;) {
      const isFinal = this.bits(1) === 1;
      const type = this.bits(2);

      if (type === 0) {
        this.storedBlock();
      } else if (type === 1) {
        this.compressedBlock(fixedTables());
      } else if (type === 2) {
        this.compressedBlock(this.dynamicTables());
      } else {
        throw new InflateError('invalid block type');
      }

      if (isFinal) break;
    }

    return this.sink.toUint8Array();
  }
}

/** Inflates a raw DEFLATE stream (no zlib wrapper). */
export function inflateRaw(data: Uint8Array, offset = 0): Uint8Array {
  return new Inflater(data, offset).run();
}

/**
 * Inflates a zlib-wrapped stream (RFC 1950) — what PDF `FlateDecode` produces.
 * Falls back to raw DEFLATE when the two-byte header is missing, because some
 * PDF writers emit headerless streams.
 */
export function inflate(data: Uint8Array): Uint8Array {
  if (data.length < 2) throw new InflateError('stream too short');

  const cmf = data[0]!;
  const flg = data[1]!;
  const looksLikeZlib = (cmf & 0x0f) === 8 && ((cmf << 8) | flg) % 31 === 0;

  if (!looksLikeZlib) return inflateRaw(data, 0);

  // FDICT: a preset dictionary id follows the header. PDFs do not use it, but
  // skip it rather than mis-parsing if one appears.
  const hasDict = (flg & 0x20) !== 0;
  return inflateRaw(data, hasDict ? 6 : 2);
}

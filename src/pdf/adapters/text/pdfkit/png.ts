/**
 * Minimal PNG encoder (test-free dependencies, pure TypeScript).
 *
 * Needed because PDF bitmap images arrive as raw component data (FlateDecode'd
 * RGB/grayscale samples), and React Native's `Image` cannot display raw samples —
 * it needs a container format. JPEG images pass through untouched; everything else
 * has to be wrapped, and PNG is the only lossless container RN reads on both
 * platforms without a native addition.
 *
 * Compression uses DEFLATE *stored* blocks: valid zlib output that any decoder
 * accepts, at the cost of ~0% compression. That is a deliberate trade — a real
 * Huffman compressor is hundreds of lines, and these bytes are written once to a
 * cache file per image per book, never over a network.
 *
 * Layer note: PDF technology behind the TextExtractionEngine port
 * (ARCHITECTURE.md §6).
 */

/** Colour types this encoder emits (PNG spec §11.2.2). */
const COLOR_TYPE_GRAY = 0;
const COLOR_TYPE_RGB = 2;

let crcTable: Uint32Array | null = null;

function crc32Table(): Uint32Array {
  if (crcTable) return crcTable;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  crcTable = table;
  return table;
}

function crc32(bytes: Uint8Array): number {
  const table = crc32Table();
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = table[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  // 5552 is the largest run that cannot overflow the accumulators.
  for (let i = 0; i < bytes.length; ) {
    const end = Math.min(i + 5552, bytes.length);
    for (; i < end; i++) {
      a += bytes[i]!;
      b += a;
    }
    a %= 65521;
    b %= 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/** Wraps data in a zlib stream using uncompressed DEFLATE blocks (RFC 1951 §3.2.4). */
function zlibStored(data: Uint8Array): Uint8Array {
  const MAX_BLOCK = 65535;
  const blockCount = Math.max(1, Math.ceil(data.length / MAX_BLOCK));
  const out = new Uint8Array(2 + blockCount * 5 + data.length + 4);
  let pos = 0;

  // zlib header: deflate, 32K window, default level, no dictionary.
  out[pos++] = 0x78;
  out[pos++] = 0x01;

  let offset = 0;
  for (let block = 0; block < blockCount; block++) {
    const size = Math.min(MAX_BLOCK, data.length - offset);
    const isFinal = block === blockCount - 1;

    out[pos++] = isFinal ? 1 : 0; // BFINAL, BTYPE=00 (stored)
    out[pos++] = size & 0xff;
    out[pos++] = (size >>> 8) & 0xff;
    out[pos++] = ~size & 0xff;
    out[pos++] = (~size >>> 8) & 0xff;

    out.set(data.subarray(offset, offset + size), pos);
    pos += size;
    offset += size;
  }

  const checksum = adler32(data);
  out[pos++] = (checksum >>> 24) & 0xff;
  out[pos++] = (checksum >>> 16) & 0xff;
  out[pos++] = (checksum >>> 8) & 0xff;
  out[pos++] = checksum & 0xff;

  return out.subarray(0, pos);
}

function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length);
  const length = body.length;

  out[0] = (length >>> 24) & 0xff;
  out[1] = (length >>> 16) & 0xff;
  out[2] = (length >>> 8) & 0xff;
  out[3] = length & 0xff;

  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(body, 8);

  // CRC covers the type and the body, not the length.
  const crc = crc32(out.subarray(4, 8 + length));
  out[8 + length] = (crc >>> 24) & 0xff;
  out[9 + length] = (crc >>> 16) & 0xff;
  out[10 + length] = (crc >>> 8) & 0xff;
  out[11 + length] = crc & 0xff;

  return out;
}

export interface PngInput {
  width: number;
  height: number;
  /** 1 = grayscale, 3 = RGB. */
  channels: 1 | 3;
  /** Row-major 8-bit samples, `width * height * channels` bytes. */
  samples: Uint8Array;
}

/**
 * Encodes 8-bit grayscale or RGB samples as a PNG.
 *
 * Every scanline uses filter type 0 (None): filtering only helps compression, and
 * stored blocks do not compress.
 */
export function encodePng({ width, height, channels, samples }: PngInput): Uint8Array {
  const expected = width * height * channels;
  if (samples.length < expected) {
    throw new Error(`PNG encode: expected ${expected} samples, received ${samples.length}`);
  }

  const stride = width * channels;
  const raw = new Uint8Array(height * (stride + 1));
  for (let row = 0; row < height; row++) {
    const dst = row * (stride + 1);
    raw[dst] = 0; // filter: None
    raw.set(samples.subarray(row * stride, row * stride + stride), dst + 1);
  }

  const ihdr = new Uint8Array(13);
  ihdr[0] = (width >>> 24) & 0xff;
  ihdr[1] = (width >>> 16) & 0xff;
  ihdr[2] = (width >>> 8) & 0xff;
  ihdr[3] = width & 0xff;
  ihdr[4] = (height >>> 24) & 0xff;
  ihdr[5] = (height >>> 16) & 0xff;
  ihdr[6] = (height >>> 8) & 0xff;
  ihdr[7] = height & 0xff;
  ihdr[8] = 8; // bit depth
  ihdr[9] = channels === 1 ? COLOR_TYPE_GRAY : COLOR_TYPE_RGB;
  ihdr[10] = 0; // compression: deflate
  ihdr[11] = 0; // filter method: adaptive
  ihdr[12] = 0; // interlace: none

  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const parts = [
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlibStored(raw)),
    chunk('IEND', new Uint8Array(0)),
  ];

  let total = 0;
  for (const part of parts) total += part.length;

  const png = new Uint8Array(total);
  let pos = 0;
  for (const part of parts) {
    png.set(part, pos);
    pos += part.length;
  }
  return png;
}

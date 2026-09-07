/**
 * PDF object model and syntax parser (PDF 32000-1 §7.3).
 *
 * Parses the COS object syntax — dictionaries, arrays, names, strings, numbers,
 * indirect references and streams — from a byte buffer. Deliberately byte-level
 * rather than string-level: PDF strings carry arbitrary bytes (including NUL and
 * invalid UTF-8), so decoding to a JS string before parsing would corrupt them.
 *
 * Layer note: this is PDF technology and lives under src/pdf/adapters, behind the
 * TextExtractionEngine port (ARCHITECTURE.md §6). Nothing above the port imports it.
 */
// Latin-1 decoding is done by hand: Hermes' TextDecoder supports UTF-8 only and
// throws `RangeError: Unknown encoding` at construction for any other label.
import { decodeLatin1 } from './bytes';

export type PdfObject =
  | { kind: 'null' }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'number'; value: number }
  | { kind: 'string'; bytes: Uint8Array }
  | { kind: 'name'; name: string }
  | { kind: 'array'; items: PdfObject[] }
  | { kind: 'dict'; entries: Map<string, PdfObject> }
  | { kind: 'stream'; dict: Map<string, PdfObject>; rawStart: number; rawEnd: number }
  | { kind: 'ref'; num: number; gen: number };

export const PDF_NULL: PdfObject = { kind: 'null' };

/** Character classes from PDF 32000-1 §7.2.2. */
function isWhitespace(byte: number): boolean {
  return (
    byte === 0x00 || byte === 0x09 || byte === 0x0a || byte === 0x0c || byte === 0x0d || byte === 0x20
  );
}

function isDelimiter(byte: number): boolean {
  return (
    byte === 0x28 || // (
    byte === 0x29 || // )
    byte === 0x3c || // <
    byte === 0x3e || // >
    byte === 0x5b || // [
    byte === 0x5d || // ]
    byte === 0x7b || // {
    byte === 0x7d || // }
    byte === 0x2f || // /
    byte === 0x25 // %
  );
}

function isRegular(byte: number): boolean {
  return !isWhitespace(byte) && !isDelimiter(byte);
}

function hexValue(byte: number): number {
  if (byte >= 0x30 && byte <= 0x39) return byte - 0x30;
  if (byte >= 0x41 && byte <= 0x46) return byte - 0x41 + 10;
  if (byte >= 0x61 && byte <= 0x66) return byte - 0x61 + 10;
  return -1;
}

// Latin-1 decoding is done by hand: Hermes' TextDecoder supports UTF-8 only and
// throws at construction for any other label. See ./bytes.ts.

/**
 * Cursor over PDF syntax. One instance per parse; `pos` is public so callers can
 * seek to a byte offset discovered elsewhere (an xref entry, say).
 */
export class PdfLexer {
  readonly data: Uint8Array;
  pos: number;

  constructor(data: Uint8Array, pos = 0) {
    this.data = data;
    this.pos = pos;
  }

  get atEnd(): boolean {
    return this.pos >= this.data.length;
  }

  /** Skips whitespace and `%` comments. */
  skipWhitespace(): void {
    while (this.pos < this.data.length) {
      const byte = this.data[this.pos]!;
      if (isWhitespace(byte)) {
        this.pos++;
        continue;
      }
      if (byte === 0x25) {
        // comment runs to end of line
        while (this.pos < this.data.length) {
          const c = this.data[this.pos]!;
          if (c === 0x0a || c === 0x0d) break;
          this.pos++;
        }
        continue;
      }
      return;
    }
  }

  /** Reads a run of regular characters — a keyword or number token. */
  readToken(): string {
    this.skipWhitespace();
    const start = this.pos;
    while (this.pos < this.data.length && isRegular(this.data[this.pos]!)) this.pos++;
    if (this.pos === start && this.pos < this.data.length) {
      // A lone delimiter; consume it so callers cannot loop forever.
      this.pos++;
    }
    return decodeLatin1(this.data.subarray(start, this.pos));
  }

  /** Peeks the token at the cursor without consuming it. */
  peekToken(): string {
    const saved = this.pos;
    const token = this.readToken();
    this.pos = saved;
    return token;
  }

  private readName(): PdfObject {
    this.pos++; // '/'
    const bytes: number[] = [];
    while (this.pos < this.data.length && isRegular(this.data[this.pos]!)) {
      let byte = this.data[this.pos++]!;
      if (byte === 0x23 && this.pos + 1 < this.data.length) {
        // #xx hex escape in a name
        const hi = hexValue(this.data[this.pos]!);
        const lo = hexValue(this.data[this.pos + 1]!);
        if (hi >= 0 && lo >= 0) {
          byte = (hi << 4) | lo;
          this.pos += 2;
        }
      }
      bytes.push(byte);
    }
    return { kind: 'name', name: decodeLatin1(new Uint8Array(bytes)) };
  }

  private readLiteralString(): PdfObject {
    this.pos++; // '('
    const out: number[] = [];
    let depth = 1;

    while (this.pos < this.data.length) {
      const byte = this.data[this.pos++]!;

      if (byte === 0x5c) {
        // backslash escape
        if (this.pos >= this.data.length) break;
        const esc = this.data[this.pos++]!;
        switch (esc) {
          case 0x6e: out.push(0x0a); break; // n
          case 0x72: out.push(0x0d); break; // r
          case 0x74: out.push(0x09); break; // t
          case 0x62: out.push(0x08); break; // b
          case 0x66: out.push(0x0c); break; // f
          case 0x28: out.push(0x28); break; // (
          case 0x29: out.push(0x29); break; // )
          case 0x5c: out.push(0x5c); break; // backslash
          case 0x0a: break; // line continuation
          case 0x0d:
            if (this.data[this.pos] === 0x0a) this.pos++;
            break;
          default:
            if (esc >= 0x30 && esc <= 0x37) {
              // up to three octal digits
              let value = esc - 0x30;
              for (let i = 0; i < 2; i++) {
                const next = this.data[this.pos];
                if (next === undefined || next < 0x30 || next > 0x37) break;
                value = value * 8 + (next - 0x30);
                this.pos++;
              }
              out.push(value & 0xff);
            } else {
              out.push(esc);
            }
        }
        continue;
      }

      if (byte === 0x28) {
        depth++;
        out.push(byte);
        continue;
      }
      if (byte === 0x29) {
        depth--;
        if (depth === 0) break;
        out.push(byte);
        continue;
      }
      out.push(byte);
    }

    return { kind: 'string', bytes: new Uint8Array(out) };
  }

  private readHexString(): PdfObject {
    this.pos++; // '<'
    const out: number[] = [];
    let high = -1;

    while (this.pos < this.data.length) {
      const byte = this.data[this.pos++]!;
      if (byte === 0x3e) break; // '>'
      const value = hexValue(byte);
      if (value < 0) continue; // whitespace and junk are ignored
      if (high < 0) {
        high = value;
      } else {
        out.push((high << 4) | value);
        high = -1;
      }
    }
    // Odd trailing digit: the spec says pad with 0.
    if (high >= 0) out.push(high << 4);

    return { kind: 'string', bytes: new Uint8Array(out) };
  }

  private readDictOrStream(): PdfObject {
    this.pos += 2; // '<<'
    const entries = new Map<string, PdfObject>();

    for (;;) {
      this.skipWhitespace();
      if (this.atEnd) break;

      if (this.data[this.pos] === 0x3e && this.data[this.pos + 1] === 0x3e) {
        this.pos += 2;
        break;
      }

      if (this.data[this.pos] !== 0x2f) {
        // Not a name where a key must be: skip a token to make progress rather
        // than spinning on malformed input.
        const before = this.pos;
        this.readToken();
        if (this.pos === before) this.pos++;
        continue;
      }

      const key = this.readName();
      const value = this.parseObject();
      if (key.kind === 'name') entries.set(key.name, value);
    }

    // A stream keyword may follow the dictionary.
    const saved = this.pos;
    this.skipWhitespace();
    if (this.matchKeyword('stream')) {
      // EOL after 'stream': CRLF or LF (never CR alone, per spec).
      if (this.data[this.pos] === 0x0d) this.pos++;
      if (this.data[this.pos] === 0x0a) this.pos++;

      const rawStart = this.pos;
      const declared = entries.get('Length');
      let rawEnd = -1;

      if (declared?.kind === 'number' && declared.value >= 0) {
        const candidate = rawStart + declared.value;
        if (candidate <= this.data.length && this.looksLikeEndstream(candidate)) {
          rawEnd = candidate;
        }
      }

      // /Length is often an indirect reference or simply wrong; scanning for
      // 'endstream' is the reliable fallback and what real readers do.
      if (rawEnd < 0) rawEnd = this.findEndstream(rawStart);

      this.pos = rawEnd;
      this.skipWhitespace();
      this.matchKeyword('endstream');

      return { kind: 'stream', dict: entries, rawStart, rawEnd };
    }

    this.pos = saved;
    return { kind: 'dict', entries };
  }

  /** True when `endstream` appears at `offset`, allowing intervening EOL. */
  private looksLikeEndstream(offset: number): boolean {
    let probe = offset;
    let guard = 0;
    while (probe < this.data.length && guard++ < 4 && isWhitespace(this.data[probe]!)) probe++;
    return this.hasKeywordAt(probe, 'endstream');
  }

  private hasKeywordAt(offset: number, keyword: string): boolean {
    if (offset + keyword.length > this.data.length) return false;
    for (let i = 0; i < keyword.length; i++) {
      if (this.data[offset + i] !== keyword.charCodeAt(i)) return false;
    }
    return true;
  }

  private findEndstream(from: number): number {
    const target = 'endstream';
    for (let i = from; i <= this.data.length - target.length; i++) {
      if (this.data[i] === 0x65 && this.hasKeywordAt(i, target)) {
        // Trim the EOL that precedes the keyword.
        let end = i;
        if (end > from && this.data[end - 1] === 0x0a) end--;
        if (end > from && this.data[end - 1] === 0x0d) end--;
        return end;
      }
    }
    return this.data.length;
  }

  /** Consumes `keyword` if it sits at the cursor. */
  matchKeyword(keyword: string): boolean {
    this.skipWhitespace();
    if (!this.hasKeywordAt(this.pos, keyword)) return false;
    this.pos += keyword.length;
    return true;
  }

  private readArray(): PdfObject {
    this.pos++; // '['
    const items: PdfObject[] = [];

    for (;;) {
      this.skipWhitespace();
      if (this.atEnd) break;
      if (this.data[this.pos] === 0x5d) {
        this.pos++;
        break;
      }
      const before = this.pos;
      items.push(this.parseObject());
      if (this.pos === before) {
        this.pos++; // guarantee progress on malformed content
      }
    }

    return { kind: 'array', items };
  }

  /**
   * Parses one object at the cursor.
   *
   * Handles the `N G R` indirect-reference form by lookahead: a bare integer is
   * ambiguous until the following two tokens are known.
   */
  parseObject(): PdfObject {
    this.skipWhitespace();
    if (this.atEnd) return PDF_NULL;

    const byte = this.data[this.pos]!;

    if (byte === 0x2f) return this.readName();
    if (byte === 0x28) return this.readLiteralString();
    if (byte === 0x5b) return this.readArray();
    if (byte === 0x3c) {
      if (this.data[this.pos + 1] === 0x3c) return this.readDictOrStream();
      return this.readHexString();
    }
    if (byte === 0x5d || byte === 0x3e || byte === 0x29) {
      // Stray closing delimiter — consume and report null.
      this.pos++;
      return PDF_NULL;
    }

    const saved = this.pos;
    const token = this.readToken();

    if (token === 'true') return { kind: 'boolean', value: true };
    if (token === 'false') return { kind: 'boolean', value: false };
    if (token === 'null' || token === '') return PDF_NULL;

    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(token)) {
      const value = Number.parseFloat(token);

      // Possible "num gen R".
      if (/^\d+$/.test(token)) {
        const afterFirst = this.pos;
        const genToken = this.readToken();
        if (/^\d+$/.test(genToken)) {
          const afterGen = this.pos;
          const kw = this.readToken();
          if (kw === 'R') {
            return { kind: 'ref', num: value, gen: Number.parseInt(genToken, 10) };
          }
          this.pos = afterGen;
        }
        this.pos = afterFirst;
      }

      return { kind: 'number', value };
    }

    // Unknown keyword: leave the cursor past it and report null so the caller
    // keeps making progress.
    if (this.pos === saved) this.pos++;
    return PDF_NULL;
  }
}

/* Accessor helpers — keep call sites free of repetitive kind checks. */

export function dictOf(object: PdfObject | undefined): Map<string, PdfObject> | null {
  if (!object) return null;
  if (object.kind === 'dict') return object.entries;
  if (object.kind === 'stream') return object.dict;
  return null;
}

export function numberOf(object: PdfObject | undefined): number | null {
  return object && object.kind === 'number' ? object.value : null;
}

export function nameOf(object: PdfObject | undefined): string | null {
  return object && object.kind === 'name' ? object.name : null;
}

export function arrayOf(object: PdfObject | undefined): PdfObject[] | null {
  return object && object.kind === 'array' ? object.items : null;
}

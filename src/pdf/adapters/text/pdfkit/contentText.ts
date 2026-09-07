/**
 * Content-stream text extraction (PDF 32000-1 §9).
 *
 * Interprets the text-showing operators of a page's content stream and emits
 * positioned runs: the string, its device-space baseline position, and its
 * effective font size. Position matters — it is what lets the reflow layer tell a
 * heading from body text and a paragraph break from a wrapped line, which raw
 * concatenated text cannot express.
 *
 * Only the text subset of the operator set is interpreted; graphics operators are
 * skipped. That is sufficient because reflow renders text, not page graphics.
 *
 * Layer note: PDF technology behind the TextExtractionEngine port
 * (ARCHITECTURE.md §6).
 */
import type { PdfFontInfo } from './document';
import { PdfLexer, type PdfObject } from './objects';

/** One run of text with the geometry needed to reconstruct reading order. */
export interface TextRun {
  text: string;
  /** Device-space X of the run's start. */
  x: number;
  /** Device-space Y of the baseline. Larger = higher on the page. */
  y: number;
  /** Effective glyph height in device units (font size × text matrix scale). */
  fontSize: number;
  /** Approximate rendered width, used to detect gaps between runs. */
  width: number;
}

/**
 * An XObject image painted by a `Do` operator, with the placement rectangle
 * derived from the CTM in force at that point.
 *
 * Reflow needs the position for the same reason text runs do: it decides where the
 * image belongs in reading order relative to the surrounding paragraphs.
 */
export interface ImagePlacement {
  /** Resource name in the page's /XObject dictionary (e.g. 'Im0'). */
  resourceName: string;
  /** Device-space X of the placement rectangle's left edge. */
  x: number;
  /** Device-space Y of the TOP edge — comparable with a text baseline. */
  y: number;
  /** Placed width in device units. */
  width: number;
  /** Placed height in device units. */
  height: number;
}

/** Everything the reflow pipeline needs from one content stream. */
export interface PageOperations {
  runs: TextRun[];
  images: ImagePlacement[];
}

/** 2×3 affine matrix [a b c d e f] as used by PDF (§8.3.3). */
type Matrix = [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[1] * n[2],
    m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4],
    m[4] * n[1] + m[5] * n[3] + n[5],
  ];
}


/**
 * PDFDocEncoding differs from Latin-1 in the 0x80–0x9F range. Mapping the few
 * characters that actually appear in text (quotes, dashes, ellipsis) avoids
 * mojibake in extracted prose.
 */
const WIN_ANSI_HIGH: Record<number, string> = {
  0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†', 0x87: '‡',
  0x88: 'ˆ', 0x89: '‰', 0x8a: 'Š', 0x8b: '‹', 0x8c: 'Œ', 0x8e: 'Ž', 0x91: '‘',
  0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—', 0x98: '˜',
  0x99: '™', 0x9a: 'š', 0x9b: '›', 0x9c: 'œ', 0x9e: 'ž', 0x9f: 'Ÿ',
};

/** Decodes a PDF string's bytes to text using the active font's encoding. */
function decodeString(bytes: Uint8Array, font: PdfFontInfo | null): string {
  if (font?.toUnicode) {
    const step = font.twoByte ? 2 : 1;
    let out = '';
    for (let i = 0; i + step - 1 < bytes.length; i += step) {
      const code = step === 2 ? (bytes[i]! << 8) | bytes[i + 1]! : bytes[i]!;
      const mapped = font.toUnicode.get(code);
      if (mapped !== undefined) {
        out += mapped;
      } else if (step === 1) {
        out += WIN_ANSI_HIGH[code] ?? String.fromCharCode(code);
      }
      // An unmapped 2-byte CID has no meaningful fallback; skip it rather than
      // emitting a replacement character that would pollute the text.
    }
    return out;
  }

  if (font?.twoByte) {
    // Identity encoding with no ToUnicode: byte pairs are glyph ids, and there is
    // no way to recover characters. Returning '' is honest; the caller reports the
    // page as having no extractable text.
    return '';
  }

  let out = '';
  for (const byte of bytes) {
    out += WIN_ANSI_HIGH[byte] ?? String.fromCharCode(byte);
  }
  return out;
}

interface GraphicsState {
  ctm: Matrix;
  fontKey: string | null;
  fontSize: number;
  charSpacing: number;
  wordSpacing: number;
  horizontalScale: number;
  leading: number;
  rise: number;
}

function initialState(): GraphicsState {
  return {
    ctm: IDENTITY,
    fontKey: null,
    fontSize: 0,
    charSpacing: 0,
    wordSpacing: 0,
    horizontalScale: 1,
    leading: 0,
    rise: 0,
  };
}

function cloneState(state: GraphicsState): GraphicsState {
  return { ...state, ctm: [...state.ctm] as Matrix };
}

/**
 * Estimated text width in unscaled text units.
 *
 * Real width needs per-glyph metrics from the font program, which would mean
 * parsing embedded font files. An average advance of 0.5 em is close enough for
 * the only thing width is used for here: deciding whether two runs on the same
 * line are separated by a space.
 */
const AVERAGE_GLYPH_ADVANCE = 0.5;

function estimateWidth(text: string, state: GraphicsState): number {
  const glyphs = text.length;
  const spaces = (text.match(/ /g) ?? []).length;
  const advance = glyphs * AVERAGE_GLYPH_ADVANCE * state.fontSize;
  const spacing = glyphs * state.charSpacing + spaces * state.wordSpacing;
  return (advance + spacing) * state.horizontalScale;
}

/**
 * Walks a content stream and returns positioned text runs plus image placements,
 * in stream order.
 *
 * @param content Decoded content-stream bytes.
 * @param fonts   Page font resources, keyed by resource name.
 */
export function extractPageOperations(
  content: Uint8Array,
  fonts: Map<string, PdfFontInfo>,
): PageOperations {
  const lexer = new PdfLexer(content, 0);
  const runs: TextRun[] = [];
  const images: ImagePlacement[] = [];

  let state = initialState();
  const stack: GraphicsState[] = [];
  const operands: PdfObject[] = [];

  // Text object state (§9.4.1): matrix and line matrix.
  let textMatrix: Matrix = IDENTITY;
  let lineMatrix: Matrix = IDENTITY;

  const font = (): PdfFontInfo | null =>
    state.fontKey === null ? null : (fonts.get(state.fontKey) ?? null);

  const numberAt = (index: number): number => {
    const object = operands[index];
    return object && object.kind === 'number' ? object.value : 0;
  };

  /** Emits a run for a shown string and advances the text matrix. */
  const showText = (bytes: Uint8Array): void => {
    const text = decodeString(bytes, font());
    if (text.length === 0) return;

    const rendered = multiply(textMatrix, state.ctm);
    // Effective font size after the text and current transformation matrices.
    const scaleY = Math.hypot(rendered[2], rendered[3]) || 1;
    const fontSize = Math.abs(state.fontSize * scaleY);

    const widthTextSpace = estimateWidth(text, state);
    const scaleX = Math.hypot(rendered[0], rendered[1]) || 1;

    runs.push({
      text,
      x: rendered[4],
      y: rendered[5],
      fontSize,
      width: widthTextSpace * scaleX,
    });

    // Advance the text matrix by the shown width (§9.4.4).
    textMatrix = multiply([1, 0, 0, 1, widthTextSpace, 0], textMatrix);
  };

  const nextLine = (leading: number): void => {
    lineMatrix = multiply([1, 0, 0, 1, 0, -leading], lineMatrix);
    textMatrix = [...lineMatrix] as Matrix;
  };

  let guard = 0;
  const maxIterations = content.length * 4 + 1000;

  while (!lexer.atEnd) {
    if (guard++ > maxIterations) break; // hard stop on pathological input

    lexer.skipWhitespace();
    if (lexer.atEnd) break;

    const byte = content[lexer.pos]!;

    // Operands are objects; operators are bare keywords.
    const isObjectStart =
      byte === 0x2f || // /
      byte === 0x28 || // (
      byte === 0x5b || // [
      byte === 0x3c || // <
      byte === 0x2b ||
      byte === 0x2d ||
      byte === 0x2e ||
      (byte >= 0x30 && byte <= 0x39);

    if (isObjectStart) {
      const before = lexer.pos;
      operands.push(lexer.parseObject());
      if (lexer.pos === before) lexer.pos++;
      if (operands.length > 64) operands.shift(); // bound memory on junk streams
      continue;
    }

    const op = lexer.readToken();
    if (op === '') break;

    switch (op) {
      case 'q':
        stack.push(cloneState(state));
        break;

      case 'Q': {
        const restored = stack.pop();
        if (restored) state = restored;
        break;
      }

      case 'cm': {
        const m: Matrix = [
          numberAt(operands.length - 6),
          numberAt(operands.length - 5),
          numberAt(operands.length - 4),
          numberAt(operands.length - 3),
          numberAt(operands.length - 2),
          numberAt(operands.length - 1),
        ];
        state.ctm = multiply(m, state.ctm);
        break;
      }

      case 'BT':
        textMatrix = IDENTITY;
        lineMatrix = IDENTITY;
        break;

      case 'ET':
        break;

      case 'Tf': {
        const nameObject = operands[operands.length - 2];
        state.fontKey = nameObject && nameObject.kind === 'name' ? nameObject.name : null;
        state.fontSize = numberAt(operands.length - 1);
        break;
      }

      case 'Td': {
        lineMatrix = multiply(
          [1, 0, 0, 1, numberAt(operands.length - 2), numberAt(operands.length - 1)],
          lineMatrix,
        );
        textMatrix = [...lineMatrix] as Matrix;
        break;
      }

      case 'TD': {
        const ty = numberAt(operands.length - 1);
        state.leading = -ty;
        lineMatrix = multiply([1, 0, 0, 1, numberAt(operands.length - 2), ty], lineMatrix);
        textMatrix = [...lineMatrix] as Matrix;
        break;
      }

      case 'Tm': {
        lineMatrix = [
          numberAt(operands.length - 6),
          numberAt(operands.length - 5),
          numberAt(operands.length - 4),
          numberAt(operands.length - 3),
          numberAt(operands.length - 2),
          numberAt(operands.length - 1),
        ];
        textMatrix = [...lineMatrix] as Matrix;
        break;
      }

      case 'T*':
        nextLine(state.leading);
        break;

      case 'TL':
        state.leading = numberAt(operands.length - 1);
        break;

      case 'Tc':
        state.charSpacing = numberAt(operands.length - 1);
        break;

      case 'Tw':
        state.wordSpacing = numberAt(operands.length - 1);
        break;

      case 'Tz':
        state.horizontalScale = numberAt(operands.length - 1) / 100 || 1;
        break;

      case 'Ts':
        state.rise = numberAt(operands.length - 1);
        break;

      case 'Tj': {
        const object = operands[operands.length - 1];
        if (object && object.kind === 'string') showText(object.bytes);
        break;
      }

      case "'": {
        nextLine(state.leading);
        const object = operands[operands.length - 1];
        if (object && object.kind === 'string') showText(object.bytes);
        break;
      }

      case '"': {
        state.wordSpacing = numberAt(operands.length - 3);
        state.charSpacing = numberAt(operands.length - 2);
        nextLine(state.leading);
        const object = operands[operands.length - 1];
        if (object && object.kind === 'string') showText(object.bytes);
        break;
      }

      case 'TJ': {
        const object = operands[operands.length - 1];
        if (object && object.kind === 'array') {
          for (const item of object.items) {
            if (item.kind === 'string') {
              showText(item.bytes);
            } else if (item.kind === 'number') {
              // Negative numbers move right by -n/1000 em: kerning and, when
              // large, an inter-word gap.
              const shift = (-item.value / 1000) * state.fontSize * state.horizontalScale;
              textMatrix = multiply([1, 0, 0, 1, shift, 0], textMatrix);
            }
          }
        }
        break;
      }

      case 'Do': {
        // Paints an XObject. The unit square is mapped through the CTM, so the
        // placement rectangle comes straight from the matrix in force here.
        const nameObject = operands[operands.length - 1];
        if (nameObject && nameObject.kind === 'name') {
          const ctm = state.ctm;
          const width = Math.abs(Math.hypot(ctm[0], ctm[1]));
          const height = Math.abs(Math.hypot(ctm[2], ctm[3]));

          // Only record something with real area: zero-size draws are clipping or
          // pattern setup, not content.
          if (width > 1 && height > 1) {
            images.push({
              resourceName: nameObject.name,
              x: ctm[4],
              // ctm[5] is the bottom edge (the unit square's origin); the top edge
              // is what compares meaningfully against text baselines.
              y: ctm[5] + height,
              width,
              height,
            });
          }
        }
        break;
      }

      default:
        // Any other operator (paths, colour, marked content) is irrelevant here.
        break;
    }

    operands.length = 0;
  }

  return { runs, images };
}

/**
 * Back-compatible helper: text runs only.
 *
 * Kept because most call sites and tests only care about text; image extraction is
 * an additional concern that not every caller needs to opt into.
 */
export function extractTextRuns(
  content: Uint8Array,
  fonts: Map<string, PdfFontInfo>,
): TextRun[] {
  return extractPageOperations(content, fonts).runs;
}

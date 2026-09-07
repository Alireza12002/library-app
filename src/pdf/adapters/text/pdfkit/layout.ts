/**
 * Positioned runs → plain page text.
 *
 * Groups text runs into visual lines by baseline, orders them top-to-bottom and
 * left-to-right, and inserts spaces where the horizontal gap between runs implies
 * one. The output is the page's reading text with line structure preserved, which
 * is exactly what the existing textParser consumes to build reflow blocks.
 *
 * Layer note: PDF technology behind the TextExtractionEngine port
 * (ARCHITECTURE.md §6).
 */
import type { ImagePlacement, TextRun } from './contentText';

/** A visual line: runs sharing a baseline, ordered left to right. */
interface Line {
  y: number;
  runs: TextRun[];
  maxFontSize: number;
}

/**
 * Baseline tolerance as a fraction of font size. Runs within this vertical
 * distance belong to the same line — superscripts and minor rounding must not
 * split a line, but a real new line must not merge.
 */
const BASELINE_TOLERANCE = 0.5;

/**
 * Horizontal gap, in fractions of font size, that implies a word space. PDF
 * writers routinely emit adjacent runs with no explicit space character.
 */
const SPACE_GAP_RATIO = 0.2;

/**
 * Vertical gap, in multiples of line height, that implies a paragraph break
 * rather than a wrapped line.
 */
const PARAGRAPH_GAP_RATIO = 1.6;

export interface LayoutOptions {
  /** Emit a blank line between blocks separated by a large vertical gap. */
  detectParagraphs?: boolean;
}

/**
 * Reconstructs page text from positioned runs.
 *
 * Returns text with `\n` between visual lines and `\n\n` where the vertical gap
 * indicates a paragraph boundary, so downstream parsing can distinguish a
 * wrapped line from a new paragraph.
 */
export function layoutRunsToText(runs: TextRun[], options: LayoutOptions = {}): string {
  const detectParagraphs = options.detectParagraphs ?? true;

  if (runs.length === 0) return '';

  const lines = groupIntoLines(runs);
  if (lines.length === 0) return '';

  // Reading order: top of page first. PDF Y grows upward, so descending Y.
  lines.sort((a, b) => b.y - a.y);

  const out: string[] = [];
  let previous: Line | null = null;

  for (const line of lines) {
    const text = joinRuns(line.runs);
    if (text.trim().length === 0) {
      previous = line;
      continue;
    }

    if (previous && detectParagraphs) {
      const gap = previous.y - line.y;
      const reference = Math.max(line.maxFontSize, previous.maxFontSize, 1);
      if (gap > reference * PARAGRAPH_GAP_RATIO) {
        out.push(''); // blank line ⇒ paragraph break for the parser
      }
    }

    out.push(text);
    previous = line;
  }

  return out.join('\n');
}

function groupIntoLines(runs: TextRun[]): Line[] {
  // Sort by descending Y so runs on a line arrive together.
  const sorted = [...runs].sort((a, b) => b.y - a.y);
  const lines: Line[] = [];

  for (const run of sorted) {
    if (run.text.length === 0) continue;

    const reference = Math.max(run.fontSize, 1);
    const tolerance = reference * BASELINE_TOLERANCE;
    const last = lines[lines.length - 1];

    if (last && Math.abs(last.y - run.y) <= tolerance) {
      last.runs.push(run);
      last.maxFontSize = Math.max(last.maxFontSize, run.fontSize);
      // Weighted baseline keeps the line's Y stable as runs accumulate.
      last.y = (last.y * (last.runs.length - 1) + run.y) / last.runs.length;
    } else {
      lines.push({ y: run.y, runs: [run], maxFontSize: run.fontSize });
    }
  }

  for (const line of lines) {
    line.runs.sort((a, b) => a.x - b.x);
  }

  return lines;
}

/** Concatenates one line's runs, inserting spaces where geometry implies them. */
function joinRuns(runs: TextRun[]): string {
  let out = '';
  let previousEnd: number | null = null;
  let previousFontSize = 0;

  for (const run of runs) {
    if (previousEnd !== null) {
      const gap = run.x - previousEnd;
      const reference = Math.max(run.fontSize, previousFontSize, 1);
      const endsWithSpace = /\s$/.test(out);
      const startsWithSpace = /^\s/.test(run.text);

      if (!endsWithSpace && !startsWithSpace && gap > reference * SPACE_GAP_RATIO) {
        out += ' ';
      }
    }

    out += run.text;
    previousEnd = run.x + run.width;
    previousFontSize = run.fontSize;
  }

  return out;
}

/**
 * Median body font size for a page, used by the reflow parser to decide which
 * lines are headings. Median rather than mean: headings and page numbers are
 * outliers that would drag an average.
 */
export function medianFontSize(runs: TextRun[]): number {
  const sizes = runs
    .filter((run) => run.text.trim().length > 0)
    .map((run) => run.fontSize)
    .sort((a, b) => a - b);

  if (sizes.length === 0) return 0;
  const middle = Math.floor(sizes.length / 2);
  return sizes.length % 2 === 0 ? (sizes[middle - 1]! + sizes[middle]!) / 2 : sizes[middle]!;
}

/**
 * One item of page content in reading order: either a run of text or an image.
 *
 * Segmenting the page this way is what lets images keep their place in the
 * narrative. Concatenating all text and appending images afterwards would put
 * every figure at the end of its page, which reads wrong.
 */
export type PageContentItem =
  | { kind: 'text'; text: string }
  | { kind: 'image'; resourceName: string; width: number; height: number };

/**
 * Interleaves text lines and image placements by vertical position.
 *
 * Both are sorted top-down (descending PDF Y) and merged, so an image between two
 * paragraphs lands between them in the output.
 */
export function layoutPageContent(
  runs: TextRun[],
  images: ImagePlacement[],
  options: LayoutOptions = {},
): PageContentItem[] {
  const detectParagraphs = options.detectParagraphs ?? true;

  const lines = groupIntoLines(runs).sort((a, b) => b.y - a.y);
  // Images are anchored by their top edge so they compare against line baselines.
  const sortedImages = [...images].sort((a, b) => b.y - a.y);

  const items: PageContentItem[] = [];
  let pending: string[] = [];
  let previous: Line | null = null;

  const flushText = (): void => {
    if (pending.length === 0) return;
    const text = pending.join('\n');
    if (text.trim().length > 0) items.push({ kind: 'text', text });
    pending = [];
    previous = null;
  };

  let imageIndex = 0;

  for (const line of lines) {
    // Emit any image that sits above this line.
    while (imageIndex < sortedImages.length && sortedImages[imageIndex]!.y > line.y) {
      const image = sortedImages[imageIndex]!;
      flushText();
      items.push({
        kind: 'image',
        resourceName: image.resourceName,
        width: image.width,
        height: image.height,
      });
      imageIndex++;
    }

    const text = joinRuns(line.runs);
    if (text.trim().length === 0) {
      previous = line;
      continue;
    }

    if (previous && detectParagraphs) {
      const gap = previous.y - line.y;
      const reference = Math.max(line.maxFontSize, previous.maxFontSize, 1);
      if (gap > reference * PARAGRAPH_GAP_RATIO) pending.push('');
    }

    pending.push(text);
    previous = line;
  }

  flushText();

  // Images below the last line of text.
  for (; imageIndex < sortedImages.length; imageIndex++) {
    const image = sortedImages[imageIndex]!;
    items.push({
      kind: 'image',
      resourceName: image.resourceName,
      width: image.width,
      height: image.height,
    });
  }

  return items;
}

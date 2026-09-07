/**
 * TextParser — converts raw PDF text into readable blocks.
 * Deterministic parsing only; no AI, no OCR.
 * ARCHITECTURE.md §6 (Phase 7 text processing).
 *
 * `TextBlock` itself lives in core/entities/reflowDocument, because the PDF ↔
 * reflow position mapping is domain logic and core/ may not import features/. It
 * is re-exported here so existing call sites keep working.
 */
import type { TextBlock } from '@/core/entities/reflowDocument';

export type { TextBlock } from '@/core/entities/reflowDocument';

export interface ParsedPage {
  pageIndex: number;
  blocks: TextBlock[];
}

/**
 * Parser options
 */
export interface TextParserOptions {
  /** Minimum line length to consider for header/footer detection (default: 3) */
  minHeaderFooterLength?: number;
  /** Maximum number of lines to check at page boundaries for repeated headers/footers (default: 3) */
  headerFooterScanLines?: number;
  /** Whether to attempt header/footer removal (default: true) */
  removeRepeatedHeadersFooters?: boolean;
}

/**
 * Default parser options
 */
const DEFAULT_OPTIONS: Required<TextParserOptions> = {
  minHeaderFooterLength: 3,
  headerFooterScanLines: 3,
  removeRepeatedHeadersFooters: true,
};

/**
 * Normalizes whitespace in a text string:
 * - Replaces all whitespace sequences with single spaces
 * - Trims leading/trailing whitespace
 */
function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Detects if a line looks like a page number (standalone number, possibly with dashes/parentheses)
 */
function isPageNumber(line: string): boolean {
  const trimmed = line.trim();
  // Match standalone numbers, possibly with dashes, parentheses, or "page" prefix
  return /^[\-\(\)]?\s*\d+\s*[\-\)]?$/.test(trimmed) || /^page\s+\d+$/i.test(trimmed);
}

/**
 * Detects if a line looks like a chapter/section header (short, title-case, no period at end)
 */
function isLikelyHeading(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.length > 80) return false;
  // Title Case or ALL CAPS, no trailing period, not just numbers
  const titleCase = /^[A-Z][a-z]+(\s+[A-Z][a-z]+)*$/;
  const allCaps = /^[A-Z][A-Z\s]+$/;
  const noPeriod = !trimmed.endsWith('.');
  return (titleCase.test(trimmed) || allCaps.test(trimmed)) && noPeriod;
}

/**
 * Detects if a line looks like a list item (starts with bullet, dash, number)
 */
function isListItem(line: string): boolean {
  const trimmed = line.trim();
  return /^[\-\*•]\s+/.test(trimmed) || /^\d+[\.\)]\s+/.test(trimmed);
}

/**
 * Detects if a line looks like a blockquote (starts with > or is indented quote)
 */
function isBlockquote(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith('>') || trimmed.startsWith('"');
}

/**
 * Attempts to detect and remove repeated headers/footers across pages.
 * Strategy: collect first/last N lines from each page, find lines that appear
 * on multiple pages in the same position, remove them.
 */
function removeRepeatedHeadersFooters(
  pages: ParsedPage[],
  options: Required<TextParserOptions>,
): ParsedPage[] {
  if (pages.length < 2) return pages;
  if (!options.removeRepeatedHeadersFooters) return pages;

  const scanLines = options.headerFooterScanLines;
  const minLength = options.minHeaderFooterLength;

  // Collect candidate headers (first N lines of each page) and footers (last N lines)
  const headerCandidates = new Map<string, number>(); // line -> count of pages it appears at top
  const footerCandidates = new Map<string, number>(); // line -> count of pages it appears at bottom

  for (const page of pages) {
    const lines = page.blocks
      .flatMap((b) => b.text.split('\n'))
      .filter((l) => l.trim().length >= minLength);

    // Headers: first N non-empty lines
    let headerCount = 0;
    for (const line of lines) {
      if (headerCount >= scanLines) break;
      if (!line) continue;
      if (isPageNumber(line)) continue; // Skip page numbers
      headerCandidates.set(line, (headerCandidates.get(line) || 0) + 1);
      headerCount++;
    }

    // Footers: last N non-empty lines
    let footerCount = 0;
    for (let i = lines.length - 1; i >= 0 && footerCount < scanLines; i--) {
      const line = lines[i];
      if (!line) continue;
      if (isPageNumber(line)) continue;
      footerCandidates.set(line, (footerCandidates.get(line) || 0) + 1);
      footerCount++;
    }
  }

  // Lines that appear on a MAJORITY of pages (>50%) are likely repeated headers/footers
  // For 2 pages: need 2 occurrences (both pages). For 3 pages: need 2 occurrences.
  const threshold = Math.floor(pages.length / 2) + 1;
  const repeatedHeaders = new Set<string>();
  const repeatedFooters = new Set<string>();

  for (const [line, count] of headerCandidates) {
    if (count >= threshold) repeatedHeaders.add(line);
  }
  for (const [line, count] of footerCandidates) {
    if (count >= threshold) repeatedFooters.add(line);
  }

  // Filter out repeated headers/footers from each page
  return pages.map((page) => {
    const filteredBlocks = page.blocks
      .map((block) => {
        const lines = block.text.split('\n').filter((l) => {
          const trimmed = l.trim();
          if (trimmed.length < minLength) return true; // Keep short lines (may be meaningful)
          return !repeatedHeaders.has(trimmed) && !repeatedFooters.has(trimmed);
        });
        return { ...block, text: lines.join('\n'), pageIndex: block.pageIndex };
      })
      .filter((block) => block.text.trim().length > 0);

    return { ...page, blocks: filteredBlocks };
  });
}

/**
 * Reconstructs paragraphs from broken lines.
 * Heuristic: lines that end without punctuation and the next line starts
 * with lowercase are likely continuations of the same paragraph.
 * Skips joining lines within code blocks.
 */
function reconstructParagraphs(
  lines: string[],
  codeBlockRanges: [number, number][] = [],
): string[] {
  const paragraphs: string[] = [];
  let currentParagraph = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const trimmed = line.trim();

    // Check if this line is within a code block
    const inCodeBlock = codeBlockRanges.some(([start, end]) => i >= start && i <= end);

    if (trimmed.length === 0 || inCodeBlock) {
      if (currentParagraph.length > 0) {
        paragraphs.push(currentParagraph.trim());
        currentParagraph = '';
      }
      if (inCodeBlock) {
        // Add the indented line as its own "paragraph" (will be classified as code)
        paragraphs.push(line);
      }
      continue;
    }

    // Check if this line continues the previous paragraph
    const prevEndsWithPunctuation = /[.!?]\s*$/.test(currentParagraph);
    const currStartsWithLowercase = /^[a-z]/.test(trimmed);

    if (currentParagraph.length > 0 && !prevEndsWithPunctuation && currStartsWithLowercase) {
      // Likely a broken line wrap — join with space
      currentParagraph += ' ' + trimmed;
    } else {
      // New paragraph
      if (currentParagraph.length > 0) {
        paragraphs.push(currentParagraph.trim());
      }
      currentParagraph = trimmed;
    }
  }

  if (currentParagraph.length > 0) {
    paragraphs.push(currentParagraph.trim());
  }

  return paragraphs;
}

/**
 * Classifies a paragraph into a block type based on content heuristics
 */
function classifyParagraph(
  text: string,
  paragraphIndex: number,
  codeBlockRanges: [number, number][] = [],
): TextBlock['type'] {
  const trimmed = text.trim();
  if (isListItem(trimmed)) return 'list_item';
  if (isBlockquote(trimmed)) return 'blockquote';
  if (isLikelyHeading(trimmed)) return 'heading';
  // Check if this paragraph corresponds to a code block (indented lines)
  // The paragraph index tracks the position in the reconstructed paragraphs
  // For now, check if the text starts with indentation
  if (/^( {4,}|\t)/.test(text) || trimmed.startsWith('```')) return 'code';
  return 'paragraph';
}

/**
 * Parses a single page's raw text into TextBlocks
 */
function parsePageText(
  pageIndex: number,
  rawText: string,
  options: Required<TextParserOptions>,
): ParsedPage {
  // Split into lines FIRST (preserve line structure for paragraph reconstruction)
  const lines = rawText.split('\n');

  // Detect code blocks before reconstruction (indented blocks)
  const codeBlockRanges = detectCodeBlocks(lines);

  // Reconstruct paragraphs from broken lines
  const paragraphs = reconstructParagraphs(lines, codeBlockRanges);

  // Classify each paragraph into blocks BEFORE normalization to preserve indentation for code detection
  const blocks: TextBlock[] = paragraphs.map((para, idx) => ({
    type: classifyParagraph(para, idx, codeBlockRanges),
    text: normalizeWhitespace(para), // Normalize after classification
    pageIndex,
  }));

  return { pageIndex, blocks };
}

/**
 * Detects code block ranges in the raw lines (consecutive lines starting with 4+ spaces or tab)
 * Returns array of [startLineIndex, endLineIndex] inclusive ranges
 */
function detectCodeBlocks(lines: string[]): [number, number][] {
  const ranges: [number, number][] = [];
  let inCodeBlock = false;
  let blockStart = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const isIndented = /^( {4,}|\t)/.test(line);
    const isEmpty = line.trim().length === 0;

    if (isIndented && !inCodeBlock) {
      inCodeBlock = true;
      blockStart = i;
    } else if ((!isIndented || isEmpty) && inCodeBlock) {
      inCodeBlock = false;
      ranges.push([blockStart, i - 1]);
      blockStart = -1;
    }
  }

  if (inCodeBlock && blockStart >= 0) {
    ranges.push([blockStart, lines.length - 1]);
  }

  return ranges;
}

/**
 * Main parse function — converts raw page texts into structured, readable blocks.
 *
 * Image markers (see ExtractedPageImage) are expanded into `image` blocks at the
 * position their marker line occupies, so figures keep their place in the reading
 * order instead of collecting at the end of a page.
 */
export function parseExtractedText(
  pageTexts: {
    pageIndex: number;
    text: string;
    images?: { marker: string; uri: string; width: number; height: number }[];
  }[],
  options: TextParserOptions = {},
): ParsedPage[] {
  const mergedOptions = { ...DEFAULT_OPTIONS, ...options };

  // Parse each page individually first. A page with no text but with images is
  // still meaningful content, so it must not be filtered out here.
  const pages: ParsedPage[] = pageTexts
    .filter((pt) => pt.text.trim().length > 0 || (pt.images?.length ?? 0) > 0)
    .map((pt) => parsePageText(pt.pageIndex, pt.text, mergedOptions));

  // Then attempt cross-page header/footer removal.
  const cleaned = removeRepeatedHeadersFooters(pages, mergedOptions);

  // Finally swap marker blocks for image blocks. Done last so header/footer
  // detection never sees a marker as a candidate line.
  return cleaned.map((page) => {
    const source = pageTexts.find((pt) => pt.pageIndex === page.pageIndex);
    const images = source?.images;
    if (!images || images.length === 0) return page;

    const byMarker = new Map(images.map((image) => [image.marker, image]));

    const blocks = page.blocks.map((block): TextBlock => {
      const image = byMarker.get(block.text.trim());
      if (!image) return block;
      return {
        type: 'image',
        text: '',
        pageIndex: block.pageIndex,
        image: { uri: image.uri, width: image.width, height: image.height },
      };
    });

    return { ...page, blocks };
  });
}

/**
 * Flattens parsed pages into a single array of blocks for continuous reading
 */
export function flattenParsedPages(pages: ParsedPage[]): TextBlock[] {
  return pages.flatMap((page) => page.blocks);
}

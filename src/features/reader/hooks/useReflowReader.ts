/**
 * useReflowReader — Reflow Reader state machine (ARCHITECTURE.md §3, L5).
 *
 * Owns: incremental text extraction, cache management, loading/error states.
 * The ReflowReader component renders; this decides.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { Book } from '@/core/entities/book';
import type { TextBlock } from '@/features/reader/textParser';
import type { TextExtractionSource } from '@/core/ports/textExtraction';
import { getServices } from '@/services';
import { getTextExtractionEngine } from '@/pdf/textEngine';

export interface ReflowReaderState {
  /** True while resolving the book and initial page count */
  isResolving: boolean;
  /** Fatal error — cannot proceed at all */
  fatal: string | null;
  /** Total page count (known after first extraction attempt or from PDF engine) */
  pageCount: number | null;
  /** Current extraction status */
  extractionStatus: 'idle' | 'loading' | 'partial' | 'complete' | 'error';
  /** Extracted text blocks in reading order (continuous) */
  blocks: TextBlock[];
  /** Pages that have been extracted and parsed */
  extractedPages: Set<number>;
  /** Current extraction error (if any) */
  extractionError: { page: number; message: string } | null;
  /** True if the PDF appears to have no extractable text (scanned) */
  isTextless: boolean;
  /** Current reading position in Reflow mode */
  readingPosition: ReflowReadingPosition | null;
}

export interface ReflowReadingPosition {
  /** Block index in the continuous blocks array */
  blockIndex: number;
  /** Character offset within the block (for sub-block precision) */
  charOffset: number;
  /** Scroll Y offset as fallback when text anchor is unreliable */
  scrollY: number;
  /** Source page index this position maps to */
  pageIndex: number;
  /** Text anchor: first ~50 chars of the block for verification on restore */
  textAnchor: string;
}

export interface UseReflowReaderResult {
  state: ReflowReaderState;
  /** Load more pages around a viewport (called by scroll listener) */
  ensurePagesLoaded: (startPage: number, endPage: number) => Promise<void>;
  /** Force re-extraction of a page (e.g., after cache invalidation) */
  refreshPage: (page: number) => Promise<void>;
  /** Clear all extracted state for this book */
  clear: () => void;
  /** Update reading position from scroll (called by scroll handler) */
  updateReadingPosition: (scrollY: number, visibleBlocks: { index: number; text: string }[]) => void;
  /** Restore reading position on mode re-entry */
  restoreReadingPosition: () => { blockIndex: number; charOffset: number; scrollY: number } | null;
}

const INITIAL_BATCH_SIZE = 5; // Pages to load initially

export function useReflowReader(
  book: Book | null,
  enabled: boolean
): UseReflowReaderResult {
  const [state, setState] = useState<ReflowReaderState>({
    isResolving: true,
    fatal: null,
    pageCount: null,
    extractionStatus: 'idle',
    blocks: [],
    extractedPages: new Set(),
    extractionError: null,
    isTextless: false,
    readingPosition: null,
  });

  const abortRef = useRef<AbortController | null>(null);
  const sourceRef = useRef<TextExtractionSource | null>(null);
  const extractionInFlightRef = useRef<Set<number>>(new Set());
  const engineRef = useRef(getTextExtractionEngine());

  const loadPages = useCallback(
    async (startPage: number, endPage: number) => {
      if (!sourceRef.current || !enabled) return;
      const { textExtraction } = await getServices();

      // Skip already extracted or in-flight pages
      const pagesToLoad: number[] = [];
      for (let p = startPage; p <= endPage; p++) {
        if (!state.extractedPages.has(p) && !extractionInFlightRef.current.has(p)) {
          pagesToLoad.push(p);
        }
      }

      if (pagesToLoad.length === 0) return;

      const firstPage = pagesToLoad[0]!;
      const lastPage = pagesToLoad[pagesToLoad.length - 1]!;

      // Mark as in-flight
      pagesToLoad.forEach((p) => extractionInFlightRef.current.add(p));
      setState((s) => ({ ...s, extractionStatus: 'loading' }));

      try {
        // Extract in batches (engine handles cache)
        const pages = await textExtraction.getParsedPageRange(
          sourceRef.current,
          firstPage,
          lastPage
        );

        if (abortRef.current?.signal.aborted) return;

        // Clear in-flight
        pagesToLoad.forEach((p) => extractionInFlightRef.current.delete(p));

        // Check if any page has text
        const allEmpty = pages.every((page) => page.blocks.length === 0);

        // Merge new blocks in page order
        const newBlocks = pages.flatMap((page) => page.blocks);
        const newExtractedPages = new Set(pages.map((p) => p.pageIndex));

        setState((s) => {
          // Check if we had any text before
          const hadText = s.blocks.length > 0;
          const mergedBlocks = [...s.blocks, ...newBlocks];

          // Determine extraction status
          let status: ReflowReaderState['extractionStatus'] = 'partial';
          if (s.pageCount !== null && newExtractedPages.size + s.extractedPages.size >= s.pageCount) {
            status = allEmpty && !hadText ? 'error' : 'complete';
          }

          return {
            ...s,
            blocks: mergedBlocks,
            extractedPages: new Set([...s.extractedPages, ...newExtractedPages]),
            extractionStatus: status,
            isTextless: allEmpty && !hadText && status === 'complete',
            extractionError: null,
          };
        });
      } catch (error) {
        if (abortRef.current?.signal.aborted) return;
        pagesToLoad.forEach((p) => extractionInFlightRef.current.delete(p));

        const message =
          error instanceof Error
            ? error.message
            : 'Failed to extract text from page';

        setState((s) => ({
          ...s,
          extractionStatus: 'error',
          extractionError: { page: pagesToLoad[0] ?? 0, message },
        }));
      }
    },
    [enabled, state.extractedPages]
  );

  // Create the TextExtractionSource from the book
  const source = useMemo((): TextExtractionSource | null => {
    if (!book) return null;
    return { kind: 'file', uri: book.fileUri };
  }, [book]);

  // Cleanup on unmount or book change
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, [book]);

  // Resolve page count and initial extraction when enabled and book changes
  useEffect(() => {
    if (!enabled || !book || !source) {
      setState((s) => ({ ...s, isResolving: !enabled }));
      return;
    }

    sourceRef.current = source;
    abortRef.current = new AbortController();

    async function resolve() {
      try {
        // Get page count from engine
        if (!source) return;
        const pageCount = await engineRef.current.getPageCount(source);
        if (abortRef.current?.signal.aborted) return;

        setState((s) => ({ ...s, pageCount, isResolving: false }));

        // Load initial batch
        await loadPages(0, Math.min(INITIAL_BATCH_SIZE, pageCount) - 1);
      } catch (error) {
        if (abortRef.current?.signal.aborted) return;
        setState((s) => ({
          ...s,
          isResolving: false,
          fatal:
            error instanceof Error
              ? error.message
              : 'Could not open this book for reflow reading.',
        }));
      }
    }

    void resolve();
  }, [enabled, book, source, loadPages]);

  const ensurePagesLoaded = useCallback(
    async (startPage: number, endPage: number) => {
      if (!enabled || !sourceRef.current) return;
      const pageCount = state.pageCount ?? 0;
      const clampedStart = Math.max(0, startPage);
      const clampedEnd = Math.min(pageCount - 1, endPage);
      if (clampedStart > clampedEnd) return;
      await loadPages(clampedStart, clampedEnd);
    },
    [enabled, state.pageCount, loadPages]
  );

  const refreshPage = useCallback(
    async (page: number) => {
      if (!enabled || !sourceRef.current) return;
      const { textExtraction } = await getServices();
      try {
        await textExtraction.invalidatePage(sourceRef.current, page);
        // Remove from extracted to trigger reload
        setState((s) => {
          const newExtracted = new Set(s.extractedPages);
          newExtracted.delete(page);
          const newBlocks = s.blocks.filter(
            (_, i) => !isPageInBlockIndex(i, page, s.extractedPages, pageCountToBlocks(s))
          );
          return { ...s, extractedPages: newExtracted, blocks: newBlocks };
        });
        await loadPages(page, page);
      } catch {
        // Ignore
      }
    },
    [enabled, loadPages]
  );

  const clear = useCallback(() => {
    setState({
      isResolving: true,
      fatal: null,
      pageCount: null,
      extractionStatus: 'idle',
      blocks: [],
      extractedPages: new Set(),
      extractionError: null,
      isTextless: false,
      readingPosition: null,
    });
    extractionInFlightRef.current.clear();
  }, []);

  // Update reading position based on scroll
  const updateReadingPosition = useCallback(
    (scrollY: number, visibleBlocks: { index: number; text: string }[]) => {
      if (visibleBlocks.length === 0) {
        // No visible blocks, just track scroll as fallback
        setState((s) => ({
          ...s,
          readingPosition: s.readingPosition
            ? { ...s.readingPosition, scrollY }
            : { blockIndex: 0, charOffset: 0, scrollY, pageIndex: 0, textAnchor: '' },
        }));
        return;
      }

      // Use the first visible block as the anchor (top of viewport)
      const anchorBlock = visibleBlocks[0]!;
      const textAnchor = anchorBlock.text.slice(0, 50);

      // Find the page index for this block
      let pageIndex = 0;
      // Rough estimation: assume blocks are roughly evenly distributed across pages
      if (state.extractedPages.size > 0) {
        const pagesArray = Array.from(state.extractedPages).sort((a, b) => a - b);
        const blocksPerPage = state.blocks.length / pagesArray.length;
        pageIndex = pagesArray[Math.floor(anchorBlock.index / Math.max(1, blocksPerPage))] ?? 0;
      }

      setState((s) => ({
        ...s,
        readingPosition: {
          blockIndex: anchorBlock.index,
          charOffset: 0,
          scrollY,
          pageIndex,
          textAnchor,
        },
      }));
    },
    [state.blocks.length, state.extractedPages])
  // Restore reading position on re-entry
  const restoreReadingPosition = useCallback((): {
    blockIndex: number;
    charOffset: number;
    scrollY: number;
  } | null => {
    const pos = state.readingPosition;
    if (!pos) return null;

    // Try to verify text anchor matches
    if (pos.blockIndex < state.blocks.length) {
      const block = state.blocks[pos.blockIndex]!;
      const currentAnchor = block.text.slice(0, 50);
      if (currentAnchor === pos.textAnchor) {
        // Anchor matches - restore exact position
        return { blockIndex: pos.blockIndex, charOffset: pos.charOffset, scrollY: pos.scrollY };
      }
    }

    // Anchor doesn't match - try to find by text search
    if (pos.textAnchor) {
      for (let i = 0; i < state.blocks.length; i++) {
        if (state.blocks[i]!.text.startsWith(pos.textAnchor)) {
          return { blockIndex: i, charOffset: pos.charOffset, scrollY: pos.scrollY ?? 0 };
        }
      }
    }

    // Fallback to scroll Y only
    return { blockIndex: 0, charOffset: 0, scrollY: pos.scrollY ?? 0 };
  }, [state.blocks, state.readingPosition]);

  return { state, ensurePagesLoaded, refreshPage, clear, updateReadingPosition, restoreReadingPosition };
}

// Helper: estimate page count from blocks (for filtering)
function pageCountToBlocks(state: ReflowReaderState): number {
  if (state.pageCount === null) return 0;
  // Rough heuristic: average blocks per page
  const avg = state.blocks.length / Math.max(1, state.extractedPages.size);
  return Math.ceil(state.pageCount * avg);
}

function isPageInBlockIndex(
  blockIndex: number,
  page: number,
  extractedPages: Set<number>,
  totalBlocks: number
): boolean {
  if (extractedPages.size === 0) return false;
  const pagesArray = Array.from(extractedPages).sort((a, b) => a - b);
  const pageIdx = pagesArray.indexOf(page);
  if (pageIdx === -1) return false;
  const blocksPerPage = totalBlocks / pagesArray.length;
  const start = Math.floor(pageIdx * blocksPerPage);
  const end = Math.ceil((pageIdx + 1) * blocksPerPage);
  return blockIndex >= start && blockIndex < end;
}
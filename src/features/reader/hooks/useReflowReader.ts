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

  // Mirrors of state that stable callbacks read without listing as dependencies.
  // Synced in an effect, never during render: assigning a ref while rendering
  // breaks under StrictMode's double render and concurrent re-entry. Effects
  // flush before any user interaction or scroll callback, so these are current
  // by the time anything reads them.
  const extractedPagesRef = useRef<Set<number>>(state.extractedPages);
  const pageCountRef = useRef<number | null>(state.pageCount);
  const blocksRef = useRef<TextBlock[]>(state.blocks);

  useEffect(() => {
    extractedPagesRef.current = state.extractedPages;
    pageCountRef.current = state.pageCount;
    blocksRef.current = state.blocks;
  }, [state.extractedPages, state.pageCount, state.blocks]);

  const loadPages = useCallback(
    async (startPage: number, endPage: number) => {
      if (!sourceRef.current || !enabled) return;
      const { textExtraction } = await getServices();

      // Skip already extracted or in-flight pages. Read the live extracted set
      // from a ref, not from state: depending on state.extractedPages here made
      // this callback's identity change on every extraction, which in turn
      // re-triggered the resolve effect that lists it as a dependency.
      const extracted = extractedPagesRef.current;
      const pagesToLoad: number[] = [];
      for (let p = startPage; p <= endPage; p++) {
        if (!extracted.has(p) && !extractionInFlightRef.current.has(p)) {
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
    [enabled]
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

  // Resolve page count and initial extraction when enabled and book changes.
  //
  // When NOT enabled (i.e. PDF mode is showing) this must be a true no-op. It
  // previously called setState with a spread on every run, which allocated a new
  // state object and forced an extra render of the whole reader screen even
  // though reflow was inert. The guard below bails out unless the flag actually
  // needs to move, so PDF mode pays nothing for this hook.
  useEffect(() => {
    if (!enabled || !book || !source) {
      setState((s) => (s.isResolving === !enabled ? s : { ...s, isResolving: !enabled }));
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
      // Page count from a ref: this callback is handed to ReflowReader's scroll
      // path, so its identity must not change every time a batch lands.
      const pageCount = pageCountRef.current ?? 0;
      const clampedStart = Math.max(0, startPage);
      const clampedEnd = Math.min(pageCount - 1, endPage);
      if (clampedStart > clampedEnd) return;
      await loadPages(clampedStart, clampedEnd);
    },
    [enabled, loadPages]
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

  // Update reading position based on scroll.
  //
  // This runs on the reflow scroll path, so it must be stable and must not read
  // state directly — depending on state.blocks/extractedPages gave it a new
  // identity on every extraction batch, which re-registered the scroll handler
  // mid-scroll.
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

      // Source page for this block. Prefer the block's own pageIndex — it is
      // recorded by the parser — instead of estimating from block distribution.
      const anchor = blocksRef.current[anchorBlock.index];
      const pageIndex = anchor?.pageIndex ?? 0;

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
    [],
  );

  // Restore reading position on re-entry.
  //
  // Reads state directly, NOT a ref mirror: ReflowReader calls this from an
  // effect, and a child's effects run before the parent's, so a ref synced in a
  // parent effect would still be stale here. The identity churn is harmless —
  // ReflowReader guards the call with a "already restored" ref, so the extra
  // effect runs do no work.
  const restoreReadingPosition = useCallback((): {
    blockIndex: number;
    charOffset: number;
    scrollY: number;
  } | null => {
    const pos = state.readingPosition;
    if (!pos) return null;

    const blocks = state.blocks;

    // Try to verify text anchor matches
    if (pos.blockIndex < blocks.length) {
      const block = blocks[pos.blockIndex]!;
      const currentAnchor = block.text.slice(0, 50);
      if (currentAnchor === pos.textAnchor) {
        // Anchor matches - restore exact position
        return { blockIndex: pos.blockIndex, charOffset: pos.charOffset, scrollY: pos.scrollY };
      }
    }

    // Anchor doesn't match - try to find by text search
    if (pos.textAnchor) {
      for (let i = 0; i < blocks.length; i++) {
        if (blocks[i]!.text.startsWith(pos.textAnchor)) {
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
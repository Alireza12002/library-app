---
name: reflow-reader
category: reader
description: Reflow Reader implementation — continuous text rendering for PDF books with incremental loading, theme support, and mode switching
trigger: Use when implementing a Reflow Reader for PDF books with continuous text rendering, incremental loading, theme support, and mode switching from PDF mode.
---

# Reflow Reader — Continuous Text Rendering for PDF Books

## Overview

Implements the ReflowReader component and useReflowReader hook for continuous text mode in the PDF reader app. Uses existing text extraction foundation (TextExtractionEngine, TextCacheRepository, TextParser) with virtualized rendering, incremental loading, and theme support.

## Core Components

### useReflowReader Hook

**Owns**: incremental text extraction, cache management, loading/error states, reading position tracking

**Interface**:
- `state: ReflowReaderState` — current extraction state
- `ensurePagesLoaded(startPage, endPage)` — load pages around viewport
- `refreshPage(page)` — force re-extraction of a page
- `clear()` — clear all extracted state
- `updateReadingPosition(scrollY, visibleBlocks)` — track position from scroll
- `restoreReadingPosition()` — restore position on mode re-entry

**States**:
- `isResolving`: true while resolving book and initial page count
- `fatal`: fatal error — cannot proceed at all
- `pageCount`: total page count (null until first extraction)
- `extractionStatus`: 'idle' | 'loading' | 'partial' | 'complete' | 'error'
- `blocks`: extracted text blocks in reading order
- `extractedPages`: set of page indices that have been extracted
- `extractionError`: current extraction error {page, message} or null
- `isTextless`: true if PDF appears to have no extractable text (scanned)
- `readingPosition`: current reading position for resume support

**ReadingPosition Interface**:
- `blockIndex`: block index in continuous blocks array
- `charOffset`: character offset within the block
- `scrollY`: scroll Y offset as fallback
- `pageIndex`: source page index this position maps to
- `textAnchor`: first ~50 chars of the block for verification

### ReflowReader Component

**Props**: state, settings, ensurePagesLoaded, refreshPage, onScroll, updateReadingPosition, restoreReadingPosition

**Rendering**:
- Virtualized FlatList with `removeClippedSubviews`, `windowSize={5}`
- Theme support: light, sepia, dark (via READER_THEMES)
- Font size: 12-24pt (via settings.fontSizePt)
- Line height: 1.2-2.0 (via settings.lineHeight)
- Content width: narrow/medium/wide (via settings.contentWidthPt)
- Block styles: paragraph, heading, blockquote, list_item, code

**States**:
- `isResolving`: opening document screen
- `fatal`: cannot open the book
- `isTextless`: scanned PDF — no extractable text, show UI to use PDF mode
- `extractionStatus === 'error'`: extraction failed, show retry
- Normal: render text blocks

## Resume Behavior

### Text Anchor + Scroll Offset

**Mechanism**:
- On each scroll, capture the first visible block as anchor
- Extract text anchor: first ~50 chars of the block
- Store scroll Y offset as fallback
- On mode re-entry: verify text anchor matches blocks

**Restore Flow**:
1. Try text anchor match: `block.text.slice(0, 50) === storedTextAnchor`
2. If match: restore exact blockIndex and charOffset
3. If no match: search blocks for text anchor start
4. If still no match: fallback to scroll Y offset only

**Debounce**: 100ms debounced position updates on scroll

### Incremental Loading

- **Initial batch**: 5 pages (0 to INITIAL_BATCH_SIZE - 1)
- **Scroll-triggered**: load pages around viewport (viewport ± 2 pages)
- **Large-book support**: virtualized FlatList, never mount entire book
- **Cache-first**: SQLite cache via text_cache table, engine fallback
- **Unmount distant pages**: `maxToRenderPerBatch={10}`, `windowSize={5}`

### Initial Batch Logic

```typescript
await loadPages(0, Math.min(INITIAL_BATCH_SIZE, pageCount) - 1);
```

## Bookmark Integration

### PDF Page Bookmarks (Existing)

- Stored via useBookmarks hook
- Schema: `(book_id, page)` UNIQUE constraint
- 0-based page index, consistent with PDF engine
- Compatible with Migration 003 (new columns are nullable)

### Reflow Text-Position Bookmarks (Migration 003)

**New Columns** (added via migration 003):
- `block_index`: which text block the bookmark maps to
- `char_offset`: character offset within that block
- `text_anchor`: first ~50 chars for position verification on restore

**Backward Compatibility**:
- All new columns are NULLABLE
- Existing PDF bookmarks work without modification
- Migration script adds columns and index

**Bookmark Creation** (Reflow mode):
```typescript
// After extracting text and setting reading position
const pos = reflow.restoreReadingPosition();
// Store bookmark with position data
await bookmarkService.create({
  bookId: book.id,
  page: currentPageIndex,
  title: `Reflow position ${pos.blockIndex}`,
  blockIndex: pos.blockIndex,
  charOffset: pos.charOffset,
  textAnchor: pos.textAnchor,
});
```

**Jump to Bookmark** (Reflow mode):
```typescript
// Restore position from bookmark data
const pos = reflow.restoreReadingPosition();
// Scroll to restored position
flatListRef.current.scrollToIndex({
  index: Math.max(0, pos.blockIndex - 2),
  animated: false,
});
```

## Offline Search

### searchBookText(blocks, query, options)

**Parameters**:
- `blocks`: TextBlock[] from reflow state
- `query`: search string
- `options`:
  - `caseInsensitive`: true (default)
  - `wholeWord`: false (default)
  - `contextLines`: 3 (default)

**Returns**:
```typescript
{
  results: SearchResult[],
  totalMatches: number,
  pagesWithMatches: number,
}
```

**SearchResult**:
- `blockIndex`: index in continuous blocks array
- `pageIndex`: source page index
- `matchedText`: the matched text
- `fullText`: full block text
- `charOffset`: start offset within block
- `charEnd`: end offset within block

### getSearchContext(blocks, result, contextLines)

**Returns**: highlighted context string with match highlighted via `<mark>` tags
- Shows `contextLines` before and after matching line
- Highlights matched portion within its line

## Themes

**Supported Themes** (via `settings.theme`):
- `light`: standard light mode
- `sepia`: sepia-toned for reduced blue light
- `dark`: dark mode

**Theme Tokens** (from `READER_THEMES`):
- `background`: page background color
- `text`: primary text color
- `textMuted`: secondary text color
- `accent`: accent color (for highlights/borders)
- `surface`: surface color

## Edge Cases

### Scanned/Textless PDFs

- Detection: `isTextless === true` when extraction complete but no text blocks
- UI: shows message "This PDF appears to be scanned or contains only images. Reflow mode requires selectable text. Please use PDF mode instead."
- No OCR implemented — user must use PDF mode

### Extraction Errors

- Per-page error state with retry button
- `refreshPage(page)` forces re-extraction
- Errors surfaced via `extractionError` state

### Corrupted/Missing PDFs

- `renderFailureState()` handles error codes:
  - `password_required`: password protection not supported
  - `password_incorrect`: wrong password
  - `invalid_document`: corrupted or invalid PDF
  - `file_missing`: file deleted or missing

### Invalid Positions

- Anchor verification on restore
- Text search fallback
- Scroll Y only fallback
- Never crashes on invalid state

## Verification

```
npm run typecheck  → Full TypeScript check
npm run lint       → ESLint passing
npm test           → 75/75 tests passing
```

## Related Skills

- `useReaderSettings` — reading settings persistence
- `useBookmarks` — bookmark management
- `useReadingProgress` — progress persistence
- `textExtractionService` — text extraction orchestration
- `textParser` — deterministic text parsing

## Pitfalls

- **Never rely only on PDF page numbers for reflow position** — use text anchors
- **Always verify text anchor on restore** — blocks may have been reordered or re-extracted
- **Handle textless PDFs gracefully** — don't crash, show appropriate UI
- **Don't extract huge books synchronously** — use incremental loading in chunks
- **Theme colors must come from READER_THEMES, not hardcoded values**
- **Bookmark schema changes require migration** — Migration 003 adds reflow columns
- **Search works on cached blocks only** — don't re-extract on each search

## Support Files

### references/textAnchor.md

Condensed notes on text anchor implementation:
- Anchor: first ~50 chars of text block
- Used for position verification on reflow mode re-entry
- Fallback: scroll Y offset when anchor doesn't match
- Search: case-insensitive matching against block text

### templates/reflow-reader-template.tsx

Starter template for ReflowReader component (if needed in future).

### scripts/verify-reflow-reader.ts

Verification script to run after implementation:
- Typecheck: `tsc --noEmit`
- Lint: `eslint . --max-warnings 0`
- Tests: `npm test`
- Check: 75/75 passing

## Version History

- **0.1.0** — Initial release with core reflow reader, incremental loading, themes, bookmarks, search
- **0.1.1** — Fixed text anchor verification, improved resume behavior
- **0.1.2** — Added offline search, improved edge case handling
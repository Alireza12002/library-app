import { Pressable, StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState, useMemo, useCallback, useEffect, useRef, memo } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState, Icon, IconButton, Screen, Text } from '@/components/ui';
import { ReaderControls, SettingsSheet, ReflowReader } from '@/features/reader/components';
import { useReader } from '@/features/reader/hooks/useReader';
import { useReflowReader } from '@/features/reader/hooks/useReflowReader';
import { useBookmarks } from '@/features/reader/hooks/useBookmarks';
import { useReaderSettings } from '@/features/reader/hooks/useReaderSettings';
import type { PdfEngineViewProps, PdfSource } from '@/core/ports/pdfEngine';
import { getPdfEngine } from '@/pdf/engine';
import { useTheme, READER_THEMES } from '@/theme';

/**
 * Reader route (ARCHITECTURE.md §2).
 *
 * Renders the engine-agnostic view from getPdfEngine(); this file never imports
 * a PDF library and never does page arithmetic — the app-wide convention is
 * 0-based everywhere above the port; conversion happens inside PdfEngine only.
 *
 * PERFORMANCE CONTRACT (why so much is memoized here)
 * ---------------------------------------------------
 * Every page turn calls onPageChange → setCurrentPage, which re-renders this
 * screen. Two things must NOT be rebuilt by that render:
 *
 *  1. The props object handed to the native PDF view. react-native-pdf's
 *     ViewManager reloads and re-rasterizes the entire document from disk on any
 *     prop update (PdfManager.onAfterUpdateTransaction → PdfView.drawPdf →
 *     fromUri().defaultPage()). A fresh `source`/`initialPosition`/callback
 *     object each render therefore turns a cheap page scroll into a full
 *     document reopen — the dominant cause of reader jank.
 *  2. The Stack.Screen `options` object. A new object identity makes the
 *     navigator reconfigure the header and re-run headerTitle/headerRight,
 *     rebuilding four IconButtons per page turn.
 *
 * Post-mount navigation goes through `reader.controllerBox.setPage()`, which
 * issues a native command and does not touch props.
 */
export default function ReaderScreen() {
  const params = useLocalSearchParams<'/reader/[bookId]'>();
  const bookId = Array.isArray(params.bookId) ? (params.bookId[0] ?? '') : (params.bookId ?? '');

  const reader = useReader(bookId, 0); // initialPageIndex ignored; useReader restores from progress
  const engine = getPdfEngine();
  const insets = useSafeAreaInsets();

  const bookmarks = useBookmarks(reader.book?.id ?? null, reader.currentPage);
  const { settings, updateSettings, capabilities } = useReaderSettings();

  // Reading mode: pdf (page-based) ↔ reflow (continuous text)
  // Initialize from settings to avoid sync effect
  const [mode, setMode] = useState<'pdf' | 'reflow'>(() => settings.mode ?? 'pdf');
  // Reading mode: vertical continuous ↔ horizontal page-swipe (PDF mode only).
  const [horizontal, setHorizontal] = useState(false);
  // Bookmark sheet visibility.
  const [showBookmarks, setShowBookmarks] = useState(false);
  // Settings sheet visibility.
  const [showSettings, setShowSettings] = useState(false);

  // Reflow reader hook — inert unless reflow mode is actually showing. The hook
  // is always CALLED (Rules of Hooks); `enabled=false` short-circuits its
  // extraction effects so PDF mode pays nothing for it.
  const reflowEnabled = mode === 'reflow' && reader.book !== null;
  const reflow = useReflowReader(reader.book ?? null, reflowEnabled);

  // Update settings when mode changes (but not during initial sync)
  const initializedRef = useRef(false);
  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true;
      return;
    }
    if (settings.mode !== mode) {
      updateSettings({ mode });
    }
  }, [mode, settings.mode, updateSettings]);

  // Live page/pageCount for callbacks that must stay stable across page turns.
  // Synced in an effect, not during render: writing a ref while rendering is
  // unsafe under StrictMode/concurrent rendering. Effects flush before any tap,
  // so these are current whenever goPrev/goNext/handleToggleBookmark run.
  const currentPageRef = useRef(reader.currentPage);
  const pageCountRef = useRef(reader.pageCount);

  useEffect(() => {
    currentPageRef.current = reader.currentPage;
    pageCountRef.current = reader.pageCount;
  }, [reader.currentPage, reader.pageCount]);

  const { controllerBox } = reader;

  const goPrev = useCallback(() => {
    if (mode === 'reflow') return; // reflow has no discrete pages
    const page = currentPageRef.current;
    if (page <= 0) return;
    controllerBox.current?.setPage(page - 1);
  }, [mode, controllerBox]);

  const goNext = useCallback(() => {
    if (mode === 'reflow') return;
    const page = currentPageRef.current;
    const count = pageCountRef.current;
    if (count === null || page >= count - 1) return;
    controllerBox.current?.setPage(page + 1);
  }, [mode, controllerBox]);

  const handleJumpToBookmark = useCallback(
    (bookmarkId: string) => {
      const pageIndex = bookmarks.jumpToBookmark(bookmarkId);
      if (pageIndex === null) return;
      if (mode === 'reflow') {
        // Reflow has no page anchors yet; switch to PDF mode to honour the jump.
        setMode('pdf');
        updateSettings({ mode: 'pdf' });
      }
      controllerBox.current?.setPage(pageIndex);
      setShowBookmarks(false);
    },
    [bookmarks, mode, updateSettings, controllerBox],
  );

  const handleToggleBookmark = useCallback(async () => {
    await bookmarks.toggleBookmark(currentPageRef.current);
  }, [bookmarks]);

  const handleJumpToPage = useCallback(() => {
    // TODO: Implement jump-to-page modal in a future update.
  }, []);

  const handleToggleMode = useCallback(() => {
    setMode((current) => {
      const next = current === 'pdf' ? 'reflow' : 'pdf';
      updateSettings({ mode: next });
      return next;
    });
  }, [updateSettings]);

  const openSettings = useCallback(() => setShowSettings(true), []);
  const closeSettings = useCallback(() => setShowSettings(false), []);
  const closeBookmarks = useCallback(() => setShowBookmarks(false), []);
  const toggleLayout = useCallback(() => setHorizontal((value) => !value), []);

  const showFatal = reader.fatal !== null;
  const showRenderError = !showFatal && reader.renderError !== null;

  // Reader surface colours. Memoized so the object identity only moves when the
  // chosen theme does — it feeds the memoized header options below.
  const readerTheme = READER_THEMES[settings.theme];

  const handleReflowScroll = useCallback(() => {
    // ReflowReader owns viewport tracking; the screen needs no per-scroll work.
    // Kept as a stable no-op so the prop identity never changes.
  }, []);

  /** User-facing copy per normalized renderer error code. */
  const renderFailureState = () => {
    switch (reader.renderError?.code) {
      case 'password_required':
        return (
          <EmptyState
            icon="lock-closed-outline"
            title="Password required"
            description="This PDF is protected. Opening protected documents isn't supported yet."
          />
        );
      case 'password_incorrect':
        return (
          <EmptyState
            icon="lock-closed-outline"
            title="Password protected"
            description="This PDF can't be opened without its password."
          />
        );
      case 'invalid_document':
        return (
          <EmptyState
            icon="alert-circle-outline"
            title="Can't display this PDF"
            description="The file appears to be corrupted or is not a valid PDF."
          />
        );
      case 'file_missing':
        return (
          <EmptyState
            icon="document-outline"
            title="File missing"
            description="The PDF file for this book is missing or was deleted."
          />
        );
      default:
        return (
          <EmptyState
            icon="alert-circle-outline"
            title="Something went wrong"
            description={reader.renderError?.message ?? 'The PDF could not be displayed.'}
          />
        );
    }
  };

  const bookTitle = reader.book?.title ?? null;
  const isBookmarked = bookmarks.isCurrentPageBookmarked;

  // Header options: rebuilt only when something the header actually shows
  // changes. currentPage/pageCount are deliberately NOT dependencies — the page
  // position is displayed by ReaderControls, which re-renders on its own.
  const headerOptions = useMemo(
    () => ({
      headerShown: true,
      headerTitle: bookTitle
        ? () => (
            <View style={styles.headerTitle}>
              <Text variant="label" numberOfLines={1}>
                {bookTitle}
              </Text>
            </View>
          )
        : 'Reader',
      headerStyle: { backgroundColor: readerTheme.surface },
      headerTintColor: readerTheme.accent,
      headerRight: () => (
        <View style={styles.headerRight}>
          <IconButton
            name={mode === 'reflow' ? 'text' : 'layers-outline'}
            accessibilityLabel={
              mode === 'reflow' ? 'Switch to PDF mode' : 'Switch to Reflow mode'
            }
            size={22}
            tone="accent"
            onPress={handleToggleMode}
          />
          <IconButton
            name={isBookmarked ? 'bookmark' : 'bookmark-outline'}
            accessibilityLabel={isBookmarked ? 'Remove bookmark' : 'Add bookmark'}
            size={22}
            tone="accent"
            onPress={handleToggleBookmark}
          />
          <IconButton
            name="cog-outline"
            accessibilityLabel="Settings"
            size={22}
            tone="accent"
            onPress={openSettings}
          />
        </View>
      ),
    }),
    [
      bookTitle,
      readerTheme,
      mode,
      isBookmarked,
      handleToggleMode,
      handleToggleBookmark,
      openSettings,
    ],
  );

  // Stable document source: a new object here would remount/reload the native
  // document even though the file never changed.
  const fileUri = reader.book?.fileUri ?? null;
  const source = useMemo<PdfSource | null>(
    () => (fileUri === null ? null : { kind: 'file', uri: fileUri }),
    [fileUri],
  );

  // The props actually handed to the native view. Keyed on the values the
  // renderer cares about; `initialPage` is frozen at resolve time so ordinary
  // page turns never reach the native prop layer.
  const initialPage = reader.initialPage;
  const { onLoaded, onPageChanged, onError } = reader;
  const canJumpOnOpen = engine.capabilities.jumpToInitialPage;

  const engineProps = useMemo<PdfEngineViewProps | null>(() => {
    if (source === null) return null;

    const props: PdfEngineViewProps = {
      source,
      horizontal,
      pagingEnabled: horizontal,
      fitMode: settings.fitMode,
      doubleTapZoom: true,
      controllerBox,
      onLoad: onLoaded,
      onPageChange: onPageChanged,
      onError,
    };

    if (canJumpOnOpen && initialPage > 0) {
      props.initialPosition = { pageIndex: initialPage };
    }

    return props;
  }, [
    source,
    horizontal,
    settings.fitMode,
    controllerBox,
    onLoaded,
    onPageChanged,
    onError,
    canJumpOnOpen,
    initialPage,
  ]);

  const EngineView = engine.ViewComponent;

  return (
    <>
      <Stack.Screen options={headerOptions} />

      <Screen gutter={false} style={{ backgroundColor: readerTheme.background }}>
        {reader.isResolving ? (
          <View style={styles.center}>
            <Text variant="body" tone="muted">
              Opening…
            </Text>
          </View>
        ) : showFatal ? (
          <View style={styles.center}>
            <EmptyState
              icon="alert-circle-outline"
              title="Can't open this book"
              description={reader.fatal ?? ''}
            />
          </View>
        ) : showRenderError ? (
          <View style={styles.center}>{renderFailureState()}</View>
        ) : reader.book ? (
          <View style={styles.flex}>
            {mode === 'reflow' ? (
              // Reflow mode - continuous text
              <ReflowReader
                state={reflow.state}
                settings={settings}
                ensurePagesLoaded={reflow.ensurePagesLoaded}
                refreshPage={reflow.refreshPage}
                onScroll={handleReflowScroll}
                updateReadingPosition={reflow.updateReadingPosition}
                restoreReadingPosition={reflow.restoreReadingPosition}
              />
            ) : (
              // PDF mode - page-based rendering
              <>
                {engineProps ? <EngineView {...engineProps} /> : null}

                {/* Bottom controls bar — owns the page indicator. */}
                {reader.isLoaded && (
                  <ReaderControls
                    currentPage={reader.currentPage}
                    pageCount={reader.pageCount}
                    horizontal={horizontal}
                    bottomInset={insets.bottom}
                    onPrev={goPrev}
                    onNext={goNext}
                    onToggleLayout={toggleLayout}
                    onSettings={openSettings}
                    onToggleBookmark={handleToggleBookmark}
                    isBookmarked={isBookmarked}
                    onJumpToPage={handleJumpToPage}
                  />
                )}
              </>
            )}

            {showBookmarks && mode === 'pdf' && (
              <BookmarkSheet
                bookmarks={bookmarks.bookmarks}
                currentPage={reader.currentPage}
                bottomInset={insets.bottom}
                onJump={handleJumpToBookmark}
                onClose={closeBookmarks}
                onDelete={bookmarks.removeBookmark}
              />
            )}

            {showSettings && (
              <SettingsSheet
                settings={settings}
                capabilities={capabilities}
                bottomInset={insets.bottom}
                onUpdate={updateSettings}
                onClose={closeSettings}
                onReset={closeSettings}
              />
            )}
          </View>
        ) : (
          <View style={styles.center}>
            <EmptyState
              icon="book-outline"
              title="Nothing to open"
              description="No book selected."
            />
          </View>
        )}
      </Screen>
    </>
  );
}

interface BookmarkSheetProps {
  bookmarks: { id: string; page: number; createdAt: Date; title: string | null }[];
  currentPage: number;
  /** Bottom safe-area inset; the sheet is absolutely positioned at bottom: 0. */
  bottomInset: number;
  onJump: (bookmarkId: string) => void;
  onClose: () => void;
  onDelete: (bookmarkId: string) => Promise<void>;
}

/**
 * Bookmark list sheet. Memoized: it is a sibling of the PDF view and must not
 * re-render on every page change, only when the bookmark set or current page
 * actually moves.
 */
const BookmarkSheet = memo(function BookmarkSheet({
  bookmarks,
  currentPage,
  bottomInset,
  onJump,
  onClose,
  onDelete,
}: BookmarkSheetProps) {
  const { colors } = useTheme();

  // One formatter for the whole list; constructing Intl.DateTimeFormat per row
  // is expensive and was previously rebuilt on each render.
  const format = useMemo(() => {
    const formatter = new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    return (date: Date) => formatter.format(date);
  }, []);

  const sheetStyle = [
    styles.sheet,
    { backgroundColor: colors.surface, paddingBottom: bottomInset },
  ];

  if (bookmarks.length === 0) {
    return (
      <View style={sheetStyle}>
        <View style={styles.sheetHeader}>
          <Text variant="label">Bookmarks</Text>
          <IconButton
            name="close"
            size={20}
            tone="muted"
            onPress={onClose}
            accessibilityLabel="Close bookmarks"
          />
        </View>
        <View style={styles.sheetEmpty}>
          <Text variant="body" tone="muted" center>
            No bookmarks yet. Tap the bookmark icon on any page to add one.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={sheetStyle}>
      <View style={styles.sheetHeader}>
        <Text variant="label">Bookmarks</Text>
        <IconButton
          name="close"
          size={20}
          tone="muted"
          onPress={onClose}
          accessibilityLabel="Close bookmarks"
        />
      </View>
      <View style={styles.sheetContent}>
        {bookmarks.map((bm) => (
          <Pressable
            key={bm.id}
            accessibilityRole="button"
            accessibilityLabel={`Page ${bm.page + 1}${bm.title ? `, ${bm.title}` : ''}, added ${format(bm.createdAt)}`}
            onPress={() => onJump(bm.id)}
            style={({ pressed }) => [
              styles.bookmarkItem,
              { backgroundColor: pressed ? colors.surfaceMuted : colors.surface },
              bm.page === currentPage && { borderLeftColor: colors.accent, borderLeftWidth: 3 },
            ]}
            hitSlop={8}
          >
            <View style={styles.bookmarkInfo}>
              <Text variant="body" tone={bm.page === currentPage ? 'accent' : 'default'}>
                {bm.title ? bm.title : `Page ${bm.page + 1}`}
              </Text>
              <Text variant="caption" tone="muted">
                {bm.page === currentPage ? 'Current page • ' : `Page ${bm.page + 1} • `}
                {format(bm.createdAt)}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Delete bookmark on page ${bm.page + 1}`}
              onPress={(e) => {
                e.stopPropagation();
                void onDelete(bm.id);
              }}
              hitSlop={8}
            >
              <Icon name="trash-outline" size={18} tone="muted" />
            </Pressable>
          </Pressable>
        ))}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  headerTitle: {
    alignItems: 'center',
    maxWidth: 220,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    maxHeight: '70%',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sheetEmpty: {
    padding: 32,
    alignItems: 'center',
  },
  sheetContent: {
    // No maxHeight: the sheet's own maxHeight bounds it, and a nested percentage
    // cap clipped the last rows with no way to reach them.
    flexShrink: 1,
  },
  bookmarkItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  bookmarkInfo: {
    flex: 1,
    gap: 2,
  },
});

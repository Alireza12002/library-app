import { Pressable, StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState, useMemo, useCallback, useEffect, useRef } from 'react';

import { EmptyState, Icon, IconButton, Screen, Text } from '@/components/ui';
import { ReaderControls, SettingsSheet, ReflowReader } from '@/features/reader/components';
import { useReader } from '@/features/reader/hooks/useReader';
import { useReflowReader } from '@/features/reader/hooks/useReflowReader';
import { useBookmarks } from '@/features/reader/hooks/useBookmarks';
import { useReaderSettings } from '@/features/reader/hooks/useReaderSettings';
import type { PdfEngineViewProps } from '@/core/ports/pdfEngine';
import { getPdfEngine } from '@/pdf/engine';
import { useTheme, READER_THEMES } from '@/theme';

/**
 * Reader route (ARCHITECTURE.md §2).
 *
 * Renders the engine-agnostic view from getPdfEngine(); this file never imports
 * a PDF library and never does page arithmetic — the app-wide convention is
 * 0-based everywhere above the port; conversion happens inside PdfEngine only.
 *
 * Resume page comes from persisted reading progress (Book.lastPage).
 * Reader settings (theme, fit mode, layout) are persisted via useReaderSettings.
 * Supports both PDF mode and Reflow mode.
 */
export default function ReaderScreen() {
  const params = useLocalSearchParams<'/reader/[bookId]'>();
  const bookId = Array.isArray(params.bookId) ? (params.bookId[0] ?? '') : (params.bookId ?? '');

  const reader = useReader(bookId, 0); // initialPageIndex ignored; useReader restores from progress
  const engine = getPdfEngine();

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

  // Reflow reader hook - only active when mode is 'reflow'
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

  const goPrev = () => {
    if (mode === 'reflow') {
      // In reflow mode, we don't have pages in the same way
      // Could scroll up by viewport height
      return;
    }
    if (reader.currentPage <= 0) return;
    reader.controllerBox.current?.setPage(reader.currentPage - 1);
  };

  const goNext = () => {
    if (mode === 'reflow') {
      // In reflow mode, we don't have pages in the same way
      return;
    }
    if (reader.pageCount === null || reader.currentPage >= reader.pageCount - 1) return;
    reader.controllerBox.current?.setPage(reader.currentPage + 1);
  };

  const handleJumpToBookmark = (bookmarkId: string) => {
    const pageIndex = bookmarks.jumpToBookmark(bookmarkId);
    if (pageIndex !== null) {
      if (mode === 'reflow') {
        // In reflow mode, we'd need to scroll to the position of that page
        // For now, just switch to PDF mode to jump
        setMode('pdf');
        updateSettings({ mode: 'pdf' });
      }
      reader.controllerBox.current?.setPage(pageIndex);
      setShowBookmarks(false);
    }
  };

  const handleToggleBookmark = async () => {
    await bookmarks.toggleBookmark(reader.currentPage);
  };

  const handleJumpToPage = () => {
    // TODO: Implement jump-to-page modal in a future update
    // For now, this is a placeholder
  };

  const handleToggleMode = () => {
    const newMode = mode === 'pdf' ? 'reflow' : 'pdf';
    setMode(newMode);
    updateSettings({ mode: newMode });
  };

  /** User-facing copy per normalized renderer error code. */
  function renderFailureState() {
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
  }

  const showFatal = reader.fatal !== null;
  const showRenderError = !showFatal && reader.renderError !== null;

  // Map theme to reader surface colors
  const readerTheme = READER_THEMES[settings.theme];

  // Handle scroll for reflow reader incremental loading
  const handleReflowScroll = useCallback(
    (event: { nativeEvent: { contentOffset: { y: number } } }) => {
      // Trigger loading more pages based on scroll position
      // The ReflowReader hook uses the onScroll to determine viewport
      // We could also calculate visible page range here
    },
    []
  );

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: reader.book?.title
            ? () => (
                <View style={styles.headerTitle}>
                  <Text variant="label" numberOfLines={1}>
                    {reader.book?.title}
                  </Text>
                  {reader.isLoaded && reader.pageCount !== null ? (
                    <Text variant="tiny" tone="muted">
                      Page {reader.currentPage + 1} of {reader.pageCount}
                    </Text>
                  ) : null}
                </View>
              )
            : 'Reader',
          headerStyle: { backgroundColor: readerTheme.surface },
          headerTintColor: readerTheme.accent,
          headerRight: () => (
            <View style={styles.headerRight}>
              <IconButton
                name={mode === 'reflow' ? 'text' : 'layers-outline'}
                accessibilityLabel={mode === 'reflow' ? 'Switch to PDF mode' : 'Switch to Reflow mode'}
                size={22}
                tone="accent"
                onPress={handleToggleMode}
              />
              <IconButton
                name={bookmarks.isCurrentPageBookmarked ? 'bookmark' : 'bookmark-outline'}
                accessibilityLabel={
                  bookmarks.isCurrentPageBookmarked ? 'Remove bookmark' : 'Add bookmark'
                }
                size={22}
                tone="accent"
                onPress={handleToggleBookmark}
              />
              <IconButton
                name="cog-outline"
                accessibilityLabel="Settings"
                size={22}
                tone="accent"
                onPress={() => setShowSettings(true)}
              />
            </View>
          ),
        }}
      />

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
                {(() => {
                  const engineProps: PdfEngineViewProps = {
                    source: { kind: 'file', uri: reader.book.fileUri },
                    horizontal,
                    pagingEnabled: horizontal,
                    fitMode: settings.fitMode,
                    doubleTapZoom: true,
                    controllerBox: reader.controllerBox,
                    onLoad: reader.onLoaded,
                    onPageChange: reader.onPageChanged,
                    onError: reader.onError,
                  };
                  // initialPosition handled by useReader via restored page
                  if (engine.capabilities.jumpToInitialPage && reader.currentPage > 0) {
                    engineProps.initialPosition = { pageIndex: reader.currentPage };
                  }
                  return <engine.ViewComponent {...engineProps} />;
                })()}

                {/* Bottom controls bar */}
                {reader.isLoaded && (
                  <ReaderControls
                    currentPage={reader.currentPage}
                    pageCount={reader.pageCount}
                    horizontal={horizontal}
                    onPrev={goPrev}
                    onNext={goNext}
                    onToggleLayout={() => setHorizontal((value) => !value)}
                    onSettings={() => setShowSettings(true)}
                    onToggleBookmark={handleToggleBookmark}
                    isBookmarked={bookmarks.isCurrentPageBookmarked}
                    onJumpToPage={handleJumpToPage}
                  />
                )}
              </>
            )}

            {showBookmarks && mode === 'pdf' && (
              <BookmarkSheet
                bookmarks={bookmarks.bookmarks}
                currentPage={reader.currentPage}
                onJump={handleJumpToBookmark}
                onClose={() => setShowBookmarks(false)}
                onDelete={bookmarks.removeBookmark}
              />
            )}

            {showSettings && (
              <SettingsSheet
                settings={settings}
                capabilities={capabilities}
                onUpdate={updateSettings}
                onClose={() => setShowSettings(false)}
                onReset={() => {
                  // Reset is handled by the SettingsSheet internally
                  // We just close the sheet
                  setShowSettings(false);
                }}
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
  onJump: (bookmarkId: string) => void;
  onClose: () => void;
  onDelete: (bookmarkId: string) => Promise<void>;
}

function BookmarkSheet({ bookmarks, currentPage, onJump, onClose, onDelete }: BookmarkSheetProps) {
  const { colors } = useTheme();
  const { format } = useMemo(
    () => ({
      format: (date: Date) => {
        const formatter = new Intl.DateTimeFormat(undefined, {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });
        return formatter.format(date);
      },
    }),
    [],
  );

  if (bookmarks.length === 0) {
    return (
      <View style={[styles.sheet, { backgroundColor: colors.surface }]}>
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
    <View style={[styles.sheet, { backgroundColor: colors.surface }]}>
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
}

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
  pageBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 4,
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
    maxHeight: '60%',
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

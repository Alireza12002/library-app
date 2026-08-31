/**
 * ReflowReader — continuous text rendering for Reflow mode.
 *
 * Uses FlatList for virtualized rendering of text blocks.
 * Handles themes, font size, line height, content width.
 * No OCR — works only with extractable text.
 */
import { FlatList, StyleSheet, View, Text, TouchableOpacity, ActivityIndicator, type ViewToken } from 'react-native';
import { useMemo, useCallback, useRef, useEffect } from 'react';

import { Screen } from '@/components/ui';
import { useTheme, READER_THEMES, type ReaderThemeTokens } from '@/theme';
import type { TextBlock } from '@/features/reader/textParser';
import type { ReflowReaderState } from '@/features/reader/hooks/useReflowReader';
import type { ReadingSettings } from '@/core/entities/readingSettings';

interface ReflowReaderProps {
  state: ReflowReaderState;
  settings: ReadingSettings;
  ensurePagesLoaded: (startPage: number, endPage: number) => Promise<void>;
  refreshPage: (page: number) => Promise<void>;
  onScroll: (event: { nativeEvent: { contentOffset: { y: number } } }) => void;
  updateReadingPosition: (scrollY: number, visibleBlocks: { index: number; text: string }[]) => void;
  restoreReadingPosition: () => { blockIndex: number; charOffset: number; scrollY: number } | null;
}

const BLOCK_TYPES_WITH_MARGIN = ['paragraph', 'heading', 'blockquote', 'list_item'] as const;

function getBlockStyle(
  type: TextBlock['type'],
  settings: ReadingSettings,
  theme: ReaderThemeTokens
): object {
  const base = {
    fontFamily: settings.fontFamily === 'system' ? undefined : settings.fontFamily,
    fontSize: settings.fontSizePt,
    lineHeight: settings.fontSizePt * settings.lineHeight,
    color: theme.text,
    maxWidth: settings.contentWidthPt ?? '100%',
  };

  switch (type) {
    case 'heading':
      return {
        ...base,
        fontWeight: '600' as const,
        fontSize: settings.fontSizePt * 1.25,
        marginTop: 24,
        marginBottom: 12,
      };
    case 'blockquote':
      return {
        ...base,
        fontStyle: 'italic' as const,
        borderLeftWidth: 3,
        borderLeftColor: theme.accent,
        paddingLeft: 12,
        marginLeft: 12,
        opacity: 0.85,
        marginTop: 12,
        marginBottom: 12,
      };
    case 'list_item':
      return {
        ...base,
        marginTop: 6,
        marginBottom: 6,
        marginLeft: 24,
      };
    case 'code':
      return {
        ...base,
        fontFamily: 'monospace',
        backgroundColor: theme.surface,
        padding: 8,
        borderRadius: 4,
        marginTop: 8,
        marginBottom: 8,
      };
    case 'paragraph':
    default:
      return {
        ...base,
        marginTop: BLOCK_TYPES_WITH_MARGIN.includes(type) ? 12 : 0,
        marginBottom: BLOCK_TYPES_WITH_MARGIN.includes(type) ? 12 : 0,
      };
  }
}

function RenderBlock({
  block,
  index,
  settings,
  theme,
}: {
  block: TextBlock;
  index: number;
  settings: ReadingSettings;
  theme: ReaderThemeTokens;
}) {
  const style = getBlockStyle(block.type, settings, theme);

  // For list items, add a bullet
  if (block.type === 'list_item') {
    return (
      <View style={[{ flexDirection: 'row', alignItems: 'flex-start' }, style]} key={index}>
        <Text style={{ ...style, marginRight: 8, marginTop: 2 }}>•</Text>
        <Text style={style} numberOfLines={0}>{block.text}</Text>
      </View>
    );
  }

  return <Text key={index} style={style} numberOfLines={0}>{block.text}</Text>;
}

function LoadingIndicator() {
  const { colors } = useTheme();
  return (
    <View style={styles.loadingContainer}>
      <ActivityIndicator color={colors.accent} size="large" />
      <Text style={[styles.loadingText, { color: colors.textMuted }]}>
        Extracting text…
      </Text>
    </View>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.errorContainer, { backgroundColor: colors.surface }]}>
      <Text style={[styles.errorTitle, { color: colors.text }]}>Extraction failed</Text>
      <Text style={[styles.errorMessage, { color: colors.textMuted }]}>{message}</Text>
      <TouchableOpacity style={styles.errorButton} onPress={onRetry}>
        <Text style={[styles.errorButtonText, { color: colors.accent }]}>Retry</Text>
      </TouchableOpacity>
    </View>
  );
}

function TextlessState() {
  const { colors } = useTheme();
  return (
    <View style={[styles.textlessContainer, { backgroundColor: colors.surface }]}>
      <Text style={[styles.textlessTitle, { color: colors.text }]}>No extractable text</Text>
      <Text style={[styles.textlessMessage, { color: colors.textMuted }]}>
        This PDF appears to be scanned or contains only images.
        Reflow mode requires selectable text. Please use PDF mode instead.
      </Text>
    </View>
  );
}

export function ReflowReader({
  state,
  settings,
  ensurePagesLoaded,
  refreshPage,
  onScroll,
  updateReadingPosition,
  restoreReadingPosition,
}: ReflowReaderProps) {
  const theme = useMemo(() => READER_THEMES[settings.theme], [settings.theme]);
  const contentWidth = useMemo(
    () => (settings.contentWidthPt ? settings.contentWidthPt : '90%'),
    [settings.contentWidthPt]
  );

  const flatListRef = useRef<FlatList<TextBlock> | null>(null);
  const restoredRef = useRef(false);

  // Restore reading position on first render after content is loaded
  useEffect(() => {
    if (state.blocks.length > 0 && !restoredRef.current && state.extractionStatus !== 'loading') {
      restoredRef.current = true;
      const restored = restoreReadingPosition();
      if (restored && flatListRef.current) {
        // Scroll to the restored position
        flatListRef.current.scrollToIndex({
          index: Math.max(0, restored.blockIndex - 2), // Show a couple blocks before for context
          animated: false,
        });
      }
    }
  }, [state.blocks.length, state.extractionStatus, restoreReadingPosition]);

  // Track visible blocks for reading position updates
  const viewableItemsRef = useRef<{ index: number; text: string }[]>([]);
  const onViewableItemsChanged = useCallback(
    (info: { viewableItems: ViewToken<TextBlock>[]; changed: ViewToken<TextBlock>[] }) => {
      const visibleBlocks = info.viewableItems
        .map((vi) => ({ index: vi.index ?? 0, text: vi.item.text }))
        .filter((v) => v.index !== undefined)
        .sort((a, b) => a.index - b.index);
      viewableItemsRef.current = visibleBlocks;
    },
    []
  );

  // Debounced reading position update
  const scrollUpdateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleScroll = useCallback(
    (event: { nativeEvent: { contentOffset: { y: number } } }) => {
      onScroll(event);
      const scrollY = event.nativeEvent.contentOffset.y;

      // Debounce position updates
      if (scrollUpdateTimerRef.current) {
        clearTimeout(scrollUpdateTimerRef.current);
      }
      scrollUpdateTimerRef.current = setTimeout(() => {
        updateReadingPosition(scrollY, viewableItemsRef.current);
      }, 100);
    },
    [onScroll, updateReadingPosition]
  );

  // Render loading state
  if (state.isResolving) {
    return (
      <Screen gutter={false} style={{ backgroundColor: theme.background }}>
        <View style={styles.centered}>
          <ActivityIndicator color={theme.accent} size="large" />
          <Text style={[styles.loadingText, { color: theme.textMuted, marginTop: 12 }]}>
            Opening document…
          </Text>
        </View>
      </Screen>
    );
  }

  if (state.fatal) {
    return (
      <Screen gutter={false} style={{ backgroundColor: theme.background }}>
        <View style={[styles.centered, { padding: 24 }]}>
          <Text style={[styles.errorTitle, { color: theme.text }]}>Cannot open</Text>
          <Text style={[styles.errorMessage, { color: theme.textMuted, marginTop: 8 }]}>
            {state.fatal}
          </Text>
        </View>
      </Screen>
    );
  }

  // Show textless state if extraction complete but no text found
  if (state.extractionStatus === 'complete' && state.isTextless) {
    return (
      <Screen gutter={false} style={{ backgroundColor: theme.background }}>
        <View style={styles.centered}>
          <TextlessState />
        </View>
      </Screen>
    );
  }

  // Show error state if extraction failed
  if (state.extractionStatus === 'error' && state.extractionError) {
    return (
      <Screen gutter={false} style={{ backgroundColor: theme.background }}>
        <View style={styles.centered}>
          <ErrorState
            message={state.extractionError.message}
            onRetry={() => refreshPage(state.extractionError!.page)}
          />
        </View>
      </Screen>
    );
  }

  // Render content with FlatList for virtualization
  return (
    <Screen
      gutter={false}
      style={{
        backgroundColor: theme.background,
        flex: 1,
      }}
    >
      <FlatList
        ref={flatListRef}
        data={state.blocks}
        keyExtractor={(_, index) => `block-${index}`}
        renderItem={({ item, index }) => (
          <RenderBlock block={item} index={index} settings={settings} theme={theme} />
        )}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListHeaderComponent={
          state.extractionStatus === 'loading' || state.extractionStatus === 'partial'
            ? <LoadingIndicator />
            : null
        }
        ListFooterComponent={
          state.extractionStatus !== 'complete'
            ? <LoadingIndicator />
            : <View style={styles.footer} />
        }
        onScroll={handleScroll}
        onViewableItemsChanged={onViewableItemsChanged}
        scrollEventThrottle={16}
        removeClippedSubviews={true}
        maxToRenderPerBatch={10}
        windowSize={5}
        initialNumToRender={20}
        contentContainerStyle={[
          styles.content,
          { paddingHorizontal: '5%', maxWidth: typeof contentWidth === 'number' ? contentWidth : undefined },
        ]}
        showsVerticalScrollIndicator={true}
        persistentScrollbar={false}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  content: {
    paddingTop: 24,
    paddingBottom: 48,
    alignItems: 'center',
  },
  separator: {
    height: 0, // Text margins handle spacing
  },
  footer: {
    height: 48,
  },
  loadingContainer: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  loadingText: {
    fontSize: 14,
    marginTop: 8,
  },
  errorContainer: {
    alignItems: 'center',
    padding: 24,
    borderRadius: 12,
    marginHorizontal: 24,
    marginTop: 24,
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  errorMessage: {
    fontSize: 14,
    marginTop: 8,
    marginBottom: 16,
    textAlign: 'center',
  },
  errorButton: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
  },
  errorButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  textlessContainer: {
    alignItems: 'center',
    padding: 24,
    borderRadius: 12,
    marginHorizontal: 24,
    marginTop: 24,
  },
  textlessTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  textlessMessage: {
    fontSize: 14,
    marginTop: 8,
    textAlign: 'center',
    lineHeight: 20,
  },
});
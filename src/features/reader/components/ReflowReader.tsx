/**
 * ReflowReader — continuous text rendering for Reflow mode.
 *
 * Virtualized FlatList of text blocks. Handles themes, font size, line height
 * and content width. No OCR — works only with extractable text.
 *
 * PERFORMANCE CONTRACT
 * --------------------
 * Every value that reaches a row is memoized at this level, because the list can
 * hold thousands of blocks:
 *
 *  - `getBlockStyle` used to run per row per render and allocate a fresh style
 *    object each time. Styles now come from one memoized lookup table keyed by
 *    block type, built only when the theme or typography settings change.
 *  - `renderItem` / `keyExtractor` / separators / footers are stable, so
 *    FlatList's own row memoization can bail out instead of re-rendering every
 *    realized row on each parent render.
 *  - Rows are wrapped in React.memo (`RenderBlock`), so a scroll that changes
 *    nothing about a row costs nothing.
 *  - `onScroll` is a plain JS handler at 16ms throttle; it does no layout work,
 *    only a debounced position update.
 */
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type ListRenderItemInfo,
  type TextStyle,
  type ViewToken,
} from 'react-native';
import { memo, useCallback, useEffect, useMemo, useRef } from 'react';

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

type BlockType = TextBlock['type'];
type BlockStyles = Record<BlockType, TextStyle>;

/**
 * Builds one style object per block type. Called once per theme/typography
 * change instead of once per row per render.
 */
function buildBlockStyles(settings: ReadingSettings, theme: ReaderThemeTokens): BlockStyles {
  const base: TextStyle = {
    fontFamily: settings.fontFamily === 'system' ? undefined : settings.fontFamily,
    fontSize: settings.fontSizePt,
    lineHeight: settings.fontSizePt * settings.lineHeight,
    color: theme.text,
  };

  return {
    paragraph: { ...base, marginTop: 12, marginBottom: 12 },
    heading: {
      ...base,
      fontWeight: '600',
      fontSize: settings.fontSizePt * 1.25,
      lineHeight: settings.fontSizePt * 1.25 * settings.lineHeight,
      marginTop: 24,
      marginBottom: 12,
    },
    list_item: { ...base, marginTop: 6, marginBottom: 6, marginLeft: 24 },
    code: {
      ...base,
      fontFamily: 'monospace',
      backgroundColor: theme.surface,
      padding: 8,
      borderRadius: 4,
      marginTop: 8,
      marginBottom: 8,
    },
    blockquote: {
      ...base,
      fontStyle: 'italic',
      borderLeftWidth: 3,
      borderLeftColor: theme.accent,
      paddingLeft: 12,
      marginLeft: 12,
      opacity: 0.85,
      marginTop: 12,
      marginBottom: 12,
    },
  };
}

interface RenderBlockProps {
  block: TextBlock;
  blockStyles: BlockStyles;
}

/**
 * One text block. Memoized on (block, blockStyles) — both stable across scrolls,
 * so realized rows do not re-render while the list moves.
 */
const RenderBlock = memo(function RenderBlock({ block, blockStyles }: RenderBlockProps) {
  const style = blockStyles[block.type] ?? blockStyles.paragraph;

  if (block.type === 'list_item') {
    return (
      <View style={styles.listRow}>
        <Text style={[style, styles.bullet]}>•</Text>
        <Text style={[style, styles.listText]}>{block.text}</Text>
      </View>
    );
  }

  return <Text style={style}>{block.text}</Text>;
});

function LoadingIndicator() {
  const { colors } = useTheme();
  return (
    <View style={styles.loadingContainer}>
      <ActivityIndicator color={colors.accent} size="small" />
      <Text style={[styles.loadingText, { color: colors.textMuted }]}>Extracting text…</Text>
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
        This PDF appears to be scanned or contains only images. Reflow mode requires selectable
        text. Please use PDF mode instead.
      </Text>
    </View>
  );
}

export function ReflowReader({
  state,
  settings,
  refreshPage,
  onScroll,
  updateReadingPosition,
  restoreReadingPosition,
}: ReflowReaderProps) {
  const theme = useMemo(() => READER_THEMES[settings.theme], [settings.theme]);

  // One style table for the whole list; rebuilt only when the reading typography
  // or theme actually changes.
  const blockStyles = useMemo(() => buildBlockStyles(settings, theme), [settings, theme]);

  const flatListRef = useRef<FlatList<TextBlock> | null>(null);
  const restoredRef = useRef(false);

  const contentWidth = settings.contentWidthPt > 0 ? settings.contentWidthPt : undefined;

  // Restore reading position once, after content first arrives.
  useEffect(() => {
    if (restoredRef.current) return;
    if (state.blocks.length === 0) return;
    if (state.extractionStatus === 'loading') return;

    restoredRef.current = true;
    const restored = restoreReadingPosition();
    if (restored && flatListRef.current) {
      flatListRef.current.scrollToIndex({
        // A couple of blocks of lead-in for context.
        index: Math.max(0, Math.min(restored.blockIndex - 2, state.blocks.length - 1)),
        animated: false,
      });
    }
  }, [state.blocks.length, state.extractionStatus, restoreReadingPosition]);

  // Visible rows, tracked for the reading-position anchor.
  const viewableItemsRef = useRef<{ index: number; text: string }[]>([]);
  const onViewableItemsChanged = useCallback(
    (info: { viewableItems: ViewToken<TextBlock>[] }) => {
      const visible: { index: number; text: string }[] = [];
      for (const token of info.viewableItems) {
        if (token.index === null || token.index === undefined) continue;
        visible.push({ index: token.index, text: token.item.text });
      }
      visible.sort((a, b) => a.index - b.index);
      viewableItemsRef.current = visible;
    },
    [],
  );

  // Debounced position write. The scroll handler itself does no work beyond
  // reading contentOffset, so it cannot stall the scroll.
  const scrollUpdateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleScroll = useCallback(
    (event: { nativeEvent: { contentOffset: { y: number } } }) => {
      onScroll(event);
      const scrollY = event.nativeEvent.contentOffset.y;

      if (scrollUpdateTimerRef.current) clearTimeout(scrollUpdateTimerRef.current);
      scrollUpdateTimerRef.current = setTimeout(() => {
        updateReadingPosition(scrollY, viewableItemsRef.current);
      }, 150);
    },
    [onScroll, updateReadingPosition],
  );

  useEffect(
    () => () => {
      if (scrollUpdateTimerRef.current) clearTimeout(scrollUpdateTimerRef.current);
    },
    [],
  );

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<TextBlock>) => (
      <RenderBlock block={item} blockStyles={blockStyles} />
    ),
    [blockStyles],
  );

  // Blocks carry their source page, so index-based keys are stable for a given
  // extraction order and cheap to compute.
  const keyExtractor = useCallback(
    (item: TextBlock, index: number) => `${item.pageIndex}-${index}`,
    [],
  );

  const isStreaming = state.extractionStatus !== 'complete';
  const listFooter = useMemo(
    () => (isStreaming ? <LoadingIndicator /> : <View style={styles.footer} />),
    [isStreaming],
  );

  const contentContainerStyle = useMemo(
    () => [styles.content, contentWidth ? { maxWidth: contentWidth } : null],
    [contentWidth],
  );

  const onScrollToIndexFailed = useCallback(() => {
    // Restore target not laid out yet; fall back to the top rather than throwing.
    flatListRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, []);

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
        <View style={[styles.centered, styles.centeredPadded]}>
          <Text style={[styles.errorTitle, { color: theme.text }]}>Cannot open</Text>
          <Text style={[styles.errorMessage, { color: theme.textMuted, marginTop: 8 }]}>
            {state.fatal}
          </Text>
        </View>
      </Screen>
    );
  }

  // Extraction finished with nothing to show: scanned/image-only document.
  const isTextless =
    state.extractionStatus === 'complete' && (state.isTextless || state.blocks.length === 0);
  if (isTextless) {
    return (
      <Screen gutter={false} style={{ backgroundColor: theme.background }}>
        <View style={styles.centered}>
          <TextlessState />
        </View>
      </Screen>
    );
  }

  if (state.extractionStatus === 'error' && state.extractionError) {
    const failedPage = state.extractionError.page;
    return (
      <Screen gutter={false} style={{ backgroundColor: theme.background }}>
        <View style={styles.centered}>
          <ErrorState
            message={state.extractionError.message}
            onRetry={() => void refreshPage(failedPage)}
          />
        </View>
      </Screen>
    );
  }

  return (
    <Screen gutter={false} style={{ backgroundColor: theme.background, flex: 1 }}>
      <FlatList
        ref={flatListRef}
        data={state.blocks}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        ListFooterComponent={listFooter}
        onScroll={handleScroll}
        onViewableItemsChanged={onViewableItemsChanged}
        onScrollToIndexFailed={onScrollToIndexFailed}
        scrollEventThrottle={16}
        contentContainerStyle={contentContainerStyle}
        showsVerticalScrollIndicator
        // Virtualization: text rows are light, so a small window keeps memory
        // low while staying ahead of the scroll. removeClippedSubviews detaches
        // offscreen rows from the native view tree on Android.
        removeClippedSubviews
        initialNumToRender={12}
        maxToRenderPerBatch={8}
        updateCellsBatchingPeriod={50}
        windowSize={7}
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
  centeredPadded: {
    padding: 24,
  },
  content: {
    paddingTop: 24,
    paddingBottom: 48,
    // Percentage padding keeps the measure comfortable at any width without
    // assuming a device size.
    paddingHorizontal: '5%',
    // Centres the column when maxWidth caps it on wide screens.
    alignSelf: 'center',
    width: '100%',
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  bullet: {
    marginRight: 8,
    marginTop: 2,
    marginLeft: 0,
  },
  listText: {
    flex: 1,
    marginLeft: 0,
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

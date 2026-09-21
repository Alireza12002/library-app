/**
 * ReflowReader — responsive, ebook-style rendering of the whole-book reflow
 * document.
 *
 * This is NOT a scaled PDF page. It renders the structured block model produced by
 * the extraction pipeline (PDF → content streams → positioned runs → parsed blocks)
 * as ordinary React Native Text, so lines wrap to the device width, the font size
 * is independent of the original page scale, and there is no horizontal scrolling.
 * Rotating or resizing the window reflows the text, because the measure derives
 * from the live window width.
 *
 * POSITION — DIRECT OPEN, NO SCROLL
 * ---------------------------------
 * The document arrives whole, so entering at a given PDF page is a matter of the
 * block index resolved from the document's page map. The list is then mounted with
 * that block as its FIRST item: the virtualized list's data window starts at the
 * target (`getItem(i)` = `blocks[windowStart + i]`), so the target sits at content
 * offset 0 and the reader appears there on its first frame. There is no
 * `initialScrollIndex`, no `scrollTo`, no measurement-dependent offset estimate,
 * and no rows 0..target-1 rendered first.
 *
 * Why not `initialScrollIndex`: rows are variable-height text and the list has no
 * `getItemLayout`, so the list can only ESTIMATE the target offset from the average
 * measured row height — which is 0 at mount. It therefore lands wrong, corrects on
 * later frames (and via `onScrollToIndexFailed` retries), and the user sees the
 * content jump/scroll into place. Starting the window at the target removes the
 * estimate entirely.
 *
 * Reading backwards: when the user reaches the top of the window, a chunk of
 * earlier blocks is prepended (`onStartReached`) and `maintainVisibleContentPosition`
 * keeps the block they are looking at fixed on screen — keys are the ABSOLUTE
 * block index, so the list can identify that block across the prepend.
 *
 * The topmost visible block (absolute index) is reported back so the screen can
 * map the position to a PDF page and persist the Reflow position.
 *
 * PERFORMANCE
 * -----------
 * A book is thousands of blocks, so everything a row touches is precomputed: block
 * styles come from one memoized table keyed by block type; renderItem/keyExtractor
 * are stable so the list's row memoization can bail out; rows are React.memo; the
 * data window is a view over the block array (no copies on prepend); and the
 * visible-block report writes to a ref rather than state.
 */
import {
  ActivityIndicator,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  VirtualizedList,
  useWindowDimensions,
  type ListRenderItemInfo,
  type TextStyle,
  type ViewToken,
} from 'react-native';
import { memo, useCallback, useMemo, useState } from 'react';

import { Screen } from '@/components/ui';
import { useTheme, READER_THEMES, type ReaderThemeTokens } from '@/theme';
import type { TextBlock } from '@/core/entities/reflowDocument';
import type { ReflowReaderState } from '@/features/reader/hooks/useReflowReader';
import type { ReadingSettings } from '@/core/entities/readingSettings';
import { readingColumnWidth, scaleImageToColumn } from '@/features/reader/readingLayout';

interface ReflowReaderProps {
  state: ReflowReaderState;
  settings: ReadingSettings;
  /** Reports the topmost visible block so position can be mapped to a PDF page. */
  onVisibleBlockChange: (blockIndex: number) => void;
  /** Discards the stored document and processes the book again. */
  onRegenerate: () => void;
}

/**
 * Text styles per block type. Image blocks are laid out, not typeset, so they are
 * excluded here and sized by the renderer from the reading column width.
 */
type BlockStyles = Record<Exclude<TextBlock['type'], 'image'>, TextStyle>;

/**
 * Builds one style per block type from the reading settings.
 *
 * Called only when the theme or typography changes — not per row, per render.
 */
function buildBlockStyles(settings: ReadingSettings, theme: ReaderThemeTokens): BlockStyles {
  const base: TextStyle = {
    fontFamily: settings.fontFamily === 'system' ? undefined : settings.fontFamily,
    fontSize: settings.fontSizePt,
    lineHeight: settings.fontSizePt * settings.lineHeight,
    color: theme.text,
  };

  const headingSize = settings.fontSizePt * 1.3;

  return {
    paragraph: { ...base, marginBottom: settings.fontSizePt },
    heading: {
      ...base,
      fontSize: headingSize,
      lineHeight: headingSize * Math.max(1.2, settings.lineHeight - 0.15),
      fontWeight: '700',
      marginTop: settings.fontSizePt * 1.5,
      marginBottom: settings.fontSizePt * 0.6,
    },
    list_item: { ...base, marginBottom: settings.fontSizePt * 0.4 },
    code: {
      ...base,
      fontFamily: 'monospace',
      fontSize: settings.fontSizePt * 0.9,
      lineHeight: settings.fontSizePt * 0.9 * settings.lineHeight,
      backgroundColor: theme.surface,
      padding: settings.fontSizePt * 0.6,
      borderRadius: 6,
      marginBottom: settings.fontSizePt,
    },
    blockquote: {
      ...base,
      fontStyle: 'italic',
      borderLeftWidth: 3,
      borderLeftColor: theme.accent,
      paddingLeft: settings.fontSizePt * 0.8,
      marginBottom: settings.fontSizePt,
      opacity: 0.9,
    },
  };
}

/** Removes a leading bullet/number marker; the rendered bullet replaces it. */
function stripBullet(text: string): string {
  return text.replace(/^\s*([-*•]|\d+[.)])\s+/, '');
}

/**
 * An extracted figure, scaled to the reading column.
 *
 * Width is the column width; height follows from the intrinsic aspect ratio, so a
 * wide PDF figure fits a phone without horizontal scrolling and grows on a tablet.
 * Small figures are not upscaled — that would only blur them.
 */
const RenderImage = memo(function RenderImage({
  block,
  contentWidth,
}: {
  block: TextBlock;
  contentWidth: number;
}) {
  const { colors } = useTheme();
  const [failed, setFailed] = useState(false);
  const onError = useCallback(() => setFailed(true), []);

  const image = block.image;
  if (!image || failed) {
    return (
      <View style={[styles.imageFallback, { borderColor: colors.border }]}>
        <Text style={[styles.imageFallbackText, { color: colors.textMuted }]}>
          [ Image unavailable ]
        </Text>
      </View>
    );
  }

  const { width: displayWidth, height: displayHeight } = scaleImageToColumn(image, contentWidth);

  return (
    <View style={styles.imageWrap}>
      <Image
        source={{ uri: image.uri }}
        style={{ width: displayWidth, height: displayHeight }}
        resizeMode="contain"
        onError={onError}
        accessible
        accessibilityRole="image"
        accessibilityLabel={block.text.length > 0 ? block.text : 'Figure from the document'}
      />
    </View>
  );
});

/**
 * One block. Memoized on (block, blockStyles, contentWidth) — all stable across
 * scrolls, so realized rows do not re-render while the list moves.
 *
 * No `numberOfLines` on text: wrapping to the container width is the entire point.
 */
const RenderBlock = memo(function RenderBlock({
  block,
  blockStyles,
  contentWidth,
}: {
  block: TextBlock;
  blockStyles: BlockStyles;
  contentWidth: number;
}) {
  if (block.type === 'image') {
    return <RenderImage block={block} contentWidth={contentWidth} />;
  }

  const style = blockStyles[block.type] ?? blockStyles.paragraph;

  if (block.type === 'list_item') {
    return (
      <View style={styles.listRow}>
        <Text style={[style, styles.bullet]}>•</Text>
        <Text style={[style, styles.listText]}>{stripBullet(block.text)}</Text>
      </View>
    );
  }

  return <Text style={style}>{block.text}</Text>;
});

function CenteredNotice({
  title,
  message,
  action,
}: {
  title: string;
  message: string;
  action?: { label: string; onPress: () => void };
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.notice, { backgroundColor: colors.surface }]}>
      <Text style={[styles.noticeTitle, { color: colors.text }]}>{title}</Text>
      <Text style={[styles.noticeMessage, { color: colors.textMuted }]}>{message}</Text>
      {action ? (
        <TouchableOpacity
          style={[styles.noticeButton, { borderColor: colors.border }]}
          onPress={action.onPress}
          accessibilityRole="button"
        >
          <Text style={[styles.noticeButtonText, { color: colors.accent }]}>{action.label}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

/**
 * Progress during the one-time whole-book pass.
 *
 * Shows real numbers from the extractor — pages processed and blocks produced — not
 * an indeterminate spinner pretending to be progress.
 */
function GeneratingState({
  processedPages,
  totalPages,
  blockCount,
  theme,
}: {
  processedPages: number;
  totalPages: number;
  blockCount: number;
  theme: ReaderThemeTokens;
}) {
  const percent = totalPages > 0 ? Math.round((processedPages / totalPages) * 100) : 0;

  return (
    <View style={styles.centered}>
      <ActivityIndicator color={theme.accent} size="large" />
      <Text style={[styles.generatingTitle, { color: theme.text }]}>Preparing reflow text</Text>
      <Text style={[styles.generatingDetail, { color: theme.textMuted }]}>
        {totalPages > 0
          ? `Page ${processedPages} of ${totalPages} · ${percent}%`
          : 'Reading the document…'}
      </Text>
      {blockCount > 0 ? (
        <Text style={[styles.generatingDetail, { color: theme.textMuted }]}>
          {blockCount} sections so far
        </Text>
      ) : null}
      <Text style={[styles.generatingNote, { color: theme.textMuted }]}>
        This happens once per book. Next time it opens instantly.
      </Text>
    </View>
  );
}

/**
 * Blocks prepended per backward extension. Large enough that one extension
 * usually covers more than a viewport (so the start edge is not re-hit every
 * few pixels), small enough that a prepend is a handful of cheap text rows.
 */
const BACKWARD_CHUNK = 32;

/**
 * The list's data: a VIEW over the whole block array starting at `start`.
 *
 * Local list index `i` is absolute block `blocks[start + i]`. Making the window
 * the data (instead of slicing the array) means extending backwards is O(1) — a
 * new `start`, no copies of thousands of blocks — and the window always reaches
 * the end of the book, so reading forward is ordinary virtualization.
 */
interface BlockWindow {
  blocks: TextBlock[];
  start: number;
}

function getWindowItem(window: BlockWindow, index: number): TextBlock {
  // VirtualizedList only asks for indices below getItemCount, so the lookup
  // cannot actually miss; the non-null assertion encodes that contract.
  return window.blocks[window.start + index]!;
}

function getWindowItemCount(window: BlockWindow): number {
  return Math.max(0, window.blocks.length - window.start);
}

/** Clamps an open-at block into the document. */
function clampStart(blockIndex: number, blockCount: number): number {
  if (blockCount <= 0) return 0;
  return Math.min(Math.max(0, Math.floor(blockIndex)), blockCount - 1);
}

interface ReflowListProps {
  blocks: TextBlock[];
  /** Absolute block the list is mounted AT — its first rendered row. */
  startBlockIndex: number;
  blockStyles: BlockStyles;
  contentWidth: number;
  onVisibleBlockChange: (blockIndex: number) => void;
}

/**
 * The virtualized list, mounted with `startBlockIndex` as its first item.
 *
 * Because the target block IS the first item of the data window, it sits at
 * content offset 0: the very first frame shows it, with no scroll command of any
 * kind. The rows before it exist only as data (`blocks[0..start-1]`) and are
 * brought into the window in chunks when the user scrolls up to the top edge.
 *
 * Keyed by the screen on the open-at block, so a new activation target mounts a
 * fresh window instead of scrolling an existing one.
 */
const ReflowList = memo(function ReflowList({
  blocks,
  startBlockIndex,
  blockStyles,
  contentWidth,
  onVisibleBlockChange,
}: ReflowListProps) {
  // Where the data window currently starts. Initialised from the resolved target
  // and only ever moves TOWARDS 0 as the user reads backwards.
  const [windowStart, setWindowStart] = useState(() => clampStart(startBlockIndex, blocks.length));

  const window = useMemo<BlockWindow>(
    () => ({ blocks, start: clampStart(windowStart, blocks.length) }),
    [blocks, windowStart],
  );

  /**
   * Keys are the ABSOLUTE block index. They must be stable across a prepend for
   * `maintainVisibleContentPosition` to find "the block the user is looking at"
   * in the new data and hold it in place; a local index would shift by the
   * chunk size and the list would have nothing to anchor to.
   */
  const keyExtractor = useCallback(
    (_item: TextBlock, index: number) => String(window.start + index),
    [window.start],
  );

  /**
   * Reports the topmost visible block (absolute index) so the position can map
   * back to a PDF page. Read from the token KEY, which is the absolute index —
   * `token.index` is local to the window. The callback is deliberately free of
   * window state: VirtualizedList binds `onViewableItemsChanged` once, at mount.
   */
  const onViewableItemsChanged = useCallback(
    (info: { viewableItems: ViewToken<TextBlock>[] }) => {
      let topmost = Number.POSITIVE_INFINITY;
      for (const token of info.viewableItems) {
        if (!token.isViewable) continue;
        const absolute = Number(token.key);
        if (Number.isInteger(absolute) && absolute < topmost) topmost = absolute;
      }
      if (Number.isFinite(topmost)) onVisibleBlockChange(topmost);
    },
    [onVisibleBlockChange],
  );

  /**
   * The user reached the top of the window: bring the previous chunk of blocks
   * in. `maintainVisibleContentPosition` keeps the currently visible block fixed
   * on screen while the rows above it are inserted, so this is invisible apart
   * from the scrollbar growing. At block 0 the state does not change and nothing
   * re-renders.
   */
  const extendBackward = useCallback(() => {
    setWindowStart((current) => Math.max(0, current - BACKWARD_CHUNK));
  }, []);

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<TextBlock>) => (
      <RenderBlock block={item} blockStyles={blockStyles} contentWidth={contentWidth} />
    ),
    [blockStyles, contentWidth],
  );

  const contentContainerStyle = useMemo(
    () => ({
      width: contentWidth,
      alignSelf: 'center' as const,
      paddingTop: 24,
      paddingBottom: 64,
    }),
    [contentWidth],
  );

  return (
    <VirtualizedList<TextBlock>
      data={window}
      getItem={getWindowItem}
      getItemCount={getWindowItemCount}
      keyExtractor={keyExtractor}
      renderItem={renderItem}
      // Backward extension. `onStartReached` fires when the first item of the
      // window is rendered and the scroll offset is within the threshold of the
      // top; the window is then grown towards block 0.
      onStartReached={extendBackward}
      onStartReachedThreshold={1}
      // Holds the first visible row in place when rows are inserted above it —
      // the native scroll offset is adjusted in the same layout pass, so the
      // content the user is reading does not move.
      maintainVisibleContentPosition={MAINTAIN_VISIBLE_CONTENT_POSITION}
      onViewableItemsChanged={onViewableItemsChanged}
      contentContainerStyle={contentContainerStyle}
      showsVerticalScrollIndicator
      // Virtualization: text rows are light, so a modest window keeps memory flat
      // while staying ahead of the scroll.
      initialNumToRender={12}
      maxToRenderPerBatch={8}
      updateCellsBatchingPeriod={50}
      windowSize={7}
    />
  );
});

const MAINTAIN_VISIBLE_CONTENT_POSITION = { minIndexForVisible: 0 } as const;

export function ReflowReader({
  state,
  settings,
  onVisibleBlockChange,
  onRegenerate,
}: ReflowReaderProps) {
  const theme = useMemo(() => READER_THEMES[settings.theme], [settings.theme]);
  const { width: windowWidth } = useWindowDimensions();

  const blockStyles = useMemo(() => buildBlockStyles(settings, theme), [settings, theme]);

  /**
   * The reading measure, in points. Derived from the LIVE window width, which is
   * what makes text reflow on rotation and split-screen.
   */
  const contentWidth = useMemo(
    () => readingColumnWidth(windowWidth, settings.contentWidthPt),
    [windowWidth, settings.contentWidthPt],
  );

  if (state.status === 'loading' || state.status === 'idle') {
    return (
      <Screen gutter={false} style={{ backgroundColor: theme.background }}>
        <View style={styles.centered}>
          <ActivityIndicator color={theme.accent} size="large" />
        </View>
      </Screen>
    );
  }

  if (state.status === 'generating') {
    return (
      <Screen gutter={false} style={{ backgroundColor: theme.background }}>
        <GeneratingState
          processedPages={state.progress?.processedPages ?? 0}
          totalPages={state.progress?.totalPages ?? 0}
          blockCount={state.progress?.blockCount ?? 0}
          theme={theme}
        />
      </Screen>
    );
  }

  if (state.status === 'error') {
    return (
      <Screen gutter={false} style={{ backgroundColor: theme.background }}>
        <View style={styles.centered}>
          <CenteredNotice
            title="Can't reflow this book"
            message={state.error ?? 'The text could not be extracted.'}
            action={{ label: 'Try again', onPress: onRegenerate }}
          />
        </View>
      </Screen>
    );
  }

  if (state.isTextless) {
    return (
      <Screen gutter={false} style={{ backgroundColor: theme.background }}>
        <View style={styles.centered}>
          <CenteredNotice
            title="No extractable text"
            message={
              'This PDF appears to be scanned or contains only images, so there is no text to ' +
              'reflow. Switch to PDF mode to read the original pages.'
            }
          />
        </View>
      </Screen>
    );
  }

  // An activation resolves its open-at block BEFORE the list may mount. Holding
  // the spinner here keeps the list from ever mounting at the top of the book
  // and then scrolling. The window is one commit wide: the hook publishes the
  // target synchronously with readiness, or in the re-entry fast path
  // immediately on activation.
  if (state.initialBlockIndex === null) {
    return (
      <Screen gutter={false} style={{ backgroundColor: theme.background }}>
        <View style={styles.centered}>
          <ActivityIndicator color={theme.accent} size="large" />
        </View>
      </Screen>
    );
  }

  return (
    <Screen gutter={false} style={{ backgroundColor: theme.background, flex: 1 }}>
      <ReflowList
        // A new activation target (mode switch, restore) mounts a fresh list
        // whose data window STARTS at that block — never a scroll of the old one.
        // (Between activations the hook publishes null, so the list unmounts and
        // a same-valued target still mounts fresh.)
        key={state.initialBlockIndex}
        blocks={state.blocks}
        startBlockIndex={state.initialBlockIndex}
        blockStyles={blockStyles}
        contentWidth={contentWidth}
        onVisibleBlockChange={onVisibleBlockChange}
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
  listRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  bullet: {
    marginRight: 8,
  },
  listText: {
    // flex lets the text wrap inside the row instead of overflowing it.
    flex: 1,
  },
  imageWrap: {
    alignItems: 'center',
    marginVertical: 16,
  },
  imageFallback: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    borderStyle: 'dashed',
    paddingVertical: 24,
    alignItems: 'center',
    marginVertical: 16,
  },
  imageFallbackText: {
    fontSize: 13,
  },
  generatingTitle: {
    fontSize: 17,
    fontWeight: '600',
    marginTop: 16,
  },
  generatingDetail: {
    fontSize: 14,
    marginTop: 6,
  },
  generatingNote: {
    fontSize: 13,
    marginTop: 16,
    textAlign: 'center',
    maxWidth: 280,
  },
  notice: {
    alignItems: 'center',
    padding: 24,
    borderRadius: 12,
    maxWidth: 420,
  },
  noticeTitle: {
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
  },
  noticeMessage: {
    fontSize: 14,
    marginTop: 8,
    textAlign: 'center',
    lineHeight: 20,
  },
  noticeButton: {
    marginTop: 16,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 44,
    justifyContent: 'center',
  },
  noticeButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
});

import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Card, Icon, IconButton, Text } from '@/components/ui';
import type { BookSummary } from '@/core/entities/book';
import { useTheme } from '@/theme';

export interface BookCardProps {
  book: BookSummary;

  /** Exact cell width in points, from useGridMetrics(). */
  width: number;

  /** Opens the book. */
  onPress: () => void;

  /** Opens the book at the saved reading position (Continue Reading). */
  onContinueReading?: (() => void) | undefined;

  onDelete: () => void;
}

/**
 * One library tile: cover block, title, author and progress.
 *
 * Sizing is driven by the `width` prop (an exact point value from
 * useGridMetrics), not `width: '100%'`. A percentage width inside a gapped,
 * padded FlatList row resolves against the row rather than the available cell,
 * which is what made these cards overflow and render roughly one column of
 * very tall tiles. With an exact width the cover height follows from
 * COVER_ASPECT, so ~5 rows fit a normal phone screen at 2 columns.
 *
 * Memoized: the library list re-renders whenever any book changes, and a tile's
 * own props are stable unless that book's row actually changed.
 */
export const BookCard = memo(function BookCard({
  book,
  width,
  onPress,
  onContinueReading,
  onDelete,
}: BookCardProps) {
  const { colors, radius, spacing } = useTheme();
  const hasProgress = book.lastPage > 0;

  // Cover height derives from the measured cell width — no fixed pixel heights.
  const coverHeight = Math.round(width * COVER_ASPECT);

  return (
    <Card padded={false} style={StyleSheet.flatten([styles.card, { width }])}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open ${book.title}`}
        onPress={onPress}
        style={({ pressed }) => [styles.tapArea, pressed ? styles.pressed : null]}
      >
        <View
          style={[
            styles.cover,
            {
              height: coverHeight,
              backgroundColor: colors.surfaceMuted,
              borderBottomColor: colors.border,
            },
          ]}
        >
          <Icon name="book-outline" size={24} tone="subtle" />
        </View>

        <View style={[styles.meta, { padding: spacing.sm, gap: 2 }]}>
          <Text variant="label" numberOfLines={2}>
            {book.title}
          </Text>

          {book.author ? (
            <Text variant="tiny" tone="muted" numberOfLines={1}>
              {book.author}
            </Text>
          ) : null}

          <Text variant="tiny" tone="subtle" numberOfLines={1}>
            {describeProgress(book)}
          </Text>
        </View>
      </Pressable>

      {hasProgress && onContinueReading ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Continue reading ${book.title} from page ${book.lastPage + 1}`}
          onPress={onContinueReading}
          style={({ pressed }) => [styles.continueButton, pressed ? styles.pressed : null]}
          hitSlop={6}
        >
          <Icon name="play-outline" size={14} tone="accent" />
        </Pressable>
      ) : null}

      <IconButton
        name="trash-outline"
        accessibilityLabel={`Delete ${book.title}`}
        size={16}
        tone="muted"
        onPress={onDelete}
        style={StyleSheet.flatten([styles.deleteButton, { borderRadius: radius.full }])}
      />
    </Card>
  );
});

/**
 * Cover height as a fraction of card width. Shorter than a true 2:3 book cover
 * (0.66 would make a 2-column tile ~270pt tall, so only two rows fit); 1.15
 * keeps the proportions book-like while letting ~5 rows onto a normal screen.
 */
const COVER_ASPECT = 1.15;

function describeProgress(book: BookSummary): string {
  if (book.pageCount !== null && book.pageCount > 1) {
    const percent = Math.min(100, Math.round((book.lastPage / (book.pageCount - 1)) * 100));
    return `${percent}% read`;
  }

  return book.lastPage > 0 ? `Page ${book.lastPage + 1}` : 'Not started';
}

const styles = StyleSheet.create({
  card: {
    // Width is supplied per-instance from the measured grid metrics.
    overflow: 'hidden',
  },

  tapArea: {
    width: '100%',
  },

  cover: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },

  meta: {
    width: '100%',
  },

  continueButton: {
    position: 'absolute',
    bottom: 4,
    left: 4,
    minWidth: 26,
    minHeight: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(250, 246, 241, 0.92)',
    borderRadius: 13,
  },

  deleteButton: {
    position: 'absolute',
    top: 4,
    right: 4,
    // Smaller than MIN_TOUCH_TARGET on purpose for a compact tile; hitSlop on
    // IconButton (8pt) brings the effective target back to ~44pt.
    minWidth: 28,
    minHeight: 28,
    backgroundColor: 'rgba(250, 246, 241, 0.92)',
  },

  pressed: {
    opacity: 0.85,
  },
});

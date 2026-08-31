import { Pressable, StyleSheet, View } from 'react-native';

import { Card, Icon, IconButton, Text } from '@/components/ui';
import type { BookSummary } from '@/core/entities/book';
import { useTheme } from '@/theme';

export interface BookCardProps {
  book: BookSummary;
  /** Opens the book. */
  onPress: () => void;
  /** Opens the book at the saved reading position (Continue Reading). */
  onContinueReading?: (() => void) | undefined;
  onDelete: () => void;
}

/**
 * One library tile: placeholder cover block, title, author, progress and
 * recency line. Cover art renders once the PDF engine lands (Phase 3); the
 * blank block keeps the reference grid geometry in the meantime.
 */
export function BookCard({ book, onPress, onContinueReading, onDelete }: BookCardProps) {
  const { colors, radius, spacing } = useTheme();
  const hasProgress = book.lastPage > 0;

  return (
    <Card padded={false} style={styles.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open ${book.title}`}
        onPress={onPress}
        style={({ pressed }) => [styles.tapArea, pressed ? { opacity: 0.85 } : null]}
      >
        {/* Placeholder cover block — real cover rendering arrives in Phase 3. */}
        <View
          style={[
            styles.cover,
            { backgroundColor: colors.surfaceMuted, borderBottomColor: colors.border },
          ]}
        >
          <Icon name="book-outline" size={32} tone="subtle" />
        </View>

        <View style={[styles.meta, { padding: spacing.md, gap: spacing.xs }]}>
          <Text variant="displaySmall" numberOfLines={2}>
            {book.title}
          </Text>
          {book.author ? (
            <Text variant="caption" tone="muted" numberOfLines={1}>
              {book.author}
            </Text>
          ) : null}
          <Text variant="tiny" tone="muted">
            {describeProgress(book)}
          </Text>
          <Text variant="tiny" tone="subtle">
            {describeLastOpened(book.lastOpenedAt)}
          </Text>
        </View>
      </Pressable>

      {hasProgress && onContinueReading ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Continue reading ${book.title} from page ${book.lastPage + 1}`}
          onPress={onContinueReading}
          style={({ pressed }) => [styles.continueButton, pressed ? { opacity: 0.85 } : null]}
        >
          <Icon name="play-outline" size={16} tone="accent" />
        </Pressable>
      ) : null}

      <IconButton
        name="trash-outline"
        accessibilityLabel={`Delete ${book.title}`}
        size={18}
        tone="muted"
        onPress={onDelete}
        style={StyleSheet.flatten([styles.deleteButton, { borderRadius: radius.full }])}
      />
    </Card>
  );
}

/** "12% read" when pageCount is known, otherwise "Page 5". Pages are 0-based. */
function describeProgress(book: BookSummary): string {
  if (book.pageCount !== null && book.pageCount > 1) {
    const percent = Math.min(100, Math.round((book.lastPage / (book.pageCount - 1)) * 100));
    return `${percent}% read`;
  }
  return book.lastPage > 0 ? `Page ${book.lastPage + 1}` : 'Not started';
}

function describeLastOpened(lastOpenedAt: Date | null): string {
  if (!lastOpenedAt) return 'Never opened';
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  const seconds = Math.round((lastOpenedAt.getTime() - Date.now()) / 1000);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['second', 60],
    ['minute', 60],
    ['hour', 24],
    ['day', 7],
    ['week', 4],
    ['month', 12],
    ['year', Infinity],
  ];
  let value = seconds;
  for (const [unit, size] of units) {
    if (Math.abs(value) < size) return formatter.format(Math.round(value), unit);
    value /= size;
  }
  return formatter.format(Math.round(value), 'year');
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
  },
  tapArea: {
    flex: 1,
  },
  cover: {
    aspectRatio: 2 / 3,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  meta: {
    flex: 1,
  },
  continueButton: {
    position: 'absolute',
    bottom: 6,
    left: 6,
    minWidth: 32,
    minHeight: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(250, 246, 241, 0.92)',
    borderRadius: 16,
  },
  deleteButton: {
    position: 'absolute',
    top: 6,
    right: 6,
    minWidth: 32,
    minHeight: 32,
    backgroundColor: 'rgba(250, 246, 241, 0.92)',
  },
});

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
 * recency line.
 */
export function BookCard({
  book,
  onPress,
  onContinueReading,
  onDelete,
}: BookCardProps) {
  const { colors, radius, spacing } = useTheme();
  const hasProgress = book.lastPage > 0;

  return (
    <Card padded={false} style={styles.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open ${book.title}`}
        onPress={onPress}
        style={({ pressed }) => [
          styles.tapArea,
          pressed ? styles.pressed : null,
        ]}
      >
        <View
          style={[
            styles.cover,
            {
              backgroundColor: colors.surfaceMuted,
              borderBottomColor: colors.border,
            },
          ]}
        >
          <Icon name="book-outline" size={32} tone="subtle" />
        </View>

        <View
          style={[
            styles.meta,
            {
              padding: spacing.md,
              gap: spacing.xs,
            },
          ]}
        >
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
          accessibilityLabel={`Continue reading ${book.title} from page ${
            book.lastPage + 1
          }`}
          onPress={onContinueReading}
          style={({ pressed }) => [
            styles.continueButton,
            pressed ? styles.pressed : null,
          ]}
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
        style={StyleSheet.flatten([
          styles.deleteButton,
          { borderRadius: radius.full },
        ])}
      />
    </Card>
  );
}

function describeProgress(book: BookSummary): string {
  if (book.pageCount !== null && book.pageCount > 1) {
    const percent = Math.min(
      100,
      Math.round((book.lastPage / (book.pageCount - 1)) * 100),
    );

    return `${percent}% read`;
  }

  return book.lastPage > 0
    ? `Page ${book.lastPage + 1}`
    : 'Not started';
}

function describeLastOpened(lastOpenedAt: Date | null): string {
  if (!lastOpenedAt) return 'Never opened';

  const seconds = Math.round(
    (lastOpenedAt.getTime() - Date.now()) / 1000,
  );

  // Manual relative time formatting (Intl.RelativeTimeFormat not available in RN Hermes)
  const absSeconds = Math.abs(seconds);
  const isPast = seconds < 0;

  if (absSeconds < 30) {
    return isPast ? 'just now' : 'in a moment';
  }
  if (absSeconds < 60) {
    return isPast ? `${absSeconds}s ago` : `in ${absSeconds}s`;
  }

  const minutes = Math.round(absSeconds / 60);
  if (minutes < 60) {
    return isPast ? `${minutes}m ago` : `in ${minutes}m`;
  }

  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return isPast ? `${hours}h ago` : `in ${hours}h`;
  }

  const days = Math.round(hours / 24);
  if (days < 7) {
    return isPast ? `${days}d ago` : `in ${days}d`;
  }

  const weeks = Math.round(days / 7);
  if (weeks < 4) {
    return isPast ? `${weeks}w ago` : `in ${weeks}w`;
  }

  const months = Math.round(days / 30);
  if (months < 12) {
    return isPast ? `${months}mo ago` : `in ${months}mo`;
  }

  const years = Math.round(days / 365);
  return isPast ? `${years}y ago` : `in ${years}y`;
}

const styles = StyleSheet.create({
  card: {
    // Don't force the card to fill an unspecified parent height.
    width: '100%',
  },

  tapArea: {
    width: '100%',
  },

  cover: {
    width: '100%',
    aspectRatio: 2 / 3,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },

  meta: {
    width: '100%',
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

  pressed: {
    opacity: 0.85,
  },
});
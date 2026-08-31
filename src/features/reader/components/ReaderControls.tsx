/**
 * ReaderControls — bottom toolbar with page navigation and settings.
 * Pure presentational component; all callbacks provided by parent.
 */
import { StyleSheet, View } from 'react-native';
import { IconButton, Text } from '@/components/ui';

export interface ReaderControlsProps {
  /** Current 0-based page index. */
  currentPage: number;
  /** Total page count, or null if unknown. */
  pageCount: number | null;
  /** Whether horizontal/paged layout is active. */
  horizontal: boolean;
  /** Callback to go to previous page. */
  onPrev: () => void;
  /** Callback to go to next page. */
  onNext: () => void;
  /** Callback to toggle layout mode. */
  onToggleLayout: () => void;
  /** Callback to open settings sheet. */
  onSettings: () => void;
  /** Callback to toggle bookmark on current page. */
  onToggleBookmark: () => void;
  /** Whether current page is bookmarked. */
  isBookmarked: boolean;
  /** Callback to open jump-to-page dialog. */
  onJumpToPage: () => void;
}

export function ReaderControls({
  currentPage,
  pageCount,
  horizontal,
  onPrev,
  onNext,
  onToggleLayout,
  onSettings,
  onToggleBookmark,
  isBookmarked,
  onJumpToPage,
}: ReaderControlsProps) {
  return (
    <View style={styles.container}>
      <View style={styles.leftGroup}>
        <IconButton
          name="chevron-back"
          accessibilityLabel="Previous page"
          size={24}
          tone="accent"
          disabled={currentPage <= 0}
          onPress={onPrev}
        />
        <View style={styles.pageInfo}>
          <Text variant="caption" tone="default">
            {currentPage + 1}
          </Text>
          <Text variant="caption" tone="muted">
            {' '}
            /{pageCount ?? '—'}{' '}
          </Text>
        </View>
        <IconButton
          name="chevron-forward"
          accessibilityLabel="Next page"
          size={24}
          tone="accent"
          disabled={pageCount !== null && currentPage >= pageCount - 1}
          onPress={onNext}
        />
      </View>

      <View style={styles.centerGroup}>
        <IconButton
          name={isBookmarked ? 'bookmark' : 'bookmark-outline'}
          accessibilityLabel={isBookmarked ? 'Remove bookmark' : 'Add bookmark'}
          size={24}
          tone="accent"
          onPress={onToggleBookmark}
        />
        <IconButton
          name="grid-outline"
          accessibilityLabel="Jump to page"
          size={24}
          tone="accent"
          onPress={onJumpToPage}
        />
      </View>

      <View style={styles.rightGroup}>
        <IconButton
          name={horizontal ? 'menu' : 'apps'}
          accessibilityLabel={horizontal ? 'Switch to vertical scrolling' : 'Switch to page-swipe'}
          size={24}
          tone="accent"
          onPress={onToggleLayout}
        />
        <IconButton
          name="cog-outline"
          accessibilityLabel="Settings"
          size={24}
          tone="accent"
          onPress={onSettings}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
    height: 56,
  },
  leftGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  centerGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    justifyContent: 'center',
  },
  rightGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    justifyContent: 'flex-end',
  },
  pageInfo: {
    minWidth: 80,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

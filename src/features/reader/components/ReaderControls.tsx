/**
 * ReaderControls — bottom toolbar with page navigation and settings.
 *
 * Pure presentational component; all callbacks provided by parent.
 *
 * Memoized: it sits beside the native PDF view and re-renders on every page
 * turn. `memo` limits that to the props that actually changed — in practice
 * `currentPage` — instead of letting the parent's render walk the whole subtree.
 * All callbacks arriving here are stabilized with useCallback by the reader
 * screen, so the memo comparison genuinely bails out.
 */
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { IconButton, Text } from '@/components/ui';

export interface ReaderControlsProps {
  /** Current 0-based page index. */
  currentPage: number;
  /** Total page count, or null if unknown. */
  pageCount: number | null;
  /** Whether horizontal/paged layout is active. */
  horizontal: boolean;
  /**
   * Bottom safe-area inset, in points. The bar sits at the bottom of a
   * full-screen route with no tab bar beneath it, so it must lift itself clear
   * of the gesture pill / navigation buttons. Device-measured, never hardcoded.
   */
  bottomInset?: number;
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

export const ReaderControls = memo(function ReaderControls({
  currentPage,
  pageCount,
  horizontal,
  bottomInset = 0,
  onPrev,
  onNext,
  onToggleLayout,
  onSettings,
  onToggleBookmark,
  isBookmarked,
  onJumpToPage,
}: ReaderControlsProps) {
  return (
    <View style={[styles.container, { paddingBottom: bottomInset }]}>
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

      {/* <View style={styles.centerGroup}> */}
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
      {/* </View> */}

      <View style={styles.rightGroup}>
        <IconButton
          name={horizontal ? 'menu' : 'apps'}
          accessibilityLabel={horizontal ? 'Switch to vertical scrolling' : 'Switch to page-swipe'}
          size={24}
          tone="accent"
          onPress={onToggleLayout}
        />
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
  //  display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal:0,
    paddingTop: 8,
    // No fixed `height`: the row must be able to grow by the bottom inset on
    // devices that have one, instead of clipping its own controls.
    minHeight: 56,
  },
  leftGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 0,
   // flex: 1,
    justifyContent: 'space-between'
  },
  centerGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 0,
    justifyContent: 'center',
  },
  rightGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 0,
  //  flex: 1,
    justifyContent: 'center',
  },
  pageInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    // minWidth, not a fixed width: long page counts (1000+) must not clip.
    minWidth: 72,
  },
});

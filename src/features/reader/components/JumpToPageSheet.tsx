/**
 * JumpToPageSheet — numeric page entry for the reader.
 *
 * Presentational only: input validation lives in `pageNavigation` (pure, tested),
 * and the actual navigation is the parent's job, delivered as a 0-based page index
 * through `onJump`. The sheet never touches the PDF engine.
 *
 * KEYBOARD LAYOUT
 * ---------------
 * The sheet is absolutely positioned at `bottom: 0` over the reader, which is why it
 * ended up under the keyboard: an absolutely positioned element is outside the flex
 * flow, so `KeyboardAvoidingView` wrapping the screen cannot move it, and on Android
 * the default `windowSoftInputMode` (adjustResize) resizes the *window* while the
 * sheet stays pinned to the original bottom.
 *
 * The fix is to lift the sheet by the keyboard height the OS reports, measured via
 * `useKeyboardState`, with `Animated` so the movement tracks the keyboard rather
 * than snapping. Two consequences worth stating:
 *  - the bottom safe-area inset is applied ONLY while the keyboard is hidden. When
 *    it is up it already covers the gesture bar, so adding the inset as well would
 *    leave a visible dead gap.
 *  - nothing here is a fixed offset; on a device with no keyboard inset the shift is
 *    simply 0.
 *
 * The content is also a ScrollView, so on a short screen (or with a large system
 * font) the actions stay reachable instead of being clipped.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { Button, Divider, IconButton, Text } from '@/components/ui';
import { useKeyboardState } from '@/features/reader/hooks/useKeyboardState';
import { validatePageInput } from '@/features/reader/pageNavigation';
import { useTheme } from '@/theme';

export interface JumpToPageSheetProps {
  /** Current 0-based page index, shown as the field's initial value. */
  currentPage: number;
  /** Total pages, or null when the document has not reported it yet. */
  pageCount: number | null;
  /** Bottom safe-area inset in points. */
  bottomInset?: number;
  /** Max height available to the sheet, used to cap the scroll area. */
  availableHeight?: number;
  /** Receives a validated, clamped 0-BASED page index. */
  onJump: (pageIndex: number) => void;
  onClose: () => void;
}

/** Matches the platform keyboard animation so the sheet moves with it, not after. */
const KEYBOARD_ANIMATION_MS = Platform.OS === 'ios' ? 250 : 150;

export const JumpToPageSheet = memo(function JumpToPageSheet({
  currentPage,
  pageCount,
  bottomInset = 0,
  availableHeight,
  onJump,
  onClose,
}: JumpToPageSheetProps) {
  const { colors, radius, spacing } = useTheme();
  const [value, setValue] = useState(() => String(currentPage + 1));
  const [error, setError] = useState<string | null>(null);

  const keyboard = useKeyboardState();

  /**
   * Vertical offset, animated toward the measured keyboard height.
   *
   * `useNativeDriver` is on: translateY is a transform, so the movement runs on the
   * UI thread and stays smooth even while the reader is busy.
   */
  const translateY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(translateY, {
      toValue: -keyboard.height,
      duration: KEYBOARD_ANIMATION_MS,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [keyboard.height, translateY]);

  const submit = useCallback(
    (raw: string) => {
      const result = validatePageInput(raw, pageCount);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setError(null);
      onJump(result.pageIndex);
      onClose();
    },
    [pageCount, onJump, onClose],
  );

  const handleChange = useCallback((next: string) => {
    // Strip anything non-numeric as it is typed so the field can never hold input
    // that would fail validation.
    setValue(next.replace(/[^0-9]/g, ''));
    setError(null);
  }, []);

  const jumpFirst = useCallback(() => {
    onJump(0);
    onClose();
  }, [onJump, onClose]);

  const jumpLast = useCallback(() => {
    if (pageCount === null) return;
    onJump(pageCount - 1);
    onClose();
  }, [pageCount, onJump, onClose]);

  const rangeLabel = useMemo(
    () => (pageCount === null ? 'Page count not known yet' : `1 – ${pageCount}`),
    [pageCount],
  );

  /**
   * Bottom padding: the safe-area inset only when the keyboard is hidden.
   *
   * With the keyboard up, its own frame already sits over the gesture bar, so adding
   * the inset on top would open a gap between the sheet and the keyboard.
   */
  const bodyPaddingBottom = spacing.xl + (keyboard.isVisible ? 0 : bottomInset);

  /**
   * Cap so the sheet cannot grow past the space left above the keyboard. Derived
   * from the measured window and keyboard, never a fixed number.
   */
  const maxHeight =
    availableHeight === undefined
      ? undefined
      : Math.max(200, availableHeight - keyboard.height - 24);

  return (
    <Animated.View
      style={[
        styles.sheet,
        { backgroundColor: colors.surface, transform: [{ translateY }] },
        maxHeight === undefined ? null : { maxHeight },
      ]}
    >
      <View style={styles.header}>
        <Text variant="label">Jump to page</Text>
        <IconButton
          name="close"
          size={20}
          tone="muted"
          onPress={onClose}
          accessibilityLabel="Close jump to page"
        />
      </View>

      <Divider />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.body, { paddingBottom: bodyPaddingBottom }]}
        // Lets a tap on Go/First/Last register while the field has focus, instead of
        // being swallowed by the keyboard dismissal.
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text variant="caption" tone="muted">
          {rangeLabel}
        </Text>

        <TextInput
          value={value}
          onChangeText={handleChange}
          onSubmitEditing={() => submit(value)}
          keyboardType="number-pad"
          inputMode="numeric"
          returnKeyType="go"
          autoFocus
          selectTextOnFocus
          maxLength={7}
          accessibilityLabel="Page number"
          placeholder="Page number"
          placeholderTextColor={colors.textSubtle}
          style={[
            styles.input,
            {
              backgroundColor: colors.surfaceMuted,
              borderColor: error ? colors.danger : colors.border,
              borderRadius: radius.sm,
              color: colors.text,
            },
          ]}
        />

        {error ? (
          <Text variant="caption" tone="danger">
            {error}
          </Text>
        ) : null}

        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go to first page"
            onPress={jumpFirst}
            hitSlop={8}
            style={styles.shortcut}
          >
            <Text variant="caption" tone="accent">
              First
            </Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go to last page"
            onPress={jumpLast}
            disabled={pageCount === null}
            hitSlop={8}
            style={styles.shortcut}
          >
            <Text variant="caption" tone={pageCount === null ? 'subtle' : 'accent'}>
              Last
            </Text>
          </Pressable>

          <View style={styles.grow} />

          <Button label="Go" onPress={() => submit(value)} />
        </View>
      </ScrollView>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    elevation: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
  },
  scroll: {
    // flexGrow: 0 keeps the sheet the height of its content until maxHeight bites.
    flexGrow: 0,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  body: {
    paddingHorizontal: 20,
    paddingTop: 16,
    gap: 12,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    // minHeight rather than height so large system font scales still fit.
    minHeight: 48,
    fontSize: 17,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingTop: 4,
  },
  shortcut: {
    minHeight: 44,
    justifyContent: 'center',
  },
  grow: {
    flex: 1,
  },
});

import type { ReactNode } from 'react';
import { ScrollView, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { createCommonStyles, useTheme } from '@/theme';

export interface ScreenProps {
  children: ReactNode;
  /** Apply the standard horizontal page gutter. Defaults to true. */
  gutter?: boolean;
  /** Wrap content in a ScrollView. Off for fixed/centred layouts. */
  scroll?: boolean;
  /** Centre content on both axes — for empty and placeholder states. */
  center?: boolean;
  /** Apply the bottom safe-area inset. Off inside tabs: the bar owns it. */
  safeBottom?: boolean;
  style?: ViewStyle;
}

/**
 * Screen root: canvas colour, safe-area padding and the page gutter in one
 * place, so no route repeats them. Presentation only (ARCHITECTURE.md §1, L5).
 */
export function Screen({
  children,
  gutter = true,
  scroll = false,
  center = false,
  safeBottom = false,
  style,
}: ScreenProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const common = createCommonStyles(theme.colors);

  const padding: ViewStyle = {
    paddingHorizontal: gutter ? theme.spacing.gutter : 0,
    paddingBottom: safeBottom ? insets.bottom : 0,
  };

  if (scroll) {
    return (
      <View style={[common.screen, style]}>
        <ScrollView
          contentContainerStyle={[
            padding,
            center ? { flexGrow: 1, justifyContent: 'center' } : null,
          ]}
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={[common.screen, padding, center ? common.centered : null, style]}>{children}</View>
  );
}

import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { theme } from '@/theme';

interface ScreenProps {
  children: ReactNode;
  /** Center the content on both axes — used by empty/placeholder states. */
  center?: boolean;
  /** Apply the bottom safe-area inset. Off inside tabs, where the bar owns it. */
  edgeToEdgeBottom?: boolean;
}

/**
 * Screen root: background token + safe-area padding, so no route repeats it.
 * Presentation only (ARCHITECTURE.md §1, L5).
 */
export function Screen({ children, center = false, edgeToEdgeBottom = false }: ScreenProps) {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.root,
        center && styles.center,
        { paddingBottom: edgeToEdgeBottom ? insets.bottom : 0 },
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.lg,
  },
});

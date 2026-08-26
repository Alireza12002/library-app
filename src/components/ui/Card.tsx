import type { ReactNode } from 'react';
import { Pressable, View, type ViewStyle } from 'react-native';

import { createCommonStyles, useTheme } from '@/theme';

export interface CardProps {
  children: ReactNode;
  /** Inner padding. Omit for full-bleed content such as cover artwork. */
  padded?: boolean;
  /** Makes the whole card a single tap target. */
  onPress?: () => void;
  accessibilityLabel?: string;
  style?: ViewStyle;
}

/**
 * Rounded surface container. Flat by design — the reference UI has no card
 * shadows; separation comes from the fill and a hairline border.
 */
export function Card({ children, padded = true, onPress, accessibilityLabel, style }: CardProps) {
  const theme = useTheme();
  const common = createCommonStyles(theme.colors);
  const base: ViewStyle[] = [common.card, padded ? { padding: theme.spacing.lg } : {}, style ?? {}];

  if (onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        {...(accessibilityLabel ? { accessibilityLabel } : {})}
        onPress={onPress}
        style={({ pressed }) => [...base, pressed ? { opacity: theme.opacity.pressed } : null]}
      >
        {children}
      </Pressable>
    );
  }

  return <View style={base}>{children}</View>;
}

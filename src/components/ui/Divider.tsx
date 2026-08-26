import { View, type ViewStyle } from 'react-native';

import { createCommonStyles, useTheme } from '@/theme';

export interface DividerProps {
  /** Vertical space above and below. Defaults to none. */
  spacing?: 'none' | 'sm' | 'md' | 'lg';
  /** Indent both ends by the page gutter. */
  inset?: boolean;
  style?: ViewStyle;
}

const GAP = { none: 0, sm: 8, md: 12, lg: 16 } as const;

/** 1px hairline rule — the only divider treatment in the reference design. */
export function Divider({ spacing = 'none', inset = false, style }: DividerProps) {
  const theme = useTheme();
  const common = createCommonStyles(theme.colors);

  return (
    <View
      style={[
        common.divider,
        { marginVertical: GAP[spacing] },
        inset ? { marginHorizontal: theme.spacing.gutter } : null,
        style,
      ]}
    />
  );
}

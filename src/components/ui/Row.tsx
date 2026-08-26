import { Pressable, View, type ViewStyle } from 'react-native';

import { createCommonStyles, MIN_TOUCH_TARGET, useTheme } from '@/theme';

import { Icon } from './Icon';
import { Text } from './Text';

export interface RowProps {
  label: string;
  /** Right-hand text: the current value, or a placeholder note. */
  value?: string;
  /** Adds a chevron and makes the row tappable. */
  onPress?: () => void;
  /** Removes the divider — set on the last row in a group. */
  last?: boolean;
  style?: ViewStyle;
}

/** Label/value row, optionally navigable. Used to build settings groups. */
export function Row({ label, value, onPress, last = false, style }: RowProps) {
  const theme = useTheme();
  const common = createCommonStyles(theme.colors);

  const content = (
    <>
      <Text variant="body" style={{ flexShrink: 1 }}>
        {label}
      </Text>
      <View style={[common.row, { gap: theme.spacing.xs }]}>
        {value ? (
          <Text variant="body" tone="muted">
            {value}
          </Text>
        ) : null}
        {onPress ? <Icon name="chevron-forward" size={18} tone="subtle" /> : null}
      </View>
    </>
  );

  const rowStyle: ViewStyle[] = [
    common.row,
    {
      justifyContent: 'space-between',
      gap: theme.spacing.lg,
      paddingHorizontal: theme.spacing.lg,
      minHeight: MIN_TOUCH_TARGET,
      paddingVertical: theme.spacing.md,
      borderBottomWidth: last ? 0 : theme.hairline,
      borderBottomColor: theme.colors.border,
    },
    style ?? {},
  ];

  if (onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        onPress={onPress}
        style={({ pressed }) => [
          ...rowStyle,
          pressed ? { backgroundColor: theme.colors.accentWash } : null,
        ]}
      >
        {content}
      </Pressable>
    );
  }

  return <View style={rowStyle}>{content}</View>;
}

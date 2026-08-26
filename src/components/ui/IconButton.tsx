import { Pressable, StyleSheet, type PressableProps, type ViewStyle } from 'react-native';

import { MIN_TOUCH_TARGET, useTheme } from '@/theme';

import { Icon, type IconName } from './Icon';
import type { TextTone } from './Text';

export interface IconButtonProps extends Omit<PressableProps, 'style' | 'children'> {
  name: IconName;
  /** Required: an icon alone carries no text, so it needs a spoken name. */
  accessibilityLabel: string;
  size?: number;
  tone?: TextTone;
  /**
   * Tinted accent chip behind the glyph — the reference UI's active tab
   * treatment.
   */
  washed?: boolean;
  style?: ViewStyle;
}

/**
 * Tappable icon with a guaranteed 44pt hit area, optionally on an accent wash.
 */
export function IconButton({
  name,
  accessibilityLabel,
  size = 24,
  tone = 'default',
  washed = false,
  disabled = false,
  style,
  ...rest
}: IconButtonProps) {
  const { colors, radius, opacity } = useTheme();
  const isDisabled = disabled === true;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: isDisabled }}
      disabled={isDisabled}
      hitSlop={8}
      style={({ pressed }) => [
        styles.base,
        {
          borderRadius: washed ? radius.md : radius.full,
          backgroundColor: washed ? colors.accentWash : 'transparent',
          opacity: isDisabled ? opacity.disabled : pressed ? opacity.pressed : 1,
        },
        style,
      ]}
      {...rest}
    >
      <Icon name={name} size={size} tone={tone} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minWidth: MIN_TOUCH_TARGET,
    minHeight: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

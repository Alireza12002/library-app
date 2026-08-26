import { Pressable, StyleSheet, View, type PressableProps, type ViewStyle } from 'react-native';

import { controlHeight, MIN_TOUCH_TARGET, useTheme } from '@/theme';

import { Text } from './Text';

export type ButtonVariant = 'primary' | 'outline' | 'ghost';
export type ButtonSize = 'md' | 'lg';

export interface ButtonProps extends Omit<PressableProps, 'style' | 'children'> {
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Stretch to the container width. */
  fullWidth?: boolean;
  /** Rendered before the label — typically an <Icon />. */
  leading?: React.ReactNode;
  style?: ViewStyle;
}

/**
 * Pill button.
 *
 * NOTE: the reference screenshot contains no button, so fill/height/radius are
 * extrapolated from the accent and radius language (terracotta fill, radius =
 * height / 2). Pending design review.
 */
export function Button({
  label,
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  leading,
  disabled = false,
  style,
  ...rest
}: ButtonProps) {
  const { colors, radius, spacing, opacity } = useTheme();
  const isDisabled = disabled === true;

  const surface: Record<ButtonVariant, ViewStyle> = {
    primary: { backgroundColor: colors.accent },
    outline: { borderWidth: 1, borderColor: colors.accent },
    ghost: {},
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled }}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        {
          minHeight: controlHeight[size],
          borderRadius: radius.full,
          paddingHorizontal: spacing.xl,
          gap: spacing.sm,
          opacity: isDisabled ? opacity.disabled : pressed ? opacity.pressed : 1,
        },
        surface[variant],
        fullWidth ? styles.fullWidth : null,
        style,
      ]}
      {...rest}
    >
      {leading ? <View>{leading}</View> : null}
      <Text variant="label" tone={variant === 'primary' ? 'onAccent' : 'accent'}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: MIN_TOUCH_TARGET,
    alignSelf: 'flex-start',
  },
  fullWidth: {
    alignSelf: 'stretch',
  },
});

import { Text as RNText, type TextProps as RNTextProps } from 'react-native';

import { textColorFor, useTheme } from '@/theme';

export type TextVariant =
  'displayLarge' | 'displayMedium' | 'displaySmall' | 'label' | 'body' | 'caption' | 'tiny';

export type TextTone = 'default' | 'muted' | 'subtle' | 'accent' | 'danger' | 'onAccent';

export interface TextProps extends RNTextProps {
  /** Type-scale entry. Defaults to body. */
  variant?: TextVariant;
  /** Semantic colour role. Defaults to the primary text colour. */
  tone?: TextTone;
  /** Convenience for centred copy. */
  center?: boolean;
}

/**
 * Every string in the app renders through this, so no screen picks a raw
 * fontSize or colour. Pass `variant` for the scale and `tone` for the role.
 */
export function Text({
  variant = 'body',
  tone = 'default',
  center = false,
  style,
  ...rest
}: TextProps) {
  const { typography, colors } = useTheme();

  return (
    <RNText
      style={[
        typography[variant],
        { color: textColorFor(colors, tone) },
        center ? { textAlign: 'center' } : null,
        style,
      ]}
      {...rest}
    />
  );
}

import { Ionicons } from '@expo/vector-icons';
import type { ColorValue } from 'react-native';

import { textColorFor, useTheme } from '@/theme';

import type { TextTone } from './Text';

/**
 * Icon name from Ionicons. The reference UI uses the outline set
 * ('home-outline', 'settings-outline', 'search-outline').
 */
export type IconName = keyof typeof Ionicons.glyphMap;

export interface IconProps {
  name: IconName;
  /** Defaults to 24 — the reference UI's tab/field icon size. */
  size?: number;
  tone?: TextTone;
  /**
   * Escape hatch for a colour outside the semantic roles — e.g. white on cover
   * artwork, or the colour a navigator passes to a tabBarIcon.
   */
  color?: ColorValue;
}

export function Icon({ name, size = 24, tone = 'default', color }: IconProps) {
  const { colors } = useTheme();

  return <Ionicons name={name} size={size} color={color ?? textColorFor(colors, tone)} />;
}

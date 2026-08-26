import { StyleSheet, View, type ColorValue } from 'react-native';

import { useTheme } from '@/theme';

import { Icon, type IconName } from './Icon';

export interface TabBarIconProps {
  name: IconName;
  color: ColorValue;
  /** Draws the tinted accent pill behind the glyph, as the reference UI does. */
  focused: boolean;
}

/**
 * Tab bar glyph with the reference UI's active-state treatment: a rounded
 * accent wash behind the icon when the tab is selected.
 */
export function TabBarIcon({ name, color, focused }: TabBarIconProps) {
  const { colors, radius } = useTheme();

  return (
    <View
      style={[
        styles.wash,
        {
          borderRadius: radius.md,
          backgroundColor: focused ? colors.accentWash : 'transparent',
        },
      ]}
    >
      <Icon name={name} size={24} color={color} />
    </View>
  );
}

const styles = StyleSheet.create({
  wash: {
    width: 48,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TabBarIcon } from '@/components/ui';
import { useTheme } from '@/theme';

/**
 * Tab group: the two top-level destinations. Labels and icons follow the
 * reference UI ("Home" + house, "Settings" + gear, outline set), with the
 * active item tinted terracotta.
 *
 * SAFE AREA
 * ---------
 * expo-router's BottomTabBar already adds `insets.bottom` as padding and to its
 * own height — but only for insets it can see, and the value it uses is
 * overridable by whatever `tabBarStyle` sets last. The previous static
 * `tabBarStyle` had no height/padding, and on Android the bar ended up under the
 * gesture pill / 3-button bar.
 *
 * Passing the measured inset explicitly via `tabBarStyle.paddingBottom` and
 * growing `height` by the same amount makes the bar lift itself clear of the
 * system navigation area on every device: it is 0 on hardware-key phones, ~16dp
 * with Android gesture nav, ~48dp with 3-button nav, and ~34dp for the iOS home
 * indicator. Nothing here is a fixed per-device offset.
 */

/** Bar content height, excluding the safe-area inset (matches the UIKit metric). */
const TAB_BAR_CONTENT_HEIGHT = 56;

export default function TabsLayout() {
  const { colors, typography, hairline } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.background },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: typography.tiny,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          borderTopWidth: hairline,
          height: TAB_BAR_CONTENT_HEIGHT + insets.bottom,
          paddingBottom: insets.bottom,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, focused }) => (
            <TabBarIcon name="home-outline" color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, focused }) => (
            <TabBarIcon name="settings-outline" color={color} focused={focused} />
          ),
        }}
      />
    </Tabs>
  );
}

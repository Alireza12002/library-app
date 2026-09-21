import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TabBarIcon } from '@/components/ui';
import { useTheme } from '@/theme';
import { Stack } from 'expo-router';
/**
 * Tab group. The library is the only bottom-nav destination; Settings is reached
 * from the gear in the library header instead (`href: null` keeps the route
 * registered and linkable while hiding it from the bar).
 *
 * SAFE AREA
 * ---------
 * expo-router's BottomTabBar adds `insets.bottom` itself, but whatever
 * `tabBarStyle` sets last wins — and the previous static style declared neither a
 * height nor bottom padding, so on Android the bar sat under the gesture pill /
 * 3-button bar.
 *
 * Passing the measured inset explicitly and growing the height by the same amount
 * lifts the bar clear of the system navigation area on every device: 0 on
 * hardware-key phones, ~16dp with Android gesture nav, ~48dp with 3-button nav,
 * ~34dp for the iOS home indicator. No fixed per-device offset anywhere.
 */

/** Bar content height, excluding the safe-area inset. */
const TAB_BAR_CONTENT_HEIGHT = 56;

export default function TabsLayout() {
  const { colors, typography, hairline } = useTheme();
  const insets = useSafeAreaInsets();
  return <Stack screenOptions={{ headerShown: false }} />;
  // return null (
  //   <Tabs
  //     screenOptions={{
  //       headerShown: false,
  //       sceneStyle: { backgroundColor: colors.background },
  //       tabBarActiveTintColor: colors.accent,
  //       tabBarInactiveTintColor: colors.textMuted,
  //       tabBarLabelStyle: typography.tiny,
  //       tabBarItemStyle: { paddingTop: 6 },
  //       tabBarStyle: {
  //         backgroundColor: colors.surface,
  //         borderTopColor: colors.border,
  //         borderTopWidth: hairline,
  //         height: TAB_BAR_CONTENT_HEIGHT + insets.bottom,
  //         paddingBottom: insets.bottom,
  //       },
  //     }}
  //   >
  //     {/* <Tabs.Screen
  //       name="index"
  //       options={{
  //         title: 'Library',
  //         tabBarIcon: ({ color, focused }) => (
  //           <TabBarIcon name="library-outline" color={color} focused={focused} />
  //         ),
  //       }}
  //     />
  //     <Tabs.Screen
  //       name="settings"
  //       options={{
  //         title: 'Settings',
  //         // Hidden from the bar; still reachable via the library header gear.
  //         href: null,
  //       }}
  //     /> */}
  //   </Tabs>
  // );
}

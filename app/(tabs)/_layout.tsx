import { Tabs } from 'expo-router';

import { TabBarIcon } from '@/components/ui';
import { useTheme } from '@/theme';

/**
 * Tab group: the two top-level destinations. Labels and icons follow the
 * reference UI ("Home" + house, "Settings" + gear, outline set), with the
 * active item tinted terracotta.
 */
export default function TabsLayout() {
  const { colors, typography, hairline } = useTheme();

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

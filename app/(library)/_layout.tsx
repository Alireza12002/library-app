import { Stack } from 'expo-router';

import { theme } from '@/theme';

/**
 * Library group layout: the tab/stack root the app opens into.
 */
export default function LibraryLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerTintColor: theme.colors.accent,
        contentStyle: { backgroundColor: theme.colors.background },
      }}
    />
  );
}

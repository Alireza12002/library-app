import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { theme } from '@/theme';

/**
 * Root layout: declares the navigation stack for the whole app.
 * Routes live in ./ (this directory); see docs/ARCHITECTURE.md §2.
 */
export default function RootLayout() {
  return (
    <>
      <StatusBar style="auto" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.colors.background },
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="(library)" />
        <Stack.Screen name="book/[id]" />
        <Stack.Screen name="reader/[bookId]" />
      </Stack>
    </>
  );
}

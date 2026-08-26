import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { theme } from '@/theme';

/**
 * Root layout: the app's outermost stack. `(tabs)` is the home group; the
 * reader and book detail are pushed on top of it so they render full-screen
 * without the tab bar (docs/ARCHITECTURE.md §2).
 */
export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.colors.background },
        }}
      >
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="book/[id]" />
        <Stack.Screen name="reader/[bookId]" />
      </Stack>
    </SafeAreaProvider>
  );
}

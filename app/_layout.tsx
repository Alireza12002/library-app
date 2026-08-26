import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ThemeProvider } from '@/theme';

/**
 * Root layout: the app's outermost stack. `(tabs)` is the home group; the
 * reader and book detail are pushed on top of it so they render full-screen
 * without the tab bar (docs/ARCHITECTURE.md §2).
 *
 * ThemeProvider wraps everything so every screen resolves the same palette.
 */
export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <StatusBar style="auto" />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="book/[id]" />
          <Stack.Screen name="reader/[bookId]" />
        </Stack>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

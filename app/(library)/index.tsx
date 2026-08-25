import { Link, Stack } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { theme } from '@/theme';

// Placeholder screen. The real library (import + book grid) arrives in
// Phase 2 (docs/ARCHITECTURE.md §10). Presentation only — no services yet.
export default function LibraryScreen() {
  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: true, title: 'My Books' }} />
      <Text style={styles.title}>My Books</Text>
      <Text style={styles.subtitle}>Your library is empty for now.</Text>
      <Link href="/book/demo" asChild>
        <Pressable hitSlop={8}>
          <Text style={styles.link}>Open book placeholder →</Text>
        </Pressable>
      </Link>
      <Link href={{ pathname: '/reader/[bookId]', params: { bookId: 'demo' } }} asChild>
        <Pressable hitSlop={8}>
          <Text style={styles.link}>Open reader placeholder →</Text>
        </Pressable>
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: theme.colors.background,
    padding: theme.spacing.lg,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: theme.colors.text,
  },
  subtitle: {
    fontSize: 14,
    color: theme.colors.textMuted,
  },
  link: {
    fontSize: 16,
    color: theme.colors.accent,
  },
});

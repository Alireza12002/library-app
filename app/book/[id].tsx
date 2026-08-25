import { LocalRouteParams, useLocalSearchParams, Link, Stack } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { theme } from '@/theme';

type BookDetailsParams = LocalRouteParams<{
  id: string;
}>;

// Placeholder screen. Book details arrive in Phase 2/5 (docs/ARCHITECTURE.md §10).
export default function BookDetailsScreen() {
  const { id } = useLocalSearchParams<BookDetailsParams>();

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: true, title: 'Book' }} />
      <Text style={styles.title}>Book details</Text>
      <Text style={styles.subtitle}>Book id: {id ?? '—'}</Text>
      <Link href={{ pathname: '/reader/[bookId]', params: { bookId: id ?? 'demo' } }} asChild>
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
  },
  title: {
    fontSize: 22,
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

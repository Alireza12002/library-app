import { LocalRouteParams, useLocalSearchParams, Stack } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { theme } from '@/theme';

type ReaderParams = LocalRouteParams<{
  bookId: string;
}>;

// Placeholder screen. The PdfEngine-backed reader arrives in Phase 3
// (docs/ARCHITECTURE.md §10). It must stay presentation-only.
export default function ReaderScreen() {
  const { bookId } = useLocalSearchParams<ReaderParams>();

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: true, title: 'Reader' }} />
      <Text style={styles.title}>Reader</Text>
      <Text style={styles.subtitle}>Book id: {bookId ?? '—'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
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
});

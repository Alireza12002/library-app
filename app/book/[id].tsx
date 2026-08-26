import { Link, Stack, useLocalSearchParams } from 'expo-router';

import { Button, Screen, Text } from '@/components/ui';
import { useTheme } from '@/theme';

// Placeholder screen. Book details arrive in Phase 2/5 (docs/ARCHITECTURE.md §10).
export default function BookDetailsScreen() {
  const { id } = useLocalSearchParams<'/book/[id]'>();
  const { colors, spacing } = useTheme();

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Book',
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.accent,
          headerTitleStyle: { color: colors.text },
        }}
      />
      <Screen center safeBottom style={{ gap: spacing.md }}>
        <Text variant="displayMedium">Book details</Text>
        <Text variant="body" tone="muted">
          Book id: {id ?? '—'}
        </Text>
        <Link href={{ pathname: '/reader/[bookId]', params: { bookId: id ?? 'demo' } }} asChild>
          <Button label="Open reader placeholder" variant="outline" />
        </Link>
      </Screen>
    </>
  );
}

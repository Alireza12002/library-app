import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState, Screen, Text } from '@/components/ui';
import { useTheme } from '@/theme';

/**
 * Library screen — the app's home destination.
 *
 * Shell stage: the header plus an empty state. The book grid, the search field
 * and the import action arrive in Phase 2 (docs/ARCHITECTURE.md §10); this
 * route holds no state and calls no services, so it makes no claim about
 * stored data.
 */
export default function LibraryScreen() {
  const { spacing } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Screen>
      <View style={{ paddingTop: insets.top + spacing.xl }}>
        <Text variant="displayLarge">My Library</Text>
      </View>
      <View style={styles.body}>
        <EmptyState
          icon="book-outline"
          title="No books yet"
          description="Books you add will appear here. Importing PDFs isn't available yet."
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

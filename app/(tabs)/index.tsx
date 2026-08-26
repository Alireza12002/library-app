import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, EmptyState, Screen, Text } from '@/components/ui';
import { BookCard } from '@/features/library/components';
import { useLibrary } from '@/features/library/hooks/useLibrary';
import { useTheme } from '@/theme';

/**
 * Library screen — the app's home destination.
 *
 * Presentation only: state comes from useLibrary(), persistence flows through
 * the service layer. This file holds no SQL, no filesystem and no repository
 * calls.
 */
export default function LibraryScreen() {
  const { books, isLoading, isImporting, error, openBook, deleteBook, refresh, addBooks } =
    useLibrary();
  const { colors, spacing } = useTheme();
  const insets = useSafeAreaInsets();

  const confirmDelete = (id: string, title: string) => {
    Alert.alert(`Delete “${title}”?`, 'The PDF file and its reading progress will be removed.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void deleteBook(id) },
    ]);
  };

  return (
    <Screen>
      <View style={[styles.header, { paddingTop: insets.top + spacing.xl }]}>
        <Text variant="displayLarge">My Library</Text>
      </View>

      {error ? (
        <View
          style={[styles.errorBanner, styles.bannerSpacing, { backgroundColor: colors.accentWash }]}
        >
          <Text variant="caption" tone="danger">
            {error}
          </Text>
          <Pressable accessibilityRole="button" onPress={refresh} hitSlop={8}>
            <Text variant="label" tone="accent">
              Try again
            </Text>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.actions}>
        <Button
          label={isImporting ? 'Adding…' : 'Add book'}
          disabled={isImporting}
          onPress={() => void addBooks()}
        />
      </View>

      <View style={styles.body}>
        {isLoading ? (
          <Text variant="body" tone="muted" center>
            Loading your library…
          </Text>
        ) : books.length === 0 && !error ? (
          <EmptyState
            icon="book-outline"
            title="No books yet"
            description="Tap “Add book” to import your first PDF."
          />
        ) : (
          <View style={styles.grid}>
            {books.map((book) => (
              <BookCard
                key={book.id}
                book={book}
                onPress={() => {
                  // Navigation to the reader arrives in Phase 3; for now the tap
                  // records the open so recency ordering stays truthful.
                  void openBook(book.id);
                }}
                onDelete={() => confirmDelete(book.id, book.title)}
              />
            ))}
          </View>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    alignSelf: 'stretch',
  },
  errorBanner: {
    padding: 12,
    borderRadius: 12,
    gap: 8,
  },
  bannerSpacing: {
    marginTop: 16,
    alignSelf: 'stretch',
  },
  actions: {
    paddingTop: 24,
    alignItems: 'flex-start',
  },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 40,
    alignSelf: 'stretch',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
});

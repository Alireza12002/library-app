import { Alert, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';

import { Button, EmptyState, Screen, Text } from '@/components/ui';
import type { BookSummary } from '@/core/entities/book';
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
  const { books, isLoading, isImporting, error, deleteBook, refresh, addBooks } = useLibrary();
  const { colors, spacing } = useTheme();
  const insets = useSafeAreaInsets();

  const confirmDelete = (id: string, title: string) => {
    Alert.alert(`Delete "${title}"?`, 'The PDF file and its reading progress will be removed.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void deleteBook(id) },
    ]);
  };

  // Navigation is not gated on a database write: the reader stamps recency
  // itself once the document actually renders (useReader.onLoaded). Awaiting a
  // write here meant a slow or failing SQLite call swallowed the tap and left
  // the user on the library with no feedback.
  const openReader = (book: BookSummary) => {
    router.push(`/reader/${book.id}`);
  };

  const renderBookCard = ({ item: book }: { item: BookSummary }) => (
    <BookCard
      key={book.id}
      book={book}
      onPress={() => openReader(book)}
      onContinueReading={book.lastPage > 0 ? () => openReader(book) : undefined}
      onDelete={() => confirmDelete(book.id, book.title)}
    />
  );

  return (
    <Screen>
      <View style={styles.headerWrapper}>
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
            <Pressable style={styles.errorActions} accessibilityRole="button" onPress={refresh} hitSlop={8}>
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
            description='Tap "Add book" to import your first PDF.'
          />
        ) : (
          <FlatList
            data={books}
            renderItem={renderBookCard}
            keyExtractor={(item) => item.id}
            numColumns={2}
            columnWrapperStyle={styles.columnWrapper}
            contentContainerStyle={{ paddingBottom: spacing.xl }}
            removeClippedSubviews
            maxToRenderPerBatch={10}
            windowSize={5}
            initialNumToRender={8}
          />
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerWrapper: {
    // Header, error banner and the Add button stay put; only the list scrolls.
    alignSelf: 'stretch',
  },
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
  errorActions: {
    marginTop: 4,
  },
  actions: {
    paddingTop: 24,
    alignItems: 'flex-start',
  },
  body: {
    flex: 1,
    alignSelf: 'stretch',
    paddingTop: 16,
  },
  columnWrapper: {
    gap: 12,
  },
});
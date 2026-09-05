import { useCallback, useMemo } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';

import { Button, EmptyState, Screen, Text } from '@/components/ui';
import type { BookSummary } from '@/core/entities/book';
import { BookCard } from '@/features/library/components';
import { useLibrary } from '@/features/library/hooks/useLibrary';
import { useGridMetrics, useTheme } from '@/theme';

/**
 * Library screen — the app's home destination.
 *
 * Presentation only: state comes from useLibrary(), persistence flows through
 * the service layer. This file holds no SQL, no filesystem and no repository
 * calls.
 *
 * Layout: a virtualized 2-column grid whose cell width is computed from the live
 * window width (useGridMetrics), so the same code gives ~2×5 visible tiles on a
 * normal phone, stays correct on small phones, and adds a third column on
 * tablet-width windows without any hardcoded dimensions.
 */
export default function LibraryScreen() {
  const { books, isLoading, isImporting, error, deleteBook, refresh, addBooks } = useLibrary();
  const { colors, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const grid = useGridMetrics();

  const confirmDelete = useCallback(
    (id: string, title: string) => {
      Alert.alert(`Delete "${title}"?`, 'The PDF file and its reading progress will be removed.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => void deleteBook(id) },
      ]);
    },
    [deleteBook],
  );

  // Navigation is not gated on a database write: the reader stamps recency
  // itself once the document actually renders (useReader.onLoaded). Awaiting a
  // write here meant a slow or failing SQLite call swallowed the tap and left
  // the user on the library with no feedback.
  const openReader = useCallback((bookId: string) => {
    router.push(`/reader/${bookId}`);
  }, []);

  // Stable renderItem: an inline arrow here would give every BookCard new
  // callbacks on each list render, defeating BookCard's memo.
  const renderBookCard = useCallback(
    ({ item: book }: { item: BookSummary }) => (
      <BookCard
        book={book}
        width={grid.itemWidth}
        onPress={() => openReader(book.id)}
        onContinueReading={book.lastPage > 0 ? () => openReader(book.id) : undefined}
        onDelete={() => confirmDelete(book.id, book.title)}
      />
    ),
    [grid.itemWidth, openReader, confirmDelete],
  );

  const keyExtractor = useCallback((item: BookSummary) => item.id, []);

  const contentContainerStyle = useMemo(
    () => ({
      paddingHorizontal: grid.horizontalPadding,
      // Bottom inset is handled by the tab bar; this is breathing room only.
      paddingBottom: spacing.xl,
      gap: grid.gap,
    }),
    [grid.horizontalPadding, grid.gap, spacing.xl],
  );

  const columnWrapperStyle = useMemo(() => ({ gap: grid.gap }), [grid.gap]);

  return (
    <Screen gutter={false}>
      <View style={[styles.headerWrapper, { paddingHorizontal: grid.horizontalPadding }]}>
        <View style={{ paddingTop: insets.top + spacing.lg }}>
          <Text variant="displayLarge">My Library</Text>
        </View>

        {error ? (
          <View
            style={[
              styles.errorBanner,
              { marginTop: spacing.md, backgroundColor: colors.accentWash },
            ]}
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

        <View style={{ paddingTop: spacing.lg, paddingBottom: spacing.md }}>
          <Button
            label={isImporting ? 'Adding…' : 'Add book'}
            disabled={isImporting}
            onPress={() => void addBooks()}
          />
        </View>
      </View>

      {isLoading ? (
        <View style={styles.centered}>
          <Text variant="body" tone="muted" center>
            Loading your library…
          </Text>
        </View>
      ) : books.length === 0 && !error ? (
        <View style={styles.centered}>
          <EmptyState
            icon="book-outline"
            title="No books yet"
            description='Tap "Add book" to import your first PDF.'
          />
        </View>
      ) : (
        <FlatList
          data={books}
          renderItem={renderBookCard}
          keyExtractor={keyExtractor}
          numColumns={grid.columns}
          // Remounts the list when the column count changes (rotation /
          // split-screen); FlatList cannot change numColumns in place.
          key={`cols-${grid.columns}`}
          columnWrapperStyle={grid.columns > 1 ? columnWrapperStyle : undefined}
          contentContainerStyle={contentContainerStyle}
          showsVerticalScrollIndicator={false}
          // Virtualization: tiles are cheap, so a modest window keeps memory flat
          // while staying ahead of the scroll.
          initialNumToRender={grid.columns * 4}
          maxToRenderPerBatch={grid.columns * 3}
          windowSize={5}
          removeClippedSubviews
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerWrapper: {
    // Header, error banner and Add button stay put; only the grid scrolls.
    alignSelf: 'stretch',
  },
  errorBanner: {
    padding: 12,
    borderRadius: 12,
    gap: 8,
    alignSelf: 'stretch',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
});

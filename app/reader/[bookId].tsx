import { Pressable, StyleSheet, Text as RNText, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { EmptyState, IconButton, Screen, Text } from '@/components/ui';
import { useReader } from '@/features/reader/hooks/useReader';
import type { PdfEngineViewProps } from '@/core/ports/pdfEngine';
import { getPdfEngine } from '@/pdf/engine';
import { useTheme } from '@/theme';

/**
 * Reader route (ARCHITECTURE.md §2).
 *
 * Renders the engine-agnostic view from getPdfEngine(); this file never imports
 * a PDF library and never does page arithmetic — the app-wide convention is
 * 0-based everywhere above the port; conversion happens inside PdfEngine only.
 *
 * Resume page comes in via `page` param (0-based, optional). Persistent reading
 * progress is intentionally NOT implemented yet.
 */
export default function ReaderScreen() {
  const params = useLocalSearchParams<'/reader/[bookId]' & { page?: string }>();
  const bookId = Array.isArray(params.bookId) ? (params.bookId[0] ?? '') : (params.bookId ?? '');
  const pageParam = Array.isArray(params.page) ? (params.page[0] ?? '') : (params.page ?? '');
  const initialPageIndex = Math.max(0, (Number(pageParam) || 1) - 1);

  const reader = useReader(bookId, initialPageIndex);
  const engine = getPdfEngine();
  const { colors } = useTheme();

  // Reading mode: vertical continuous ↔ horizontal page-swipe.
  const [horizontal, setHorizontal] = useState(false);

  const goPrev = () => {
    if (reader.currentPage <= 0) return;
    reader.controllerBox.current?.setPage(reader.currentPage - 1);
  };

  const goNext = () => {
    if (reader.pageCount === null || reader.currentPage >= reader.pageCount - 1) return;
    reader.controllerBox.current?.setPage(reader.currentPage + 1);
  };

  /** User-facing copy per normalized renderer error code. */
  function renderFailureState() {
    switch (reader.renderError?.code) {
      case 'password_required':
        return (
          <EmptyState
            icon="lock-closed-outline"
            title="Password required"
            description="This PDF is protected. Opening protected documents isn't supported yet."
          />
        );
      case 'password_incorrect':
        return (
          <EmptyState
            icon="lock-closed-outline"
            title="Password protected"
            description="This PDF can't be opened without its password."
          />
        );
      case 'invalid_document':
        return (
          <EmptyState
            icon="alert-circle-outline"
            title="Can't display this PDF"
            description="The file appears to be corrupted or is not a valid PDF."
          />
        );
      case 'file_missing':
        return (
          <EmptyState
            icon="document-outline"
            title="File missing"
            description="The PDF file for this book is missing or was deleted."
          />
        );
      default:
        return (
          <EmptyState
            icon="alert-circle-outline"
            title="Something went wrong"
            description={reader.renderError?.message ?? 'The PDF could not be displayed.'}
          />
        );
    }
  }

  const showFatal = reader.fatal !== null;
  const showRenderError = !showFatal && reader.renderError !== null;

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: reader.book?.title
            ? () => (
                <View style={styles.headerTitle}>
                  <Text variant="label" numberOfLines={1}>
                    {reader.book?.title}
                  </Text>
                  {reader.isLoaded && reader.pageCount !== null ? (
                    <Text variant="tiny" tone="muted">
                      Page {reader.currentPage + 1} of {reader.pageCount}
                    </Text>
                  ) : null}
                </View>
              )
            : 'Reader',
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.accent,
          headerRight: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                horizontal ? 'Switch to vertical scrolling' : 'Switch to page-swipe'
              }
              hitSlop={8}
              onPress={() => setHorizontal((value) => !value)}
            >
              <RNText style={{ color: colors.accent, fontSize: 15 }}>
                {horizontal ? 'Vertical' : 'Pages'}
              </RNText>
            </Pressable>
          ),
        }}
      />

      <Screen gutter={false}>
        {reader.isResolving ? (
          <View style={styles.center}>
            <Text variant="body" tone="muted">
              Opening…
            </Text>
          </View>
        ) : showFatal ? (
          <View style={styles.center}>
            <EmptyState
              icon="alert-circle-outline"
              title="Can't open this book"
              description={reader.fatal ?? ''}
            />
          </View>
        ) : showRenderError ? (
          <View style={styles.center}>{renderFailureState()}</View>
        ) : reader.book ? (
          <View style={styles.flex}>
            {(() => {
              const engineProps: PdfEngineViewProps = {
                source: { kind: 'file', uri: reader.book.fileUri },
                horizontal,
                pagingEnabled: horizontal,
                fitMode: 'width',
                doubleTapZoom: true,
                controllerBox: reader.controllerBox,
                onLoad: reader.onLoaded,
                onPageChange: reader.onPageChanged,
                onError: reader.onError,
              };
              if (engine.capabilities.jumpToInitialPage && initialPageIndex > 0) {
                engineProps.initialPosition = { pageIndex: initialPageIndex };
              }
              return <engine.ViewComponent {...engineProps} />;
            })()}

            {reader.isLoaded ? (
              <View style={[styles.pageBar, { backgroundColor: colors.surface }]}>
                <IconButton
                  name="chevron-back"
                  accessibilityLabel="Previous page"
                  size={20}
                  tone="accent"
                  disabled={reader.currentPage <= 0}
                  onPress={goPrev}
                />
                <Text variant="caption" tone="muted">
                  {reader.currentPage + 1} / {reader.pageCount ?? '—'}
                </Text>
                <IconButton
                  name="chevron-forward"
                  accessibilityLabel="Next page"
                  size={20}
                  tone="accent"
                  disabled={reader.pageCount !== null && reader.currentPage >= reader.pageCount - 1}
                  onPress={goNext}
                />
              </View>
            ) : (
              <View style={[styles.pageBar, { backgroundColor: colors.surface }]}>
                <Text variant="caption" tone="muted">
                  Loading document…
                </Text>
              </View>
            )}
          </View>
        ) : (
          <View style={styles.center}>
            <EmptyState
              icon="book-outline"
              title="Nothing to open"
              description="No book selected."
            />
          </View>
        )}
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  headerTitle: {
    alignItems: 'center',
    maxWidth: 220,
  },
  pageBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
});

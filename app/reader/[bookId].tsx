import { Stack, useLocalSearchParams } from 'expo-router';

import { EmptyState, Screen } from '@/components/layout';

/**
 * Reader route — placeholder.
 *
 * The PdfEngine-backed reader arrives in Phase 3 (docs/ARCHITECTURE.md §10).
 * This route only proves the navigation target resolves; it must not touch the
 * PDF adapter, storage or progress services.
 */
export default function ReaderScreen() {
  const { bookId } = useLocalSearchParams<'/reader/[bookId]'>();

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'Reader' }} />
      <Screen center edgeToEdgeBottom>
        <EmptyState
          title="Reader not implemented"
          description={`This route is a placeholder for book ${bookId}. PDF rendering lands in a later phase.`}
        />
      </Screen>
    </>
  );
}

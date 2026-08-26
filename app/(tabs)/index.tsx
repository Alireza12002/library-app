import { EmptyState, Screen } from '@/components/layout';

/**
 * Library screen — the app's home destination.
 *
 * Shell stage: the empty state is the whole screen. The book list, the import
 * action and any data access arrive in Phase 2 (docs/ARCHITECTURE.md §10);
 * until then this route holds no state and calls no services.
 */
export default function LibraryScreen() {
  return (
    <Screen center>
      <EmptyState
        title="No books yet"
        description="Books you add will appear here. Importing PDFs isn't available yet."
      />
    </Screen>
  );
}

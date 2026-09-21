/**
 * @/data double for hook tests (ARCHITECTURE.md §9).
 *
 * useReadingProgress lazily imports the repositories to flush debounced page
 * writes; useReflowReader does the same for the Reflow reading position. Both
 * writes are recorded here so a test can assert WHICH mode's position was
 * touched — the two must stay independent.
 *
 * Test-only: nothing in the app imports this file.
 */
import type { ReflowPosition } from '@/core/entities/reflowDocument';

export const repositoryCalls: string[] = [];

/** Last Reflow position written per book id, so restores can be simulated. */
export const savedReflowPositions = new Map<string, ReflowPosition | null>();

/** Clears recorded calls and saved positions. Call in beforeEach. */
export function resetRepositories(): void {
  repositoryCalls.length = 0;
  savedReflowPositions.clear();
}

export async function getRepositories(): Promise<{
  books: {
    updateProgress(id: string, lastPage: number): Promise<void>;
    updateReflowPosition(id: string, position: ReflowPosition | null): Promise<void>;
  };
}> {
  return {
    books: {
      async updateProgress(id: string, lastPage: number): Promise<void> {
        repositoryCalls.push(`books.updateProgress(${id},${lastPage})`);
      },

      async updateReflowPosition(id: string, position: ReflowPosition | null): Promise<void> {
        repositoryCalls.push(
          position === null
            ? `books.updateReflowPosition(${id},null)`
            : `books.updateReflowPosition(${id},${position.blockIndex},${position.pageIndex})`,
        );
        savedReflowPositions.set(id, position);
      },
    },
  };
}

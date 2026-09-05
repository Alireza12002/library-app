/**
 * @/data double for hook tests (ARCHITECTURE.md §9).
 *
 * useReadingProgress lazily imports the repositories to flush debounced page
 * writes. Tests never assert on those writes, but the import must resolve.
 *
 * Test-only: nothing in the app imports this file.
 */

export const repositoryCalls: string[] = [];

export async function getRepositories(): Promise<{
  books: { updateProgress(id: string, lastPage: number): Promise<void> };
}> {
  return {
    books: {
      async updateProgress(id: string, lastPage: number): Promise<void> {
        repositoryCalls.push(`books.updateProgress(${id},${lastPage})`);
      },
    },
  };
}

/**
 * Service layer entry point (ARCHITECTURE.md §3, L4).
 *
 * The UI composes features from these factories. Services own orchestration
 * between repositories (data) and adapters (files/pdf); screens never import
 * either directly (enforced by eslint.config.js).
 */
import { getRepositories } from '@/data';
import { documentPicker } from '@/files/documentPicker';
import { validatePickedPdf } from '@/files/pdfValidation';
import { expoFileSystemStorage } from '@/files/storage';

import { createBookService, type BookService } from './bookService';
import { createImportService, type ImportService } from './importService';

export { type BookService } from './bookService';
export { createImportService, type ImportResult, type ImportService } from './importService';

let instances: { books: BookService; imports: ImportService } | null = null;

/** The shared services bound to real repositories, storage and the picker. */
export async function getServices(): Promise<{ books: BookService; imports: ImportService }> {
  if (instances) return instances;

  const repos = await getRepositories();

  const books = createBookService({
    listBooks: (sort) => repos.books.list(sort),
    getBook: (id) => repos.books.findById(id),
    deleteBookRow: (id) => repos.books.remove(id),
    markOpened: (id, at) => repos.books.markOpened(id, at),
    storage: expoFileSystemStorage,
  });

  const imports = createImportService({
    picker: documentPicker,
    storage: expoFileSystemStorage,
    validatePicked: validatePickedPdf,
    createBook: (input) => repos.books.create(input),
  });

  instances = { books, imports };
  return instances;
}

/** Test/teardown seam. */
export function resetServicesForTesting(): void {
  instances = null;
}

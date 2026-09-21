/**
 * Service layer entry point (ARCHITECTURE.md §3, L4).
 *
 * The UI composes features from these factories. Services own orchestration
 * between repositories (data) and adapters (files/pdf); screens never import
 * either directly (enforced by eslint.config.js).
 */
import { getRepositories } from '@/data';
import { getTextExtractionEngine } from '@/pdf/textEngine';
import { documentPicker } from '@/files/documentPicker';
import { validatePickedPdf } from '@/files/pdfValidation';
import { expoFileSystemStorage } from '@/files/storage';

import { createBookService, type BookService } from './bookService';
import { createBookmarkService, type BookmarkService } from './bookmarkService';
import { createImportService, type ImportService } from './importService';
import { createReflowService, type ReflowService } from './reflowService';
import { createSettingsService, type SettingsService } from './settingsService';
import { createTextExtractionService, type TextExtractionService } from './textExtractionService';

export { type BookService } from './bookService';
export { createBookmarkService, type BookmarkService } from './bookmarkService';
export { createImportService, type ImportResult, type ImportService } from './importService';
export { createSettingsService, type SettingsService } from './settingsService';
export { createTextExtractionService, type TextExtractionService } from './textExtractionService';
export {
  createReflowService,
  withPageStarts,
  type ReflowGenerationOptions,
  type ReflowProgress,
  type ReflowService,
} from './reflowService';

interface ServiceRegistry {
  books: BookService;
  bookmarks: BookmarkService;
  imports: ImportService;
  textExtraction: TextExtractionService;
  reflow: ReflowService;
  settings: SettingsService;
}

let instances: ServiceRegistry | null = null;

/** The shared services bound to real repositories, storage and the picker. */
export async function getServices(): Promise<ServiceRegistry> {
  if (instances) return instances;

  const repos = await getRepositories();

  const books = createBookService({
    listBooks: (sort) => repos.books.list(sort),
    getBook: (id) => repos.books.findById(id),
    deleteBookRow: (id) => repos.books.remove(id),
    markOpened: (id, at) => repos.books.markOpened(id, at),
    updateProgress: (id, lastPage) => repos.books.updateProgress(id, lastPage),
    storage: expoFileSystemStorage,
  });

  const bookmarks = createBookmarkService({
    listForBook: (bookId) => repos.bookmarks.listForBook(bookId),
    findById: (id) => repos.bookmarks.findById(id),
    create: (input) => repos.bookmarks.create(input),
    remove: (id) => repos.bookmarks.remove(id),
    removeForBook: (bookId) => repos.bookmarks.removeForBook(bookId),
  });

  const imports = createImportService({
    picker: documentPicker,
    storage: expoFileSystemStorage,
    validatePicked: validatePickedPdf,
    createBook: (input) => repos.books.create(input),
  });

  const engine = getTextExtractionEngine();

  const textExtraction = createTextExtractionService({
    engine,
    cache: repos.textCache,
  });

  const reflow = createReflowService({
    textExtraction,
    repository: repos.reflowDocuments,
    getPageCount: (source) => engine.getPageCount(source),
  });

  const settings = createSettingsService({
    load: () => repos.readingSettings.get(),
    save: (next) => repos.readingSettings.save(next),
  });

  instances = { books, bookmarks, imports, textExtraction, reflow, settings };
  return instances;
}

/** Test/teardown seam. */
export function resetServicesForTesting(): void {
  instances = null;
}

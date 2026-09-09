/**
 * Row ↔ entity mapping for the data layer (ARCHITECTURE.md §3).
 *
 * SQLite stores snake_case columns, unix-ms integers and 0/1 for booleans;
 * the domain uses camelCase, `Date` and `boolean`. That translation happens
 * here and nowhere else, so no layer above data/ ever sees a raw row.
 */
import type { Book, BookSummary } from '@/core/entities/book';
import type { Bookmark } from '@/core/entities/bookmark';

export interface BookRow {
  id: string;
  title: string;
  author: string | null;
  file_uri: string;
  file_name: string;
  file_size: number;
  page_count: number | null;
  last_page: number;
  reflow_block_index: number | null;
  reflow_page_index: number | null;
  created_at: number;
  updated_at: number;
  last_opened_at: number | null;
}

export interface BookmarkRow {
  id: string;
  book_id: string;
  page: number;
  title: string | null;
  note: string | null;
  created_at: number;
}

export function toBook(row: BookRow): Book {
  return {
    id: row.id,
    title: row.title,
    author: row.author,
    fileUri: row.file_uri,
    fileName: row.file_name,
    fileSize: row.file_size,
    pageCount: row.page_count,
    lastPage: row.last_page,
    reflowBlockIndex: row.reflow_block_index,
    reflowPageIndex: row.reflow_page_index,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    lastOpenedAt: row.last_opened_at === null ? null : new Date(row.last_opened_at),
  };
}

export function toBookSummary(row: BookRow): BookSummary {
  return {
    id: row.id,
    title: row.title,
    author: row.author,
    pageCount: row.page_count,
    lastPage: row.last_page,
    lastOpenedAt: row.last_opened_at === null ? null : new Date(row.last_opened_at),
  };
}

export function toBookmark(row: BookmarkRow): Bookmark {
  return {
    id: row.id,
    bookId: row.book_id,
    page: row.page,
    title: row.title,
    note: row.note,
    createdAt: new Date(row.created_at),
  };
}

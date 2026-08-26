/**
 * File storage adapter — StoragePort implementation over the NEW
 * expo-file-system API (ARCHITECTURE.md §0/R6: legacy API is forbidden).
 *
 * Layout: <Documents>/library/<uuid>-<name>.pdf — the uuid prefix prevents
 * collisions when two books import under the same file name.
 */
import { Directory, File, Paths } from 'expo-file-system';

import { LIBRARY_DIR_NAME } from '@/config';
import type { StoragePort } from '@/core/ports';
import { newId } from '@/core/ids';

function libraryDirectory(): Directory {
  const dir = new Directory(`${Paths.document.uri}/${LIBRARY_DIR_NAME}`);
  if (!dir.exists) {
    // intermediates: true would also work; explicit parent creation keeps the
    // layout legible. Idempotent so concurrent callers don't race.
    dir.create({ idempotent: true, intermediates: true });
  }
  return dir;
}

/** Strips characters that are awkward in file names. */
function sanitizeFileName(name: string): string {
  return name.replace(/[/\\?%*:|"<>]/g, '_');
}

export const expoFileSystemStorage: StoragePort = {
  async copyIntoLibrary(sourceUri: string, fileName: string): Promise<string> {
    const dir = libraryDirectory();
    const destination = new File(`${dir.uri}/${newId()}-${sanitizeFileName(fileName)}`);

    // The picker hands out transient content:// URIs (R5); copy immediately.
    await new File(sourceUri).copy(destination);

    return destination.uri;
  },

  async deleteStoredFile(storedPath: string): Promise<boolean> {
    const file = new File(storedPath);
    if (!file.exists) return false;

    file.delete();
    return true;
  },

  async exists(storedPath: string): Promise<boolean> {
    return new File(storedPath).exists;
  },
};

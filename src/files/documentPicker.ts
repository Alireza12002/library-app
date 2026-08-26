/**
 * Document picker adapter — wraps expo-document-picker behind the
 * DocumentPickerPort contract (ARCHITECTURE.md §3).
 *
 * `copyToCacheDirectory: true` (the default) makes SAF hand us a real cache
 * file with its original name, which pdfValidation can read headers/sizes
 * from. Per R5 the cache copy is transient: importService immediately copies
 * the file into private storage and the app never persists this URI.
 */
import * as DocumentPicker from 'expo-document-picker';

import type { DocumentPickerPort, PickedDocument } from '@/core/ports';

export const documentPicker: DocumentPickerPort = {
  async pickPdf(): Promise<PickedDocument | null> {
    const result = await DocumentPicker.getDocumentAsync({
      type: 'application/pdf',
      multiple: false,
      copyToCacheDirectory: true,
    });

    if (result.canceled) return null;

    const asset = result.assets[0];
    if (!asset) return null;

    return {
      uri: asset.uri,
      name: asset.name,
      sizeBytes: asset.size ?? null,
    };
  },
};

/**
 * Document picker port — ARCHITECTURE.md §3/§6.
 * Implemented over expo-document-picker in src/files/documentPicker.ts.
 * Kept separate from DocumentStoragePort so tests can fake selection
 * independently of copying.
 */

export interface PickedDocument {
  /** Platform URI for the picked file (content:// on Android). */
  uri: string;
  name: string;
  sizeBytes?: number;
}

export interface DocumentPickerPort {
  /** Let the user pick one or more PDFs; resolves to [] when cancelled. */
  pickPdfs(): Promise<PickedDocument[]>;
}

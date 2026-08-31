/**
 * Document picker port — ARCHITECTURE.md §6.
 * The ONLY contract through which the app touches the system document picker.
 * Concrete adapters live in src/files/.
 */
export interface PickedDocument {
  uri: string;
  name: string;
  sizeBytes: number | null;
}

export interface DocumentPickerPort {
  /** Opens the system picker filtered to PDFs; null when the user cancels. */
  pickPdf(): Promise<PickedDocument | null>;
}

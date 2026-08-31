export type {
  TextExtractionSource,
  TextExtractionCapabilities,
  ExtractedPageText,
  ExtractedPageRange,
  TextExtractionErrorCode,
  TextExtractionError,
  TextExtractionEngine,
} from '@/core/ports/textExtraction';

export type {
  PdfSource,
  PdfPagePosition,
  PdfLoadInfo,
  PdfEngineErrorCode,
  PdfEngineError,
  PdfEngineViewProps,
  PdfEngineController,
  PdfEngineCapabilities,
  PdfEngine,
} from '@/core/ports/pdfEngine';

export type { StoragePort } from '@/core/ports/storage';

export type { PickedDocument, DocumentPickerPort } from '@/core/ports/documentPicker';

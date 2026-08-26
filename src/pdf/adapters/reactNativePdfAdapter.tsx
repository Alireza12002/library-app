/**
 * PdfEngine port implementation backed by react-native-pdf 7.0.5.
 *
 * Verified against the installed package's index.d.ts + native sources:
 * - `page` prop (1-based) is applied on mount → initial page works;
 * - ref.setPage(n) (1-based) navigates programmatically;
 * - onPageChanged(page, pageCount) reports 1-based pages → converted here;
 * - fitPolicy 0/1/2 ↔ width/height/both; horizontal ↔ horizontal;
 *   enablePaging ↔ pagingEnabled; zoom = native pinch + double-tap.
 *
 * This is the ONLY file allowed to import react-native-pdf
 * (enforced by eslint.config.js).
 */
import type { ComponentType } from 'react';
import PdfLib from 'react-native-pdf';
import type { PdfProps } from 'react-native-pdf';

import type {
  PdfEngine,
  PdfEngineCapabilities,
  PdfEngineController,
  PdfEngineError,
  PdfEngineErrorCode,
  PdfEngineViewProps,
} from '@/core/ports/pdfEngine';

export const REACT_NATIVE_PDF_CAPABILITIES: PdfEngineCapabilities = {
  jumpToInitialPage: true,
  programmaticNavigation: true,
  pinchZoom: true,
  textExtraction: false,
};

const FIT_POLICY = {
  width: 0,
  height: 1,
  both: 2,
} as const;

/** Maps a raw renderer failure onto our normalized error codes. */
function normalizeError(raw: unknown): PdfEngineError {
  const message = raw instanceof Error ? raw.message : String(raw);
  const lower = message.toLowerCase();

  let code: PdfEngineErrorCode = 'unknown';
  if (lower.includes('cannot find') || lower.includes('no such file') || lower.includes('enoent')) {
    code = 'file_missing';
  } else if (lower.includes('password')) {
    code =
      lower.includes('incorrect') || lower.includes('invalid')
        ? 'password_incorrect'
        : 'password_required';
  } else if (
    lower.includes('cannot be opened') ||
    lower.includes('corrupt') ||
    lower.includes('invalid') ||
    lower.includes('format')
  ) {
    code = 'invalid_document';
  }

  return { code, message };
}

export interface AdapterOwnProps {
  /**
   * Mutable box the host owns; the adapter fills it with the imperative
   * navigation handle while the native view is mounted.
   */
  controllerBox?: { current: PdfEngineController | null };
}

type ViewProps = PdfEngineViewProps & AdapterOwnProps;

/**
 * Builds the engine's view component. The host passes a mutable box via
 * `controllerBox`; it is filled with { setPage(n) } on mount and cleared on
 * unmount by React's ref semantics.
 */
export function createExpoPdfAdapter(): PdfEngine {
  function ViewComponent(props: ViewProps) {
    const {
      source,
      initialPosition,
      horizontal = false,
      pagingEnabled = false,
      fitMode = 'width',
      doubleTapZoom = true,
      onLoad,
      onPageChange,
      onError,
      controllerBox,
    } = props;

    const pdfProps: PdfProps = {
      style: [{ flex: 1, backgroundColor: 'transparent' }],
      // Local files pass straight through; no blob-util cache layer for v1.
      // (Night-mode inversion maps to `nightMode` natively; deferred to Phase 6
      // reader ergonomics, so `inverted` is intentionally not forwarded yet.)
      source: { uri: source.uri },
      trustAllCerts: true,
      page: initialPosition ? Math.max(1, initialPosition.pageIndex + 1) : 1,
      fitPolicy: FIT_POLICY[fitMode],
      horizontal,
      enablePaging: pagingEnabled,
      spacing: 0,
      enableDoubleTapZoom: doubleTapZoom,
      enableAnnotationRendering: true,
      enableAntialiasing: true,
      onLoadComplete: (numberOfPages: number) => {
        onLoad?.({ pageCount: numberOfPages });
      },
      onPageChanged: (page: number, numberOfPages: number) => {
        onPageChange?.({ pageIndex: Math.max(0, page - 1), pageCount: numberOfPages });
      },
      onError: (raw) => {
        onError?.(normalizeError(raw));
      },
    };

    return (
      <PdfLib
        ref={(instance: unknown) => {
          if (!controllerBox) return;
          controllerBox.current =
            instance === null
              ? null
              : {
                  // Domain convention: 0-based in, 1-based out (renderer's
                  // numbering). The ONLY +/-1 in the app lives here.
                  setPage(pageIndex: number) {
                    const clamped = Math.max(0, Math.floor(pageIndex));
                    (instance as { setPage: (n: number) => void }).setPage(clamped + 1);
                  },
                };
        }}
        {...pdfProps}
      />
    );
  }

  return {
    ViewComponent: ViewComponent as ComponentType<PdfEngineViewProps>,
    capabilities: REACT_NATIVE_PDF_CAPABILITIES,
  };
}

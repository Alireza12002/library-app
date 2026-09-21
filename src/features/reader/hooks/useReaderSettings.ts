/**
 * useReaderSettings — persistent reader settings (ARCHITECTURE.md §4).
 *
 * Owns: settings state, persistence, validation against engine capabilities.
 * The screen renders; this decides.
 *
 * PERSISTENCE
 * -----------
 * Settings persist through the settings service into the same SQLite database
 * as everything else. This matters beyond cosmetics: `settings.mode` selects
 * WHICH independent reading position is restored when a book reopens — the PDF
 * page (`last_page`) or the Reflow position (`reflow_block_index`/`_page_index`).
 * The previous implementation wrote to an AsyncStorage module that is not part
 * of this app; the require threw, the catch swallowed it, and the mode silently
 * reset to 'pdf' on every launch — which is why a book "forgot" its Reflow
 * position on restart.
 *
 * The loaded settings are cached module-wide so every mount after the first is
 * synchronous, and concurrent mounts share one load.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  DEFAULT_READING_SETTINGS,
  READING_MODES,
  type ReadingSettings,
} from '@/core/entities/readingSettings';
import type { PdfEngineCapabilities } from '@/core/ports/pdfEngine';
import { getPdfEngine } from '@/pdf/engine';
import { getServices } from '@/services';

let cachedSettings: ReadingSettings | null = null;
let loadPromise: Promise<ReadingSettings> | null = null;

/** Loads once; concurrent callers await the same promise. */
function loadSettingsAsync(): Promise<ReadingSettings> {
  if (cachedSettings) return Promise.resolve(cachedSettings);
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    try {
      const { settings } = await getServices();
      cachedSettings = await settings.getSettings();
    } catch {
      // Unreadable settings degrade to defaults; they must never block reading.
      cachedSettings = { ...DEFAULT_READING_SETTINGS };
    }
    return cachedSettings;
  })();

  return loadPromise;
}

/** Persists in the background; state has already moved. Failures keep reading usable. */
function persistSettings(next: ReadingSettings): void {
  cachedSettings = next;
  void (async () => {
    try {
      const { settings } = await getServices();
      cachedSettings = await settings.saveSettings(next);
    } catch {
      // Best-effort: the in-memory settings still apply for this session.
    }
  })();
}

/** Test seam: drops the module cache so a fresh load hits storage again. */
export function resetReaderSettingsCacheForTesting(): void {
  cachedSettings = null;
  loadPromise = null;
}

export interface UseReaderSettingsResult {
  settings: ReadingSettings;
  /** Update a subset of settings. Persists immediately. */
  updateSettings: (patch: Partial<ReadingSettings>) => void;
  /** Reset to defaults. */
  resetSettings: () => void;
  /** True while loading from storage. */
  isLoading: boolean;
  /** Engine capabilities — only expose settings the engine actually supports. */
  capabilities: PdfEngineCapabilities;
}

export function useReaderSettings(): UseReaderSettingsResult {
  const engine = getPdfEngine();

  // Cached settings make every mount after the first synchronous — the reader
  // then starts directly in the persisted mode with no default-mode flash.
  const [settings, setSettings] = useState<ReadingSettings>(
    () => cachedSettings ?? DEFAULT_READING_SETTINGS,
  );
  const [isLoading, setIsLoading] = useState(cachedSettings === null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    if (cachedSettings === null) {
      void loadSettingsAsync().then((loaded) => {
        if (mountedRef.current) {
          setSettings(loaded);
          setIsLoading(false);
        }
      });
    }

    return () => {
      mountedRef.current = false;
    };
  }, []);

  const updateSettings = useCallback(
    (patch: Partial<ReadingSettings>) => {
      const merged: ReadingSettings = { ...settings, ...patch };
      const validated = validateAgainstCapabilities(merged, engine.capabilities);
      setSettings(validated);
      persistSettings(validated);
    },
    [settings, engine.capabilities],
  );

  const resetSettings = useCallback(() => {
    const defaults = { ...DEFAULT_READING_SETTINGS };
    setSettings(defaults);
    persistSettings(defaults);
  }, []);

  return {
    settings,
    updateSettings,
    resetSettings,
    isLoading,
    capabilities: engine.capabilities,
  };
}

/**
 * Filters settings to only what the engine supports.
 * Unsupported settings are reset to defaults.
 */
function validateAgainstCapabilities(
  settings: ReadingSettings,
  caps: PdfEngineCapabilities,
): ReadingSettings {
  const validated: ReadingSettings = { ...settings };

  // Layout mode: both 'pdf' and 'reflow' are supported.
  if (!READING_MODES.includes(validated.mode)) {
    validated.mode = 'pdf';
  }

  // Invert pages requires engine support
  if (!caps.invertPages) {
    validated.invertPages = false;
  }

  // Fit mode - validate against supported fit modes
  if (!caps.fitModes.includes(validated.fitMode)) {
    validated.fitMode = 'width';
  }

  // Page gap requires engine support
  if (!caps.pageGap) {
    validated.pageGap = 0;
  }

  // Other settings (theme, font, contentWidth) are handled by the reflow reader
  // and don't affect the PDF engine directly.

  return validated;
}

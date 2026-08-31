/**
 * useReaderSettings — persistent reader settings (ARCHITECTURE.md §4).
 *
 * Owns: settings state, persistence, validation against engine capabilities.
 * The screen renders; this decides.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import type { ReadingSettings } from '@/core/entities/readingSettings';
import type { PdfEngineCapabilities } from '@/core/ports/pdfEngine';
import { getPdfEngine } from '@/pdf/engine';

const STORAGE_KEY = 'reader-settings';

const DEFAULT_READING_SETTINGS: ReadingSettings = {
  mode: 'pdf',
  theme: 'light',
  fitMode: 'width',
  fontFamily: 'system',
  fontSizePt: 16,
  lineHeight: 1.5,
  contentWidthPt: 640,
  invertPages: false,
  pageGap: 0,
};

let cachedSettings: ReadingSettings | null = null;
let settingsLoaded = false;
const loadListeners: ((settings: ReadingSettings) => void)[] = [];

async function loadSettingsAsync(): Promise<ReadingSettings> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { AsyncStorage } = require('@react-native-async-storage/async-storage');
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Validate against defaults
      cachedSettings = { ...DEFAULT_READING_SETTINGS, ...parsed };
      settingsLoaded = true;
      loadListeners.forEach((cb) => cb(cachedSettings!));
      loadListeners.length = 0;
      return cachedSettings!;
    }
  } catch {
    // Ignore storage errors
  }
  cachedSettings = DEFAULT_READING_SETTINGS;
  settingsLoaded = true;
  loadListeners.forEach((cb) => cb(cachedSettings!));
  loadListeners.length = 0;
  return DEFAULT_READING_SETTINGS;
}

function subscribeToLoad(cb: (settings: ReadingSettings) => void) {
  if (settingsLoaded && cachedSettings) {
    cb(cachedSettings);
  } else {
    loadListeners.push(cb);
  }
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

  const [settings, setSettings] = useState<ReadingSettings>(DEFAULT_READING_SETTINGS);
  const [isLoading, setIsLoading] = useState(true);
  const mountedRef = useRef(true);
  const initializedRef = useRef(false);

  // Load from storage on mount
  useEffect(() => {
    mountedRef.current = true;

    // If already loaded, set state immediately in the effect (this is fine because
    // we're transitioning from the initial default state to the loaded state)
    if (settingsLoaded && cachedSettings && !initializedRef.current) {
      initializedRef.current = true;
      setSettings(cachedSettings);
      setIsLoading(false);
      return () => {
        mountedRef.current = false;
      };
    }

    // Otherwise subscribe to the async load
    subscribeToLoad((loaded) => {
      if (mountedRef.current) {
        setSettings(loaded);
        setIsLoading(false);
      }
    });

    // Kick off async load if not already started
    if (!settingsLoaded) {
      void loadSettingsAsync();
    }

    return () => {
      mountedRef.current = false;
    };
  }, []);

  const updateSettings = useCallback(
    async (patch: Partial<ReadingSettings>) => {
      const newSettings: ReadingSettings = { ...settings, ...patch };
      setSettings(newSettings);

      // Validate against capabilities
      const validated = validateAgainstCapabilities(newSettings, engine.capabilities);
      if (validated !== newSettings) {
        setSettings(validated);
      }

      // Persist
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { AsyncStorage } = require('@react-native-async-storage/async-storage');
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(validated));
        cachedSettings = validated;
      } catch {
        // Persistence is best-effort
      }
    },
    [settings, engine.capabilities],
  );

  const resetSettings = useCallback(async () => {
    setSettings(DEFAULT_READING_SETTINGS);
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { AsyncStorage } = require('@react-native-async-storage/async-storage');
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_READING_SETTINGS));
      cachedSettings = DEFAULT_READING_SETTINGS;
    } catch {
      // Ignore
    }
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

  // Layout mode: both 'pdf' and 'reflow' are now supported
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

// Re-export for validation function
const READING_MODES = ['pdf', 'reflow'] as const;

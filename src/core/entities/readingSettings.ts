/**
 * Reader settings value object — ARCHITECTURE.md §4.
 * Persisted as a single row (id = 'default') via settingsService (Phase 8).
 */
export const READING_MODES = ['pdf', 'reflow'] as const;
export const READING_THEMES = ['light', 'sepia', 'dark'] as const;

export type ReadingMode = (typeof READING_MODES)[number];
export type ReadingTheme = (typeof READING_THEMES)[number];

export interface ReadingSettings {
  mode: ReadingMode;
  theme: ReadingTheme;
  fontFamily: string;
  fontSizePt: number;
  lineHeight: number;
  invertPages: boolean;
}

export const DEFAULT_READING_SETTINGS: ReadingSettings = {
  mode: 'pdf',
  theme: 'light',
  fontFamily: 'system',
  fontSizePt: 16,
  lineHeight: 1.5,
  invertPages: false,
};

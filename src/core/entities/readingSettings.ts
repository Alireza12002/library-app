/**
 * Reader settings value object — ARCHITECTURE.md §4.
 * Persisted as a single row (id = 'default') via settingsService (Phase 8).
 */
export const READING_MODES = ['pdf', 'reflow'] as const;
export const READING_THEMES = ['light', 'sepia', 'dark'] as const;
export const FIT_MODES = ['width', 'height', 'both'] as const;

export type ReadingMode = (typeof READING_MODES)[number];
export type ReadingTheme = (typeof READING_THEMES)[number];
export type FitMode = (typeof FIT_MODES)[number];

export interface ReadingSettings {
  mode: ReadingMode;
  theme: ReadingTheme;
  fitMode: FitMode;
  fontFamily: string;
  fontSizePt: number;
  lineHeight: number;
  contentWidthPt: number;
  invertPages: boolean;
  pageGap: number;
}

export const DEFAULT_READING_SETTINGS: ReadingSettings = {
  mode: 'pdf',
  theme: 'light',
  fitMode: 'width',
  fontFamily: 'system',
  fontSizePt: 16,
  lineHeight: 1.5,
  contentWidthPt: 640, // ~640dp default content width
  invertPages: false,
  pageGap: 0,
};

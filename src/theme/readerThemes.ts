/**
 * Reader surface themes — ARCHITECTURE.md §2 (src/theme).
 *
 * A different axis from the APP theme in tokens.ts: these style the reading
 * surface itself (light/sepia/dark paper), selected by the user per
 * ReadingSettings.theme, and are applied by the reflow reader in Phase 8.
 * The token names are the stable contract.
 */
import type { ReadingTheme } from '@/core/entities/readingSettings';

export interface ReaderThemeTokens {
  background: string;
  surface: string;
  text: string;
  textMuted: string;
  accent: string;
}

export const READER_THEMES: Record<ReadingTheme, ReaderThemeTokens> = {
  light: {
    background: '#FDFBF9',
    surface: '#F9F5F0',
    text: '#29211F',
    textMuted: '#786E6C',
    accent: '#AC5F48',
  },
  sepia: {
    background: '#F4ECD8',
    surface: '#E8DCC0',
    text: '#433422',
    textMuted: '#8A7556',
    accent: '#B45309',
  },
  dark: {
    background: '#1A1614',
    surface: '#241F1C',
    text: '#F2EBE6',
    textMuted: '#A79C97',
    accent: '#D3826A',
  },
};

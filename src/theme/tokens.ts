/**
 * Theme tokens — ARCHITECTURE.md §2 (src/theme).
 * Phase 8 extends this with full light/sepia/dark palettes for the reflow
 * reader; the token names are the stable contract.
 */
import type { ReadingTheme } from '@/core/entities/readingSettings';

export interface ThemeTokens {
  background: string;
  surface: string;
  text: string;
  textMuted: string;
  accent: string;
}

export const READER_THEMES: Record<ReadingTheme, ThemeTokens> = {
  light: {
    background: '#ffffff',
    surface: '#eef1f6',
    text: '#111827',
    textMuted: '#6b7280',
    accent: '#2563eb',
  },
  sepia: {
    background: '#f4ecd8',
    surface: '#e8dcc0',
    text: '#433422',
    textMuted: '#8a7556',
    accent: '#b45309',
  },
  dark: {
    background: '#101418',
    surface: '#1c2229',
    text: '#e5e7eb',
    textMuted: '#9ca3af',
    accent: '#60a5fa',
  },
};

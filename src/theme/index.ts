/**
 * Design tokens for the whole app (ARCHITECTURE.md §2, src/theme).
 * Phase 8 will extend this with full light/dark/sepia reading themes —
 * keep every color referenced from here, never hardcoded in screens.
 */
export const theme = {
  colors: {
    background: '#f6f6f6',
    card: '#ffffff',
    text: '#111111',
    textMuted: '#666666',
    accent: '#0a7ea4',
    border: '#dddddd',
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
  },
  typography: {
    title: { fontSize: 28, fontWeight: '700' },
    heading: { fontSize: 20, fontWeight: '600' },
    label: { fontSize: 16, fontWeight: '500' },
    body: { fontSize: 15, fontWeight: '400' },
    caption: { fontSize: 13, fontWeight: '400' },
  },
} as const;

export type Theme = typeof theme;

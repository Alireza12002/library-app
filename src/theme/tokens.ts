/**
 * Design tokens — the single source of truth for every visual value
 * (ARCHITECTURE.md §2, src/theme).
 *
 * Light palette values are MEASURED from the reference UI screenshot
 * (pixel-sampled, not estimated). The dark palette is DERIVED from the same
 * ivory/terracotta language — it has no screenshot reference yet and is
 * pending design review, so treat those values as provisional.
 *
 * Rules:
 * - Screens and components read from here; never hardcode a color or a number.
 * - Anything semantic (surface, textMuted, accentWash) belongs in `colors`;
 *   raw scales (spacing, radius, typography) are theme-independent.
 */

/** Theme-independent scales ------------------------------------------------ */

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  /** Screen side gutter — measured 33px @1.47 ≈ 22pt. */
  gutter: 22,
  xl: 24,
  xxl: 32,
  xxxl: 40,
} as const;

export const radius = {
  sm: 8,
  /** Active tab indicator wash. */
  md: 12,
  /** Cards — measured 20px @1.47 ≈ 14pt. */
  card: 14,
  lg: 20,
  /** Pills: search field, buttons. Radius = height / 2. */
  full: 999,
} as const;

/**
 * System font stacks. The reference UI pairs a display serif with a geometric
 * sans; no font files are bundled yet, so these resolve to the platform
 * defaults. Swapping in real families later is a change to these two values
 * only — every text style already points at them.
 */
export const fontFamily = {
  /** Screen titles, card titles, empty-state headings. */
  display: undefined as string | undefined,
  /** Body copy, labels, metadata, tab labels. */
  ui: undefined as string | undefined,
} as const;

export const fontWeight = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const;

/**
 * Type scale. Sizes are derived from the reference screenshot at its measured
 * 1.4718 scale factor. `display` variants use the serif; the rest use the UI sans.
 */
export const typography = {
  /** Large in-page screen title ("My Library") — measured ~57px ≈ 38pt. */
  displayLarge: {
    fontFamily: fontFamily.display,
    fontSize: 34,
    lineHeight: 40,
    fontWeight: fontWeight.bold,
    letterSpacing: -0.5,
  },
  /** Section/empty-state heading. */
  displayMedium: {
    fontFamily: fontFamily.display,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: fontWeight.bold,
    letterSpacing: -0.2,
  },
  /** Card titles. */
  displaySmall: {
    fontFamily: fontFamily.display,
    fontSize: 18,
    lineHeight: 22,
    fontWeight: fontWeight.bold,
  },
  /** Settings section titles, button labels. */
  label: {
    fontFamily: fontFamily.ui,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: fontWeight.medium,
  },
  /** Default body copy, list rows, search placeholder. */
  body: {
    fontFamily: fontFamily.ui,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: fontWeight.regular,
  },
  /** Subtitle under a screen title, secondary metadata. */
  caption: {
    fontFamily: fontFamily.ui,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: fontWeight.regular,
  },
  /** Tab labels. */
  tiny: {
    fontFamily: fontFamily.ui,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: fontWeight.medium,
  },
} as const;

/** Palettes ---------------------------------------------------------------- */

export interface Palette {
  /** Screen canvas. */
  background: string;
  /** Raised surfaces: cards, tab bar, inputs. */
  surface: string;
  /** Input fills — a touch off `surface`. */
  surfaceMuted: string;
  /** Hairlines and input borders. */
  border: string;
  /** Primary copy. */
  text: string;
  /** Secondary copy. */
  textMuted: string;
  /** Placeholder / disabled copy. */
  textSubtle: string;
  /** Brand terracotta: active states, primary actions. */
  accent: string;
  /** Copy/icons placed on `accent`. */
  accentOn: string;
  /** Tinted accent fill: active tab indicator, icon chips. */
  accentWash: string;
  /** Destructive actions. */
  danger: string;
}

/** Measured from the reference screenshot. */
export const lightPalette: Palette = {
  background: '#FDFBF9',
  surface: '#FAF6F1',
  surfaceMuted: '#F9F5F0',
  border: '#EEEAE3',
  text: '#29211F',
  textMuted: '#786E6C',
  textSubtle: '#8A8987',
  accent: '#AC5F48',
  accentOn: '#FFFFFF',
  accentWash: '#F3EBE7',
  danger: '#B3402F',
};

/**
 * Derived, not measured — no dark reference exists in the screenshot.
 * Keeps the warm (red-biased) neutral ramp and lifts the accent so it stays
 * legible on a dark canvas. Pending design review.
 */
export const darkPalette: Palette = {
  background: '#1A1614',
  surface: '#241F1C',
  surfaceMuted: '#2B2523',
  border: '#3A322F',
  text: '#F2EBE6',
  textMuted: '#A79C97',
  textSubtle: '#8A7E79',
  accent: '#D3826A',
  accentOn: '#1A1614',
  accentWash: '#3A2A24',
  danger: '#E0705C',
};

/** Fixed, theme-independent values. */
export const opacity = {
  pressed: 0.6,
  disabled: 0.4,
} as const;

export const hairline = 1;

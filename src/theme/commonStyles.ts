/**
 * Common component styles — the recurring shapes, expressed once.
 *
 * These are the "how a card looks", "how a pill looks" rules that would
 * otherwise be copy-pasted into every screen. Each is a function of the active
 * palette so it works in both schemes. Keep this small: it holds shared shapes,
 * not a component library.
 */
import { StyleSheet, type TextStyle, type ViewStyle } from 'react-native';

import { hairline, radius, spacing, type Palette } from './tokens';

/** Minimum tappable edge (both platforms' accessibility guidance). */
export const MIN_TOUCH_TARGET = 44;

/** Control heights, keyed to the reference UI (search field measured ~34pt). */
export const controlHeight = {
  sm: 34,
  md: 44,
  lg: 52,
} as const;

export function createCommonStyles(colors: Palette) {
  return StyleSheet.create({
    /** Screen canvas. */
    screen: {
      flex: 1,
      backgroundColor: colors.background,
    },
    /** Standard horizontal page rail — the same gutter for every screen. */
    gutter: {
      paddingHorizontal: spacing.gutter,
    },
    /** Raised container: cards, grouped rows. Flat by design — no shadow. */
    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.card,
      borderWidth: hairline,
      borderColor: colors.border,
      overflow: 'hidden',
    },
    /** Pill input/field: fill + hairline, no shadow. */
    field: {
      backgroundColor: colors.surfaceMuted,
      borderRadius: radius.full,
      borderWidth: hairline,
      borderColor: colors.border,
      paddingHorizontal: spacing.lg,
      minHeight: controlHeight.sm,
      justifyContent: 'center',
    },
    /** 1px hairline rule — the only divider in the reference design. */
    divider: {
      backgroundColor: colors.border,
      height: hairline,
    },
    /** Tinted accent chip, e.g. behind an active tab icon. */
    accentWash: {
      backgroundColor: colors.accentWash,
      borderRadius: radius.md,
    },
    /** Centered content block, used by empty/placeholder states. */
    centered: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: spacing.gutter,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
    },
  });
}

export type CommonStyles = ReturnType<typeof createCommonStyles>;

/** Ambient elevation. The reference design is flat; this is the only lift. */
export function subtleShadow(): ViewStyle {
  return {
    shadowColor: '#000000',
    shadowOpacity: 0.06,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  };
}

/** Text colour roles, so components don't re-derive them. */
export function textColorFor(
  colors: Palette,
  tone: 'default' | 'muted' | 'subtle' | 'accent' | 'danger' | 'onAccent',
): TextStyle['color'] {
  switch (tone) {
    case 'muted':
      return colors.textMuted;
    case 'subtle':
      return colors.textSubtle;
    case 'accent':
      return colors.accent;
    case 'danger':
      return colors.danger;
    case 'onAccent':
      return colors.accentOn;
    default:
      return colors.text;
  }
}

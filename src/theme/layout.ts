/**
 * Responsive layout primitives (ARCHITECTURE.md §2, src/theme).
 *
 * One place that answers "how wide is a grid cell on THIS device", so screens
 * never hardcode a width or guess a column count. Everything is derived from the
 * live window size via useWindowDimensions(), so it re-resolves on rotation,
 * split-screen, and font-scale changes instead of being measured once at import
 * time (which is what Dimensions.get() would do).
 */
import { useMemo } from 'react';
import { useWindowDimensions } from 'react-native';

import { spacing } from './tokens';

/** Width below which a phone is "small" (iPhone SE class, ~320–360dp). */
export const COMPACT_WIDTH = 360;
/** Width at which a second content column starts to make sense (large phone). */
export const WIDE_WIDTH = 600;

export interface GridMetrics {
  /** Number of columns to render. */
  columns: number;
  /** Exact width, in points, of one cell. */
  itemWidth: number;
  /** Gap between columns and rows, in points. */
  gap: number;
  /** Horizontal padding applied to the list's content container. */
  horizontalPadding: number;
  /** True on narrow devices — callers can drop optional chrome. */
  isCompact: boolean;
}

export interface GridOptions {
  /** Preferred column count on a normal phone. Defaults to 2. */
  columns?: number;
  /** Gap between cells. Defaults to spacing.md (12). */
  gap?: number;
  /** Content-container horizontal padding. Defaults to spacing.gutter (22). */
  horizontalPadding?: number;
  /** Allow an extra column once the window is at least WIDE_WIDTH. */
  expandOnWide?: boolean;
}

/**
 * Computes cell width for an N-column grid from the live window width.
 *
 * The arithmetic is the whole point: a cell styled `width: '50%'` inside a
 * padded, gapped row overflows by (gap + padding), which is what produces
 * clipped and oversized cards. Deriving an exact point width from the measured
 * window makes the layout correct at every size without per-screen fudging.
 */
export function useGridMetrics(options: GridOptions = {}): GridMetrics {
  const { width } = useWindowDimensions();

  const {
    columns: preferredColumns = 2,
    gap = spacing.md,
    horizontalPadding = spacing.gutter,
    expandOnWide = true,
  } = options;

  return useMemo(() => {
    const isCompact = width < COMPACT_WIDTH;
    const columns =
      expandOnWide && width >= WIDE_WIDTH ? preferredColumns + 1 : preferredColumns;

    const available = width - horizontalPadding * 2 - gap * (columns - 1);
    // Floor so rounding never pushes the last column past the right edge.
    const itemWidth = Math.floor(Math.max(0, available) / columns);

    return { columns, itemWidth, gap, horizontalPadding, isCompact };
  }, [width, preferredColumns, gap, horizontalPadding, expandOnWide]);
}

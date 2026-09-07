/**
 * Reading-layout geometry for Reflow mode (ARCHITECTURE.md §3, L5).
 *
 * Pure functions, kept out of the component so they can be unit-tested: Node's
 * type-stripping test runner cannot load `.tsx`, and this is the rule that decides
 * whether reflow is genuinely responsive or just a re-styled page.
 */

/**
 * Side margin as a fraction of window width.
 *
 * A ratio rather than fixed points, so the measure stays comfortable from a 320dp
 * phone to a tablet without per-device values.
 */
export const SIDE_MARGIN_RATIO = 0.06;

/**
 * Width of the reading column, in points.
 *
 * Derived from the LIVE window width — never from the PDF's page box — which is
 * what makes text re-wrap on rotation and split-screen. `contentWidthCap` (the
 * user's max-measure setting) may only NARROW the column: allowing it to widen
 * past the window is exactly what would reintroduce horizontal scrolling.
 *
 * @param windowWidth     Current window width in points.
 * @param contentWidthCap Preferred maximum measure; 0 or less means "no cap".
 */
export function readingColumnWidth(windowWidth: number, contentWidthCap: number): number {
  const available = windowWidth * (1 - SIDE_MARGIN_RATIO * 2);
  const cap = contentWidthCap > 0 ? contentWidthCap : available;
  return Math.max(0, Math.floor(Math.min(available, cap)));
}

/**
 * Scales a figure to the reading column: fill the width, preserve the aspect
 * ratio, and never upscale past the intrinsic size (which would only blur it).
 */
export function scaleImageToColumn(
  intrinsic: { width: number; height: number },
  columnWidth: number,
): { width: number; height: number } {
  if (intrinsic.width <= 0 || intrinsic.height <= 0) {
    return { width: 0, height: 0 };
  }
  const width = Math.min(columnWidth, intrinsic.width);
  return { width, height: intrinsic.height * (width / intrinsic.width) };
}

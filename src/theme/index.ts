/**
 * Design system entry point (ARCHITECTURE.md §2, src/theme).
 *
 * Screens and components import from '@/theme' and '@/components/ui' only —
 * never from the individual token files.
 */
export {
  ThemeProvider,
  useTheme,
  lightTheme,
  darkTheme,
  type Theme,
  type ColorSchemeName,
} from './ThemeProvider';

export {
  spacing,
  radius,
  typography,
  fontFamily,
  fontWeight,
  opacity,
  hairline,
  lightPalette,
  darkPalette,
  type Palette,
} from './tokens';

export {
  createCommonStyles,
  subtleShadow,
  textColorFor,
  controlHeight,
  MIN_TOUCH_TARGET,
  type CommonStyles,
} from './commonStyles';

export {
  useGridMetrics,
  COMPACT_WIDTH,
  WIDE_WIDTH,
  type GridMetrics,
  type GridOptions,
} from './layout';

export { READER_THEMES, type ReaderThemeTokens } from './readerThemes';

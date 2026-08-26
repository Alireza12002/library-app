/**
 * Theme context — resolves the active palette and exposes it to components.
 *
 * The palette follows the OS light/dark setting by default. Components read it
 * through `useTheme()` and build styles from the returned tokens; nothing below
 * this file should reach for `lightPalette`/`darkPalette` directly.
 */
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';

import {
  darkPalette,
  hairline,
  lightPalette,
  opacity,
  radius,
  spacing,
  typography,
  type Palette,
} from './tokens';

export type ColorSchemeName = 'light' | 'dark';

export interface Theme {
  scheme: ColorSchemeName;
  colors: Palette;
  spacing: typeof spacing;
  radius: typeof radius;
  typography: typeof typography;
  opacity: typeof opacity;
  hairline: number;
}

function buildTheme(scheme: ColorSchemeName): Theme {
  return {
    scheme,
    colors: scheme === 'dark' ? darkPalette : lightPalette,
    spacing,
    radius,
    typography,
    opacity,
    hairline,
  };
}

export const lightTheme = buildTheme('light');
export const darkTheme = buildTheme('dark');

const ThemeContext = createContext<Theme>(lightTheme);

interface ThemeProviderProps {
  children: ReactNode;
  /** Pin the scheme instead of following the OS (useful for tests). */
  scheme?: ColorSchemeName;
}

export function ThemeProvider({ children, scheme }: ThemeProviderProps) {
  const systemScheme = useColorScheme();
  const resolved: ColorSchemeName = scheme ?? (systemScheme === 'dark' ? 'dark' : 'light');
  const value = useMemo(() => buildTheme(resolved), [resolved]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** The active theme. Every component styles itself from this. */
export function useTheme(): Theme {
  return useContext(ThemeContext);
}

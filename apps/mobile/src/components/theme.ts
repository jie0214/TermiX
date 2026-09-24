import { createContext, useContext, useMemo } from 'react';
export const lightColors = {
  background: '#f2f2f7', panel: '#ffffff', text: '#1c1c1e', muted: '#636366',
  line: '#d1d1d6', accent: '#0062cc', soft: '#e8f0fc', danger: '#a52a32',
  button: '#0062cc', onButton: '#ffffff', terminal: '#ffffff', terminalText: '#1c1c1e',
};
export type ThemeColors = typeof lightColors;
export const darkColors: ThemeColors = {
  background: '#000000', panel: '#1c1c1e', text: '#f2f2f7', muted: '#aeaeb2',
  line: '#48484a', accent: '#70aaff', soft: '#182d49', danger: '#ff9da5',
  button: '#0062cc', onButton: '#ffffff', terminal: '#101012', terminalText: '#f2f2f7',
};
export const ThemeContext = createContext({ colors: lightColors, dark: false });
export function useTheme() { return useContext(ThemeContext); }
export function useThemedStyles<T>(factory: (colors: ThemeColors) => T): T {
  const { colors } = useTheme();
  return useMemo(() => factory(colors), [factory, colors]);
}

import { createContext, useContext, useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { ActivityIndicator, Appearance, useColorScheme, View } from 'react-native';
import { ThemeContext, lightColors, darkColors } from '../../components/theme';
import type { AppearanceStore, AppearanceMode } from './store';
const Context = createContext({ mode: 'system' as AppearanceMode, saving: false, error: '',
  change: async (_mode: AppearanceMode): Promise<boolean> => false });
export function AppearanceProvider({ store, children }: { store: AppearanceStore; children: ReactNode }) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const scheme = useColorScheme();
  useEffect(() => { void store.initialize(); }, [store]);
  useEffect(() => {
    if (state.loaded) Appearance.setColorScheme(state.mode === 'system' ? 'unspecified' : state.mode);
  }, [state.loaded, state.mode]);
  const dark = state.mode === 'dark' || (state.mode === 'system' && scheme === 'dark');
  const colors = dark ? darkColors : lightColors;
  return <ThemeContext.Provider value={{ colors, dark }}>
    {state.loaded ? <Context.Provider value={{ mode: state.mode, saving: state.saving, error: state.error, change: mode => store.change(mode) }}>{children}</Context.Provider>
      : <View style={{ flex: 1, backgroundColor: colors.background, justifyContent: 'center' }}><ActivityIndicator color={colors.accent} /></View>}
  </ThemeContext.Provider>;
}
export function useAppearance() { return useContext(Context); }

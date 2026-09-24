import { useTheme } from '../../components/theme';
import { createContext, useCallback, useContext, useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { translate, type TranslationValues } from './translate';
import type { LanguageStore, Locale } from './store';
const Context = createContext({ locale: 'zh-Hant' as Locale, saving: false, error: '',
  t: (source: string, values?: TranslationValues) => translate('zh-Hant', source, values),
  change: async (_locale: Locale): Promise<boolean> => false,
});
export function LanguageProvider({ store, children }: { store: LanguageStore; children: ReactNode }) {
  const { colors } = useTheme();
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  useEffect(() => { void store.initialize(); }, [store]);
  const t = useCallback((source: string, values?: TranslationValues) => translate(state.locale, source, values), [state.locale]);
  if (!state.loaded) return <View style={{ flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={colors.accent} /></View>;
  return <Context.Provider value={{ locale: state.locale, saving: state.saving, error: state.error, t, change: locale => store.change(locale) }}>{children}</Context.Provider>;
}
export function useLanguage() { return useContext(Context); }

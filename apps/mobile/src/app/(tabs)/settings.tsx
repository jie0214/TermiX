import { useAppearance } from '../../features/appearance/AppearanceProvider';
import { appearanceNames } from '../../features/appearance/store';
import { router } from 'expo-router';
import { SettingsGroup, SettingsRow } from '../../components/SettingsList';
import { StyleSheet, Text, ScrollView } from 'react-native';
import { useThemedStyles, type ThemeColors } from '../../components/theme';
import { useLanguage } from '../../features/language/LanguageProvider';
import { languageNames } from '../../features/language/store';
export default function Settings() {
  const styles = useThemedStyles(createStyles);
  const { t, locale, error } = useLanguage();
  const appearance = useAppearance();
  return <ScrollView style={styles.page} contentContainerStyle={styles.content}>
    <SettingsGroup>
      <SettingsRow icon="terminal" label={t('SSH 常用指令')} onPress={() => router.push('/settings/commands')} />
      <SettingsRow icon="cloud" label={t('雲端帳號')} onPress={() => router.push('/settings/cloud-accounts')} />
      <SettingsRow icon="box" label="Kubernetes" onPress={() => router.push('/settings/kubernetes')} />
      <SettingsRow last icon="refresh-cw" label={t('同步設定')} onPress={() => router.push('/settings/sync')} />
    </SettingsGroup>
    <SettingsGroup>
      <SettingsRow icon="globe" label={t('語言')} value={languageNames[locale]} onPress={() => router.push('/settings/language')} />
      <SettingsRow last icon="sun" label={t('外觀')} value={t(appearanceNames[appearance.mode])} onPress={() => router.push('/settings/appearance')} />
    </SettingsGroup>
    {!!appearance.error && <Text accessibilityRole="alert" style={styles.error}>{t(appearance.error)}</Text>}
    {!!error && <Text accessibilityRole="alert" style={styles.error}>{t(error)}</Text>}
  </ScrollView>;
}
const createStyles = (colors: ThemeColors) => StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20, gap: 28, paddingBottom: 40 },
  error: { color: colors.danger, fontSize: 14 },
});

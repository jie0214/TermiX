import { ScrollView, StyleSheet, Text } from 'react-native';
import { NavigationHeader } from '../../components/NavigationHeader';
import { SettingsGroup, SettingsRow } from '../../components/SettingsList';
import { useThemedStyles, type ThemeColors } from '../../components/theme';
import { useLanguage } from './LanguageProvider';
import { locales, languageNames } from './store';
export function LanguageSettings({ onBack }: { onBack(): void }) {
  const styles = useThemedStyles(createStyles);
  const { locale, change, saving, error, t } = useLanguage();
  return <ScrollView style={styles.page} contentContainerStyle={styles.content}>
    <NavigationHeader title={t('語言')} backLabel={t('返回設定')} onBack={onBack} />
    <SettingsGroup>{locales.map((value, index) => <SettingsRow key={value} label={languageNames[value]}
      checked={locale === value} disabled={saving} last={index === locales.length - 1} onPress={() => void change(value)} />)}</SettingsGroup>
    <Text style={styles.note}>{t(saving ? '儲存中…' : '切換後立即套用，重新開啟仍會保留。')}</Text>
    {!!error && <Text accessibilityRole="alert" style={styles.error}>{t(error)}</Text>}
  </ScrollView>;
}
const createStyles = (colors: ThemeColors) => StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background }, content: { padding: 20, paddingBottom: 40, gap: 14 },
  note: { color: colors.muted, fontSize: 14, lineHeight: 21 }, error: { color: colors.danger, fontSize: 14 },
});

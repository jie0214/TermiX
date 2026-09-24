import { ScrollView, StyleSheet, Text } from 'react-native';
import { NavigationHeader } from '../../components/NavigationHeader';
import { SettingsGroup, SettingsRow } from '../../components/SettingsList';
import { useThemedStyles, type ThemeColors } from '../../components/theme';
import { useLanguage } from '../language/LanguageProvider';
import { useAppearance } from './AppearanceProvider';
import { modes, appearanceNames } from './store';
export function AppearanceSettings({ onBack }: { onBack(): void }) {
  const styles = useThemedStyles(createStyles);
  const { t } = useLanguage();
  const { mode, change, saving, error } = useAppearance();
  return <ScrollView style={styles.page} contentContainerStyle={styles.content}>
    <NavigationHeader title={t('外觀')} backLabel={t('返回設定')} onBack={onBack} />
    <SettingsGroup>{modes.map((value, index) => <SettingsRow key={value} label={t(appearanceNames[value])}
      checked={mode === value} disabled={saving} last={index === modes.length - 1} onPress={() => void change(value)} />)}</SettingsGroup>
    <Text style={styles.note}>{t(saving ? '儲存中…' : '切換後立即套用，重新開啟仍會保留。')}</Text>
    {!!error && <Text accessibilityRole="alert" style={styles.error}>{t(error)}</Text>}
  </ScrollView>;
}
const createStyles = (colors: ThemeColors) => StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background }, content: { padding: 20, paddingBottom: 40, gap: 14 },
  note: { color: colors.muted, fontSize: 14, lineHeight: 21 }, error: { color: colors.danger, fontSize: 14 },
});

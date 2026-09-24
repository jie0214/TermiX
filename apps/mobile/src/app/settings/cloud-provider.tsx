import { router } from 'expo-router';
import { ScrollView } from 'react-native';
import { NavigationHeader } from '../../components/NavigationHeader';
import { SettingsGroup, SettingsRow } from '../../components/SettingsList';
import { useTheme } from '../../components/theme';
import { useLanguage } from '../../features/language/LanguageProvider';

export default function CloudProvider() {
  const { colors } = useTheme();
  const { t } = useLanguage();
  return <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: 20, gap: 20, paddingBottom: 40 }}>
    <NavigationHeader title={t('選擇雲端供應商')} backLabel={t('返回')} onBack={() => router.back()} />
    <SettingsGroup>
      <SettingsRow icon="cloud" label="AWS" last onPress={() => router.push('/settings/aws')} />
    </SettingsGroup>
  </ScrollView>;
}

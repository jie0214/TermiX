import { useLanguage } from '../../features/language/LanguageProvider';
import { router } from 'expo-router';
import { KeyboardAvoidingView, Platform, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NavigationHeader } from '../../components/NavigationHeader';
import { useTheme } from '../../components/theme';
import { CommandSettings } from '../../features/commands/CommandSettings';

export default function Commands() {
  const { colors } = useTheme();
  const { t } = useLanguage();
  const insets = useSafeAreaInsets();
  return <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.background, paddingBottom: insets.bottom }}
    behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={insets.top}>
    <View style={{ paddingHorizontal: 20, paddingTop: 12 }}><NavigationHeader title={t("SSH 常用指令")} backLabel={t("返回設定")} onBack={() => router.back()} /></View>
    <CommandSettings />
  </KeyboardAvoidingView>;
}

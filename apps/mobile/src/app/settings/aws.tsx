import { router } from 'expo-router';
import { KeyboardAvoidingView, Platform, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NavigationHeader } from '../../components/NavigationHeader';
import { useTheme } from '../../components/theme';
import { useLanguage } from '../../features/language/LanguageProvider';
import { useKubernetes } from '../../features/kubernetes/KubernetesProvider';
import { AwsSettings } from '../../features/aws/AwsSettings';
import { awsRepository } from '../../storage/aws';
export default function AWS() {
  const { colors } = useTheme(); const { t } = useLanguage(); const insets = useSafeAreaInsets();
  const { state } = useKubernetes(); const eks = state.profile?.eks;
  return <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.background, paddingBottom: insets.bottom }}
    behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={insets.top}>
    <View style={{ paddingHorizontal: 20, paddingTop: 12 }}><NavigationHeader title={t('AWS profiles')} backLabel={t('返回')} onBack={() => router.back()} /></View>
    <AwsSettings repository={awsRepository} suggested={eks ? { name: eks.profile, region: eks.region } : undefined} />
  </KeyboardAvoidingView>;
}

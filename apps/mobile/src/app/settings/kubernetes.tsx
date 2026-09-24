import { router } from 'expo-router';
import { ScrollView, Text } from 'react-native';
import { NavigationHeader } from '../../components/NavigationHeader';
import { SettingsGroup, SettingsRow } from '../../components/SettingsList';
import { useTheme } from '../../components/theme';
import { useLanguage } from '../../features/language/LanguageProvider';
import { ClusterPicker } from '../../features/kubernetes/ClusterPicker';
import { ConnectionSelectors } from '../../features/kubernetes/ConnectionSelectors';
import { KubeImportButton } from '../../features/kubernetes/KubeImportButton';
import { useKubernetes } from '../../features/kubernetes/KubernetesProvider';
export default function KubernetesSettings() {
 const {colors}=useTheme();const {t}=useLanguage();const {state}=useKubernetes();
 return <ScrollView style={{flex:1,backgroundColor:colors.background}} contentContainerStyle={{padding:20,gap:20,paddingBottom:40}}>
  <NavigationHeader title="Kubernetes" backLabel={t('返回')} onBack={()=>router.back()}/>
  {!!state.profile && <>
   <Text style={{color:colors.muted,fontSize:13}}>{t('連線設定')}</Text>
   <SettingsGroup><ClusterPicker presentation="row"/><ConnectionSelectors mode="aws" key={JSON.stringify([state.profile.context,state.profile.eks?.profile])}/></SettingsGroup>
   {!!state.profile.eks && <Text style={{color:colors.muted,fontSize:13}}>{t('雲端帳號依叢集設定保存')}</Text>}
  </>}
  <Text style={{color:colors.muted,fontSize:13}}>{t('設定檔')}</Text>
  <SettingsGroup><KubeImportButton presentation="row" compact/><SettingsRow icon="cloud" label={t('管理雲端帳號')} last onPress={()=>router.push('/settings/cloud-accounts')}/></SettingsGroup>
 </ScrollView>;
}

import { router } from 'expo-router';
import { ScrollView, Text } from 'react-native';
import { Button } from '../../components/Button';
import { NavigationHeader } from '../../components/NavigationHeader';
import { SettingsGroup, SettingsRow } from '../../components/SettingsList';
import { useTheme } from '../../components/theme';
import { useLanguage } from '../../features/language/LanguageProvider';
export default function CloudAccounts() {
 const {colors}=useTheme();const {t}=useLanguage();
 return <ScrollView style={{flex:1,backgroundColor:colors.background}} contentContainerStyle={{padding:20,gap:20,paddingBottom:40}}>
  <NavigationHeader title={t('雲端帳號')} backLabel={t('返回')} onBack={()=>router.back()}/>
  <Button label={t('新增雲端帳號')} onPress={()=>router.push('/settings/cloud-provider')}/>
  <SettingsGroup><SettingsRow icon="cloud" label="AWS" value={t('帳號與憑證')} last onPress={()=>router.push('/settings/aws')}/></SettingsGroup>
  <Text style={{color:colors.muted,fontSize:13}}>{t('管理雲端登入憑證；叢集連線請至 Kubernetes 設定。')}</Text>
 </ScrollView>;
}

import { useEffect, useRef, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { SettingsRow } from '../../components/SettingsList';
import { Button } from '../../components/Button';
import { useTheme, useThemedStyles, type ThemeColors } from '../../components/theme';
import { useLanguage } from '../language/LanguageProvider';
import type { AwsProfile } from '../aws/repository';
import { useKubernetes } from './KubernetesProvider';
import { kubeMessage } from './workspace';

export function ConnectionSelectors({ mode = 'namespace' }: { mode?: 'namespace' | 'aws' }) {
  const { workspace, state } = useKubernetes();
  const { colors } = useTheme(); const styles = useThemedStyles(createStyles); const { t } = useLanguage(); const insets = useSafeAreaInsets();
  const [sheet,setSheet] = useState<'aws'|'namespace'|null>(null); const [query,setQuery] = useState('');
  const [profiles,setProfiles] = useState<AwsProfile[]>([]); const [awsStatus,setAwsStatus] = useState(''); const [awsBusy,setAwsBusy] = useState(false);
  const request = useRef(0);
  useEffect(() => {
    const pending = request; ++pending.current;
    return () => { ++pending.current; };
  }, [workspace,state.profile,state.configBusy,mode]);
  const openAWS = async () => {
    const id = ++request.current;setQuery('');setSheet('aws');setAwsBusy(true);setAwsStatus('');setProfiles([]);
    try { const items = await workspace.listAWSProfiles(); if (id===request.current) setProfiles(items); }
    catch(error) { if(id===request.current) setAwsStatus(kubeMessage(error)); }
    finally { if(id===request.current) setAwsBusy(false); }
  };
  const disabled = !!state.configBusy || state.scale?.status === 'submitting';
  const options = sheet === 'aws' ? profiles.map(p=>({key:p.key,label:p.name,note:p.enabled?p.account:t('已停用'),disabled:!p.enabled,selected:p.name===state.profile?.eks?.profile}))
    : [...new Set([state.namespace,...(state.namespaces?.items ?? [])])].filter(Boolean).map(name=>({key:name,label:name,note:'',disabled:false,selected:name===state.namespace}));
  const filtered = options.filter(item=>item.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const close = () => { ++request.current;setSheet(null); };
  return <>
    {mode === 'aws' && state.profile?.eks && <SettingsRow label={t('雲端帳號')} value={state.profile.eks.profile} last disabled={disabled} onPress={()=>void openAWS()}/>}
    {mode === 'namespace' && <>
    <Pressable accessibilityRole="button" accessibilityLabel="namespace" accessibilityValue={{text:state.namespace}} disabled={disabled} style={styles.selector} onPress={()=>{setQuery('');setSheet('namespace');}}>
      <View style={[styles.grow,{flexDirection:'row',alignItems:'center',gap:12}]}><Text style={styles.note}>namespace</Text><Text numberOfLines={1} style={[styles.value,{flex:1}]}>{state.namespace || t('選擇 namespace')}</Text></View><Feather name="chevron-down" size={18} color={colors.accent}/>
    </Pressable>
    {state.namespaces?.status==='loading' && <Text style={styles.note}>{t('讀取 namespace 中…')}</Text>}
    {state.namespaces?.status==='error' && <Text accessibilityRole="alert" style={styles.error}>{t(state.namespaces.message)}</Text>}
    </>}
    <Modal visible={sheet!==null && !state.configBusy} presentationStyle="pageSheet" animationType="slide" onRequestClose={close}>
      <View style={[styles.page,{paddingTop:Math.max(insets.top,16),paddingBottom:Math.max(insets.bottom,16)}]}>
        <View style={styles.header}><Text style={styles.value}>{t(sheet==='aws'?'選擇雲端帳號':'選擇 namespace')}</Text><Button label={t('關閉')} variant="secondary" onPress={close}/></View>
        <TextInput accessibilityLabel={t('搜尋選項')} placeholder={t('搜尋選項')} placeholderTextColor={colors.muted} style={styles.search} value={query} onChangeText={setQuery} autoCapitalize="none" autoCorrect={false}/>
        {!!(sheet==='aws'?awsStatus:state.namespaces?.message) && <Text accessibilityRole="alert" style={styles.error}>{t(sheet==='aws'?awsStatus:state.namespaces!.message)}</Text>}
        {(sheet==='aws'?awsBusy:state.namespaces?.status==='loading') && <Text style={styles.note}>{t('讀取中…')}</Text>}
        <FlatList data={filtered} keyExtractor={item=>item.key} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.list} ListEmptyComponent={<Text style={styles.note}>{t('沒有可選項目')}</Text>}
          renderItem={({item})=><Pressable accessibilityRole="radio" accessibilityLabel={item.label} accessibilityState={{checked:item.selected,disabled:item.disabled}} disabled={item.disabled || disabled} style={styles.selector} onPress={()=>{
            close(); if(sheet==='aws') void workspace.selectAWSProfile(item.label); else workspace.setNamespace(item.label);
          }}><View style={styles.grow}><Text style={[styles.value,item.disabled && styles.note]}>{item.label}</Text>{!!item.note && <Text style={styles.note}>{item.note}</Text>}</View>{item.selected && <Feather name="check" size={18} color={colors.accent}/>}</Pressable>}/>
        <View style={styles.footer}>{sheet==='aws'?<>
          <Button label={t('使用 kubeconfig 預設')} variant="secondary" disabled={disabled} onPress={()=>{close();void workspace.selectAWSProfile('');}}/>
          <Button label={t('管理雲端帳號')} variant="secondary" onPress={()=>{close();router.push('/settings/cloud-accounts');}}/>
        </>:<>
          {!!state.namespaces?.cursor && <Button label={t('載入更多 namespace')} disabled={state.namespaces.status==='loading'} onPress={()=>void workspace.refreshNamespaces(true)}/>}
          <Button label={t('重新讀取 namespace')} variant="secondary" disabled={state.namespaces?.status==='loading'} onPress={()=>void workspace.refreshNamespaces()}/>
        </>}</View>
      </View>
    </Modal>
  </>;
}
const createStyles = (colors:ThemeColors)=>StyleSheet.create({
 page:{flex:1,backgroundColor:colors.background,paddingHorizontal:20,gap:12},header:{flexDirection:'row',alignItems:'center',justifyContent:'space-between'},
 selector:{flexDirection:'row',alignItems:'center',gap:12,padding:14,backgroundColor:colors.panel,borderRadius:14,minHeight:52},grow:{flex:1,gap:4},value:{color:colors.text,fontSize:16,fontWeight:'600'},note:{color:colors.muted,fontSize:13},error:{color:colors.danger,fontSize:13},
 search:{minHeight:48,padding:12,borderRadius:12,backgroundColor:colors.panel,color:colors.text,fontSize:16},list:{gap:8,paddingBottom:12},footer:{gap:8},
});

import { KubernetesModal } from '../../features/kubernetes/KubernetesModal';
import { ResourceKindPicker } from '../../features/kubernetes/ResourceKindPicker';
import { DeleteResourcePanel } from '../../features/kubernetes/DeleteResourcePanel';
import { ResourceEditorPanel } from '../../features/kubernetes/ResourceEditorPanel';
import { PodUsage } from '../../features/kubernetes/ResourceUsage';
import { Feather } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { ConnectionSelectors } from '../../features/kubernetes/ConnectionSelectors';
import { HealthBadge } from '../../features/kubernetes/HealthBadge';
import { useLanguage } from '../../features/language/LanguageProvider';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { resourceLabels, canScale, hasContainers, isReadOnlyResource } from '../../features/kubernetes/workspace';
import { MetricsPanel } from '../../features/kubernetes/MetricsPanel';
import { ScalePanel } from '../../features/kubernetes/ScalePanel';
import { PodLogPanel } from '../../features/kubernetes/PodLogPanel';
import { Button } from '../../components/Button';
import { useTheme, useThemedStyles, type ThemeColors } from '../../components/theme';
import { useKubernetes } from '../../features/kubernetes/KubernetesProvider';

export default function Kubernetes() {
  const styles = useThemedStyles(createStyles);
  const { colors, dark } = useTheme();
  const { t } = useLanguage();
  const { workspace, state } = useKubernetes();
  useEffect(() => {
    const subscription = AppState.addEventListener('change', status => { if (status !== 'active') { workspace.closeDelete();workspace.closeEditor();workspace.closeDetail(); workspace.closeLogs(); workspace.closeScale(); workspace.closeMetrics(); } });
    return () => { subscription.remove(); workspace.closeDelete();workspace.closeEditor();workspace.closeDetail(); workspace.closeLogs(); workspace.closeScale(); workspace.closeMetrics(); };
  }, [workspace]);
  const searchScope=JSON.stringify([state.profile?.context,state.profile?.eks?.profile,state.namespace,state.kind]);
  const [searchState,setSearchState] = useState({scope:'',value:''});
  const [filter,setFilter] = useState({scope:'',unhealthy:false});
  const [selection,setSelection] = useState({scope:'',name:''});
  const [pullScope,setPullScope] = useState<string|null>(null);
  const pullRefresh=async()=>{
    if(pullScope===searchScope)return;
    setPullScope(searchScope);
    try {await workspace.refresh();}
    finally {setPullScope(current=>current===searchScope?null:current);}
  };
  const onlyUnhealthy=filter.scope===searchScope && filter.unhealthy;
  const selected=selection.scope===searchScope && state.status==='ready' ? [...state.pods,...state.resources].find(item=>item.name===selection.name) : undefined;
  useFocusEffect(useCallback(()=>{
    if(!state.profile || state.configBusy || state.namespace!==workspace.getSnapshot().namespace || state.kind!==workspace.getSnapshot().kind) return;
    let timer:ReturnType<typeof setInterval>|undefined;
    const stop=()=>{clearInterval(timer);timer=undefined;workspace.cancelListRefresh();};
    const start=(background:boolean)=>{
      if(timer!==undefined) return;
      void workspace.refresh({background});
      timer=setInterval(()=>{void workspace.refresh({background:true});},10_000);
    };
    if(AppState.currentState!=='background' && AppState.currentState!=='inactive') start(false);
    const subscription=AppState.addEventListener('change',status=>{if(status==='active')start(true);else stop();});
    return ()=>{stop();subscription.remove();workspace.closeDelete();workspace.closeEditor();workspace.closeDetail();workspace.closeLogs();workspace.closeScale();workspace.closeMetrics();};
  },[workspace,state.profile,state.configBusy,state.namespace,state.kind]));
  useFocusEffect(useCallback(()=>{
    if(state.profile && !state.configBusy) void workspace.refreshNamespaces();
  },[workspace,state.profile,state.configBusy]));
  const search=searchState.scope===searchScope?searchState.value:'';
  const setSearch=(value:string)=>setSearchState({scope:searchScope,value});
  const matches = (name:string)=>name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase());
  const pods=state.pods.filter(pod=>matches(pod.name) && (!onlyUnhealthy || pod.health==='unhealthy')); const resources=state.resources.filter(item=>matches(item.name) && (!onlyUnhealthy || item.health==='unhealthy'));
  const label = resourceLabels[state.kind];
  const count = state.kind === 'pods' ? state.pods.length : state.resources.length;
  return <><ScrollView style={styles.page} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" alwaysBounceVertical
    refreshControl={state.profile && !selected ? <RefreshControl accessibilityLabel={t('下拉刷新')} refreshing={pullScope===searchScope} onRefresh={()=>void pullRefresh()} tintColor={colors.accent} colors={[colors.accent]}/> : undefined}>
    {!state.profile ? <><Text style={styles.note}>{t("請先在設定匯入 kubeconfig")}</Text><Button label={t('Kubernetes 設定')} onPress={()=>router.push('/settings/kubernetes')}/></> : <>
      {selected ? <>
        <Button variant="secondary" label={t('返回資源')} onPress={()=>setSelection({scope:'',name:''})}/>
        <Text style={styles.detailName}>{selected.name}</Text>{selected.health && <HealthBadge health={selected.health}/>}
        <Text style={styles.note}>{state.profile.cluster} / {state.namespace}</Text>
        <Button variant="secondary" label={t('查看 YAML')} onPress={()=>void workspace.openEditor(selected.name,'yaml')}/>
        {hasContainers(state.kind) && <Button variant="secondary" label={t('變更 image')} onPress={()=>void workspace.openEditor(selected.name,'image')}/>}
        {'phase' in selected ? <>
          <Text style={styles.note}>{selected.reason || selected.phase} · {t('{ready}/{total} 就緒',{ready:selected.ready,total:selected.total})}</Text>
          <Button label={t('查看 {name} Log',{name:selected.name})} onPress={()=>void workspace.openPodLogs(selected.name)}/>
          <Button variant="secondary" label={t('查看 {name} 用量',{name:selected.name})} onPress={()=>void workspace.openMetrics(selected.name)}/>
        </> : <>
          <Text style={styles.note}>{canScale(state.kind)||state.kind==='daemonsets'?t('{ready}/{total} 就緒',{ready:selected.ready,total:selected.desired}):selected.detail || t('{count} 個項目',{count:selected.keyCount})}</Text>
          {canScale(state.kind) && <Button label={t('調整 {name} 副本數',{name:selected.name})} onPress={()=>void workspace.openScale(selected.name)}/>}
        </>}
        {!isReadOnlyResource(state.kind) && <Button variant="destructive" label={t('刪除資源')} onPress={()=>void workspace.openDelete(selected.name)}/>}
      </> : <>
        <View style={styles.toolbar}>
          <View style={styles.connection}><View style={[styles.dot,{backgroundColor:state.status==='ready'?(dark?'#66d99a':'#176b3b'):state.status==='error'?colors.danger:colors.muted}]}/><Text numberOfLines={1} style={[styles.note,{flex:1}]}>{state.profile.cluster}</Text></View>
        </View>
        <ConnectionSelectors key={JSON.stringify([state.profile.context,state.profile.eks?.profile])}/>
        <ResourceKindPicker />
        <View style={styles.search}><Feather name="search" size={19} color={colors.muted}/><TextInput accessibilityLabel={t('搜尋資源名稱')} placeholder={t('搜尋資源名稱')} placeholderTextColor={colors.muted} value={search} onChangeText={setSearch} autoCapitalize="none" autoCorrect={false} style={styles.input}/></View>
        {state.status==='loading' && <Text style={styles.note}>{t('讀取中…')}</Text>}
        {state.status==='ready' && <View style={styles.toolbar}><Text style={styles.note}>{t('{count} 個 {resource}',{count,resource:label})}</Text>
          {(state.kind==='pods' || canScale(state.kind) || state.kind==='daemonsets') && <Pressable accessibilityRole="button" accessibilityLabel={t('只看異常')} accessibilityState={{selected:onlyUnhealthy}} onPress={()=>setFilter({scope:searchScope,unhealthy:!onlyUnhealthy})} style={[styles.filter,onlyUnhealthy && {borderColor:colors.danger}]}>
            <Text style={styles.error}>{t('{count} 個異常',{count:[...state.pods,...state.resources].filter(item=>item.health==='unhealthy').length})}</Text>
          </Pressable>}
        </View>}
        {state.status==='ready' && !count && <Text style={styles.note}>{t('此 namespace 沒有 {resource}',{resource:label})}</Text>}
        {state.status==='ready' && count>0 && !(state.kind==='pods'?pods.length:resources.length) && <Text style={styles.note}>{t('找不到符合的資源')}</Text>}
        {!!search && state.hasMore && <Text style={styles.note}>{t('搜尋範圍為目前已載入的 200 筆資源。')}</Text>}
        <View style={styles.list}>
          {pods.map(pod=><Pressable key={pod.name} accessibilityRole="button" accessibilityLabel={t('查看 {name}',{name:pod.name})} onPress={()=>setSelection({scope:searchScope,name:pod.name})} style={[styles.row,pod.health==='unhealthy' && {backgroundColor:dark?'#351d23':'#fff0f2',borderLeftColor:colors.danger}]}>
            <View style={styles.rowBody}><View style={styles.rowTitle}><Text numberOfLines={1} style={styles.name}>{pod.name}</Text><HealthBadge health={pod.health}/></View>
              <Text numberOfLines={2} style={styles.rowNote}>{t('{ready}/{total} 就緒',{ready:pod.ready,total:pod.total})} · {pod.reason || pod.phase}</Text>
              <PodUsage compact metrics={state.listMetrics?.[pod.name]} limits={pod.limits}/>
            </View><Feather name="chevron-right" size={16} color={colors.muted}/>
          </Pressable>)}
          {resources.map(item=><Pressable key={item.name} accessibilityRole="button" accessibilityLabel={t('查看 {name}',{name:item.name})} onPress={()=>state.kind==='configmaps'?void workspace.openConfigMap(item.name):setSelection({scope:searchScope,name:item.name})} style={[styles.row,item.health==='unhealthy' && {backgroundColor:dark?'#351d23':'#fff0f2',borderLeftColor:colors.danger}]}>
            <View style={styles.rowBody}><View style={styles.rowTitle}><Text numberOfLines={1} style={styles.name}>{item.name}</Text>{(state.kind==='pods' || canScale(state.kind) || state.kind==='daemonsets') && <HealthBadge health={item.health}/>}</View>
              <Text style={styles.rowNote}>{state.kind==='configmaps'?t('{count} 個項目',{count:item.keyCount}):canScale(state.kind)||state.kind==='daemonsets'?t('{ready}/{total} 就緒',{ready:item.ready,total:item.desired}):state.kind==='secrets'?t('{count} 個項目',{count:item.keyCount}):item.detail}</Text>
            </View><Feather name="chevron-right" size={16} color={colors.muted}/>
          </Pressable>)}
        </View>
        {!!state.listMetricsMessage && <Text style={styles.note}>{t(state.listMetricsMessage)}</Text>}
        {!!state.refreshMessage && <Text accessibilityRole="alert" style={styles.error}>{t('更新失敗，顯示上次資料。')} {t(state.refreshMessage)}</Text>}
        {!!state.updatedAt && <Text style={styles.updated}>{t('更新於 {time}',{time:new Date(state.updatedAt).toLocaleTimeString()})}</Text>}
      </>}
      {state.hasMore && <Text style={styles.note}>{t('目前僅顯示前 200 個 {resource}', { resource: label })}</Text>}
    </>}
    {!state.scale && !state.editor && !!state.scaleNotice && <Text style={styles.note}>{t(state.scaleNotice)}</Text>}
    {state.status === 'error' && !!state.message && <Text accessibilityRole="alert" style={state.status === 'error' ? styles.error : styles.note}>{t(state.message)}</Text>}
  </ScrollView>
    {/* 操作視窗須留在捲動區外，避免 RefreshControl 切換時重建仍開啟的原生視窗。 */}
    {state.profile && <>
      <KubernetesModal visible={!!state.detailName} animationType="slide" onRequestClose={() => workspace.closeDetail()}>
        <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.detail}>
          <Button variant="secondary" label={t("關閉內容")} onPress={() => workspace.closeDetail()} />
          <Text style={styles.name}>{state.detailName}</Text>
          <Button label={t('查看 YAML')} onPress={()=>{if(state.detailName) void workspace.openEditor(state.detailName,'yaml');}}/>
          {state.detailStatus === 'loading' && <Text style={styles.note}>{t("讀取中…")}</Text>}
          {state.detailStatus === 'error' && <>
            <Text accessibilityRole="alert" style={styles.error}>{t(state.detailMessage)}</Text>
            <Button label={t("重試")} onPress={() => { if (state.detailName) void workspace.openConfigMap(state.detailName); }} />
          </>}
          {state.detail && <>
            {state.detail.immutable && <Text style={styles.note}>{t("不可變更")}</Text>}
            {!state.detail.entries.length && <Text style={styles.note}>{t("沒有設定內容")}</Text>}
            {state.detail.entries.map(entry => <View key={entry.key} style={styles.pod}>
              <Text style={styles.name}>{entry.key}</Text>
              <Text selectable style={styles.value}>{entry.binary ? t('二進位資料 · {bytes} bytes', { bytes: entry.bytes ?? '' }) : entry.value || t("（空值）")}</Text>
              {entry.truncated && <Text style={styles.note}>{t("內容已截斷")}</Text>}
            </View>)}
            {state.detail.truncated && <Text style={styles.note}>{t("僅顯示部分內容：最多 200 個項目，每項 4096 字元，合計 32768 字元。")}</Text>}
          </>}
          <Button variant="destructive" label={t('刪除資源')} onPress={()=>{if(state.detailName)void workspace.openDelete(state.detailName);}}/>
        </ScrollView>
      </KubernetesModal>
      <PodLogPanel />
      <ScalePanel />
      <DeleteResourcePanel />
      <ResourceEditorPanel />
      <MetricsPanel />
    </>}
  </>;
}
const createStyles = (colors: ThemeColors) => StyleSheet.create({
 page:{flex:1,backgroundColor:colors.background},content:{padding:16,gap:12,paddingBottom:32},note:{color:colors.muted,fontSize:14},
 toolbar:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:12},connection:{flexDirection:'row',alignItems:'center',gap:8,flex:1},dot:{width:8,height:8,borderRadius:4},
 search:{flexDirection:'row',alignItems:'center',gap:8,paddingHorizontal:12,backgroundColor:colors.panel,borderRadius:14},input:{flex:1,minHeight:52,fontSize:16,color:colors.text},
 list:{borderRadius:14,overflow:'hidden'},row:{flexDirection:'row',alignItems:'center',gap:8,paddingVertical:14,paddingRight:12,paddingLeft:12,borderLeftWidth:3,borderLeftColor:'transparent',backgroundColor:colors.panel,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:colors.line,minHeight:72},rowBody:{flex:1,gap:7},rowTitle:{flexDirection:'row',alignItems:'center',gap:8},name:{flex:1,color:colors.text,fontSize:15,fontWeight:'600'},rowNote:{color:colors.muted,fontSize:12},
 filter:{minHeight:44,paddingHorizontal:10,borderRadius:22,borderWidth:1,borderColor:'transparent',justifyContent:'center',backgroundColor:colors.panel},updated:{color:colors.muted,fontSize:12,textAlign:'center'},detailName:{color:colors.text,fontSize:24,fontWeight:'700'},
 detail:{padding:20,paddingTop:32,paddingBottom:40,gap:12},pod:{backgroundColor:colors.panel,borderRadius:14,padding:16,gap:6},value:{color:colors.text,fontSize:14,lineHeight:21},error:{color:colors.danger,fontSize:14},
});

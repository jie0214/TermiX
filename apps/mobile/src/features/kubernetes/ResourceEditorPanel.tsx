import { KubernetesModal } from './KubernetesModal';
import { Keyboard, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button } from '../../components/Button';
import { useThemedStyles, type ThemeColors } from '../../components/theme';
import { useLanguage } from '../language/LanguageProvider';
import { useKubernetes } from './KubernetesProvider';
import { resourceLabels, isReadOnlyResource } from './workspace';

export function ResourceEditorPanel() {
  const {workspace,state}=useKubernetes();
  const {t}=useLanguage();
  const styles=useThemedStyles(createStyles);
  const p=state.editor;
  return <KubernetesModal visible={!!p} animationType="slide" onRequestClose={()=>workspace.closeEditor()}>
    {p && <KeyboardAvoidingView style={styles.page} behavior={Platform.OS==='ios'?'padding':'height'}>
      <View style={styles.header}>
        <Button variant="secondary" label={t('關閉編輯器')} onPress={()=>workspace.closeEditor()}/>
        <Text style={styles.name}>{p.name}</Text>
        <Text style={styles.note}>{p.cluster} / {p.namespace} / {resourceLabels[p.kind]}</Text>
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {p.status==='loading' && <Text style={styles.note}>{t('讀取中…')}</Text>}
        {p.mode==='yaml' && p.status==='viewing' && <>
          {!isReadOnlyResource(p.kind) && p.kind!=='secrets' && <Button label={t('編輯 YAML')} onPress={()=>workspace.editDocument()}/>}
          {p.kind==='secrets' && <Text style={styles.note}>{t('Secret 資料已遮蔽。')}</Text>}
          <Text style={styles.note}>{t(isReadOnlyResource(p.kind)?'唯讀資源；已省略 managedFields，內容不會儲存在手機。':'已省略 status 與 managedFields；內容不會儲存在手機。')}</Text>
          <Text selectable style={styles.code}>{p.value?.yaml}</Text>
        </>}
        {p.mode==='image' && p.status==='viewing' && <>
          {p.value?.containers.map(c=><View key={c.group+'/'+c.name} style={styles.card}>
            <Text style={styles.name}>{c.name}{c.group==='initContainers'?t('（初始化）'):''}</Text>
            <Text selectable style={styles.code}>{c.image}</Text>
            <Button label={t('變更 {name} image',{name:c.name})} onPress={()=>workspace.selectImage(c)}/>
          </View>)}
          {!p.value?.containers.length && <Text style={styles.note}>{t('沒有可修改的容器')}</Text>}
        </>}
        {p.status==='editing' && <>
          {p.container && <Text style={styles.name}>{p.container.name}</Text>}
          <TextInput accessibilityLabel={p.mode==='yaml'?t('YAML 內容'):t('容器 image')} value={p.input}
            onChangeText={v=>workspace.setDocumentInput(v)} multiline={p.mode==='yaml'} autoCorrect={false} autoCapitalize="none" spellCheck={false}
            maxLength={p.mode==='yaml'?524288:2048} style={[styles.input,p.mode==='yaml' && styles.yaml]} textAlignVertical="top"/>
          <Button label={t('檢查變更')} onPress={()=>{Keyboard.dismiss();workspace.reviewDocument();}}/>
        </>}
        {p.status==='confirming' && <>
          <Text style={styles.name}>{t('確認資源變更')}</Text>
          {p.mode==='image' ? <>
            <Text style={styles.note}>{p.container?.name}</Text>
            <Text selectable style={styles.code}>{p.container?.image} → {p.input}</Text>
            <Text style={styles.note}>{t('變更 image 可能重新啟動容器；工作負載會依更新策略套用。')}</Text>
          </> : <>
            <Text style={styles.note}>{t('即將送出以下 YAML；刪除的欄位也會套用至資源。')}</Text>
            <Text selectable style={styles.code}>{p.input}</Text>
          </>}
          <Button label={t('確認儲存')} onPress={()=>void workspace.submitDocument()}/>
          <Button variant="secondary" label={t('返回修改')} onPress={()=>workspace.returnToEditor()}/>
        </>}
        {p.status==='submitting' && <Text style={styles.note}>{t('送出中…關閉畫面不會撤回已送出的變更。')}</Text>}
        {!!p.message && <Text accessibilityRole={p.status==='error'?'alert':undefined} style={p.status==='success'?styles.note:styles.error}>{t(p.message)}</Text>}
        {(p.status==='success' || p.status==='error') && <Button label={t('重新查詢資源')} onPress={()=>{workspace.closeEditor();void workspace.refresh();}}/>}
      </ScrollView>
    </KeyboardAvoidingView>}
  </KubernetesModal>;
}
const createStyles=(colors:ThemeColors)=>StyleSheet.create({
 page:{flex:1,backgroundColor:colors.background},header:{padding:20,paddingTop:32,gap:10},content:{padding:20,paddingBottom:40,gap:16},
 name:{color:colors.text,fontSize:17,fontWeight:'600'},note:{color:colors.muted,fontSize:14,lineHeight:21},error:{color:colors.danger,fontSize:14},
 code:{color:colors.text,fontFamily:Platform.OS==='ios'?'Menlo':'monospace',fontSize:12,lineHeight:18},
 input:{color:colors.text,backgroundColor:colors.panel,padding:12,borderRadius:12,fontFamily:Platform.OS==='ios'?'Menlo':'monospace',fontSize:14,minHeight:48},yaml:{minHeight:360,fontSize:12,lineHeight:18},card:{padding:14,borderRadius:12,backgroundColor:colors.panel,gap:10},
});

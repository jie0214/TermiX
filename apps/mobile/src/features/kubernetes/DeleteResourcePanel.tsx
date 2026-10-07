import { KubernetesModal } from './KubernetesModal';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { Button } from '../../components/Button';
import { useThemedStyles, type ThemeColors } from '../../components/theme';
import { useLanguage } from '../language/LanguageProvider';
import { useKubernetes } from './KubernetesProvider';
import { resourceLabels } from './workspace';

export function DeleteResourcePanel(){
 const {state,workspace}=useKubernetes();const {t}=useLanguage();const styles=useThemedStyles(createStyles);const p=state.deletion;
 return <KubernetesModal visible={!!p} animationType="slide" onRequestClose={()=>workspace.closeDelete()}>
  {p && <ScrollView style={styles.page} contentContainerStyle={styles.content}>
   <Button label={t('取消')} variant="secondary" onPress={()=>workspace.closeDelete()}/>
   <Text style={styles.title}>{t('刪除資源')}</Text><Text style={styles.title}>{p.name}</Text>
   <Text style={styles.note}>{p.cluster} / {p.namespace} / {resourceLabels[p.kind]}</Text>
   {p.status==='loading' && <Text style={styles.note}>{t('讀取中…')}</Text>}
   {p.status==='confirming' && <>
    <Text style={styles.note}>{t(p.kind==='persistentvolumeclaims'?'刪除此宣告可能導致儲存資料遺失。':p.kind==='pods'?'由工作負載管理的 Pod 可能重新建立。':'此操作會移除此資源，並可能影響使用它的服務。')}</Text>
    <Button label={t('再次確認刪除')} variant="destructive" onPress={()=>void workspace.submitDelete()}/>
   </>}
   {p.status==='submitting' && <Text style={styles.note}>{t('送出中…')}</Text>}
   {!!p.message && <Text accessibilityRole={p.status==='error'?'alert':undefined} style={p.status==='error'?styles.error:styles.note}>{t(p.message)}</Text>}
   {(p.status==='error'||p.status==='success') && <Button label={t('重新查詢資源')} onPress={()=>{workspace.closeDelete();void workspace.refresh();}}/>}
  </ScrollView>}
 </KubernetesModal>;
}
const createStyles=(c:ThemeColors)=>StyleSheet.create({page:{backgroundColor:c.background},content:{padding:20,paddingTop:32,gap:16},title:{fontSize:17,fontWeight:'600',color:c.text},note:{fontSize:14,lineHeight:21,color:c.muted},error:{fontSize:14,color:c.danger}});

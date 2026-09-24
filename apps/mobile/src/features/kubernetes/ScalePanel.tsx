import { useLanguage } from '../language/LanguageProvider';
import { Keyboard, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput } from 'react-native';
import { Button } from '../../components/Button';
import { useThemedStyles, type ThemeColors } from '../../components/theme';
import { useKubernetes } from './KubernetesProvider';
import { resourceLabels } from './workspace';

export function ScalePanel() {
  const styles = useThemedStyles(createStyles);
  const { t } = useLanguage();
  const { workspace, state } = useKubernetes();
  const panel = state.scale;
  return <Modal visible={!!panel} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => workspace.closeScale()}>
    {panel && <KeyboardAvoidingView style={styles.page} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Button variant="secondary" label={t("關閉副本設定")} onPress={() => workspace.closeScale()} />
        <Text style={styles.note}>{panel.cluster} · {panel.context}</Text>
        <Text style={styles.name}>{panel.namespace} · {resourceLabels[panel.kind]} · {panel.name}</Text>
        {panel.status === 'loading' && <Text style={styles.note}>{t("讀取中…")}</Text>}
        {panel.status === 'editing' && <>
          <Text style={styles.note}>{t('目前期望副本數 {count}', { count: panel.value?.replicas ?? 0 })}</Text>
          <TextInput accessibilityLabel={t("期望副本數")} value={panel.input} onChangeText={value => workspace.setScaleReplicas(value)}
            keyboardType="number-pad" maxLength={10} style={styles.input} />
          <Button label={t("檢查變更")} onPress={() => { Keyboard.dismiss(); workspace.reviewScale(); }} />
        </>}
        {panel.status === 'confirming' && <>
          <Text style={styles.change}>{panel.value?.replicas} → {Number(panel.input)}</Text>
          {Number(panel.input) === 0 && <Text style={styles.error}>{t("設為 0 將停止此工作負載的所有副本。")}</Text>}
          <Text style={styles.note}>{t("自動縮放或其他管理工具可能再次調整此數值。")}</Text>
          <Button label={t("確認調整")} onPress={() => void workspace.submitScale()} />
          <Button label={t("返回修改")} onPress={() => workspace.editScale()} />
        </>}
        {panel.status === 'submitting' && <Text style={styles.note}>{t("送出中…關閉畫面不會撤回已送出的變更。")}</Text>}
        {!!panel.message && <Text style={panel.status === 'success' ? styles.note : styles.error}>{t(panel.message)}</Text>}
        {(panel.status === 'error' || panel.status === 'success') && <Button label={t("重新讀取副本數")} onPress={() => void workspace.openScale(panel.name)} />}
      </ScrollView>
    </KeyboardAvoidingView>}
  </Modal>;
}
const createStyles = (colors: ThemeColors) => StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20, paddingTop: 32, paddingBottom: 40, gap: 16 },
  name: { color: colors.text, fontSize: 17, fontWeight: '600' },
  note: { color: colors.muted, fontSize: 14, lineHeight: 21 },
  error: { color: colors.danger, fontSize: 14, lineHeight: 21 },
  change: { color: colors.text, fontSize: 28, fontWeight: '600' },
  input: { backgroundColor: colors.panel, color: colors.text, fontSize: 20, padding: 16, borderRadius: 12 },
});

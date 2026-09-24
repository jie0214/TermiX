import { useLanguage } from '../language/LanguageProvider';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Button } from '../../components/Button';
import { useThemedStyles, type ThemeColors } from '../../components/theme';
import { useKubernetes } from './KubernetesProvider';

const suffix = { regular: '', init: '（初始化）', ephemeral: '（臨時）' };
export function PodLogPanel() {
  const styles = useThemedStyles(createStyles);
  const { t } = useLanguage();
  const { workspace, state } = useKubernetes();
  const logs = state.logs;
  return <Modal visible={!!logs} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => workspace.closeLogs()}>
    {logs && <View style={styles.page}>
      <Button variant="secondary" label={t("關閉 Log")} onPress={() => workspace.closeLogs()} />
      <Text style={styles.title}>{logs.pod}</Text>
      {logs.optionsStatus === 'loading' && <Text style={styles.note}>{t("讀取容器中…")}</Text>}
      {logs.optionsStatus === 'error' && <>
        <Text accessibilityRole="alert" style={styles.error}>{t(logs.message)}</Text>
        <Button label={t("重試容器查詢")} onPress={() => void workspace.openPodLogs(logs.pod)} />
      </>}
      {logs.optionsStatus === 'ready' && <>
        <View><ScrollView horizontal contentContainerStyle={styles.containers}>
          {logs.containers.map(container => <Pressable key={container.name} accessibilityRole="radio"
            accessibilityLabel={container.name + t(suffix[container.kind])} accessibilityState={{ checked: logs.container === container.name }}
            onPress={() => void workspace.selectLogContainer(container.name)}
            style={[styles.container, logs.container === container.name && styles.selected]}>
            <Text style={logs.container === container.name ? styles.selectedText : styles.text}>{container.name}{t(suffix[container.kind])}</Text>
          </Pressable>)}
        </ScrollView></View>
        <View style={styles.toggle}><Text style={styles.text}>{t("前次執行")}</Text>
          <Switch accessibilityLabel={t("前次執行")} value={logs.previous} onValueChange={value => void workspace.setPreviousLogs(value)} />
        </View>
        <Button label={logs.status === 'loading' ? t("讀取中…") : t("重新整理 Log")} disabled={logs.status === 'loading'} onPress={() => void workspace.refreshLogs()} />
        <Text style={styles.note}>{t("最近 200 行 · 上限 64 KB · 手動更新")}</Text>
        {logs.status === 'error' && <Text accessibilityRole="alert" style={styles.error}>{t(logs.message)}</Text>}
        {logs.status === 'ready' && !logs.text && <Text style={styles.note}>{t("沒有 Log 紀錄")}</Text>}
        {logs.truncated && <Text style={styles.note}>{t("已達顯示上限，內容可能不完整。")}</Text>}
        <ScrollView style={styles.output} contentContainerStyle={styles.outputContent}>
          {!!logs.text && <Text selectable style={styles.log}>{logs.text}</Text>}
        </ScrollView>
      </>}
    </View>}
  </Modal>;
}
const createStyles = (colors: ThemeColors) => StyleSheet.create({
  page: { flex: 1, padding: 20, paddingTop: 32, paddingBottom: 32, gap: 12, backgroundColor: colors.background },
  title: { color: colors.text, fontSize: 16, fontWeight: '600' }, text: { color: colors.text, fontSize: 14 },
  note: { color: colors.muted, fontSize: 13 }, error: { color: colors.danger, fontSize: 14 },
  containers: { gap: 8 }, container: { minHeight: 44, paddingHorizontal: 12, justifyContent: 'center', borderRadius: 12, backgroundColor: colors.panel },
  selected: { backgroundColor: colors.button }, selectedText: { color: colors.onButton, fontSize: 14 },
  toggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  output: { flex: 1, backgroundColor: colors.panel, borderRadius: 12 }, outputContent: { padding: 12 },
  log: { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 12, lineHeight: 18, color: colors.text },
});

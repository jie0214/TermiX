import { PodUsage, UsageMeter } from './ResourceUsage';
import { useLanguage } from '../language/LanguageProvider';
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button } from '../../components/Button';
import { useThemedStyles, type ThemeColors } from '../../components/theme';
import { useKubernetes } from './KubernetesProvider';

function amount(value: number) {
  if (value > 0 && value < 0.01) return '<0.01';
  return String(Number(value.toFixed(2)));
}
export function MetricsPanel() {
  const styles = useThemedStyles(createStyles);
  const { t } = useLanguage();
  const { workspace, state } = useKubernetes();
  const panel = state.metrics;
  const limits=state.pods.find(pod=>pod.name===panel?.pod)?.limits;
  return <Modal visible={!!panel} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => workspace.closeMetrics()}>
    {panel && <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <Button variant="secondary" label={t("關閉用量")} onPress={() => workspace.closeMetrics()} />
      <Text style={styles.name}>{panel.pod}</Text>
      <Button label={panel.status === 'loading' ? t("讀取中…") : t("重新整理用量")} disabled={panel.status === 'loading'} onPress={() => void workspace.openMetrics(panel.pod)} />
      {panel.status === 'error' && <Text accessibilityRole="alert" style={styles.error}>{t(panel.message)}</Text>}
      {panel.value && <>
        <Text style={styles.note}>{t('採樣 {timestamp} · 區間 {seconds} 秒', { timestamp: panel.value.timestamp, seconds: amount(panel.value.windowSeconds) })}</Text>
        <Text style={styles.note}>{t('上限依最近一次 Pod 清單設定；未包含 requests。')}</Text>
        <View style={styles.card}><Text style={styles.name}>{t("已回報容器合計")}</Text><PodUsage metrics={panel.value} limits={limits}/></View>
        {panel.value.containers.map(item => <View key={item.name} style={styles.card}>
          <Text style={styles.name}>{item.name}</Text>
          <UsageMeter label="CPU" used={item.cpuMilli} limit={limits?.containers.find(container=>container.name===item.name)?.cpu} unit="m"/>
          <UsageMeter label={t('記憶體')} used={item.memoryMiB} limit={limits?.containers.find(container=>container.name===item.name)?.memory} unit="MiB"/>
        </View>)}
        <Text style={styles.note}>{t("CPU 為採樣區間平均值，1000 m = 1 核心。記憶體為 working set；非即時資料，不含未回報容器。")}</Text>
      </>}
    </ScrollView>}
  </Modal>;
}
const createStyles = (colors: ThemeColors) => StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background }, content: { padding: 20, paddingTop: 32, paddingBottom: 40, gap: 14 },
  card: { backgroundColor: colors.panel, borderRadius: 14, padding: 16, gap: 8 },
  name: { color: colors.text, fontSize: 16, fontWeight: '600' }, value: { color: colors.text, fontSize: 15, lineHeight: 23 },
  note: { color: colors.muted, fontSize: 13, lineHeight: 20 }, error: { color: colors.danger, fontSize: 14 },
});

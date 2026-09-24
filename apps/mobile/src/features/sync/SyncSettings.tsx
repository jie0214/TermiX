import { NavigationHeader } from '../../components/NavigationHeader';
import { useLanguage } from '../language/LanguageProvider';
import { useRef, useState, useSyncExternalStore } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button } from '../../components/Button';
import { useThemedStyles, type ThemeColors } from '../../components/theme';
import type { SyncMode, SyncWorkspace } from './workspace';

export function SyncSettings({ workspace, pickFile, onBack }: {
  workspace: SyncWorkspace; pickFile(): Promise<string | null>; onBack(): void;
}) {
  const styles = useThemedStyles(createStyles);
  const { t, locale } = useLanguage();
  const state = useSyncExternalStore(workspace.subscribe, workspace.getSnapshot);
  const [picking, setPicking] = useState(false);
  const [fileError, setFileError] = useState('');
  const pickingRef = useRef(false);
  const selectMode = async (mode: SyncMode) => {
    setFileError(''); await workspace.setMode(mode);
    if (mode === 'cloud') await workspace.refresh();
  };
  const selectFile = async () => {
    if (pickingRef.current) return;
    pickingRef.current = true; setPicking(true); setFileError(''); workspace.cancelFile();
    try { const raw = await pickFile(); if (raw !== null) workspace.prepareFile(raw); }
    catch { setFileError('無法讀取設定檔，請選擇 256 KB 內的手機設定 JSON。'); }
    finally { pickingRef.current = false; setPicking(false); }
  };
  return <ScrollView style={styles.page} contentContainerStyle={styles.content}>
    <NavigationHeader title={t("同步設定")} backLabel={t("返回設定")} onBack={onBack} disabled={picking} />
    <View style={styles.options}>
      {([{ mode: 'off', label: t("關閉") }, { mode: 'cloud', label: t("iCloud 同步") }, { mode: 'file', label: t("檔案匯入") }] as const).filter(option => option.mode !== 'cloud' || workspace.capability === 'available').map(option =>
        <Pressable key={option.mode} accessibilityRole="radio" accessibilityState={{ selected: state.mode === option.mode }}
          disabled={!state.loaded || picking} onPress={() => void selectMode(option.mode)}
          style={[styles.option, state.mode === option.mode && styles.selected]}>
          <Text style={state.mode === option.mode ? styles.selectedText : styles.label}>{option.label}</Text>
        </Pressable>)}
    </View>
    <Text style={styles.note}>{t("僅同步主機設定，不含密碼、私鑰與 token。")}</Text>
    {state.mode === 'cloud' && <View style={styles.section}>
      <Text style={styles.note}>{t("使用相同 Apple ID。App 位於前景時每 30 秒更新；SSH 連線期間暫停。")}</Text>
      <Button label={state.busy ? t("同步中…") : t("立即同步")} onPress={() => void workspace.refresh()} disabled={state.busy} />
    </View>}
    {state.mode === 'file' && <View style={styles.section}>
      <Text style={styles.note}>{t("在桌面匯出「手機設定」，再從 iCloud Drive 或裝置檔案選取。")}</Text>
      <Button label={picking ? t("讀取中…") : t("選擇設定檔")} onPress={() => void selectFile()} disabled={picking || state.busy} />
      {state.preview && <View style={styles.preview}>
        <Text style={styles.label}>{t('{count} 台主機', { count: state.preview.count })}</Text>
        <Text style={styles.note}>{t("更新同來源主機，保留手機自行新增的主機；不同步刪除。")}</Text>
        <Button label={state.busy ? t("匯入中…") : t("確認匯入")} onPress={() => void workspace.applyFile()} disabled={state.busy} />
        <Button variant="secondary" label={t("取消")} onPress={() => workspace.cancelFile()} disabled={state.busy} />
      </View>}
    </View>}
    {!!(fileError || state.error) && <Text accessibilityRole="alert" style={styles.error}>{t(fileError || state.error)}</Text>}
    {!!state.message && <Text style={styles.note}>{t(state.message)}</Text>}
    {!!state.lastSuccess && <Text style={styles.note}>{t('本次開啟最後同步：{time}', { time: new Date(state.lastSuccess).toLocaleTimeString(locale) })}</Text>}
  </ScrollView>;
}
const createStyles = (colors: ThemeColors) => StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background }, content: { padding: 20, gap: 16, paddingBottom: 40 },
  title: { fontSize: 22, fontWeight: '600', color: colors.text }, options: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  option: { minHeight: 48, padding: 12, borderWidth: 1, borderColor: colors.line, borderRadius: 12, justifyContent: 'center' },
  selected: { backgroundColor: colors.button, borderColor: colors.accent }, selectedText: { fontSize: 16, color: colors.onButton },
  label: { color: colors.text, fontSize: 16 }, note: { color: colors.muted, fontSize: 14, lineHeight: 21 },
  error: { color: colors.danger, fontSize: 14, lineHeight: 21 }, section: { gap: 16 },
  preview: { backgroundColor: colors.panel, padding: 16, borderRadius: 14, gap: 12 },
});

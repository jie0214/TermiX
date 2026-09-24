import { useLanguage } from '../language/LanguageProvider';
import { useCallback, useRef, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '../../components/Button';
import { useThemedStyles, type ThemeColors } from '../../components/theme';
import { useTerminal } from './TerminalProvider';
import type { TerminalSession } from './session';
import { TerminalView } from './TerminalView';
import { TerminalComposer } from './TerminalComposer';

const statusLabels = { idle: '', connecting: '連線中…', trust: '確認主機金鑰', connected: '已連線', closing: '中斷中…', closed: '已中斷', error: '連線失敗' };
export function TerminalScreen() {
  const styles = useThemedStyles(createStyles);
  const { t } = useLanguage();
  const { session, state } = useTerminal();
  const rendererFailure = useCallback(() => { void session.disconnect('終端畫面無法繼續顯示，連線已中斷。'); }, [session]);
  const insets = useSafeAreaInsets();
  const connected = state.status === 'connected';
  const needsPassphrase = state.status === 'error' && ['private_key_passphrase_required', 'private_key_decryption_failed'].includes(state.errorCode ?? '');
  const active = ['connecting', 'trust', 'connected'].includes(state.status);
  if (!state.host) return <View style={styles.empty}><Text style={styles.hint}>{t("從主機清單選擇連線目標")}</Text></View>;
  return <KeyboardAvoidingView style={styles.page} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={insets.top}>
    <View style={styles.header}>
      <View style={styles.target}><Text style={styles.name}>{state.host.name}</Text>
        <Text style={styles.meta}>{state.host.username}@{state.host.address}:{state.host.port}</Text>
        <Text style={styles.meta} accessibilityLiveRegion="polite">{t(statusLabels[state.status])}</Text></View>
      {active && <Button label={connected ? t("中斷") : t("取消")} onPress={() => { Keyboard.dismiss(); void session.disconnect(); }} />}
    </View>
    {state.challenge ? <ScrollView contentContainerStyle={styles.trust} keyboardShouldPersistTaps="handled">
      <Text style={styles.name}>{t("首次連線，請核對指紋")}</Text><Text style={styles.hint}>{state.challenge.algorithm}</Text>
      <Text selectable style={styles.fingerprint}>{state.challenge.fingerprint}</Text>
      <Button label={t("信任並連線")} onPress={() => void session.acceptHostKey()} />
      <Button variant="secondary" label={t("取消連線")} onPress={() => void session.disconnect()} />
    </ScrollView> : needsPassphrase ? <ScrollView contentContainerStyle={styles.trust} keyboardShouldPersistTaps="handled">
      <Text accessibilityRole="alert" style={styles.hint}>{t(state.message)}</Text>
      <PassphraseRetry key={state.sessionId} session={session} />
    </ScrollView> : <TerminalView key={`output-${state.sessionId}`} session={session} onFailure={rendererFailure} />}
    {!!state.message && !needsPassphrase && <View style={styles.feedback}><Text accessibilityRole="alert" style={styles.hint}>{t(state.message)}</Text>
      {!active && state.status !== 'closing' && <Button label={t("重新連線")} onPress={() => { void session.connect(state.host!); }} />}</View>}
    {connected && <TerminalComposer key={`input-${state.sessionId}`} session={session} />}

  </KeyboardAvoidingView>;
}
function PassphraseRetry({ session }: { session: TerminalSession }) {
  const styles = useThemedStyles(createStyles);
  const { t } = useLanguage();
  const [passphrase, setPassphrase] = useState('');
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const retry = async () => {
    if (busy.current || !passphrase) return;
    busy.current = true;
    setSaving(true);
    if (await session.retryWithPassphrase(passphrase)) setPassphrase('');
    busy.current = false;
    setSaving(false);
  };
  return <View style={{ gap: 12 }}>
    <Text style={styles.hint}>{t("私鑰密語")}</Text>
    <TextInput accessibilityLabel={t("私鑰密語")} secureTextEntry autoComplete="off" textContentType="none"
      autoCapitalize="none" autoCorrect={false} value={passphrase} onChangeText={setPassphrase} maxLength={4096}
      editable={!saving} style={[styles.input, { flex: 0 }]} returnKeyType="go" onSubmitEditing={() => void retry()} />
    <Button label={t("儲存密語並重試")} disabled={saving || !passphrase} onPress={() => void retry()} />
  </View>;
}
const createStyles = (colors: ThemeColors) => StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background }, empty: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: 24 },
  header: { flexDirection: 'row', padding: 14, gap: 12, alignItems: 'center' }, target: { flex: 1 },
  name: { color: colors.text, fontSize: 16, fontWeight: '600' }, meta: { color: colors.muted, fontSize: 12, marginTop: 3 },
  hint: { color: colors.muted, fontSize: 15 }, trust: { padding: 24, gap: 18 },
  fingerprint: { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 14, color: colors.text },
  feedback: { padding: 12, gap: 10 }, composer: { flexDirection: 'row', gap: 8, padding: 10, backgroundColor: colors.panel, alignItems: 'center' },
  input: { flex: 1, minWidth: 0, minHeight: 48, padding: 12, borderWidth: 1, borderColor: colors.line, borderRadius: 12, fontSize: 16, color: colors.text },
});

import { useEffect, useRef, useState } from 'react';
import { Alert, AppState, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button } from '../../components/Button';
import { useThemedStyles, type ThemeColors } from '../../components/theme';
import { useLanguage } from '../language/LanguageProvider';
import { awsMessage, type AwsCredentials, type AwsProfile, type AwsRepository } from './repository';
const empty: AwsCredentials = { accessKeyId: '', secretAccessKey: '', sessionToken: '' };
export function AwsSettings({ repository, suggested }: { repository: AwsRepository; suggested?: { name: string; region: string } }) {
  const { t } = useLanguage(); const styles = useThemedStyles(createStyles);
  const [profiles, setProfiles] = useState<AwsProfile[]>([]);
  const [name, setName] = useState(suggested?.name ?? 'default');
  const [region, setRegion] = useState(suggested?.region ?? 'ap-northeast-1');
  const [credentials, setCredentials] = useState<AwsCredentials>(empty);
  const [editing, setEditing] = useState<string>();
  const [busy, setBusy] = useState(false); const [ready, setReady] = useState(false); const [error, setError] = useState('');
  const [notice, setNotice] = useState(''); const pending = useRef(false);
  useEffect(() => {
    let alive = true;
    void repository.list().then(items => { if (alive) { setProfiles(items); setReady(true); } }).catch(cause => { if (alive) setError(awsMessage(cause)); });
    const subscription = AppState.addEventListener('change', status => { if (status !== 'active') setCredentials(empty); });
    return () => { alive = false; subscription.remove(); };
  }, [repository]);
  const action = async (operation: () => Promise<unknown>, success = '') => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(''); setNotice('');
    try { await operation(); setProfiles(await repository.list()); setReady(true); setNotice(success); }
    catch (cause) { setError(awsMessage(cause)); }
    finally { pending.current = false; setBusy(false); }
  };
  const save = () => action(async () => {
    await repository.save(name, region, credentials); setCredentials(empty); setEditing(undefined);
  }, 'AWS profile 已驗證並安全保存。');
  const remove = (profile: AwsProfile) => Alert.alert(t('刪除 AWS profile？'), t('將移除此手機保存的憑證；不會刪除 AWS 帳號或 IAM 金鑰。'), [
    { text: t('取消'), style: 'cancel' },
    { text: t('刪除'), style: 'destructive', onPress: () => void action(async () => {
      await repository.remove(profile.key);
      if (editing === profile.key) { setEditing(undefined); setCredentials(empty); }
    }) },
  ]);
  return <ScrollView style={styles.page} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    {!ready && <Button label={t('重試')} disabled={busy} onPress={() => void action(async () => {})} />}
    {profiles.map(profile => <View key={profile.key} style={styles.card}>
      <Text style={styles.title}>{profile.name}</Text>
      <Text style={styles.note}>{profile.region} · {profile.account} · {t(profile.enabled ? '已啟用' : '已停用')}</Text>
      <View style={styles.actions}>
        <View style={styles.action}><Button label={t('更新')} variant="secondary" disabled={busy} onPress={() => {
          setName(profile.name); setRegion(profile.region); setEditing(profile.key); setCredentials(empty); setNotice(''); setError('');
        }} /></View>
        <View style={styles.action}><Button label={t(profile.enabled ? '停用' : '啟用')} variant="secondary" disabled={busy}
          onPress={() => void action(() => repository.setEnabled(profile.key, !profile.enabled))} /></View>
        <View style={styles.action}><Button label={t('刪除')} variant="destructive" disabled={busy} onPress={() => remove(profile)} /></View>
      </View>
    </View>)}
    <Text style={styles.title}>{t(editing ? '更新 AWS 憑證' : '新增 AWS profile')}</Text>
    <Text style={styles.note}>{t('profile 名稱須與 kubeconfig 相同。')}</Text>
    <View style={styles.card}>
      <Text style={styles.label}>AWS profile</Text>
      <TextInput accessibilityLabel="AWS profile" value={name} onChangeText={setName} editable={!busy && !editing} autoCapitalize="none" autoCorrect={false} maxLength={128} style={styles.input} />
      <Text style={styles.label}>AWS Region</Text>
      <TextInput accessibilityLabel="AWS Region" value={region} onChangeText={setRegion} editable={!busy && !editing} autoCapitalize="none" autoCorrect={false} maxLength={40} style={styles.input} />
      {(['accessKeyId', 'secretAccessKey', 'sessionToken'] as const).map((key, index) => {
        const label = ['Access Key ID', 'Secret Access Key', 'Session Token'][index];
        return <View key={key}><Text style={styles.label}>{label}{key === 'sessionToken' ? t('（暫時憑證必填）') : ''}</Text>
          <TextInput accessibilityLabel={label} value={credentials[key]} onChangeText={value => setCredentials(current => ({ ...current, [key]: value }))}
            secureTextEntry autoCapitalize="none" autoCorrect={false} spellCheck={false} autoComplete="off" textContentType="none"
            editable={!busy} maxLength={key === 'sessionToken' ? 12000 : 256} style={styles.input} /></View>;
      })}
    </View>
    <Text style={styles.note}>{t('EKS token 自動更新；暫時 AWS 憑證過期後需重新輸入。')}</Text>
    <Button label={t(busy ? '驗證中…' : '驗證並儲存')} disabled={!ready || busy || !name.trim() || !region.trim() || !credentials.accessKeyId || !credentials.secretAccessKey} onPress={() => void save()} />
    {editing && <Button label={t('取消更新')} variant="secondary" disabled={busy} onPress={() => { setEditing(undefined); setCredentials(empty); setName(suggested?.name ?? 'default'); setRegion(suggested?.region ?? 'ap-northeast-1'); }} />}
    {!!error && <Text accessibilityRole="alert" style={styles.error}>{t(error)}</Text>}
    {!!notice && <Text accessibilityRole="alert" style={styles.note}>{t(notice)}</Text>}
  </ScrollView>;
}
const createStyles = (colors: ThemeColors) => StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background }, content: { padding: 20, paddingBottom: 40, gap: 14 },
  card: { backgroundColor: colors.panel, borderRadius: 16, padding: 16, gap: 10 },
  title: { color: colors.text, fontSize: 17, fontWeight: '600' }, label: { color: colors.text, fontSize: 14 },
  note: { color: colors.muted, fontSize: 14 }, error: { color: colors.danger, fontSize: 14 },
  input: { color: colors.text, minHeight: 48, fontSize: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  actions: { flexDirection: 'row', gap: 8 }, action: { flex: 1 },
});

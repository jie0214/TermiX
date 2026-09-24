import { useLanguage } from '../language/LanguageProvider';
import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme, useThemedStyles, type ThemeColors } from '../../components/theme';
import { Button } from '../../components/Button';
import { useHosts } from './HostProvider';
import { HostValidationError, type Host, type HostDraft } from './repository';
import { AuthenticationFields } from './AuthenticationFields';
import { CredentialValidationError, type Credentials } from './credentials';
import { pickPrivateKey } from '../../storage/privateKeyImport';

const fields = [
  { key: 'name', label: '名稱', placeholder: 'Home lab', maxLength: 80 },
  { key: 'address', label: '主機位址', placeholder: '192.0.2.10', maxLength: 253 },
  { key: 'username', label: '使用者名稱', placeholder: 'admin', maxLength: 128 },
  { key: 'folderPath', label: '資料夾（選填）', placeholder: '工作 / 正式環境', maxLength: 1295 },
  { key: 'port', label: '連接埠', placeholder: '22', maxLength: 5 },
] as const;
const validation = {
  folderPath: '資料夾最多 16 層，每層 80 字；請以 / 分隔。',
  name: '請填寫有效的名稱。', address: '請填寫主機名稱或 IP，不包含網址或空白。',
  username: '請填寫不含空白的使用者名稱。', port: '連接埠必須介於 1 至 65535。',
};

export function HostForm({ onSaved, onCancel, existing, initialFolder = [] }: { onSaved(): void; onCancel(): void; existing?: Host; initialFolder?: string[] }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { t } = useLanguage();
  const { add, configureAuthentication, loading, error: loadError } = useHosts();
  const [draft, setDraft] = useState<HostDraft>({ name: '', address: '', username: '', port: '22', folderPath: initialFolder });
  const [error, setError] = useState('');
  const [credentials, setCredentials] = useState<Credentials>({ type: 'password', password: '' });
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const submitting = useRef(false);
  const inputs = useRef<Partial<Record<keyof HostDraft, TextInput | null>>>({});
  const save = async () => {
    if (submitting.current || importing || loading || loadError) return;
    submitting.current = true;
    setSaving(true);
    setError('');
    try {
      if (existing) await configureAuthentication(existing, credentials); else await add(draft, credentials);
      onSaved();
    }
    catch (cause) {
      if (cause instanceof HostValidationError) {
        setError(validation[cause.field]);
        inputs.current[cause.field]?.focus();
      } else if (cause instanceof CredentialValidationError) { setError(cause.message); }
      else { setError('儲存失敗，內容已保留，請重試。'); }
    } finally { submitting.current = false; setSaving(false); }
  };
  return <KeyboardAvoidingView style={styles.page} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Pressable accessibilityRole="button" accessibilityLabel={t("返回主機")} onPress={onCancel}
        disabled={saving || importing} style={styles.back}>
        <Feather name="chevron-left" size={22} color={colors.accent} /><Text style={styles.backText}>{t("主機")}</Text>
      </Pressable>
      {existing && <View style={styles.field}><Text style={styles.label}>{existing.name}</Text><Text style={styles.label}>{existing.username}@{existing.address}:{existing.port}</Text></View>}
      {!existing && <View style={styles.fields}>{fields.map((field, index) => <View key={field.key} style={styles.field}>
        <Text style={styles.label}>{t(field.label)}</Text>
        <TextInput ref={input => { inputs.current[field.key] = input; }}
          accessibilityLabel={t(field.label)} value={field.key === 'folderPath' ? draft.folderPath?.join('/') ?? '' : draft[field.key]} placeholder={field.placeholder}
          placeholderTextColor={colors.muted} maxLength={field.maxLength} editable={!saving}
          onChangeText={value => setDraft(current => ({ ...current, [field.key]: field.key === 'folderPath' ? (value ? value.split('/') : []) : value }))}
          style={styles.input} autoCapitalize="none" autoCorrect={false}
          keyboardType={field.key === 'port' ? 'number-pad' : 'default'}
          returnKeyType={index === fields.length - 1 ? 'done' : 'next'}
          onSubmitEditing={() => index < fields.length - 1 ? inputs.current[fields[index + 1].key]?.focus() : void save()} />
      </View>)}</View>}
      <AuthenticationFields value={credentials} onChange={setCredentials} disabled={saving}
        pickPrivateKey={pickPrivateKey} onImportingChange={setImporting} />
      {!!(error || loadError) && <Text accessibilityRole="alert" style={styles.error}>{t(error || loadError)}</Text>}
      <View style={styles.save}><Button label={saving ? t("儲存中…") : t("儲存")} onPress={() => void save()}
        disabled={saving || importing || loading || !!loadError} /></View>
    </ScrollView>
  </KeyboardAvoidingView>;
}
const createStyles = (colors: ThemeColors) => StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background }, content: { padding: 20, paddingBottom: 32 },
  back: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', minHeight: 44, paddingRight: 16 },
  backText: { color: colors.accent, fontSize: 17 }, fields: { marginTop: 20, borderRadius: 18, overflow: 'hidden', backgroundColor: colors.panel }, field: { paddingHorizontal: 16, paddingTop: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  label: { fontSize: 14, color: colors.text, marginBottom: 8 },
  input: { minHeight: 48, backgroundColor: colors.panel, paddingVertical: 10, fontSize: 17, color: colors.text },
  error: { color: colors.danger, fontSize: 14, marginTop: 16 }, save: { marginTop: 24 },
});

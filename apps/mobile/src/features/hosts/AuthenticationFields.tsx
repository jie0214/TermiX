import { useLanguage } from '../language/LanguageProvider';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTheme, useThemedStyles, type ThemeColors } from '../../components/theme';
import { Button } from '../../components/Button';
import { normalizePrivateKey, type Credentials } from './credentials';

export function AuthenticationFields({ value, onChange, disabled, pickPrivateKey, onImportingChange }: {
  value: Credentials;
  onChange(value: Credentials): void;
  disabled: boolean;
  pickPrivateKey(): Promise<string | null>;
  onImportingChange(value: boolean): void;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { t } = useLanguage();
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const busy = disabled || importing;
  const importKey = async () => {
    setImporting(true);
    onImportingChange(true);
    setError('');
    try {
      const key = await pickPrivateKey();
      if (key !== null) onChange({ type: 'privateKey', privateKey: normalizePrivateKey(key), passphrase: '' });
    } catch { setError('無法匯入。請選擇 32 KB 以內的 OpenSSH 或 PEM 私鑰檔案。'); }
    finally { setImporting(false); onImportingChange(false); }
  };
  return <View style={styles.section}>
    <Text style={styles.label}>{t("驗證方式")}</Text>
    <View style={styles.options}>
      {([{ type: 'password', label: t("密碼") }, { type: 'privateKey', label: t("SSH 私鑰") }] as const).map(option =>
        <Pressable key={option.type} accessibilityRole="radio" accessibilityLabel={option.label}
          accessibilityState={{ checked: value.type === option.type, disabled: busy }} disabled={busy}
          onPress={() => {
            if (value.type === option.type) return;
            setError('');
            onChange(option.type === 'password' ? { type: 'password', password: '' } : { type: 'privateKey', privateKey: '', passphrase: '' });
          }} style={[styles.option, value.type === option.type && styles.selected]}>
          <Text style={{ color: value.type === option.type ? colors.accent : colors.text, fontSize: 16 }}>{option.label}</Text>
        </Pressable>)}
    </View>
    {value.type === 'password' ? <View style={styles.field}>
      <Text style={styles.label}>{t("登入密碼")}</Text>
      <TextInput accessibilityLabel={t("登入密碼")} secureTextEntry autoCapitalize="none" autoCorrect={false}
        textContentType="password" autoComplete="off" editable={!busy} style={styles.input}
        value={value.password} onChangeText={password => onChange({ type: 'password', password })} />
    </View> : <View style={styles.field}>
      <Button label={importing ? t("匯入中…") : t("匯入私鑰檔案")} disabled={busy} onPress={() => void importKey()} />
      {!!value.privateKey && <Text accessibilityRole="text" style={styles.status}>{t("私鑰已匯入")}</Text>}
      <Text style={[styles.label, styles.field]}>{t("私鑰密語（選填）")}</Text>
      <TextInput accessibilityLabel={t("私鑰密語（選填）")} secureTextEntry autoCapitalize="none" autoCorrect={false}
        textContentType="none" autoComplete="off" editable={!busy} style={styles.input}
        value={value.passphrase} onChangeText={passphrase => onChange({ ...value, passphrase })} />
    </View>}
    {!!error && <Text accessibilityRole="alert" style={styles.error}>{t(error)}</Text>}
  </View>;
}
const createStyles = (colors: ThemeColors) => StyleSheet.create({
  section: { marginTop: 24 }, label: { color: colors.text, fontSize: 14, marginBottom: 8 },
  options: { flexDirection: 'row', gap: 10 }, option: { flex: 1, minHeight: 48, borderWidth: 1, borderColor: colors.line,
    borderRadius: 12, backgroundColor: colors.panel, justifyContent: 'center', alignItems: 'center', padding: 12 },
  selected: { backgroundColor: colors.soft, borderColor: colors.accent }, field: { marginTop: 16 },
  input: { minHeight: 48, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line,
    borderRadius: 12, padding: 12, fontSize: 16, color: colors.text },
  status: { marginTop: 10, color: colors.muted, fontSize: 14 }, error: { marginTop: 12, color: colors.danger, fontSize: 14 },
});

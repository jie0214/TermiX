import { useLanguage } from '../language/LanguageProvider';
import { useState } from 'react';
import { Keyboard, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button } from '../../components/Button';
import { useThemedStyles, type ThemeColors } from '../../components/theme';
import { useCommands } from './CommandProvider';

export function CommandSettings() {
  const styles = useThemedStyles(createStyles);
  const { t } = useLanguage();
  const { items, busy, ready, error, reload, add, remove } = useCommands();
  const [name, setName] = useState(''); const [command, setCommand] = useState('');
  const [deleting, setDeleting] = useState<string>();
  const save = async () => {
    if (await add(name, command)) { setName(''); setCommand(''); Keyboard.dismiss(); }
  };
  return <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
    {!!error && <Text accessibilityRole="alert" style={styles.note}>{t(error)}</Text>}
    {!ready ? <Button label={busy ? t("載入中…") : t("重試")} disabled={busy} onPress={() => void reload()} /> : <>
      <TextInput accessibilityLabel={t("指令名稱")} placeholder={t("名稱")} value={name} onChangeText={setName} maxLength={80} editable={!busy} style={styles.input} />
      <TextInput accessibilityLabel={t("指令內容")} placeholder={t("單行指令")} value={command} onChangeText={setCommand} maxLength={4093} editable={!busy}
        autoCapitalize="none" autoCorrect={false} autoComplete="off" textContentType="none" style={styles.input} />
      <Button label={t("新增指令")} disabled={busy || !name.trim() || !command.trim()} onPress={() => void save()} />
      {!items.length && <Text style={styles.note}>{t("尚無常用指令")}</Text>}
      {items.map(item => <View key={item.id} style={styles.card}>
        <Text style={styles.name}>{item.name}</Text><Text selectable style={styles.command}>{item.command}</Text>
        {deleting === item.id ? <View style={styles.actions}>
          <Button variant="secondary" label={t("取消")} disabled={busy} onPress={() => setDeleting(undefined)} />
          <Button variant="destructive" label={t("確認刪除")} disabled={busy} onPress={() => { void remove(item.id).then(ok => { if (ok) setDeleting(undefined); }); }} />
        </View> : <Button variant="destructive" label={t('刪除{name}', { name: item.name })} disabled={busy} onPress={() => setDeleting(item.id)} />}
      </View>)}
    </>}
  </ScrollView>;
}
const createStyles = (colors: ThemeColors) => StyleSheet.create({
  page: { padding: 20, gap: 14 }, input: { minHeight: 48, borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: 12, fontSize: 16, color: colors.text, backgroundColor: colors.panel },
  card: { padding: 16, gap: 12, borderRadius: 14, backgroundColor: colors.panel }, actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  name: { fontSize: 16, fontWeight: '600', color: colors.text }, command: { fontSize: 14, color: colors.text }, note: { fontSize: 14, color: colors.muted },
});

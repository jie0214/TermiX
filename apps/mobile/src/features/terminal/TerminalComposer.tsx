import { useLanguage } from '../language/LanguageProvider';
import { useRef, useState } from 'react';
import { Keyboard, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '../../components/Button';
import { useThemedStyles, type ThemeColors } from '../../components/theme';
import { useCommands } from '../commands/CommandProvider';
import type { SavedCommand } from '../commands/repository';
import type { TerminalSession } from './session';

const controls = [
  { label: 'Ctrl+C', data: '\x03', discard: true }, { label: 'Ctrl+D', data: '\x04' },
  { label: 'Ctrl+L', data: '\x0c' }, { label: 'Esc', data: '\x1b' }, { label: 'Tab', data: '\t' },
  { label: '上', data: '\x1b[A' }, { label: '下', data: '\x1b[B' },
  { label: '左', data: '\x1b[D' }, { label: '右', data: '\x1b[C' },
];

export function TerminalComposer({ session }: { session: TerminalSession }) {
  const styles = useThemedStyles(createStyles);
  const { t } = useLanguage();
  const [input, setInput] = useState(''); const [sending, setSending] = useState(false);
  const [remoteInput, setRemoteInput] = useState(false);
  const [open, setOpen] = useState(false); const [replacement, setReplacement] = useState<SavedCommand>();
  const busy = useRef(false); const insets = useSafeAreaInsets();
  const commands = useCommands();
  const close = () => { setOpen(false); setReplacement(undefined); };
  const send = async (suffix = '\r', discard = false) => {
    if (busy.current) return false;
    busy.current = true; setSending(true);
    const submitted = input;
    const sent = await session.send(`${discard ? '' : submitted}${suffix}`);
    if (sent) {
      setInput(current => current === submitted ? '' : current);
      setRemoteInput(!discard && suffix !== '\r');
    }
    busy.current = false; setSending(false);
    return sent;
  };
  const insert = (item: SavedCommand) => { setInput(item.command); close(); };
  return <View style={styles.composer}>
    <Pressable accessibilityRole="button" accessibilityLabel={t("快捷鍵與常用指令")} accessibilityState={{ expanded: open }}
      style={styles.trigger} onPress={() => { Keyboard.dismiss(); setOpen(true); }}><Text style={styles.symbol}>⌘</Text></Pressable>
    <TextInput accessibilityLabel={t("終端輸入")} placeholder={t("輸入指令")} value={input} onChangeText={setInput}
      style={styles.input} autoCapitalize="none" autoCorrect={false} spellCheck={false} autoComplete="off" textContentType="none" maxLength={4093}
      returnKeyType="send" submitBehavior="submit" onSubmitEditing={() => void send()} />
    <Button label={t("送出")} disabled={sending} onPress={() => void send()} />
    <Modal visible={open} transparent animationType="slide" onRequestClose={close}>
      <View style={styles.overlay}>
        <Pressable accessibilityRole="button" accessibilityLabel={t("關閉快捷面板背景")} style={StyleSheet.absoluteFill} onPress={close} />
        <View accessibilityViewIsModal style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <Button variant="secondary" label={t("關閉快捷面板")} onPress={close} />
            {replacement ? <>
              <Text style={styles.title}>{remoteInput ? t("先傳送 Ctrl+C，再填入指令？") : t("取代目前輸入？")}</Text>
              <Button variant="secondary" label={t("取消取代")} onPress={() => setReplacement(undefined)} />
              <Button label={remoteInput ? t("傳送 Ctrl+C 並填入") : t("取代輸入")} disabled={sending} onPress={() => {
                if (remoteInput) void send('\x03', true).then(ok => { if (ok) insert(replacement); });
                else insert(replacement);
              }} />
            </> : <>
              <Text style={styles.title}>{t("快捷鍵")}</Text>
              <View style={styles.keys}>{controls.map(control => <Button key={t(control.label)} label={t(control.label)} disabled={sending}
                onPress={() => void send(control.data, control.discard)} />)}</View>
              <Text style={styles.title}>{t("常用指令")}</Text>
              <Text style={styles.hint}>{t("選取後填入，按送出執行")}</Text>
              {!!commands.error && <Text accessibilityRole="alert" style={styles.hint}>{t(commands.error)}</Text>}
              {!commands.ready ? <Button label={commands.busy ? t("載入中…") : t("重試")} disabled={commands.busy} onPress={() => void commands.reload()} /> :
                commands.items.length ? commands.items.map(item => <Button key={item.id} label={item.name} disabled={sending}
                  onPress={() => { if (input || remoteInput) setReplacement(item); else insert(item); }} />) : <Text style={styles.hint}>{t("在設定新增 SSH 常用指令")}</Text>}
            </>}
          </ScrollView>
        </View>
      </View>
    </Modal>
  </View>;
}
const createStyles = (colors: ThemeColors) => StyleSheet.create({
  composer: { flexDirection: 'row', gap: 8, padding: 10, backgroundColor: colors.panel, alignItems: 'center' },
  trigger: { width: 48, minHeight: 48, borderRadius: 12, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  symbol: { fontSize: 24, color: colors.accent }, input: { flex: 1, minWidth: 0, minHeight: 48, padding: 12, borderWidth: 1, borderColor: colors.line, borderRadius: 12, fontSize: 16, color: colors.text },
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#0006' }, sheet: { maxHeight: '80%', borderTopLeftRadius: 22, borderTopRightRadius: 22, backgroundColor: colors.panel },
  content: { padding: 20, gap: 12 }, title: { color: colors.text, fontSize: 16, fontWeight: '600' }, hint: { color: colors.muted, fontSize: 14 },
  keys: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});

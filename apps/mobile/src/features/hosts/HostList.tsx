import { useLanguage } from '../language/LanguageProvider';
import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme, useThemedStyles, type ThemeColors } from '../../components/theme';
import { Button } from '../../components/Button';
import type { Host } from './repository';
import { useHosts } from './HostProvider';

export function HostList({ onAdd, onConnect }: { onAdd(folderPath: string[]): void; onConnect?(host: Host): void }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { t } = useLanguage();
  const { hosts, loading, error, reload } = useHosts();
  const [query, setQuery] = useState('');
  const [path, setPath] = useState<string[]>([]);
  const search = query.trim().toLocaleLowerCase();
  const inFolder = (host: Host) => path.every((part, index) => host.folderPath?.[index] === part);
  const folders = [...new Set(hosts.filter(inFolder).map(host => host.folderPath?.[path.length]).filter((name): name is string => !!name))].sort((a, b) => a.localeCompare(b));
  const visible = search ? hosts.filter(host => [host.name, host.address, host.username, ...(host.folderPath ?? [])].some(value => value.toLocaleLowerCase().includes(search))) : hosts.filter(host => inFolder(host) && (host.folderPath?.length ?? 0) === path.length);
  type Row = { key: string; folder: string } | { key: string; host: Host };
  const rows: Row[] = [...(search ? [] : folders.map(folder => ({ key: `folder:${folder}`, folder }))), ...visible.map(host => ({ key: `host:${host.id}`, host }))];
  return <View style={styles.page}>
    <View style={styles.search}>
      <Feather name="search" size={19} color={colors.muted} />
      <TextInput accessibilityLabel={t('搜尋主機')} placeholder={t('搜尋主機')} placeholderTextColor={colors.muted}
        value={query} onChangeText={setQuery} autoCorrect={false} autoCapitalize="none" style={styles.searchInput} />
      {!!query && <Pressable accessibilityRole="button" accessibilityLabel={t('清除搜尋')} onPress={() => setQuery('')} style={styles.clear}>
        <Feather name="x-circle" size={19} color={colors.muted} /></Pressable>}
    </View>
    {!search && path.length > 0 && <View style={styles.navigation}>
      <Pressable accessibilityRole="button" accessibilityLabel={t('上一層')} onPress={() => setPath(current => current.slice(0, -1))} style={styles.back}>
        <Feather name="chevron-left" size={21} color={colors.accent} /><Text style={styles.backText}>{t('上一層')}</Text></Pressable>
      <Text numberOfLines={1} style={styles.path}>{path.join(' / ')}</Text>
    </View>}
    {loading ? <ActivityIndicator accessibilityLabel={t("讀取主機")} color={colors.accent} style={styles.empty} /> :
      error ? <View style={styles.empty}><Text accessibilityRole="alert" style={styles.message}>{t(error)}</Text>
        <Button label={t("重試")} onPress={() => void reload()} /></View> :
      <FlatList data={rows} keyExtractor={row => row.key} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={styles.list}
        ListEmptyComponent={<View style={styles.empty}><Feather name="server" size={32} color={colors.muted} />
          <Text style={styles.message}>{t(search ? '找不到主機' : '尚無主機')}</Text></View>}
        renderItem={({ item: row }) => {
          if ('folder' in row) return <Pressable accessibilityRole="button" accessibilityLabel={t('開啟資料夾 {name}', { name: row.folder })}
            style={styles.row} onPress={() => setPath(current => [...current, row.folder])}>
            <View style={styles.symbol}><Feather name="folder" size={21} color={colors.accent} /></View>
            <Text style={[styles.name, styles.details]}>{row.folder}</Text><Feather name="chevron-right" size={19} color={colors.muted} />
          </Pressable>;
          const item = row.host;
          return <Pressable style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.soft }]} accessible accessibilityRole="button" onPress={() => onConnect?.(item)}
          accessibilityLabel={t('{name}，{user}@{address}，連接埠 {port}', { name: item.name, user: item.username, address: item.address, port: item.port })}>
          <View style={styles.symbol}><Feather name="server" size={21} color={colors.accent} /></View>
          <View style={styles.details}><Text style={styles.name}>{item.name}</Text>
            <Text selectable style={styles.meta}>{item.username}@{item.address}{item.port === 22 ? '' : ` · ${item.port}`}</Text>
            {search && !!item.folderPath?.length && <Text numberOfLines={1} style={styles.meta}>{item.folderPath.join(' / ')}</Text>}
            <Text style={styles.meta}>{item.authType === 'password' ? t("密碼") : item.authType === 'privateKey' ? t("SSH 私鑰") : t("尚未設定驗證方式")}</Text>
          </View>
          <Feather name="chevron-right" size={19} color={colors.muted} />
        </Pressable>; }} />}
    <Pressable accessibilityRole="button" accessibilityLabel={t("新增主機")} disabled={loading || !!error}
      accessibilityState={{ disabled: loading || !!error }} onPress={() => onAdd(search ? [] : path)}
      style={({ pressed }) => [styles.fab, { opacity: loading || error ? 0.5 : pressed ? 0.8 : 1 }]}>
      <Feather name="plus" size={27} color="#fff" />
    </Pressable>
  </View>;
}
const createStyles = (colors: ThemeColors) => StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background }, list: { padding: 20, paddingBottom: 100, flexGrow: 1 },
  search: { marginHorizontal: 20, marginTop: 12, flexDirection: 'row', alignItems: 'center', paddingLeft: 12, borderRadius: 12, backgroundColor: colors.panel },
  searchInput: { flex: 1, minWidth: 0, minHeight: 48, paddingHorizontal: 10, color: colors.text, fontSize: 16 },
  clear: { padding: 12 }, navigation: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, gap: 8 },
  back: { flexDirection: 'row', alignItems: 'center', minHeight: 44 }, backText: { color: colors.accent, fontSize: 16 },
  path: { flex: 1, color: colors.muted, fontSize: 14 },
  empty: { alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16, flex: 1 },
  message: { color: colors.muted, fontSize: 16, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 13, padding: 16, borderRadius: 18, backgroundColor: colors.panel, marginBottom: 10 },
  symbol: { width: 42, height: 42, borderRadius: 13, backgroundColor: colors.soft, alignItems: 'center', justifyContent: 'center' },
  details: { flex: 1, minWidth: 0 }, name: { color: colors.text, fontSize: 17, fontWeight: '600' },
  meta: { color: colors.muted, fontSize: 13, marginTop: 4 },
  fab: { position: 'absolute', right: 20, bottom: 20, width: 56, height: 56, borderRadius: 28,
    backgroundColor: colors.button, alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.18, shadowOffset: { width: 0, height: 5 }, shadowRadius: 9, elevation: 5 },
});

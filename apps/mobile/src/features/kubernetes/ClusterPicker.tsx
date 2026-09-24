import { useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SettingsRow } from '../../components/SettingsList';
import { Button } from '../../components/Button';
import { useTheme, useThemedStyles, type ThemeColors } from '../../components/theme';
import { useLanguage } from '../language/LanguageProvider';
import { useKubernetes } from './KubernetesProvider';
import { kubeMessage } from './workspace';
export function ClusterPicker({ presentation = 'button' }: { presentation?: 'button' | 'row' }) {
  const { colors } = useTheme(); const styles = useThemedStyles(createStyles); const { t } = useLanguage();
  const { workspace, state } = useKubernetes(); const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false); const [query, setQuery] = useState('');
  const profile = state.profile;
  if (!profile) return null;
  const contexts = profile.contexts ?? [profile];
  const search = query.trim().toLocaleLowerCase();
  const items = contexts.filter(item => [item.cluster, item.context, item.eks?.profile ?? ''].some(value => value.toLocaleLowerCase().includes(search)));
  return <>
    {presentation === 'row' ? <SettingsRow label={t('叢集')} value={profile.cluster || profile.context} disabled={state.configBusy || state.scale?.status === 'submitting'} onPress={() => {setQuery('');setOpen(true);}}/> : <Pressable accessibilityRole="button" accessibilityLabel={t('選擇叢集')} disabled={state.configBusy || state.scale?.status === 'submitting'}
      style={styles.selected} onPress={() => { setQuery(''); setOpen(true); }}>
      <View style={{ flex: 1 }}><Text numberOfLines={2} style={styles.title}>{profile.cluster || profile.context}</Text>
        {profile.context !== profile.cluster && <Text numberOfLines={1} style={styles.note}>{profile.context}</Text>}</View>
      <Feather name="chevron-down" size={20} color={colors.accent} />
    </Pressable>}
    {!!profile.issue && <Text accessibilityRole="alert" style={styles.error}>{t(kubeMessage(new Error(profile.issue)))}</Text>}
    <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setOpen(false)}>
      <View style={[styles.page, { paddingTop: Math.max(insets.top, 16), paddingBottom: Math.max(insets.bottom, 16) }]}>
        <View style={styles.header}><Text style={styles.title}>{t('選擇叢集')}</Text><Button variant="secondary" label={t('關閉')} onPress={() => setOpen(false)} /></View>
        <TextInput accessibilityLabel={t('搜尋叢集')} placeholder={t('搜尋叢集')} placeholderTextColor={colors.muted}
          value={query} onChangeText={setQuery} autoCapitalize="none" autoCorrect={false} style={styles.search} />
        <FlatList data={items} keyExtractor={item => item.context} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
          contentContainerStyle={styles.list} ListEmptyComponent={<Text style={styles.note}>{t('找不到叢集')}</Text>}
          renderItem={({ item }) => <Pressable accessibilityRole="radio" accessibilityLabel={`${item.cluster} · ${item.context}`}
            accessibilityState={{ checked: item.context === profile.context }} style={styles.row} onPress={() => {
              setOpen(false); if (item.context !== profile.context) void workspace.selectContext(item.context);
            }}>
            <View style={{ flex: 1 }}><Text style={styles.title}>{item.cluster || item.context}</Text>
              {item.context !== item.cluster && <Text style={styles.note}>{item.context}</Text>}
              {!!item.eks && <Text style={styles.note}>AWS · {item.eks.profile}</Text>}
              {!!item.issue && <Text style={styles.error}>{t('驗證設定未支援或無效')}</Text>}
            </View>
            {item.context === profile.context && <Feather name="check" size={20} color={colors.accent} />}
          </Pressable>} />
      </View>
    </Modal>
  </>;
}
const createStyles = (colors: ThemeColors) => StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background }, header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20 },
  selected: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: 16, backgroundColor: colors.panel, minHeight: 56 },
  title: { color: colors.text, fontSize: 16, fontWeight: '600' }, note: { color: colors.muted, fontSize: 13, marginTop: 5 }, error: { color: colors.danger, fontSize: 13, marginTop: 5 },
  search: { margin: 20, minHeight: 48, borderRadius: 12, paddingHorizontal: 14, backgroundColor: colors.panel, color: colors.text, fontSize: 16 },
  list: { paddingHorizontal: 20, paddingBottom: 24, gap: 10 }, row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, backgroundColor: colors.panel, borderRadius: 16 },
});

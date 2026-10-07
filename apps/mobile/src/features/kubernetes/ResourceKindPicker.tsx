import { KubernetesModal } from './KubernetesModal';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Button } from '../../components/Button';
import { useTheme, useThemedStyles, type ThemeColors } from '../../components/theme';
import { useLanguage } from '../language/LanguageProvider';
import { useKubernetes } from './KubernetesProvider';
import { resourceGroups, resourceLabels } from './workspace';

export function ResourceKindPicker() {
  const { state, workspace } = useKubernetes();
  const { t } = useLanguage();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  const { width, fontScale } = useWindowDimensions();
  const [open, setOpen] = useState(false);
  const groups = Object.keys(resourceGroups);
  const group = groups.find(key => resourceGroups[key].includes(state.kind))!;
  const columns = width < 360 || fontScale > 1.2 ? 2 : 3;
  const rows = Array.from({ length: Math.ceil(groups.length / columns) }, (_, index) => groups.slice(index * columns, (index + 1) * columns));

  return <>
    <View style={styles.card}>
      <View style={styles.groups}>
        {rows.map((row, index) => <View key={index} style={styles.groupRow}>
          {row.map(key => <Pressable key={key} accessibilityRole="radio" accessibilityLabel={key} accessibilityState={{ checked: group === key }}
            style={({ pressed }) => [styles.group, group === key && styles.selected, pressed && styles.pressed]}
            onPress={() => { setOpen(false); if (group !== key) workspace.setKind(resourceGroups[key][0]); }}>
            <Text style={[styles.groupText, group === key && styles.active]}>{key}</Text>
          </Pressable>)}
        </View>)}
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={t('選擇資源類型')} accessibilityValue={{ text: resourceLabels[state.kind] }} accessibilityState={{ expanded: open }}
        onPress={() => setOpen(true)} style={({ pressed }) => [styles.picker, pressed && styles.pressed]}>
        <Feather name="layers" size={18} color={colors.muted}/>
        <Text style={styles.value}>{resourceLabels[state.kind]}</Text>
        <Feather name="chevron-down" size={18} color={colors.muted}/>
      </Pressable>
    </View>
    <KubernetesModal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
      <View style={[styles.page, { paddingTop: 20, paddingBottom: 20 }]}>
        <View style={styles.header}>
          <Text style={styles.title}>{group}</Text>
          <Button label={t('關閉選單')} variant="secondary" onPress={() => setOpen(false)}/>
        </View>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.options}>
            {resourceGroups[group].map((kind, index) => <Pressable key={kind} accessibilityRole="radio" accessibilityLabel={resourceLabels[kind]} accessibilityState={{ checked: state.kind === kind }}
              style={({ pressed }) => [styles.option, index > 0 && styles.separator, pressed && styles.pressed]}
              onPress={() => { setOpen(false); workspace.setKind(kind); }}>
              <Text style={[styles.value, state.kind === kind && { color: colors.accent }]}>{resourceLabels[kind]}</Text>
              <View style={styles.check}>{state.kind === kind && <Feather name="check" size={18} color={colors.accent}/>}</View>
            </Pressable>)}
          </View>
        </ScrollView>
      </View>
    </KubernetesModal>
  </>;
}

const createStyles = (c: ThemeColors) => StyleSheet.create({
  card: { backgroundColor: c.panel, borderRadius: 14, overflow: 'hidden' },
  groups: { padding: 6, gap: 4 },
  groupRow: { flexDirection: 'row', gap: 4 },
  group: { flex: 1, minWidth: 0, minHeight: 44, paddingHorizontal: 4, paddingVertical: 10, alignItems: 'center', justifyContent: 'center', borderRadius: 9 },
  groupText: { color: c.muted, fontSize: 12, fontWeight: '600', textAlign: 'center' },
  selected: { backgroundColor: c.button },
  active: { color: c.onButton },
  pressed: { opacity: 0.65 },
  picker: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingHorizontal: 14, paddingVertical: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line },
  value: { flex: 1, minWidth: 0, color: c.text, fontSize: 16, fontWeight: '500' },
  page: { flex: 1, backgroundColor: c.background, paddingHorizontal: 20 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16, paddingBottom: 20 },
  title: { flex: 1, color: c.text, fontSize: 20, fontWeight: '700' },
  content: { paddingBottom: 20 },
  options: { borderRadius: 14, backgroundColor: c.panel, overflow: 'hidden' },
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingHorizontal: 16, paddingVertical: 16 },
  separator: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line },
  check: { width: 20, alignItems: 'center' },
});

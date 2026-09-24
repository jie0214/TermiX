import type { ComponentProps, ReactNode } from 'react';
import { Feather } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme, useThemedStyles, type ThemeColors } from './theme';

export function SettingsGroup({ children }: { children: ReactNode }) {
  const styles = useThemedStyles(createStyles);
  return <View style={styles.group}>{children}</View>;
}
export function SettingsRow({ label, value, icon, onPress, disabled = false, checked, last = false }: {
  label: string; value?: string; icon?: ComponentProps<typeof Feather>['name']; onPress(): void;
  disabled?: boolean; checked?: boolean; last?: boolean;
}) {
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  return <Pressable accessibilityRole={checked === undefined ? 'button' : 'radio'}
    accessibilityLabel={value ? `${label} · ${value}` : label}
    accessibilityState={{ disabled, ...(checked === undefined ? {} : { checked }) }}
    disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.pressed, disabled && styles.disabled]}>
    {icon && <View style={styles.icon} accessible={false}><Feather name={icon} size={20} color={colors.accent} /></View>}
    <View style={[styles.body, !last && styles.separator]}>
      <View style={styles.words}><Text style={styles.label}>{label}</Text>{!!value && <Text style={styles.value}>{value}</Text>}</View>
      {checked === undefined ? <Feather name="chevron-right" size={18} color={colors.muted} /> :
        <View style={styles.check}>{checked && <Feather name="check" size={20} color={colors.accent} />}</View>}
    </View>
  </Pressable>;
}
const createStyles = (colors: ThemeColors) => StyleSheet.create({
  group: { borderRadius: 18, overflow: 'hidden', backgroundColor: colors.panel },
  row: { flexDirection: 'row', alignItems: 'center', paddingLeft: 16, minHeight: 56 },
  pressed: { backgroundColor: colors.soft }, disabled: { opacity: 0.5 },
  icon: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.soft, marginRight: 12 },
  body: { flex: 1, minWidth: 0, minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 14, paddingRight: 16 },
  separator: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  words: { flex: 1, minWidth: 0, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', columnGap: 12, rowGap: 4 },
  label: { color: colors.text, fontSize: 17, flexShrink: 1 }, value: { color: colors.muted, fontSize: 15, flexShrink: 1 },
  check: { width: 22, alignItems: 'center' },
});

import { Feather } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme, useThemedStyles, type ThemeColors } from './theme';
export function NavigationHeader({ title, backLabel, onBack, disabled = false }: {
  title: string; backLabel: string; onBack(): void; disabled?: boolean;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  return <View style={styles.header}>
    <Pressable accessibilityRole="button" accessibilityLabel={backLabel} accessibilityState={{ disabled }}
      onPress={onBack} disabled={disabled} style={({ pressed }) => [styles.back, { opacity: disabled ? 0.5 : pressed ? 0.6 : 1 }]}>
      <Feather name="chevron-left" size={24} color={colors.accent} /><Text style={styles.backText}>{backLabel}</Text>
    </Pressable>
    <Text accessibilityRole="header" style={styles.title}>{title}</Text>
  </View>;
}
const createStyles = (colors: ThemeColors) => StyleSheet.create({
  header: { paddingBottom: 8, gap: 8 }, back: { minHeight: 44, flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', paddingRight: 12 },
  backText: { color: colors.accent, fontSize: 17, flexShrink: 1 }, title: { color: colors.text, fontSize: 28, fontWeight: '700', letterSpacing: -0.4 },
});

import { Pressable, StyleSheet, Text } from 'react-native';
import { useThemedStyles, type ThemeColors } from './theme';

export function Button({ label, onPress, disabled = false, variant = 'primary' }: {
  label: string; onPress: () => void; disabled?: boolean; variant?: 'primary' | 'secondary' | 'destructive';
}) {
  const styles = useThemedStyles(createStyles);
  return <Pressable accessibilityRole="button" accessibilityLabel={label}
    accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.button, variant !== 'primary' && styles.secondary, { opacity: disabled ? 0.5 : pressed ? 0.8 : 1 }]}>
    <Text style={[styles.text, variant === 'secondary' && styles.secondaryText, variant === 'destructive' && styles.destructiveText]}>{label}</Text>
  </Pressable>;
}
const createStyles = (colors: ThemeColors) => StyleSheet.create({
  button: { minHeight: 48, backgroundColor: colors.button, padding: 14, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
  secondary: { backgroundColor: colors.soft }, secondaryText: { color: colors.accent }, destructiveText: { color: colors.danger },
  text: { color: colors.onButton, fontSize: 17, fontWeight: '600' },
});

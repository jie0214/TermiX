import { useLanguage } from '../features/language/LanguageProvider';
import { StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { useTheme, useThemedStyles, type ThemeColors } from './theme';
export function Unavailable({ icon, message }: { icon: ComponentProps<typeof Feather>['name']; message: string }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { t } = useLanguage();
  return <View style={styles.page}>
    <Feather name={icon} size={32} color={colors.muted} /><Text style={styles.message}>{t(message)}</Text>
  </View>;
}
const createStyles = (colors: ThemeColors) => StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 16 },
  message: { color: colors.muted, fontSize: 16, textAlign: 'center' },
});

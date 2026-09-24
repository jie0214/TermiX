import { useLanguage } from '../../features/language/LanguageProvider';
import { Feather } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { useTheme } from '../../components/theme';

export default function TabLayout() {
  const { colors } = useTheme();
  const { t } = useLanguage();
  return <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: colors.accent,
    tabBarInactiveTintColor: colors.muted, tabBarStyle: { backgroundColor: colors.panel, borderTopColor: colors.line },
    tabBarHideOnKeyboard: true }}>
    <Tabs.Screen name="index" options={{ title: t("主機"), tabBarIcon: ({ color, size }) => <Feather name="server" color={color} size={size} /> }} />
    <Tabs.Screen name="terminal" options={{ title: t("終端"), tabBarIcon: ({ color, size }) => <Feather name="terminal" color={color} size={size} /> }} />
    <Tabs.Screen name="kubernetes" options={{ title: 'Kubernetes', tabBarIcon: ({ color, size }) => <Feather name="box" color={color} size={size} /> }} />
    <Tabs.Screen name="settings" options={{ title: t("設定"), tabBarIcon: ({ color, size }) => <Feather name="settings" color={color} size={size} /> }} />
  </Tabs>;
}

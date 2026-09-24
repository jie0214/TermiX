import { AppearanceProvider } from '../features/appearance/AppearanceProvider';
import { appearanceStore } from '../storage/appearance';
import { LanguageProvider } from '../features/language/LanguageProvider';
import { languageStore } from '../storage/language';
import { SyncLifecycle } from '../features/sync/SyncLifecycle';
import { syncWorkspace } from '../storage/sync';
import { KubernetesProvider } from '../features/kubernetes/KubernetesProvider';
import { kubernetesWorkspace } from '../storage/kubernetes';
import { CommandProvider } from '../features/commands/CommandProvider';
import { commandRepository } from '../storage/commands';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { HostProvider } from '../features/hosts/HostProvider';
import { hostRepository } from '../storage/hosts';
import { TerminalProvider } from '../features/terminal/TerminalProvider';
import { terminalSession } from '../storage/terminal';
import { useTheme } from '../components/theme';

export default function RootLayout() {
  return <AppearanceProvider store={appearanceStore}><AppLayout /></AppearanceProvider>;
}
function AppLayout() {
  const { colors, dark } = useTheme();
  return <LanguageProvider store={languageStore}><KubernetesProvider workspace={kubernetesWorkspace}><HostProvider repository={hostRepository}>
    <CommandProvider repository={commandRepository}><TerminalProvider session={terminalSession}><SafeAreaView edges={['top', 'left', 'right']} style={{ flex: 1, backgroundColor: colors.background }}>
      <SyncLifecycle workspace={syncWorkspace} />
      <StatusBar style={dark ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="hosts/new" options={{ gestureEnabled: false }} />
        <Stack.Screen name="hosts/authentication" options={{ gestureEnabled: false }} />
      </Stack>
    </SafeAreaView></TerminalProvider></CommandProvider>
  </HostProvider></KubernetesProvider></LanguageProvider>;
}

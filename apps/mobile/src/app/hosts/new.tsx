import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { HostForm } from '../../features/hosts/HostForm';
export default function NewHost() {
  const { folder } = useLocalSearchParams<{ folder?: string }>();
  let initialFolder: string[] = [];
  try { const value = JSON.parse(folder ?? '[]'); if (Array.isArray(value) && value.every(part => typeof part === 'string')) initialFolder = value; } catch { /* 無效路由參數使用根目錄。 */ }
  const back = () => router.canGoBack() ? router.back() : router.replace('/');
  return <SafeAreaView edges={['bottom']} style={{ flex: 1 }}>
    <HostForm initialFolder={initialFolder} onSaved={back} onCancel={back} />
  </SafeAreaView>;
}

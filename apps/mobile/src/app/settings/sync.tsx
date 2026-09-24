import { router } from 'expo-router';
import { SyncSettings } from '../../features/sync/SyncSettings';
import { syncWorkspace } from '../../storage/sync';
import { pickMobileSettings } from '../../storage/mobileSettingsImport';
export default function SyncSettingsRoute() {
  return <SyncSettings workspace={syncWorkspace} pickFile={pickMobileSettings} onBack={() => router.back()} />;
}

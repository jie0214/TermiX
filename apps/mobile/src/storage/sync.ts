import Storage from 'expo-sqlite/kv-store';
import { requireNativeModule } from 'expo';
import { Platform } from 'react-native';
import { hostRepository } from './hosts';
import { terminalSession } from './terminal';
import { SyncWorkspace, type CloudResult, type SyncCapability } from '../features/sync/workspace';

function cloudCapability(): SyncCapability {
  if (Platform.OS !== 'ios') return 'unsupported';
  try { return requireNativeModule<{ mobileSyncCapability(): SyncCapability }>('TermixSSH').mobileSyncCapability(); }
  catch { return 'not_configured'; }
}

export const syncWorkspace = new SyncWorkspace(Storage, hostRepository, async () => {
  if (Platform.OS !== 'ios') return { status: 'unsupported' };
  return requireNativeModule<{ fetchMobileSettings(): Promise<CloudResult> }>('TermixSSH').fetchMobileSettings();
}, () => !['connecting', 'trust', 'connected', 'closing'].includes(terminalSession.getSnapshot().status), cloudCapability());

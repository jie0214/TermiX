import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useHosts } from '../hosts/HostProvider';
import type { SyncWorkspace } from './workspace';
export function SyncLifecycle({ workspace }: { workspace: SyncWorkspace }) {
  const { reload } = useHosts();
  useEffect(() => {
    workspace.setOnApplied(reload);
    workspace.setActive(AppState.currentState === 'active');
    void workspace.initialize().then(() => workspace.refresh());
    const timer = setInterval(() => { void workspace.refresh(); }, 30_000);
    const subscription = AppState.addEventListener('change', state => {
      workspace.setActive(state === 'active');
      if (state === 'active') void workspace.refresh();
    });
    return () => { clearInterval(timer); subscription.remove(); workspace.setActive(false); workspace.setOnApplied(async () => {}); };
  }, [workspace, reload]);
  return null;
}

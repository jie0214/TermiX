import { createContext, useContext, useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { KubernetesWorkspace } from './workspace';

const Context = createContext<KubernetesWorkspace | null>(null);
export function KubernetesProvider({ workspace, children }: { workspace: KubernetesWorkspace; children: ReactNode }) {
  useEffect(() => { void workspace.load(); }, [workspace]);
  return <Context.Provider value={workspace}>{children}</Context.Provider>;
}
export function useKubernetes() {
  const workspace = useContext(Context);
  if (!workspace) throw new Error('缺少 KubernetesProvider');
  return { workspace, state: useSyncExternalStore(workspace.subscribe, workspace.getSnapshot) };
}

import { createContext, useContext, useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { AppState } from 'react-native';
import type { TerminalSession } from './session';

const Context = createContext<TerminalSession | null>(null);
export function TerminalProvider({ session, children }: { session: TerminalSession; children: ReactNode }) {
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'background') void session.disconnect('App 已進入背景，連線已中斷。');
    });
    return () => { subscription.remove(); void session.disconnect(); };
  }, [session]);
  return <Context.Provider value={session}>{children}</Context.Provider>;
}
export function useTerminal() {
  const session = useContext(Context);
  if (!session) throw new Error('缺少 TerminalProvider');
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  return { session, state };
}

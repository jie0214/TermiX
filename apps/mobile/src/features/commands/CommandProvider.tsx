import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { CommandRepository, SavedCommand } from './repository';

type Commands = {
  items: SavedCommand[]; busy: boolean; error: string; ready: boolean;
  reload: () => Promise<boolean>; add: (name: string, command: string) => Promise<boolean>; remove: (id: string) => Promise<boolean>;
};
const Context = createContext<Commands | null>(null);
export function CommandProvider({ repository, children }: { repository: CommandRepository; children: ReactNode }) {
  const [items, setItems] = useState<SavedCommand[]>([]);
  const [busy, setBusy] = useState(true); const [error, setError] = useState(''); const [ready, setReady] = useState(false);
  const pending = useRef(false);
  const settle = useCallback((operation: () => Promise<SavedCommand[]>, message: string, isActive: () => boolean = () => true) => {
    return operation().then(next => {
      if (isActive()) { setItems(next); setReady(true); setError(''); }
      return true;
    }).catch(() => { if (isActive()) setError(message); return false;
    }).finally(() => { if (isActive()) { pending.current = false; setBusy(false); } });
  }, []);
  const run = (operation: () => Promise<SavedCommand[]>, message: string) => {
    if (pending.current) return Promise.resolve(false);
    pending.current = true; setBusy(true); setError('');
    return settle(operation, message);
  };
  const reload = () => run(() => repository.list(), '無法讀取常用指令，請重試。');
  useEffect(() => {
    let active = true;
    pending.current = true;
    void settle(() => repository.list(), '無法讀取常用指令，請重試。', () => active);
    return () => { active = false; };
  }, [repository, settle]);
  return <Context.Provider value={{ items, busy, error, ready, reload,
    add: (name, command) => run(() => repository.add(name, command), '無法新增，請檢查名稱、單行指令與容量後重試。'),
    remove: id => run(() => repository.remove(id), '刪除未保存，請重試。'),
  }}>{children}</Context.Provider>;
}
export function useCommands() {
  const value = useContext(Context);
  if (!value) throw new Error('缺少 CommandProvider');
  return value;
}

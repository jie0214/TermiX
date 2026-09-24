import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { HostRepository, type Host, type HostDraft } from './repository';
import type { Credentials } from './credentials';

interface HostState {
  hosts: Host[];
  loading: boolean;
  error: string;
  reload(): Promise<void>;
  add(draft: HostDraft, credentials: Credentials): Promise<void>;
  configureAuthentication(host: Host, credentials: Credentials): Promise<void>;
}
const Context = createContext<HostState | null>(null);

export function HostProvider({ repository, children }: { repository: HostRepository; children: ReactNode }) {
  const [hosts, setHosts] = useState<Host[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const readEpoch = useRef(0);
  const read = useCallback((isActive: () => boolean) => {
    const epoch = ++readEpoch.current;
    const current = () => isActive() && epoch === readEpoch.current;
    return repository.list().then(data => {
      if (current()) { setHosts(data); setError(''); }
    }).catch(() => {
      if (current()) setError('無法讀取主機資料。原始資料已保留，請重試。');
    }).finally(() => { if (current()) setLoading(false); });
  }, [repository]);
  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    await read(() => true);
  }, [read]);
  useEffect(() => {
    let active = true;
    void read(() => active);
    return () => { active = false; };
  }, [read]);
  const add = async (draft: HostDraft, credentials: Credentials) => {
    await repository.add(draft, credentials);
    await reload();
  };
  const configureAuthentication = async (host: Host, credentials: Credentials) => {
    await repository.configureAuthentication(host, credentials); await reload();
  };
  return <Context.Provider value={{ hosts, loading, error, reload, add, configureAuthentication }}>{children}</Context.Provider>;
}

export function useHosts() {
  const state = useContext(Context);
  if (!state) throw new Error('主機功能缺少 HostProvider');
  return state;
}

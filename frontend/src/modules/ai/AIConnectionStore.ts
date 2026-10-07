import { t } from '../../i18n/index.ts';
import { createStore } from 'zustand/vanilla';
import { AIConnectionAPI } from './AIConnectionAPI.ts';
import type { AIClient, AIConnection } from './types.ts';

export const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

interface ConnectionState {
  connections: AIConnection[];
  loading: boolean;
  loaded: boolean;
  error: string;
  pending: Record<string, boolean>;
  status: Record<string, string>;
  errors: Record<string, string>;
  refresh(): Promise<void>;
  toggle(id: string): Promise<void>;
  test(id: string): Promise<void>;
}

export function createAIConnectionStore(api: AIClient = AIConnectionAPI) {
  let refreshRequest: Promise<void> | null = null;
  return createStore<ConnectionState>((set, get) => ({
    connections: [], loading: false, loaded: false, error: '', pending: {}, status: {}, errors: {},
    refresh() {
      if (refreshRequest) return refreshRequest;
      set({ loading: true, error: '' });
      refreshRequest = (async () => {
        try { set({ connections: (await api.listConnections()) || [], loaded: true }); }
        catch (error) { set({ error: errorText(error) }); }
        finally { set({ loading: false }); refreshRequest = null; }
      })();
      return refreshRequest;
    },
    async toggle(id) {
      const connection = get().connections.find(c => c.id === id);
      if (!connection || get().pending[id]) return;
      set(s => ({ pending: { ...s.pending, [id]: true }, errors: { ...s.errors, [id]: '' }, status: { ...s.status, [id]: '' } }));
      try {
        await api.setConnection(id, !connection.connected);
        // 先反映本次寫入，再重新讀取；避免等待中的偵測覆蓋連線結果。
        if (refreshRequest) await refreshRequest;
        set(s => ({ connections: s.connections.map(c => c.id === id ? { ...c, connected: !connection.connected } : c) }));
        await get().refresh();
      } catch (error) { set(s => ({ errors: { ...s.errors, [id]: errorText(error) } })); }
      finally { set(s => ({ pending: { ...s.pending, [id]: false } })); }
    },
    async test(id) {
      if (get().pending[id]) return;
      set(s => ({ pending: { ...s.pending, [id]: true }, status: { ...s.status, [id]: '' }, errors: { ...s.errors, [id]: '' } }));
      try { await api.testConnection(id); set(s => ({ status: { ...s.status, [id]: t('ai.testPassed') } })); }
      catch (error) { set(s => ({ errors: { ...s.errors, [id]: errorText(error) } })); }
      finally { set(s => ({ pending: { ...s.pending, [id]: false } })); }
    },
  }));
}

export const aiConnectionStore = createAIConnectionStore();

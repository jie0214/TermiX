import type { Storage } from '../hosts/repository.ts';
export const modes = ['system', 'light', 'dark'] as const;
export type AppearanceMode = typeof modes[number];
export const appearanceNames: Record<AppearanceMode,string> = { system: '跟隨系統', light: '淺色', dark: '深色' };
interface AppearanceState { mode: AppearanceMode; loaded: boolean; saving: boolean; error: string }
const key = 'termix.mobile.appearance.v1';
function valid(value: unknown): value is AppearanceMode { return modes.some(mode => mode === value); }
export class AppearanceStore {
  private storage: Storage;
  private state: AppearanceState = { mode: 'system', loaded: false, saving: false, error: '' };
  private listeners = new Set<() => void>();
  private initialization?: Promise<void>;
  constructor(storage: Storage) { this.storage = storage; }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(value: Partial<AppearanceState>) { this.state = { ...this.state, ...value }; this.listeners.forEach(listener => listener()); }
  initialize(): Promise<void> {
    this.initialization ??= this.load();
    return this.initialization;
  }
  private async load() {
    try {
      const saved = await this.storage.getItem(key);
      if (saved !== null && !valid(saved)) throw new Error();
      this.update({ loaded: true, mode: saved ?? 'system' });
    } catch { this.update({ loaded: true, error: '無法讀取外觀設定，暫時使用跟隨系統；原始設定已保留。' }); }
  }
  async change(mode: AppearanceMode): Promise<boolean> {
    if (!this.state.loaded || this.state.saving || !valid(mode)) return false;
    this.update({ saving: true, error: '' });
    try {
      await this.storage.setItem(key, mode);
      this.update({ mode, saving: false }); return true;
    } catch { this.update({ saving: false, error: '外觀設定保存失敗，請重試。' }); return false; }
  }
}

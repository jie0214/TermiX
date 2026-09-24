import type { HostRepository, Storage } from '../hosts/repository.ts';
import { parseSettings } from './settings.ts';
export type SyncCapability = 'available' | 'unsupported' | 'not_configured';
export type SyncMode = 'off' | 'file' | 'cloud';
export interface CloudResult { status: string; payload?: string }
interface SyncState {
  loaded: boolean; mode: SyncMode; busy: boolean; message: string; error: string; lastSuccess: string;
  preview?: { count: number; sourceId: string };
}
const key = 'termix.mobile.sync.v1';
const messages: Record<string,string> = {
  not_configured: '此建置尚未設定 iCloud 同步，請先使用檔案匯入。',
  unsupported: '此裝置不支援 iCloud 同步，請使用檔案匯入。',
  no_account: '請先登入與桌面相同的 Apple ID，並確認 iCloud 可用。',
  empty: '尚無雲端設定，請在桌面啟用手機同步。',
  invalid: '雲端設定格式無效，手機資料已保留。',
  network: '無法取得雲端設定，請檢查網路後重試。',
};
export class SyncWorkspace {
  readonly capability: SyncCapability;
  private storage: Storage;
  private hosts: HostRepository;
  private fetchCloud: () => Promise<CloudResult>;
  private canApply: () => boolean;
  private state: SyncState = { loaded: false, mode: 'off', busy: false, message: '', error: '', lastSuccess: '' };
  private listeners = new Set<() => void>();
  private generation = 0;
  private pendingFile: string | null = null;
  private changing = false;
  private active = true;
  private onApplied: () => Promise<void> = async () => {};
  constructor(storage: Storage, hosts: HostRepository, fetchCloud: () => Promise<CloudResult>, canApply: () => boolean, capability: SyncCapability = 'available') {
    this.capability = capability;
    this.storage = storage; this.hosts = hosts; this.fetchCloud = fetchCloud; this.canApply = canApply;
  }
  setOnApplied(callback: () => Promise<void>) { this.onApplied = callback; }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.state;
  private update(value: Partial<SyncState>) { this.state = { ...this.state, ...value }; this.listeners.forEach(listener => listener()); }
  async initialize() {
    if (this.state.loaded) return;
    try {
      const mode = await this.storage.getItem(key);
      if (mode !== null && !['off', 'file', 'cloud'].includes(mode)) throw new Error();
      this.update({ loaded: true, mode: (mode === 'cloud' && this.capability !== 'available' ? 'off' : mode ?? 'off') as SyncMode });
    } catch { this.update({ loaded: true, error: '無法讀取同步設定；原始資料已保留。' }); }
  }
  setActive(active: boolean) {
    this.active = active;
    if (!active) { this.generation++; this.pendingFile = null; this.update({ busy: false, preview: undefined }); }
  }
  async setMode(mode: SyncMode) {
    if (mode === 'cloud' && this.capability !== 'available') return;
    if (this.changing || !this.state.loaded || !['off', 'file', 'cloud'].includes(mode)) return;
    this.changing = true; this.generation++; this.pendingFile = null;
    this.update({ busy: true, preview: undefined, error: '', message: '' });
    try { await this.storage.setItem(key, mode); this.update({ mode }); }
    catch { this.update({ error: '同步方式保存失敗，請重試。' }); }
    finally { this.changing = false; this.update({ busy: false }); }
  }
  prepareFile(raw: string) {
    if (this.state.mode !== 'file' || this.state.busy) return;
    this.pendingFile = null; this.update({ preview: undefined, error: '', message: '' });
    try {
      const data = parseSettings(raw);
      this.pendingFile = raw;
      this.update({ preview: { count: data.hosts.length, sourceId: data.sourceId } });
    } catch { this.update({ error: '請選擇桌面匯出的手機設定檔（最多 500 筆、256 KB）；備份檔與機密欄位不接受。' }); }
  }
  cancelFile() { this.pendingFile = null; this.update({ preview: undefined }); }
  async applyFile() {
    if (this.state.mode !== 'file' || this.state.busy || this.pendingFile === null) return;
    await this.apply(this.pendingFile, ++this.generation);
  }
  private async apply(raw: string, generation: number) {
    const current = () => generation === this.generation && this.active && this.canApply();
    if (!current()) { this.update({ message: '請先中斷 SSH 連線，再同步設定。' }); return; }
    this.update({ busy: true, error: '', message: '' });
    try {
      const changed = await this.hosts.importSettings(raw, current);
      // 寫入已提交就刷新清單；模式切換僅取消尚未提交的更新與舊狀態提示。
      if (changed) await this.onApplied();
      if (!current()) return;
      this.pendingFile = null;
      this.update({ lastSuccess: new Date().toISOString(), preview: undefined, message: '已同步；尚未設定驗證的主機需在手機補上密碼或私鑰。' });
    } catch { if (current()) this.update({ error: '同步失敗；請檢查設定檔與儲存空間後重試。' }); }
    finally { if (generation === this.generation) this.update({ busy: false }); }
  }
  async refresh() {
    if (this.capability !== 'available' || !this.state.loaded || this.state.mode !== 'cloud' || this.state.busy || !this.active) return;
    if (!this.canApply()) { this.update({ message: 'SSH 連線期間暫停同步。' }); return; }
    const generation = ++this.generation;
    this.update({ busy: true, error: '', message: '' });
    try {
      const result = await this.fetchCloud();
      if (generation !== this.generation || !this.active) return;
      if (result.status !== 'ok' || typeof result.payload !== 'string') {
        this.update({ error: messages[result.status] ?? messages.network }); return;
      }
      await this.apply(result.payload, generation);
    } catch { if (generation === this.generation) this.update({ error: messages.network }); }
    finally { if (generation === this.generation) this.update({ busy: false }); }
  }
}

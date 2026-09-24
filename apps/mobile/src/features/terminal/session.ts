import type { Host } from '../hosts/repository.ts';
import type { KnownHosts, SSHCredentials, SSHEvent, SSHTransport, TerminalState } from './contracts.ts';

const messages: Record<string, string> = {
  private_key_invalid: '私鑰內容無效或已損毀，請重新匯入。',
  private_key_unsupported: '不支援此私鑰格式、演算法或加密參數，請改用 OpenSSH RSA、Ed25519 或 ECDSA 私鑰。',
  private_key_passphrase_required: '此私鑰已加密，請輸入私鑰密語。',
  private_key_decryption_failed: '私鑰解密失敗，請確認密語與檔案。',
  authentication_failed: '登入失敗，請確認帳號與密碼。',
  host_key_changed: '主機金鑰已變更，已阻擋連線。請向管理者確認。',
  host_key_rejected: '未信任主機金鑰，連線已取消。',
  host_key_timeout: '確認主機金鑰逾時，請重新連線。',
  terminal_failed: '伺服器無法開啟互動式終端。',
  connection_lost: '連線已中斷，請重新連線。',
  output_overflow: '終端輸出過快，已中斷連線以保護記憶體。',
};

export class TerminalSession {
  private state: TerminalState = { status: 'idle', sessionId: '', message: '' };
  private listeners = new Set<() => void>();
  private outputListeners = new Set<(chunk: string) => void>();
  private chunks: string[] = [];
  private outputSize = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private pendingStart: Promise<void> = Promise.resolve();
  private closing?: Promise<void>;
  private accepting = '';
  private updatingPassphrase = false;
  private size = { cols: 80, rows: 24 };
  private transport: SSHTransport;
  private credentials: SSHCredentials;
  private knownHosts: KnownHosts;
  private makeId: () => string;

  constructor(transport: SSHTransport, credentials: SSHCredentials, knownHosts: KnownHosts, makeId: () => string) {
    this.transport = transport; this.credentials = credentials; this.knownHosts = knownHosts; this.makeId = makeId;
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getOutput = () => [...this.chunks];
  subscribeOutput = (listener: (chunk: string) => void) => { this.outputListeners.add(listener); return () => { this.outputListeners.delete(listener); }; };
  private update(patch: Partial<TerminalState>) { this.state = { ...this.state, ...patch }; this.listeners.forEach(listener => listener()); }
  private active(id: string) { return this.state.sessionId === id && ['connecting', 'trust', 'connected'].includes(this.state.status); }

  async connect(host: Host): Promise<void> {
    if (this.closing || ['connecting', 'trust', 'connected', 'closing'].includes(this.state.status)) return;
    const id = this.makeId();
    this.chunks = []; this.outputSize = 0;
    this.update({ status: 'connecting', sessionId: id, host, challenge: undefined, message: '', errorCode: undefined });
    this.pendingStart = (async () => {
      try {
        const credentials = await this.credentials.getCredentials(host.id, host);
        if (!this.active(id)) return;
        if (!credentials) { this.update({ status: 'error', message: '缺少登入憑證，請先設定主機。' }); return; }
        const expectedKey = await this.knownHosts.get(host);
        if (!this.active(id)) return;
        await this.transport.start({ id, address: host.address, port: host.port, username: host.username,
          credentials, expectedKey, ...this.size });
        if (this.active(id)) void this.poll(id);
      } catch { if (this.active(id)) { await this.transport.disconnect(id).catch(() => undefined); this.update({ status: 'error', message: '無法開始連線，請確認憑證與網路後重試。' }); } }
    })();
    await this.pendingStart;
  }
  private async poll(id: string) {
    try {
      const events = await this.transport.poll(id);
      if (!this.active(id)) return;
      for (const event of events) {
        if (!this.active(id)) break;
        this.receive(event);
      }
    } catch {
      if (this.active(id)) {
        await this.transport.disconnect(id).catch(() => undefined);
        if (this.active(id)) this.update({ status: 'error', challenge: undefined, message: '無法讀取連線狀態，已停止終端。' });
      }
    }
    if (this.active(id)) this.timer = setTimeout(() => void this.poll(id), 60);
  }
  private receive(event: SSHEvent) {
    if (event.type === 'hostKey') this.update({ status: 'trust', challenge: event });
    if (event.type === 'connected') { this.update({ status: 'connected', challenge: undefined }); void this.resize(this.size.cols, this.size.rows); }
    if (event.type === 'closed') this.update({ status: 'closed', challenge: undefined, message: '連線已結束。' });
    if (event.type === 'error') this.update({ status: 'error', challenge: undefined, errorCode: event.code, message: event.code === 'authentication_failed' && this.state.host?.authType === 'privateKey' ? '私鑰登入遭拒，請確認帳號與伺服器公鑰授權。' : messages[event.code] ?? '無法連線，請確認主機位址、連接埠與網路。' });
    if (event.type === 'data') {
      this.chunks.push(event.data); this.outputSize += event.data.length;
      while (this.outputSize > 350_000 && this.chunks.length > 1) this.outputSize -= this.chunks.shift()!.length;
      this.outputListeners.forEach(listener => listener(event.data));
    }
  }
  async retryWithPassphrase(passphrase: string): Promise<boolean> {
    const { host, sessionId: id, status, errorCode } = this.state;
    if (!host || status !== 'error' || !['private_key_passphrase_required', 'private_key_decryption_failed'].includes(errorCode ?? '') || this.updatingPassphrase) return false;
    this.updatingPassphrase = true;
    try {
      await this.credentials.updatePrivateKeyPassphrase(host.id, passphrase, host);
      if (this.state.sessionId !== id || this.state.status !== 'error') return false;
      await this.connect(host);
      return true;
    } catch {
      if (this.state.sessionId === id && this.state.status === 'error') this.update({ message: '密語未保存，請重試。' });
      return false;
    } finally { this.updatingPassphrase = false; }
  }
  async acceptHostKey(): Promise<void> {
    const { sessionId: id, host, challenge, status } = this.state;
    if (!host || !challenge || status !== 'trust' || this.accepting === id) return;
    this.accepting = id;
    try {
      await this.knownHosts.save(host, challenge.key);
      if (!this.active(id)) return;
      await this.transport.trust(id, true);
      if (this.active(id) && this.state.status === 'trust') this.update({ status: 'connecting', challenge: undefined });
    } catch {
      if (this.active(id)) { await this.disconnect(); if (this.state.sessionId === id) this.update({ status: 'error', message: '無法保存或確認主機金鑰，連線已取消。' }); }
    } finally { if (this.accepting === id) this.accepting = ''; }
  }
  async disconnect(message = '已中斷連線。'): Promise<void> {
    if (this.closing) return this.closing;
    const id = this.state.sessionId;
    if (!id) return;
    clearTimeout(this.timer);
    this.update({ status: 'closing', challenge: undefined, message: '' });
    this.closing = (async () => {
      await this.pendingStart;
      try {
        await this.transport.disconnect(id);
        this.update({ status: 'closed', message });
      } catch { this.update({ status: 'error', message: '中斷失敗，請關閉 App 後重試。' }); }
    })();
    await this.closing;
    this.closing = undefined;
  }
  async send(data: string): Promise<boolean> {
    const { sessionId: id, status } = this.state;
    if (status !== 'connected' || data.length > 4096) return false;
    try { await this.transport.write(id, data); return true; }
    catch { if (this.active(id)) await this.disconnect('傳送失敗，連線已中斷。'); return false; }
  }
  async resize(cols: number, rows: number) {
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 2 || cols > 500 || rows < 1 || rows > 500) return;
    this.size = { cols, rows };
    const id = this.state.sessionId;
    if (this.state.status !== 'connected') return;
    try { await this.transport.resize(id, cols, rows); }
    catch { if (this.active(id)) await this.disconnect('無法更新終端尺寸，連線已中斷。'); }
  }
}

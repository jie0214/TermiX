import { normalize } from './validation.ts';
import { parseSettings, validateOrigin, type SyncOrigin } from '../sync/settings.ts';
import { normalizeCredentials, type Credentials, type CredentialStore } from './credentials.ts';
export { HostValidationError } from './validation.ts';

export interface Host {
  id: string;
  name: string;
  address: string;
  username: string;
  port: number;
  authType: 'password' | 'privateKey' | 'unconfigured';
  credentialRef?: string;
  syncOrigin?: SyncOrigin;
  folderPath?: string[];
}

export interface HostDraft {
  name: string;
  address: string;
  username: string;
  port: string;
  folderPath?: string[];
}

export interface Storage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

const storageKey = 'termix.mobile.hosts.v1';

export class HostRepository {
  private storage: Storage;
  private makeId: () => string;
  private credentials: CredentialStore;
  private pending: Promise<unknown> = Promise.resolve();

  constructor(storage: Storage, makeId: () => string, credentials: CredentialStore) {
    this.storage = storage;
    this.makeId = makeId;
    this.credentials = credentials;
  }

  async list(): Promise<Host[]> {
    const raw = await this.storage.getItem(storageKey);
    if (raw === null) return [];
    try {
      const data = JSON.parse(raw);
      if (![1, 2].includes(data.version) || !Array.isArray(data.hosts)) throw new Error();
      const ids = new Set<string>();
      const origins = new Set<string>();
      return data.hosts.map((item: Host) => {
        if (typeof item.id !== 'string' || !item.id || ids.has(item.id) || typeof item.port !== 'number') throw new Error();
        ids.add(item.id);
        if (item.syncOrigin) {
          const origin = validateOrigin(item.syncOrigin);
          const key = `${origin.sourceId}/${origin.hostId}`;
          if (origins.has(key)) throw new Error();
          origins.add(key);
        }
        const authType = data.version === 1 ? 'unconfigured' : item.authType;
        if (!['password', 'privateKey', 'unconfigured'].includes(authType)) throw new Error();
        if (authType !== 'unconfigured' && item.credentialRef !== `termix.ssh.${item.id}`) throw new Error();
        return { ...normalize({ ...item, port: String(item.port) }), id: item.id, authType,
          ...(item.syncOrigin ? { syncOrigin: validateOrigin(item.syncOrigin) } : {}),
          ...(authType === 'unconfigured' ? {} : { credentialRef: item.credentialRef }) };
      });
    } catch {
      throw new Error('無法讀取主機資料；原始資料已保留，請勿重新建立或覆蓋。');
    }
  }

  async importSettings(raw: string, isCurrent: () => boolean = () => true): Promise<boolean> {
    const incoming = parseSettings(raw);
    const operation = this.pending.then(async () => {
      if (!isCurrent()) return false;
      const hosts = await this.list();
      const before = JSON.stringify(hosts);
      const ids = new Set(hosts.map(host => host.id));
      for (const entry of incoming.hosts) {
        const index = hosts.findIndex(host => host.syncOrigin?.sourceId === incoming.sourceId && host.syncOrigin.hostId === entry.id);
        const previous = hosts[index];
        const sameTarget = previous && previous.address === entry.address && previous.port === entry.port && previous.username === entry.username;
        const id = previous?.id ?? this.makeId();
        if (!previous && (!/^[a-zA-Z0-9_.-]+$/.test(id) || ids.has(id))) throw new Error('同步主機識別碼衝突。');
        ids.add(id);
        const host: Host = { name: entry.name, address: entry.address, port: entry.port, username: entry.username,
          ...(entry.folderPath?.length ? { folderPath: entry.folderPath } : {}),
          id, authType: sameTarget ? previous.authType : 'unconfigured',
          ...(sameTarget && previous.credentialRef ? { credentialRef: previous.credentialRef } : {}),
          syncOrigin: { sourceId: incoming.sourceId, hostId: entry.id } };
        if (index >= 0) hosts[index] = host; else hosts.push(host);
      }
      if (!isCurrent() || JSON.stringify(hosts) === before) return false;
      await this.storage.setItem(storageKey, JSON.stringify({ version: 2, hosts }));
      return true;
    });
    this.pending = operation.catch(() => undefined);
    return operation;
  }

  async configureAuthentication(expected: Host, input: Credentials): Promise<void> {
    const credentials = normalizeCredentials(input);
    const operation = this.pending.then(async () => {
      const hosts = await this.list();
      const host = hosts.find(item => item.id === expected.id);
      if (!host || host.authType !== 'unconfigured' || host.address !== expected.address || host.port !== expected.port || host.username !== expected.username) {
        throw new Error('主機設定已改變，請返回後重新設定驗證。');
      }
      const ref = `termix.ssh.${host.id}`;
      const previous = await this.credentials.get(ref);
      await this.credentials.set(ref, JSON.stringify(credentials));
      try {
        await this.storage.setItem(storageKey, JSON.stringify({ version: 2,
          hosts: hosts.map(item => item.id === host.id ? { ...item, authType: credentials.type, credentialRef: ref } : item) }));
      } catch {
        if (previous === null) await this.credentials.remove(ref); else await this.credentials.set(ref, previous);
        throw new Error('驗證設定保存失敗，請重試。');
      }
    });
    this.pending = operation.catch(() => undefined);
    await operation;
  }

  async getCredentials(hostId: string, expected?: Host): Promise<Credentials | null> {
    const host = (await this.list()).find(item => item.id === hostId);
    if (!host?.credentialRef) return null;
    if (expected && (host.address !== expected.address || host.port !== expected.port || host.username !== expected.username)) return null;
    const raw = await this.credentials.get(host.credentialRef);
    if (raw === null) return null;
    const latest = (await this.list()).find(item => item.id === hostId);
    if (!latest || latest.address !== host.address || latest.port !== host.port || latest.username !== host.username ||
      latest.authType !== host.authType || latest.credentialRef !== host.credentialRef) return null;
    try {
      const credentials = normalizeCredentials(JSON.parse(raw));
      if (credentials.type !== host.authType) throw new Error();
      return credentials;
    } catch { throw new Error('無法讀取登入憑證，請重新設定。'); }
  }

  async updatePrivateKeyPassphrase(hostId: string, passphrase: string, expected?: Host): Promise<void> {
    const operation = this.pending.then(async () => {
      const host = (await this.list()).find(item => item.id === hostId);
      const current = await this.getCredentials(hostId, expected);
      if (!host?.credentialRef || current?.type !== 'privateKey') throw new Error('無法更新私鑰密語。');
      const updated = normalizeCredentials({ ...current, passphrase });
      await this.credentials.set(host.credentialRef, JSON.stringify(updated));
    });
    this.pending = operation.catch(() => undefined);
    await operation;
  }

  async add(draft: HostDraft, input: Credentials): Promise<Host> {
    const credentials = normalizeCredentials(input);
    const host: Host = { ...normalize(draft), id: this.makeId(), authType: credentials.type };
    if (!/^[a-zA-Z0-9_.-]+$/.test(host.id)) throw new Error('無法建立主機識別碼。');
    const credentialRef = `termix.ssh.${host.id}`;
    host.credentialRef = credentialRef;
    const operation = this.pending.then(async () => {
      const hosts = await this.list();
      if (hosts.some(item => item.id === host.id)) throw new Error('主機識別碼重複，請重試。');
      await this.credentials.set(credentialRef, JSON.stringify(credentials));
      try {
        await this.storage.setItem(storageKey, JSON.stringify({ version: 2, hosts: [...hosts, host] }));
      } catch {
        try { await this.credentials.remove(credentialRef); }
        catch { throw new Error('主機未保存，暫存憑證清理失敗。'); }
        throw new Error('主機設定保存失敗。');
      }
      return host;
    });
    this.pending = operation.catch(() => undefined);
    return operation;
  }
}

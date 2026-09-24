import Storage from 'expo-sqlite/kv-store';
import type { KnownHosts } from '../features/terminal/contracts';
import type { Host } from '../features/hosts/repository';

// 主機公鑰不是機密；信任以實際位址與 port 為範圍，不因新增相同主機而重置。
const keyFor = (host: Host) => `termix.known-host.${JSON.stringify([host.address.toLowerCase().replace(/\.$/, ''), host.port])}`;
export const knownHosts: KnownHosts = {
  async get(host) {
    const key = await Storage.getItem(keyFor(host));
    if (key !== null && !/^[A-Za-z0-9+/]{20,}={0,2}$/.test(key)) throw new Error('主機金鑰資料無效');
    return key ?? '';
  },
  async save(host, key) { await Storage.setItem(keyFor(host), key); },
};

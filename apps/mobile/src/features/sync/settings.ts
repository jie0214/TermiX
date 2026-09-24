import { normalize } from '../hosts/validation.ts';

export interface SyncOrigin { sourceId: string; hostId: string }
export interface SyncedHost { id: string; name: string; address: string; port: number; username: string; folderPath?: string[] }
export interface SettingsDocument { version: 'termix.mobile-settings.v1' | 'termix.mobile-settings.v2'; sourceId: string; hosts: SyncedHost[] }
const identifier = /^[a-zA-Z0-9_-]{1,128}$/;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).length !== allowed.length || Object.keys(value).some(key => !allowed.includes(key))) throw new Error();
}
export function validateOrigin(value: unknown): SyncOrigin {
  const item = object(value);
  if (typeof item.sourceId !== 'string' || !identifier.test(item.sourceId) || typeof item.hostId !== 'string' || !identifier.test(item.hostId)) throw new Error();
  return { sourceId: item.sourceId, hostId: item.hostId };
}
export function parseSettings(raw: string): SettingsDocument {
  try {
    if (new TextEncoder().encode(raw).length > 256 * 1024) throw new Error();
    const data = object(JSON.parse(raw));
    keys(data, ['version', 'sourceId', 'hosts']);
    if ((data.version !== 'termix.mobile-settings.v1' && data.version !== 'termix.mobile-settings.v2') || typeof data.sourceId !== 'string' || !identifier.test(data.sourceId) ||
      !Array.isArray(data.hosts) || data.hosts.length > 500) throw new Error();
    const ids = new Set<string>();
    const hosts = data.hosts.map(value => {
      const item = object(value);
      keys(item, ['id', 'name', 'address', 'port', 'username', ...(data.version === 'termix.mobile-settings.v2' ? ['folderPath'] : [])]);
      if (data.version === 'termix.mobile-settings.v2' && !Array.isArray(item.folderPath)) throw new Error();
      if (typeof item.id !== 'string' || !identifier.test(item.id) || ids.has(item.id) || typeof item.name !== 'string' ||
        typeof item.address !== 'string' || typeof item.username !== 'string' || typeof item.port !== 'number') throw new Error();
      ids.add(item.id);
      return { id: item.id, ...normalize({ name: item.name, address: item.address, username: item.username, port: String(item.port), folderPath: item.folderPath as string[] | undefined }) };
    });
    return { version: data.version, sourceId: data.sourceId, hosts };
  } catch { throw new Error('請使用桌面版匯出的手機設定檔（最多 500 筆、256 KB）；不接受備份檔或機密欄位。'); }
}

import type { Host, HostDraft } from './repository.ts';

export class HostValidationError extends Error {
  field: keyof HostDraft;
  constructor(field: keyof HostDraft) {
    super(`invalid-${field}`);
    this.field = field;
  }
}

export function normalize(draft: HostDraft): Omit<Host, 'id' | 'authType' | 'credentialRef'> {
  const name = draft.name.trim();
  const address = normalizeAddress(draft.address.trim());
  const username = draft.username.trim();
  const port = Number(draft.port);
  if (!name || name.length > 80 || /[\u0000-\u001f\u007f]/.test(name)) throw new HostValidationError('name');
  if (!username || username.length > 128 || /[\s\u0000-\u001f\u007f]/.test(username)) throw new HostValidationError('username');
  if (!/^\d+$/.test(draft.port) || !Number.isInteger(port) || port < 1 || port > 65535) throw new HostValidationError('port');
  const folderPath = draft.folderPath ?? [];
  if (!Array.isArray(folderPath) || folderPath.length > 16 || folderPath.some(part =>
    typeof part !== 'string' || !part.trim() || part.trim().length > 80 || /[\u0000-\u001f\u007f/]/.test(part) || ['.', '..'].includes(part.trim()))) throw new HostValidationError('folderPath');
  return { name, address, username, port, ...(folderPath.length ? { folderPath: folderPath.map(part => part.trim()) } : {}) };
}

function normalizeAddress(input: string): string {
  const address = input.startsWith('[') && input.endsWith(']') ? input.slice(1, -1) : input;
  if (address.includes(':')) {
    try {
      if (/^[0-9a-f:.]+$/i.test(address)) { new URL(`http://[${address}]/`); return address; }
    } catch { /* 轉為一致的欄位驗證錯誤。 */ }
    throw new HostValidationError('address');
  }
  if (address !== input) throw new HostValidationError('address');
  if (/^[\d.]+$/.test(address)) {
    const parts = address.split('.');
    if (parts.length === 4 && parts.every(part => /^(0|[1-9]\d{0,2})$/.test(part) && Number(part) <= 255)) return address;
    throw new HostValidationError('address');
  }
  const labels = address.replace(/\.$/, '').split('.');
  if (address.length <= 253 && labels.every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) return address;
  throw new HostValidationError('address');
}


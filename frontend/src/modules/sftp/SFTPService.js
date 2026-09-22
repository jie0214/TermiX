import { requireAppBinding } from '../../platform/wails/bindings.ts';

export const SFTP_TAB_ID = 'sftp-tab';
// 僅保存頁面選擇；連線、傳輸與認證的生命週期由 Go 後端管理。
export const sftpViewState = { sessionId: '', paths: new Map(), localPath: '', hostQuery: '' };
export const sftpCall = (name, ...args) => requireAppBinding(name)(...args);
export function joinRemotePath(parent, name) { return `${parent.replace(/\/$/, '')}/${name}`; }
export function parentRemotePath(value) { return value.replace(/\/+$/, '').replace(/\/[^/]*$/, '') || '/'; }
export function escapeSFTP(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
export function formatBytes(value) {
  if (!Number.isFinite(value) || value < 0) return '—';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let index = 0;
  while (value >= 1024 && index < units.length - 1) { value /= 1024; index++; }
  return `${value.toFixed(index ? 1 : 0)} ${units[index]}`;
}

const RECENT_HOSTS_KEY = 'termix.sftp.recentHosts.v1';
let recentFallback = [];
export function readRecentSFTPHosts(storage = globalThis.localStorage) {
  try {
    const stored = storage?.getItem(RECENT_HOSTS_KEY);
    const rows = stored ? JSON.parse(stored) : recentFallback;
    if (!Array.isArray(rows)) return [];
    return rows.filter(row => typeof row?.hostId === 'string' && Number.isFinite(row.at) && row.at > 0).slice(0, 100);
  } catch { return recentFallback; }
}
// 只記錄成功連線的 Host ID 與時間，不保存 IP、帳號或認證資訊。
export function recordSFTPConnection(hostId, at = Date.now(), storage = globalThis.localStorage) {
  recentFallback = [{ hostId, at }, ...readRecentSFTPHosts(storage).filter(row => row.hostId !== hostId)].slice(0, 100);
  try { storage?.setItem(RECENT_HOSTS_KEY, JSON.stringify(recentFallback)); } catch { /* 儲存空間不可用時仍保留本次執行紀錄。 */ }
}
export function filterSFTPHosts(hosts, query = '', recent = readRecentSFTPHosts()) {
  const needle = query.trim().toLocaleLowerCase();
  const times = new Map(recent.map(row => [row.hostId, row.at]));
  return hosts.filter(host => [host.alias, host.label, host.config?.host].some(value => String(value || '').toLocaleLowerCase().includes(needle)))
    .sort((a, b) => (times.get(b.id) || 0) - (times.get(a.id) || 0)
      || String(a.alias || a.label || a.config?.host || '').localeCompare(String(b.alias || b.label || b.config?.host || '')));
}
export function remoteDropDestination(currentPath, entry) {
  return entry?.type === 'directory' ? joinRemotePath(currentPath, entry.name) : currentPath;
}
export function localUploadPaths(entries, selected, draggedPath) {
  const transferable = entries.filter(entry => entry.type === 'file' || entry.type === 'directory');
  const paths = draggedPath && !selected.has(draggedPath) ? new Set([draggedPath]) : selected;
  return transferable.filter(entry => paths.has(entry.path)).map(entry => entry.path);
}


export function transferDisplay(transfer) {
  let status = transfer.status;
  let error = transfer.error || '';
  if (error || (status === 'completed' && transfer.bytes !== transfer.total)) {
    status = 'failed';
    error ||= '傳輸大小不符，未完成。';
  }
  let percentage = transfer.total > 0 ? Math.max(0, Math.min(100, Math.floor(transfer.bytes / transfer.total * 100))) : 0;
  if (status === 'completed') percentage = 100;
  if (status === 'running') percentage = Math.min(99, percentage);
  return { status, error, percentage, speed: transfer.speed > 0 ? `${formatBytes(transfer.speed)} / s` : '—' };
}

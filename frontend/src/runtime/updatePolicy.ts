// 僅保存使用者主動關閉的版本；與檢查時間及下載狀態分開。
const DISMISSED_VERSION_KEY = 'termix.dismissedUpdateVersion';
let dismissedFallback = '';
export const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

export function shouldNotifyUpdate(version: string, manual = false): boolean {
  if (manual) return true;
  let dismissed = dismissedFallback;
  try { dismissed = localStorage.getItem(DISMISSED_VERSION_KEY) || dismissed; } catch { /* 儲存不可用時沿用本次執行記錄。 */ }
  return !dismissed || version.localeCompare(dismissed, 'en', { numeric: true }) > 0;
}

export function dismissUpdateVersion(version: string): void {
  if (!shouldNotifyUpdate(version)) return;
  dismissedFallback = version;
  try { localStorage.setItem(DISMISSED_VERSION_KEY, version); } catch { /* 不影響通知關閉。 */ }
}

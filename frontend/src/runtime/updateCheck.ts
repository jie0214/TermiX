import { getAppBinding } from '../platform/wails';
import { confirmDialog } from '../components/feedback/confirmDialog';

// 記錄使用者已「稍後再說」的版本，避免每次啟動都重複提示同一版本。
const DISMISS_KEY = 'termix-update-dismissed-version';

function openReleasePage(url: string): void {
  // Wails runtime 提供 BrowserOpenURL 以系統瀏覽器開啟外部連結；非 Wails 環境則忽略。
  const runtime = (globalThis as { runtime?: { BrowserOpenURL?: (u: string) => void } }).runtime;
  runtime?.BrowserOpenURL?.(url);
}

// 啟動時檢查是否有新版本；有則以非阻塞對話框通知使用者。
// 設計為靜默失敗：任何錯誤都不影響 App 正常使用。
export async function checkForUpdateAndNotify(): Promise<void> {
  try {
    const checkForUpdate = getAppBinding('CheckForUpdate');
    if (!checkForUpdate) return;

    const info = await checkForUpdate();
    if (!info?.hasUpdate || !info.latestVersion) return;
    if (localStorage.getItem(DISMISS_KEY) === info.latestVersion) return;

    const goDownload = await confirmDialog(
      `TermiX ${info.latestVersion} 已發佈（目前為 ${info.currentVersion}），是否前往下載頁面更新？\n\n若透過 Homebrew 安裝，可執行 brew upgrade --cask termix。`,
      {
        title: '有新版本可用',
        confirmText: '前往下載',
        cancelText: '稍後再說',
      },
    );

    if (goDownload && info.releaseUrl) {
      openReleasePage(info.releaseUrl);
    } else {
      // 記住此版本，直到有更新的版本才再次提示。
      localStorage.setItem(DISMISS_KEY, info.latestVersion);
    }
  } catch (error) {
    console.warn('[TermiX] 更新檢查失敗', error);
  }
}

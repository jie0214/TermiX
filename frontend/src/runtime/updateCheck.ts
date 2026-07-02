import { getAppBinding } from '../platform/wails';
import { onWailsEvent } from '../platform/wails/events';
import { showToast } from '../components/feedback/toast.js';
import { showUpdateNotification } from './updateNotification';
import { t } from '../i18n/index.ts';

// 選單「Check for Updates」由後端 emit 的事件名（對應 shared/events：EventCheckForUpdate）。
const MENU_CHECK_EVENT = 'check-for-update';

// 執行一次更新檢查。manual=true 代表使用者主動觸發（選單），會額外提示「已是最新版本」。
// 設計為靜默失敗：任何錯誤都不影響 App 正常使用。
async function runUpdateCheck(manual: boolean): Promise<void> {
  try {
    const checkForUpdate = getAppBinding('CheckForUpdate');
    if (!checkForUpdate) return;

    const info = await checkForUpdate();

    if (info?.hasUpdate && info.latestVersion) {
      // 有新版本：右上角跳出可關閉的更新小卡。
      // 每次啟動 / 每次手動檢查只要有新版都會再次提示（關閉僅隱藏當次）。
      showUpdateNotification(info.latestVersion, info.releaseUrl ?? '');
      return;
    }

    // 已是最新版本：僅在使用者主動檢查時給予回饋，避免啟動時打擾。
    if (manual) {
      showToast(t('misc.update.upToDate', { current: info?.currentVersion ?? '' }), {
        type: 'success',
      });
    }
  } catch (error) {
    console.warn('[TermiX] 更新檢查失敗', error);
  }
}

// 啟動時於背景自動檢查更新。
export async function checkForUpdateAndNotify(): Promise<void> {
  await runUpdateCheck(false);
}

// 註冊選單「Check for Updates」事件監聽：主動檢查並提示檢查中。
export function registerUpdateMenuListener(): void {
  onWailsEvent(MENU_CHECK_EVENT, () => {
    showToast(t('misc.update.checking'), { type: 'info' });
    void runUpdateCheck(true);
  });
}

import { UPDATE_CHECK_INTERVAL_MS, shouldNotifyUpdate } from './updatePolicy';
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
    const nativeCheck = getAppBinding('HandleNativeUpdateCheck');
    if (nativeCheck && await nativeCheck(manual)) return;
    const checkForUpdate = getAppBinding('CheckForUpdate');
    if (!checkForUpdate) return;

    const info = await checkForUpdate();

    if (info?.hasUpdate && info.latestVersion) {
      // 有新版本：右上角跳出可關閉的更新小卡。
      // 手動檢查可重看已關閉版本，自動檢查只提示更新的版本。
      if (shouldNotifyUpdate(info.latestVersion, manual)) showUpdateNotification(info.latestVersion, info.releaseUrl ?? '');
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
let updateTimer: ReturnType<typeof setInterval> | undefined;
export async function checkForUpdateAndNotify(): Promise<void> {
  // 原生更新器存在時 runUpdateCheck 會交還 Sparkle，不建立第二套原生檢查。
  if (updateTimer === undefined) updateTimer = setInterval(() => { void runUpdateCheck(false); }, UPDATE_CHECK_INTERVAL_MS);
  await runUpdateCheck(false);
}

// 註冊選單「Check for Updates」事件監聽：主動檢查並提示檢查中。
export function registerUpdateMenuListener(): void {
  onWailsEvent(MENU_CHECK_EVENT, () => {
    showToast(t('misc.update.checking'), { type: 'info' });
    void runUpdateCheck(true);
  });
}

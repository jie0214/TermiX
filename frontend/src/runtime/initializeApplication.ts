import '@xterm/xterm/css/xterm.css';

import '../style.css';
import { installBrowserWailsMock } from '../platform/wails';
import { installGlobalErrorHandlers } from './globalErrorOverlay';
import { installInteractionInterception } from './interactionInterception';
import { installScrollbarAutohide } from './scrollbarAutohide';
import { checkForUpdateAndNotify, registerUpdateMenuListener } from './updateCheck';

let initializationPromise: Promise<void> | undefined;

export function initializeApplication(): Promise<void> {
  initializationPromise ??= (async () => {
    installBrowserWailsMock();
    installGlobalErrorHandlers();
    installInteractionInterception();
    installScrollbarAutohide();
    await import('../App.js');
    // 註冊選單「Check for Updates」事件監聽（使用者主動檢查）。
    registerUpdateMenuListener();
    // 非阻塞：App 載入後於背景檢查更新，不延遲啟動。
    void checkForUpdateAndNotify();
  })();

  return initializationPromise;
}

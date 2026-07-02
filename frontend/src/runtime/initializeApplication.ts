import '@xterm/xterm/css/xterm.css';

import '../style.css';
import { installBrowserWailsMock } from '../platform/wails';
import { installGlobalErrorHandlers } from './globalErrorOverlay';
import { installInteractionInterception } from './interactionInterception';
import { installScrollbarAutohide } from './scrollbarAutohide';
import { checkForUpdateAndNotify } from './updateCheck';

let initializationPromise: Promise<void> | undefined;

export function initializeApplication(): Promise<void> {
  initializationPromise ??= (async () => {
    installBrowserWailsMock();
    installGlobalErrorHandlers();
    installInteractionInterception();
    installScrollbarAutohide();
    await import('../App.js');
    // 非阻塞：App 載入後於背景檢查更新，不延遲啟動。
    void checkForUpdateAndNotify();
  })();

  return initializationPromise;
}

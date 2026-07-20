import { isWindows } from '../../domain/shortcuts.ts';

// 瀏覽器無法取得使用者實際家目錄；Windows 以可由後端展開的環境變數表示，
// Unix-like 系統則沿用 shell 的家目錄縮寫。
export function defaultKubeconfigPath() {
  return isWindows() ? '%USERPROFILE%\\.kube\\config' : '~/.kube/config';
}

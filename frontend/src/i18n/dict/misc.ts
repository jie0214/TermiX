import type { DictBundle } from '../index';

// misc 模組字串（由 i18n 遷移填入）。
export const misc: DictBundle = {
  en: {
    // toast
    'misc.toast.closeNotification': 'Close notification',
    // confirmDialog
    'misc.confirmDialog.title': 'Confirm action',
    // AppErrorBoundary
    'misc.errorBoundary.eyebrow': 'REACT RENDER ERROR',
    'misc.errorBoundary.heading': 'This view cannot continue',
    'misc.errorBoundary.description':
      'A React component threw an unhandled error. Terminal connections and background sessions are not automatically closed by this screen.',
    'misc.errorBoundary.details': 'View error details',
    'misc.errorBoundary.unknownError': 'Unknown React runtime error.',
    'misc.errorBoundary.reload': 'Reload application',
    'misc.errorBoundary.backToHosts': 'Back to host management',
    // LoadingState
    'misc.loading.workspace': 'Loading TermiX workspace',
    // updateCheck
    'misc.update.message':
      'TermiX {latest} has been released (current is {current}). Go to the download page to update?\n\nIf installed via Homebrew, you can run brew upgrade --cask termix.',
    'misc.update.title': 'A new version is available',
    'misc.update.confirm': 'Go to download',
    'misc.update.cancel': 'Later',
    // globalErrorOverlay
    'misc.globalError.title':
      'TermiX frontend fatal runtime error (JavaScript Uncaught Exception)',
    'misc.globalError.summary': 'Error: {message}\nSource: {source}',
    'misc.globalError.stackTitle': 'Stack Trace:',
    'misc.globalError.close': 'Close this notice',
    // SnippetRuntime
    'misc.snippet.sessionNotFound': 'Snippet or terminal session does not exist',
    // wails mock / bindings
    'misc.wails.mockUnavailable':
      'Wails Go bindings are unavailable in a browser environment.',
    'misc.wails.mockUnavailableShell':
      'Wails Go bindings are unavailable in a browser environment. Shell: {shell}',
    'misc.wails.missingBinding': 'Missing backend API: {name}',
    // main
    'misc.app.rootNotFound': 'TermiX frontend root node "#app" not found.',
  },
  zhHant: {
    'misc.toast.closeNotification': '關閉通知',
    'misc.confirmDialog.title': '確認操作',
    'misc.errorBoundary.eyebrow': 'REACT RENDER ERROR',
    'misc.errorBoundary.heading': '此畫面無法繼續顯示',
    'misc.errorBoundary.description':
      'React 元件發生未處理錯誤。終端連線或背景工作階段不會由此畫面自動關閉。',
    'misc.errorBoundary.details': '查看錯誤內容',
    'misc.errorBoundary.unknownError': '未知的 React 執行期錯誤。',
    'misc.errorBoundary.reload': '重新載入應用程式',
    'misc.errorBoundary.backToHosts': '返回主機管理',
    'misc.loading.workspace': '正在載入 TermiX 工作區',
    'misc.update.message':
      'TermiX {latest} 已發佈（目前為 {current}），是否前往下載頁面更新？\n\n若透過 Homebrew 安裝，可執行 brew upgrade --cask termix。',
    'misc.update.title': '有新版本可用',
    'misc.update.confirm': '前往下載',
    'misc.update.cancel': '稍後再說',
    'misc.globalError.title':
      'TermiX 前端執行期致命錯誤（JavaScript Uncaught Exception）',
    'misc.globalError.summary': 'Error：{message}\nSource：{source}',
    'misc.globalError.stackTitle': 'Stack Trace：',
    'misc.globalError.close': '關閉此提示',
    'misc.snippet.sessionNotFound': 'Snippet 或 Terminal session 不存在',
    'misc.wails.mockUnavailable': 'Wails Go 綁定在瀏覽器環境中不可用。',
    'misc.wails.mockUnavailableShell': 'Wails Go 綁定在瀏覽器環境中不可用。Shell：{shell}',
    'misc.wails.missingBinding': '缺少後端 API：{name}',
    'misc.app.rootNotFound': '找不到 TermiX 前端根節點「#app」。',
  },
  ja: {
    'misc.toast.closeNotification': '通知を閉じる',
    'misc.confirmDialog.title': '操作の確認',
    'misc.errorBoundary.eyebrow': 'REACT RENDER ERROR',
    'misc.errorBoundary.heading': 'この画面は続行できません',
    'misc.errorBoundary.description':
      'React コンポーネントで未処理のエラーが発生しました。ターミナル接続やバックグラウンドセッションはこの画面によって自動的に閉じられることはありません。',
    'misc.errorBoundary.details': 'エラー内容を表示',
    'misc.errorBoundary.unknownError': '不明な React 実行時エラー。',
    'misc.errorBoundary.reload': 'アプリケーションを再読み込み',
    'misc.errorBoundary.backToHosts': 'ホスト管理に戻る',
    'misc.loading.workspace': 'TermiX ワークスペースを読み込み中',
    'misc.update.message':
      'TermiX {latest} がリリースされました（現在は {current}）。ダウンロードページに移動して更新しますか？\n\nHomebrew でインストールした場合は brew upgrade --cask termix を実行できます。',
    'misc.update.title': '新しいバージョンが利用可能です',
    'misc.update.confirm': 'ダウンロードへ',
    'misc.update.cancel': '後で',
    'misc.globalError.title':
      'TermiX フロントエンド実行時致命的エラー（JavaScript Uncaught Exception）',
    'misc.globalError.summary': 'Error：{message}\nSource：{source}',
    'misc.globalError.stackTitle': 'Stack Trace：',
    'misc.globalError.close': 'この通知を閉じる',
    'misc.snippet.sessionNotFound': 'Snippet またはターミナルセッションが存在しません',
    'misc.wails.mockUnavailable': 'Wails Go バインディングはブラウザ環境では利用できません。',
    'misc.wails.mockUnavailableShell':
      'Wails Go バインディングはブラウザ環境では利用できません。Shell：{shell}',
    'misc.wails.missingBinding': 'バックエンド API がありません：{name}',
    'misc.app.rootNotFound': 'TermiX フロントエンドのルートノード「#app」が見つかりません。',
  },
};

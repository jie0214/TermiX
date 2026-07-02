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
    'misc.update.title': 'A new version is available',
    'misc.update.ready': 'Version {latest} is ready to install.',
    'misc.update.hint': 'Installed via Homebrew? Run brew upgrade --cask termix.',
    'misc.update.confirm': 'Download & install',
    'misc.update.close': 'Close update notice',
    'misc.update.checking': 'Checking for updates…',
    'misc.update.upToDate': 'You’re on the latest version ({current}).',
    'misc.update.downloading': 'Downloading update…',
    'misc.update.downloaded':
      'Downloaded to your Downloads folder. Unzip and replace the app to finish.',
    'misc.update.downloadFailed':
      'Download failed. Opening the download page in your browser instead.',
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
    'misc.update.title': '有新版本可用',
    'misc.update.ready': '版本 {latest} 已可安裝。',
    'misc.update.hint': '若透過 Homebrew 安裝，可執行 brew upgrade --cask termix。',
    'misc.update.confirm': '下載並安裝',
    'misc.update.close': '關閉更新提示',
    'misc.update.checking': '正在檢查更新…',
    'misc.update.upToDate': '目前已是最新版本（{current}）。',
    'misc.update.downloading': '正在下載更新…',
    'misc.update.downloaded': '已下載至「下載」資料夾，請解壓縮後覆蓋安裝以完成更新。',
    'misc.update.downloadFailed': '下載失敗，已改用瀏覽器開啟下載頁面。',
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
    'misc.update.title': '新しいバージョンが利用可能です',
    'misc.update.ready': 'バージョン {latest} をインストールできます。',
    'misc.update.hint': 'Homebrew でインストールした場合は brew upgrade --cask termix を実行できます。',
    'misc.update.confirm': 'ダウンロードしてインストール',
    'misc.update.close': '更新通知を閉じる',
    'misc.update.checking': '更新を確認しています…',
    'misc.update.upToDate': '現在は最新バージョンです（{current}）。',
    'misc.update.downloading': '更新をダウンロードしています…',
    'misc.update.downloaded':
      'ダウンロードフォルダに保存しました。解凍してアプリを置き換えると更新が完了します。',
    'misc.update.downloadFailed': 'ダウンロードに失敗しました。代わりにダウンロードページを開きます。',
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

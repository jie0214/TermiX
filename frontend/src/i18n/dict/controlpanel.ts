import type { DictBundle } from '../index';

// controlpanel 模組字串（由 i18n 遷移填入）。
export const controlpanel: DictBundle = {
  en: {
    // 左側選單
    'cp.menu.hosts': 'Hosts',
    'cp.menu.controlPanel': 'Control Panel',
    'cp.menu.integrations': 'Integrations',
    'cp.menu.kubernetes': 'Kubernetes',
    'cp.menu.keychain': 'Keychain',
    'cp.menu.forwarding': 'Port Forwarding',
    'cp.menu.snippets': 'Snippets',
    'cp.menu.knownHosts': 'Known Hosts',
    'cp.menu.logs': 'Logs',

    // 卡片 / 工具列
    'cp.editObject': 'Edit custom object',
    'cp.export.title': 'Export components backup as a JSON or YAML file',
    'cp.import.title': 'Import components from a JSON or YAML backup file',

    // 空狀態
    'cp.empty.info': 'No status boards yet. Click "+ NEW OBJECT" above to create one.',
    'cp.empty.switch': 'No toggle objects yet. Click "+ NEW OBJECT" above to create one.',
    'cp.empty.function': 'No quick commands yet. Click "+ NEW OBJECT" above to create one.',

    // 抽屜介紹
    'cp.intro.title': 'Custom Control Components',
    'cp.intro.desc': 'Build InfoBox status boards, SwitchBox two-way toggles, or FunctionBox composite command buttons for efficient and secure local & SSH operations.',

    // 抽屜標題
    'cp.drawer.editTitle': 'Edit Custom Control Object',
    'cp.drawer.newTitle': 'New Custom Control Object',

    // 表單欄位
    'cp.field.name': 'Object Name',
    'cp.field.color': 'Object Color',
    'cp.field.type': 'Object Type',
    'cp.field.remoteCmd': 'SSH Remote Command',
    'cp.field.localCmd': 'Local Machine Command',
    'cp.field.exportVars': 'Export Variable Names (optional)',
    'cp.field.switchDesc': 'Description',
    'cp.field.queryCmd': 'Status Query SSH Command (Query Command)',
    'cp.field.displayStyle': 'Display Style',
    'cp.field.displayName': 'Display Name',
    'cp.field.matchValue': 'Match Value (Match)',
    'cp.field.stateACmd': 'SSH Command to switch to State A',
    'cp.field.stateBCmd': 'SSH Command to switch to State B',

    // 型別選項
    'cp.type.function': 'FunctionBox (Command)',
    'cp.type.info': 'InfoBox (Status)',
    'cp.type.switch': 'SwitchBox (Toggle)',

    // 配色選項
    'cp.color.classicBlue': 'Classic Blue',
    'cp.color.awsYellow': 'AWS Bright Yellow',
    'cp.color.ubuntuOrange': 'Ubuntu Orange',
    'cp.color.ecoGreen': 'Eco Green',
    'cp.color.warningRed': 'Warning Red',
    'cp.color.nebulaPurple': 'Nebula Purple',
    'cp.color.rosePink': 'Rose Pink',
    'cp.color.glacierCyan': 'Glacier Cyan',
    'cp.color.amberGold': 'Amber Gold',
    'cp.color.mintEmerald': 'Mint Emerald',
    'cp.color.indigoNight': 'Indigo Night',
    'cp.color.coralCrimson': 'Coral Crimson',
    'cp.color.tealHorizon': 'Teal Horizon',
    'cp.color.spaceSlate': 'Space Slate',

    // InfoBox 項目
    'cp.info.itemsLabel': 'Monitored Status Items',
    'cp.info.addItem': '+ Add Item',
    'cp.info.remove': 'Remove',
    'cp.info.keyShort': 'Key',
    'cp.info.cmdShort': 'SSH Command',

    // Placeholder
    'cp.ph.remoteCmd': 'e.g. uptime && free -m',
    'cp.ph.localCmd': 'e.g. open https://google.com',
    'cp.ph.exportVars': 'e.g. ID,IP (comma-separated)',
    'cp.ph.infoKey': 'Key (e.g. CPU)',
    'cp.ph.infoCmd': 'SSH Command (e.g. top -b -n 1...)',
    'cp.ph.switchDesc': 'e.g. Switch between production and testing environments',
    'cp.ph.queryCmd': "e.g. grep '^url:' /opt/goio/config.yaml",
    'cp.ph.stateACmd': "e.g. sed -i 's/testing/production/g' config.yaml",
    'cp.ph.stateBCmd': "e.g. sed -i 's/production/testing/g' config.yaml",

    // 驗證 toast
    'cp.toast.infoNeedItem': 'Please fill in at least one valid monitored item for the status board.',
    'cp.toast.needQuery': 'Please fill in the status query command.',
    'cp.toast.needStateLabels': 'Please fill in the display names for State A and State B.',
    'cp.toast.needCommand': 'Please fill in at least one SSH or local OS command.',

    // 匯出 / 匯入 toast
    'cp.toast.exportOk': 'Control panel components exported successfully; the backup file has been saved.',
    'cp.toast.exportFail': 'Failed to export components: {error}',
    'cp.toast.readFail': 'Failed to read backup file: {error}',
    'cp.toast.invalidFormat': 'Invalid backup file format (must contain the "components" custom object settings)!',
    'cp.toast.importOk': 'Control panel components imported successfully!',
    'cp.toast.importFail': 'Failed to import settings: {error}',
    'cp.confirm.importMsg': 'Importing will merge and de-duplicate with your existing custom control panel components. Continue?',
    'cp.confirm.importTitle': 'Confirm Import',

    // 執行 toast
    'cp.toast.switchInfo': 'SwitchBox toggle components render in the terminal sidebar, letting you toggle state in real time.',
    'cp.toast.noSession': 'No active connection. Cannot run control commands. Please double-click a Hosts card to connect first.',
    'cp.toast.notSupportedLog': 'The log playback tab does not support the control panel.',
    'cp.toast.notSupportedLocal': 'The local terminal tab does not support the control panel.',
    'cp.toast.infoAutoPoll': 'InfoBox status components poll automatically in the background; view status directly in the terminal sidebar.',

    // 執行確認
    'cp.exec.remoteTag': '[Remote]',
    'cp.exec.localTag': '[Local]',
    'cp.confirm.execMsg': 'The following commands are about to run:\n\n{commands}\n\nAre you sure you want to run them?',
    'cp.confirm.execTitle': 'Confirm Command Execution',

    // 執行結果
    'cp.exec.remoteFail': 'SSH command execution failed: {error}',
    'cp.exec.exportFail': 'Variable parsing failed: {error}',
    'cp.exec.localFail': 'Local sandbox blocked or execution failed: {error}',
    'cp.exec.failTitle': 'FunctionBox Execution Failed',
    'cp.exec.done': 'FunctionBox "{name}" completed',
    'cp.exec.error': 'Execution error: {error}',
    'cp.exec.running': 'Running',

    // Runtime error 訊息
    'cp.err.remoteFailed': 'Remote command execution failed',
    'cp.err.localFailed': 'Local command execution failed',
    'cp.err.missingVars': 'Remote output is missing required variables: {vars}',

    'cp.unknownError': 'Unknown error',
  },
  zhHant: {
    // 左側選單
    'cp.menu.hosts': 'Hosts',
    'cp.menu.controlPanel': 'Control Panel',
    'cp.menu.integrations': 'Integrations',
    'cp.menu.kubernetes': 'Kubernetes',
    'cp.menu.keychain': 'Keychain',
    'cp.menu.forwarding': 'Port Forwarding',
    'cp.menu.snippets': 'Snippets',
    'cp.menu.knownHosts': 'Known Hosts',
    'cp.menu.logs': 'Logs',

    // 卡片 / 工具列
    'cp.editObject': '編輯自訂物件',
    'cp.export.title': '將組件備份匯出為 JSON 或 YAML 檔案',
    'cp.import.title': '從備份的 JSON 或 YAML 檔案匯入組件',

    // 空狀態
    'cp.empty.info': '尚無狀態看板，請點選上方「+ NEW OBJECT」建立',
    'cp.empty.switch': '尚無狀態切換物件，請點選上方「+ NEW OBJECT」建立',
    'cp.empty.function': '尚無快捷指令，請點選上方「+ NEW OBJECT」建立',

    // 抽屜介紹
    'cp.intro.title': '自訂控制組件',
    'cp.intro.desc': '建立 InfoBox 狀態看板、SwitchBox 雙向開關或 FunctionBox 複合指令按鈕，實現高效率本機與 SSH 安全維運。',

    // 抽屜標題
    'cp.drawer.editTitle': '編輯自訂控制物件',
    'cp.drawer.newTitle': '新增自訂控制物件',

    // 表單欄位
    'cp.field.name': '物件名稱',
    'cp.field.color': '物件配色',
    'cp.field.type': '物件類型',
    'cp.field.remoteCmd': 'SSH 遠端指令',
    'cp.field.localCmd': '本地本機指令',
    'cp.field.exportVars': '導出環境變數名稱 (選填)',
    'cp.field.switchDesc': '說明描述',
    'cp.field.queryCmd': '查詢狀態 SSH 指令 (Query Command)',
    'cp.field.displayStyle': '顯示樣式',
    'cp.field.displayName': '顯示名稱',
    'cp.field.matchValue': '狀態匹配值 (Match)',
    'cp.field.stateACmd': '切換為 State A 的 SSH 指令',
    'cp.field.stateBCmd': '切換為 State B 的 SSH 指令',

    // 型別選項
    'cp.type.function': 'FunctionBox (指令)',
    'cp.type.info': 'InfoBox (狀態)',
    'cp.type.switch': 'SwitchBox (開關)',

    // 配色選項
    'cp.color.classicBlue': '經典藍色',
    'cp.color.awsYellow': 'AWS 亮黃',
    'cp.color.ubuntuOrange': 'Ubuntu 橘',
    'cp.color.ecoGreen': '生態綠色',
    'cp.color.warningRed': '警告紅色',
    'cp.color.nebulaPurple': '絢麗紫色 (Nebula Purple)',
    'cp.color.rosePink': '玫瑰粉色 (Rose Pink)',
    'cp.color.glacierCyan': '冰川青色 (Glacier Cyan)',
    'cp.color.amberGold': '琥珀金色 (Amber Gold)',
    'cp.color.mintEmerald': '薄荷翡翠 (Mint Emerald)',
    'cp.color.indigoNight': '靛藍星空 (Indigo Night)',
    'cp.color.coralCrimson': '珊瑚深紅 (Coral Crimson)',
    'cp.color.tealHorizon': '蒂芬妮綠 (Teal Horizon)',
    'cp.color.spaceSlate': '太空灰藍 (Space Slate)',

    // InfoBox 項目
    'cp.info.itemsLabel': '監控狀態項目',
    'cp.info.addItem': '+ 新增項目',
    'cp.info.remove': '移除',
    'cp.info.keyShort': 'Key',
    'cp.info.cmdShort': 'SSH Command',

    // Placeholder
    'cp.ph.remoteCmd': '例如：uptime && free -m',
    'cp.ph.localCmd': '例如：open https://google.com',
    'cp.ph.exportVars': '例如：ID,IP (逗號分隔)',
    'cp.ph.infoKey': 'Key (例如: CPU)',
    'cp.ph.infoCmd': 'SSH Command (例如: top -b -n 1...)',
    'cp.ph.switchDesc': '例如：切換正式與測試環境',
    'cp.ph.queryCmd': "例如：grep '^url:' /opt/goio/config.yaml",
    'cp.ph.stateACmd': "例如：sed -i 's/testing/production/g' config.yaml",
    'cp.ph.stateBCmd': "例如：sed -i 's/production/testing/g' config.yaml",

    // 驗證 toast
    'cp.toast.infoNeedItem': '狀態看板請至少填寫一個有效的監控項目。',
    'cp.toast.needQuery': '請填寫狀態查詢指令。',
    'cp.toast.needStateLabels': '請填寫 State A 與 State B 的顯示名稱。',
    'cp.toast.needCommand': '請至少填寫一個 SSH 或本地 OS 指令。',

    // 匯出 / 匯入 toast
    'cp.toast.exportOk': '控制面板組件設定匯出成功，備份檔案已儲存。',
    'cp.toast.exportFail': '匯出設定失敗：{error}',
    'cp.toast.readFail': '讀取備份檔案失敗：{error}',
    'cp.toast.invalidFormat': '無效的備份檔案格式（必須包含 components 自訂組件設定）！',
    'cp.toast.importOk': '控制面板組件設定匯入成功！',
    'cp.toast.importFail': '匯入設定失敗：{error}',
    'cp.confirm.importMsg': '匯入將會與您現有的自訂控制面板組件合併並去重。是否確定繼續？',
    'cp.confirm.importTitle': '確認匯入',

    // 執行 toast
    'cp.toast.switchInfo': 'SwitchBox 狀態切換組件會在終端機側邊欄中渲染，供您即時進行狀態雙向開關切換。',
    'cp.toast.noSession': '未建立活動連線，無法執行控制指令。請先點選雙擊 Hosts 卡片連線。',
    'cp.toast.notSupportedLog': '歷史日誌回放分頁不支援控制面板。',
    'cp.toast.notSupportedLocal': '本機終端分頁不適用控制面板。',
    'cp.toast.infoAutoPoll': 'InfoBox 狀態組件為背景自動輪詢查詢，請直接在終端機側邊欄中查看狀態資訊。',

    // 執行確認
    'cp.exec.remoteTag': '[遠端]',
    'cp.exec.localTag': '[本機]',
    'cp.confirm.execMsg': '即將執行以下指令：\n\n{commands}\n\n確定要執行嗎？',
    'cp.confirm.execTitle': '確認執行指令',

    // 執行結果
    'cp.exec.remoteFail': 'SSH 指令執行失敗：{error}',
    'cp.exec.exportFail': '變數解析失敗：{error}',
    'cp.exec.localFail': '本機安全沙箱攔截或執行失敗：{error}',
    'cp.exec.failTitle': 'FunctionBox 執行失敗',
    'cp.exec.done': 'FunctionBox「{name}」執行完成',
    'cp.exec.error': '執行出錯: {error}',
    'cp.exec.running': '執行中',

    // Runtime error 訊息
    'cp.err.remoteFailed': '遠端指令執行失敗',
    'cp.err.localFailed': '本機指令執行失敗',
    'cp.err.missingVars': '遠端輸出缺少必要變數：{vars}',

    'cp.unknownError': '未知錯誤',
  },
  ja: {
    // 左側選單
    'cp.menu.hosts': 'Hosts',
    'cp.menu.controlPanel': 'Control Panel',
    'cp.menu.integrations': 'Integrations',
    'cp.menu.kubernetes': 'Kubernetes',
    'cp.menu.keychain': 'Keychain',
    'cp.menu.forwarding': 'Port Forwarding',
    'cp.menu.snippets': 'Snippets',
    'cp.menu.knownHosts': 'Known Hosts',
    'cp.menu.logs': 'Logs',

    // 卡片 / 工具列
    'cp.editObject': 'カスタムオブジェクトを編集',
    'cp.export.title': 'コンポーネントのバックアップを JSON または YAML ファイルとしてエクスポート',
    'cp.import.title': 'バックアップした JSON または YAML ファイルからコンポーネントをインポート',

    // 空狀態
    'cp.empty.info': 'ステータスボードはまだありません。上の「+ NEW OBJECT」をクリックして作成してください。',
    'cp.empty.switch': 'トグルオブジェクトはまだありません。上の「+ NEW OBJECT」をクリックして作成してください。',
    'cp.empty.function': 'クイックコマンドはまだありません。上の「+ NEW OBJECT」をクリックして作成してください。',

    // 抽屜介紹
    'cp.intro.title': 'カスタム制御コンポーネント',
    'cp.intro.desc': 'InfoBox ステータスボード、SwitchBox 双方向トグル、または FunctionBox 複合コマンドボタンを作成し、効率的で安全なローカルおよび SSH 運用を実現します。',

    // 抽屜標題
    'cp.drawer.editTitle': 'カスタム制御オブジェクトを編集',
    'cp.drawer.newTitle': 'カスタム制御オブジェクトを追加',

    // 表單欄位
    'cp.field.name': 'オブジェクト名',
    'cp.field.color': 'オブジェクトの配色',
    'cp.field.type': 'オブジェクトの種類',
    'cp.field.remoteCmd': 'SSH リモートコマンド',
    'cp.field.localCmd': 'ローカルマシンコマンド',
    'cp.field.exportVars': 'エクスポートする環境変数名（任意）',
    'cp.field.switchDesc': '説明',
    'cp.field.queryCmd': 'ステータス照会 SSH コマンド (Query Command)',
    'cp.field.displayStyle': '表示スタイル',
    'cp.field.displayName': '表示名',
    'cp.field.matchValue': 'ステータス一致値 (Match)',
    'cp.field.stateACmd': 'State A に切り替える SSH コマンド',
    'cp.field.stateBCmd': 'State B に切り替える SSH コマンド',

    // 型別選項
    'cp.type.function': 'FunctionBox (コマンド)',
    'cp.type.info': 'InfoBox (ステータス)',
    'cp.type.switch': 'SwitchBox (トグル)',

    // 配色選項
    'cp.color.classicBlue': 'クラシックブルー',
    'cp.color.awsYellow': 'AWS ブライトイエロー',
    'cp.color.ubuntuOrange': 'Ubuntu オレンジ',
    'cp.color.ecoGreen': 'エコグリーン',
    'cp.color.warningRed': 'ワーニングレッド',
    'cp.color.nebulaPurple': 'ネビュラパープル (Nebula Purple)',
    'cp.color.rosePink': 'ローズピンク (Rose Pink)',
    'cp.color.glacierCyan': 'グレイシャーシアン (Glacier Cyan)',
    'cp.color.amberGold': 'アンバーゴールド (Amber Gold)',
    'cp.color.mintEmerald': 'ミントエメラルド (Mint Emerald)',
    'cp.color.indigoNight': 'インディゴナイト (Indigo Night)',
    'cp.color.coralCrimson': 'コーラルクリムゾン (Coral Crimson)',
    'cp.color.tealHorizon': 'ティールホライズン (Teal Horizon)',
    'cp.color.spaceSlate': 'スペーススレート (Space Slate)',

    // InfoBox 項目
    'cp.info.itemsLabel': '監視ステータス項目',
    'cp.info.addItem': '+ 項目を追加',
    'cp.info.remove': '削除',
    'cp.info.keyShort': 'Key',
    'cp.info.cmdShort': 'SSH Command',

    // Placeholder
    'cp.ph.remoteCmd': '例：uptime && free -m',
    'cp.ph.localCmd': '例：open https://google.com',
    'cp.ph.exportVars': '例：ID,IP（カンマ区切り）',
    'cp.ph.infoKey': 'Key（例: CPU）',
    'cp.ph.infoCmd': 'SSH Command（例: top -b -n 1...）',
    'cp.ph.switchDesc': '例：本番環境とテスト環境を切り替える',
    'cp.ph.queryCmd': "例：grep '^url:' /opt/goio/config.yaml",
    'cp.ph.stateACmd': "例：sed -i 's/testing/production/g' config.yaml",
    'cp.ph.stateBCmd': "例：sed -i 's/production/testing/g' config.yaml",

    // 驗證 toast
    'cp.toast.infoNeedItem': 'ステータスボードには有効な監視項目を少なくとも 1 つ入力してください。',
    'cp.toast.needQuery': 'ステータス照会コマンドを入力してください。',
    'cp.toast.needStateLabels': 'State A と State B の表示名を入力してください。',
    'cp.toast.needCommand': 'SSH またはローカル OS コマンドを少なくとも 1 つ入力してください。',

    // 匯出 / 匯入 toast
    'cp.toast.exportOk': 'コントロールパネルのコンポーネント設定を正常にエクスポートし、バックアップファイルを保存しました。',
    'cp.toast.exportFail': '設定のエクスポートに失敗しました：{error}',
    'cp.toast.readFail': 'バックアップファイルの読み込みに失敗しました：{error}',
    'cp.toast.invalidFormat': '無効なバックアップファイル形式です（components カスタムコンポーネント設定を含む必要があります）！',
    'cp.toast.importOk': 'コントロールパネルのコンポーネント設定を正常にインポートしました！',
    'cp.toast.importFail': '設定のインポートに失敗しました：{error}',
    'cp.confirm.importMsg': 'インポートすると既存のカスタムコントロールパネルコンポーネントとマージされ、重複が除去されます。続行しますか？',
    'cp.confirm.importTitle': 'インポートの確認',

    // 執行 toast
    'cp.toast.switchInfo': 'SwitchBox トグルコンポーネントはターミナルのサイドバーに表示され、リアルタイムで双方向にステータスを切り替えられます。',
    'cp.toast.noSession': 'アクティブな接続がありません。制御コマンドを実行できません。まず Hosts カードをダブルクリックして接続してください。',
    'cp.toast.notSupportedLog': 'ログ再生タブはコントロールパネルに対応していません。',
    'cp.toast.notSupportedLocal': 'ローカルターミナルタブはコントロールパネルに対応していません。',
    'cp.toast.infoAutoPoll': 'InfoBox ステータスコンポーネントはバックグラウンドで自動的にポーリングします。ターミナルのサイドバーで直接ステータスを確認してください。',

    // 執行確認
    'cp.exec.remoteTag': '[リモート]',
    'cp.exec.localTag': '[ローカル]',
    'cp.confirm.execMsg': '以下のコマンドを実行しようとしています：\n\n{commands}\n\n実行してもよろしいですか？',
    'cp.confirm.execTitle': 'コマンド実行の確認',

    // 執行結果
    'cp.exec.remoteFail': 'SSH コマンドの実行に失敗しました：{error}',
    'cp.exec.exportFail': '変数の解析に失敗しました：{error}',
    'cp.exec.localFail': 'ローカルサンドボックスによるブロックまたは実行に失敗しました：{error}',
    'cp.exec.failTitle': 'FunctionBox の実行に失敗しました',
    'cp.exec.done': 'FunctionBox「{name}」の実行が完了しました',
    'cp.exec.error': '実行エラー: {error}',
    'cp.exec.running': '実行中',

    // Runtime error 訊息
    'cp.err.remoteFailed': 'リモートコマンドの実行に失敗しました',
    'cp.err.localFailed': 'ローカルコマンドの実行に失敗しました',
    'cp.err.missingVars': 'リモート出力に必要な変数がありません：{vars}',

    'cp.unknownError': '不明なエラー',
  },
};

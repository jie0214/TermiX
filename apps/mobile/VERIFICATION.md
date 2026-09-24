# 手機版第 1 張票驗證紀錄

日期：2026-09-23。

範圍：可執行的手機版外殼、四分頁、主機新增與保存。後續 SSH／Kubernetes／同步功能不在本次完成宣告內。

## 自動檢查

- TypeScript 型別檢查：通過。
- ESLint：通過。
- 公開主機儲存介面：5 項測試通過。
- React Native 使用者操作流程：3 項測試通過。
- Expo Doctor：21／21 項通過。
- iOS 與 Android JavaScript／資產 export：通過；這不是 Android 原生建置證據。
- iOS Debug 模擬器原生建置：通過，0 個錯誤、1 個警告。
- iOS Release 模擬器原生建置：通過，0 個錯誤、2 個警告；包含 Expo Dev Launcher 產生的建置腳本每次執行的相依警告。

已關閉 Metro 開發伺服器、重啟 iPhone 17 Pro 模擬器，直接啟動 Release App；畫面正常顯示主機空清單、四個分頁與右下角新增按鈕。

測試曾先重現並修正：未實作持久化、無效欄位仍寫入、資料損毀處理、並行新增遺失資料，以及 hostname 夾帶連接埠被保存。

## Standards

初次審查沒有規範違反，提出 1 項非阻擋的 Duplicated Code 維護性建議：首次載入與重試重複。已統一讀取流程，保留首次載入的卸載保護；修正後複查無未解決項目。

## Spec

初次審查發現 1 項 P2：`example.com:2222` 可被保存為主機位址，但 port 仍是 22。已區分 hostname／IPv4／IPv6，拒絕混入連接埠，並新增公開介面回歸測試；修正後複查無未解決項目。

審查基準為 `05ddaa54360c933d03fce44ba12a7d82c6909ead`，審查提交為 `7c10e19` 與 `7197dd6`。

## 驗證限制

- 尚未完成實體 iPhone 與 Android 的互動驗收。
- 自動化 UI 測試替換外部儲存邊界，不等於真機 SQLite 重開驗證。
- 已透過 Xcode Device Hub 操作模擬器，補驗新增與強制重開；大字體與完整鍵盤／捲動情境仍需裝置驗收。
- 規格與票單目前沒有發布成 GitHub Issues。

## 新增主機驗證方式補充

- 原因：第一階段主機表單與資料契約尚未提供密碼／私鑰欄位；已以畫面測試重現缺漏並補齊。
- 已通過 9 項公開儲存介面測試與 10 項畫面／檔案匯入測試、型別檢查、Lint、iOS／Android 資產 export。
- 涵蓋憑證與一般資料分離、重建服務後讀回、舊版資料保留、Keychain 失敗不新增主機、一般資料保存失敗清除憑證、匯入期間停用儲存，以及匯入成功／過大／讀取失敗後清理暫存。
- 私鑰密碼正確性與遠端 SSH 驗證仍未實作；本次驗收限驗證方式設定、安全保存與匯入操作。
- Expo Doctor：21／21 項通過；新版 iOS Release 原生建置通過，0 個錯誤、2 個產生式建置腳本警告。
- 在獨立 iPhone 17 Pro／iOS 26.5 測試模擬器中，以測試憑證完成密碼型主機保存，強制重開後主機與驗證方式仍保留。憑證讀回另由公開儲存介面測試驗證。
- 原生操作確認 SSH 私鑰選項、選填密語欄位，以及檔案選擇器開啟與取消；取消後表單恢復可操作。原生實際私鑰檔案匯入尚未驗收，匯入與清理邊界已有自動測試。
- 測試模擬器已移除；原本的模擬器已更新並停在新增主機表單，未加入測試主機。
- Standards 與 Spec 平行審查以 `12afa8c` 為基準、審查 `9a90710`，均無未解決發現。

## 第 2 張票：單一 SSH 密碼連線

日期：2026-09-23。範圍見 `TICKETS.md`。

### 自動驗證

- 15 項 TypeScript 公開邊界測試、11 項 React Native 畫面／匯入測試通過。
- Go `go test -race ./...` 通過：真實 loopback SSH server 驗證首次指紋確認前不送密碼、拒絕與金鑰變更不送密碼、已知金鑰登入、錯誤密碼、Unicode 收發、PTY／window-change、取消握手與單一 session。
- TypeScript、ESLint、iOS／Android JavaScript 資產 export、Expo Doctor 21／21 通過。
- iOS Release 原生建置通過，0 個錯誤、2 個 Expo 產生式建置腳本警告。
- Android 的 Java binding 已產生並核對 Kotlin 接口；此環境未安裝 Android SDK／NDK，未執行 Android 原生建置，不能用資產 export 代替該驗證。

### iOS 模擬器操作

使用獨立 iPhone 17 Pro／iOS 26.5 模擬器，以及只監聽 loopback 的 SSH 測試 server；shell 使用真實 PTY，未接觸使用者既有主機。

1. 新增密碼型測試主機，首次連線顯示的 SHA-256 指紋與測試 server 一致；確認後進入 shell。
2. 執行 `printf` 收到 `SSH_OK 中文`；`stty size` 回報鍵盤展開時為 19 列／49 欄，收起後為 34 列／49 欄。
3. 原生鍵盤展開時終端與輸入區皆可見；送出後保持鍵盤，可點終端收起。
4. 切至背景再恢復，明確顯示已中斷；手動中斷也能回到可重新連線狀態。
5. 強制結束並安裝新版、重開後，使用已保存的 Keychain 密碼及已知主機公鑰成功登入，不再次要求信任同一公鑰。
6. 測試模擬器與 server 已清除；原本模擬器停在新版主機頁，未混入測試資料。

尚未驗收：實體 iPhone、其他尺寸／大字體、原生中文組字過程（已驗證 Unicode 傳送顯示）、Android 裝置。私鑰登入與快捷控制鍵依票單順序待後續實作。

### Standards

以 `cd24287` 為基準審查，初次及 `11246a5` 複查均無規範違反或未解決發現。

### Spec

初次發現 1 項 P2：舊輪詢失敗的延遲清理會覆蓋新 session 狀態。已透過公開流程重現，於 `90a85c7` 補上清理後的 session 檢查並新增回歸測試。複查未解決項目為 0。


## 第 3 張票：SSH 私鑰登入

日期：2026-09-23。實作提交：`d7a8fe5`。

### 自動驗證

- 18 項 TypeScript 公開邊界測試、12 項 React Native 畫面／匯入測試通過。
- Go `go test -race ./...` 通過：OpenSSH 明文與加密 Ed25519、RSA PKCS#1、EC SEC1、Ed25519 PKCS#8、傳統加密 RSA PEM 皆透過真實 SSH server 登入。
- 缺少／錯誤密語、毀損私鑰、不支援格式會在建立 TCP 連線前失敗；公鑰未授權、主機金鑰變更、密碼登入及既有 session 流程回歸通過。
- 密語修正僅更新安全儲存；保存失敗不重新連線，重新建立 repository 可讀回修正後資料。
- TypeScript、ESLint、iOS／Android JavaScript 資產 export 通過。
- iOS Release 原生建置通過，0 個錯誤、2 個 Expo 產生式建置腳本警告。

### iOS 模擬器操作

使用隔離的 iPhone 17 Pro／iOS 26.5 模擬器及僅監聽 loopback、停用密碼登入的 SSH 測試 server。

1. 透過原生檔案選擇器匯入加密 Ed25519 私鑰，未填密語時顯示缺少密語提示。
2. 輸入錯誤測試密語後顯示解密失敗；修正後保存並重試，顯示與測試 server 相符的主機指紋，確認後登入。
3. 終端執行 `printf` 收到 `KEY_AUTH_OK`，原生鍵盤展開時輸出與輸入區皆可見。
4. 強制結束 App 並重開，直接使用已保存的私鑰、修正後密語及已知主機公鑰成功登入。
5. 檢查隔離 App 資料目錄，無私鑰完整內容副本與 DocumentPicker 快取檔；來源檔案仍存在且內容一致。
6. 測試模擬器、server 與自建測試金鑰已清除；原本模擬器保留最新版 App，不混入測試資料。

### Standards 與 Spec

以 `f94d022` 為基準，平行審查 `d7a8fe5`；兩項審查均無未解決發現。

### 驗證限制

- 尚未完成實體 iPhone、其他尺寸／大字體及 Android 原生建置與裝置驗收。
- 加密 PKCS#8、DSA 與硬體金鑰等格式不支援，會顯示明確錯誤。
- 快捷指令與控制鍵留待第 4 張票。


## 第 4 張票：終端快捷鍵與常用指令

日期：2026-09-23。實作提交：`2161403`、`d185012`。

### 自動驗證

- 20 項 TypeScript 公開邊界測試、15 項 React Native 使用者流程測試通過。
- 新增涵蓋：常用指令並行新增、重建 repository 讀回、刪除、控制碼／多行拒絕、損毀資料保護、儲存失敗重試、刪除確認與取消。
- 終端驗證面板關閉與重開、草稿加 Tab 的輸入順序、Ctrl+C／上方向鍵、選取不執行、草稿取代確認，以及斷線移除面板。
- TypeScript、ESLint、`git diff --check`、iOS／Android JavaScript 資產 export 通過。
- iOS Release 模擬器原生建置成功；建置仍含套件產生式腳本及 Hermes 對 bundle 全域變數的警告，沒有建置錯誤。本票未修改原生 SSH 核心。

### iOS 模擬器操作

使用隔離 iPhone 17 Pro／iOS 26.5 模擬器，以及只監聽 loopback 的真實 SSH 測試 server。

1. 從設定開啟 SSH 常用指令，新增測試名稱與 `printf` 指令；成功後清空輸入並顯示保存項目。
2. 真實 SSH 登入後，終端小按鈕可開啟、關閉並重開快捷面板，控制鍵與常用指令皆可見。
3. 選取常用指令後僅填入原生輸入框，遠端沒有執行；按「送出」後收到 `SHORTCUT_OK`。
4. 輸入 `pw` 後按 Tab，文字送到遠端而不執行；接著選取常用指令會顯示先傳送 Ctrl+C 的確認。確認後遠端回到新提示符號，指令只填入輸入框。
5. 強制結束並重開 App，常用指令仍可讀回。刪除時先取消，項目仍存在；再次確認刪除後顯示空清單。
6. 隔離模擬器與測試 server 已清除，原本模擬器已更新最新版 App，未加入測試資料。

Tab 是否補全、方向鍵如何作用由遠端 shell／程式決定；本次測試 shell 沒有提供 Tab 補全。實體 iPhone、Android 原生建置與裝置、其他尺寸及大字體仍待驗收。

### Standards

以 `1f8f8cc` 為基準審查 `2161403`，未發現規範違反或需處理的維護性問題。

### Spec

初次發現 1 項 P2：快捷操作後遠端仍可能有未提交輸入，直接填入常用指令會接在後方。先以 UI 測試重現，再於 `d185012` 加入遠端輸入狀態與明確的 Ctrl+C 確認；複查無未解決發現。


## 第 5 張票：匯入 kubeconfig 並查看 Pod

日期：2026-09-23。實作提交：`b13147e`、`532462b`。

### 自動驗證

- TypeScript 公開邊界與 React Native 畫面測試通過，包含匯入、重開讀回、namespace 切換、錯誤不沿用舊 Pod、儲存失敗與匯入／切換競態。
- Go `go test -race ./...` 通過。使用真實 HTTPS 測試 server 驗證內嵌 CA、Bearer token、目前 context、Pod 解析、Pending `0/2`、401／403、TLS 失敗及拒絕重導向傳送 token。非 HTTPS、略過 TLS、exec／用戶端憑證等未支援方式於連線前拒絕。
- TypeScript、ESLint、iOS／Android JavaScript 資產 export 通過。
- iOS Release 原生建置通過；Kubernetes 與 SSH 核心共用單一 Go framework，解決初次雙框架造成的 gomobile runtime 重複符號。

### iOS 模擬器操作

使用隔離 iPhone 17 Pro／iOS 26.5 模擬器及僅監聽 loopback、具測試 CA 和 Bearer token 的 HTTPS Kubernetes API server。

1. 在設定以原生檔案選擇器匯入 kubeconfig，顯示目前 context `local · qa` 及匯入成功。
2. 進入 Kubernetes 分頁查詢 `dev`，真實 API 回傳 `api-0` Running `1/1` 與 `worker-0` Pending `0/2`。
3. 強制結束、安裝修正版並重開 App，已加密保存的 kubeconfig 可讀回，同一 API 再次成功查詢。
4. 切至 `empty` namespace 顯示無 Pod；切至無權限的 namespace 顯示權限不足，不殘留舊 Pod。
5. App 私有文件目錄只含 AES-GCM 加密檔；在匯入完成後檢查未找到測試 token 明文或 DocumentPicker 快取，使用者來源檔仍存在。檔案選擇器短暫生成的系統 Inbox 副本其後由系統清除。
6. 隔離模擬器、測試 server 與測試憑證已清除；原本的模擬器已更新新版 App，未加入測試叢集資料。

### Standards 與 Spec

以 `9fe0d3c` 為基準審查。初次發現匯入／namespace 競態、Pending Pod 就緒總數、自訂 CA 信任範圍及註解語言問題；`532462b` 修正後兩軸複查均無未解決發現。

### 驗證限制

- 尚未在實體 iPhone、其他尺寸／大字體及 Android 裝置上驗收。本機未安裝 Android SDK，`gomobile bind -target=android` 無法執行，因此尚無本票新版 Android binding 或完整 App 建置證據。
- 本票只支援內嵌 Bearer token、目前 context、HTTPS 與單次最多 200 個 Pod。用戶端憑證登入屬第 6 張票；其他資源、Log、縮放及資源用量屬後續票。

## 第 6 張票：Kubernetes 用戶端憑證登入

日期：2026-09-23。實作提交：`820f1b3`、`c7bcce4`、`e48f92b`。

### 自動驗證

- TypeScript、ESLint、25 項領域測試與 22 項畫面／外部邊界測試通過；iOS／Android JavaScript 資產 export 通過。
- Go `go test -race ./...` 通過。真實 mTLS server 驗證用戶端身分、憑證模式不送 Bearer header，以及不可信用戶端被拒絕；涵蓋缺少配對、無效 base64、不匹配私鑰、過期、尚未生效與混合驗證拒絕，既有 token 測試保持通過。
- iOS／iOS Simulator Go framework 與最終 iOS Release App 建置通過。
- 匯入錯誤保留舊設定且不顯示原始機密；快取與 Inbox 清理涵蓋成功、檔案過大、讀取錯誤及清理失敗。SSH 私鑰使用相同清理入口。

### iOS 模擬器操作

在隔離 iPhone 17 Pro／iOS 26.5 模擬器及只監聽 loopback 的 HTTPS server 驗證：

1. 透過原生檔案選擇器匯入內嵌憑證 kubeconfig，查看 `certificate-pod` Running `1/1`。Server 確認真實用戶端憑證身分 `mobile-client`，未收到 Authorization header。
2. 強制結束及重開 App，讀回加密保存設定並再次成功查詢。
3. 匯入不匹配私鑰顯示安全錯誤提示，原設定保留，重新查詢仍成功。
4. 文件目錄存在 AES-GCM 加密檔；另發現 UIKit 在 App 的 `tmp/<bundle>-Inbox` 留有明文匯入副本。原有流程僅清理 Expo 快取，因此新增限定 App Inbox、檔名與普通檔案檢查的原生清理，亦套用 SSH 私鑰。失敗不回傳匯入內容。
5. 首次清理複驗因 Mac 鎖定而中止；後續已完成解鎖後的隔離模擬器操作驗證，結果見下方「機密匯入暫存清理複驗」。

隔離模擬器、測試 server 與測試憑證已清除；原有模擬器已安裝並啟動最終版本。

### Standards

基準 `de8cce1`。憑證實作無新增規範發現；原生檢查揭露 Inbox 副本後補上清理，審查另指出 SSH 私鑰有同源缺口，已共用修正。

### Spec

基準 `de8cce1`。憑證登入需求未發現缺漏、範圍擴張或實作錯誤；原生清理操作驗證亦已完成；Standards 與 Spec 對共用修正複查均無未解決發現。

### 驗證限制

- 實體 iPhone 與 Android 未驗收。本機缺少 Android SDK，未取得新版 Android binding 或完整 Android App 建置證據。
- 僅支援內嵌 PEM 憑證及未加密私鑰；外部檔案參照、exec、auth-provider、加密私鑰與混合 token／憑證不支援。
- 舊版本已產生的 Inbox 副本不做全面遷移清除；本次清理處理每次選取的同名匯入副本。


### 機密匯入暫存清理複驗

針對 `e48f92b` 最終 Release App，在全新隔離 iPhone 17 Pro／iOS 26.5 模擬器透過原生檔案選擇器操作：

- 有效憑證 kubeconfig：顯示匯入成功，文件目錄產生 AES-GCM 加密檔，UIKit Inbox 與 Expo DocumentPicker 快取均為空。
- 無效私鑰 kubeconfig：顯示安全錯誤，原 context 及加密檔保留；兩處暫存均為空。
- 超過 256 KB 的 kubeconfig：拒絕匯入，顯示大小限制，兩處暫存仍為空。
- OpenSSH Ed25519 私鑰：主機表單顯示「私鑰已匯入」，兩處暫存均為空。本次僅驗證匯入清理，未新增主機或重測 SSH 登入。
- 掃描 App 資料容器中的檔案，未找到測試私鑰 PEM／OpenSSH 原文或其完整 base64 內容；逐一比對 4 份使用者來源檔，內容均保持完整。
- 強制結束與重開 App 後，仍可讀回原本的 `local · cleanup-qa`、namespace `dev`。本次沒有執行網路查詢，mTLS 證據沿用本票前述已完成測試。

本次只更新驗收文件，未修改程式碼；未重跑已通過且程式碼未變的完整測試或建置。已執行 `git diff --check`。隔離模擬器與測試檔案於驗收後清除；實體手機、Android 及舊副本遷移限制維持不變。

## 第 7 張票：查看工作負載與 ConfigMap

日期：2026-09-23。實作提交：`aa5c95e`。

### 自動驗證

- TypeScript、ESLint、27 項領域測試、23 項畫面／外部邊界測試通過；iOS／Android JavaScript 資產 export 通過。
- Go `go test -race ./...` 通過。真實 HTTPS server 驗證 apps/v1 工作負載、core/v1 ConfigMap 路徑、GET 與 token、副本數及 0 副本、清單不包含設定值、二進位大小、明細 Unicode 截斷與項目限制。
- 401／403／404、錯誤資源／namespace、無效與過大回應安全處理；既有 Pod、TLS、mTLS 與 redirect 測試保持通過。
- 畫面與領域測試涵蓋分類切換、明細開關／重試、唯讀不寫入儲存、切換 namespace 或關閉明細後過期回應不得重新顯示。
- iOS／iOS Simulator Go framework 與 iOS Release App 原生建置通過；iOS 與 Android 均已加入相同資源 API 橋接。

### iOS 模擬器操作

使用隔離 iPhone 17 Pro／iOS 26.5 模擬器及只監聽 loopback 的 HTTPS API server：

1. 原生檔案選擇器匯入設定，Pod 查詢顯示 `web-0` Running `1/1`。
2. Deployment 顯示 `web` 就緒 `2/3`、已更新 `1`，以及 `paused` 就緒 `0/0`。
3. StatefulSet 顯示 `database` 就緒 `1/2`、已更新 `2`，切換分類沒有殘留上一類資源。
4. ConfigMap 清單點選 `settings` 後開啟明細，顯示不可變更、多行文字、二進位 `3 bytes` 及長文字截斷提示。
5. 明細開啟時按 Home 進入背景，返回同一 App process 後明細已關閉，內容不再顯示。
6. 切換 `forbidden` namespace，403 顯示權限不足且不保留舊清單；`empty` 顯示沒有 ConfigMap。
7. 強制結束及重開後讀回叢集設定，Deployment 再次查詢成功。
8. 測試 server 僅收到 GET。掃描 App 資料容器未找到測試 ConfigMap 值或 token 明文；Inbox 與 DocumentPicker 快取為空。

隔離模擬器、測試 server 與憑證於驗收後清除；原本模擬器更新為本票版本，沒有放入測試叢集設定。

### Standards

以 `4238eb8` 為基準獨立審查：0 項發現。共用既有網路安全限制、原生平台接入及公開行為測試。

### Spec

以 `4238eb8` 為基準獨立審查：0 項發現。未發現需求缺漏、範圍擴張或實作錯誤。

### 驗證限制

- 尚未在實體 iPhone、其他尺寸／大字體與 Android 裝置驗收。本機缺少 Android SDK，未取得新版 Android binding 或完整 Android App 建置證據。
- 只支援目前 namespace 的有限唯讀查詢；清單與明細依票單限制截斷，binaryData 不顯示原始內容。大於 2 MB 的 API 回應拒絕解析。
- 本次原生操作使用受控 HTTPS API server，未連線正式 Kubernetes 叢集；Log、縮放、metrics 屬後續票。


## 第 8 張票：查看容器 Log

日期：2026-09-23。實作提交：`8d0b96b`。

### 自動驗證

- TypeScript、ESLint、29 項領域測試與 24 項畫面／外部邊界測試通過；iOS／Android JavaScript 資產 export 通過。
- Go `go test -race ./...` 通過。真實 HTTPS 測試涵蓋容器種類、GET 路徑與授權、previous／follow／tailLines／limitBytes／timestamps 參數、200 行與 64 KB 限制、UTF-8、空紀錄及錯誤回應。
- 畫面與領域測試涵蓋切換容器、前次紀錄、重試、關閉與 namespace 切換後過期回應不得重新顯示，以及不寫入儲存。
- iOS／iOS Simulator Go framework 與 iOS Release App 建置通過。iOS 與 Android 原生橋接均加入相同 Log API。

### iOS 模擬器操作

使用隔離 iPhone 17 Pro／iOS 26.5 模擬器及只監聽 loopback 的 HTTPS API server：

1. 原生檔案選擇器匯入 kubeconfig，查詢 Pod 並開啟 Log，自動載入第一個容器，正確顯示多行中文。
2. 切換一般、初始化與臨時容器，顯示對應 Log；前次執行切換成功，手動更新產生新 GET。
3. 沒有前次紀錄的 400 與權限不足的 403 顯示安全訊息，不顯示伺服器錯誤內文，原內容已清除。
4. 空回應顯示沒有紀錄；超過 64 KB 的回應顯示截斷提示。
5. 面板開啟時按 Home 進入背景，返回同一 App process 後 Log 面板已關閉。
6. server 只收到 GET，查詢均為 follow=false 並帶有行數、位元組與時間戳記限制。掃描 App 資料容器未找到測試 Log 或 token 明文；Inbox 與 DocumentPicker 快取為空。

隔離模擬器、測試 server 與憑證於驗收後清除。原本模擬器已安裝並啟動本票 Release 版本，沒有加入測試叢集設定。

### Standards

以 `11e6297` 為基準獨立審查：0 項發現。

### Spec

以 `11e6297` 為基準獨立審查：0 項發現。

### 驗證限制

- 尚未在實體 iPhone、其他尺寸／大字體與 Android 裝置驗收。本機缺少 Android SDK，未取得新版 Android binding 或完整 Android App 建置證據。
- 原生驗收使用受控 HTTPS API server，未連線正式 Kubernetes 叢集。
- 僅提供最近 200 行、上限 64 KB 的手動 Log 查詢，沒有持續串流、下載或歷史保存。縮放與 metrics 屬後續票。


## 第 9 張票：調整工作負載副本數

日期：2026-09-24。實作提交：`32a7f8d`；審查修正：`7afd2cc`。

### 自動驗證

- TypeScript、ESLint、33 項領域測試及 25 項畫面／外部邊界測試通過；最終 iOS／Android JavaScript 資產 export 通過。
- Go `go test -race ./...` 通過。真實 HTTPS 驗證 Deployment／StatefulSet scale GET／PUT、授權、autoscaling/v1、UID／resourceVersion 與 0 副本。
- 驗證非法種類／路徑／副本數不傳送；401／403／404／409／422／500／redirect 不洩漏錯誤內容、不重送。無效成功回應與同名不同 UID 回應標示結果不確定。
- 使用者操作驗證輸入、返回修改、0 副本提示及明確確認；領域測試涵蓋重複送出、送出中關閉／匯入／變更目標、未送出前取消，以及衝突／結果不明必須重新讀取再確認。
- iOS／iOS Simulator Go framework 與 iOS Release App 建置通過。初次以 CODE_SIGNING_ALLOWED=NO 建置造成模擬器 Keychain 存取失敗，改用 CODE_SIGN_IDENTITY=- 完成 ad-hoc 簽章後，匯入與保存恢復正常；最終驗收使用有簽章版本。

### iOS 模擬器操作

使用隔離 iPhone 17 Pro／iOS 26.5 與只監聽 loopback 的受控 HTTPS API server：

1. 透過原生檔案選擇器匯入 kubeconfig，讀取 Deployment 與其 scale，顯示目前期望副本 3。
2. 點選副本欄位出現原生數字鍵盤，輸入欄及「檢查變更」均可見。輸入 0 後顯示叢集、context、namespace、種類、資源名稱與 3 → 0，並提醒停止所有副本。
3. 明確確認後只有一筆 PUT，顯示 API 已接受、不代表就緒；重新讀取取得 0。舊清單已移除，關閉面板保留結果提示。
4. StatefulSet 從 2 調整為 4，server 確認收到一次 PUT 並保存 4。
5. 409 顯示「資源已變更，請重新讀取後再確認」；重新讀取回到編輯狀態。403 顯示沒有調整權限，不顯示伺服器錯誤內容；兩者均無自動重送。
6. 在待確認 4 → 6 時按 Home，返回同一 App process 後面板已清除，server 沒有收到該變更的 PUT。
7. 掃描 App 資料容器未找到測試 token 明文；Inbox 與 DocumentPicker 匯入暫存為空。

原本模擬器已安裝並啟動本票 Release 版本，沒有加入測試設定。隔離模擬器、測試 server、憑證與測試 kubeconfig 已清除。

### Standards

以 `57ae42c` 為基準獨立審查。1 項維護性建議：集中查詢失效邏輯；已在 `7afd2cc` 修正，複查無新增問題，未解決項目為 0。

### Spec

以 `57ae42c` 為基準獨立審查。1 項 P2：PUT 成功回應需比對確認時 UID；已新增先失敗後通過的回歸測試並修正，複查未解決項目為 0。

### 驗證限制

- 尚未在實體 iPhone、其他尺寸／大字體與 Android 裝置驗收。本機缺少 Android SDK，未取得新版 Android binding 或完整 Android App 建置證據。
- 原生驗收使用受控 HTTPS API server，沒有操作正式 Kubernetes 叢集；真實叢集 RBAC／admission policy／HPA 行為尚未端到端驗收。
- 只支援手動 scale，不追蹤 rollout 完成、不管理 HPA；寫入連線中斷時不能保證遠端未生效，因此須重新讀取且不自動重送。


## 第 10 張票：查看簡易資源用量

日期：2026-09-24。實作提交：`531af8e`。

### 自動驗證

- TypeScript、ESLint、34 項領域測試及 26 項畫面／外部邊界測試通過；iOS／Android JavaScript 資產 export 通過。
- Go `go test -race ./...` 通過。真實 HTTPS 驗證 Metrics API GET 路徑、Bearer 授權、容器合計、CPU／記憶體各種單位、零／極小值、科學記號與 UTC 採樣時間。
- 非法與缺失 Quantity、負數、非有限值、溢位／下溢、錯誤身分、缺失欄位、重複容器、無效時間／window 及超大回應不顯示猜測數值；401／403／404／503／500／redirect 回傳固定安全錯誤。
- 畫面與領域測試涵蓋手動開啟／更新、採樣與合計呈現、缺失提示與重試、清除舊值、關閉後過期回應不復活、切換 namespace 清除及不寫入儲存。
- iOS／iOS Simulator Go framework 與 ad-hoc 簽章的 iOS Release App 建置通過；iOS／Android 均加入相同用量 API 橋接。

### iOS 模擬器操作

使用隔離 iPhone 17 Pro／iOS 26.5 與只監聽 loopback 的 HTTPS API server：

1. 原生檔案選擇器匯入 kubeconfig，Pod 清單保留 Log 操作，新增獨立「用量」入口。
2. `web` 顯示 CPU 合計 150 m、記憶體 96 MiB；容器分別為 125 m／64 MiB 與 25 m／32 MiB。採樣時間、30 秒區間與資料限制均可見。
3. 手動更新產生新的 GET 與採樣時間，沒有自動輪詢。
4. 404 提示尚無資料或沒有 Metrics API；503 提示服務暫不可用；403 提示權限不足；缺少記憶體欄位提示資料不完整。均未顯示伺服器錯誤內容或假的零用量。
5. 真正零值顯示 CPU 0 m／記憶體 0 MiB；1 n CPU 與 1 byte 記憶體均顯示 <0.01，未四捨五入為 0。
6. 用量面板開啟時按 Home，返回同一 App process 後面板已清除。
7. 掃描 App 資料容器未找到測試 token 或已顯示採樣時間原文；Inbox 與 DocumentPicker 快取為空。server 僅收到 GET。

原本模擬器已安裝並啟動本票 Release 版本，沒有加入測試設定。隔離模擬器、測試 server、憑證與 kubeconfig 已清除。

### Standards

以 `486db7b` 為基準獨立審查：0 項發現。

### Spec

以 `486db7b` 為基準獨立審查：0 項發現。

### 驗證限制

- 尚未在實體 iPhone、其他尺寸／大字體與 Android 裝置驗收。本機缺少 Android SDK，未取得新版 Android binding 或完整 Android App 建置證據。
- 原生驗收使用受控 HTTPS API server，未連線正式 Kubernetes／Metrics Server。
- 僅查詢 metrics.k8s.io/v1beta1 的指定 Pod；只提供 v1 的叢集尚未支援。數值為已回報容器的採樣，不含缺失容器、不代表即時或整個叢集用量；沒有歷史圖表、requests／limits 百分比或自動更新。


## 第 11 張：桌面設定同步（2026-09-24）

實作 CloudKit 與檔案匯入兩種方式，使用者可自行選擇。僅一般 SSH 主機設定；完整範圍、格式與建置設定見 [SYNC.md](SYNC.md)。本次沒有可用的 CloudKit 容器及 provisioning profile，因此不宣稱已完成真實 Apple ID 跨裝置同步。

### 自動檢查

- 手機 `npm run typecheck`、`npm run lint` 通過。
- 手機 `npm test` 通過：45 項領域測試、28 項 UI／匯入邊界測試，共 73 項。
- `npm run export` 完成 iOS 與 Android JavaScript 打包。
- 桌面 `go test ./...` 通過；`go test -race ./backend/mobilecloud ./backend/hostvault ./backend/app ./shared/mobilesettings` 通過。
- 桌面前端型別檢查、152 項前端測試、17 項契約測試與 Vite build 通過。
- 描述檔驗證的 Python 測試及 `bash -n scripts/macos-release.sh` 通過，沒有執行正式簽署、公證或上傳。
- `wails build -skipbindings -s -m -nosyncgomod -platform darwin/arm64` 成功產生桌面 App。
- Expo prebuild 與 pod install 後，iOS Release simulator 建置成功（arm64／x86_64，ad hoc 簽章；未直接修改產生的原生工程）。
- `git diff --check` 通過。

新增測試涵蓋白名單匯出、不相容資料整份拒絕、重複匯入、手機本機主機保留、憑證隔離、儲存失敗、模式切換／背景回應、SSH 期間暫停，以及同步提交和舊終端密語修改的競態。不得把 CloudKit 邊界測試當作真實雲端驗收。

### iOS 原生驗證

使用隔離的 iPhone 17 Pro／iOS 26.5 模擬器與桌面 `HostVault.ExportMobileSettings` 實際產生的測試 JSON：

1. 設定頁可進入同步設定並切換關閉、CloudKit、檔案模式。
2. 未設定 CloudKit 容器的建置經真實 Swift bridge 回覆未設定提示，沒有假成功或崩潰。
3. 使用原生 Files 選擇器選取設定，先顯示「1 台主機」，確認後才匯入。
4. 主機清單顯示匯入主機；首次點選進入驗證畫面，補上僅供測試的密碼後保存成功，清單顯示密碼驗證。
5. 再匯入同來源／同 ID、名稱與位址已改變的檔案，清單仍只有 1 筆，名稱與位址更新；點選後重新要求驗證，密碼欄位空白。
6. 終止並重開 App，更新後主機及檔案同步模式仍保留。
7. 檢查隔離 App 資料容器，匯入檔案的 Cache／Inbox 副本已清除，一般資料庫不含測試密碼。

原本的 iPhone 模擬器已安裝並啟動新版，停留在同步設定供使用者驗證，沒有加入測試主機。隔離模擬器與本次產生的資料庫／JSON fixture 已清除。

### Standards

基準 `c7aa5c0`。共用檔案匯入清理流程並補上 CloudKit 帳號查詢期限後，複核無未解決項目。

### Spec

基準 `c7aa5c0`。修正模式切換時已提交資料未刷新，以及舊終端密語重試可能修改新目標憑證兩項發現；重現測試先失敗後通過，複核無未解決項目。

### 驗證限制

- CloudKit 同 Apple ID 真實上傳／下載、帳號切換、離線恢復及多裝置行為，仍需同一容器、相符環境與正式 Apple 簽章後驗收；設定步驟見 SYNC.md。
- 檔案原生驗收使用本機 Files 儲存區；真實 iCloud Drive 帳號與其他檔案供應者未實測。
- 未在實體 iPhone 或 Android 裝置驗收；本機缺少 Android SDK，僅有跨平台 TypeScript／JavaScript 打包證據。
- macOS 僅驗證 arm64 開發建置；正式 universal、描述檔簽署與公證沒有執行。


## 第 12 張：語言切換與保存（2026-09-24）

### 自動驗證

- `npm run typecheck`、`npm run lint`、`git diff --check` 通過。
- `npm test`：49 項 domain 測試、29 項 UI 測試，共 78 項通過。新增測試涵蓋預設值、重建後恢復、讀取失敗／未知語言不覆蓋原值、保存失敗重試、寫入期間避免重複切換，以及參數原文保留。
- UI 測試使用真實語言與主機服務，確認切換英文／日文後表單與已出現的錯誤更新、未送出的中文名稱保留，重新掛載仍使用日文。切換測試先在未翻譯表單時失敗，套用後通過。
- `npm run export`：iOS、Android JavaScript bundle 匯出成功。
- Xcode Release iOS Simulator 建置成功，使用 ad hoc 簽章，未新增原生依賴或更改產生的工程。

### iOS 原生驗證

隔離的 iPhone 17 Pro／iOS 26.5 模擬器：

1. 首次啟動使用繁體中文；設定提供 3 種語言，選取狀態正確。
2. 選取 English 後立即更新語言頁、設定、分頁與主機畫面。
3. 英文主機表單與密碼／私鑰選項可見；空白保存顯示英文密碼驗證訊息。
4. 切換日本語，語言頁標籤與說明完整呈現，未見裁切。
5. 終止並重開 App，主機與分頁仍為日文；Kubernetes 未匯入提示亦為日文。

原本的 iPhone 模擬器已更新並啟動，停留繁體中文語言選擇頁；沒有加入測試主機。隔離測試裝置已移除。

### Standards

基準 `f8850c7`，審查 `bf83163`：0 項硬性違規、0 項需處理的 smell。語言與儲存分層、機密邊界及使用者操作測試符合規則。

### Spec

基準 `f8850c7`，審查 `bf83163`：0 項發現。三語切換、持久化、失敗保留及使用者原文符合第 12 張票；provider 與終端來源維持穩定。

### 驗證限制

- 未在實體 iPhone 或 Android 裝置驗收；本機缺少 Android SDK，Android 僅有跨平台型別、測試及 JavaScript 打包證據。
- 本票原生驗收涵蓋三語選擇與基本畫面，未逐一實測所有 SSH／Kubernetes 成功及錯誤畫面的三語排列，也未在真實連線中切換語言。既有連線測試通過，翻譯不更動連線服務。
- 系統鍵盤、檔案選擇器與系統權限提示仍由作業系統語言控制。

## 外觀切換追加需求（2026-09-24）

### 自動驗證

- TypeScript、ESLint、`git diff --check` 通過。
- `npm test`：51 項 domain、30 項 UI，共 81 項通過。新增外觀預設值、三種模式保存恢復、無效值保留、保存失敗重試、系統變動、固定模式及表單內容保留測試。
- 終端 UI 測試使用真實 session 與替代 SSH 邊界，驗證連線期間切換深色仍保留未送出的指令，沒有額外 start／disconnect，之後可送出並手動中斷。
- iOS／Android JavaScript bundle 匯出成功；Expo prebuild、Pods 更新及 Xcode Release Simulator 建置成功，使用 ad hoc 簽章。沒有直接修改產生的原生工程。

### iOS 原生驗證

隔離 iPhone 17 Pro／iOS 26.5 模擬器：

1. 預設跟隨系統，設定顯示外觀入口與三種選項。
2. 選取深色後背景、文字、卡片及狀態列立即更新；切回跟隨系統恢復裝置淺色。
3. 在隔離模擬器的系統設定啟用深色，回到 App 後跟隨為深色。
4. 系統深色時仍可固定 App 淺色；終止並重開後保持淺色，設定入口正確顯示所選值。
5. 深色主機表單、欄位、鍵盤及同步選項對比正常。

隔離裝置已清除。原本的模擬器已更新新版，供使用者從設定進入外觀選擇。

### Standards

基準 `b824ec6`：無硬性違規。1 項非阻擋維護性觀察：語言與外觀偏好儲存邏輯相似，未來增加更多設定時可統一抽取；本次保留各功能邊界。

### Spec

初審發現深色同步選項白字配淺色背景對比不足；`3226c6f` 改為 button／onButton 配色，複核已解決，無未解決項目。

### 驗證限制

Android 未進行原生建置或實機驗收，本機缺少 Android SDK。未在實體 iPhone 驗收，也未逐一原生檢查所有 Kubernetes 面板；終端切換不中斷的證據來自 UI／SSH 邊界測試，本次未另連真實 SSH 主機。系統啟動畫面不保證套用 App 私有儲存的模式。

## App 圖示移除外框（2026-09-24）

- 替換手機版 `assets/icon.png`，移除圖內銀白外框及外圍光暈，保留中央綠色終端與銀色 X，深色背景延伸至四邊。圖檔為 1024 × 1024、不含透明通道。
- TypeScript、ESLint、81 項既有測試與 `git diff --check` 通過；Expo prebuild、Pods 安裝及 Xcode Release Simulator 建置成功。
- 已更新原本 iPhone 17 Pro／iOS 26.5 模擬器，啟動 App 並返回主畫面目視確認，TermiX 圖示沒有白框。
- 本次僅更新手機圖示資產；Android Launcher 與實體 iPhone 尚未實測。

## Apple 風格介面（2026-09-24）

- 設定改為分組列表、細分隔線、圖示與目前值；語言／外觀使用勾選列表，子頁採箭頭返回及清楚標題。
- 系統字型、灰白／純黑分組背景與按鈕層級套用全 App；主機表單整合為分組欄位，首頁仍無標題，右下固定新增按鈕保留。刪除操作使用警示文字色，取消／關閉使用次要按鈕。
- TypeScript、ESLint、81 項測試、iOS／Android bundle 匯出、Xcode Release Simulator 建置與 `git diff --check` 通過。
- 原本 iPhone 17 Pro／iOS 26.5 模擬器已更新，目視確認深色設定列表、語言勾選頁及完整主機表單，返回與入口可操作；未加入主機、憑證或修改語言／外觀偏好。
- 以 `4dc3489` 為基準審查 `21a364b`：Standards 0 項硬性違規／需處理 smell；Spec 0 項發現。
- 新元件最小觸控高度 44 點，文字保留系統縮放並可換行，使用不透明表面；本次未新增動畫。極大輔助字體、VoiceOver 完整朗讀、小螢幕、實體 iPhone 與 Android 原生畫面尚未逐項驗收，未宣稱已完成無障礙全面驗證。

## 修正未連線終端的主題背景（2026-09-24）

- 根因：`TerminalScreen` 的未連線空白狀態未指定背景色，露出分頁預設淺色底；此狀態尚未建立 WebView。
- 在 iOS 模擬器重現深色模式白底，並以終端 UI 測試重現缺少背景色；補上 `colors.background` 後，淺色／深色切換斷言均通過。
- TypeScript、ESLint、82 項測試、iOS／Android bundle 匯出、Xcode Release Simulator 建置與 `git diff --check` 通過。
- 已安裝原本 iPhone 17 Pro／iOS 26.5 模擬器，目視確認未連線終端顯示深色背景。未改動 WebView、SSH session 或使用者外觀設定；本次未另外驗證真實遠端連線或 Android 原生畫面。

# TermiX 手機版

以 React Native、TypeScript 與 Expo development build 建立的獨立手機應用，首期以 iOS 為驗證目標，保留 Android 建置能力。

## 本次交付範圍

已交付手機版第 1 張票，並補上新增主機的登入驗證設定：

- 四個主要分頁：主機、終端、Kubernetes、設定。
- 主頁沒有產品名稱與頁面標題。
- 右下角新增按鈕固定於清單之外，捲動時不移動。
- 新增名稱、主機位址、使用者名稱與連接埠；表單沒有重複的「新增主機」標題。
- 一般連線設定保存於應用程式私有的 SQLite 儲存區，重開後保留。
- 新增主機可選密碼或 SSH 私鑰；支援匯入 OpenSSH／PEM 私鑰與選填 passphrase。
- 密碼、私鑰與 passphrase 透過 SecureStore 保存；iOS 使用解鎖時可讀取且不隨裝置備份遷移的 Keychain 項目，Android 使用 Keystore 保護的加密儲存。一般主機資料只保存驗證類型與憑證參照。
- 舊版主機保留並標記尚未設定驗證方式，不會自動產生空密碼。
- 輸入驗證、儲存失敗重試、讀取失敗禁止覆蓋、未知資料版本保留原始資料。
- 配合系統安全區域、原生輸入鍵盤與可捲動表單。

SSH 密碼連線已於第 2 張票加入，詳見下方。同步已加入 CloudKit 與檔案匯入，詳見 [SYNC.md](SYNC.md)；CloudKit 真實跨裝置驗證仍需 Apple 容器及簽章。設定已支援繁體中文、English、日本語，立即套用並保存選擇；未提供的功能不顯示假成功。單純保存設定不代表已完成遠端登入。

私鑰匯入先檢查 OpenSSH／PEM 容器格式與 32 KB 大小限制，連線時由原生 SSH 核心解析及解密。匯入只暫存於應用程式快取，讀取後立即刪除暫存副本，不刪除使用者原始檔案。平台拒絕大型 Keychain 值時會顯示保存失敗，不會改存明文；取消表單或切換驗證方式不會保存未送出的憑證。

## 語言設定

在「設定 → 語言」切換繁體中文、English 或日本語，預設繁體中文。語言代碼保存於 App 私有 SQLite 設定，與機密儲存分離。保存失敗保留原語言，可重新選取重試；無效或無法讀取的設定先回退繁體中文並提示，不自動覆蓋原值。

只翻譯 App 標籤及提示；使用者命名、常用指令、SSH 輸出與 Kubernetes 內容保持原文。切換不重新建立連線或清除表單。原生鍵盤及系統檔案選擇器使用作業系統語言。

## 啟動

需求：Node.js 24 以上、npm；iOS 本機建置需要 Xcode 與 CocoaPods，Android 需要對應 SDK。

```sh
npm ci
npm run ios
```

開啟已安裝的 development build：

```sh
npm start
```

使用 Xcode 27 建置時，iOS 27 要求 Scene 生命週期；本專案透過 `expo-build-properties` 的 `ios.enableSceneSupport` 啟用 Expo SDK 57 官方支援。修改此設定後須重新執行 `npx expo prebuild --platform ios`、`npx pod-install` 與原生建置，不能只更新 JavaScript。未啟用時會在 UIKit 的 `UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption` 檢查閃退。

真機安裝後執行以下冷啟動回歸檢查（需要 Python 3；會關閉並重啟 App，現有 SSH 連線會中斷）：

```sh
python3 scripts/check-ios-launch.py --device <裝置識別碼>
```

檢查會確認同一個程序持續運行 15 秒；失敗回傳非零狀態。這能抓出啟動後閃退，但不取代畫面、鍵盤、SSH 或 Kubernetes 功能驗收。

參考：[Expo SDK 57 的 Scene 支援](https://github.com/expo/fyi/blob/main/ios-scene-lifecycle.md#staying-on-sdk-57-with-xcode-27)。

Android 本機建置入口為 `npm run android`。首期沒有宣稱已完成 Android 真機驗收，也沒有設定雲端建置或正式簽章帳號。預設應用程式識別碼僅供開發，正式發行前需確認團隊持有的識別碼與簽章。

## 驗證

```sh
npm run typecheck
npm run lint
npm test
npm run export
```

功能測試使用主機儲存服務的公開介面與 React Native 畫面操作；只在持久化邊界替換儲存，不測私有方法。包含新增後重建服務讀回、驗證失敗不寫入、損毀資料保留、並行新增、寫入失敗重試，以及畫面成功／失敗回饋。

`npm run export` 產生 iOS 與 Android JavaScript／資產套件，不等於原生二進位建置或真機驗收。

## 目錄

- `src/app`：Expo Router 路由與主要導覽。
- `src/features/hosts`：主機表單、清單與儲存行為。
- `src/storage`：SQLite 與 SecureStore 平台接入；一般設定與機密分開保存。
- `src/components`：共用元件與色彩。
- `tests`：公開功能介面與畫面測試。

原生工程由 Expo prebuild 產生，不納入版本控制。桌面版 Wails 應用與依賴不受此專案影響。

## 尚待真機確認

- 小螢幕、大字體、長位址以及橫向安全區域的呈現。
- 原生鍵盤輸入、關閉與表單捲動。
- 新增多筆後捲動，浮動按鈕保持原位。
- 關閉程序再開啟，SQLite 主機資料仍存在。

後續依既有拆分方案加入其他 Kubernetes 等垂直功能，不以目前分頁占位畫面視為功能完成。

## 第 2 張票：SSH 密碼連線

點選密碼型主機可進入終端。首次連線顯示位址與 SHA-256 指紋，核對後才允許認證；公鑰以位址／連接埠保存，後續金鑰不符直接拒絕，不自動覆寫。切換其他主機先確認中斷；原生層也限制單一 session。進入背景會中斷，恢復後可手動重連。

終端使用離線打包的 xterm.js 與受限制的 WebView；原生文字輸入區叫出手機鍵盤，送出文字與 Enter。尺寸變動同步至遠端 PTY。第 2 張票不包含快捷控制鍵與方向鍵；私鑰登入於第 3 張票加入。命令輸出只存在有限大小的記憶體緩衝，不寫入磁碟；過量輸出會中斷並回報，不無限累積。

跨平台 SSH 核心位於 `native/ssh`，使用 `golang.org/x/crypto/ssh`；`modules/termix-ssh` 為 Expo Swift／Kotlin 接入。手機 Go module 與桌面 module 分離，未引入桌面的 Kubernetes 或 Wails 依賴。Go 工具版本由該目錄的 go.mod／go.sum 固定；首次建置需下載 Go 1.26 工具鏈。

```sh
npm ci                       # 同時產生離線終端 HTML
npm run ios                  # 先產生 iOS XCFramework，再建置 App
npm run android              # 需 Android SDK／NDK，先產生 AAR 與 JNI 函式庫
npm run test:ssh              # 真實 loopback SSH 協定測試，含 race detector
```

直接使用 `npx expo run:ios` 前須執行 `npm run build:ssh:ios`。原生產物與產生式 HTML 不提交 Git，可從鎖定依賴重建；Expo Go 不支援本機 SSH 模組。Android 接入已提供，但尚無 Android 原生建置與裝置驗收證據。

開發驗收可在 `native/ssh` 執行 `TERMIX_QA_PASSWORD=<至少12字元的測試密碼> go run ./cmd/testserver`。它只監聽 `127.0.0.1:22222`，使用者名稱為 `termix-qa`，執行目前開發者的 shell；只用於 iOS 模擬器驗收，完成後以 Ctrl+C 停止。每次啟動產生新主機金鑰，重用原主機設定會正確觸發金鑰變更保護。

參考：[Expo 原生模組整合](https://docs.expo.dev/modules/third-party-library/)、[Expo SDK 57 WebView](https://docs.expo.dev/versions/v57.0.0/sdk/webview/)、[Go Mobile](https://go.dev/wiki/Mobile)、[xterm.js UTF-8 輸出](https://xtermjs.org/docs/guides/encoding/)。

## 第 3 張票：SSH 私鑰登入

新增主機選擇「SSH 私鑰」，匯入檔案並填入密語（若有），保存後點選主機即可連線。首次仍需核對伺服器指紋；金鑰變更直接阻擋。私鑰模式只使用簽章認證，密語只供本機解密，不傳給伺服器當密碼。

支援 RSA／Ed25519／ECDSA 的 OpenSSH 私鑰，以及 RSA PKCS#1、ECDSA SEC1、未加密 PKCS#8 PEM。OpenSSH 的加密格式與傳統 RSA／EC 加密 PEM 使用既有 Go SSH 函式庫解密；加密 PKCS#8、DSA 與硬體金鑰格式目前不支援。格式或參數不支援、資料損毀、缺少密語、解密失敗與遠端拒絕授權皆會明確回報；原始解析錯誤不傳入 UI。解析器沿用鎖定依賴的 OpenSSH bcrypt 成本限制，避免不合理的加密參數長時間占用 CPU。

錯誤密語可在終端頁重新輸入，按「儲存密語並重試」更新安全儲存後再連線；不會顯示已保存的密語。重開 App 後仍可使用原本的私鑰與新密語。匯入暫存清理由原有流程處理，保存失敗不改存一般 SQLite。

公鑰認證的隔離測試 server 可使用 `TERMIX_QA_PUBLIC_KEY=/path/to/disposable-test-key.pub go run ./cmd/testserver`。只提供公鑰路徑時不開啟密碼驗證；這仍是僅供開發的 loopback server。請勿將測試用私鑰拿去實際主機授權。

解析與簽章 API 依據：[Go SSH 私鑰解析](https://pkg.go.dev/golang.org/x/crypto/ssh#ParsePrivateKeyWithPassphrase)。

## 第 4 張：快捷鍵與常用指令

已連線終端的 `⌘` 按鈕可開啟快捷面板，包含 Ctrl+C／D／L、Esc、Tab 與方向鍵。除了 Ctrl+C 會丟棄本機草稿，其餘快捷鍵會先送出輸入框文字，再送控制碼。面板可連續操作，關閉後仍以原生鍵盤輸入；「送出」送出文字與 Enter。

在設定的「SSH 常用指令」新增名稱與單行指令，刪除需確認。終端選取後只填入輸入框，按「送出」才執行；若已有草稿，先確認是否取代。指令集存入 Keychain／Keystore，不納入一般設定同步。此階段最多 50 筆、單筆 4093 字元，不支援多行或控制碼；安全儲存失敗會保留原資料並顯示錯誤。

快捷操作後若遠端可能仍有未提交輸入，選取常用指令會先詢問是否傳送 Ctrl+C，再填入指令；不默認遠端輸入已清空。


## 第 5 張：kubeconfig 與 Pod 清單

設定頁可匯入 kubeconfig。現階段讀取 `current-context`，支援內嵌 Bearer token 和 HTTPS 系統 CA／`certificate-authority-data`。Kubernetes 分頁可輸入 namespace，按「查看 Pod」讀取名稱、狀態及容器就緒數；最多顯示前 200 筆，若有續頁會明確提示。client 不執行 kubeconfig 的 exec 外掛、不接受未驗證 TLS，也不使用其中的檔案參照；用戶端憑證為第 6 張票。

原始 kubeconfig 在 App 私有文件目錄中以 AES-256-GCM 加密，金鑰保存在 Keychain／Keystore；檔案選擇器的 App 快取副本讀取後清理。匯入新檔時先寫入新的加密檔，再切換金鑰參照，失敗則保留舊設定。請只匯入可信來源的 kubeconfig。


## 桌面設定同步（第 11 張）

設定頁可選 CloudKit 或檔案匯入。桌面「更多」→「手機同步」提供一般主機設定匯出及 CloudKit 開關。兩種方式不包含任何憑證或 kubeconfig；新同步主機需在手機補上密碼／私鑰。檔案模式跨平台可用，CloudKit 需同 Apple ID 與已簽章的同一容器，完整流程及驗證限制見 [SYNC.md](SYNC.md)。

## 外觀設定

「設定 → 外觀」提供淺色、深色與跟隨系統，預設跟隨系統。選擇立即套用並保存；跟隨系統會回應裝置外觀變更，固定模式則保持所選外觀。設定保存失敗時維持原模式並提示重試。

主機、終端、Kubernetes、設定與彈出面板共用配色；SSH 終端直接更新 xterm 顏色，不重新載入 WebView 或清除輸出。外觀切換不重建 SSH 連線、不清除未送出的表單或指令。狀態列與原生控制項配合 App 外觀，系統開機／啟動畫面不屬於已載入的 App 介面。

原生設定採 `userInterfaceStyle: automatic` 與 SDK 相容的 `expo-system-ui`。修改後需重新 prebuild／建置；依據 [Expo 外觀設定](https://docs.expo.dev/develop/user-interface/color-themes/)、[Expo SDK 57 SystemUI](https://docs.expo.dev/versions/v57.0.0/sdk/system-ui/) 與 [React Native 0.86 Appearance](https://reactnative.dev/docs/0.86/appearance)。

## 主機資料夾與終端觸控

主機頁可跨資料夾搜尋名稱、位址、使用者與資料夾名稱；清除搜尋後回到原本層級。「上一層」返回父層；右下新增按鈕沿用目前資料夾。新增表單可用 `/` 分隔巢狀資料夾。資料夾由主機的路徑產生，不另外保存空資料夾。桌面同步保留主機的資料夾層級，格式相容性見 [SYNC.md](SYNC.md)。

終端單指上下拖曳瀏覽最近 1,000 列歷史；輕點輸出區收起鍵盤，拖曳不收起。終端留白由 xterm 元素本身處理，讓 FitAddon 扣除留白後才計算列數，避免最後一列被裁切。

`npx playwright install webkit chromium` 安裝瀏覽器後，執行 `npm run test:terminal` 驗證實際打包終端的觸控事件捲動與不同可用高度。測試使用合成觸控事件，不替代真機手勢及原生鍵盤驗收。

## AWS profiles 與 EKS 驗證

先匯入 kubeconfig，再到「設定 → AWS profiles」新增與 `AWS_PROFILE`／`--profile` 同名的 profile；未指定時使用 `default`。填入 Region、Access Key ID、Secret Access Key，暫時憑證另需 Session Token。手機呼叫 AWS STS `GetCallerIdentity` 驗證成功後才保存。這是 IAM Access Key／STS 暫時憑證登入，不是 AWS Console 密碼或 IAM Identity Center SSO 瀏覽器登入。

- 可更新憑證、停用、重新啟用及刪除；更新已停用的 profile 不會自動啟用。
- profile 中繼資料與憑證皆使用獨立的 Expo SecureStore service；iOS 為裝置解鎖時可用且不移轉裝置的 Keychain，Android 使用 Keystore 保護的加密儲存。不寫入 SQLite、CloudKit、一般設定匯出或日誌。
- 停用保留憑證但阻止新的 Kubernetes 操作；刪除移除手機中的 profile 與憑證，不撤銷 AWS 上的 IAM key。停用或刪除不撤回已送出的請求，但尚未送出的延遲 token 會丟棄。
- 每次 Kubernetes 操作以 AWS SigV4 重新簽發 `k8s-aws-v1` token，綁定 `x-k8s-aws-id`，不把 token 寫回持久化 kubeconfig。所有 Pod、資源、Log、縮放及用量查詢共用此流程。不自動重送縮放操作。
- 暫時 AWS 憑證本身到期後仍需重新輸入；無法以已到期的 Session Token 延長 AWS 登入。使用者仍需具備 EKS 存取設定與 Kubernetes RBAC 權限，以及能連線到叢集的網路。
- 僅辨識標準 `aws eks get-token`，支援 `--region`、`--cluster-name`／`--cluster-id`、`--profile`、`--role-arn`、`--output json`，以及 `AWS_PROFILE`、`AWS_REGION`、`AWS_DEFAULT_REGION`。必須提供 Region；不讀取桌面的 profile 設定檔。`--role-arn` 透過 STS AssumeRole 取得短期憑證，並沿用帳號既有 IAM 權限。
- 任意 exec、其他命令、自訂端點、停用 TLS 驗證參數及其他環境變數一律拒絕；不執行 CLI、shell、腳本，也不自動複製 Mac 的 AWS 金鑰。

參考：[AWS EKS kubeconfig](https://docs.aws.amazon.com/eks/latest/userguide/create-kubeconfig.html)、[AWS IAM authenticator token](https://github.com/kubernetes-sigs/aws-iam-authenticator/blob/master/pkg/token/token.go)、[Expo SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/)。

## 多叢集選擇

匯入 kubeconfig 後，可在 Kubernetes 頁面點選目前叢集，搜尋並切換 context；同一叢集的不同帳號或 namespace 會分別列出。選擇會寫回加密 kubeconfig 的 `current-context`，重開 App 後保留；其餘叢集及驗證設定不會移除。切換時清除舊查詢、Log 與資源用量，縮放送出期間禁止切換。

個別 context 的驗證設定不支援時仍可匯入並選擇其他叢集。EKS 連線時才檢查對應 AWS profile；缺少、停用或憑證過期會顯示原因並停止此次請求，不影響其他 context。AWS profiles 的操作鈕只顯示「更新／停用或啟用／刪除」。

## 叢集連線與資源狀態

- EKS 的 AWS profile 可在 Kubernetes 頁面選擇，按 context 保存於加密 kubeconfig。僅列出同 AWS partition 的 profile；已停用的項目不可選。可回復 kubeconfig 原始 profile。選擇不改寫原始 exec，也不影響共用 user 的其他 context；Region、叢集名稱及 Role ARN 沿用原設定。刪除或停用已選 profile 後，後續請求會顯示失敗。
- 進入頁面、切換 context 或 AWS profile 後，自動讀取 `/api/v1/namespaces`。下拉選單可搜尋，每頁 200 筆並支援載入更多。列出 namespace 需要對應 RBAC 權限；沒有權限時顯示原因，仍保留 kubeconfig 指定的 namespace 供查詢。切換 namespace 會清空舊資源結果。
- 資源名稱搜尋不分大小寫，範圍為目前已載入的最多 200 筆；清單未完整載入時顯示提示。
- Pod 使用 Ready condition 與容器失敗狀態判定；Deployment／StatefulSet 使用 controller 已觀察的 generation、就緒副本與失敗 condition，Deployment 另檢查可用副本。以圖示、顏色及文字標示健康／不健康，另區分啟動或更新中、已完成、已停止、終止中、未知。ConfigMap 不標示健康。這是查詢當下的 Kubernetes 狀態，不是持續監控或外部服務端點探測。

依據：[Kubernetes namespace API](https://kubernetes.io/docs/reference/kubernetes-api/core/namespace-v1/)、[Deployment 狀態](https://kubernetes.io/docs/reference/kubernetes-api/apps/deployment-v1/)、[StatefulSet 狀態](https://kubernetes.io/docs/reference/kubernetes-api/apps/stateful-set-v1/)。

## 手機 Kubernetes 清單與設定導覽

- 「設定 → Kubernetes」集中選擇叢集 context、AWS profile 與匯入 kubeconfig。主頁只顯示目前叢集名稱，namespace 篩選仍放在資源頁。
- 原設定首頁的「AWS profiles」入口改為「雲端帳號」，目前內含 AWS 帳號與憑證管理。GCP／Azure 尚未實作，未呈現可操作入口；未更動既有安全儲存服務與 profile 識別碼。
- 主頁採橫向資源分類與精簡清單：名稱、健康、就緒數，異常列底色提示並可只看異常。Pod 清單以單次 Metrics API 查詢補上 CPU／記憶體；缺少資料或查詢失敗不當作零，也不阻擋資源顯示。
- 點選 Pod 後提供 Log／用量，點選 Deployment 或 StatefulSet 後提供副本調整；ConfigMap 仍開啟唯讀內容。回到資源頁或更換查詢條件時重新整理，離開頁面關閉敏感明細。
- 清單更新時間代表最近的資源查詢，CPU／記憶體為 Metrics API 採樣資料。搜尋及異常數只涵蓋目前載入的最多 200 筆。

## 用量與上限、Log 相容性

- Kubernetes 連線設定的欄位與選單統一稱「雲端帳號」，目前提供 AWS profile 綁定。
- Pod 清單與用量面板以「已用／上限」、百分比及進度條呈現 CPU／記憶體；達 70% 提醒、90% 警示。超過 100% 保留實際百分比，僅限制進度條寬度。
- 分母優先取 Pod-level limits，否則取一般容器與 restartable init sidecar 的 limits 合計。任一容器未設定該項上限，就不把部分合計當成總上限。requests 不作為上限；無上限、未知上限、無採樣與不完整採樣均明確區分。上限來自最近的 Pod 清單設定，CPU／記憶體來自 Metrics API 採樣。
- Log 修正：只送 `Accept: text/plain` 時，實際 Kubernetes API 的格式協商回傳 HTTP 406，手機因此顯示「叢集回應無效」。改成 `application/json, */*` 後，同一 Pod、同一查詢參數取得 HTTP 200 及文字 Log。測試與診斷不保存或輸出使用者 Log 內容，原有 200 行／64 KB 上限不變。

參考：[Kubernetes 資源 requests 與 limits](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/)。

「雲端帳號」提供「新增雲端帳號 → 選擇雲端供應商」流程，目前只列出 AWS，選取後進入既有 AWS 帳號管理與新增表單；GCP／Azure 不顯示未實作選項。

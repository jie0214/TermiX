# 桌面至手機的一般主機設定同步

## 使用方式

桌面主機頁右上「更多」→「手機同步」，選擇匯出檔案或啟用 CloudKit。手機「設定」→「同步設定」，依建置能力選擇「關閉／iCloud 同步／檔案匯入」。兩種傳輸方式共用同一份白名單格式，手機一次使用一種方式。

- 檔案：桌面匯出 `termix-mobile-settings.json`，存到 iCloud Drive、其他檔案供應者或傳到手機。手機選檔、確認主機筆數後匯入。檔案不會自動重新讀取；更新時再次匯入。不需要 CloudKit 簽章，Android 也可使用。
- CloudKit：桌面與 iPhone 使用相同 Apple ID、相同 iCloud 容器及環境。桌面啟用後在 App 開啟時每 30 秒上傳；手機啟用後，在前景每 30 秒及恢復前景時讀取，也可立即同步。不是背景常駐或即時推播。手機 SSH 連線期間暫停套用。
- 首次匯入的主機在清單標示「尚未設定驗證方式」。點選後在手機補上密碼或私鑰，再返回清單連線。憑證只保存在此裝置的 Keychain／Keystore。
- 更名保留本機憑證；位址、連接埠或使用者名稱改變時停用憑證，要求重新設定。既有 SSH 畫面也會核對目標，不能取得不同目標的新憑證。
- 重複匯入更新相同來源及主機 ID，不新增重複項目。不修改手機自行新增的主機，不同步刪除。多台桌面使用同一個雲端快照，最後成功上傳者供手機讀取；不同桌面來源的既有手機主機保留。
- 關閉同步停止後續同步，不刪除已匯入的主機或既有雲端資料。切換模式、進入背景後，尚未套用的舊回應會被丟棄。

## 資料與限制

桌面匯出版本為 `termix.mobile-settings.v2`；手機同時接受舊版 `v1`，最多 500 台主機、256 KB UTF-8 JSON。唯一允許的根欄位為 `version`、`sourceId`、`hosts`；每台主機只包含 `id`、`name`、`address`、`port`、`username`、`folderPath`。`folderPath` 是由外至內的資料夾名稱陣列，根目錄為空陣列；最多 16 層，每層 80 個 UTF-16 單位。僅包含有主機的資料夾，同名路徑合併顯示。舊版 `v1` 沒有資料夾欄位，匯入後置於根目錄。任何未列出的欄位、重複 ID、不合法連線設定或未知版本都會拒絕整份資料，不略過錯誤主機。

桌面新版格式需要搭配新版手機 App；請先更新手機，再更新桌面。資料夾移動保留同一主機的本機憑證。

密碼、私鑰、passphrase、token、憑證參照、已信任的主機金鑰、金鑰路徑、啟動指令、常用指令與 kubeconfig 都不納入。手機檔案匯入後清除 App 快取副本，不刪除使用者原始檔案。舊憑證即使因目標變動停用，也仍只存在安全儲存，不會重新自動附加。

主機名稱上限 80 個 UTF-16 單位、使用者名稱上限 128 個，不接受控制字元；連接埠為 1 至 65535。桌面來源 ID 存在一般設定的 `mobileSyncSource`，CloudKit 開關為 `mobileCloudEnabled`。手機沿用主機資料庫並保存同步來源，模式保存於 `termix.mobile.sync.v1`。

## CloudKit 建置設定

預設開發建置沒有 iCloud 容器，不顯示 iCloud 選項，不會回報成功或改用其他伺服器。正式驗證需要自行擁有且已建立的 Apple Developer Team 與 CloudKit 容器；程式不建立 Apple 帳號、憑證或容器。

1. 在 Apple Developer 為桌面 `io.github.jie0214.termix` 與 iOS `com.jie0214.termix.mobile` 啟用 iCloud／CloudKit，將兩個 App ID 關聯至同一個容器。
2. 在 CloudKit Console 的 Development 環境建立 `TermixMobileSettings` record type，加入 String 欄位 `payload`。不需額外 query index；使用 private database 的固定 record ID `desktop-settings-v1`。正式使用前將 schema 部署至 Production。
3. iOS：設定 `TERMIX_ICLOUD_CONTAINER` 為實際容器 ID，`TERMIX_ICLOUD_ENVIRONMENT` 設為 `Development` 或 `Production`，執行 `npx expo prebuild --platform ios`，再使用符合該 Team、App ID 與容器的 provisioning profile 簽章。`app.config.js` 會產生 Info.plist 與 CloudKit entitlements。環境預設 Development；與正式桌面配對時必須明確選 Production。
4. macOS 正式封裝：既有 `scripts/macos-release.sh` 另接受 `TERMIX_ICLOUD_CONTAINER` 與 `TERMIX_ICLOUD_PROFILE`（Developer ID CloudKit provisioning profile 檔案路徑）。沿用既有 `APPLE_TEAM_ID`、Developer ID 簽章與公證設定；腳本核對描述檔 Team、App ID、容器、Production 與有效期，嵌入描述檔並以 CloudKit 權限簽署外層 App。正式封裝缺少這兩個變數會停止；一般 `wails build` 開發產物仍可使用檔案模式。
5. 在兩台以同 Apple ID 登入的裝置啟用 CloudKit，確認首次上傳、手機讀回、桌面更名更新、手機目標改變後要求驗證，以及離線／未登入錯誤。不可將僅通過 mock 測試或未簽章模擬器建置視為雲端驗收完成。

Android 的同步介面與檔案匯入共用 TypeScript；不顯示 iCloud 選項。Windows／Linux 桌面僅提供手機設定匯出。沒有加入第三方帳號或自建同步伺服器。

官方依據：[Apple iCloud 設定](https://developer.apple.com/documentation/xcode/configuring-icloud-services)、[CloudKit 私有資料庫](https://developer.apple.com/documentation/cloudkit/ckcontainer/privateclouddatabase)、[Expo iOS capabilities](https://docs.expo.dev/build-reference/ios-capabilities/)、[Expo SDK 57 DocumentPicker](https://docs.expo.dev/versions/latest/sdk/document-picker/)。

## 本機 Apple 帳號設定（2026-09-24）

- Team：`8B5QT36Q7V`；共用容器：`iCloud.com.jie0214.termix`。
- 已在 Apple Developer 建立並關聯桌面與手機 App ID，`TermixMobileSettings.payload`（String）已部署至 Production。
- 這台 Mac 的手機建置環境保存於不提交 Git 的 `apps/mobile/.env.local`，使用 Production；其他開發機仍需自行提供前述環境變數。
- Expo SDK 57 的 DocumentPicker 預設外掛會移除 CloudKit 環境 entitlement；`plugins/with-cloudkit.cjs` 在該外掛執行後補回明確設定。回歸測試使用 Expo introspect，驗證完整外掛鏈產出的 Development／Production 環境與共用容器。
- Apple 的 Developer ID 描述檔可用 `*` 授權 iCloud services；桌面簽章腳本接受此授權，但實際 App 僅請求 `CloudKit`。同時支援 Wails 產生、不帶 XML 宣告的 Info.plist。

容器與 schema 建立成功不代表同 Apple ID 的完整同步驗收通過；須另外確認桌面上傳與手機讀回結果。簽章描述檔與 App 產物不提交 Git。

## 平台能力與正式發佈檢查

手機由原生建置資訊回報 iCloud 能力；iOS 的實際簽章權限在封存後驗證，Android 不載入 CloudKit。桌面從原生平台、Info.plist 與程序 entitlement 判斷能力。不支援／未配置時隱藏 iCloud 選項，且原本保存為 cloud 的模式不會自動執行；不覆寫原始偏好。帳號未登入或離線不影響能力判斷，保留入口供登入或重試。

正式 iOS 封存：`APPLE_TEAM_ID=<Team> npm run archive:ios`。此入口要求 CloudKit 容器與 Production，完成後以 `scripts/check-apple-cloud.py` 核對實際簽署 App；未通過不可提交。Xcode／其他工具匯出後的最終 App 也須執行相同檢查。一般本機開發建置仍允許未配置 iCloud。

macOS GitHub Actions 必須新增 Variable `TERMIX_ICLOUD_CONTAINER` 與 Secret `TERMIX_ICLOUD_PROFILE_BASE64`（Developer ID CloudKit 描述檔的 Base64），缺少任一設定立即停止。CI 僅在臨時目錄解碼描述檔，完成後清除。變更程式碼不會自動替 GitHub 設定這兩個值。

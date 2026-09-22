# macOS 正式簽署與公證

TermiX 採用 Developer ID 在 Mac App Store 外發佈，Bundle ID 固定為 `io.github.jie0214.termix`。發佈流程會建置 Apple Silicon／Intel 通用版，依序完成 Developer ID Application 簽署、Hardened Runtime、公證、附加公證票證與 Gatekeeper 驗證，全部通過才產生 ZIP。

這份流程不會讓既有 Release 的未簽署檔案自動取得公證；是否為正式簽署版本，應以該次 Release 的產物為準。

## 本機準備

1. 安裝 Xcode，完成首次啟動設定，並確認 `xcode-select -p` 指向完整 Xcode。
2. 在 Xcode 的 Apple Accounts 選擇付費開發者團隊，開啟 Manage Certificates，建立 **Developer ID Application**。憑證必須連同私鑰存在本機鑰匙圈；Apple Development 或 Apple Distribution 不能替代。
3. 從憑證名稱或 Apple Developer 會員資料確認 10 碼 Team ID。
4. 在自己的終端機執行以下指令，依互動提示輸入 Apple Account、Team ID 與 App 專用密碼。API private key 路徑提示可留空，以使用 Apple Account 登入方式。

```sh
xcrun notarytool store-credentials termix-notary
```

密碼直接輸入終端機，不寫入專案、對話或 shell 指令紀錄。公證憑證會儲存在本機鑰匙圈。

## 本機建置與驗證

```sh
export APPLE_TEAM_ID='你的 10 碼 Team ID'
export MACOS_NOTARY_PROFILE=termix-notary
bash scripts/macos-release.sh --check
CGO_LDFLAGS='-framework UniformTypeIdentifiers' wails build -platform darwin/universal
bash scripts/macos-release.sh build/bin/TermiX.app dist/TermiX-macos.zip
```

`--check` 只檢查工具及有效簽署身分，不代表公證帳號已通過驗證。若同一 Team 有多張有效憑證，設定 `MACOS_SIGNING_IDENTITY` 為指定憑證的 SHA-1 指紋或完整名稱。

腳本會核對 Bundle ID、版本號與兩種架構，簽署 App 複本，保留原始建置產物。已有同名輸出時會停止；簽署或公證失敗時不產生最終 ZIP。公證提交回應與拒絕原因儲存在 `build/notarization/`，可用 `MACOS_NOTARY_LOG_DIR` 指定其他位置。等待超過 30 分鐘會停止，需檢查提交狀態後再處理。

首次完成後，將 ZIP 解壓縮到測試位置，實際驗證啟動、本機終端、SSH、SFTP、Kubernetes 與選單列功能。目前未加入 Hardened Runtime 例外權限；若 Apple 回報具體需求，應依原因調整，不預先放寬權限。

## GitHub Actions 設定

發布流程在公開儲存庫 `jie0214/TermiX` 的版本 tag 上執行，因此請在該儲存庫的 **Settings → Secrets and variables → Actions** 設定：

| 類型 | 名稱 | 內容 |
| --- | --- | --- |
| Variable | `APPLE_TEAM_ID` | 正式憑證所屬的 10 碼 Team ID |
| Secret | `MACOS_CERTIFICATE_P12_BASE64` | Developer ID Application 憑證與私鑰匯出的加密 `.p12`，再編碼為 Base64 |
| Secret | `MACOS_CERTIFICATE_PASSWORD` | 匯出 `.p12` 時設定的密碼 |
| Secret | `APPLE_ID` | 有公證權限的 Apple Account |
| Secret | `APPLE_APP_SPECIFIC_PASSWORD` | 該 Apple Account 的 App 專用密碼 |

在「鑰匙圈存取」的「我的憑證」中，選取 Developer ID Application 及其私鑰匯出 `.p12`，設定獨立密碼。Base64 只是編碼，仍須當成機密處理；`.p12`、編碼內容與密碼皆不得提交 Git。

CI 會在 runner 的臨時目錄建立專用鑰匙圈，匯入憑證與公證設定，工作結束時刪除；不修改預設鑰匙圈。缺少任一設定會停止 macOS 發佈，任一平台建置失敗則不建立 GitHub Release。公證失敗的 JSON 診斷會另外保存在 Actions artifact，排除於公開 Release 檔案之外。

完成上述設定後，依既有 `scripts/release.sh` 流程選定新版本發佈。一般 `dev` 分支 push 不會觸發正式版本發布。

## 驗證與故障處理

```sh
python3 tests/macos_release_test.py
```

這組測試使用隔離的假 Apple 工具，驗證錯誤憑證、Team ID、Bundle ID、版本、架構、公證拒絕、票證附加失敗、Gatekeeper 失敗及臨時鑰匙圈清理。它不能取代真實 Apple 公證與 App 啟動測試。

- **Status：找不到正式憑證。Root Cause：** 缺少附帶私鑰的有效 Developer ID Application，或 Team 不符。**Suggested Fix：** 檢查 Xcode／鑰匙圈憑證與 `APPLE_TEAM_ID`，不要改用開發憑證繞過檢查。
- **Status：找不到公證設定。Root Cause：** 指定鑰匙圈中沒有該 profile。**Suggested Fix：** 在使用同一使用者帳號的終端重新執行 `notarytool store-credentials`。
- **Status：Apple 公證拒絕。Root Cause：** 以 `build/notarization/` 的診斷 JSON 為準。**Suggested Fix：** 修正具體簽署或執行檔問題後重新建置，不發布失敗產物。

## Apple 官方文件

- [Developer ID 發佈方式](https://developer.apple.com/developer-id/)
- [建立 Developer ID 憑證](https://developer.apple.com/help/account/certificates/create-developer-id-certificates)
- [建立 Mac 發佈簽署程式碼](https://developer.apple.com/documentation/xcode/creating-distribution-signed-code-for-the-mac)
- [自訂公證流程與票證附加](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow)
- [使用 notarytool 與鑰匙圈憑證](https://developer.apple.com/documentation/technotes/tn3147-migrating-to-the-latest-notarization-tool)

## DMG 與 Sparkle 自動更新

macOS 使用 Sparkle 2.10.0。`build/sparkle-config.json` 固定官方壓縮檔的 SHA-256、公鑰與更新資訊網址；私鑰不在儲存庫中。本機金鑰使用鑰匙圈帳號 `io.github.jie0214.termix`，請妥善備份，不要每次發版重新產生。

正式建置與封裝順序：

```sh
export VERSION=1.8.0 # 本機驗證示例；正式發版必須遞增版本
export APPLE_TEAM_ID='你的 10 碼 Team ID'
export MACOS_NOTARY_PROFILE=termix-notary
CGO_LDFLAGS='-framework UniformTypeIdentifiers' wails build -clean -platform darwin/universal -ldflags "-X main.version=${VERSION}"
bash scripts/macos-sparkle.sh build/bin/TermiX.app
bash scripts/macos-release.sh build/bin/TermiX.app "dist/TermiX-${VERSION}-macos.zip"
bash scripts/macos-dmg.sh "dist/TermiX-${VERSION}-macos.zip" "dist/TermiX-${VERSION}-macos.dmg"
bash scripts/macos-appcast.sh "dist/TermiX-${VERSION}-macos.zip" dist/appcast.xml
```

建議使用 `-clean`；嵌入腳本會以校驗過的官方版本替換舊 Sparkle Framework。嵌入 Sparkle 之後才可正式簽署。DMG 內提供 `TermiX.app` 與「Applications」捷徑，使用者拖曳即可安裝；DMG 本身也要簽署、公證與附加票證。ZIP 是 Sparkle 更新套件。

發版工作流程會一起上傳 DMG、ZIP 與 `appcast.xml`。更新資訊使用固定 HTTPS 網址 `https://github.com/jie0214/TermiX/releases/latest/download/appcast.xml`，其中套件指向不可變更的版本 tag 路徑。套件與更新資訊皆使用 Sparkle Ed25519 簽章，App 會在解壓縮前驗證更新套件，並要求簽署過的更新資訊。

GitHub Actions 另外需要 `SPARKLE_PRIVATE_KEY` Secret，其內容為 Sparkle `generate_keys -x` 匯出的金鑰內容。請由維護者直接安全匯入 Actions Secrets，勿貼到對話或提交 Git。CI 透過標準輸入交給官方 `generate_appcast` 工具，不將私鑰列入指令參數或發佈產物。缺少任何必要 Secret 會停止發版。現有已安裝、未包含 Sparkle 的舊版仍須先手動安裝一次新版。

### 使用者更新行為

- 啟用自動檢查時，每次啟動會立即背景檢查一次，之後由 Sparkle 每小時排程檢查；有可提示的新版時顯示原生更新通知。也可使用「Check for Updates」。
- 更新偏好位於 macOS 選單列「TermiX → 更新設定…」，不是 Vaults 的一般 Settings 頁面；關閉自動檢查後，啟動時也不會強制檢查。
- 「更新設定…」可開關自動檢查與自動下載；自動下載預設關閉，開啟後可在結束時套用。
- 套用更新或一般結束 App 前，會凍結新連線與命令，檢查本機終端、SSH、Pod shell 及 port-forward。
- 尚有連線建立、批次指令或 Kubernetes 修改進行時，暫停結束，等操作完成或取消後再試。
- 有使用中的連線時，選「稍後」會保留連線；選「中斷並繼續」才清理連線與本機子程序。
- 選擇稍後會正常取消本次安裝，可再次使用「Check for Updates」重試。更新器失敗時會解除操作限制，使用者可重新連線。
- 不會把原本的 SSH 程序或即時終端狀態還原成可繼續執行的工作。

此階段不建立 Homebrew tap，也不產生或更新 Cask。

### 驗收

1. Apple Silicon 與 Intel 通用版建置成功。
2. App 與 DMG 的 `codesign`、`stapler validate` 與 `spctl` 通過。
3. DMG 可掛載且包含安裝捷徑；從已簽署的 App 可開啟原生更新設定。
4. 操作中與取消重啟時保留現有連線，確認後才關閉。
5. 測試用舊版能讀取簽署更新資訊、下載驗證新版並重啟；正式 Release 需遞增版本後才能對外測試此路徑。
6. 更新網址、版本、大小或簽章無效時，停止發佈或安裝。

### v1.8.2 升級資料相容性

正式 Bundle ID 從 `com.wails.TermiX` 改為 `io.github.jie0214.termix` 後，WebKit 使用不同的儲存區。啟動遷移須在載入 App 與主機 Store 前執行，以免缺少組件時清除掛載參照。

- 只讀取舊 App 的 `wails://wails` 正式來源，略過開發伺服器；支援 origin 記錄與舊式 `wails_wails_0.localstorage`。
- Control Panel 與有 ID 的清單項目補入缺少資料，相同 ID 保留新版內容；已有偏好不覆寫。舊資料庫不修改。
- 成功後記錄遷移完成，避免使用者後續刪除項目又被還原；來源衝突、解析或寫入失敗時不宣告完成。
- 回歸測試涵蓋直接升級、v1.8.1 已有新內容、舊 WebKit 格式，以及重啟後不重複還原。
- v1.8.2 曾以隔離資料啟動實際 Wails App，確認組件還原、主機掛載保留、新舊組件合併與刪除後再次啟動的行為。測試 App 不連線至主機。

- 更新通知不會自動消失。關閉通知（包括「稍後提醒」或「略過此版本」）後，記住該版本並跨重啟保持靜默，直到更高版本才再次提示；手動「Check for Updates」仍可查看已關閉的版本。

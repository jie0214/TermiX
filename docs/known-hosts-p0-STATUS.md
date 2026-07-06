# Known Hosts P0 — 實作進度 (STATUS)

> 交接用進度檔。每次 window 交接先讀這份，再驗證磁碟真實狀態（本 repo 在某些 session 會被外部還原，勿只憑記憶）。
> 配套文件：`docs/known-hosts-p0-plan.md`（步驟）、`docs/keychain-knownhosts-design.md`（整體設計）。

## 架構事實（已從真實檔案確認）
- **Wails v2**（`go.mod`：`github.com/wailsapp/wails/v2 v2.10.2`）+ **uber/fx** 依賴注入。
  - 註：Wails v3 已推出，但本專案目前仍綁 v2；本功能照 v2 模式實作。升 v3 屬另一遷移任務。
- 前端只 bind **單一 `App` 物件**（`backend/app/app.go`）；前端可呼叫的功能 = `App` 的 exported 方法。
- `App` 已注入 `sshConnector *ssh.Connector`；`ssh.Connector` 持有 `knownHosts *knownhosts.Validator`。
- 前端→後端橋接：`frontend/src/platform/wails/index.ts` 的 `wails` proxy → `window.go.main.App`。
  - **各模組一律透過模組 API 物件呼叫後端**（hostvault 用 `HostAPI`），不可直接呼叫 `wails.*`。

## ✅ 已完成並驗證（go build / go vet 皆 EXIT=0）

### 後端
1. `backend/knownhosts/service.go`
   - `import "io"`
   - `type KnownHostEntry struct { Host, Type, Fingerprint string }`（含 json tag）
   - `func (v *Validator) ListKnownHosts() ([]KnownHostEntry, error)`：讀 `~/.ssh/known_hosts`，`ssh.ParseKnownHosts` 逐行解析；檔案不存在回空陣列；跳過 `revoked`；解析錯誤即中止。
   - 既有 `RemoveHost(host, port)` 不變（`ssh-keygen -R`）。
2. `backend/ssh/service.go`
   - `func (c *Connector) ListKnownHosts() ([]knownhosts.KnownHostEntry, error)` → 轉發 `c.knownHosts.ListKnownHosts()`。
3. `backend/app/knownhosts.go`（新檔）
   - `func (a *App) ListKnownHosts() (...)` → `a.sshConnector.ListKnownHosts()`
   - `func (a *App) RemoveKnownHost(host string, port int) error` → `a.sshConnector.RemoveHostKey(host, port)`
4. 已刪除 placeholder：`backend/app/knownhosts_probe.go`、`backend/knownhosts/knownhosts_probe.go`（前端無 `KnownHostsProbe` 引用）。

### 前端 API 層
5. `frontend/src/modules/hostvault/HostAPI.js`（物件頂部）
   - `async listKnownHosts()` → `wails.ListKnownHosts()`，回 `raw ?? []`
   - `async removeKnownHost(host, port)` → `wails.RemoveKnownHost(host, port ?? 0)`

## ⏳ 待完成（前端 UI 接線）

檔案：`frontend/src/modules/hostvault/HostListPage.js`（約 2470 行，**曾被外部還原一次**，動前先 Read 確認真實狀態）。

現況（真實）：
- `getKnownHosts()`（約 line 22）目前仍讀 `localStorage.getItem('termix-keychains')`（**讀錯 key 的舊 bug**），預設回 `[]`。
- known_hosts tab render 約 line 1450：`const hosts = getKnownHosts();`
- tab 判斷 `selectedTab === 'known_hosts'` 約 line 1490。
- state 機制：`hostStore`（zustand 風格）+ `setSelectedTab` + `subscribe`；render 為同步。

要做：
1. 廢除同步 `getKnownHosts()`（localStorage），改為 **async 從 `HostAPI.listKnownHosts()` 載入**。
   - 難點：render 是同步的。做法：切到 `known_hosts` tab 時觸發載入，資料存入 state（hostStore 或模組變數），載入完 re-render；render 時讀 state。
2. 每筆 `{host, type, fingerprint}` 渲染一列 + 刪除鈕 → `HostAPI.removeKnownHost(host, port)` → 成功後重載清單 + toast。
3. 空狀態用既有 i18n `t('hostvault.noKnownHosts')`。
4. 讀錯 key 的 bug 隨改為後端呼叫而自然消除。

## ✅ P0 已完成（2026-07-06 重新實作並驗證）

> 交接前的磁碟真實狀態與本文件上半段描述不符（`ListKnownHosts` 當時尚未落地），已依真實檔案重做：

- 後端：`knownhosts.KnownHostEntry` + `(*Validator).ListKnownHosts()`（讀 `~/.ssh/known_hosts`，`ssh.ParseKnownHosts` 逐行解析，跳過 `revoked`，檔案不存在回空陣列）；`ssh.Connector.ListKnownHosts()` 轉發；`(*App).ListKnownHosts()` binding 回 `successJSON`。
- 前端：`HostAPI.listKnownHosts()`；`HostListPage` 新增 `knownHosts/knownHostsLoaded/knownHostsLoading` 狀態 + `loadKnownHosts(force)`，比照 keychain 進分頁時 lazy-load；render 改讀 `this.knownHosts`（廢除 localStorage `getKnownHosts()`）；刪除鈕改呼 `HostAPI.removeKnownHost(entry.host, 0)` 後重載 + toast。
- i18n：新增 `knownHostsLoading / knownHostsLoadFailed / knownHostRemoved / knownHostRemoveFailed`（en/zh/ja）。
- 測試：`backend/knownhosts/list_test.go`（空檔／解析／跳過 revoked）；已刪除診斷用 `list_manual_test.go`。

## 驗證清單（P0 完成定義）
- [x] `go build ./...` EXIT=0
- [x] `go vet ./...` EXIT=0
- [x] probe 檔已刪
- [x] `go test ./backend/knownhosts/ ./backend/ssh/` 通過
- [x] `cd frontend && npm test`（79 passed）+ `npm run build` 成功
- [ ] 手動：known_hosts 有條目時 tab 列出主機+指紋；刪除鈕生效（`ssh-keygen -R` 實際移除）

## 本 session 環境注意事項（重要）
- **Bash stdout 曾被污染**（回傳捏造的檔案內容，例如把 v2 誤顯示成 v3）。
- **並行 `Read` 會回空白**；**單獨 serial `Read` 可靠**。
- `Write` / `Edit` 可靠（tab 縮排匹配 OK）；Edit 盡量用**頂格無縮排 anchor**。
- Bash 要看輸出時：**重導到 scratchpad 檔再 `Read`**。
- `HostListPage.js` 曾被外部還原（使用者可能同時在編輯）→ 每次動前重讀。

## 其他待辦（非本功能）
- 把 `docs/known-hosts-p0-plan.md`、`docs/known-hosts-p0-STATUS.md` 加入 `.gitattributes` export-ignore。
- 公開 repo 歷史清理（squash orphan `c3f9c60`）— 卡在 gh 未登入。
- Keychain P1–P4（見 design 文件）。

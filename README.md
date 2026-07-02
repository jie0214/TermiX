# TermiX

TermiX 是一款桌面應用程式，把 **SSH 主機管理、終端工作區、Kubernetes 叢集操作、控制面板與日誌檢視**整合在同一個視窗裡，讓日常維運不必在多個工具之間切換。

支援 macOS、Windows、Linux。

---

## 功能特色

- **主機保險箱** — 集中管理 SSH 主機、群組與登入資訊，支援密碼、Private Key、SSH Certificate；可搜尋、分類與拖曳整理。
- **終端工作區** — 遠端 SSH 與本機終端機，支援分頁與窗格、尺寸自動校正，以及互動式 TUI。
- **控制面板** — FunctionBox 一鍵執行常用動作、InfoBox 狀態看板；本機指令預設安全閘（僅允許 `open`）。
- **Kubernetes** — 讀取 `~/.kube/config`，切換 Context 與 Namespace，檢視 Overview、Nodes、Pods、Deployments、StatefulSets、Workloads、Networking、Storage、Events；提供資源 Drawer、YAML、Logs、Port Forward、Delete 與 Create Resource。
- **日誌** — Session 日誌、控制面板日誌，以及 Kubernetes 的 Logs 檢視（篩選、暫停、下載、清除）。

---

## 系統需求

- **作業系統**：macOS 11 以上、Windows 10 以上，或主流 Linux 發行版。
- **Kubernetes 功能（選用）**：需要一份有效的 `~/.kube/config` 與對應叢集的存取權限。
- 不需要另外安裝執行環境，下載的安裝檔已包含所需元件。

---

## 下載與安裝

到本專案的 [Releases](https://github.com/jie0214/TermiX/releases) 頁面下載對應作業系統的檔案：

### macOS
1. 下載 `.app`（或 `.dmg`）並解壓縮。
2. 將 `TermiX.app` 拖入「應用程式」資料夾。
3. 首次開啟若出現「無法驗證開發者」，請在 App 上按右鍵 →「打開」→ 再按一次「打開」。

### Windows
1. 下載安裝檔（`.exe`）並執行。
2. 若出現 SmartScreen 提示，點「更多資訊」→「仍要執行」。

### Linux
1. 下載執行檔，加上執行權限：`chmod +x TermiX`。
2. 直接執行 `./TermiX`。

> 目前的安裝檔尚未做程式碼簽章，因此系統可能顯示安全警告，依上述步驟略過即可。若 Releases 尚未提供你的平台，請見文末「從原始碼建置」。

---

## 快速上手

1. **新增主機**：開啟後在「主機保險箱」新增 SSH 主機，填入位址與登入方式（密碼 / Key / Certificate），即可連線。
2. **使用終端**：連線後進入終端工作區，可開多個分頁與窗格；也可開本機終端機。
3. **控制面板**：用 FunctionBox 執行預設動作、InfoBox 觀察狀態。
4. **操作 Kubernetes**：確保本機有 `~/.kube/config`，開啟 Kubernetes 分頁後即可切換 Context / Namespace 並瀏覽、操作叢集資源。

---

## 進階設定（環境變數）

一般使用不需要設定，以下為選用：

- `TERMIX_ALLOW_UNSAFE_LOCAL_COMMANDS=1`
  預設 FunctionBox 只允許執行 `open`。設定此變數後才能執行任意本機 Shell 指令，**請確認來源可信任再啟用**。
- `TERMIX_SECRET_STORE=memory`
  改用記憶體型的祕密儲存（重啟後不保留），適合臨時或測試情境。

---

## 常見問題

- **Kubernetes 資源顯示存取失敗或缺值**：多半是 `~/.kube/config` 權限不足，或叢集未提供 Metrics；請確認你的帳號對該叢集有對應權限。
- **開啟時出現安全警告**：因安裝檔尚未簽章所致，依上方「下載與安裝」步驟略過即可。
- **FunctionBox 無法執行某些指令**：這是安全預設；如確需執行本機指令，請參考上方環境變數。

---

## 授權

本專案採用 [MIT License](LICENSE)，可自由使用、修改與散布。所含第三方套件各自保留其原授權（MIT / BSD / Apache-2.0）。

---

## 從原始碼建置（開發者）

需要 Go 1.25+、Node.js 與 npm，以及 [Wails CLI](https://wails.io)：

```bash
go install github.com/wailsapp/wails/v2/cmd/wails@latest   # 安裝 Wails CLI
npm install --prefix frontend                              # 安裝前端依賴

wails dev        # 開發模式（熱重載）
wails build      # 打包，輸出至 build/bin/TermiX.app
```

測試：

```bash
go test ./...                    # 後端
npm test --prefix frontend       # 前端
```

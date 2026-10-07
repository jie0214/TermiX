# Kubernetes AI Analysis

桌面版 Settings 的 AI Connection 自動偵測本機 Codex、Claude Code 與 Gemini CLI。每個 Agent 在同一列顯示名稱、執行檔位置、連線狀態、測試連線與連線／中斷操作。名稱與執行參數由後端 Agent 登錄定義，不接受任意 Shell 指令。

## 使用流程

1. 先在本機安裝 Agent CLI，使用其既有登入方式完成登入；Codex 與 Claude Code 另需安裝下方列出的 ACP 轉接程式。
2. 開啟 Settings → AI Connection，連結偵測到的 Agent；可在同一列測試或中斷連線。
3. 開啟 Kubernetes → Pods → Pod Drawer → AI Analysis。
4. 選擇 Agent。模型清單向該 Agent 即時查詢，不在 Settings 設定，也不使用 TermiX 內建的模型名稱清單。
5. 選擇模型、容器與 Events／Logs 範圍後開始分析；可以取消，完成後可展開實際送出的證據。

AI 面板、證據標題與新分析／追問的回覆語言會依介面設定使用 English、繁體中文或日本語；既有分析不會自動重新翻譯。日誌與資源內容維持原文。

分析結果以 Markdown 呈現標題、清單、粗體、程式碼與表格。回覆要求精簡，依序提供「結論」、「根因分析（Root Cause Analysis）」與「建議處理」；證據不足時標示根因未確認並列出資訊缺口。模型輸出的 HTML 會清理，只保留排版元素。

## Event Drawer 分析

在 Kubernetes → Events 點選事件，切換 Drawer 的「AI 分析」分頁，選擇已連線的 Agent 與即時取得的模型後開始分析。沿用相同的 Markdown 結果、證據檢視與取消流程。

後端依連線、Namespace、Event 名稱與 UID 重新讀取事件，不採用前端傳入的 Message。另依事件記錄的 UID 讀取關聯 Pod、Node、Deployment、StatefulSet、DaemonSet、ReplicaSet、Job、PersistentVolumeClaim 或 PersistentVolume 的目前狀態；Pod 使用既有的安全規格投影。未支援的種類、資源已刪除、UID 不符或權限不足時，保留 Event 證據並顯示缺少的資料。事件與關聯狀態各限 64 KiB，截斷會標示。

Event 分析不讀取日誌、Secret 或完整 YAML。模型必須區分事件當時的證據與資源目前狀態。切換事件、離開 AI 分頁、關閉 Drawer、切換叢集或中斷 Agent 時會取消分析；事件已被替換或刪除時不送交 Agent。

## 暫存結果與接續詢問

切換 Agent、模型、容器或資料範圍不會清除原分析。離開 AI 分頁、關閉 Drawer 或切換其他資源後，再開啟同一個 Pod／Event 可查看原結果與後續對話；結果始終標示當時使用的 Agent、模型與資料時間。按下「開始分析／重新分析」會清除該資源原有結果與對話。退出或切換叢集會清空所有暫存，關閉 App 後也不會還原。

完成分析後可在面板下緣的懸浮對話框接續提問。Enter 傳送、Shift + Enter 換行，中文輸入法選字時不會直接送出。追問使用目前選擇的 Agent 與模型，附上原分析及最近 10 輪已完成對話，並重新收集目前資源快照；各次回答保留自己的證據與時間。單次提問最多 4,000 字、傳送的對話總量最多 256 KiB；超過限制會提示重新分析，不會默默刪除畫面中的歷史。提問失敗或取消時保留既有分析與已完成對話。

Events 頁面提供 All／Warning／Normal 篩選按鈕與筆數，能與搜尋條件交集使用；Details 的 Related Events 不受主頁篩選影響。

## 資料與權限邊界

- 由 TermiX 既有 Kubernetes client 讀取 Pod；綁定 ConnectedAt、Namespace、Pod 名稱與 UID，避免切換叢集或同名 Pod 重建後混用資料。
- 基本快照包含容器狀態、資源需求與限制、映像及環境變數來源；不傳送環境變數明文、命令參數、annotations，也不查詢 Secret 資源。
- 日誌是使用者選取的容器最近 200 行；有重啟時另收集上次容器日誌，各限制 64 KiB。Events 限制 100 筆／64 KiB。截斷與權限不足會顯示於證據或警告中。
- 日誌、事件與容器終止訊息仍可能包含應用程式自行輸出的敏感資料。資料交給所選 Agent，其模型服務可能在遠端；不代表推論一定在本機執行。
- Agent 在獨立暫存工作目錄執行。停用工具、MCP、hooks 等擴充；Codex 另外使用唯讀 sandbox。所有反向工具／權限請求均拒絕。模型只能回傳診斷文字，不代為修復叢集。
- 分析、證據與後續對話依叢集連線及資源 UID 暫存在 App 記憶體；TermiX 不將 prompt、模型回覆或 Agent 憑證寫入持久儲存。Agent 自身的認證與儲存行為由其 CLI／ACP 轉接程式管理。Claude Code 設定 `persistSession: false`；Codex 停用命令歷史，但 ACP 沒有通用的 ephemeral 工作階段保證，Agent 仍可能保存工作階段。
- SQLite 只保存各 Agent 是否連線，不保存模型清單、路徑或登入憑證。中斷 TermiX 連線不會將使用者的 CLI 登出。
- 取消、切換 Pod、切換 Agent、關閉面板或中斷叢集會停止相關分析。逾時上限 3 分鐘，同時最多 3 個分析請求。

## 通用 ACP 與安裝

TermiX 統一使用 ACP v1（stdio JSON-RPC）；不再直接實作 Codex App Server 或 Claude stream-json。產品間共用同一個 `acpAdapter`，只有啟動設定不同。

| 顯示名稱 | ACP 執行檔 | 安裝方式 |
| --- | --- | --- |
| Codex | `codex-acp` | `npm install -g @agentclientprotocol/codex-acp` |
| Claude Code | `claude-agent-acp` | `npm install -g @agentclientprotocol/claude-agent-acp` |
| Gemini CLI | `gemini --acp` | 沿用已安裝的 Gemini CLI |

ACP 轉接程式是額外的執行依賴，不會由 TermiX 自動下載或安裝。登錄會優先偵測 ACP 執行檔；若只找到原生 Codex／Claude CLI，仍會顯示該產品，連線時提示缺少的 ACP 套件。升級前保存的 Agent ID 與連線設定不變。

共用流程：

1. `initialize` 驗證 ACP v1，不提供檔案讀寫或終端機能力。
2. `session/new` 建立暫存工作目錄中的工作階段，不傳入 MCP server。
3. 優先解析 `configOptions` 中 `category: model` 的動態選單，支援模型分組；相容舊版 `models.availableModels`。沒有模型清單即回報錯誤，不填入預設模型。
4. 使用 `session/set_config_option` 選取 Agent 提供的模型並確認回傳值；舊版模型欄位使用 `session/set_model`。不確認模型就不送出 Pod 資料。
5. `session/prompt` 送出快照，只接受相同 session 的 `agent_message_chunk`；僅 `end_turn` 視為完成。
6. `session/request_permission` 回覆 `cancelled`，檔案與終端機反向請求回覆不支援；若 Agent 宣告工具呼叫則中止分析。
7. 取消時先送 `session/cancel`，保留短暫中止時間後結束程序樹，避免無回應的 Agent 留在背景。

ACP 本身不是 sandbox。既有產品的啟動限制保留在 `backend/aiagent/agents.go`：Codex 透過轉接程式的 CLI 查詢 MCP 名稱，覆寫為停用設定，並限制工具與 sandbox；Claude 使用 `_meta.claudeCode.options` 停用工具、MCP 與持久化；Gemini 使用暫存系統設定停用工具、MCP 與 hooks。這些是啟動設定，不包含產品專屬的模型／對話訊息轉換。

## 新增其他 Agent

在 `backend/aiagent/agents.go` 新增 `agentDefinition`，提供正式名稱、ACP 執行檔、固定啟動參數；若需要，補上 Node 入口、安裝提示與該產品的工具限制。通過 ACP v1、動態模型選取與唯讀分析驗證後即可沿用共用 client；不需要新增產品專屬的通訊 adapter，也不必改前端。

自動偵測的範圍仍是產品登錄清單，不會掃描並執行未知程式。非 ACP 產品需有外部 ACP bridge；ACP v2 或缺少模型選取能力的 Agent 不會假裝相容。

模型目錄不保證帳號配額或每個模型的推論權限。測試連線只做握手、建立 session 與模型查詢，不送出推論；登入錯誤由 Agent 回報。若服務端拒絕該 CLI 或登入方式，需依實際錯誤處理。

協定參考：[ACP 初始化](https://agentclientprotocol.com/protocol/v1/initialization)、[ACP 設定選項](https://agentclientprotocol.com/protocol/v1/session-config-options)、[Codex ACP](https://github.com/agentclientprotocol/codex-acp)、[Claude Agent ACP](https://github.com/agentclientprotocol/claude-agent-acp)。

## 驗證

一般測試不啟動已安裝的 Agent，不送出推論，也不存取真實叢集：

```sh
go test ./...
go vet ./...
go test -race ./backend/aiagent ./backend/kubernetes
npm --prefix frontend test
npm --prefix frontend run typecheck
npm --prefix frontend run build
```

本機握手／模型查詢測試可明確指定 Agent：

```sh
TERMIX_AI_LOCAL_TEST=codex go test ./backend/aiagent -run '^TestLocalAgentModels$' -v
TERMIX_AI_LOCAL_TEST=claude go test ./backend/aiagent -run '^TestLocalAgentModels$' -v
TERMIX_AI_LOCAL_TEST=gemini go test ./backend/aiagent -run '^TestLocalAgentModels$' -v
```

推論 smoke test 使用人工 Pod 描述，不讀取真實叢集，但會消耗 Agent 的推論用量：

```sh
TERMIX_AI_ANALYSIS_TEST=codex go test ./backend/aiagent -run '^TestLocalAgentAnalysis$' -v
TERMIX_AI_ANALYSIS_TEST=claude go test ./backend/aiagent -run '^TestLocalAgentAnalysis$' -v
```

可用 `TERMIX_AI_TEST_BIN_DIR` 指定測試專用 ACP 執行檔目錄，避免變更全域 CLI。此設定僅供測試，正式應用程式不接受任意前端執行檔路徑。

本次實機驗證使用 `codex-acp` 2.1.1 與 `claude-agent-acp` 0.86.0，模型查詢與人工資料推論通過。Gemini CLI 0.46.0 仍由服務端回報不支援 Gemini Code Assist for individuals，未完成實機推論驗證。

# TermiX 備份檔案撰寫格式說明書

本文件旨在提供 TermiX 使用者關於「主機與群組（Hosts & Groups）」及「控制面板組件（Control Panel Components）」備份設定檔案的撰寫規格與欄位說明。

TermiX 支援將設定資料以 **JSON** 或 **YAML** 格式進行匯入與匯出。

---

## 一、 主機與群組備份設定 (Hosts & Groups)

此備份檔案主要儲存 SSH 主機連線歷史與其群組分類結構。

### 1. 欄位結構說明

#### 根節點 (Root)
* `hosts`: 陣列 (Array)，包含多個主機設定物件。
* `groups`: 陣列 (Array)，包含多個群組定義物件。

#### 主機設定物件 (Host Object)
* `id`: 字串 (String)，主機唯一識別碼，格式建議為 `h_` 開頭的唯一字串。
* `label`: 字串 (String)，在連線列表顯示的名稱。
* `alias`: 字串 (String)，主機別名。
* `groupId`: 字串 (String) 或 `null`，所屬的群組 ID。若無群組則設為 `null`。
* `config`: 物件 (Object)，SSH 連線的核心配置。
  * `host`: 字串 (String)，主機的 IP 位址或網域名稱。
  * `port`: 整數 (Integer)，SSH 埠號（預設為 `22`）。
  * `username`: 字串 (String)，登入使用者名稱。
  * `authMode`: 字串 (String)，驗證方式，可為 `"password"` (密碼驗證) 或 `"key"` (金鑰驗證)。
  * `password`: 字串 (String)，當 `authMode` 為 `"password"` 時為主機登入密碼；當為 `"key"` 時為私鑰的解密密碼。
  * `privateKeyPath`: 字串 (String)，私鑰檔案的絕對路徑。
  * `certPath`: 字串 (String)，認證憑證檔案的絕對路徑（選填）。
  * `sudoPassword`: 字串 (String)，提權 `sudo` 使用的密碼（選填）。
  * `customComponents`: 陣列 (Array)，此主機所掛載的控制面板組件列表。
    * `id`: 字串 (String)，掛載的組件 ID。
    * `visible`: 布林值 (Boolean)，組件是否在側邊欄顯示（預設為 `true`）。
    * `order`: 整數 (Integer)，組件的排序順序。

#### 群組物件 (Group Object)
* `id`: 字串 (String)，群組唯一識別碼，格式建議為 `g_` 開頭的唯一字串。
* `name`: 字串 (String)，群組名稱。

---

### 2. 範例檔案

#### JSON 格式範例
```json
{
  "hosts": [
    {
      "id": "h_1718000000000_abcde",
      "label": "root@192.168.1.100",
      "alias": "開發測試伺服器",
      "groupId": "g_1718000000000",
      "config": {
        "host": "192.168.1.100",
        "port": 22,
        "username": "root",
        "authMode": "password",
        "password": "your-ssh-password",
        "privateKeyPath": "",
        "certPath": "",
        "sudoPassword": "your-sudo-password",
        "customComponents": [
          {
            "id": "c_cpu_telemetry",
            "visible": true,
            "order": 0
          }
        ]
      }
    }
  ],
  "groups": [
    {
      "id": "g_1718000000000",
      "name": "測試環境主機"
    }
  ]
}
```

#### YAML 格式範例
```yaml
hosts:
  - id: h_1718000000000_abcde
    label: root@192.168.1.100
    alias: 開發測試伺服器
    groupId: g_1718000000000
    config:
      host: 192.168.1.100
      port: 22
      username: root
      authMode: password
      password: your-ssh-password
      privateKeyPath: ""
      certPath: ""
      sudoPassword: your-sudo-password
      customComponents:
        - id: c_cpu_telemetry
          visible: true
          order: 0
groups:
  - id: g_1718000000000
    name: 測試環境主機
```

---

## 二、 控制面板組件備份設定 (Control Panel Components)

此備份檔案主要儲存使用者自訂的側邊欄控制與看板組件。組件分為三種類型：**狀態看板 (info)**、**開關切換 (switch)**、與 **腳本執行按鈕 (function)**。

### 1. 欄位結構說明

#### 根節點 (Root)
* `components`: 陣列 (Array)，包含多個自訂控制組件物件。

#### 通用組件欄位 (Common Component Fields)
* `id`: 字串 (String)，組件唯一識別碼，格式建議為 `c_` 開頭的唯一字串。
* `name`: 字串 (String)，組件顯示標題。
* `color`: 字串 (String)，組件在介面上呈現的主題顏色（十六進位網頁色碼，如 `"#176b87"`）。
* `type`: 字串 (String)，組件類型，必須為以下三者之一：
  - `"info"`: 狀態看板，用於執行查詢指令並將結果分行顯示。
  - `"switch"`: 狀態開關，用於查詢與控制雙態物件。
  - `"function"`: 腳本按鈕，用於快速點選執行指令。

#### 狀態看板專屬欄位 (type: "info")
* `items`: 陣列 (Array)，監控的指標與指令列表。
  * `key`: 字串 (String)，該指標在看板上的顯示名稱。
  * `command`: 字串 (String)，獲取該指標資訊的 SSH 查詢指令。

#### 狀態開關專屬欄位 (type: "switch")
* `description`: 字串 (String)，開關的輔助說明。
* `queryCommand`: 字串 (String)，查詢目前開關狀態的 SSH 指令。
* `displayStyle`: 字串 (String)，顯示樣式（如 `"toggle"`、`"badge"`、`"indicator"`）。
* `stateA`: 物件 (Object)，開關的開啟狀態（或是狀態 A）。
  * `label`: 字串 (String)，狀態開啟時的顯示文字。
  * `match`: 字串 (String)，匹配正則或關鍵字。若 `queryCommand` 輸出符合此字串，開關將呈現狀態 A。
  * `command`: 字串 (String)，切換至此狀態需執行的 SSH 指令。
* `stateB`: 物件 (Object)，開關的關閉狀態（或是狀態 B）。
  * `label`: 字串 (String)，狀態關閉時的顯示文字。
  * `match`: 字串 (String)，匹配關鍵字。若 `queryCommand` 輸出符合此字串，開關將呈現狀態 B。
  * `command`: 字串 (String)，切換至此狀態需執行的 SSH 指令。

#### 腳本按鈕專屬欄位 (type: "function")
* `remoteCommand`: 字串 (String)，點擊按鈕後於 SSH 遠端執行的指令。
* `localCommand`: 字串 (String)，點擊按鈕後於本機 OS 執行的指令（選填）。
* `exportVars`: 字串 (String)，用於本地指令獲取遠端輸出變數的宣告（如 `"IP,ID"`，以逗號分隔）。

---

### 2. 範例檔案

#### JSON 格式範例
```json
{
  "components": [
    {
      "id": "c_system_memory",
      "name": "記憶體狀態",
      "color": "#176b87",
      "type": "info",
      "items": [
        {
          "key": "總記憶體",
          "command": "free -h | awk '/Mem:/{print $2}'"
        },
        {
          "key": "已使用",
          "command": "free -h | awk '/Mem:/{print $3}'"
        }
      ]
    },
    {
      "id": "c_docker_status",
      "name": "Docker 服務控制",
      "color": "#176b87",
      "type": "switch",
      "description": "管理伺服器 Docker 服務狀態",
      "queryCommand": "systemctl is-active docker",
      "displayStyle": "toggle",
      "stateA": {
        "label": "運行中",
        "match": "active",
        "command": "systemctl start docker"
      },
      "stateB": {
        "label": "已停止",
        "match": "inactive",
        "command": "systemctl stop docker"
      }
    },
    {
      "id": "c_clean_logs",
      "name": "清理日誌",
      "color": "#e11d48",
      "type": "function",
      "remoteCommand": "journalctl --vacuum-time=1d",
      "localCommand": "echo 'Remote logs vacuumed'",
      "exportVars": ""
    }
  ]
}
```

#### YAML 格式範例
```yaml
components:
  - id: c_system_memory
    name: 記憶體狀態
    color: "#176b87"
    type: info
    items:
      - key: 總記憶體
        command: free -h | awk '/Mem:/{print $2}'
      - key: 已使用
        command: free -h | awk '/Mem:/{print $3}'
  - id: c_docker_status
    name: Docker 服務控制
    color: "#176b87"
    type: switch
    description: 管理伺服器 Docker 服務狀態
    queryCommand: systemctl is-active docker
    displayStyle: toggle
    stateA:
      label: 運行中
      match: active
      command: systemctl start docker
    stateB:
      label: 已停止
      match: inactive
      command: systemctl stop docker
  - id: c_clean_logs
    name: 清理日誌
    color: "#e11d48"
    type: function
    remoteCommand: journalctl --vacuum-time=1d
    localCommand: echo 'Remote logs vacuumed'
    exportVars: ""
```

---

## 三、 注意事項

1. **去重合併邏輯**：當匯入備份設定時，系統會比對主機或組件的 `id`。
   - 若 `id` 已存在於現有設定中，新匯入的設定將**覆蓋**舊設定。
   - 若 `id` 不存在，則會**新增**該項目。
2. **路徑安全**：匯出與匯入皆使用安全路徑。自行修改 YAML 或 JSON 格式時，請確保檔案格式縮排與結構完整。

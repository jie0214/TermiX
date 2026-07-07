# TermiX GCP 整合：Service Account 建立流程

TermiX 的 GCP 整合會用一組 **Service Account 金鑰（JSON）** 呼叫 Compute Engine API，列出專案中的 VM 實例並同步成 Hosts。本文說明如何在 GCP 上開好這組 Service Account 並取得 JSON 金鑰。

整合實際需要的東西只有兩樣：

| 欄位 | 說明 |
|------|------|
| **Project ID** | 要匯入實例的 GCP 專案 ID（不是專案名稱，例如 `my-team-prod`） |
| **Service Account JSON** | 具備 Compute Engine 唯讀權限的服務帳戶金鑰，整份 JSON 貼進 TermiX |

TermiX 只讀取 Compute Engine 實例（跨所有 zone），**不需要**任何寫入權限，請比照最小權限原則設定。

---

## 前置需求

- 一個 GCP 專案，且你在該專案有管理 IAM 與 Service Account 的權限（例如 `roles/owner` 或 `roles/iam.serviceAccountAdmin` + `roles/resourcemanager.projectIamAdmin`）。
- 已安裝 `gcloud` CLI（若走指令流程）；或使用 GCP Console 網頁操作。

---

## 步驟一：啟用 Compute Engine API

整合會呼叫 `compute.googleapis.com`，專案必須先啟用該 API。

**Console**：`API 和服務 → 已啟用的 API 和服務 → 啟用 API 和服務 → 搜尋「Compute Engine API」→ 啟用`。

**gcloud**：

```bash
gcloud services enable compute.googleapis.com --project="PROJECT_ID"
```

---

## 步驟二：建立 Service Account

**Console**：`IAM 與管理 → 服務帳戶 → 建立服務帳戶`

1. 服務帳戶名稱：例如 `termix-inventory`
2. 說明（選填）：`TermiX 主機清單唯讀`
3. 按「建立並繼續」

**gcloud**：

```bash
gcloud iam service-accounts create termix-inventory \
  --display-name="TermiX inventory reader" \
  --project="PROJECT_ID"
```

服務帳戶的電子郵件會是：
`termix-inventory@PROJECT_ID.iam.gserviceaccount.com`

---

## 步驟三：授予唯讀權限

給予 **Compute 檢視者（`roles/compute.viewer`）** 即可，這是涵蓋讀取所有 Compute Engine 資源（含實例、IP）的內建唯讀角色。

**Console**：在建立服務帳戶的「授予存取權」步驟，選擇角色 `Compute Engine → Compute 檢視者`。

**gcloud**：

```bash
gcloud projects add-iam-policy-binding "PROJECT_ID" \
  --member="serviceAccount:termix-inventory@PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/compute.viewer"
```

### （進階）更嚴格的最小權限

若不想給整個 `compute.viewer`，可自建僅含清單權限的自訂角色：

```bash
gcloud iam roles create termixInventoryReader \
  --project="PROJECT_ID" \
  --title="TermiX Inventory Reader" \
  --permissions="compute.instances.list,compute.zones.list"

gcloud projects add-iam-policy-binding "PROJECT_ID" \
  --member="serviceAccount:termix-inventory@PROJECT_ID.iam.gserviceaccount.com" \
  --role="projects/PROJECT_ID/roles/termixInventoryReader"
```

> TermiX 以 `AggregatedList` 跨 zone 列出實例，核心權限為 `compute.instances.list`。

---

## 步驟四：建立並下載 JSON 金鑰

**Console**：`服務帳戶 → 點該帳戶 → 金鑰 → 新增金鑰 → 建立新的金鑰 → JSON → 建立`，瀏覽器會下載一個 `.json` 檔。

**gcloud**：

```bash
gcloud iam service-accounts keys create termix-sa.json \
  --iam-account="termix-inventory@PROJECT_ID.iam.gserviceaccount.com"
```

`termix-sa.json` 內容形如：

```json
{
  "type": "service_account",
  "project_id": "PROJECT_ID",
  "private_key_id": "...",
  "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",
  "client_email": "termix-inventory@PROJECT_ID.iam.gserviceaccount.com",
  ...
}
```

> 這把金鑰等同帳號密碼，請勿提交到版本庫或外流。貼進 TermiX 後即可刪除本機檔案。

---

## 步驟五：在 TermiX 建立 GCP 整合

1. 進入 **Hosts → Integrations**（或工具列 `+ New host ▼ → GCP Integration`）。
2. 供應商選 **GCP**，填入：
   - **物件名稱**：例如 `Production GCP Project`
   - **群組名稱**：同步進來的主機會歸到此目錄
   - **Project ID**：步驟一的專案 ID
   - **Service Account JSON**：把 `termix-sa.json` 整份內容貼上
   - **匯入 IP 位址類型**：`Public IP`（預設，取外部 NAT IP）或 `Private IP`（取內網 IP）
3. 展開 **Cloud sync settings** 設定連線預設值：Port、使用者名稱、登入方式（密碼或金鑰）。這些會套用到同步建立的每一台主機。
4. 按 **Save and sync**，TermiX 會立即拉取 Compute Engine 實例並建立對應 Hosts；之後每 5 分鐘背景自動同步一次。

金鑰會存入作業系統的憑證儲存區（Keychain），不以明文存於設定檔。

---

## 疑難排解

| 症狀 | 可能原因 |
|------|----------|
| 同步失敗、提示 API 未啟用 | 專案未啟用 Compute Engine API（步驟一） |
| `403 / permission denied` | Service Account 缺少 `compute.instances.list` 權限（步驟三） |
| 同步成功但主機數為 0 | 該專案沒有實例；或選了 Private IP 但實例只有外部 IP（反之亦然） |
| 主機連得到但無法登入 | Cloud sync settings 的預設帳號 / 金鑰 / 密碼與實例不符，需個別調整 |
| 金鑰外洩或不再使用 | 至 `服務帳戶 → 金鑰` 刪除該金鑰，或停用整個服務帳戶 |

---

## 備註

- TermiX GCP 整合目前僅支援 **Compute Engine**（不含 GKE 節點等其他資源）。
- 建議定期輪替金鑰；不再使用時刪除金鑰並移除 IAM 綁定。
- 在 TermiX 刪除此 GCP 整合時，會一併清除本機儲存的金鑰與同步狀態。
- AWS 整合的對應流程另見整合設定頁；兩者資料模型一致，差別在認證方式（AWS 用 Access Key、GCP 用 Service Account JSON）。

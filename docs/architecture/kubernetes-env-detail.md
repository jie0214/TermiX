# Kubernetes 資源詳情 ENV 呈現設計方案

> 將資源詳情抽屜的 ENV 分頁改為「依來源分區」的雙欄 key-value 表格，與 Metadata 表視覺一致。設計已定案並實作，本文件為依據。
> 相關背景見 [kubernetes-session.md](./kubernetes-session.md)。

## 目錄

- [需求](#需求)
- [已定案決策](#已定案決策)
- [UI 方案](#ui-方案)
- [資料結構](#資料結構)
- [前端要改的檔案與位置](#前端要改的檔案與位置)
- [驗證方式](#驗證方式)

## 需求

原 ENV 分頁為三欄 grid（名稱｜類型徽章｜值/來源）。需改為與 Metadata 詳情相同的雙欄
條紋 key-value 表格風格，並清楚區分「直接寫死的值」與「來自 ConfigMap/Secret/欄位參照的值」。

## 已定案決策

| 項目 | 決策 |
|------|------|
| 版面 | **方案 C — 依來源分區**。每個容器分成「直接值」與「參照來源」兩個小節，各為一張條紋雙欄表。 |
| 樣式沿用 | 兩張表都沿用既有 `.kubernetes-detail-fields--striped`（與截圖 Metadata 表同款），不另造表格元件。 |
| Secret | **不顯示明文值**，僅顯示來源參照（`Secret <name> / <key>`）。後端本就不回傳 Secret 值。 |
| 類型辨識 | 參照來源以圖示區分：ConfigMap＝檔案圖示（primary 色）、Secret＝鎖圖示（danger 色）、fieldRef/resourceFieldRef＝標籤圖示（muted 色）。不使用逐列文字徽章。 |
| envFrom | 併入「參照來源」小節，`dt` 顯示 `envFrom`，`dd` 顯示來源（`ConfigMap <name>` / `Secret <name>`）。 |
| 多容器 | 每個容器一段標題（沿用 `kubernetes-detail-section` 的 `<h3>`）＋其下兩個小節。 |
| 空節 | 某小節無資料則整段不渲染；整個容器皆無 env/envFrom 才顯示 `k8s.detail.noEnv`。 |

## UI 方案

> 方案圖已於對話中以互動 widget 呈現（方案 A/B/C 對照），最終採方案 C。

```
┌ app  (container) ─────────────────────────────────┐
│  = 直接值                                          │
│  ┌───────────────┬───────────────────────────────┐│
│  │ APP_ENV       │ production                     ││
│  │ LOG_LEVEL     │ info                           ││  ← 條紋雙欄，與 Metadata 同款
│  └───────────────┴───────────────────────────────┘│
│  🔗 參照來源                                       │
│  ┌───────────────┬───────────────────────────────┐│
│  │ DB_HOST       │ 📄 ConfigMap app-config / db.host   │
│  │ DB_PASSWORD   │ 🔒 Secret app-secrets / db.password │  ← Secret 僅顯示來源
│  │ POD_IP        │ 🏷 fieldRef status.podIP        ││
│  │ envFrom       │ 📄 ConfigMap shared-config      ││
│  └───────────────┴───────────────────────────────┘│
└────────────────────────────────────────────────────┘
```

## 資料結構

後端 `dto.KubernetesEnvVarSummary`（見 `backend/kubernetes/resource.go`）：

- `Name`：變數名。
- `Value`：字面值；非空即歸「直接值」。
- `Source`：僅 `valueFrom` 有值，格式：
  - `Secret <name> / <key>`
  - `ConfigMap <name> / <key>`
  - `fieldRef <fieldPath>`（resourceFieldRef 類同）
- 容器另有 `EnvFrom []string`：`ConfigMap <name>` / `Secret <name>`。

分類規則：`Value` 非空 → 直接值；否則依 `Source` 第一個詞決定圖示，歸「參照來源」。

## 前端要改的檔案與位置

- `frontend/src/modules/kubernetes/KubernetesSessionPage.js`
  - `renderEnvTab(detail)`：改為依來源分區、渲染兩張 `kubernetes-detail-fields--striped` 表。
  - 新增 `envRefIcon(kind)`；移除舊 `envKind()`（三欄版專用）。
- `frontend/src/style.css`
  - 移除舊 `.kubernetes-env-grid / -name / -value / -source / -kind`；
  - 新增 `.kubernetes-env-groups`、`.kubernetes-env-subhead`、`dd.kubernetes-env-ref`、`.kubernetes-env-ref-icon`（含 k-cm/k-secret/k-field 色）。
- `frontend/src/i18n/dict/kubernetes.ts`
  - 新增 `k8s.detail.envDirect`、`k8s.detail.envRefs`（en / zh-Hant / ja）。

## 驗證方式

1. `npm run typecheck`、`npm run build`、`npm test` 全綠。
2. 開啟含 env 的 Pod/Deployment 詳情 → ENV 分頁：
   - 直接值列於「直接值」表；ConfigMap/Secret/fieldRef 列於「參照來源」表並帶對應圖示。
   - Secret 只顯示 `Secret <name> / <key>`，無明文。
   - 多容器各自成段；無 env 顯示空狀態。

# Kubernetes 調整副本數（Scale）設計方案

> 為 Deployment / StatefulSet 提供「調整 Pod 副本數」的 UI 與後端。設計已定案，本文件為實作依據。
> 相關背景見 [kubernetes-session.md](./kubernetes-session.md)；多選刪除見 [kubernetes-multiselect-delete.md](./kubernetes-multiselect-delete.md)。

## 目錄

- [需求](#需求)
- [已定案決策](#已定案決策)
- [UI 方案](#ui-方案)
- [後端設計](#後端設計)
- [前端要改的檔案與位置](#前端要改的檔案與位置)
- [執行流程](#執行流程)
- [注意事項](#注意事項)
- [驗證方式](#驗證方式)

## 需求

在資源清單為 Deployment / StatefulSet 時，提供一顆按鈕可調整其 Pod 副本數（`spec.replicas`），並可在資源詳情抽屜內操作。

## 已定案決策

| 項目 | 決策 |
|------|------|
| 適用資源 | **僅 Deployment / StatefulSet**。 |
| DaemonSet | **不顯示 Scale**。DaemonSet 無 `replicas`，其 Pod 數由 nodeSelector/affinity 與節點數決定，不可用副本數調整。 |
| 入口位置 | **兩者都做**：① 清單列尾一顆膠囊 `⇕ Scale` 鈕 → 就地彈出步進器；② detail drawer 內一個 Scale 區塊（同一套步進器 UI）。 |
| 後端 | **新增專用 scale binding**（`ScaleKubernetesResource`），直接 patch `spec.replicas`，不覆寫整份 YAML。 |
| 縮到 0 | 步進器內顯示紅色警告、套用鈕變紅，並**額外跳一次 confirmDialog 確認**（避免誤停全部 Pod）。 |
| 刷新 | 沿用現有：成功後本地快照更新 `desiredReplicas`，並 `refreshDashboard`。 |

## UI 方案

> 📄 **互動方案圖**：[kubernetes-scale-replicas-mockup.html](./kubernetes-scale-replicas-mockup.html) — 瀏覽器打開，可加減 / 直接輸入 / 觀察縮到 0 的警告。

### 步進器（列尾彈窗與 drawer 共用）

```
┌───────────────────────────────┐
│ 調整副本數                     │
│ deployment/nginx-deploy        │
│                                │
│      [ − ]   [  3  ]   [ + ]   │
│                                │
│ 目前 3/3，將變更為 3           │
│ ⚠ 縮到 0 會停掉全部 Pod。      │  ← 僅 target=0 時顯示
│                 [取消] [套用]  │
└───────────────────────────────┘
```

- `−` / 輸入框 / `+`：範圍 0–999，非數字歸 0。
- 目標 = 目前值時「套用」disabled；不同值時顯示「套用（X → Z）」。
- target = 0：顯示紅色警告、套用鈕轉為 danger 色，按下先跳 confirmDialog 再送出。

### 入口

- **列尾**：Deployment / StatefulSet 列的 actions 欄加膠囊 `⇕ Scale` 鈕（與現有 hover 圖示鈕、Service 的 Forward 同一欄），點擊就地彈出上述步進器（相對該列定位的 popover）。
- **drawer**：detail drawer 內加一個 Scale 區塊，內嵌同一套步進器。

## 後端設計

後端採 dynamic client + RESTMapper（見 [create_resource.go](../../backend/kubernetes/create_resource.go) 的 `UpdateResource`）。

1. **service 層** `backend/kubernetes/create_resource.go`（或新檔 `scale_resource.go`）：新增 `func (s *Service) ScaleResource(ctx, request) error`：
   - 由 `kind` 經 RESTMapper 取得 GVR。
   - 以 dynamic client 對該資源送 **merge patch** `{"spec":{"replicas":N}}`：
     `clients.dynamic.Resource(gvr).Namespace(ns).Patch(ctx, name, types.MergePatchType, body, metav1.PatchOptions{})`。
   - （替代方案：patch `scale` 子資源 `.../scale`，較符合 API 語意、亦相容 HPA；但 merge patch spec.replicas 對 Deployment/StatefulSet 已足夠且與現有 dynamic 風格一致。）
   - 僅允許 `deployment` / `statefulset`（防呆，避免對不支援的 kind 誤用）。
2. **DTO** `backend/kubernetes/dto`：新增 `KubernetesResourceScaleRequest { kind, name, namespace, replicas }`。
3. **binding 層** [backend/app/bindings_kubernetes.go](../../backend/app/bindings_kubernetes.go)（約 107–137 delete/update 附近）：新增
   `func (a *App) ScaleKubernetesResource(request ...ScaleRequest) error { return a.kubernetes.ScaleResource(a.contextOrBackground(), request) }`。
   Wails 會自動產生前端 binding。

## 前端要改的檔案與位置

### 1. `frontend/src/modules/kubernetes/KubernetesAPI.js`
- 仿 `updateResource`（約 141 行），新增 `scaleResource(request) { return callApp('ScaleKubernetesResource', request); }`。

### 2. `frontend/src/modules/kubernetes/KubernetesSessionStore.js`
- 仿 `deleteSelectedResource` / YAML `updateResource`（約 900–1040），新增 `scaleResource({ kind, name, namespace, replicas })`：
  - `scaleLoading` / `scaleError` 狀態。
  - 呼叫 `api.scaleResource`；成功後本地快照更新該資源的 `desiredReplicas`（並視需要 readyReplicas 交給 refresh）、toast、`refreshDashboard`。

### 3. `frontend/src/modules/kubernetes/KubernetesSessionPage.js`
- **列尾 Scale 鈕**：通用表格 `renderResourceTable`（約 1000–1099）的 actions 欄，`withActions` 目前涵蓋 `services`（Forward）與 `deployments/statefulsets/services`（view pods）。為 deployment/statefulset 加一顆 `data-scale` 的膠囊按鈕。
- **步進器 popover**：新增 `renderScalePopover()` 與開關/加減/輸入/套用的事件（setupListeners 內），縮到 0 走 `confirmDialog`。
- **drawer 區塊**：`renderResourceDetail` / detail body（約 2131）為 deployment/statefulset 加 Scale 區塊，內嵌步進器。
- 狀態：目前值取自該資源 `desiredReplicas`；popover 開啟時帶入。

### 4. `frontend/src/i18n/dict/kubernetes.ts`
- 三語系（en / zhHant / ja）新增 `k8s.scale.*`：標題、目前/目標、縮到 0 警告、套用、確認訊息、成功/失敗 toast 等。

## 執行流程

```
點列尾 ⇕ Scale（或 drawer 內 Scale 區塊）
  → 彈出步進器，帶入目前 desiredReplicas
  → 加減 / 輸入 調整目標值
  → 按「套用」
      target === 0 → 先 confirmDialog 確認
  → store.scaleResource({ kind, name, namespace, replicas })
  → api.scaleResource → 後端 patch spec.replicas
  → 成功 toast、本地快照更新 desiredReplicas、refreshDashboard
```

## 注意事項

- **僅 deployment / statefulset**；DaemonSet 不出現 Scale 鈕、drawer 不顯示 Scale 區塊。
- 前端與後端都要對 kind 做白名單防呆。
- Scale 鈕點擊需 `stopPropagation`，避免觸發列點擊開 detail drawer（與多選勾選框同樣的注意點）。
- 副本數輸入須夾在合理範圍（0–999），非數字歸 0。
- 沿用現有慣例：字串 `escapeHtml`、commit 不加 Claude co-author、讀大檔用 offset/limit 或以 `cat -n` 取原文（Read 對這些大檔會回傳佔位內容）。

## 驗證方式

1. 進 K8s session，開 Deployments：列尾應有 `⇕ Scale` 鈕（DaemonSet 頁則無）。
2. 點 Scale → 步進器帶入目前副本數；加減 / 輸入皆正確；點 Scale 不會開 detail drawer。
3. 調到不同值 → 套用 → Desired 欄更新、toast 成功、稍後 Ready 追上。
4. 調到 0 → 顯示警告、套用鈕變紅、按下先跳確認；確認後副本數歸 0。
5. 開某 Deployment 的 detail drawer → 內有 Scale 區塊，行為一致。
6. StatefulSet 同上；DaemonSet 無 Scale。

# Kubernetes 多選批量刪除設計方案（as-built）

> Kubernetes 資源清單的「凍結表頭 + 多選勾選 + 底部滑出批量刪除」功能。本文件反映實際落成版本
> （commit `239ae1d`）。相關背景見 [kubernetes-scale-replicas.md](./kubernetes-scale-replicas.md)。

## 目錄

- [需求](#需求)
- [已定案決策](#已定案決策)
- [UI 方案](#ui-方案)
- [實作檔案與位置](#實作檔案與位置)
- [執行流程](#執行流程)
- [注意事項](#注意事項)
- [驗證方式](#驗證方式)

## 需求

1. 資源清單表頭（欄位名稱）凍結，垂直捲動時不消失。
2. 每列最左有勾選框，表頭最左有全選框（含半選 indeterminate）。
3. 有勾選時，畫面**底部滑出一條選取列**：顯示已選數量、清除、批量刪除鍵。
4. 按刪除跳確認避免誤觸；選取含高風險資源時，須輸入 `delete` 才能確認。

## 已定案決策

| 項目 | 決策 |
|------|------|
| 選取狀態 | `KubernetesSessionPage` 實例上的 `Map`（`this.selectedRows`），key = `kind|namespace|name`，值含 `{ kind, name, namespace, apiVersion }`。純前端暫態，不進 store。 |
| 跨 section | **切換 section 清空選取**（避免跨資源類型誤刪）。 |
| 可刪範圍 | **全部資源類型皆可多選**；高風險類型（`HIGH_RISK_KUBERNETES_KINDS`）在確認框須打字 `delete`。 |
| 部分失敗 | **逐筆刪除**，結束後 toast 彙總「成功 X / 失敗 Y」，**失敗項保留勾選**、成功項移除。 |
| 刪除後 | 沿用本地快照移除 + `refreshDashboard`。 |
| 選取列呈現 | **底部滑出列**（離邊懸浮的圓角卡片），非頂部工具列。 |
| 確認框 | 擴充共用 `confirmDialog`，新增 `requireText` 選項（帶值時多輸入框，相符前確認鈕 disabled、Enter 也擋）。 |

## UI 方案

> 📄 **互動方案圖**：[kubernetes-multiselect-delete-mockup.html](./kubernetes-multiselect-delete-mockup.html)

### 凍結表頭

- `.kubernetes-resource-table th` 設 `position: sticky; top: 0`，相對捲動容器 `.kubernetes-session-scrollbody` 凍結。
- 背景**必須不透明**：以 `linear-gradient(var(--color-panel-bg), var(--color-panel-bg)), var(--color-bg)` 疊出實色（一般主題）；**全透明玻璃主題**（`--color-bg: transparent`）另以 `backdrop-filter: var(--glass-blur)` 將後方捲動的列霧化。
- `border-collapse` 下 sticky 會丟 border-bottom，改以 `box-shadow: inset 0 -1px 0` 畫分隔線。

### 勾選欄

- 表頭最左注入全選框、每列最左注入列勾選框（`enhanceSelectionColumns`，DOM 注入，涵蓋所有資源表；Events 表 class 不同故不受影響）。
- **整格可點**放大判定範圍，勾選框與格點擊皆 `stopPropagation`，不會誤開 detail drawer。
- 勾選框樣式：背景同內容底色、保留外框；勾選顯示主色勾勾、半選顯示橫槓。
- namespaced 表格列有 3px 左側 namespace 色條，表頭列補等寬透明左邊框以對齊勾選欄。

### 底部滑出選取列

```
┌──────────────────────────────────────────────┐
│  3 selected   ✕ Clear   [含高風險]   🗑 Delete │  ← 離邊懸浮圓角卡片
└──────────────────────────────────────────────┘
```

- 常駐於內容區底部，平時 `translateY(calc(100% + 24px))` 藏在視窗外，有勾選時加 `.visible` 滑出。
- 離邊 16px、自身圓角 `--radius-lg`、全邊框 + 環形陰影（浮起卡片感）。
- 左側：數量、清除鈕、含高風險標記；右側：刪除鍵（膠囊 `border-radius: 999px`，字重/hover 對齊 app 動作按鈕）。
- 滑出時捲動容器加 `margin-bottom`（`.has-selection-bar`），讓**橫向捲軸留在底部列上方**不被遮擋。

### 確認框

- 選取含高風險資源時 `confirmDialog(..., { danger: true, requireText: 'delete', requireTextHint })`；否則一般確認。

## 實作檔案與位置

| 檔案 | 內容 |
|------|------|
| `frontend/src/components/feedback/confirmDialog.js` | 新增 `requireText` / `requireTextHint`：輸入框、相符前確認鈕 disabled、Enter 攔截、焦點落輸入框。 |
| `frontend/src/modules/kubernetes/KubernetesSessionStore.js` | 新增 `batchDeleteResources(list)`：逐筆 `api.deleteResource`，回傳 `{ ok, fail }`，本地快照移除 + `refreshDashboard`。 |
| `frontend/src/modules/kubernetes/KubernetesSessionPage.js` | `this.selectedRows` Map；`selectionRowKey` / `clearSelection` / `renderSelectionBar` / `updateSelectionBar` / `updateSelectAllState` / `clearSelectionUI` / `enhanceSelectionColumns` / `handleBulkDelete`；render() 內容區底部掛底部列（pod action view 時不掛）+ scrollbody 依選取加 `has-selection-bar`；section 導覽點擊清空選取。勾選變動走**增量 DOM 更新**（不整頁重繪）以成立滑出動畫。 |
| `frontend/src/style.css` | sticky 表頭（不透明/backdrop-filter）、底部滑出列、勾選框與勾選欄、統一列高 `td { height: 34px }`、表頭列對齊透明左邊框、捲軸避讓 `margin-bottom`。 |
| `frontend/src/i18n/dict/kubernetes.ts` | `k8s.select.*`、`k8s.bulkDelete.*`（en / zhHant / ja）。 |
| `frontend/src/modules/kubernetes/tests/KubernetesSessionPage.test.mjs` | 更新 section 切換來源斷言（含 `clearSelection()`）。 |

## 執行流程

```
勾選列（增量更新：列高亮、全選態、底部列數量/顯示，滑出動畫）
  → 底部列「🗑 刪除選取」
  → confirmDialog（含高風險資源時 requireText: 'delete'）
  → store.batchDeleteResources(targets)
  → 逐筆刪、收集 { ok, fail }
  → toast「成功 X / 失敗 Y」；失敗項保留勾選、成功項移除
  → 本地快照移除成功項 + refreshDashboard
```

## 注意事項

- 原生 Web Component + Zustand，render 為字串模板、事件在 `setupListeners` 重綁；每次 render 後 `enhanceSelectionColumns` 重新注入勾選欄，勾選態依 `selectedRows` 還原。
- 勾選變動用增量 DOM 更新（不呼叫整頁重繪），否則底部列滑出動畫無法過渡；背景輪詢的整頁重繪則以最終狀態重建、不重播動畫。
- 勾選框/格點擊 `stopPropagation`，避免冒泡到列開 drawer。
- 底部列高度、離邊距離改動時，`.has-selection-bar` 的 `margin-bottom` 要同步（否則橫向捲軸又被遮）。
- 慣例：字串 `escapeHtml`、commit 不加 Claude co-author；大檔用 `cat -n` 取原文（Read 對這些大檔會回傳佔位內容）。

## 驗證方式

1. 進資源頁往下捲 → 表頭凍結、不透明（各主題含玻璃主題皆清晰）。
2. 勾選數列 → 底部滑出選取列；點勾選框/格不會開 drawer；橫向捲軸在選取列上方。
3. 全選/半選正確；清除鈕滑回選取列。
4. 只選 Pod → 刪除免打字；含高風險 → 須輸入 `delete`。
5. 部分失敗 → toast 顯示成功/失敗數,失敗項仍勾選。
6. 切換 section → 選取清空。
7. Pods / Deployment / 其他資源行高一致（34px）。

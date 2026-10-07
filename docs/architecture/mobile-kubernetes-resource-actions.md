# 手機版 Kubernetes 資源操作

## 分類與能力

分類使用英文等寬按鈕，預設以 3 欄、2 列排列；畫面寬度小於 360 或系統字體縮放超過 1.2 時改為 2 欄。分類區與下方資源選單合併為同一張卡片，以分隔線區分層級。資源選單只顯示該分類的種類，不重複分類標題；彈出選單採固定標頭與可捲動清單。Namespace、搜尋列使用一致的 52 高度與 14 圓角。

| 分類 | 資源 |
| --- | --- |
| Workloads | Pod、Deployment、StatefulSet、DaemonSet、ReplicaSet、Job、CronJob、PodDisruptionBudget |
| Networking | Service、Ingress、NetworkPolicy、EndpointSlice |
| Configuration | ConfigMap、Secret、ResourceQuota、LimitRange |
| Storage | PersistentVolumeClaim |
| Autoscaling | HorizontalPodAutoscaler |
| Access Control | ServiceAccount、Role、RoleBinding |

所有查詢以選定叢集與 Namespace 為範圍，保留 200 筆清單上限。資源 API 路徑採允許清單，不接受任意路徑。工作負載清單顯示「已就緒／總數」，其他資源顯示其連接埠、排程、儲存容量或項目數。Secret 的資料值與 annotations 不進入 YAML 預覽，遮蔽後的文件不可編輯，以免誤清除原值。

## 新增唯讀資源

新增 9 種資源後，共支援 21 種 Namespace 範圍內的資源。新增類型提供摘要、搜尋、下拉刷新、背景更新與 YAML 查看；不顯示編輯、image、縮放或刪除入口，工作區與原生層也阻擋寫入。唯讀 YAML 保留 `status`，省略 `managedFields`，僅存在記憶體。

- HPA：目標工作負載、目前／期望副本、最小／最大副本；使用 `autoscaling/v2`。
- PodDisruptionBudget：目前／期望健康數、允許中斷數；使用 `policy/v1`。
- NetworkPolicy：流量方向；EndpointSlice：位址類型、端點總數與就緒／未知數。
- ServiceAccount：Token 自動掛載設定、image pull Secret 數量；不讀取 Secret 內容。
- Role：規則數；RoleBinding：角色參照與綁定對象數。
- ResourceQuota：各項已用／上限，缺少用量時顯示 Unknown；LimitRange：限制對象類型，詳細限制可查看 YAML。

需要目前 kubeconfig 具備對應資源的 `list`、`get` 權限。403 或 API 不支援時沿用錯誤提示，不呈現假的空清單。此批不包含 Node、PersistentVolume 等叢集範圍資源，也不自動探索 CRD。

參考：[Kubernetes HPA API](https://kubernetes.io/docs/reference/kubernetes-api/autoscaling/horizontal-pod-autoscaler-v2/)、[Kubernetes RBAC](https://kubernetes.io/docs/reference/access-authn-authz/rbac/)。

## 零副本與 Scale

Deployment、StatefulSet、ReplicaSet 可從資源詳情調整副本，不依賴 Pod 存在。保留數字輸入框，增加上下鍵，範圍為 0 至 2147483647；確認畫面顯示舊值與新值。

根因：Kubernetes `autoscaling/v1.ScaleSpec.replicas` 使用 `omitempty`，0 會省略該欄位；舊解析器要求非空指標，因此將合法的零副本回應誤判為 `api_failed`。修正將省略值解析為 0，繼續檢查 API 版本、資源名稱、Namespace、UID 與 resourceVersion。送出的變更仍必須明確包含副本數。

更新後重新載入資源清單，使使用者關閉 Scale 面板後仍可再次操作。API 接受期望數量不等於 Pod 已就緒；就緒數保持叢集查詢的結果。

參考：[Kubernetes ScaleSpec 原始碼](https://github.com/kubernetes/api/blob/master/autoscaling/v1/types.go)。

## 刪除

1. 從資源詳情點「刪除資源」。
2. 重新讀取目標，顯示叢集、Namespace、種類與名稱。
3. 直接點「再次確認刪除」送出，不另設勾選框。
4. 使用 `DeleteOptions.preconditions` 帶入 UID 與 resourceVersion，採 Background 傳播；不使用強制刪除。
5. 送出期間阻擋重複送出與切換操作目標。關閉面板不撤回已送出的刪除。
6. 顯示「已送出刪除要求」，重新查詢清單；不將 API 接受等同於 finalizer 已完成。

403、404、409 分別顯示權限、不存在與衝突訊息；連線中斷或不明回應顯示結果未知，不自動重送。衝突後需重新讀取並再次確認。

## 回歸驗證

- Go：省略零副本的讀取、0 → 1 → 0、資源路徑、CronJob active 清單、Secret 遮蔽、刪除條件與 200／202／204、失敗不重送。
- 工作區：沒有 Pod 時可調整副本、刷新後保留操作入口、刪除二次確認、送出途中關閉與目標鎖定。
- UI：分類切換、數字輸入與上下鍵、0 的下限、刪除確認按鈕與取消。
- 完整檢查：typecheck、lint、npm test、Go race、iOS／Android 資產匯出與 iOS 模擬器 Release 建置。

## 本次驗證紀錄

2026-10-05：typecheck、lint、72 項領域測試、50 項 UI 測試、Go race 與雙平台資產匯出通過。iOS Release 模擬器建置及簽署成功，已安裝並在 Device Hub 的 iPhone 17 Pro／iOS 26.5 啟動，確認可進入 Kubernetes 頁面。模擬器尚未匯入 kubeconfig，未執行實際叢集的縮放或刪除。

新增唯讀資源驗證：75 項領域測試、53 項 UI 測試、Go race、typecheck、lint、雙平台資產匯出與 iOS Release 建置通過。Device Hub 的 iPhone 17 Pro 已更新，使用既有 minikube 設定成功查看 ServiceAccount 清單、詳情與唯讀 YAML；未修改叢集資源。Go 測試涵蓋 9 種 API 路徑與摘要、YAML 狀態保留、寫入拒絕、403／404 與跨 Namespace 回應拒絕。

## 資源背景刷新

- 資源頁面停留於前景時，每 10 秒查詢目前叢集、Namespace 與資源種類。
- 同一範圍的手動與自動刷新保留列表、用量、搜尋條件及捲動位置，不先清空內容；移除右上角刷新按鈕，手動刷新改由列表頂端下拉觸發。只有下拉操作會顯示原生刷新指示器，自動更新不顯示。
- 同一輪包含資源與用量查詢；尚未完成時略過下一輪，避免慢速網路累積請求。
- 離開頁面或 App 進入背景時停止計時並忽略未完成的列表回應；回到前景立即更新。
- YAML、Scale、刪除、ConfigMap 內容、Log 或用量面板開啟時，略過背景查詢，保留使用者輸入與確認中的版本。
- 背景查詢失敗時保留資料及上次成功的更新時間，顯示失敗提示；用量失敗時保留舊用量並標示。後續成功更新會清除提示。
- 回歸涵蓋慢速請求不重疊、列表不卸載、下拉觸發刷新、背景停止、取消舊回應與編輯內容不受影響。

## Scale 完成後黑畫面修正

狀態：已在 iPhone 17 Pro／iOS 26.5、React Native 0.86.3 的 Release 版本，使用隔離 Deployment 實際送出 Scale，重現黑畫面並完成修正。

### 根因

1. `submitScale()` 收到結果後清空過期資源，接著重新讀取列表；這段期間 `status` 為 `idle`。
2. 詳情選取依賴 `status === 'ready'`，所以畫面暫時切回列表，`ScrollView.refreshControl` 從沒有變成有，查詢完成又移除。
3. React Native 的實際 ScrollView 會在有 RefreshControl 時改變子元素結構，使內容子樹重新掛載。
4. Scale 等操作視窗原本位於此子樹，於原生視窗仍開啟時被卸載、重新呈現，造成 UIKit 呈現衝突，留下無內容與控制項的黑畫面。

原本 Jest 預設的 ScrollView mock 不會模擬這種子樹切換，既有測試即使取得成功提示也無法攔截此問題。前次僅驗證視窗開關並改用 `fullScreen`，未涵蓋實際送出後的列表更新，驗證不足。

### 修正與回歸

- 將 ConfigMap 內容、Log、Scale、刪除、YAML 與用量視窗移到列表 ScrollView 外，維持固定的父層與元件實例。
- 保留 KubernetesModal 的全螢幕呈現與獨立安全區域，關閉按鈕不受狀態列遮擋。
- 保留副本寫入 API、版本衝突檢查與清除過期列表的既有行為。
- 新增 `kubernetesScaleLifecycle.ui.test.tsx`：使用實際 ScrollView，控制 Scale 後列表查詢的延遲，在等待與完成兩個階段確認關閉控制項仍為原實例，最後關閉並驗證詳情可操作。

回歸命令（於 `apps/mobile`）：

```bash
npm run test:ui -- kubernetesScaleLifecycle
```

修正前：`Expected: true / Received: false`，關閉控制項因視窗重建而換成另一個實例。修正後：PASS。

原生驗證使用本機 minikube 的獨立 Namespace `termix-scale-check-20261005` 與 Deployment `scale-check`，指定不存在的節點，避免執行工作負載。修正前實際 `0 → 1` 重現黑畫面；修正後完成 `1 → 0 → 1 → 0`，每次保留成功提示與關閉按鈕，返回詳情顯示正確副本數。另一次 409 版本衝突正常顯示錯誤且可重新讀取。驗證完成後回到原本的 default Namespace，清除本次隔離測試資源；未修改既有 Deployment 的副本數。

驗證：75 項領域測試、56 項 UI 測試、typecheck、lint 與 iOS Release 建置通過。

參考：[SafeAreaProvider 的 Modal 使用說明](https://appandflow.github.io/react-native-safe-area-context/api/safe-area-provider/)。

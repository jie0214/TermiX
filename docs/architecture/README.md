# 架構文件

本目錄包含 TermiX 各子系統的架構與設計文件。

## 文件列表

- [Kubernetes 多選批次刪除設計方案](./kubernetes-multiselect-delete.md)：凍結表頭、多選勾選、底部滑出批次刪除，記錄現行實作。附[互動方案圖](./kubernetes-multiselect-delete-mockup.html)。
- [Kubernetes 調整副本數設計方案](./kubernetes-scale-replicas.md)：Deployment／StatefulSet 調整 Pod 副本數（Scale）的 UI 與後端設計。附[互動方案圖](./kubernetes-scale-replicas-mockup.html)。
- [Kubernetes 資源詳情 ENV 呈現設計方案](./kubernetes-env-detail.md)：ENV 分頁採「依來源分區」的雙欄 key-value 表格，Secret 不顯示明文，記錄現行實作。

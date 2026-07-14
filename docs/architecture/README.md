# 架构文件

本目录包含 TermiX 各子系统的架构与设计文档。

## 文档列表

- [Kubernetes 多选批量删除设计方案](./kubernetes-multiselect-delete.md) — 冻结表头、多选勾选、底部滑出批量删除（as-built）。附互动方案图 [mockup](./kubernetes-multiselect-delete-mockup.html)。
- [Kubernetes 调整副本数设计方案](./kubernetes-scale-replicas.md) — Deployment/StatefulSet 调整 Pod 副本数（Scale）的 UI 与后端设计。附互动方案图 [mockup](./kubernetes-scale-replicas-mockup.html)。
- [Kubernetes 资源详情 ENV 呈现设计方案](./kubernetes-env-detail.md) — ENV 分页改为「依来源分区」的双栏 key-value 表格，Secret 不显示明文（as-built）。

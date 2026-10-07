// 百分比以 Node 總容量為分母；缺少樣本或容量時不顯示成 0%。
export function renderNodeUsage(used, capacity, available, format) {
  if (!available || !Number.isFinite(used) || !Number.isFinite(capacity) || used < 0 || capacity <= 0) {
    return '<span class="kubernetes-node-usage-empty">無資料</span>';
  }
  const percentage = used / capacity * 100;
  const level = percentage >= 90 ? 'danger' : percentage >= 70 ? 'warning' : 'success';
  return `<div class="kubernetes-node-usage" title="使用量／Node 總容量">
    <strong>${percentage.toFixed(1)}%</strong>
    <span class="kubernetes-node-usage-track" aria-hidden="true"><span style="width:${Math.min(100, percentage)}%;background:var(--color-${level})"></span></span>
    <small>${format(used)} / ${format(capacity)}</small>
  </div>`;
}

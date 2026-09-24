// 以原生能力為準；帳號未登入或網路錯誤不會移除同步入口。
export function mobileSyncOptions(status, t) {
  const options = [{ value: 'file', label: t('hostvault.mobileExport') }];
  if (status.capability === 'available') {
    options.push({ value: 'toggle', label: t(status.enabled ? 'hostvault.mobileCloudDisable' : 'hostvault.mobileCloudEnable') });
    if (status.enabled) options.push({ value: 'refresh', label: t('hostvault.mobileCloudRefresh') });
  }
  return options;
}

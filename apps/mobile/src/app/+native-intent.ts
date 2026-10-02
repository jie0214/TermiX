// 外部連結僅允許開啟固定頁面；拒絕參數、編碼內容及超長輸入。
// 目前沒有 OAuth callback 或由 URL 執行指令的功能。
const pages = new Set(['/', '/terminal', '/kubernetes', '/settings', '/settings/cloud-accounts', '/settings/kubernetes']);
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  if (typeof path !== 'string' || path.length > 256 || /[%?#\\\s]/.test(path)) return '/';
  const route = path.replace(/^(?:termix|com\.jie0214\.termix\.mobile):\/\//, '/');
  return pages.has(route) ? route : '/';
}

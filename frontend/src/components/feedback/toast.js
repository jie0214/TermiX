// 通用輕量 toast 提示。
// 直接 appendChild 到一個持久的 live region 容器（掛在 document.body），
// 避免被 App 的 innerHTML 重繪清掉，並讓螢幕閱讀器可靠朗讀。
// 用法：showToast('已套用', { type: 'success' })

// 各 type → 主題色變數（隨淺/深色主題切換，不再寫死深色值）。
// accent/border 用該語意色，bg 用面板底色混入少量語意色（維持可讀對比）。
const TOAST_TYPES = {
  info: '--color-info',
  success: '--color-success',
  error: '--color-danger'
};

function escapeHtml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// 取得（或建立）持久的 live region 容器：polite 供一般狀態，assertive 供 error。
// 兩個 region 皆 aria-atomic，讓每則訊息被完整朗讀。容器不攔截點擊（pointer-events: none），
// 個別 toast 再開啟自身的 pointer-events 以支援關閉鈕。
function ensureToastRegion(type) {
  const assertive = type === 'error';
  const id = assertive ? 'termix-toast-region-assertive' : 'termix-toast-region-polite';
  let region = document.getElementById(id);
  if (region) return region;
  region = document.createElement('div');
  region.id = id;
  region.setAttribute('aria-live', assertive ? 'assertive' : 'polite');
  region.setAttribute('aria-atomic', 'true');
  region.style.cssText = [
    'position: fixed',
    'right: 20px',
    'bottom: 20px',
    'z-index: 4000',
    'display: flex',
    'flex-direction: column',
    'align-items: flex-end',
    'gap: 8px',
    'pointer-events: none'
  ].join(';');
  document.body.appendChild(region);
  return region;
}

/**
 * 顯示一個非阻塞式 toast。
 * @param {string} message 主要訊息（純文字，會被自動跳脫）。
 * @param {{ type?: 'info'|'success'|'error', title?: string, durationMs?: number }} [options]
 * @returns {HTMLElement|null} toast 元素（失敗時回傳 null）。
 */
export function showToast(message, options = {}) {
  if (typeof document === 'undefined' || !document.body) return null;
  const { type = 'info', title = '' } = options;
  const colorVar = TOAST_TYPES[type] || TOAST_TYPES.info;
  // error 類預設停留較久（可讓使用者讀完錯誤並用關閉鈕手動移除）。
  const durationMs = options.durationMs ?? (type === 'error' ? 8000 : 3500);

  try {
    const region = ensureToastRegion(type);
    const toast = document.createElement('div');
    // 沿用既有 role 語意：error → alert、其餘 → status。
    toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
    toast.style.cssText = [
      'position: relative',
      'max-width: 320px',
      'padding: 12px 16px',
      // 底色以面板底色混入少量語意色，淺色主題不再突兀。
      `background: color-mix(in srgb, var(${colorVar}) 10%, var(--color-panel-bg))`,
      `border: 1px solid color-mix(in srgb, var(${colorVar}) 45%, transparent)`,
      `border-left: 3px solid var(${colorVar})`,
      'border-radius: 8px',
      'color: var(--color-text)',
      'font-size: 12.5px',
      'line-height: 1.5',
      'box-shadow: 0 8px 24px rgba(0,0,0,0.25)',
      'opacity: 0',
      'pointer-events: auto',
      'transition: opacity 0.2s ease'
    ].join(';');

    const titleHtml = title
      ? `<div style="font-weight: 700; color: var(${colorVar}); margin-bottom: 4px;">${escapeHtml(title)}</div>`
      : '';
    // error 類附關閉鈕（可手動移除），其餘維持自動淡出。
    const closeHtml = type === 'error'
      ? '<button type="button" aria-label="關閉通知" style="position:absolute;top:4px;right:4px;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;padding:0;background:none;border:0;color:var(--color-text);opacity:0.6;font-size:16px;line-height:1;cursor:pointer;">×</button>'
      : '';
    toast.innerHTML = `${closeHtml}${titleHtml}<div${type === 'error' ? ' style="padding-right:24px;"' : ''}>${escapeHtml(message)}</div>`;

    let removed = false;
    const dismiss = () => {
      if (removed) return;
      removed = true;
      toast.style.opacity = '0';
      setTimeout(() => { toast.remove(); }, 250);
    };
    toast.querySelector('button')?.addEventListener('click', dismiss);

    region.appendChild(toast);
    requestAnimationFrame(() => { toast.style.opacity = '1'; });
    setTimeout(dismiss, durationMs);
    return toast;
  } catch (e) {
    console.warn('[TermiX] showToast failed', e);
    return null;
  }
}

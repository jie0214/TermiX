// 通用確認對話框（非阻塞、Promise 化）。
// 直接 appendChild 到 document.body，避免被 App 的 innerHTML 重繪清掉。
// 用法：if (!(await confirmDialog('確定要刪除嗎？', { danger: true }))) return;

import { t } from '../../i18n/index.ts';

function escapeHtml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * 顯示一個非阻塞式確認對話框。
 * @param {string} message 主要訊息（純文字，會被自動跳脫；支援 \n 換行）。
 * @param {{ title?: string, confirmText?: string, cancelText?: string, danger?: boolean, requireText?: string, requireTextHint?: string }} [options]
 * @returns {Promise<boolean>} 確認 = true，取消/關閉/Esc = false。
 */
export function confirmDialog(message, options = {}) {
  return new Promise((resolve) => {
    if (typeof document === 'undefined' || !document.body) {
      resolve(false);
      return;
    }

    const {
      title = t('misc.confirmDialog.title'),
      confirmText = t('common.confirm'),
      cancelText = t('common.cancel'),
      danger = false,
      // requireText：非空時要求使用者輸入相符文字才能確認（防誤觸）；
      // requireTextHint 為輸入框上方的說明文字（呼叫端已完成 i18n）。
      requireText = '',
      requireTextHint = ''
    } = options;
    const needsText = String(requireText).length > 0;

    let settled = false;
    let keydownHandler = null;

    const overlay = document.createElement('div');
    overlay.setAttribute('role', 'presentation');
    overlay.style.cssText = [
      'position: fixed',
      'inset: 0',
      'background: rgba(0,0,0,0.6)',
      'display: flex',
      'align-items: center',
      'justify-content: center',
      'z-index: 4100'
    ].join(';');

    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.style.cssText = [
      'width: 340px',
      'max-width: calc(100vw - 32px)',
      'background: var(--dialog-bg)',
      'border: 1px solid var(--color-border)',
      'border-radius: 8px',
      'padding: 20px',
      'color: var(--color-text)',
      'box-shadow: 0 12px 40px rgba(0,0,0,0.5)'
    ].join(';');

    // \n 轉成 <br>（在跳脫之後處理，避免 XSS）
    const messageHtml = escapeHtml(message).replace(/\n/g, '<br>');
    const confirmBg = danger ? 'var(--color-danger)' : 'var(--color-primary)';
    const confirmBorder = danger ? 'var(--color-danger)' : 'var(--color-primary)';

    // requireText 模式：訊息與按鈕之間插入說明 + 輸入框，確認鈕預設 disabled。
    const requireBlock = needsText ? `
      ${requireTextHint ? `<p style="font-size: 12.5px; color: var(--color-danger); line-height: 1.6; margin: 0 0 8px; text-align: left;">${escapeHtml(requireTextHint)}</p>` : ''}
      <input type="text" data-role="require-input" class="no-drag" placeholder="${escapeHtml(requireText)}" style="width: 100%; box-sizing: border-box; min-height: 34px; padding: 0 12px; margin: 0 0 20px; border: 1px solid var(--color-border); border-radius: 4px; background: var(--input-bg); color: var(--color-text); font: inherit;">
    ` : '';
    dialog.innerHTML = `
      <h2 style="font-size: 14px; font-weight: 700; margin: 0 0 12px; text-align: left;">${escapeHtml(title)}</h2>
      <p style="font-size: 12.5px; color: var(--color-subtext); line-height: 1.6; margin: 0 0 ${needsText ? '12px' : '20px'}; text-align: left;">${messageHtml}</p>
      ${requireBlock}
      <div style="display: flex; justify-content: flex-end; gap: 8px;">
        <button type="button" data-action="cancel" class="no-drag" style="min-height: 32px; padding: 6px 14px; border: 1px solid var(--color-border); background: transparent; color: var(--color-text); border-radius: 4px; cursor: pointer;">${escapeHtml(cancelText)}</button>
        <button type="button" data-action="confirm" class="no-drag"${needsText ? ' disabled' : ''} style="min-height: 32px; padding: 6px 14px; background: ${confirmBg}; border: 1px solid ${confirmBorder}; color: #fff; border-radius: 4px; cursor: pointer;${needsText ? ' opacity: 0.5;' : ''}">${escapeHtml(confirmText)}</button>
      </div>
    `;

    overlay.appendChild(dialog);

    function cleanup() {
      if (keydownHandler) document.removeEventListener('keydown', keydownHandler);
      overlay.remove();
    }

    function settle(result) {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    }

    const confirmBtn = dialog.querySelector('[data-action="confirm"]');
    const requireInput = dialog.querySelector('[data-role="require-input"]');
    // requireText 模式下，輸入相符才允許確認（含 Enter）。
    const matched = () => !needsText || requireInput.value.trim() === String(requireText);

    keydownHandler = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        settle(false);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (matched()) settle(true);
      }
    };
    document.addEventListener('keydown', keydownHandler);

    overlay.addEventListener('mousedown', (e) => {
      // 僅在點到遮罩本身（非對話框內容）時關閉
      if (e.target === overlay) settle(false);
    });

    dialog.querySelector('[data-action="cancel"]').addEventListener('click', () => settle(false));
    confirmBtn.addEventListener('click', () => { if (matched()) settle(true); });

    if (requireInput) {
      requireInput.addEventListener('input', () => {
        const ok = matched();
        confirmBtn.disabled = !ok;
        confirmBtn.style.opacity = ok ? '1' : '0.5';
      });
    }

    document.body.appendChild(overlay);

    // focus：requireText 模式落在輸入框，否則落在預設（確認）按鈕。
    const focusTarget = requireInput || confirmBtn;
    requestAnimationFrame(() => { try { focusTarget.focus(); } catch (_) { /* noop */ } });
  });
}

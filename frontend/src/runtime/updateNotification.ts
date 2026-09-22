import { dismissUpdateVersion } from './updatePolicy';
// 右上角「有新版本可用」彈出小卡。
// 非阻塞且不自動消失；同版本維持原卡片，避免每小時重設操作狀態。
// 樣式沿用主題色變數（--color-*），隨淺/深色主題切換。

import { getAppBinding, openBrowserURL } from '../platform/wails';
import { showToast } from '../components/feedback/toast.js';
import { t } from '../i18n/index.ts';

const CONTAINER_ID = 'termix-update-notification';

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function openReleasePage(url: string): void {
  openBrowserURL(url);
}

/**
 * 顯示右上角更新通知小卡。
 * @param latestVersion 最新版本號（如 "1.2.0"）。
 * @param releaseUrl    下載 / Release 頁面連結。
 */
export function showUpdateNotification(latestVersion: string, releaseUrl: string): void {
  if (typeof document === 'undefined' || !document.body) return;

  // 移除既有卡片，避免重複（例如自動檢查後又手動檢查）。
  const existing = document.getElementById(CONTAINER_ID);
  if (existing?.dataset.version === latestVersion) return;
  existing?.remove();

  const card = document.createElement('div');
  card.id = CONTAINER_ID;
  card.dataset.version = latestVersion;
  card.setAttribute('role', 'status');
  card.setAttribute('aria-live', 'polite');
  card.style.cssText = [
    'position: fixed',
    'top: 20px',
    'right: 20px',
    'z-index: 4000',
    'width: 320px',
    'max-width: calc(100vw - 40px)',
    'padding: 16px 18px',
    // 毛玻璃主題下 --color-panel-bg 為半透明，僅靠底色會透出後方視窗；
    // 沿用本 App 面板/下拉選單的作法加 backdrop blur，實心主題維持完全不透明，
    // 玻璃主題則變霧面（與其他面板一致，後方視窗被模糊而不再干擾閱讀）。
    'background: color-mix(in srgb, var(--color-info) 10%, var(--color-panel-bg))',
    'backdrop-filter: blur(24px) saturate(1.5)',
    '-webkit-backdrop-filter: blur(24px) saturate(1.5)',
    'border: 1px solid color-mix(in srgb, var(--color-info) 45%, transparent)',
    'border-radius: 10px',
    'color: var(--color-text)',
    'box-shadow: 0 12px 32px rgba(0,0,0,0.45)',
    'opacity: 0',
    'transform: translateY(-8px)',
    'transition: opacity 0.2s ease, transform 0.2s ease',
  ].join(';');

  const title = escapeHtml(t('misc.update.title'));
  const ready = escapeHtml(t('misc.update.ready', { latest: latestVersion }));
  const hint = escapeHtml(t('misc.update.hint'));
  const confirmLabel = escapeHtml(t('misc.update.confirm'));
  const closeLabel = escapeHtml(t('misc.update.close'));

  card.innerHTML = `
    <button class="ui-button ui-button--quiet ui-button--icon ui-button--compact" type="button" data-action="close" aria-label="${closeLabel}"
      style="position:absolute;top:8px;right:8px;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;padding:0;opacity:0.6;line-height:1;cursor:pointer;">×</button>
    <div style="display:flex;align-items:center;gap:8px;font-weight:700;color:var(--color-info);padding-right:24px;">
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg><span>${title}</span>
    </div>
    <div style="margin-top:6px;font-size:13px;line-height:1.5;">${ready}</div>
    <div style="margin-top:4px;font-size:11.5px;line-height:1.5;opacity:0.65;">${hint}</div>
    <div style="margin-top:12px;text-align:right;">
      <button class="ui-button ui-button--primary" type="button" data-action="download"
        style="padding:6px 14px;cursor:pointer;">${confirmLabel}</button>
    </div>`;

  const dismiss = () => {
    card.style.opacity = '0';
    card.style.transform = 'translateY(-8px)';
    setTimeout(() => card.remove(), 220);
  };

  card.querySelector('[data-action="close"]')?.addEventListener('click', () => { dismissUpdateVersion(latestVersion); dismiss(); });

  const downloadBtn = card.querySelector<HTMLButtonElement>('[data-action="download"]');
  downloadBtn?.addEventListener('click', async () => {
    // 半自動更新：後端下載對應平台壓縮檔至「下載」資料夾並於檔案管理員顯示；
    // 使用者解壓覆蓋即可。下載失敗時退回以瀏覽器開啟 Release 頁面。
    const downloadUpdate = getAppBinding('DownloadUpdate');
    if (!downloadUpdate) {
      if (releaseUrl) openReleasePage(releaseUrl);
      return;
    }

    downloadBtn.disabled = true;
    downloadBtn.style.opacity = '0.6';
    downloadBtn.style.cursor = 'default';
    downloadBtn.textContent = t('misc.update.downloading');

    try {
      const result = await downloadUpdate();
      if (result?.success) {
        showToast(t('misc.update.downloaded'), { type: 'success', durationMs: 8000 });
        dismiss();
        return;
      }
      throw new Error(result?.error ?? 'download failed');
    } catch (error) {
      console.warn('[TermiX] 更新下載失敗', error);
      showToast(t('misc.update.downloadFailed'), { type: 'error' });
      if (releaseUrl) openReleasePage(releaseUrl);
      downloadBtn.disabled = false;
      downloadBtn.style.opacity = '1';
      downloadBtn.style.cursor = 'pointer';
      downloadBtn.textContent = t('misc.update.confirm');
    }
  });

  document.body.appendChild(card);
  requestAnimationFrame(() => {
    card.style.opacity = '1';
    card.style.transform = 'translateY(0)';
  });
}

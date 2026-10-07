import { onWailsEvent } from '../platform/wails/events';
import { t } from '../i18n/index.ts';
import './updateProgress.css';

type DownloadStatus = 'downloading' | 'verifying' | 'ready' | 'error' | 'cancelled';
export interface DownloadProgress {
  version: string;
  status: DownloadStatus;
  receivedBytes: number;
  totalBytes: number;
}

const statuses = new Set(['downloading', 'verifying', 'ready', 'error', 'cancelled']);
export function parseDownloadProgress(value: unknown): DownloadProgress | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  if (typeof data.version !== 'string' || !data.version || !statuses.has(String(data.status))) return null;
  const received = Number(data.receivedBytes), total = Number(data.totalBytes);
  if (!Number.isFinite(received) || !Number.isFinite(total) || received < 0 || total < 0) return null;
  return { version: data.version, status: data.status as DownloadStatus, receivedBytes: received, totalBytes: total };
}

export function downloadPercent(progress: DownloadProgress): number | null {
  if (progress.status === 'ready') return 100;
  if (progress.totalBytes <= 0 || progress.receivedBytes > progress.totalBytes) return null;
  return Math.min(100, Math.floor(progress.receivedBytes / progress.totalBytes * 100));
}
function megabytes(bytes: number): string { return `${(bytes / 1_000_000).toFixed(1)} MB`; }

// 元件只更新內容，不重建按鈕，保留鍵盤焦點與使用者的收合狀態。
export function createDownloadProgressWidget(host: HTMLElement = document.body) {
  let root: HTMLElement | null = null;
  let collapsed = true;
  let dismissed = '';
  let previous: DownloadProgress | null = null;
  function update(progress: DownloadProgress) {
    const signature = `${progress.version}:${progress.status}`;
    if (dismissed === signature) return;
    if (progress.status === 'downloading') dismissed = '';
    if (previous && previous.version !== progress.version) collapsed = true;
    if (!root) {
      root = document.createElement('aside');
      root.className = 'termix-download-progress';
      root.innerHTML = `<button type="button" class="termix-download-toggle" aria-expanded="false">
        <span class="termix-download-ring"><svg viewBox="0 0 48 48" aria-hidden="true"><circle class="track" cx="24" cy="24" r="20"/><circle class="fill" cx="24" cy="24" r="20" pathLength="100"/></svg><span class="termix-download-symbol" aria-hidden="true">↓</span></span>
        <span class="termix-download-badge"></span></button>
        <div class="termix-download-detail" hidden><div class="termix-download-heading"><strong></strong><button type="button" class="termix-download-collapse">⌄</button></div>
        <div class="termix-download-version"></div><div class="termix-download-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100"><span></span></div>
        <div class="termix-download-footer"><span class="termix-download-bytes"></span><span class="termix-download-percent"></span></div>
        <button type="button" class="termix-download-dismiss" hidden></button></div>
        <span class="termix-download-announcement" role="status" aria-live="polite"></span>`;
      root.querySelector('button')!.addEventListener('click', () => { collapsed = !collapsed; renderExpansion(); });
      root.querySelector('.termix-download-collapse')!.addEventListener('click', () => {
        collapsed = true; renderExpansion(); root!.querySelector<HTMLButtonElement>('button')!.focus();
      });
      root.querySelector('.termix-download-dismiss')!.addEventListener('click', () => {
        if (previous) dismissed = `${previous.version}:${previous.status}`;
        root?.remove(); root = null;
      });
      root.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !collapsed) { collapsed = true; renderExpansion(); root!.querySelector<HTMLButtonElement>('button')!.focus(); }
      });
      host.appendChild(root);
    }
    const title = t(`misc.download.${progress.status}`);
    const percent = downloadPercent(progress);
    const downloading = progress.status === 'downloading';
    const pending = downloading || progress.status === 'verifying';
    const unknown = percent === null || progress.status === 'verifying';
    const text = downloading && percent !== null ? `${percent}%` : progress.status === 'ready' ? '100%' : progress.status === 'error' ? '!' : progress.status === 'cancelled' ? '−' : '…';
    root.dataset.status = progress.status;
    root.classList.toggle('is-indeterminate', unknown && pending);
    root.style.setProperty('--download-progress', `${percent ?? 24}`);
    root.querySelector('strong')!.textContent = title;
    root.querySelector('.termix-download-version')!.textContent = `TermiX v${progress.version.replace(/^v/, '')}`;
    root.querySelector('.termix-download-symbol')!.textContent = progress.status === 'ready' ? '✓' : progress.status === 'error' ? '!' : progress.status === 'cancelled' ? '−' : '↓';
    root.querySelector('.termix-download-badge')!.textContent = text;
    root.querySelector('.termix-download-percent')!.textContent = downloading && percent !== null ? `${percent}%` : '';
    root.querySelector('.termix-download-bytes')!.textContent = downloading
      ? percent !== null ? `${megabytes(progress.receivedBytes)} / ${megabytes(progress.totalBytes)}`
        : progress.receivedBytes > 0 ? megabytes(progress.receivedBytes) : t('misc.download.unknown')
      : t(`misc.download.${progress.status}Hint`);
    const bar = root.querySelector<HTMLElement>('.termix-download-bar')!;
    bar.setAttribute('aria-label', title);
    bar.hidden = !pending;
    if (unknown) bar.removeAttribute('aria-valuenow'); else bar.setAttribute('aria-valuenow', String(percent));
    bar.style.setProperty('--download-width', `${unknown ? 28 : percent}%`);
    const dismiss = root.querySelector<HTMLButtonElement>('.termix-download-dismiss')!;
    dismiss.hidden = pending;
    dismiss.textContent = t('misc.download.dismiss');
    root.querySelector('.termix-download-collapse')!.setAttribute('aria-label', t('misc.download.collapse'));
    root.querySelector('.termix-download-toggle')!.setAttribute('aria-label', `${title}${downloading && percent !== null ? ` ${percent}%` : ''}`);
    if (previous?.status !== progress.status || previous.version !== progress.version) {
      root.querySelector('.termix-download-announcement')!.textContent = `${title}，TermiX ${progress.version}`;
    }
    previous = progress;
    renderExpansion();
  }
  function renderExpansion() {
    if (!root) return;
    root.classList.toggle('is-collapsed', collapsed);
    root.querySelector('.termix-download-toggle')!.setAttribute('aria-expanded', String(!collapsed));
    root.querySelector<HTMLElement>('.termix-download-detail')!.hidden = collapsed;
  }
  return { update, destroy() { root?.remove(); root = null; } };
}

let registered = false;
export function registerDownloadProgressListener(): void {
  if (registered) return;
  registered = true;
  const widget = createDownloadProgressWidget();
  onWailsEvent('update-download-progress', (value: unknown) => {
    const progress = parseDownloadProgress(value);
    if (!progress) return;
    // 下載開始後由進度元件接手，避免同時遮住兩個角落。
    document.getElementById('termix-update-notification')?.remove();
    widget.update(progress);
  });
}

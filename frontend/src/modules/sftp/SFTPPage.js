import { onWailsFileDrop } from '../../platform/wails/events.ts';
import { HostAPI } from '../hostvault/HostAPI';
import { confirmDialog } from '../../components/feedback/confirmDialog';
import { sftpCall, sftpViewState, joinRemotePath, parentRemotePath, escapeSFTP as esc, formatBytes, filterSFTPHosts, readRecentSFTPHosts, recordSFTPConnection, remoteDropDestination, localUploadPaths, transferDisplay } from './SFTPService';
import './sftp.css';

const statusLabels = { queued: '等候中', running: '進行中', completed: '完成', failed: '失敗' };
const typeLabels = { directory: '資料夾', file: '檔案', symlink: '符號連結', special: '特殊檔案' };

const iconClasses = {
  'search': 'ti ti-search',
  'server': 'ti ti-server',
  'device-desktop': 'ti ti-device-desktop',
  'folder': 'ti ti-folder',
  'upload': 'ti ti-upload',
  'arrow-up': 'ti ti-arrow-up',
  'refresh': 'ti ti-refresh',
  'arrow-right': 'ti ti-arrow-right',
  'download': 'ti ti-download',
  'folder-plus': 'ti ti-folder-plus',
  'dots': 'ti ti-dots',
  'chevron-down': 'ti ti-chevron-down',
  'playlist-x': 'ti ti-playlist-x',
  'link': 'ti ti-link',
  'file': 'ti ti-file',
};
const icon = name => `<i class="${iconClasses[name]}" aria-hidden="true"></i>`;
const iconButton = (action, name, label, attributes = '') => `<button type="button" data-action="${action}" class="sftp-icon-button" title="${label}" aria-label="${label}" ${attributes}>${icon(name)}</button>`;
const fileIcon = type => `<span class="sftp-file-icon sftp-file-icon--${esc(type)}" title="${esc(typeLabels[type] || type)}">${icon(type === 'directory' ? 'folder' : type === 'symlink' ? 'link' : 'file')}</span>`;

class SFTPPage extends HTMLElement {
  connectedCallback() {
    this.sessions = []; this.hosts = []; this.entries = []; this.selected = new Set(); this.busy = false;
    this.localEntries = []; this.localSelected = new Set(); this.localBusy = false; this.localParent = ''; this.localDrag = null; this.directoryRequest = 0;
    this.innerHTML = `
      <section class="sftp-page no-drag" aria-label="SFTP 檔案管理器">
        <aside class="sftp-hosts" aria-label="連線目標">
          <div class="sftp-search">${icon('search')}<input id="sftp-host-search" type="search" aria-label="搜尋 Alias 或 IP" placeholder="搜尋 Alias 或 IP" value="${esc(sftpViewState.hostQuery)}" autocomplete="off"></div>
          <div id="sftp-host-list"></div>
          <div class="sftp-session-area"><h2>已開啟</h2><div id="sftp-session-list"></div></div>
        </aside>
        <div class="sftp-workspace">
          <div class="sftp-file-panes">
            <section class="sftp-local" aria-label="本機檔案">
              <header class="sftp-pane-heading"><h2>${icon('device-desktop')}本機</h2><div>${iconButton('local-choose', 'folder', '選擇本機資料夾', 'data-local')}${iconButton('upload-selected', 'upload', '上傳選取項目')}</div></header>
              <form class="sftp-local-path sftp-address">${iconButton('local-parent', 'arrow-up', '本機上一層', 'data-local')}${iconButton('local-refresh', 'refresh', '重新整理本機', 'data-local')}<input id="sftp-local-path" aria-label="目前本機路徑，按 Enter 前往" placeholder="本機路徑" autocomplete="off"><button data-local class="sftp-icon-button" title="前往本機路徑" aria-label="前往本機路徑">${icon('arrow-right')}</button></form>
              <p class="sftp-local-error sftp-error" role="alert"></p>
              <div class="sftp-local-list"><table><thead><tr><th><input id="sftp-local-all" type="checkbox" aria-label="選取全部本機項目"></th><th>名稱</th><th class="sftp-type">類型</th><th>大小</th><th>修改時間</th></tr></thead><tbody id="sftp-local-files"></tbody></table><p class="sftp-local-empty">正在讀取…</p></div>
              <footer class="sftp-pane-footer" id="sftp-local-count">0 個項目</footer>
            </section>
            <main class="sftp-browser" aria-label="遠端檔案">
              <header class="sftp-pane-heading"><h2>${icon('server')}<span id="sftp-active-host">遠端</span><span class="sftp-connection-dot" title="已連線" hidden></span></h2><div>${iconButton('upload', 'upload', '上傳檔案', 'data-connected')}${iconButton('download', 'download', '下載選取項目', 'data-selection')}${iconButton('mkdir', 'folder-plus', '建立資料夾', 'data-connected')}<details class="sftp-more"><summary class="sftp-icon-button" title="更多操作" aria-label="更多操作">${icon('dots')}</summary><div class="sftp-menu"><button type="button" data-action="upload-folder" data-connected>上傳資料夾</button><button type="button" data-action="rename" data-single>重新命名</button><button type="button" data-action="delete" data-selection>刪除</button><button type="button" data-action="disconnect" data-connected>中斷連線</button></div></details></div></header>
              <form class="sftp-path sftp-address">${iconButton('parent', 'arrow-up', '遠端上一層', 'data-connected')}${iconButton('refresh', 'refresh', '重新整理遠端', 'data-connected')}<input id="sftp-path" aria-label="目前遠端路徑，按 Enter 前往" placeholder="/" autocomplete="off"><button data-connected class="sftp-icon-button" title="前往遠端路徑" aria-label="前往遠端路徑">${icon('arrow-right')}</button></form>
              <p class="sftp-remote-error sftp-error" role="alert"></p>
              <div class="sftp-dropzone" style="--wails-drop-target: drop"><table><thead><tr><th><input id="sftp-all" type="checkbox" aria-label="選取全部"></th><th>名稱</th><th class="sftp-type">類型</th><th>大小</th><th>修改時間</th><th>權限</th></tr></thead><tbody id="sftp-files"></tbody></table><p class="sftp-empty">選擇左側主機以連線</p></div>
              <footer class="sftp-pane-footer"><span id="sftp-remote-count">尚未連線</span><span class="sftp-drop-caption" aria-live="polite"></span></footer>
            </main>
          </div>
          <section class="sftp-transfers" aria-label="傳輸佇列"><header><button type="button" data-action="toggle-queue" class="sftp-queue-toggle" aria-expanded="true" aria-controls="sftp-queue-panel">${icon('chevron-down')}傳輸 <span id="sftp-transfer-count">0</span></button>${iconButton('clear', 'playlist-x', '清除已結束項目')}</header><div class="sftp-queue-scroll" id="sftp-queue-panel"><table><thead><tr><th>檔案／主機</th><th>方向</th><th>狀態</th><th>進度</th><th>平均速度</th><th>錯誤</th></tr></thead><tbody id="sftp-queue"></tbody></table></div></section>
        </div>
      </section>`;
    this.querySelector('.sftp-page').addEventListener('click', event => this.handlePageClick(event));
    this.querySelector('#sftp-host-search').addEventListener('input', event => { sftpViewState.hostQuery = event.target.value; this.renderSessions(); });
    this.setupLocalBrowser();
    this.setupDropTargets();
    this.querySelector('.sftp-path').addEventListener('submit', event => { event.preventDefault(); this.run(() => this.loadDirectory(this.querySelector('#sftp-path').value)); });
    this.querySelector('#sftp-all').addEventListener('change', event => {
      this.selected = new Set(event.target.checked ? this.entries.map(entry => entry.name) : []); this.renderFiles();
    });
    this.querySelector('#sftp-files').addEventListener('change', event => {
      const entry = this.entries[Number(event.target.dataset.index)]; if (!entry) return;
      if (event.target.checked) this.selected.add(entry.name); else this.selected.delete(entry.name); this.updateControls();
    });
    this.querySelector('#sftp-files').addEventListener('click', event => {
      const target = event.target.closest('[data-directory]');
      if (target) this.run(() => this.loadDirectory(joinRemotePath(this.currentPath(), this.entries[Number(target.dataset.directory)].name)));
    });
    this.querySelector('#sftp-files').addEventListener('contextmenu', event => {
      const row = event.target.closest('[data-remote-index]');
      if (!row || this.busy) return;
      event.preventDefault();
      const entry = this.entries[Number(row.dataset.remoteIndex)];
      if (!this.selected.has(entry.name)) this.selected = new Set([entry.name]);
      this.updateControls();
      const menu = this.querySelector('.sftp-more'); menu.open = true;
      menu.querySelector('button:not(:disabled)')?.focus();
    });
    this.querySelector('.sftp-page').addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        const menu = this.querySelector('.sftp-more');
        if (menu.open) { menu.open = false; menu.querySelector('summary').focus(); }
      }
    });
    this.stopDrop = onWailsFileDrop((x, y, paths) => {
      this.uploadDrop(paths, document.elementFromPoint(x, y));
    });
    this.updateControls();
    this.run(async () => {
      const [vault, sessions] = await Promise.all([HostAPI.loadHostVault(), sftpCall('ListSFTPSessions')]);
      if (!this.isConnected) return;
      this.hosts = vault.hosts; this.sessions = sessions || [];
      this.renderHosts();
      if (!this.session()) sftpViewState.sessionId = this.sessions[0]?.id || '';
      this.renderSessions();
      if (this.session()) await this.loadDirectory(this.currentPath());
    });
    this.runLocal(() => this.loadLocalDirectory(sftpViewState.localPath));
    this.poll();
  }
  handlePageClick(event) {
    const host = event.target.closest('[data-host-id]');
    if (host && !this.busy) {
      this.selectedHostId = host.dataset.hostId;
      const existing = this.sessions.find(session => session.hostId === this.selectedHostId);
      this.run(async () => {
        if (existing) { this.activateSession(existing.id); await this.loadDirectory(this.currentPath()); }
        else await this.action('connect');
      });
      return;
    }
    const session = event.target.closest('[data-session-id]');
    if (session && !this.busy) {
      this.run(async () => { this.activateSession(session.dataset.sessionId); await this.loadDirectory(this.currentPath()); });
      return;
    }
    const button = event.target.closest('[data-action]');
    if (button?.dataset.action === 'toggle-queue') {
      const expanded = button.getAttribute('aria-expanded') === 'true';
      button.setAttribute('aria-expanded', String(!expanded));
      this.querySelector('#sftp-queue-panel').hidden = expanded;
      return;
    }
    if (event.target.closest('.sftp-more > summary')) return;
    this.querySelector('.sftp-more').open = false;
    if (button && !button.disabled) {
      if (button.dataset.action.startsWith('local-')) this.runLocal(() => this.localAction(button.dataset.action));
      else this.run(() => this.action(button.dataset.action));
    }
  }
  disconnectedCallback() {
    clearTimeout(this.pollTimer);
    this.stopDrop?.();
    this.localDrag = null;
    this.querySelector('dialog')?.close();
    // 不關閉後端連線或傳輸；重新掛載後從後端取得佇列快照。
  }
  activateSession(id) {
    sftpViewState.sessionId = id;
    this.entries = [];
    this.selected.clear();
    this.querySelector('#sftp-path').value = id ? this.currentPath() : '';
    this.renderSessions();
    this.renderFiles();
  }
  session() { return this.sessions.find(s => s.id === sftpViewState.sessionId); }
  currentPath() { return sftpViewState.paths.get(sftpViewState.sessionId) || this.session()?.path || '/'; }
  hostLabel(id) {
    const h = this.hosts.find(host => host.id === id);
    if (!h) return id;
    const name = h.alias || h.label || h.config?.host || id;
    return h.config?.host && h.config.host !== name ? `${name} · ${h.config.host}` : name;
  }
  renderHosts() {
    const recent = new Set(readRecentSFTPHosts().map(row => row.hostId));
    const hosts = filterSFTPHosts(this.hosts, sftpViewState.hostQuery);
    const row = host => {
      const connected = this.sessions.some(session => session.hostId === host.id);
      const active = this.session()?.hostId === host.id;
      return `<button type="button" class="sftp-host-row" data-host-id="${esc(host.id)}" aria-pressed="${active}" title="${esc(this.hostLabel(host.id))}">${icon('server')}<span><strong>${esc(host.alias || host.label || host.config?.host || host.id)}</strong><small>${esc(host.config?.host || '')}</small></span>${connected ? '<span class="sftp-connection-dot" title="已連線"></span>' : ''}</button>`;
    };
    this.querySelector('#sftp-host-list').innerHTML = [
      ['最近連線', hosts.filter(host => recent.has(host.id))],
      ['其他主機', hosts.filter(host => !recent.has(host.id))],
    ].filter(([, items]) => items.length).map(([label, items]) => `<h2>${label}</h2>${items.map(row).join('')}`).join('') || '<p class="sftp-no-hosts">沒有符合的主機</p>';
    this.querySelectorAll('[data-host-id]').forEach(button => { button.disabled = this.busy; });
  }
  renderSessions() {
    this.querySelector('#sftp-session-list').innerHTML = this.sessions.map(session => `<button type="button" class="sftp-session-row" data-session-id="${esc(session.id)}" aria-pressed="${session.id === sftpViewState.sessionId}" title="${esc(this.hostLabel(session.hostId))}"><span class="sftp-connection-dot"></span><span>${esc(this.hostLabel(session.hostId))}</span></button>`).join('');
    this.querySelector('.sftp-session-area').hidden = !this.sessions.length;
    this.renderHosts();
    this.updateControls();
  }
  updateControls() {
    if (!this.isConnected) return;
    this.querySelector('#sftp-active-host').textContent = this.session() ? this.hostLabel(this.session().hostId) : '遠端';
    this.querySelectorAll('[data-connected]').forEach(b => { b.disabled = this.busy || !this.session(); });
    this.querySelectorAll('[data-selection]').forEach(b => { b.disabled = this.busy || !this.session() || !this.selected.size; });
    this.querySelectorAll('[data-single]').forEach(b => { b.disabled = this.busy || !this.session() || this.selected.size !== 1; });
    this.querySelectorAll('[data-host-id], [data-session-id]').forEach(button => { button.disabled = this.busy; });
    this.querySelector('.sftp-pane-heading .sftp-connection-dot')?.toggleAttribute('hidden', !this.session());
    this.querySelector('#sftp-local-count').textContent = `${this.localEntries.length} 個項目${this.localSelected.size ? ` · 已選取 ${this.localSelected.size}` : ''}`;
    this.querySelector('#sftp-remote-count').textContent = this.session() ? `${this.entries.length} 個項目${this.selected.size ? ` · 已選取 ${this.selected.size}` : ''}` : '尚未連線';
    this.querySelectorAll('[data-local-row]').forEach(row => { row.classList.toggle('sftp-selected', this.localSelected.has(this.localEntries[Number(row.dataset.localRow)]?.path)); });
    this.querySelectorAll('[data-remote-index]').forEach(row => { const checked = this.selected.has(this.entries[Number(row.dataset.remoteIndex)]?.name); row.classList.toggle('sftp-selected', checked); row.querySelector('input').checked = checked; });
    this.querySelector('[data-action="upload-selected"]').disabled = this.busy || this.localBusy || !this.session() || !this.localSelected.size;
    this.querySelectorAll('[data-local]').forEach(b => { b.disabled = this.localBusy; });
    this.querySelector('[data-action="local-parent"]').disabled = this.localBusy || !this.localParent;
    this.querySelector('#sftp-local-all').checked = this.localEntries.some(e => e.type === 'file' || e.type === 'directory') && this.localSelected.size === this.localEntries.filter(e => e.type === 'file' || e.type === 'directory').length;
    this.querySelector('#sftp-all').checked = this.entries.length > 0 && this.selected.size === this.entries.length;
  }
  async run(operation) {
    if (this.busy) return;
    this.busy = true; this.updateControls(); this.querySelector('.sftp-remote-error').textContent = '';
    try { await operation(); } catch (error) { if (this.isConnected) this.querySelector('.sftp-remote-error').textContent = String(error?.message || error); }
    finally { this.busy = false; this.updateControls(); }
  }
  async loadDirectory(path, { background = false } = {}) {
    const id = sftpViewState.sessionId; if (!id) return;
    const request = ++this.directoryRequest;
    let listing;
    try { listing = await sftpCall('ListSFTPDirectory', id, path); }
    catch (error) {
      if (this.isConnected && id === sftpViewState.sessionId && request === this.directoryRequest && !background) this.querySelector('#sftp-path').value = this.currentPath();
      if (background) return false;
      throw error;
    }
    if (!this.isConnected || id !== sftpViewState.sessionId || request !== this.directoryRequest) return false;
    if (background && (this.busy || this.localDrag || this.dropActive)) return false;
    sftpViewState.paths.set(id, listing.path); this.querySelector('#sftp-path').value = listing.path;
    this.entries = listing.entries || [];
    this.selected = background ? new Set([...this.selected].filter(name => this.entries.some(entry => entry.name === name))) : new Set();
    this.renderFiles();
    return true;
  }
  renderFiles() {
    this.querySelector('#sftp-files').innerHTML = this.entries.map((e, index) => `<tr data-remote-index="${index}"><td><input type="checkbox" data-index="${index}" aria-label="選取 ${esc(e.name)}" ${this.selected.has(e.name) ? 'checked' : ''}></td><td title="${esc(e.name)}">${fileIcon(e.type)}${e.type === 'directory' ? `<button class="sftp-directory ui-button ui-button--quiet" data-directory="${index}">${esc(e.name)}</button>` : esc(e.name)}</td><td class="sftp-type">${esc(typeLabels[e.type] || e.type)}</td><td>${e.type === 'directory' ? '—' : formatBytes(e.size)}</td><td title="${esc(new Date(e.modified).toLocaleString())}">${esc(new Date(e.modified).toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }))}</td><td><code>${esc(e.permissions)}</code></td></tr>`).join('');
    this.querySelector('.sftp-empty').textContent = this.entries.length ? '' : this.session() ? '拖曳檔案至此上傳' : '選擇左側主機以連線';
    this.updateControls();
  }
  setupLocalBrowser() {
    this.querySelector('.sftp-local-path').addEventListener('submit', event => {
      event.preventDefault(); this.runLocal(() => this.loadLocalDirectory(this.querySelector('#sftp-local-path').value));
    });
    this.querySelector('#sftp-local-all').addEventListener('change', event => {
      this.localSelected = new Set(event.target.checked ? this.localEntries.filter(e => e.type === 'file' || e.type === 'directory').map(e => e.path) : []);
      this.renderLocalFiles();
    });
    const list = this.querySelector('#sftp-local-files');
    list.addEventListener('change', event => {
      const entry = this.localEntries[Number(event.target.dataset.localIndex)]; if (!entry) return;
      if (event.target.checked) this.localSelected.add(entry.path); else this.localSelected.delete(entry.path);
      this.updateControls();
    });
    list.addEventListener('click', event => {
      const target = event.target.closest('[data-local-directory]');
      if (target) this.runLocal(() => this.loadLocalDirectory(this.localEntries[Number(target.dataset.localDirectory)].path));
    });
    list.addEventListener('dragstart', event => {
      const row = event.target.closest('[data-local-row]');
      if (!row || this.busy || this.localBusy || !this.session()) { event.preventDefault(); return; }
      const entry = this.localEntries[Number(row.dataset.localRow)];
      const paths = localUploadPaths(this.localEntries, this.localSelected, entry?.path);
      if (!paths.length) { event.preventDefault(); return; }
      this.localDrag = { paths, sessionId: sftpViewState.sessionId };
      event.dataTransfer.effectAllowed = 'copy';
      event.dataTransfer.setData('application/x-termix-sftp-local', 'local-selection');
      event.dataTransfer.setData('text/plain', `${paths.length} 個本機項目`);
      this.querySelector('.sftp-drop-caption').textContent = `${paths.length} 個項目`;
    });
    list.addEventListener('dragend', () => { this.localDrag = null; this.clearDropTarget(); });
  }
  async runLocal(operation) {
    if (this.localBusy) return;
    this.localBusy = true; this.updateControls(); this.querySelector('.sftp-local-error').textContent = '';
    try { await operation(); }
    catch (error) { if (this.isConnected) { this.querySelector('.sftp-local-error').textContent = String(error?.message || error); this.querySelector('#sftp-local-path').value = sftpViewState.localPath; if (!this.localEntries.length) this.querySelector('.sftp-local-empty').textContent = '請選擇可讀取的本機資料夾。'; } }
    finally { this.localBusy = false; this.updateControls(); }
  }
  async localAction(action) {
    if (action === 'local-choose') {
      const listing = await sftpCall('SelectSFTPLocalDirectory');
      if (listing && this.isConnected) this.applyLocalListing(listing);
    } else await this.loadLocalDirectory(action === 'local-parent' ? this.localParent : sftpViewState.localPath);
  }
  async loadLocalDirectory(path) {
    const listing = await sftpCall('ListSFTPLocalDirectory', path);
    if (this.isConnected) this.applyLocalListing(listing);
  }
  applyLocalListing(listing) {
    sftpViewState.localPath = listing.path; this.localParent = listing.parent;
    this.localEntries = listing.entries || []; this.localSelected.clear();
    this.querySelector('#sftp-local-path').value = listing.path;
    this.renderLocalFiles();
  }
  renderLocalFiles() {
    this.querySelector('#sftp-local-files').innerHTML = this.localEntries.map((entry, index) => {
      const canUpload = entry.type === 'file' || entry.type === 'directory';
      return `<tr data-local-row="${index}" draggable="${canUpload}"><td><input type="checkbox" data-local-index="${index}" aria-label="選取本機 ${esc(entry.name)}" ${this.localSelected.has(entry.path) ? 'checked' : ''} ${canUpload ? '' : 'disabled'}></td><td title="${esc(entry.name)}">${fileIcon(entry.type)}${entry.type === 'directory' ? `<button class="sftp-directory ui-button ui-button--quiet" data-local-directory="${index}">${esc(entry.name)}</button>` : esc(entry.name)}</td><td class="sftp-type">${esc(typeLabels[entry.type] || entry.type)}</td><td>${entry.type === 'directory' ? '—' : formatBytes(entry.size)}</td><td title="${esc(new Date(entry.modified).toLocaleString())}">${esc(new Date(entry.modified).toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }))}</td></tr>`;
    }).join('');
    this.querySelector('.sftp-local-empty').textContent = this.localEntries.length ? '' : '此本機目錄沒有檔案。';
    this.updateControls();
  }
  dropDestination(target) {
    const zone = this.querySelector('.sftp-dropzone');
    if (!this.session() || !target || !zone.contains(target)) return null;
    const row = target.closest('[data-remote-index]');
    return remoteDropDestination(this.currentPath(), row ? this.entries[Number(row.dataset.remoteIndex)] : null);
  }
  clearDropTarget() {
    this.dropActive = false;
    this.querySelectorAll('.sftp-drop-folder').forEach(row => row.classList.remove('sftp-drop-folder'));
    this.querySelector('.sftp-drop-caption').textContent = '';
  }
  setupDropTargets() {
    const zone = this.querySelector('.sftp-dropzone');
    zone.addEventListener('dragover', event => {
      if (this.busy || (!this.localDrag && !Array.from(event.dataTransfer.types).includes('Files'))) return;
      const destination = this.dropDestination(event.target); if (!destination) return;
      event.preventDefault(); event.dataTransfer.dropEffect = 'copy';
      this.clearDropTarget();
      this.dropActive = true;
      const row = event.target.closest('[data-remote-index]');
      if (row && this.entries[Number(row.dataset.remoteIndex)]?.type === 'directory') row.classList.add('sftp-drop-folder');
      this.querySelector('.sftp-drop-caption').textContent = `上傳至：${destination}`;
    });
    zone.addEventListener('dragleave', event => { if (!zone.contains(event.relatedTarget)) this.clearDropTarget(); });
    zone.addEventListener('drop', event => {
      if (!this.localDrag) return;
      event.preventDefault(); event.stopPropagation();
      const payload = this.localDrag; this.localDrag = null;
      this.uploadDrop(payload.paths, event.target, payload.sessionId);
    });
  }
  uploadDrop(paths, target, expectedSession = sftpViewState.sessionId) {
    if (!this.isConnected) return;
    const destination = this.dropDestination(target);
    this.clearDropTarget();
    if (!destination || !paths?.length) return;
    if (expectedSession !== sftpViewState.sessionId || this.busy) {
      this.querySelector('.sftp-remote-error').textContent = '未開始上傳：連線已切換或操作尚未完成，請重新拖曳。'; return;
    }
    const id = sftpViewState.sessionId;
    this.run(() => sftpCall('QueueSFTPUpload', id, paths, destination));
  }
  async action(action) {
    const id = sftpViewState.sessionId, path = this.currentPath(), names = [...this.selected];
    if (action === 'connect') {
      const hostID = this.selectedHostId;
      let session;
      try { session = await sftpCall('ConnectSFTP', hostID); }
      catch (error) {
        if (!String(error).includes('UNKNOWN_HOST_KEY')) throw error;
        if (!this.isConnected || !(await confirmDialog(`請先向伺服器管理者核對以下主機金鑰指紋：\n${String(error)}\n確認信任後才會連線。`, { title: '驗證 SSH 主機金鑰', confirmText: '信任並連線' }))) return;
        const host = this.hosts.find(h => h.id === hostID);
        const result = await sftpCall('ConfirmUnknownHostKey', host.config.host, Number(host.config.port || 22));
        if (!result.success) throw new Error(result.error);
        session = await sftpCall('ConnectSFTP', hostID);
      }
      recordSFTPConnection(hostID);
      if (!this.isConnected) return;
      this.renderHosts();
      this.sessions.push(session); this.activateSession(session.id); await this.loadDirectory(session.path);
    } else if (action === 'disconnect') {
      await sftpCall('DisconnectSFTP', id);
      if (!this.isConnected) return;
      this.sessions = this.sessions.filter(s => s.id !== id); sftpViewState.paths.delete(id); this.activateSession(this.sessions[0]?.id || '');
      if (this.session()) await this.loadDirectory(this.currentPath());
    } else if (action === 'refresh') await this.loadDirectory(path);
    else if (action === 'parent') await this.loadDirectory(parentRemotePath(path));
    else if (action === 'upload' || action === 'upload-folder') await sftpCall('SelectSFTPUpload', id, path, action === 'upload-folder');
    else if (action === 'upload-selected') await sftpCall('QueueSFTPUpload', id, localUploadPaths(this.localEntries, this.localSelected), path);
    else if (action === 'download') await sftpCall('DownloadSFTP', id, names.map(name => joinRemotePath(path, name)));
    else if (action === 'clear') await sftpCall('ClearSFTPTransfers');
    else if (action === 'mkdir' || action === 'rename') {
      const name = await this.askName(action === 'mkdir' ? '建立資料夾' : '重新命名', action === 'rename' ? names[0] : '');
      if (name === null) return;
      await sftpCall('MutateSFTP', id, action, action === 'mkdir' ? path : joinRemotePath(path, names[0]), name);
      await this.loadDirectory(path);
    } else if (action === 'delete') {
      if (!(await confirmDialog(`永久刪除選取的 ${names.length} 個項目？\n${names.join('\n')}\n非空資料夾不會刪除。`, { danger: true }))) return;
      try { for (const name of names) await sftpCall('MutateSFTP', id, 'delete', joinRemotePath(path, name), ''); }
      finally { if (this.isConnected) await this.loadDirectory(path); }
    }
  }
  askName(title, initial) {
    return new Promise(resolve => {
      const dialog = document.createElement('dialog'); dialog.className = 'sftp-name-dialog';
      dialog.innerHTML = `<form method="dialog"><h2>${esc(title)}</h2><label>名稱<input name="filename" required autocomplete="off" value="${esc(initial)}"></label><div><button value="cancel" formnovalidate class="ui-button ui-button--secondary">取消</button><button value="save" class="ui-button ui-button--primary">儲存</button></div></form>`;
      dialog.addEventListener('close', () => { resolve(dialog.returnValue === 'save' ? dialog.querySelector('input').value : null); dialog.remove(); }, { once: true });
      this.append(dialog); dialog.showModal(); dialog.querySelector('input').select();
    });
  }
  async poll() {
    try {
      const transfers = await sftpCall('ListSFTPTransfers');
      if (!this.isConnected) return;
      this.querySelector('#sftp-transfer-count').textContent = String((transfers || []).length);
      this.querySelector('#sftp-queue').innerHTML = (transfers || []).map(t => {
        const display = transferDisplay(t);
        const percentage = display.percentage;
        return `<tr data-transfer-status="${esc(display.status)}"><td>${esc(t.name)}<small>${esc(this.hostLabel(t.hostId))}</small></td><td>${t.direction === 'upload' ? '上傳' : '下載'}</td><td><span class="sftp-status sftp-status--${esc(display.status)}">${esc(statusLabels[display.status] || display.status)}</span></td><td><progress value="${percentage}" max="100" aria-label="${esc(t.name)} 傳輸進度"></progress> ${percentage}%${display.status === 'failed' ? '（未完成）' : ''}<small>${formatBytes(t.bytes)} / ${formatBytes(t.total)}</small></td><td>${esc(display.speed)}</td><td class="sftp-transfer-error">${esc(display.error)}</td></tr>`;
      }).join('') || '<tr><td colspan="6">尚無傳輸工作。</td></tr>';
      const finished = (transfers || []).filter(t => t.sessionId === sftpViewState.sessionId && t.direction === 'upload' && ['completed', 'failed'].includes(t.status)).map(t => t.id).join(',');
      if (finished !== this.finished && !this.busy && !this.localDrag && !this.dropActive && this.session()) {
        // 背景列表更新不佔用操作鎖，避免擋住下一筆拖曳。
        if (await this.loadDirectory(this.currentPath(), { background: true })) this.finished = finished;
      }
    } catch (error) { if (this.isConnected) this.querySelector('.sftp-remote-error').textContent = String(error?.message || error); }
    finally { if (this.isConnected) this.pollTimer = setTimeout(() => this.poll(), 750); }
  }
}
customElements.define('sftp-page', SFTPPage);

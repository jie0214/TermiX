import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { joinRemotePath, parentRemotePath, escapeSFTP, formatBytes, SFTP_TAB_ID } from './SFTPService.js';
import { onWailsFileDrop } from '../../platform/wails/events.ts';

test('遠端路徑處理根目錄、Unicode 與空格', () => {
  assert.equal(joinRemotePath('/', '測試 檔案'), '/測試 檔案');
  assert.equal(joinRemotePath('/home/a/', 'b'), '/home/a/b');
  assert.equal(parentRemotePath('/'), '/');
  assert.equal(parentRemotePath('/home/a/'), '/home');
  assert.equal(parentRemotePath('/home'), '/');
});

test('伺服器提供的檔名與錯誤內容不能注入 HTML', () => {
  assert.equal(escapeSFTP('<img src="x" onerror=\'x\'>&'), '&lt;img src=&quot;x&quot; onerror=&#39;x&#39;&gt;&amp;');
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(1536), '1.5 KiB');
  assert.equal(formatBytes(NaN), '—');
});

test('Vaults 與 SFTP 永遠相鄰且 SFTP 不可拖曳', async () => {
  const source = await readFile(new URL('../../App.js', import.meta.url), 'utf8');
  const method = source.slice(source.indexOf('  renderTabs() {'), source.indexOf('  initRouter() {'));
  for (const open of [false, true]) {
    const tabs = { innerHTML: '' };
    const state = { activeWorkspaceId: SFTP_TAB_ID, workspaces: [{ id: 'ssh-work', label: 'Terminal' }] };
    const app = new Function('terminalStore', 'kubernetesSessionStore', 'KUBERNETES_SESSION_ID', 'SFTP_TAB_ID', 'escapeHtml', 't', `return ({${method}});`)(
      { getState: () => state }, { getState: () => ({ sessionOpen: open }) }, 'kubernetes-session', SFTP_TAB_ID, escapeSFTP, value => value,
    );
    Object.assign(app, { querySelector: selector => selector === '#sessionTabs' ? tabs : null, collapseControlSidebar() {}, getTabsFingerprint() {} });
    app.renderTabs();
    const ids = [...tabs.innerHTML.matchAll(/<div[^>]*data-workspace-id="([^"]+)"/g)].map(match => match[1]);
    assert.deepEqual(ids.slice(0, 2), ['host-tab', SFTP_TAB_ID]);
    assert.equal(ids.at(-1), 'ssh-work');
    const sftpTab = tabs.innerHTML.match(/<div[^>]*data-workspace-id="sftp-tab"[^>]*>/)[0];
    assert.doesNotMatch(sftpTab, /draggable/);
    assert.match(sftpTab, /active/);
  }
});

test('頁面卸載僅移除拖放與輪詢，不關閉後端工作', async () => {
  const source = await readFile(new URL('./SFTPPage.js', import.meta.url), 'utf8');
  const method = source.slice(source.indexOf('  disconnectedCallback() {'), source.indexOf('  activateSession(id) {'));
  let stopped = 0;
  const page = new Function(`return ({${method}});`)();
  Object.assign(page, { stopDrop() { stopped++; }, querySelector() { return null; } });
  page.disconnectedCallback();
  assert.equal(stopped, 1);
});

test('原生拖放透過共用 runtime 介面傳遞路徑並解除訂閱', () => {
  const previous = globalThis.window;
  let callback, off = 0, received;
  globalThis.window = { runtime: { OnFileDrop(fn, target) { callback = fn; assert.equal(target, true); }, OnFileDropOff() { off++; } } };
  try {
    const dispose = onWailsFileDrop((x, y, paths) => { received = { x, y, paths }; });
    callback(10, 20, ['/tmp/a']);
    assert.deepEqual(received, { x: 10, y: 20, paths: ['/tmp/a'] });
    dispose(); assert.equal(off, 1);
  } finally { globalThis.window = previous; }
});


test('切換連線先清空舊 Host 選取，目錄讀取失敗也不會沿用舊檔案', async () => {
  const source = await readFile(new URL('./SFTPPage.js', import.meta.url), 'utf8');
  const method = source.slice(source.indexOf('  activateSession(id) {'), source.indexOf('  session() {'));
  const state = { sessionId: 'old-host' };
  const input = { value: '/old-path' };
  const page = new Function('sftpViewState', `return ({${method}});`)(state);
  Object.assign(page, { entries: [{ name: 'old-file' }], selected: new Set(['old-file']), querySelector: () => input, currentPath: () => '/new-home', renderSessions() {}, renderFiles() {} });
  page.activateSession('new-host');
  assert.equal(state.sessionId, 'new-host');
  assert.deepEqual(page.entries, []);
  assert.equal(page.selected.size, 0);
  assert.equal(input.value, '/new-home');
});

const { transferDisplay, filterSFTPHosts, recordSFTPConnection, readRecentSFTPHosts, remoteDropDestination, localUploadPaths } = await import('./SFTPService.js');

test('Host 清單以最近成功連線優先，Alias 與 IP 搜尋忽略大小寫', () => {
  const hosts = [
    { id: 'a', alias: 'Alpha', config: { host: '10.0.0.1' } },
    { id: 'b', alias: 'Production-DB', config: { host: '10.0.0.2' } },
    { id: 'c', label: '備援', config: { host: 'backup.example.com' } },
  ];
  const recent = [{ hostId: 'b', at: 100 }, { hostId: 'a', at: 200 }];
  assert.deepEqual(filterSFTPHosts(hosts, '', recent).map(h => h.id), ['a', 'b', 'c']);
  assert.deepEqual(filterSFTPHosts(hosts, 'production', recent).map(h => h.id), ['b']);
  assert.deepEqual(filterSFTPHosts(hosts, ' 10.0.0.2 ', recent).map(h => h.id), ['b']);
  assert.deepEqual(filterSFTPHosts(hosts, 'BACKUP', recent).map(h => h.id), ['c']);
  assert.deepEqual(filterSFTPHosts(hosts, '找不到', recent), []);
  assert.deepEqual(hosts.map(h => h.id), ['a', 'b', 'c']);
});

test('最近連線持久化僅含 Host ID 與時間，重連取代舊紀錄', () => {
  let saved = '[]';
  const storage = { getItem: () => saved, setItem: (_, value) => { saved = value; } };
  recordSFTPConnection('a', 10, storage); recordSFTPConnection('b', 20, storage); recordSFTPConnection('a', 30, storage);
  assert.deepEqual(readRecentSFTPHosts(storage), [{ hostId: 'a', at: 30 }, { hostId: 'b', at: 20 }]);
  assert.deepEqual(Object.keys(JSON.parse(saved)[0]), ['hostId', 'at']);
  for (let i = 0; i < 110; i++) recordSFTPConnection(`host-${i}`, 100 + i, storage);
  assert.equal(readRecentSFTPHosts(storage).length, 100);
  saved = JSON.stringify([{ hostId: 'a', at: 'invalid' }, { hostId: 42, at: 10 }]);
  assert.deepEqual(readRecentSFTPHosts(storage), []);
});

test('拖到遠端資料夾使用子目錄，檔案列或空白區使用目前路徑', () => {
  assert.equal(remoteDropDestination('/srv', { name: 'uploads 空格', type: 'directory' }), '/srv/uploads 空格');
  assert.equal(remoteDropDestination('/', { name: 'uploads', type: 'directory' }), '/uploads');
  assert.equal(remoteDropDestination('/srv', { name: 'file', type: 'file' }), '/srv');
  assert.equal(remoteDropDestination('/srv', null), '/srv');
});

test('本機多選拖曳保留整批選取，拖曳未選項目只傳該項目', () => {
  const entries = [{ path: '/a', type: 'file' }, { path: '/folder', type: 'directory' }, { path: '/link', type: 'symlink' }, { path: '/b', type: 'file' }];
  const selected = new Set(['/a', '/folder', '/link']);
  assert.deepEqual(localUploadPaths(entries, selected, '/a'), ['/a', '/folder']);
  assert.deepEqual(localUploadPaths(entries, selected, '/b'), ['/b']);
  assert.deepEqual(localUploadPaths(entries, new Set(), '/link'), []);
});

test('拖放使用落點與當下連線建立佇列，Host 已切換時拒絕舊拖曳', async () => {
  const source = await readFile(new URL('./SFTPPage.js', import.meta.url), 'utf8');
  const method = source.slice(source.indexOf('  uploadDrop('), source.indexOf('  async action(action)'));
  const calls = [], error = { textContent: '' }, state = { sessionId: 'target-host' };
  const page = new Function('sftpViewState', 'sftpCall', `return ({${method}});`)(state, (...args) => calls.push(args));
  Object.assign(page, { isConnected: true, busy: false, dropDestination: () => '/srv/target-folder', clearDropTarget() {}, run: fn => fn(), querySelector: () => error });
  page.uploadDrop(['/local/a', '/local/folder'], {}, 'target-host');
  assert.deepEqual(calls, [['QueueSFTPUpload', 'target-host', ['/local/a', '/local/folder'], '/srv/target-folder']]);
  page.uploadDrop(['/local/a'], {}, 'old-host');
  assert.equal(calls.length, 1);
  assert.match(error.textContent, /連線已切換/);
});

test('完成後的背景目錄更新不應阻擋下一次拖曳上傳', async () => {
  const source = await readFile(new URL('./SFTPPage.js', import.meta.url), 'utf8');
  const poll = source.slice(source.indexOf('  async poll() {'), source.lastIndexOf('\n}\ncustomElements'));
  const run = source.slice(source.indexOf('  async run(operation)'), source.indexOf('  async loadDirectory('));
  const drop = source.slice(source.indexOf('  uploadDrop('), source.indexOf('  async action(action)'));
  let release;
  const pendingListing = new Promise(resolve => { release = resolve; });
  const calls = [];
  const state = { sessionId: 'host' };
  const call = async (name, ...args) => {
    if (name === 'ListSFTPTransfers') return [{ id: 'done', sessionId: 'host', hostId: 'host', direction: 'upload', status: 'completed', bytes: 10, total: 10, name: 'previous.txt', speed: 100, error: '' }];
    calls.push([name, ...args]);
  };
  const page = new Function('sftpViewState', 'sftpCall', 'esc', 'formatBytes', 'statusLabels', 'setTimeout', 'transferDisplay', `return ({${poll},${run},${drop}});`)(state, call, escapeSFTP, formatBytes, { completed: '完成' }, () => 0, transferDisplay);
  Object.assign(page, { isConnected: true, busy: false, session: () => ({}), hostLabel: () => 'Host', currentPath: () => '/srv', loadDirectory: () => pendingListing, querySelector: () => ({ innerHTML: '', textContent: '' }), updateControls() {}, clearDropTarget() {}, dropDestination: () => '/srv' });
  const polling = page.poll();
  try {
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(page.busy, false, '背景重新整理不應設成操作忙碌');
    page.uploadDrop(['/local/new.txt'], {}, 'host');
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(calls, [['QueueSFTPUpload', 'host', ['/local/new.txt'], '/srv']]);
  } finally { release(true); await polling; }
});

test('傳輸狀態不以 100% 取代錯誤，完成後保留平均速度', () => {
  const base = { status: 'completed', bytes: 1024, total: 1024, speed: 512, error: '' };
  assert.deepEqual(transferDisplay(base), { status: 'completed', error: '', percentage: 100, speed: '512 B / s' });
  assert.equal(transferDisplay({ ...base, error: '關閉失敗' }).status, 'failed');
  assert.equal(transferDisplay({ ...base, bytes: 0 }).status, 'failed');
  assert.equal(transferDisplay({ ...base, status: 'running' }).percentage, 99);
  assert.equal(transferDisplay({ ...base, status: 'failed', error: '寫入失敗' }).status, 'failed');
  assert.equal(transferDisplay({ ...base, bytes: 0, total: 0, speed: 0 }).speed, '—');
});

test('背景舊目錄回應不得覆蓋使用者剛切換的新路徑', async () => {
  const source = await readFile(new URL('./SFTPPage.js', import.meta.url), 'utf8');
  const method = source.slice(source.indexOf('  async loadDirectory('), source.indexOf('  renderFiles()'));
  const resolvers = new Map(), state = { sessionId: 'host', paths: new Map() }, input = { value: '' };
  const page = new Function('sftpViewState', 'sftpCall', `return ({${method}});`)(state, (_, __, path) => new Promise(resolve => resolvers.set(path, resolve)));
  Object.assign(page, { isConnected: true, directoryRequest: 0, selected: new Set(), querySelector: () => input, renderFiles() {}, currentPath: () => '/old' });
  const old = page.loadDirectory('/old', { background: true });
  const current = page.loadDirectory('/new');
  resolvers.get('/new')({ path: '/new', entries: [{ name: 'new-file' }] });
  assert.equal(await current, true);
  resolvers.get('/old')({ path: '/old', entries: [{ name: 'old-file' }] });
  assert.equal(await old, false);
  assert.equal(input.value, '/new');
  assert.deepEqual(page.entries, [{ name: 'new-file' }]);
});

test('拖曳期間不更新背景列表，保持落點穩定', async () => {
  const source = await readFile(new URL('./SFTPPage.js', import.meta.url), 'utf8');
  const method = source.slice(source.indexOf('  async loadDirectory('), source.indexOf('  renderFiles()'));
  const state = { sessionId: 'host', paths: new Map() };
  const page = new Function('sftpViewState', 'sftpCall', `return ({${method}});`)(state, async () => ({ path: '/srv', entries: [] }));
  Object.assign(page, { isConnected: true, directoryRequest: 0, localDrag: { paths: ['/a'] }, entries: [{ name: 'target-folder' }], renderFiles() { assert.fail('拖曳中不應重建目錄'); } });
  assert.equal(await page.loadDirectory('/srv', { background: true }), false);
  assert.deepEqual(page.entries, [{ name: 'target-folder' }]);
});

async function clickHarness() {
  const source = await readFile(new URL('./SFTPPage.js', import.meta.url), 'utf8');
  const method = source.slice(source.indexOf('  handlePageClick(event) {'), source.indexOf('  disconnectedCallback()'));
  return new Function(`return ({${method}});`)();
}

test('點選已連線主機沿用既有連線，未連線主機才建立連線', async () => {
  const page = await clickHarness();
  const calls = [];
  Object.assign(page, { sessions: [{ id: 'session-a', hostId: 'a' }], run: operation => { page.pending = operation(); }, activateSession: id => calls.push(['activate', id]), currentPath: () => '/srv', loadDirectory: async path => calls.push(['list', path]), action: async action => calls.push([action, page.selectedHostId]) });
  const click = id => ({ target: { closest: selector => selector === '[data-host-id]' ? { dataset: { hostId: id } } : null } });
  page.handlePageClick(click('a')); await page.pending;
  assert.deepEqual(calls, [['activate', 'session-a'], ['list', '/srv']]);
  page.handlePageClick(click('b')); await page.pending;
  assert.deepEqual(calls.at(-1), ['connect', 'b']);
});

test('忙碌期間仍可收合及展開佇列，不操作後端傳輸', async () => {
  const page = await clickHarness();
  let expanded = 'true';
  const panel = { hidden: false };
  const button = { dataset: { action: 'toggle-queue' }, getAttribute: () => expanded, setAttribute: (_, value) => { expanded = value; } };
  Object.assign(page, { busy: true, querySelector: () => panel, run() { assert.fail('收合佇列不應呼叫後端'); } });
  const event = { target: { closest: selector => selector === '[data-action]' ? button : null } };
  page.handlePageClick(event); assert.equal(panel.hidden, true); assert.equal(expanded, 'false');
  page.handlePageClick(event); assert.equal(panel.hidden, false); assert.equal(expanded, 'true');
});

test('更多操作保留原生開關行為，外部點擊關閉選單', async () => {
  const page = await clickHarness();
  const menu = { open: true };
  Object.assign(page, { querySelector: () => menu });
  page.handlePageClick({ target: { closest: selector => selector === '.sftp-more > summary' ? {} : null } });
  assert.equal(menu.open, true, '不應在原生 summary 切換前改寫開啟狀態');
  page.handlePageClick({ target: { closest: () => null } });
  assert.equal(menu.open, false);
});

// 重播實際重連狀態機、App 輸出事件與 pane 關閉流程，僅替換網路與 DOM 邊界。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const root = path.join(__dirname, '../frontend/src');
const pageSource = fs.readFileSync(path.join(root, 'modules/terminal/TerminalPage.js'), 'utf8');

async function harness(connect = async () => ({ success: false, error: 'network unavailable' })) {
  const { terminalStore } = await import('../frontend/src/modules/terminal/TerminalStore.js');
  const { formatTerminalBootstrapOutput } = await import('../frontend/src/modules/terminal/TerminalOutput.js');
  const calls = { close: [], cancel: [], writes: [], confirmations: 0, disposed: 0 };
  const term = { write: text => calls.writes.push(text), dispose() { calls.disposed++; } };
  terminalStore.setState({ sessions: { old: { label: 'SSH', config: { hostId: 'host', host: 'test.invalid', username: 'test' }, outputHtml: 'history' } }, xtermInstances: { old: term }, workspaces: [{ id: 'ws', columns: [{ id: 'col', width: 100, panes: [{ sessionKey: 'old', height: 100 }] }] }], activeWorkspaceId: 'ws', activePaneSessionKey: 'old', workspaceHistory: [], broadcastInputSessions: new Set(), sessionHistories: {} });
  const sandbox = vm.createContext({
    console, terminalStore, formatTerminalBootstrapOutput,
    TerminalAPI: { resizeTerminal: async () => {}, connectTarget: connect, closeTerminalSession: async key => calls.close.push(key), cancelConnectTarget: async target => calls.cancel.push(target), writeTerminalInput: async (key, data) => calls.writes.push({ key, data }) },
    t: key => key, escapeHtml: String,
    hasSessionLogPersisted: () => true,
    markSessionLogPersisted() {}, trimSessionOutput() {}, writeSessionLog() {},
    confirmDialog: async () => { calls.confirmations++; return true; },
    window: { location: { hash: '#/terminal' } },
  });
  for (const file of ['TerminalLifecycle.js', 'TerminalReconnect.js']) {
    const source = fs.readFileSync(path.join(root, 'modules/terminal', file), 'utf8')
      .replace(/^import[\s\S]*?;\n/gm, '')
      .replace(/\bexport\s+(?=(?:async\s+)?function\s+)/g, '')
      .replace(/^export\s+\{[^}]*\};?$/gm, '');
    vm.runInContext(source, sandbox, { filename: file });
  }
  const method = (start, end) => pageSource.slice(pageSource.indexOf(start), pageSource.indexOf(end, pageSource.indexOf(start)));
  vm.runInContext(`page = new (class {${method('  async closePane(', '  // A. 分頁 Tab')}${method('  renderReconnectOverlay(', '  /**\n   * 更新指定 pane')}${method('  wireReconnectOverlayButtons(', '  /**\n   * 重繪後同步')}})()`, sandbox);
  sandbox.page.updateReconnectOverlay = () => {};
  return { sandbox, calls, terminalStore, term, run: code => vm.runInContext(code, sandbox) };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('重連失敗後重新渲染仍顯示可重試的失敗狀態', async () => {
  const h = await harness();
  h.run('beginReconnect("old")');
  await settle();
  assert.match(h.run('page.renderReconnectOverlay("old")'), /data-reconnect-state="failed"/);
});

test('使用者選擇不再重連後移除 session 與空 workspace，不留下空白分頁', async () => {
  const h = await harness();
  h.run('beginReconnect("old")');
  await settle();
  let handler;
  h.sandbox.overlay = { querySelector: selector => selector === '.reconnect-btn-abort' ? { getAttribute: () => 'old', addEventListener: (_type, callback) => { handler = callback; } } : null };
  h.run('page.wireReconnectOverlayButtons(overlay)');
  handler({ stopPropagation() {} });
  await settle();
  const state = h.terminalStore.getState();
  assert.equal(state.sessions.old, undefined);
  assert.equal(state.workspaces.length, 0, '關閉最後一個 pane 不可把空 workspace 寫回 Store');
  assert.equal(state.activeWorkspaceId, 'host-tab');
  assert.equal(h.calls.confirmations, 0, '已選擇不重連，不應再次詢問是否中斷連線');
});

test('新 SSH 在連線回應前送出的 prompt 仍能顯示於重連後的終端', async () => {
  let resolve;
  const h = await harness(() => new Promise(done => { resolve = done; }));
  const app = fs.readFileSync(path.join(root, 'App.js'), 'utf8');
  const start = app.indexOf('    this.runtimeEventOffs.push(onWailsEvent("terminal-output",');
  const end = app.indexOf('\n    }));', start) + '\n    }));'.length;
  h.sandbox.runtimeEventOffs = [];
  h.sandbox.onWailsEvent = (_name, callback) => { h.sandbox.output = callback; return () => {}; };
  vm.runInContext(app.slice(start, end), h.sandbox);
  h.run('beginReconnect("old")');
  const target = h.run('getReconnectContext("old").target');
  const newKey = `test|22|test|password|||no-sudo|${target.config.sessionId}`;
  h.sandbox.output({ key: newKey, chunk: 'test@server:~$ ' });
  resolve({ success: true, sessionKey: newKey, output: '' });
  await settle();
  assert.match(h.terminalStore.getState().sessions[newKey].outputHtml, /test@server:~\$ /);
  assert.match(h.calls.writes.join(''), /test@server:~\$ /);
});


test('重複斷線通知不會移除正在重連的 pane', async () => {
  let attempts = 0;
  const h = await harness(() => { attempts++; return new Promise(() => {}); });
  h.run('beginReconnect("old")');
  assert.equal(h.run('handleReconnectClosed("old")'), true);
  assert.equal(h.run('beginReconnect("old")'), true);
  assert.equal(attempts, 1);
  assert.ok(h.terminalStore.getState().sessions.old);
});

test('重試使用新的連線識別碼，且不接受已在建立期間斷線的 session', async () => {
  const attempts = [];
  const h = await harness(target => new Promise(resolve => attempts.push({ target, resolve })));
  h.run('beginReconnect("old")');
  const first = attempts[0].target.config.sessionId;
  h.sandbox.earlyKey = 'test|22|test|password|||no-sudo|' + first;
  assert.equal(h.run('handleReconnectClosed(earlyKey)'), true);
  attempts[0].resolve({ success: true, sessionKey: h.sandbox.earlyKey });
  await settle();
  assert.equal(h.run('getReconnectContext("old").status'), 'failed');
  assert.ok(h.terminalStore.getState().sessions.old);
  h.run('retryReconnect("old")');
  assert.notEqual(attempts[1].target.config.sessionId, first);
  assert.equal(h.run('bufferReconnectOutput(earlyKey, "stale")'), false);
  attempts[1].resolve({ success: false });
  await settle();
});

test('關閉重連中的 pane 會取消請求，遲到的成功連線立即關閉', async () => {
  let resolve;
  const h = await harness(() => new Promise(done => { resolve = done; }));
  h.run('beginReconnect("old")');
  await h.run('page.closePane("old")');
  await settle();
  assert.equal(h.calls.cancel.length, 1);
  assert.equal(h.calls.confirmations, 0);
  resolve({ success: true, sessionKey: 'late' });
  await settle();
  assert.deepEqual(h.calls.close, ['old', 'late']);
  assert.equal(h.terminalStore.getState().workspaces.length, 0);
  assert.equal(h.terminalStore.getState().sessions.late, undefined);
});

test('成功遷移使用最新 xterm，訂閱者不會看到不完整綁定，暫存輸入仍需確認', async () => {
  let resolve;
  const h = await harness(() => new Promise(done => { resolve = done; }));
  h.run('beginReconnect("old"); bufferReconnectInput("old", "echo queued\\r")');
  const writes = [];
  const latestTerm = { write: text => writes.push(text), cols: 100, rows: 30 };
  h.terminalStore.getState().setXtermInstance('old', latestTerm);
  h.terminalStore.getState().addBroadcastSession('old');
  h.terminalStore.getState().setSessionHistory('old', ['pwd']);
  const snapshots = [];
  const off = h.terminalStore.subscribe(state => snapshots.push({
    keys: Object.keys(state.sessions), pane: state.workspaces[0].columns[0].panes[0].sessionKey,
    term: state.xtermInstances.new, pending: h.run('getReconnectContext("new")?.pendingInput')
  }));
  resolve({ success: true, sessionKey: 'new', output: 'ready' });
  await settle();
  off();
  assert.equal(snapshots.length, 1);
  assert.deepEqual(snapshots[0].keys, ['new']);
  assert.equal(snapshots[0].pane, 'new');
  assert.equal(snapshots[0].term, latestTerm);
  assert.ok(snapshots[0].pending);
  assert.equal(latestTerm.__termixSessionKey, 'new');
  assert.equal(h.calls.disposed, 0);
  assert.equal(h.calls.writes.length, 0, '不得使用過期的 xterm 或自動送出暫存輸入');
  assert.match(writes.join(''), /ready/);
  assert.deepEqual(h.terminalStore.getState().sessionHistories.new, ['pwd']);
  assert.ok(h.terminalStore.getState().broadcastInputSessions.has('new'));
});

test('關閉背景 pane 保留目前工作區', async () => {
  const h = await harness();
  const other = { id: 'other', columns: [{ panes: [{ sessionKey: 'other-key' }] }] };
  h.terminalStore.setState({ workspaces: [...h.terminalStore.getState().workspaces, other], activeWorkspaceId: 'other', activePaneSessionKey: 'other-key' });
  await h.run('page.closePane("old", { confirm: false })');
  assert.equal(h.terminalStore.getState().activeWorkspaceId, 'other');
  assert.equal(h.terminalStore.getState().activePaneSessionKey, 'other-key');
  assert.equal(h.terminalStore.getState().workspaces.length, 1);
});

test('Kubernetes Shell 不可誤用一般 SSH 重連', async () => {
  const h = await harness();
  assert.equal(h.run('isReconnectableSession({ isKubernetesShell: true, config: { hostId: "host" } })'), false);
});


test('關閉活動工作區的最後一個 pane 會返回最近使用工作區', async () => {
  const h = await harness();
  const makeWorkspace = id => ({ id, columns: [{ panes: [{ sessionKey: id }] }] });
  h.terminalStore.setState({ workspaces: [...h.terminalStore.getState().workspaces, makeWorkspace('older'), makeWorkspace('recent')], workspaceHistory: ['recent', 'older'] });
  await h.run('page.closePane("old", { confirm: false })');
  const state = h.terminalStore.getState();
  assert.equal(state.activeWorkspaceId, 'recent');
  assert.equal(state.activePaneSessionKey, 'recent');
  assert.equal(state.workspaces.length, 2);
  assert.equal(state.workspaces.some(ws => ws.id === 'ws'), false);
});

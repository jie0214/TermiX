// 先啟動 Vite，再以 PLAYWRIGHT_MODULE 指向 Playwright；僅模擬 Wails 邊界，不連線真實 SSH。
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1100, height: 720 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  const origin = process.env.TERMIX_TEST_ORIGIN || 'http://127.0.0.1:5187';
  await page.route('**/__reconnect_test__', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body style="margin:0"></body></html>' }));
  await page.goto(`${origin}/__reconnect_test__`);
  await page.evaluate(async () => {
    window.calls = { writes: [], close: [], cancel: [], resize: [] };
    window.attempts = [];
    window.go = { app: { App: {
      ConnectHostTerminal: request => new Promise(resolve => window.attempts.push({ request, resolve })),
      CancelConnectHostTerminal: async request => window.calls.cancel.push(request),
      CloseTerminalSession: async key => window.calls.close.push(key),
      WriteTerminalInput: async (key, data) => window.calls.writes.push({ key, data }),
      ResizeTerminal: async (...args) => window.calls.resize.push(args),
    } } };
    window.fixture = await import('/support/terminal-reconnect-fixture.js');
    const { TerminalPage, terminalStore } = window.fixture;
    window.store = terminalStore;
    terminalStore.setState({ sessions: { old: { label: 'SSH', config: { hostId: 'test', host: 'test.invalid' }, outputHtml: window.fixture.formatTerminalBootstrapOutput('previous output\n[14:25:21] [Terminal] 建立持久 SSH Terminal session\n[14:25:21] [Sudo] 在目前 PTY 啟動 sudo shell 並驗證權限\n[14:25:21] [Terminal] 已連線至 test@example:22\n\n') } }, workspaces: [{ id: 'ws', columns: [{ width: 100, panes: [{ sessionKey: 'old', height: 100 }] }] }], activeWorkspaceId: 'ws', activePaneSessionKey: 'old' });
    window.terminalPage = new TerminalPage();
    window.terminalPage.style.cssText = 'display:flex;width:100vw;height:100vh';
    document.body.append(window.terminalPage);
    window.originalTerm = terminalStore.getState().xtermInstances.old;
    window.begin = key => window.fixture.beginReconnect(key, { onStatus: (key, status) => window.terminalPage.updateReconnectOverlay(key, status) });
    window.begin('old');
    window.attempts[0].resolve({ success: false, error: 'network unavailable' });
  });
  const initialLines = await page.evaluate(async () => {
    const term = window.originalTerm;
    await new Promise(resolve => term.write('', resolve));
    return Array.from({ length: term.buffer.active.length }, (_, i) => term.buffer.active.getLine(i).translateToString(true)).filter(line => line.includes('[14:25:21]'));
  });
  assert.equal(initialLines.length, 3);
  assert.ok(initialLines.every(line => line.startsWith('[14:25:21]')), JSON.stringify(initialLines));
  await page.waitForSelector('[data-reconnect-state="failed"] .reconnect-btn-retry');
  // 切換工作區觸發實際重繪，失敗狀態與重試按鈕必須仍存在。
  await page.evaluate(() => {
    window.store.setState({ activeWorkspaceId: 'host-tab' });
    window.store.setState({ activeWorkspaceId: 'ws' });
  });
  await page.waitForSelector('[data-reconnect-state="failed"] .reconnect-btn-retry');
  await page.click('.reconnect-btn-retry');
  await page.evaluate(() => {
    const attempt = window.attempts[1];
    window.newKey = 'test|22|test|password|||no-sudo|' + attempt.request.sessionId;
    window.fixture.bufferReconnectOutput(window.newKey, 'test@server:~$ ');
    window.fixture.bufferReconnectInput('old', 'queued command\r');
    attempt.resolve({ success: true, sessionKey: window.newKey, output: '[14:26:21] [Terminal] 建立持久 SSH Terminal session\n[14:26:21] [Sudo] 在目前 PTY 啟動 sudo shell 並驗證權限\n[14:26:21] [Terminal] 已連線至 test@example:22\n' });
  });
  await page.waitForSelector('[data-reconnect-state="pending"]');
  const result = await page.evaluate(async () => {
    const term = window.store.getState().xtermInstances[window.newKey];
    await new Promise(resolve => term.write('', resolve));
    const lines = Array.from({ length: term.buffer.active.length }, (_, i) => term.buffer.active.getLine(i).translateToString()).join('\n');
    return { same: term === window.originalTerm, connected: term.element.isConnected, lines, key: term.__termixSessionKey, expected: window.newKey, writes: window.calls.writes.length, resized: window.calls.resize.some(args => args[0] === window.newKey) };
  });
  assert.equal(result.same, true); assert.equal(result.connected, true);
  assert.equal(result.key, result.expected); assert.equal(result.writes, 0); assert.equal(result.resized, true);
  const reconnectLines = result.lines.split('\n').filter(line => line.includes('[14:26:21]'));
  assert.equal(reconnectLines.length, 3);
  assert.ok(reconnectLines.every(line => line.startsWith('[14:26:21]')), JSON.stringify(reconnectLines));
  assert.match(result.lines, /previous output/); assert.match(result.lines, /test@server:~\$/);
  await page.click('.reconnect-btn-discard');
  await page.locator('.xterm-helper-textarea').focus();
  await page.keyboard.type('pwd');
  const writes = await page.evaluate(() => window.calls.writes);
  assert.equal(writes.map(item => item.data).join(''), 'pwd');
  assert.ok(writes.every(item => item.key === result.expected));
  console.log('PASS：失敗狀態跨重繪保留；重試保留 xterm、歷史與早到 prompt；新連線輸入及尺寸正確。');
  await page.evaluate(() => { window.begin(window.newKey); });
  await page.click('.reconnect-btn-abort');
  await page.evaluate(() => window.attempts[2].resolve({ success: true, sessionKey: 'late-success' }));
  await page.waitForFunction(() => window.calls.close.includes('late-success'));
  const closed = await page.evaluate(() => ({ workspaces: window.store.getState().workspaces.length, sessions: Object.keys(window.store.getState().sessions), active: window.store.getState().activeWorkspaceId, cancel: window.calls.cancel.length, hash: location.hash }));
  assert.deepEqual(closed, { workspaces: 0, sessions: [], active: 'host-tab', cancel: 1, hash: '#/hosts' });
  console.log('PASS：取消重連移除分頁與 session、回到主機列表，取消請求並關閉遲到連線。');
  await page.evaluate(() => {
    window.store.setState({ sessions: { background: { label: 'SSH', config: { hostId: 'test' }, outputHtml: 'background history\r\n' } }, workspaces: [{ id: 'background-ws', columns: [{ width: 100, panes: [{ sessionKey: 'background', height: 100 }] }] }] });
    window.begin('background');
    const attempt = window.attempts[3];
    window.backgroundKey = 'test|22|test|password|||no-sudo|' + attempt.request.sessionId;
    window.fixture.bufferReconnectOutput(window.backgroundKey, 'background prompt$ ');
    attempt.resolve({ success: true, sessionKey: window.backgroundKey });
  });
  await page.waitForFunction(() => Boolean(window.store.getState().sessions[window.backgroundKey]));
  await page.evaluate(() => window.store.setState({ activeWorkspaceId: 'background-ws', activePaneSessionKey: window.backgroundKey }));
  const backgroundOutput = await page.evaluate(async () => {
    const term = window.store.getState().xtermInstances[window.backgroundKey];
    await new Promise(resolve => term.write('', resolve));
    return Array.from({ length: term.buffer.active.length }, (_, i) => term.buffer.active.getLine(i).translateToString()).join('\n');
  });
  assert.match(backgroundOutput, /background history/);
  assert.match(backgroundOutput, /background prompt/);
  assert.deepEqual(errors, []);
  console.log('PASS：尚未掛載終端的背景重連，首次開啟後仍顯示歷史與 prompt。');
} finally {
  await browser.close();
}

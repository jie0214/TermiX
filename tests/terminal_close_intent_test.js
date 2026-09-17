// 重播實際 App 事件處理器與重連模組，驗證原生選單關閉後不會重新建立 SSH。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

function replayClose(data, frontendMarked = false) {
  const root = path.join(__dirname, '../frontend/src');
  const calls = { connect: 0, removed: [], notices: [] };
  const state = {
    sessions: { 'ssh-a': { config: { host: 'test.example', username: 'test' } } },
    workspaces: [{ id: 'workspace', columns: [{ panes: [{ sessionKey: 'ssh-a' }] }] }],
    xtermInstances: {},
    removeBroadcastSession() {},
    removeSession(key) { delete this.sessions[key]; },
  };
  const sandbox = vm.createContext({
    console,
    terminalStore: { getState: () => state },
    TerminalAPI: { connectTarget() { calls.connect++; return new Promise(() => {}); } },
    t: value => value,
    document: { querySelector: () => null },
    hasSessionLogPersisted: () => true,
    markSessionLogPersisted() {}, trimSessionOutput() {}, writeSessionLog() {},
    onWailsEvent(name, callback) { sandbox.closed = callback; return () => {}; },
    runtimeEventOffs: [],
    removeSessionFromWorkspaces(key) { calls.removed.push(key); },
    routeAfterSessionRemoval() {},
    showDisconnectNotice(label) { calls.notices.push(label); },
  });
  for (const file of ['TerminalLifecycle.js', 'TerminalReconnect.js']) {
    const source = fs.readFileSync(path.join(root, 'modules/terminal', file), 'utf8')
      .replace(/^import[\s\S]*?;\n/gm, '')
      .replace(/\bexport\s+(?=(?:async\s+)?function\s+)/g, '')
      .replace(/^export\s+\{[^}]*\};?$/gm, '');
    vm.runInContext(source, sandbox, { filename: file });
  }
  const app = fs.readFileSync(path.join(root, 'App.js'), 'utf8');
  const start = app.indexOf('    this.runtimeEventOffs.push(onWailsEvent("terminal-closed",');
  const end = app.indexOf('\n    }));', start) + '\n    }));'.length;
  assert.ok(start >= 0 && end > start, '必須執行實際的 terminal-closed 處理器');
  vm.runInContext(app.slice(start, end), sandbox, { filename: 'App.js terminal-closed' });
  if (frontendMarked) vm.runInContext('markSessionUserClosed("ssh-a")', sandbox);
  sandbox.closed(data);
  return { calls, state };
}

test('原生選單主動中斷後，移除工作階段且不再呼叫 SSH 連線', () => {
  const data = process.env.TERMIX_CLOSE_EVENT_FIXTURE
    ? JSON.parse(fs.readFileSync(process.env.TERMIX_CLOSE_EVENT_FIXTURE, 'utf8'))
    : { key: 'ssh-a', reason: 'user' };
  const { calls, state } = replayClose(data);
  assert.equal(calls.connect, 0, '主動中斷連線不應被自動重連');
  assert.deepEqual(calls.removed, ['ssh-a']);
  assert.equal(state.sessions['ssh-a'], undefined);
  assert.deepEqual(calls.notices, []);
});

test('遠端非預期斷線仍會自動重連', () => {
  const { calls } = replayClose({ key: 'ssh-a', reason: 'remote' });
  assert.equal(calls.connect, 1);
  assert.deepEqual(calls.removed, []);
});

test('前端標記的主動關閉仍維持相容', () => {
  const { calls } = replayClose({ key: 'ssh-a' }, true);
  assert.equal(calls.connect, 0);
  assert.deepEqual(calls.removed, ['ssh-a']);
});

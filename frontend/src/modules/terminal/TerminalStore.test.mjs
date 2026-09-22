import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { beforeEach, test } from 'node:test';
import { terminalStore } from './TerminalStore.js';

beforeEach(() => {
  terminalStore.setState({
    workspaces: [
      { id: 'a', label: '主機 A', columns: [{ id: 'ca', width: 100, panes: [{ sessionKey: 'ssh-a', height: 100 }] }] },
      { id: 'b', label: '主機 B', columns: [{ id: 'cb', width: 100, panes: [{ sessionKey: 'ssh-b', height: 100 }] }] },
    ],
    activeWorkspaceId: 'a',
    workspaceHistory: [],
    activePaneSessionKey: 'ssh-a',
    sessions: { 'ssh-a': { label: '主機 A' }, 'ssh-b': { label: '主機 B' } },
    xtermInstances: { 'ssh-a': { marker: '既有終端' } },
  });
});

test('自訂分頁名稱不修改主機名稱、連線或終端實例', () => {
  const before = terminalStore.getState();
  before.renameWorkspace('a', '  正式環境監控  ');
  const after = terminalStore.getState();
  assert.equal(after.workspaces[0].label, '正式環境監控');
  assert.equal(after.workspaces[0].isCustomLabel, true);
  assert.equal(after.workspaces[1], before.workspaces[1]);
  assert.equal(after.sessions, before.sessions);
  assert.equal(after.xtermInstances, before.xtermInstances);
  assert.equal(after.activePaneSessionKey, 'ssh-a');
});

test('空白名稱保留原名，過長名稱限制為 80 個字元', () => {
  terminalStore.getState().renameWorkspace('a', '  ');
  assert.equal(terminalStore.getState().workspaces[0].label, '主機 A');
  terminalStore.getState().renameWorkspace('a', 'a'.repeat(100));
  assert.equal(terminalStore.getState().workspaces[0].label.length, 80);
});

test('合併後可命名，再次合併仍保留自訂名稱與所有窗格', async () => {
  const source = await readFile(new URL('../../App.js', import.meta.url), 'utf8');
  const method = source.slice(source.indexOf('  mergeWorkspaces('), source.indexOf('  setupSidebarListeners('));
  const app = new Function('terminalStore', 'KUBERNETES_SESSION_ID', 'SFTP_TAB_ID', 'window', `return ({${method}});`)(terminalStore, 'kubernetes-session', 'sftp-tab', { location: {} });
  const instances = terminalStore.getState().xtermInstances;
  app.mergeWorkspaces('b', 'a');
  terminalStore.getState().renameWorkspace('a', '維運工作區');
  terminalStore.getState().addWorkspace({ id: 'c', label: '主機 C', columns: [{ id: 'cc', panes: [{ sessionKey: 'ssh-c' }] }] });
  app.mergeWorkspaces('c', 'a');
  const state = terminalStore.getState();
  assert.equal(state.workspaces.length, 1);
  assert.equal(state.workspaces[0].label, '維運工作區');
  assert.deepEqual(state.workspaces[0].columns.flatMap(column => column.panes.map(pane => pane.sessionKey)), ['ssh-a', 'ssh-b', 'ssh-c']);
  assert.equal(state.xtermInstances, instances);
});

async function closeHarness() {
  const source = await readFile(new URL('../../App.js', import.meta.url), 'utf8');
  const close = source.slice(source.indexOf('  async closeWorkspace('), source.indexOf('  removeSessionFromWorkspaces('));
  return new Function('terminalStore', 'confirmDialog', 't', 'markSessionUserClosed', 'TerminalAPI', 'cleanupFrontendSession', 'window', `return ({${close}});`)(terminalStore, async () => true, value => value, () => {}, { closeTerminalSession: async () => {} }, () => {}, { location: {} });
}

test('關閉目前分頁回到最近使用的 Session，而不是第一個分頁', async () => {
  const app = await closeHarness();
  terminalStore.getState().addWorkspace({ id: 'c', columns: [{ panes: [{ sessionKey: 'ssh-c' }] }] });
  terminalStore.getState().setActiveWorkspaceId('b');
  terminalStore.getState().setActiveWorkspaceId('c');
  await app.closeWorkspace('c');
  assert.equal(terminalStore.getState().activeWorkspaceId, 'b');
  assert.equal(terminalStore.getState().activePaneSessionKey, 'ssh-b');
});

test('以使用順序而非建立順序切換，連續關閉略過已移除的 Session', async () => {
  const app = await closeHarness();
  terminalStore.getState().addWorkspace({ id: 'c', columns: [{ panes: [{ sessionKey: 'ssh-c' }] }] });
  for (const id of ['b', 'c', 'a', 'c']) terminalStore.getState().setActiveWorkspaceId(id);
  await app.closeWorkspace('c');
  assert.equal(terminalStore.getState().activeWorkspaceId, 'a');
  await app.closeWorkspace('a');
  assert.equal(terminalStore.getState().activeWorkspaceId, 'b');
  await app.closeWorkspace('b');
  assert.equal(terminalStore.getState().activeWorkspaceId, 'host-tab');
  assert.equal(terminalStore.getState().activePaneSessionKey, null);
  assert.deepEqual(terminalStore.getState().workspaceHistory, []);
});

test('關閉背景 Session 不切走目前分頁，批次建立分頁也記錄最近使用順序', async () => {
  const app = await closeHarness();
  terminalStore.getState().setActiveWorkspaceId('b');
  terminalStore.setState(state => ({ workspaces: [...state.workspaces, { id: 'c', columns: [{ panes: [{ sessionKey: 'ssh-c' }] }] }], activeWorkspaceId: 'c', activePaneSessionKey: 'ssh-c' }));
  await app.closeWorkspace('a');
  assert.equal(terminalStore.getState().activeWorkspaceId, 'c');
  assert.equal(terminalStore.getState().activePaneSessionKey, 'ssh-c');
  await app.closeWorkspace('c');
  assert.equal(terminalStore.getState().activeWorkspaceId, 'b');
});

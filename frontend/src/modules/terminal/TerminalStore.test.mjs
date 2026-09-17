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
  const app = new Function('terminalStore', 'KUBERNETES_SESSION_ID', 'window', `return ({${method}});`)(terminalStore, 'kubernetes-session', { location: {} });
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

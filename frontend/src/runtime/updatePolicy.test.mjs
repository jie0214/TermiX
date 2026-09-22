import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { shouldNotifyUpdate, dismissUpdateVersion, UPDATE_CHECK_INTERVAL_MS } from './updatePolicy.ts';

test('關閉通知跨重啟保留，同版或舊版不提示，新版及手動檢查可提示', async () => {
  localStorage.clear();
  assert.equal(shouldNotifyUpdate('1.9.1'), true);
  dismissUpdateVersion('1.9.1');
  const restarted = await import('./updatePolicy.ts?restarted');
  assert.equal(restarted.shouldNotifyUpdate('1.9.1'), false);
  assert.equal(restarted.shouldNotifyUpdate('1.9.0'), false);
  assert.equal(restarted.shouldNotifyUpdate('1.10.0'), true);
  assert.equal(restarted.shouldNotifyUpdate('1.9.1', true), true);
});

test('啟動及每小時檢查共用通知策略，重複初始化不增加計時器', async () => {
  const source = await readFile(new URL('./updateCheck.ts', import.meta.url), 'utf8');
  const runnable = stripTypeScriptTypes(source.replace(/^import .*;\n/gm, '').replace(/export /g, ''));
  const callbacks = [], shown = [], checks = [];
  let version = '2.0.0';
  const api = new Function('getAppBinding', 'onWailsEvent', 'showToast', 'showUpdateNotification', 't', 'shouldNotifyUpdate', 'UPDATE_CHECK_INTERVAL_MS', 'setInterval', `${runnable}; return {checkForUpdateAndNotify, runUpdateCheck};`)(
    name => name === 'HandleNativeUpdateCheck' ? async () => false : async () => { checks.push(version); return { hasUpdate: true, latestVersion: version }; },
    () => {}, () => {}, value => shown.push(value), value => value, shouldNotifyUpdate, UPDATE_CHECK_INTERVAL_MS,
    (callback, ms) => { assert.equal(ms, 3600000); callbacks.push(callback); return 1; },
  );
  await api.checkForUpdateAndNotify();
  assert.deepEqual(shown, ['2.0.0']);
  dismissUpdateVersion('2.0.0');
  callbacks[0](); await new Promise(resolve => setImmediate(resolve));
  await api.checkForUpdateAndNotify();
  assert.equal(callbacks.length, 1);
  assert.equal(checks.length, 3);
  assert.deepEqual(shown, ['2.0.0']);
  version = '2.0.1'; callbacks[0](); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(shown, ['2.0.0', '2.0.1']);
});

test('通知不自動消失，同版本每小時檢查不重建卡片，關閉才記住版本', async () => {
  const source = await readFile(new URL('./updateNotification.ts', import.meta.url), 'utf8');
  const runnable = stripTypeScriptTypes(source.replace(/^import .*;\n/gm, '').replace(/export /g, ''));
  let card, creations = 0;
  const listeners = new Map(), dismissed = [], timers = [];
  const document = {
    body: { appendChild: node => { card = node; } },
    getElementById: () => card,
    createElement: () => {
      creations++;
      return { dataset: {}, style: {}, setAttribute() {}, querySelector: selector => ({ addEventListener: (_, fn) => listeners.set(selector, fn) }), remove() { card = undefined; } };
    },
  };
  const show = new Function('document', 'requestAnimationFrame', 'setTimeout', 'dismissUpdateVersion', 'getAppBinding', 'openBrowserURL', 'showToast', 't', `${runnable}; return showUpdateNotification;`)(document, fn => fn(), fn => timers.push(fn), value => dismissed.push(value), () => undefined, () => {}, () => {}, value => value);
  show('3.0.0', ''); show('3.0.0', '');
  assert.equal(creations, 1);
  assert.equal(timers.length, 0, '沒有自動關閉計時器');
  assert.deepEqual(dismissed, []);
  listeners.get('[data-action="close"]')();
  assert.deepEqual(dismissed, ['3.0.0']);
  timers[0](); assert.equal(card, undefined);
});

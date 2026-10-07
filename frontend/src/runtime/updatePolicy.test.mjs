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
  show('3.1.0', ''); show('3.1.0', '', true);
  assert.equal(creations, 3, '原生更新器就緒後應替換同版本的備援下載卡片');
  assert.equal(card.dataset.native, 'true');
});


test('原生背景下載事件顯示通知、關閉後不重複，按鈕交回 Sparkle', async () => {
  localStorage.clear();
  const source = await readFile(new URL('./updateCheck.ts', import.meta.url), 'utf8');
  const runnable = stripTypeScriptTypes(source.replace(/^import .*;\n/gm, '').replace(/export /g, ''));
  const events = new Map(), shown = [];
  const register = new Function('onWailsEvent', 'shouldNotifyUpdate', 'showUpdateNotification', `${runnable}; return registerUpdateMenuListener;`)(
    (event, callback) => events.set(event, callback), shouldNotifyUpdate, (...args) => shown.push(args),
  );
  register();
  events.get('native-update-found')('4.0.0');
  assert.deepEqual(shown, [['4.0.0', 'https://github.com/jie0214/TermiX/releases', true]]);
  dismissUpdateVersion('4.0.0');
  events.get('native-update-found')('4.0.0');
  assert.equal(shown.length, 1);

  const notificationSource = await readFile(new URL('./updateNotification.ts', import.meta.url), 'utf8');
  const notification = stripTypeScriptTypes(notificationSource.replace(/^import .*;\n/gm, '').replace(/export /g, ''));
  const listeners = new Map(), calls = [];
  const document = {body: {appendChild() {}}, getElementById: () => null, createElement: () => ({dataset: {}, style: {}, setAttribute() {}, querySelector: selector => ({addEventListener: (_, callback) => listeners.set(selector, callback)})})};
  const show = new Function('document', 'requestAnimationFrame', 'getAppBinding', 't', `${notification}; return showUpdateNotification;`)(
    document, fn => fn(), name => async manual => { calls.push([name, manual]); return true; }, key => key,
  );
  show('4.1.0', '', true);
  await listeners.get('[data-action="download"]')();
  assert.deepEqual(calls, [['HandleNativeUpdateCheck', true]], '不可啟動第二套下載');
});

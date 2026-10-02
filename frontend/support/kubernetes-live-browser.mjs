// 先啟動 Vite，再以 PLAYWRIGHT_MODULE 指向可用的 Playwright 套件執行。
// 此驗證使用獨立瀏覽器與假 Wails 資料，不會連線或修改真實叢集。
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1100, height: 720 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  const origin = process.env.TERMIX_TEST_ORIGIN || 'http://127.0.0.1:5187';
  await page.route('**/__live_test__', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body style="margin:0"><div id="test-root"></div></body></html>' }));
  await page.goto(`${origin}/__live_test__`);
  await page.evaluate(async () => {
    window.liveCallbacks = new Map();
    window.liveCalls = { start: 0, stop: 0, shell: 0 };
    window.runtime = { EventsOn(name, callback) { window.liveCallbacks.set(name, callback); return () => window.liveCallbacks.delete(name); } };
    window.go = { app: { App: {
      StartKubernetesLiveUpdates: async () => { window.liveCalls.start++; },
      StopKubernetesLiveUpdates: async () => { window.liveCalls.stop++; },
      GetKubernetesNamespaces: async () => ['default', 'system'],
      GetKubernetesResourceEvents: async () => ({ events: [] }),
      GetKubernetesResourceDetail: async request => ({ ...request, status: 'Running', containers: [{ name: 'app' }], fields: [], labels: [], yaml: 'replicas: 2' }),
    } } };
    const { KubernetesSessionPage, kubernetesSessionStore: store, applyKubernetesChanges, patchKubernetesDOM } = await import('/support/kubernetes-live-fixture.js');
    window.patchKubernetesDOM = patchKubernetesDOM;
    window.liveStore = store;
    const pods = Array.from({ length: 120 }, (_, index) => ({ name: `api-${String(index).padStart(3, '0')}`, uid: `uid-${index}`, namespace: 'default', phase: 'Running', status: 'Running', ready: '1/1', restarts: 0, nodeName: 'node', creationTimestamp: '2026-10-01T00:00:00Z', containers: [{ name: 'app' }], cpuUsageMilli: 10 }));
    const dashboard = applyKubernetesChanges({ namespace: '*', metrics: { available: true }, serverVersion: 'v1.test' }, [
      { section: 'pods', type: 'reset', items: pods },
      { section: 'namespaceDetails', type: 'reset', items: [{ name: 'default' }, { name: 'system' }] },
      { section: 'deployments', type: 'reset', items: [{ name: 'api', namespace: 'default', desiredReplicas: 2 }] },
    ]).dashboard;
    store.setState({ connectedCluster: { connectedAt: 'test-connection', clusterName: 'test', namespace: 'default' }, connectionStatus: 'connected', activeSection: 'pods', dashboard, namespaces: ['default', 'system'] });
    window.livePage = new KubernetesSessionPage();
    window.livePage.style.cssText = 'display:flex;height:100vh;width:100vw';
    document.getElementById('test-root').appendChild(window.livePage);
    window.emitLive = changes => window.liveCallbacks.get('kubernetes-live-update')({ connectedAt: 'test-connection', streamId: window.livePage.liveStreamId, changes });
    window.livePage.openPodShellSession = () => { window.liveCalls.shell++; };
  });
  await page.waitForSelector('#kubernetesPodSearch');
  const stable = await page.evaluate(() => {
    const root = window.livePage;
    const input = root.querySelector('#kubernetesPodSearch');
    input.focus(); input.value = 'api'; input.dispatchEvent(new Event('input', { bubbles: true }));
    input.setSelectionRange(1, 2);
    const scroll = root.querySelector('.kubernetes-session-scrollbody');
    scroll.scrollTop = 500; scroll.scrollLeft = 80;
    const table = root.querySelector('table');
    const row = root.querySelector('[data-resource-name="api-010"]');
    const top = scroll.scrollTop, left = scroll.scrollLeft;
    for (let i = 0; i < 20; i++) window.emitLive([{ section: 'pods', type: 'MODIFIED', item: { ...window.liveStore.getState().dashboard.pods[10], restarts: i + 1 } }]);
    row.querySelector('[data-pod-action="shell"]').click();
    return {
      input: input === root.querySelector('#kubernetesPodSearch'),
      table: table === root.querySelector('table'), row: row === root.querySelector('[data-resource-name="api-010"]'),
      focus: document.activeElement === input, selection: [input.selectionStart, input.selectionEnd], value: input.value,
      scroll: [top, left, scroll.scrollTop, scroll.scrollLeft], shell: window.liveCalls.shell,
      liveStarts: window.liveCalls.start,
    };
  });
  assert.equal(stable.input, true); assert.equal(stable.table, true); assert.equal(stable.row, true);
  assert.equal(stable.focus, true); assert.deepEqual(stable.selection, [1, 2]); assert.equal(stable.value, 'api');
  assert.deepEqual(stable.scroll.slice(0, 2), stable.scroll.slice(2)); assert.equal(stable.shell, 1); assert.equal(stable.liveStarts, 1);
  console.log('PASS：連續 20 次更新保留輸入框、表格、資源列、焦點、選取範圍與捲動；Shell 僅觸發一次。');
  const anchor = await page.evaluate(() => {
    const root = window.livePage, scroll = root.querySelector('.kubernetes-session-scrollbody');
    root.querySelector('[data-resource-name="api-000"] .kubernetes-select-row').click();
    scroll.scrollTop = 800;
    const top = scroll.getBoundingClientRect().top;
    const row = [...root.querySelectorAll('tr[data-resource-name]')].find(item => item.getBoundingClientRect().bottom > top);
    const before = row.getBoundingClientRect().top;
    const first = window.liveStore.getState().dashboard.pods[0];
    window.emitLive([{ section: 'pods', type: 'DELETED', item: first }]);
    return { before, after: row.getBoundingClientRect().top, connected: row.isConnected, selected: root.selectedRows.size, name: row.dataset.resourceName, scrollTop: scroll.scrollTop, height: scroll.clientHeight, contentHeight: scroll.scrollHeight };
  });
  assert.equal(anchor.selected, 0);
  assert.equal(anchor.connected, true, JSON.stringify(anchor)); assert.ok(Math.abs(anchor.before - anchor.after) < 1, JSON.stringify(anchor));
  console.log('PASS：刪除可見範圍上方的資源後，閱讀位置維持不變。');
  const draft = await page.evaluate(async () => {
    const store = window.liveStore, root = window.livePage;
    await store.getState().openResource('deployment', { name: 'api', namespace: 'default', apiVersion: 'apps/v1' });
    store.getState().selectDetailTab('yaml');
    root.querySelector('#editKubernetesYAML').click();
    const editor = root.querySelector('#kubernetesYAMLEditor');
    editor.focus(); editor.value = 'replicas: 99'; editor.dispatchEvent(new Event('input', { bubbles: true }));
    editor.setSelectionRange(3, 3);
    await store.getState().refreshResourceDetail();
    window.emitLive([{ section: 'pods', type: 'MODIFIED', item: { ...store.getState().dashboard.pods[5], restarts: 25 } }]);
    return { same: editor === root.querySelector('#kubernetesYAMLEditor'), value: editor.value, focus: document.activeElement === editor, caret: editor.selectionStart };
  });
  assert.deepEqual(draft, { same: true, value: 'replicas: 99', focus: true, caret: 3 });
  console.log('PASS：drawer 背景更新保留 YAML 草稿、編輯節點、焦點與游標。');
  const controls = await page.evaluate(() => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const html = '<input id="draft-port" value="8080"><select id="draft-container"><option value="app" selected>app</option><option value="sidecar">sidecar</option></select><span id="control-status">old</span>';
    window.patchKubernetesDOM(host, html);
    const input = host.querySelector('input'), select = host.querySelector('select');
    input.value = '9090'; select.value = 'sidecar';
    host.querySelector('span').tabIndex = 0; host.querySelector('span').focus();
    window.patchKubernetesDOM(host, html.replace('>old<', '>new<'));
    const result = { input: input.value, select: select.value, same: input === host.querySelector('input') && select === host.querySelector('select') };
    host.remove();
    return result;
  });
  assert.deepEqual(controls, { input: '9090', select: 'sidecar', same: true });
  console.log('PASS：背景更新保留未送出的 Port Forward 欄位與容器選擇。');
  const reconnect = await page.evaluate(() => {
    const store = window.liveStore, root = window.livePage;
    const before = store.getState().dashboard.pods;
    window.emitLive([{ section: 'pods', type: 'status', error: 'test disconnect' }]);
    const warning = Boolean(root.querySelector('.kubernetes-live-status'));
    const retained = store.getState().dashboard.pods === before;
    window.emitLive([{ section: 'pods', type: 'status' }]);
    const cleared = !root.querySelector('.kubernetes-live-status');
    const callback = window.liveCallbacks.get('kubernetes-live-update');
    root.remove();
    callback({ connectedAt: 'test-connection', streamId: 'old-stream', changes: [{ section: 'pods', type: 'reset', items: [] }] });
    return { warning, retained, cleared, stopped: window.liveCalls.stop, remaining: store.getState().dashboard.pods.length };
  });
  assert.equal(reconnect.warning, true); assert.equal(reconnect.retained, true); assert.equal(reconnect.cleared, true);
  assert.equal(reconnect.stopped, 1); assert.equal(reconnect.remaining, 119);
  const lifecycle = await page.evaluate(async () => {
    const { KubernetesSessionPage } = await import('/support/kubernetes-live-fixture.js');
    let resolveStart;
    const stopped = [];
    window.go.app.App.StartKubernetesLiveUpdates = () => new Promise(resolve => { resolveStart = resolve; });
    window.go.app.App.StopKubernetesLiveUpdates = async id => stopped.push(id);
    const root = new KubernetesSessionPage();
    document.getElementById('test-root').appendChild(root);
    const pendingStream = root.liveStreamId;
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    root.remove();
    resolveStart();
    await root.liveStartQueue;
    return { cleaned: stopped.includes(pendingStream), stopCount: stopped.length };
  });
  assert.equal(lifecycle.cleaned, true); assert.equal(lifecycle.stopCount, 2);
  console.log('PASS：Start 尚未完成就離開畫面，回應到達後仍會取消舊監看。');
  assert.deepEqual(errors, []);
  console.log('PASS：斷線保留資料、復原清除提示、離開畫面取消訂閱並忽略延遲事件。');
} catch (error) {
  console.error('瀏覽器錯誤：', errors);
  console.error(await page.locator('body').innerText());
  throw error;
} finally {
  await browser.close();
}

import assert from 'node:assert/strict';
import test from 'node:test';
import { createPodAnalysisStore } from './PodAnalysisStore.ts';
import { createAIConnectionStore } from './AIConnectionStore.ts';

const deferred = () => { let resolve, reject; const promise = new Promise((ok, no) => { resolve = ok; reject = no; }); return { promise, resolve, reject }; };
const connection = id => ({ id, name: id, installed: true, connected: true, path: '/bin/agent' });
const target = uid => ({ connectedAt: 'connection-1', namespace: 'payments', podName: 'api', podUid: uid, containers: ['api'] });
const api = overrides => ({ listConnections: async () => [], setConnection: async () => {}, testConnection: async () => {}, listModels: async id => [{ id: id + '-model', name: id + ' model' }], analyze: async () => ({}), cancel: async () => {}, ...overrides });
const tick = () => new Promise(resolve => setImmediate(resolve));

test('快速切換 Agent 不得套用舊模型清單', async () => {
  const a = deferred(), b = deferred();
  const store = createPodAnalysisStore(api({ listModels: id => id === 'a' ? a.promise : b.promise }));
  store.getState().setConnections([connection('a'), connection('b')]);
  const switched = store.getState().selectAgent('b');
  b.resolve([{ id: 'b-live', name: 'B' }]); await switched;
  a.resolve([{ id: 'a-stale', name: 'A' }]); await tick();
  assert.equal(store.getState().agentId, 'b');
  assert.equal(store.getState().modelId, 'b-live');
  assert.deepEqual(store.getState().models.map(m => m.id), ['b-live']);
});

test('模型查詢失敗時不使用預設硬編碼清單', async () => {
  const store = createPodAnalysisStore(api({ listModels: async () => { throw new Error('not authenticated'); } }));
  store.getState().setConnections([connection('a')]); await tick();
  assert.equal(store.getState().modelId, '');
  assert.deepEqual(store.getState().models, []);
  assert.match(store.getState().modelsError, /not authenticated/);
});

test('切換 Pod 會取消後端並忽略舊分析回覆', async () => {
  const pending = deferred(), canceled = [];
  const store = createPodAnalysisStore(api({ analyze: () => pending.promise, cancel: async id => { canceled.push(id); } }));
  store.getState().setTarget(target('uid-1'));
  store.getState().setConnections([connection('a')]); await tick();
  const run = store.getState().analyze(), requestID = store.getState().requestId;
  store.getState().setTarget(target('uid-2'));
  pending.resolve({ text: 'old pod' }); await run;
  assert.deepEqual(canceled, [requestID]);
  assert.equal(store.getState().result, null);
  assert.equal(store.getState().target.podUid, 'uid-2');
});

test('分析傳送使用者選取的模型、UID、容器與資料範圍', async () => {
  let request;
  const store = createPodAnalysisStore(api({ listModels: async () => [{ id: 'fast' }, { id: 'deep' }], analyze: async value => { request = value; return { text: 'report' }; } }));
  store.getState().setTarget(target('uid-1'));
  store.getState().setConnections([connection('a')]); await tick();
  store.getState().selectModel('deep');
  store.getState().setOptions({ includeLogs: false, includeEvents: true });
  await store.getState().analyze();
  assert.equal(request.modelId, 'deep'); assert.equal(request.podUid, 'uid-1');
  assert.equal(request.container, 'api'); assert.equal(request.includeLogs, false);
  assert.equal(request.includeEvents, true); assert.ok(request.requestId);
  assert.equal('containers' in request, false);
});

test('中斷 Agent 會清空模型並取消執行中的分析', async () => {
  const pending = deferred(); let canceled = 0;
  const store = createPodAnalysisStore(api({ analyze: () => pending.promise, cancel: async () => { canceled++; } }));
  store.getState().setTarget(target('uid-1'));
  store.getState().setConnections([connection('a')]); await tick();
  const run = store.getState().analyze();
  store.getState().setConnections([]);
  pending.resolve({ text: 'stale' }); await run;
  assert.equal(canceled, 1); assert.equal(store.getState().modelId, '');
  assert.equal(store.getState().agentId, ''); assert.equal(store.getState().result, null);
});

test('連線測試失敗只影響該列，不把未連線 Agent 標成成功', async () => {
  const store = createAIConnectionStore(api({ listConnections: async () => [{ ...connection('a'), connected: false }], setConnection: async () => { throw new Error('login required'); } }));
  await store.getState().refresh(); await store.getState().toggle('a');
  assert.equal(store.getState().connections[0].connected, false);
  assert.equal(store.getState().errors.a, 'login required');
  assert.equal(store.getState().pending.a, false);
});

test('Event 分析使用事件 API，不要求容器或傳送 Pod 日誌選項', async () => {
  let request;
  const store = createPodAnalysisStore(api({ analyze: async () => { throw new Error('不應呼叫 Pod API'); }, analyzeEvent: async value => { request = value; return { text: 'event report' }; } }));
  store.getState().setTarget({ connectedAt: 'connection-1', namespace: 'payments', eventName: 'backoff', eventUid: 'event-1' });
  store.getState().setConnections([connection('a')]); await tick();
  await store.getState().analyze();
  assert.equal(request.eventUid, 'event-1');
  assert.equal(request.eventName, 'backoff');
  assert.equal(request.modelId, 'a-model');
  assert.equal('includeLogs' in request, false);
  assert.equal('podName' in request, false);
  assert.equal(store.getState().result.text, 'event report');
});

test('切換 Event 或關閉 Drawer 取消分析並忽略舊結果', async () => {
  const pending = deferred(), canceled = [];
  const store = createPodAnalysisStore(api({ analyzeEvent: () => pending.promise, cancel: async id => { canceled.push(id); } }));
  const first = { connectedAt: 'connection-1', namespace: 'payments', eventName: 'backoff', eventUid: 'event-1' };
  store.getState().setTarget(first);
  store.getState().setConnections([connection('a')]); await tick();
  const run = store.getState().analyze();
  store.getState().setTarget({ ...first, eventUid: 'event-2' });
  pending.resolve({ text: 'stale event' }); await run;
  assert.equal(canceled.length, 1);
  assert.equal(store.getState().result, null);
  const next = store.getState().analyze();
  store.getState().setTarget(null); await next;
  assert.equal(canceled.length, 2);
  assert.equal(store.getState().result, null);
});

test('切換 Agent、模型、範圍及連線狀態會保留既有分析', async () => {
  const report = { agentId: 'a', modelId: 'a-model', text: '原分析' };
  const store = createPodAnalysisStore(api({ analyze: async () => report, listModels: async id => [{ id: id + '-model' }, { id: id + '-other' }] }));
  store.getState().setTarget(target('uid-1'));
  store.getState().setConnections([connection('a'), connection('b')]); await tick();
  await store.getState().analyze();
  await store.getState().selectAgent('b');
  assert.equal(store.getState().result, report);
  store.getState().selectModel('b-other');
  store.getState().setOptions({ includeLogs: false });
  assert.equal(store.getState().result, report);
  store.getState().setConnections([]); await tick();
  assert.equal(store.getState().result, report);
  assert.equal(store.getState().result.agentId, 'a');
});

test('重新開啟 Drawer 還原所屬資源的分析，重建 UID 與其他資源不共用結果', async () => {
  const { createAnalysisSessionCache } = await import('./AnalysisSessionCache.ts');
  const cache = createAnalysisSessionCache();
  const client = api({ analyze: async () => ({ text: 'saved' }) });
  const first = createPodAnalysisStore(client, cache);
  first.getState().setTarget(target('uid-1'));
  first.getState().setConnections([connection('a')]); await tick();
  await first.getState().analyze();
  first.getState().setTarget(null);
  const reopened = createPodAnalysisStore(client, cache);
  reopened.getState().setTarget(target('uid-1'));
  assert.equal(reopened.getState().result.text, 'saved');
  reopened.getState().setTarget(target('uid-2'));
  assert.equal(reopened.getState().result, null);
  reopened.getState().setTarget({ connectedAt: 'connection-1', namespace: 'payments', eventName: 'api', eventUid: 'uid-1' });
  assert.equal(reopened.getState().result, null);
  reopened.getState().setTarget(target('uid-1'));
  assert.equal(reopened.getState().result.text, 'saved');
});

test('接續提問使用原分析與近期對話，保留原報告並記錄各次實際模型', async () => {
  const requests = [];
  const store = createPodAnalysisStore(api({ analyze: async request => { requests.push(request); return { agentId: request.agentId, modelId: request.modelId, text: 'answer-' + requests.length }; } }));
  store.getState().setTarget(target('uid-1'));
  store.getState().setConnections([connection('a'), connection('b')]); await tick();
  await store.getState().analyze();
  await store.getState().selectAgent('b');
  assert.equal(await store.getState().followUp('如何查核？'), true);
  assert.equal(store.getState().result.agentId, 'a');
  assert.equal(store.getState().result.text, 'answer-1');
  assert.equal(store.getState().turns[0].response.agentId, 'b');
  assert.deepEqual(requests[1].messages, [{ role: 'assistant', content: 'answer-1' }, { role: 'user', content: '如何查核？' }]);
  await store.getState().followUp('下一步？');
  assert.deepEqual(requests[2].messages.map(m => m.content), ['answer-1', '如何查核？', 'answer-2', '下一步？']);
  store.getState().setTarget(null);
  store.getState().setTarget(target('uid-1'));
  assert.equal(store.getState().turns.length, 2);
});

test('接續提問失敗或取消不刪除原報告，重新分析才清除原報告與對話', async () => {
  let fail = false, pending;
  const store = createPodAnalysisStore(api({ analyze: async request => {
    if (pending) return pending.promise;
    if (fail) throw new Error('模型暫時無法使用');
    return { text: request.messages ? 'followup' : 'original' };
  } }));
  store.getState().setTarget(target('uid-1'));
  store.getState().setConnections([connection('a')]); await tick();
  await store.getState().analyze();
  await store.getState().followUp('第一題');
  fail = true;
  assert.equal(await store.getState().followUp('第二題'), false);
  assert.equal(store.getState().result.text, 'original');
  assert.equal(store.getState().turns.length, 1);
  pending = deferred();
  const chat = store.getState().followUp('第三題');
  store.getState().cancel(); pending.resolve({ text: 'late answer' }); await chat;
  assert.equal(store.getState().turns.length, 1);
  pending = deferred();
  const rerun = store.getState().analyze();
  assert.equal(store.getState().result, null);
  assert.deepEqual(store.getState().turns, []);
  pending.resolve({ text: 'new analysis' }); await rerun;
  assert.equal(store.getState().result.text, 'new analysis');
});

test('退出叢集清空所有分析並取消進行中的追問，不接受延遲回覆', async () => {
  const { createAnalysisSessionCache, clearAnalysisSessionCache } = await import('./AnalysisSessionCache.ts');
  const cache = createAnalysisSessionCache(), pending = deferred();
  let canceled = 0;
  const store = createPodAnalysisStore(api({ analyze: request => request.messages ? pending.promise : Promise.resolve({ text: 'original' }), cancel: async () => { canceled++; } }), cache);
  const unsubscribe = cache.subscribe(() => store.getState().syncCache());
  store.getState().setTarget(target('uid-1'));
  store.getState().setConnections([connection('a')]); await tick();
  await store.getState().analyze();
  const chat = store.getState().followUp('查核步驟？');
  clearAnalysisSessionCache(cache);
  pending.resolve({ text: 'stale reply' }); await chat;
  assert.equal(canceled, 1);
  assert.equal(store.getState().result, null);
  assert.equal(store.getState().target, null);
  assert.equal(cache.getState().entries.size, 0);
  store.getState().setTarget(target('uid-1'));
  assert.equal(store.getState().result, null);
  unsubscribe();
});

test('Event 的接續提問使用事件 API，保留同一事件 UID', async () => {
  const requests = [];
  const store = createPodAnalysisStore(api({ analyzeEvent: async request => { requests.push(request); return { text: 'event answer' }; } }));
  store.getState().setTarget({ connectedAt: 'connection-1', namespace: 'payments', eventName: 'backoff', eventUid: 'event-1' });
  store.getState().setConnections([connection('a')]); await tick();
  await store.getState().analyze();
  await store.getState().followUp('這個事件代表什麼？');
  assert.equal(requests[1].eventUid, 'event-1');
  assert.equal(requests[1].messages[1].content, '這個事件代表什麼？');
  assert.equal('includeLogs' in requests[1], false);
});

test('保留完整畫面對話，但下一次請求只附上原分析及最近 10 輪', async () => {
  let lastRequest;
  const store = createPodAnalysisStore(api({ analyze: async request => { lastRequest = request; return { text: request.messages ? '回覆' : '原分析' }; } }));
  store.getState().setTarget(target('uid-1'));
  store.getState().setConnections([connection('a')]); await tick();
  await store.getState().analyze();
  for (let i = 0; i < 12; i++) await store.getState().followUp('問題 ' + i);
  assert.equal(store.getState().turns.length, 12);
  assert.equal(lastRequest.messages.length, 22);
  assert.equal(lastRequest.messages[0].content, '原分析');
  assert.equal(lastRequest.messages[1].content, '問題 1');
  assert.equal(lastRequest.messages.at(-1).content, '問題 11');
});

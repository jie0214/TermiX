import assert from 'node:assert/strict';
import test from 'node:test';
import { applyKubernetesChanges } from '../KubernetesLiveState.js';
import { createKubernetesSessionStore } from '../KubernetesSessionStore.js';

const pod = (uid = 'a', phase = 'Running') => ({ uid, name: 'api', namespace: 'default', phase, cpuUsageMilli: 20, memoryUsageBytes: 200 });
const reset = (section, items) => ({ section, type: 'reset', items });
function initial() {
  return applyKubernetesChanges({}, [reset('pods', [pod()]), reset('namespaceDetails', [{ name: 'default' }]), reset('nodes', [{ name: 'node', status: 'Ready', cpuCapacityMilli: 1000, memoryCapacityBytes: 10000 }])]).dashboard;
}

test('即時增刪改更新計數並保留未改變的物件與指標', () => {
  const before = initial();
  const after = applyKubernetesChanges(before, [{ section: 'pods', type: 'MODIFIED', item: { ...pod(), status: 'Ready', cpuUsageMilli: 0 } }]).dashboard;
  assert.equal(after.pods[0].cpuUsageMilli, 20);
  assert.equal(after.nodes, before.nodes);
  assert.equal(after.overview.runningPods, 1);
  const deleted = applyKubernetesChanges(after, [{ section: 'pods', type: 'DELETED', item: pod() }]).dashboard;
  assert.equal(deleted.overview.pods, 0);
  assert.equal(deleted.pods.length, 0);
});

test('同名重建以新 UID 取代，舊 UID 刪除不得移除新 Pod', () => {
  const replaced = applyKubernetesChanges(initial(), [{ section: 'pods', type: 'ADDED', item: pod('b', 'Pending') }]).dashboard;
  const result = applyKubernetesChanges(replaced, [{ section: 'pods', type: 'DELETED', item: pod('a') }]).dashboard;
  assert.equal(result.pods.length, 1);
  assert.equal(result.pods[0].uid, 'b');
  assert.equal(result.overview.pendingPods, 1);
});

test('相同 reset 不重建快照；重連 reset 能清掉離線期間刪除的資源', () => {
  const before = initial();
  assert.equal(applyKubernetesChanges(before, [reset('pods', [pod()])]).dashboard, before);
  assert.equal(applyKubernetesChanges(before, [reset('pods', [])]).dashboard.pods.length, 0);
});

test('指標獨立更新且失敗保留既有值，Watch 錯誤保留資源', () => {
  const before = initial();
  const result = applyKubernetesChanges(before, [{ section: 'metrics', type: 'metrics', items: [{ kind: 'pod', name: 'api', namespace: 'default', cpuUsageMilli: 50, memoryUsageBytes: 500 }] }]);
  assert.equal(result.dashboard.pods[0].cpuUsageMilli, 50);
  assert.equal(result.dashboard.metrics.available, true);
  const failed = applyKubernetesChanges(result.dashboard, [{ section: 'metrics', type: 'metrics', error: 'unavailable' }, { section: 'pods', type: 'status', error: 'reconnecting' }]);
  assert.equal(failed.dashboard.pods, result.dashboard.pods);
  assert.equal(failed.dashboard.metrics.available, false);
  assert.equal(failed.liveErrors.pods, 'reconnecting');
});

test('Store 忽略舊連線、舊訂閱與快照載入期間的事件', () => {
  const store = createKubernetesSessionStore({});
  store.setState({ connectedCluster: { connectedAt: 'new' }, dashboard: initial(), liveStreamId: 'new-stream' });
  const batch = { connectedAt: 'new', streamId: 'new-stream', changes: [reset('pods', [])] };
  const before = store.getState().dashboard;
  store.getState().applyLiveBatch({ ...batch, connectedAt: 'old' });
  store.getState().applyLiveBatch({ ...batch, streamId: 'old-stream' });
  assert.equal(store.getState().dashboard, before);
  store.setState({ dashboardLoading: true });
  store.getState().applyLiveBatch(batch);
  assert.equal(store.getState().dashboard, before);
  store.setState({ dashboardLoading: false });
  store.getState().applyLiveBatch(batch);
  assert.equal(store.getState().dashboard.pods.length, 0);
});

test('背景明細更新保留目前頁籤，舊回應不可覆蓋已關閉 drawer', async () => {
  let resolve;
  const store = createKubernetesSessionStore({ getResourceDetail: () => new Promise(done => { resolve = done; }), getResourceEvents: async () => ({ events: [] }) });
  store.setState({ connectedCluster: { connectedAt: 'new' }, detailOpen: true, detailTab: 'yaml', selectedResource: { kind: 'deployment', name: 'api' }, resourceDetail: { name: 'api', yaml: 'old' } });
  const pending = store.getState().refreshResourceDetail();
  resolve({ name: 'api', yaml: 'new' });
  await pending;
  assert.equal(store.getState().detailTab, 'yaml');
  assert.equal(store.getState().resourceDetail.yaml, 'new');
  const stale = store.getState().refreshResourceDetail();
  store.getState().closeResourceDetail();
  resolve({ name: 'api', yaml: 'stale' });
  await stale;
  assert.equal(store.getState().resourceDetail, null);
});

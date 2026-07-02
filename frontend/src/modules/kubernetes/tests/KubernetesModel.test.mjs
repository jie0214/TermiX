import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertValidKubernetesCluster,
  createKubernetesClusterDraft,
  getAvailableKubernetesUsers,
  normalizeKubernetesCluster,
  normalizeKubernetesClusters,
  validateKubernetesCluster
} from '../KubernetesModel.js';

test('正規化後端欄位與預設值', () => {
  const cluster = normalizeKubernetesCluster({
    context: 'production',
    cluster: 'production-cluster',
    user: 'operator',
    server: 'https://kubernetes.example.com'
  });

  assert.equal(cluster.contextName, 'production');
  assert.equal(cluster.clusterName, 'production-cluster');
  assert.equal(cluster.displayName, 'production');
  assert.equal(cluster.userName, 'operator');
  assert.equal(cluster.namespace, 'default');
  assert.match(cluster.id, /production$/);
});

test('目前 Context 排在其他卡片之前並移除重複 ID', () => {
  const clusters = normalizeKubernetesClusters([
    { id: 'same', displayName: '舊資料', contextName: 'old' },
    { id: 'same', displayName: '測試', contextName: 'test' },
    { id: 'current', displayName: '正式', contextName: 'production', isCurrent: true }
  ]);

  assert.equal(clusters.length, 2);
  assert.equal(clusters[0].id, 'current');
  assert.equal(clusters[1].contextName, 'test');
});

test('新增草稿具有可識別的暫存 ID', () => {
  const draft = createKubernetesClusterDraft();
  assert.match(draft.id, /^k8s_draft_/);
  assert.equal(draft.source, 'managed');
  assert.equal(draft.kubeconfigPath, '~/.kube/config');
});

test('從卡片推導不重複的可用 User', () => {
  assert.deepEqual(getAvailableKubernetesUsers([
    { userName: 'developer' },
    { userName: 'admin' },
    { userName: 'developer' },
    { userName: '' }
  ]), ['admin', 'developer']);
});

test('驗證必要欄位與 API Server 格式', () => {
  const result = validateKubernetesCluster({ server: 'ssh://cluster' });
  assert.equal(result.valid, false);
  assert.equal(result.errors.contextName, '請輸入 Context 名稱。');
  assert.equal(result.errors.server, 'Kubernetes API Server 位址必須使用 HTTP 或 HTTPS。');
  assert.throws(() => assertValidKubernetesCluster(result.value), /請輸入 Context 名稱/);
});

test('拒絕同時設定 CA 與略過 TLS 驗證', () => {
  const result = validateKubernetesCluster({
    displayName: '正式環境',
    contextName: 'production',
    clusterName: 'production-cluster',
    server: 'https://kubernetes.example.com',
    userName: 'admin',
    certificateAuthority: '/tmp/ca.crt',
    insecureSkipTLSVerify: true
  });
  assert.equal(result.valid, false);
  assert.match(result.errors.insecureSkipTLSVerify, /不可同時啟用/);
});

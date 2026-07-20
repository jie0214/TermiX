import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const pageSource = await readFile(new URL('../KubernetesPage.js', import.meta.url), 'utf8');
const hostListSource = await readFile(new URL('../../hostvault/HostListPage.js', import.meta.url), 'utf8');

test('Vault 側邊欄可切換並掛載 Kubernetes 頁面', () => {
  assert.match(hostListSource, /id: 'kubernetes', label: 'Kubernetes'/);
  assert.match(hostListSource, /selectedTab === 'kubernetes'/);
  assert.match(hostListSource, /<kubernetes-page><\/kubernetes-page>/);
});

test('Cluster 卡片包含識別資訊、目前狀態與操作控制', () => {
  for (const field of ['displayName', 'contextName', 'clusterName', 'server', 'namespace']) {
    assert.match(pageSource, new RegExp(`cluster\\.${field}`));
  }
  assert.match(pageSource, /cluster\.isCurrent/);
  assert.match(pageSource, /kubernetes-connect-btn/);
  assert.match(pageSource, /data-cluster-id/);
  assert.match(pageSource, /connectCluster\(cluster\)/);
  assert.match(pageSource, /kubernetes-edit-btn/);
});

test('目前連線的 Cluster 無論是否開啟 Session 都固定顯示於排序結果第一位', () => {
  assert.match(pageSource, /function isConnectedCluster\(cluster, connectedCluster\)/);
  assert.match(pageSource, /const aConnected = isConnectedCluster\(a, connectedCluster\)/);
  assert.match(pageSource, /if \(aConnected !== bConnected\) return aConnected \? -1 : 1/);
  assert.match(pageSource, /if \(Boolean\(a\.isCurrent\) !== Boolean\(b\.isCurrent\)\) return a\.isCurrent \? -1 : 1/);
  assert.match(pageSource, /sortClusters\(list, state\.sortBy, state\.sortDir, kubernetesSessionStore\.getState\(\)\.connectedCluster\)/);
});

test('Drawer 表單提供需求指定的所有欄位', () => {
  for (const field of [
    'displayName',
    'contextName',
    'clusterName',
    'server',
    'userName',
    'namespace',
    'certificateAuthority',
    'insecureSkipTLSVerify',
    'kubeconfigPath'
  ]) {
    assert.match(pageSource, new RegExp(`renderField\\('${field}'`));
  }
  assert.match(pageSource, /validateKubernetesCluster\(this\.formDraft\)/);
  assert.match(pageSource, /saveCluster\(result\.value\)/);
  assert.match(pageSource, /readonly: !isNew/);
});

test('頁面包含載入、錯誤、空資料及搜尋狀態', () => {
  assert.match(pageSource, /state\.isLoading/);
  assert.match(pageSource, /state\.loadError/);
  assert.match(pageSource, /k8s\.page\.noClusters/);
  assert.match(pageSource, /kubernetesSearchInput/);
  assert.match(pageSource, /reloadClusters\(\)/);
});

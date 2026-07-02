import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createResourceTemplate,
  KUBERNETES_CREATE_RESOURCE_GROUPS,
  KUBERNETES_CREATE_RESOURCE_TYPES
} from '../KubernetesResourceTemplates.js';

const expected = new Map([
  ['Pod', ['v1', 'Pod']],
  ['Deployment', ['apps/v1', 'Deployment']],
  ['ReplicaSet', ['apps/v1', 'ReplicaSet']],
  ['ReplicationController', ['v1', 'ReplicationController']],
  ['DaemonSet', ['apps/v1', 'DaemonSet']],
  ['StatefulSet', ['apps/v1', 'StatefulSet']],
  ['Job', ['batch/v1', 'Job']],
  ['CronJob', ['batch/v1', 'CronJob']],
  ['ConfigMap', ['v1', 'ConfigMap']],
  ['Secret', ['v1', 'Secret']],
  ['Service', ['v1', 'Service']],
  ['Ingress', ['networking.k8s.io/v1', 'Ingress']],
  ['NetworkPolicy', ['networking.k8s.io/v1', 'NetworkPolicy']],
  ['PersistentVolumeClaim', ['v1', 'PersistentVolumeClaim']],
  ['ServiceAccount', ['v1', 'ServiceAccount']],
  ['Role', ['rbac.authorization.k8s.io/v1', 'Role']],
  ['RoleBinding', ['rbac.authorization.k8s.io/v1', 'RoleBinding']],
  ['HorizontalPodAutoscaler', ['autoscaling/v2', 'HorizontalPodAutoscaler']],
  ['PodDisruptionBudget', ['policy/v1', 'PodDisruptionBudget']],
  ['ResourceQuota', ['v1', 'ResourceQuota']]
]);

// 具備完整 Pod 樣板（containers/resources）的工作負載型別。
const WORKLOAD_TYPES = ['Pod', 'Deployment', 'ReplicaSet', 'ReplicationController', 'DaemonSet', 'StatefulSet', 'Job', 'CronJob'];

test('Create Resource 選單依單一 registry 衍生的分組排序', () => {
  assert.deepEqual(
    KUBERNETES_CREATE_RESOURCE_GROUPS.map(([group]) => group),
    ['Workloads', 'Config', 'Networking', 'Storage', 'Access Control', 'Autoscaling & Policy']
  );
  assert.deepEqual(KUBERNETES_CREATE_RESOURCE_TYPES, [...expected.keys()]);
});

test('每種 Resource 類型提供正確 API、Kind 與 Namespace 範本', () => {
  for (const [resourceType, [apiVersion, kind]] of expected) {
    const yaml = createResourceTemplate(resourceType, 'monitoring');
    assert.match(yaml, new RegExp(`^apiVersion: ${apiVersion.replace('/', '\\/')}`, 'm'));
    assert.match(yaml, new RegExp(`^kind: ${kind}$`, 'm'));
    assert.match(yaml, /^  namespace: "monitoring"$/m);
  }
});

test('工作負載範本包含資源限制設定', () => {
  for (const resourceType of WORKLOAD_TYPES) {
    const yaml = createResourceTemplate(resourceType, 'default');
    assert.match(yaml, /resources:/);
    assert.match(yaml, /requests:/);
    assert.match(yaml, /limits:/);
  }
});

test('工作負載範本包含安全強化預設', () => {
  for (const resourceType of WORKLOAD_TYPES) {
    const yaml = createResourceTemplate(resourceType, 'default');
    assert.match(yaml, /automountServiceAccountToken: false/, `${resourceType} 缺 automountServiceAccountToken`);
    assert.match(yaml, /runAsNonRoot: true/, `${resourceType} 缺 runAsNonRoot`);
    assert.match(yaml, /seccompProfile:\s*\n\s+type: RuntimeDefault/, `${resourceType} 缺 seccompProfile`);
    assert.match(yaml, /allowPrivilegeEscalation: false/, `${resourceType} 缺 allowPrivilegeEscalation`);
    assert.match(yaml, /drop: \["ALL"\]/, `${resourceType} 缺 capabilities drop`);
    assert.doesNotMatch(yaml, /:latest/, `${resourceType} 使用了 :latest 映像`);
  }
});

test('工作負載範本只包含一個根層級 Resource，不會將完整 Pod 巢狀放入 spec', () => {
  for (const resourceType of WORKLOAD_TYPES) {
    const yaml = createResourceTemplate(resourceType, 'default');
    assert.equal(yaml.match(/^apiVersion:/gm)?.length, 1, `${resourceType} apiVersion 數量錯誤`);
    assert.equal(yaml.match(/^kind:/gm)?.length, 1, `${resourceType} kind 數量錯誤`);
    assert.doesNotMatch(yaml, /^\s+apiVersion:/m, `${resourceType} 含有巢狀 apiVersion`);
    assert.doesNotMatch(yaml, /^\s+kind: (Pod|Deployment|ReplicaSet|ReplicationController|DaemonSet|StatefulSet|Job|CronJob|Service)$/m, `${resourceType} 含有巢狀 kind`);
  }
});

test('每個範本皆為單一根層級 Resource', () => {
  for (const resourceType of KUBERNETES_CREATE_RESOURCE_TYPES) {
    const yaml = createResourceTemplate(resourceType, 'default');
    assert.equal(yaml.match(/^apiVersion:/gm)?.length, 1, `${resourceType} 根層級 apiVersion 數量錯誤`);
    assert.equal(yaml.match(/^kind:/gm)?.length, 1, `${resourceType} 根層級 kind 數量錯誤`);
  }
});

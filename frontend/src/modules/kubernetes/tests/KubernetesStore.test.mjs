import assert from 'node:assert/strict';
import test from 'node:test';
import { KubernetesAPI } from '../KubernetesAPI.js';
import { kubernetesStore } from '../KubernetesStore.js';

test('同名 Context 依卡片 ID 切換正確的 kubeconfig', async (t) => {
  const originalList = KubernetesAPI.listClusters;
  const originalSwitch = KubernetesAPI.switchContext;
  const clusters = [
    {
      id: 'cluster-a',
      displayName: 'A',
      contextName: 'shared',
      clusterName: 'a',
      kubeconfigPath: '/tmp/a-config'
    },
    {
      id: 'cluster-b',
      displayName: 'B',
      contextName: 'shared',
      clusterName: 'b',
      kubeconfigPath: '/tmp/b-config'
    }
  ];
  let request;

  KubernetesAPI.listClusters = async () => clusters;
  KubernetesAPI.switchContext = async (value) => {
    request = value;
  };
  kubernetesStore.setState({ clusters, switchingContext: '', loadError: '' });

  t.after(() => {
    KubernetesAPI.listClusters = originalList;
    KubernetesAPI.switchContext = originalSwitch;
    kubernetesStore.setState({ clusters: [], switchingContext: '', loadError: '' });
  });

  await kubernetesStore.getState().switchContext('cluster-b');

  assert.deepEqual(request, {
    contextName: 'shared',
    kubeconfigPath: '/tmp/b-config'
  });
  assert.equal(kubernetesStore.getState().switchingContext, '');
});

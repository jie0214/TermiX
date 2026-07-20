import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('./HostListPage.js', import.meta.url), 'utf8');

test('Vaults Port Forwarding 顯示並管理 Kubernetes 轉發', () => {
  assert.match(source, /import \{ KubernetesAPI \} from '\.\.\/kubernetes\/KubernetesAPI\.js'/);
  assert.match(source, /async loadKubernetesForwards\(\)/);
  assert.match(source, /KubernetesAPI\.listPodPortForwards\(\{\}\)/);
  assert.match(source, /renderPortForwardingPage\(\)/);
  assert.match(source, /stop-kubernetes-vault-forward/);
  assert.match(source, /KubernetesAPI\.stopPodPortForward\(\{ id \}\)/);
});

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
  assert.match(source, /t\('hostvault\.forward\.title'\)/);
  assert.match(source, /t\('hostvault\.forward\.empty'\)/);
  assert.doesNotMatch(source, /目前 Kubernetes Session 建立的連接埠轉發。/);
});

test('Vaults 對匯入與持久化資料進行 HTML 屬性及文字跳脫', () => {
  assert.match(source, /data-group-id="\$\{escapeHtml\(group\.id\)\}"/);
  assert.match(source, /class="vault-card-title">\$\{escapeHtml\(item\.alias \|\| item\.label\)\}/);
  assert.match(source, /value="\$\{escapeHtml\(drawerHost\.config\?\.host\)\}"/);
  assert.match(source, /value="\$\{escapeHtml\(state\.searchQuery\)\}"/);
  assert.match(source, /data-comp-id="\$\{escapeHtml\(comp\.id\)\}"/);
});

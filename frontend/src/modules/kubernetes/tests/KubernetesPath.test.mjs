import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../KubernetesPath.js', import.meta.url), 'utf8');

test('kubeconfig 預設路徑依 Windows 平台使用 USERPROFILE', () => {
  assert.match(source, /isWindows\(\) \? '%USERPROFILE%\\\\\.kube\\\\config' : '~\/\.kube\/config'/);
});

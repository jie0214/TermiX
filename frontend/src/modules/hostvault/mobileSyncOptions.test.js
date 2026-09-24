import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mobileSyncOptions } from './mobileSyncOptions.js';
const t = key => key;
test('不支援或未設定 iCloud 的建置僅提供檔案匯出', () => {
  for (const capability of ['unsupported', 'not_configured', undefined]) {
    assert.deepEqual(mobileSyncOptions({ capability, enabled: true }, t).map(x=>x.value), ['file']);
  }
});
test('已配置的 Mac 在未登入或離線時仍提供重試', () => {
  for (const error of ['no_account', 'network', '']) {
    assert.deepEqual(mobileSyncOptions({ capability: 'available', enabled: true, error }, t).map(x=>x.value), ['file', 'toggle', 'refresh']);
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { redirectSystemPath } from '../src/app/+native-intent.ts';

test('外部連結僅開固定頁面，不解碼或傳入任意參數', () => {
  for (const path of ['termix://settings', '/settings']) assert.equal(redirectSystemPath({path,initial:true}), '/settings');
  for (const path of ['termix://settings?token=secret', 'termix://'+ '%FF'.repeat(1000), 'https://evil.invalid/settings', '/hosts/authentication?id=1', '/settings#secret', '/settings\\other']) {
    assert.equal(redirectSystemPath({path,initial:false}), '/');
  }
});
test('實際路由依賴可在期限內處理畸形編碼，並保留正常中文', () => {
  const result = spawnSync(process.execPath, ['-e', `
    const assert = require('node:assert/strict');
    const q = require('query-string');
    assert.equal(q.parse('x=%E4%B8%AD+text').x, '中 text');
    q.parse('x=' + '%FF'.repeat(5000));
  `], { cwd: process.cwd(), timeout: 3000, encoding: 'utf8' });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
});

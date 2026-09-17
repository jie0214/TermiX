import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateWebSettings } from './webSettingsMigration.ts';
function storage(initial = {}) {
 const values = new Map(Object.entries(initial));
 return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}
const component = { id: 'original', type: 'function', name: '舊組件' };
const legacy = {
 'termix-custom-components': JSON.stringify([component]),
 'termix-global-settings': '{"theme":"light"}',
 'termix-snippets': '[{"id":"old-script","script":"echo old"}]',
 'termix-session-logs': '[{"id":"log1","output":"old output"}]',
 'control-sidebar-width': '400px',
};
test('舊版直接升級時，組件、偏好、Snippets 與記錄在啟動前還原', async () => {
 const target = storage();
 await migrateWebSettings(target, async () => legacy);
 for (const [key, value] of Object.entries(legacy)) assert.equal(target.getItem(key), value);
});
test('已安裝 v1.8.1 的使用者保留新版設定並補回舊組件與 Snippets', async () => {
 const target = storage({ 'termix-custom-components': '[]', 'termix-global-settings': '{"theme":"dark"}', 'termix-snippets': '[{"id":"new-script"}]' });
 await migrateWebSettings(target, async () => legacy);
 assert.deepEqual(JSON.parse(target.getItem('termix-custom-components')), [component]);
 assert.equal(target.getItem('termix-global-settings'), '{"theme":"dark"}');
 assert.equal(JSON.parse(target.getItem('termix-snippets')).length, 2);
 target.setItem('termix-snippets', '[]');
 await migrateWebSettings(target, async () => legacy);
 assert.equal(target.getItem('termix-snippets'), '[]');
});
test('沒有舊資料與非 macOS 的安裝可正常略過', async () => {
 const target = storage();
 await migrateWebSettings(target, async () => ({}));
 assert.equal(target.getItem('termix-custom-components'), null);
 await migrateWebSettings(storage());
});

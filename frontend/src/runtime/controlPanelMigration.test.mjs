import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateControlPanel } from './controlPanelMigration.ts';
const key = 'termix-custom-components';
const marker = 'termix-control-panel-bundle-migration-v1';
function storage(initial = {}) {
 const values = new Map(Object.entries(initial));
 return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}
test('識別碼切換後空清單會還原舊組件，且不會重複復原已刪除組件', async () => {
 const store = storage({ [key]: '[]' });
 const old = JSON.stringify([{ id: 'saved', type: 'function', name: '原設定' }]);
 await migrateControlPanel(store, async () => old);
 assert.deepEqual(JSON.parse(store.getItem(key)), JSON.parse(old));
 store.setItem(key, '[]');
 await migrateControlPanel(store, async () => old);
 assert.equal(store.getItem(key), '[]');
});
test('遷移保留新版組件及同 ID 修改，並備份新版原始值', async () => {
 const current = JSON.stringify([{ id: 'same', type: 'info', name: '新版' }]);
 const store = storage({ [key]: current });
 await migrateControlPanel(store, async () => JSON.stringify([{ id: 'same', type: 'info', name: '舊版' }, { id: 'missing', type: 'switch' }]));
 assert.equal(JSON.parse(store.getItem(key))[0].name, '新版');
 assert.equal(JSON.parse(store.getItem(key)).length, 2);
 assert.equal(store.getItem(`${marker}-backup`), current);
});
test('舊資料讀取失敗或格式錯誤不得覆寫或標記成功', async () => {
 for (const read of [async () => { throw Error('read failed'); }, async () => '[{"id":"bad"}]']) {
  const store = storage({ [key]: '[]' });
  await assert.rejects(migrateControlPanel(store, read));
  assert.equal(store.getItem(key), '[]');
  assert.equal(store.getItem(marker), null);
 }
});

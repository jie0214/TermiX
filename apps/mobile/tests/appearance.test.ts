import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AppearanceStore } from '../src/features/appearance/store.ts';

test('外觀預設跟隨系統，三種選擇保存後重開恢復', async () => {
  const data = new Map<string, string>();
  const storage = { getItem: async (key: string) => data.get(key) ?? null, setItem: async (key: string, value: string) => { data.set(key, value); } };
  const store = new AppearanceStore(storage);
  await store.initialize();
  assert.equal(store.getSnapshot().mode, 'system');
  for (const mode of ['dark', 'light', 'system'] as const) {
    assert.equal(await store.change(mode), true);
    const restored = new AppearanceStore(storage);
    await restored.initialize();
    assert.equal(restored.getSnapshot().mode, mode);
  }
});

test('無效設定保留原值；寫入失敗不切換外觀，可重試', async () => {
  let value = 'invalid'; let fail = true;
  const store = new AppearanceStore({ getItem: async () => value, setItem: async (_, next) => { if (fail) throw Error(); value = next; } });
  await store.initialize();
  assert.equal(value, 'invalid');
  assert.equal(store.getSnapshot().mode, 'system');
  assert.ok(store.getSnapshot().error);
  assert.equal(await store.change('dark'), false);
  assert.equal(store.getSnapshot().mode, 'system');
  fail = false;
  assert.equal(await store.change('dark'), true);
  assert.equal(value, 'dark');
});

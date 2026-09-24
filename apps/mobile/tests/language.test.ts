import assert from 'node:assert/strict';
import { test } from 'node:test';
import { translate } from '../src/features/language/translate.ts';
import { LanguageStore } from '../src/features/language/store.ts';

test('語言預設繁體中文，切換後重開仍保留選擇',async()=>{
 const data=new Map<string,string>();
 const storage={getItem:async(key:string)=>data.get(key)??null,setItem:async(key:string,value:string)=>{data.set(key,value)}};
 const language=new LanguageStore(storage);
 await language.initialize();assert.equal(language.getSnapshot().locale,'zh-Hant');
 await language.change('en');assert.equal(language.getSnapshot().locale,'en');
 const restored=new LanguageStore(storage);await restored.initialize();assert.equal(restored.getSnapshot().locale,'en');
 await restored.change('ja');assert.equal(restored.getSnapshot().locale,'ja');
});

test('讀取失敗或未知語言回退繁體中文，不覆蓋原始設定', async () => {
  for (const value of ['unsupported', 'read-error']) {
    let writes = 0;
    const store = new LanguageStore({ getItem: async () => { if (value === 'read-error') throw Error(); return value; }, setItem: async () => { writes++; } });
    await store.initialize();
    assert.equal(store.getSnapshot().locale, 'zh-Hant');
    assert.equal(store.getSnapshot().loaded, true);
    assert.ok(store.getSnapshot().error);
    assert.equal(writes, 0);
  }
});

test('保存失敗維持原語言，可重試；等待寫入期間拒絕重複切換', async () => {
  let fail = true;
  let finish: (() => void) | undefined;
  const store = new LanguageStore({ getItem: async () => 'en', setItem: async () => {
    if (fail) throw Error('private storage detail');
    await new Promise<void>(resolve => { finish = resolve; });
  } });
  assert.equal(await store.change('ja'), false);
  await store.initialize();
  assert.equal(await store.change('ja'), false);
  assert.equal(store.getSnapshot().locale, 'en');
  assert.ok(store.getSnapshot().error);
  assert.ok(!store.getSnapshot().error.includes('private'));
  fail = false;
  const pending = store.change('ja');
  assert.equal(store.getSnapshot().locale, 'en');
  assert.equal(store.getSnapshot().saving, true);
  assert.equal(await store.change('zh-Hant'), false);
  finish!();
  assert.equal(await pending, true);
  assert.equal(store.getSnapshot().locale, 'ja');
  assert.equal(store.getSnapshot().error, '');
});

test('翻譯保留參數原文，縮放結果仍明確區分接受與就緒', () => {
  const name = '取消 $& {count}';
  assert.equal(translate('en', '查看 {name}', { name }), `View ${name}`);
  assert.equal(translate('ja', 'unknown raw output'), 'unknown raw output');
  assert.equal(translate('en', '叢集已接受期望副本數 0，不代表已就緒；請重新查詢。'), 'Cluster accepted 0 desired replicas. This does not mean they are ready; query again.');
});

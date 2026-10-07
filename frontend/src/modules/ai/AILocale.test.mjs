import test from 'node:test';
import assert from 'node:assert/strict';
import { setActiveLocale } from '../../i18n/index.ts';
import { AIConnectionAPI } from './AIConnectionAPI.ts';

test('Pod、Event 與追問使用目前介面語言且不改寫提問內容', async () => {
 const previous = globalThis.window;
 const received = [];
 globalThis.window = {go:{app:{App:{AnalyzeKubernetesPod:async r=>received.push(r),AnalyzeKubernetesEvent:async r=>received.push(r)}}}};
 try {
  for (const locale of ['en','ja','zh-Hant']) {
   setActiveLocale(locale);
   const request={requestId:'demo', messages:[{role:'assistant',content:'原分析'},{role:'user',content:'Keep this question unchanged.'}]};
   await AIConnectionAPI.analyze(request);
   await AIConnectionAPI.analyzeEvent(request);
   for (const result of received.splice(0)) {assert.equal(result.locale,locale);assert.deepEqual(result.messages,request.messages);}
   assert.equal(request.locale,undefined);
  }
 } finally {globalThis.window=previous;setActiveLocale('en');}
});

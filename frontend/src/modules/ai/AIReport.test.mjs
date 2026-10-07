import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('');
globalThis.window = window;
const { renderAIReport } = await import('./AIReport.ts');
const render = text => {
  const root = window.document.createElement('div');
  root.innerHTML = renderAIReport(text);
  return root;
};

test('分析 Markdown 呈現標題、清單、粗體、程式碼與表格', () => {
  const root = render('## 根因分析（Root Cause Analysis）\n\n- **證據**：`OOMKilled`\n\n```sh\nkubectl get pod demo\n```\n\n| 欄位 | 值 |\n| --- | --- |\n| exitCode | 137 |');
  assert.equal(root.querySelector('h2')?.textContent, '根因分析（Root Cause Analysis）');
  assert.equal(root.querySelector('li strong')?.textContent, '證據');
  assert.equal(root.querySelector('li code')?.textContent, 'OOMKilled');
  assert.equal(root.querySelector('pre code')?.textContent.trim(), 'kubectl get pod demo');
  assert.equal(root.querySelector('td')?.textContent, 'exitCode');
});

test('模型回覆不得執行 HTML、載入遠端圖片或建立可操作連結', () => {
  const root = render('<script>alert(1)</script><img src="https://example.com/track" onerror="alert(1)"><iframe src="https://example.com"></iframe><svg onload="alert(1)"></svg>\n\n[危險](javascript:alert(1)) [文件](https://example.com) ![圖片](https://example.com/track)');
  assert.equal(root.querySelector('script,img,iframe,svg,a,[onclick],[onerror],[onload]'), null);
  assert.match(root.textContent, /文件/);
});

test('程式碼中的 HTML 保留為文字', () => {
  const root = render('```html\n<img src=x onerror=alert(1)>\n```');
  assert.equal(root.querySelector('pre code')?.textContent.trim(), '<img src=x onerror=alert(1)>');
  assert.equal(root.querySelector('img'), null);
});

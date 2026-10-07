import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { JSDOM } from 'jsdom';

const source = await readFile(new URL('./updateProgress.ts', import.meta.url), 'utf8');
const runnable = stripTypeScriptTypes(source.replace(/^import .*;\n/gm, '').replace(/export /g, ''));
function setup() {
  const dom = new JSDOM('<body></body>');
  const events = new Map();
  const api = new Function('document', 't', 'onWailsEvent', `${runnable}; return {createDownloadProgressWidget,parseDownloadProgress,downloadPercent,registerDownloadProgressListener};`)(dom.window.document, key => key, (event, listener) => events.set(event,listener));
  return {...api, document: dom.window.document, events, dom};
}
const sample = {version:'1.10.0',status:'downloading',receivedBytes:38_600_000,totalBytes:56_800_000};

test('真實容量換算百分比，未知／錯誤總量不顯示推估百分比', () => {
  const api = setup();
  assert.equal(api.downloadPercent(sample),67);
  assert.equal(api.downloadPercent({...sample,totalBytes:0}),null);
  assert.equal(api.downloadPercent({...sample,totalBytes:20}),null);
  for (const value of [null,{}, {...sample,status:'invalid'}, {...sample,receivedBytes:-1}, {...sample,totalBytes:Infinity}]) assert.equal(api.parseDownloadProgress(value),null);
  api.dom.window.close();
});

test('浮動圖示展開／收合，串流更新保留焦點及展開狀態', () => {
  const api = setup(), widget = api.createDownloadProgressWidget();
  widget.update(sample);
  const toggle = api.document.querySelector('.termix-download-toggle');
  assert.equal(toggle.getAttribute('aria-expanded'),'false');
  toggle.click(); toggle.focus();
  widget.update({...sample,receivedBytes:40_000_000});
  assert.equal(toggle.getAttribute('aria-expanded'),'true');
  assert.equal(api.document.activeElement,toggle);
  assert.equal(api.document.querySelector('[role="progressbar"]').getAttribute('aria-valuenow'),'70');
  assert.equal(api.document.querySelector('.termix-download-bytes').textContent,'40.0 MB / 56.8 MB');
  api.document.querySelector('.termix-download-collapse').click();
  assert.equal(toggle.getAttribute('aria-expanded'),'false');
  assert.equal(api.document.activeElement,toggle);
  api.dom.window.close();
});

test('未知容量、驗證、失敗、完成與下一次下載各自正確呈現', () => {
  const api = setup(), widget = api.createDownloadProgressWidget();
  widget.update({...sample,totalBytes:0,receivedBytes:0});
  assert.equal(api.document.querySelector('[role="progressbar"]').hasAttribute('aria-valuenow'),false);
  assert.equal(api.document.querySelector('.is-indeterminate') !== null,true);
  widget.update({...sample,status:'verifying'});
  assert.equal(api.document.querySelector('[role="progressbar"]').hasAttribute('aria-valuenow'),false);
  widget.update({...sample,status:'error'});
  assert.equal(api.document.querySelector('.is-indeterminate'),null);
  assert.equal(api.document.querySelector('.termix-download-dismiss').hidden,false);
  api.document.querySelector('.termix-download-dismiss').click();
  widget.update({...sample,status:'error'});
  assert.equal(api.document.querySelector('aside'),null);
  widget.update(sample);
  assert.notEqual(api.document.querySelector('aside'),null);
  widget.update({...sample,status:'ready'});
  assert.equal(api.document.querySelector('.termix-download-badge').textContent,'100%');
  assert.equal(api.document.querySelector('.termix-download-symbol').textContent,'✓');
  api.dom.window.close();
});

test('實際事件只建立一個元件、移除舊通知且版本字串不注入 HTML', () => {
  const api = setup();
  api.document.body.innerHTML = '<div id="termix-update-notification"></div>';
  api.registerDownloadProgressListener(); api.registerDownloadProgressListener();
  const emit = api.events.get('update-download-progress');
  emit({...sample,version:'<img src=x onerror=alert(1)>'}); emit(sample);
  assert.equal(api.document.querySelectorAll('aside').length,1);
  assert.equal(api.document.querySelector('img'),null);
  assert.equal(api.document.getElementById('termix-update-notification'),null);
  api.dom.window.close();
});

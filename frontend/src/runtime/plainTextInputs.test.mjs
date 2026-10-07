import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { installPlainTextInputs } from './plainTextInputs.ts';

const check = element => {
  for (const name of ['autocomplete', 'autocorrect', 'autocapitalize']) assert.equal(element.getAttribute(name), 'off');
  for (const name of ['spellcheck', 'writingsuggestions']) assert.equal(element.getAttribute(name), 'false');
};

test('既有輸入框停用建議且不改變文字與選取範圍', () => {
  const { window } = new JSDOM('<input value="kubectl --namespace=Prod"><textarea>繁體中文</textarea>');
  const input = window.document.querySelector('input');
  input.setSelectionRange(2, 7);
  const dispose = installPlainTextInputs(window.document);
  window.document.querySelectorAll('input,textarea').forEach(check);
  assert.equal(input.value, 'kubectl --namespace=Prod');
  assert.equal(input.selectionStart, 2);
  assert.equal(input.selectionEnd, 7);
  assert.equal(window.document.querySelector('textarea').value, '繁體中文');
  dispose(); window.close();
});

test('動態表單與立即聚焦欄位套用相同設定', async () => {
  const { window } = new JSDOM('');
  const dispose = installPlainTextInputs(window.document);
  const form = window.document.createElement('form');
  form.innerHTML = '<input><textarea></textarea>';
  window.document.body.append(form);
  form.querySelector('input').focus();
  check(form.querySelector('input'));
  await new Promise(resolve => window.queueMicrotask(resolve));
  check(form.querySelector('textarea'));
  dispose(); window.close();
});

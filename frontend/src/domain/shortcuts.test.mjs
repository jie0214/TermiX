import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SHORTCUT_ACTIONS,
  eventToBinding,
  isValidBinding,
  normalizeShortcutMap,
  matchShortcut,
  resolveShortcuts as resolveAll,
  TAB_INDEX_ACTION_ID,
  bindingToTokens,
  renderBinding,
  resolveBinding,
  resolveShortcuts,
} from './shortcuts.ts';

// 以固定欄位建構假事件，避免依賴瀏覽器 KeyboardEvent。
function keyEvent({ key, code, meta = false, ctrl = false, alt = false, shift = false }) {
  return { key, code, metaKey: meta, ctrlKey: ctrl, altKey: alt, shiftKey: shift };
}

test('eventToBinding 由 code 產生正規字串（字母／數字／符號）', () => {
  assert.equal(eventToBinding(keyEvent({ key: 'c', code: 'KeyC', meta: true })), 'Meta+C');
  assert.equal(
    eventToBinding(keyEvent({ key: 'C', code: 'KeyC', ctrl: true, shift: true })),
    'Ctrl+Shift+C'
  );
  assert.equal(eventToBinding(keyEvent({ key: '1', code: 'Digit1', meta: true })), 'Meta+1');
  // Shift+] 於 US 佈局 key 會變成 "}"，但用 code 仍正規為 "]"。
  assert.equal(
    eventToBinding(keyEvent({ key: '}', code: 'BracketRight', meta: true, shift: true })),
    'Meta+Shift+]'
  );
});

test('eventToBinding 固定修飾鍵順序為 Meta,Ctrl,Alt,Shift', () => {
  assert.equal(
    eventToBinding(keyEvent({ key: 's', code: 'KeyS', shift: true, alt: true, ctrl: true, meta: true })),
    'Meta+Ctrl+Alt+Shift+S'
  );
});

test('eventToBinding 對純修飾鍵或無主要修飾鍵回傳 null', () => {
  assert.equal(eventToBinding(keyEvent({ key: 'Meta', code: 'MetaLeft', meta: true })), null);
  assert.equal(eventToBinding(keyEvent({ key: 'Shift', code: 'ShiftLeft', shift: true })), null);
  // 僅 Shift 不算合法快捷鍵。
  assert.equal(eventToBinding(keyEvent({ key: 'A', code: 'KeyA', shift: true })), null);
  // 無任何修飾鍵。
  assert.equal(eventToBinding(keyEvent({ key: 'a', code: 'KeyA' })), null);
});

test('往返一致：所有註冊表預設皆可由某事件重建', () => {
  // 反向拆綁定 → 造事件 → eventToBinding → 應得回原字串。
  const modFlag = { Meta: 'meta', Ctrl: 'ctrl', Alt: 'alt', Shift: 'shift' };
  const codeFor = (k) => {
    if (/^[A-Z]$/.test(k)) return 'Key' + k;
    if (/^[0-9]$/.test(k)) return 'Digit' + k;
    const rev = { '[': 'BracketLeft', ']': 'BracketRight', '.': 'Period', ',': 'Comma' };
    return rev[k] ?? k;
  };
  for (const action of SHORTCUT_ACTIONS) {
    for (const platform of ['mac', 'other']) {
      const binding = action.defaults[platform];
      assert.ok(isValidBinding(binding), `${action.id}/${platform} 預設須合法：${binding}`);
      const tokens = binding.split('+');
      const key = tokens[tokens.length - 1];
      const ev = { key, code: codeFor(key), metaKey: false, ctrlKey: false, altKey: false, shiftKey: false };
      for (const m of tokens.slice(0, -1)) ev[modFlag[m] + 'Key'] = true;
      assert.equal(eventToBinding(ev), binding, `${action.id}/${platform} 往返不一致`);
    }
  }
});

test('isValidBinding 拒絕停用、缺主鍵、僅 Shift', () => {
  assert.equal(isValidBinding('Meta+C'), true);
  assert.equal(isValidBinding(''), false);
  assert.equal(isValidBinding('Meta'), false);
  assert.equal(isValidBinding('Shift+C'), false);
  assert.equal(isValidBinding('Meta+Ctrl'), false);
});

test('bindingToTokens／renderBinding 依平台渲染', () => {
  assert.deepEqual(bindingToTokens('Meta+Shift+]', 'mac'), ['⌘', '⇧', ']']);
  assert.deepEqual(bindingToTokens('Ctrl+Shift+C', 'other'), ['Ctrl', 'Shift', 'C']);
  assert.deepEqual(bindingToTokens('', 'mac'), []);
  assert.deepEqual(bindingToTokens('Meta+Up', 'mac'), ['⌘', '↑']);
  assert.equal(renderBinding('Meta+C', 'mac'), '⌘ C');
  assert.equal(renderBinding('Ctrl+Shift+C', 'other'), 'Ctrl+Shift+C');
  assert.equal(renderBinding('', 'other'), '');
});

test('resolveBinding：覆寫優先，含空字串停用；否則取平台預設', () => {
  assert.equal(resolveBinding('copy', {}, 'mac'), 'Meta+C');
  assert.equal(resolveBinding('copy', {}, 'other'), 'Ctrl+Shift+C');
  assert.equal(resolveBinding('copy', { copy: 'Meta+Alt+C' }, 'mac'), 'Meta+Alt+C');
  // 明確停用（覆寫為 ""）須勝過預設。
  assert.equal(resolveBinding('copy', { copy: '' }, 'mac'), '');
  // 未知動作回傳空字串。
  assert.equal(resolveBinding('nope', {}, 'mac'), '');
});

test('normalizeShortcutMap：保留已知動作的合法值與停用（""），丟棄其餘', () => {
  const cleaned = normalizeShortcutMap({
    copy: 'Meta+Alt+C', // 合法覆寫 → 保留
    paste: '', // 停用 → 保留
    closeTab: 'Shift+W', // 缺主要修飾鍵 → 丟棄
    nextTab: 123, // 非字串 → 丟棄
    unknownAction: 'Meta+Z', // 未知動作 id → 丟棄
  });
  assert.deepEqual(cleaned, { copy: 'Meta+Alt+C', paste: '' });
});

test('normalizeShortcutMap：非物件輸入回傳空表且不共用參考', () => {
  assert.deepEqual(normalizeShortcutMap(undefined), {});
  assert.deepEqual(normalizeShortcutMap(null), {});
  assert.deepEqual(normalizeShortcutMap('x'), {});
  const a = normalizeShortcutMap({});
  const b = normalizeShortcutMap({});
  assert.notEqual(a, b);
});

test('normalizeShortcutMap 往返：正規化後再正規化不變', () => {
  const once = normalizeShortcutMap({ copy: 'Meta+Alt+C', paste: '', bogus: 'x' });
  assert.deepEqual(normalizeShortcutMap(once), once);
});

test('matchShortcut：一般組合命中對應動作（依平台生效表）', () => {
  const mac = resolveAll({}, 'mac');
  assert.deepEqual(
    matchShortcut(keyEvent({ key: 'c', code: 'KeyC', meta: true }), mac, 'mac'),
    { actionId: 'copy' }
  );
  const other = resolveAll({}, 'other');
  // mac 的 ⌘C 在 other 平台（生效表為 Ctrl+Shift+C）不應命中 copy。
  assert.equal(matchShortcut(keyEvent({ key: 'c', code: 'KeyC', ctrl: true }), other, 'other'), null);
  assert.deepEqual(
    matchShortcut(keyEvent({ key: 'C', code: 'KeyC', ctrl: true, shift: true }), other, 'other'),
    { actionId: 'copy' }
  );
});

test('matchShortcut：覆寫後改以新綁定命中', () => {
  const mac = resolveAll({ copy: '' }, 'mac'); // 停用 copy
  assert.equal(matchShortcut(keyEvent({ key: 'c', code: 'KeyC', meta: true }), mac, 'mac'), null);
});

test('matchShortcut：⌘/Ctrl + 1..9 命中分頁跳轉特例並帶 index', () => {
  const mac = resolveAll({}, 'mac');
  assert.deepEqual(
    matchShortcut(keyEvent({ key: '3', code: 'Digit3', meta: true }), mac, 'mac'),
    { actionId: TAB_INDEX_ACTION_ID, index: 3 }
  );
  const other = resolveAll({}, 'other');
  assert.deepEqual(
    matchShortcut(keyEvent({ key: '1', code: 'Digit1', ctrl: true }), other, 'other'),
    { actionId: TAB_INDEX_ACTION_ID, index: 1 }
  );
  // 帶 Shift/Alt 或錯誤修飾鍵不算分頁跳轉。
  assert.equal(matchShortcut(keyEvent({ key: '3', code: 'Digit3', meta: true, shift: true }), mac, 'mac'), null);
  assert.equal(matchShortcut(keyEvent({ key: '3', code: 'Digit3', ctrl: true }), mac, 'mac'), null);
  // Digit0 不在 1..9 範圍。
  assert.equal(matchShortcut(keyEvent({ key: '0', code: 'Digit0', meta: true }), mac, 'mac'), null);
});

test('matchShortcut：無修飾鍵或無命中回傳 null', () => {
  const mac = resolveAll({}, 'mac');
  assert.equal(matchShortcut(keyEvent({ key: 'a', code: 'KeyA' }), mac, 'mac'), null);
  assert.equal(matchShortcut(keyEvent({ key: 'z', code: 'KeyZ', meta: true }), mac, 'mac'), null);
});

test('resolveShortcuts 產生涵蓋全註冊表的生效表', () => {
  const resolved = resolveShortcuts({ closeTab: 'Meta+Alt+W' }, 'mac');
  assert.equal(Object.keys(resolved).length, SHORTCUT_ACTIONS.length);
  assert.equal(resolved.closeTab, 'Meta+Alt+W');
  assert.equal(resolved.copy, 'Meta+C');
});

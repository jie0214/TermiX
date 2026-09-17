import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../HostListPage.js', import.meta.url), 'utf8');
// 擷取真實載入方法與事件初始化中的載入入口，驗證兩者形成的重繪迴圈。
const loader = source.slice(source.indexOf('  async loadKeychainKeys('), source.indexOf('  // 從後端讀取 known_hosts'));
const listenerStart = source.indexOf("// 15. Keychain Tab");
const initialization = source.slice(source.indexOf("    if (selectedTab === 'keychain') {", listenerStart), source.indexOf("      this.querySelector('#reloadKeychainBtn')", listenerStart)) + '\n}';

test('金鑰清單載入失敗後重繪不會自動重試；明確重新整理可重試', async () => {
  let requests = 0;
  const pending = [];
  const KeychainAPI = { list: async () => { requests++; throw new Error('後端未連線'); } };
  const hostStore = { getState: () => ({ selectedTab: 'keychain' }) };
  const context = { keychainLoading: false, keychainLoaded: false, keychainLoadError: '', render() {} };
  const implementation = new Function('KeychainAPI', 'hostStore', 'showToast', 't', 'return ({' + loader + '});')(KeychainAPI, hostStore, () => {}, key => key);
  context.loadKeychainKeys = (...args) => {
    // 限制錯誤版本的迴圈，讓測試能回報而不耗盡記憶體。
    if (requests >= 4) return Promise.resolve();
    const request = implementation.loadKeychainKeys.apply(context, args);
    pending.push(request);
    return request;
  };
  context.setupListeners = new Function('selectedTab', initialization).bind(context, 'keychain');
  context.setupListeners();
  while (pending.length) await pending.shift();
  assert.equal(requests, 1, '失敗後不應因重繪重複呼叫後端');
  await context.loadKeychainKeys(true);
  assert.equal(requests, 2, '使用者重新整理時應允許重試');
});

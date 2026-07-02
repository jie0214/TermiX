// TermiX Settings store 沙盒測試
// 驗證 Theme 與 Terminal Text Size 會保存於同一份設定。

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sourcePath = path.join(__dirname, '..', 'frontend', 'src', 'stores', 'ThemeStore.js');
const source = fs.readFileSync(sourcePath, 'utf8')
  .replace(/^import .*;\n/gm, '')
  .replace(/\bexport\s+(?=function\s+)/g, '')
  .replace(/\bexport\s+const\s+themeStore\s*=/, 'const themeStore =')
  + '\nthis.themeStore = themeStore;';

const localStorageMock = (() => {
  const data = new Map();
  return {
    getItem: (key) => data.has(key) ? data.get(key) : null,
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
    clear: () => data.clear()
  };
})();

function createStore(factory) {
  let state = {};
  const listeners = new Set();
  const set = (partial) => {
    const prev = state;
    state = { ...state, ...(typeof partial === 'function' ? partial(state) : partial) };
    listeners.forEach(listener => listener(state, prev));
  };
  const get = () => state;
  state = factory(set, get);
  return {
    getState: get,
    setState: set,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
}

const rootClasses = new Set();
const sandbox = {
  console,
  createStore,
  window: {
    matchMedia: () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {}
    })
  },
  HostAPI: {
    getAppSettings: async () => { throw new Error('mock backend unavailable'); },
    saveAppSettings: async () => ({ ok: true })
  },
  localStorage: localStorageMock,
  document: {
    documentElement: {
      classList: {
        remove: (...names) => names.forEach(name => rootClasses.delete(name)),
        add: (name) => rootClasses.add(name),
        toggle: (name, enabled) => enabled ? rootClasses.add(name) : rootClasses.delete(name)
      }
    }
  }
};

vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: sourcePath });

function assertEqual(actual, expected, message) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    console.error(`FAIL: ${message}`);
    console.error(`  expected: ${expectedJson}`);
    console.error(`  actual:   ${actualJson}`);
    process.exit(1);
  }
  console.log(`PASS: ${message}`);
}

assertEqual(sandbox.normalizeTerminalTextSize(8), 9, 'Text Size 低於下限時會修正為 9');
assertEqual(sandbox.normalizeTerminalTextSize(25), 24, 'Text Size 高於上限時會修正為 24');
assertEqual(sandbox.normalizeTerminalTextSize(13.24), 13, 'Text Size 會四捨五入到 0.5 階');
assertEqual(sandbox.normalizeTerminalTextSize(13.26), 13.5, 'Text Size 可使用 0.5 階');

(async () => {
  localStorageMock.setItem('termix-global-settings', JSON.stringify({ theme: 'forest' }));
  await sandbox.themeStore.getState().loadSettings();
  assertEqual(sandbox.themeStore.getState().theme, 'forest', '舊設定可載入 Theme');
  assertEqual(sandbox.themeStore.getState().terminalTextSize, 12.5, '舊設定缺少 Text Size 時會套用預設值');
  assertEqual(sandbox.themeStore.getState().localTerminalPath, '/bin/zsh', '舊設定缺少 Local Terminal Path 時會套用預設值');
  assertEqual(rootClasses.has('theme-forest'), true, '載入 Theme 時會套用文件 class');

  await sandbox.themeStore.getState().saveSettings({ theme: 'tahoe', terminalTextSize: 15.4, localTerminalPath: ' /bin/bash ' });
  const saved = JSON.parse(localStorageMock.getItem('termix-global-settings'));
  assertEqual(saved, { theme: 'tahoe', terminalTextSize: 15.5, localTerminalPath: '/bin/bash' }, 'Settings 會同時保存 Theme、Text Size 與 Local Terminal Path');
  assertEqual(rootClasses.has('theme-tahoe'), true, 'Tahoe Theme 會套用文件 class');

  await sandbox.themeStore.getState().setTheme('dark');
  const savedAfterTheme = JSON.parse(localStorageMock.getItem('termix-global-settings'));
  assertEqual(savedAfterTheme.terminalTextSize, 15.5, '單獨更新 Theme 不會覆蓋 Text Size');
  assertEqual(savedAfterTheme.localTerminalPath, '/bin/bash', '單獨更新 Theme 不會覆蓋 Local Terminal Path');

  console.log('=== Settings store 沙盒測試通過 ===');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

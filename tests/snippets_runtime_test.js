// TermiX SnippetRuntime 沙盒測試
// 驗證 Snippet Paste/Run、startup snippets 與 target 查詢行為。

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const storePath = path.join(__dirname, '..', 'frontend', 'src', 'modules', 'snippets', 'SnippetStore.js');
const runtimePath = path.join(__dirname, '..', 'frontend', 'src', 'modules', 'snippets', 'SnippetRuntime.js');
if (!fs.existsSync(storePath) || !fs.existsSync(runtimePath)) {
  console.log('SKIP: SnippetStore.js 或 SnippetRuntime.js 尚未存在，需正式 Snippets runtime API 後才能驗證 Paste/Run、startup snippets 與 target 查詢。');
  process.exit(0);
}

const storeSource = fs.readFileSync(storePath, 'utf8')
  .replace(/^import .*;\n/gm, '')
  .replace(/\bexport\s+(?=function\s+)/g, '')
  .replace(/\bexport\s+const\s+SNIPPETS_KEY\s*=/, 'const SNIPPETS_KEY =')
  .replace(/\bexport\s+const\s+SNIPPET_PACKAGES_KEY\s*=/, 'const SNIPPET_PACKAGES_KEY =')
  .replace(/\bexport\s+const\s+snippetStore\s*=/, 'const snippetStore =')
  + '\nObject.assign(this, { snippetStore, toTerminalPayload });';
const runtimeSource = fs.readFileSync(runtimePath, 'utf8')
  .replace(/^import .*;\n/gm, '')
  .replace(/\bexport\s+(?=(async\s+)?function\s+)/g, '')
  + '\nObject.assign(this, { isLocalSession, pasteSnippetToSession, runSnippetInSession, runStartupSnippets, getHostSnippetTargets });';

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

const localStorageMock = (() => {
  const data = new Map();
  return {
    getItem: (key) => data.has(key) ? data.get(key) : null,
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
    clear: () => data.clear()
  };
})();

const calls = [];
const terminalState = {
  sessions: {
    'local-1': { isLocal: true, config: { isLocal: true } },
    'ssh-1': { config: { host: '10.0.0.8' } }
  }
};
const sandbox = {
  console,
  createStore,
  localStorage: localStorageMock,
  TerminalAPI: {
    writeTerminalInput: async (...args) => {
      calls.push(['writeTerminalInput', ...args]);
      return { success: true };
    },
    executeSessionCommand: async (...args) => {
      calls.push(['executeSessionCommand', ...args]);
      return { success: true, output: 'session ok' };
    },
    executeSessionCommandIsolated: async (...args) => {
      calls.push(['executeSessionCommandIsolated', ...args]);
      return { success: true, output: 'remote ok' };
    }
  },
  terminalStore: {
    getState: () => terminalState
  }
};

vm.createContext(sandbox);
vm.runInContext(storeSource, sandbox, { filename: storePath });
vm.runInContext(runtimeSource, sandbox, { filename: runtimePath });

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

async function runAsyncTests() {
  const snippet = { id: 'snip-a', script: 'echo "hello"\n' };

  assertEqual(await sandbox.pasteSnippetToSession('', snippet), {
    success: false,
    error: 'Snippet 或 Terminal session 不存在'
  }, 'Paste 缺 sessionKey 時會回傳錯誤');

  await sandbox.pasteSnippetToSession('local-1', snippet);
  assertEqual(
    calls.pop(),
    ['writeTerminalInput', 'local-1', 'echo "hello"\n'],
    'Paste 會把原始 payload 寫入 Terminal'
  );

  await sandbox.runSnippetInSession('local-1', { id: 'snip-b', script: 'uptime' });
  assertEqual(
    calls.pop(),
    ['writeTerminalInput', 'local-1', 'uptime\n'],
    'Local Run 會透過目前 session 的 PTY stdin 執行'
  );

  const remoteResult = await sandbox.runSnippetInSession('ssh-1', { id: 'snip-c', script: 'df -h' });
  assertEqual(remoteResult, { success: true }, 'Remote Run 會回傳寫入目前 session 的執行結果');
  assertEqual(
    calls.pop(),
    ['writeTerminalInput', 'ssh-1', 'df -h\n'],
    'Remote Run 會透過目前 session 的 PTY stdin 執行並補換行'
  );

  sandbox.snippetStore.getState().setSnippets([
    { id: 'startup-b', script: 'free -h', order: 20 },
    { id: 'startup-a', script: 'df -h', order: 10 }
  ]);
  calls.length = 0;
  const startupResults = await sandbox.runStartupSnippets('ssh-1', ['startup-b', '', 'startup-a']);
  assertEqual(startupResults.length, 2, 'Startup snippets 會略過空 ID 並執行符合項目');
  assertEqual(
    calls,
    [
      ['writeTerminalInput', 'ssh-1', 'df -h\n'],
      ['writeTerminalInput', 'ssh-1', 'free -h\n']
    ],
    'Startup snippets 會依 store 內排序執行'
  );

  assertEqual(
    sandbox.getHostSnippetTargets({ targetHostIds: ['host-2', 'host-1'] }, [
      { id: 'host-1', label: 'A' },
      { id: 'host-2', label: 'B' },
      { id: 'host-3', label: 'C' }
    ]),
    [
      { id: 'host-1', label: 'A' },
      { id: 'host-2', label: 'B' }
    ],
    '批次 target 查詢會回傳已保存 target 主機'
  );
}

runAsyncTests()
  .then(() => {
    console.log('=== SnippetRuntime 沙盒測試通過 ===');
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

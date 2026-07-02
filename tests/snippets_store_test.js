// TermiX SnippetStore 沙盒測試
// 驗證 snippet/package CRUD、批次 target 保存、資料清洗與排序。

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sourcePath = path.join(__dirname, '..', 'frontend', 'src', 'modules', 'snippets', 'SnippetStore.js');
if (!fs.existsSync(sourcePath)) {
  console.log('SKIP: SnippetStore.js 尚未存在，需正式 Snippets store API 後才能驗證 CRUD、target 保存與清洗排序。');
  process.exit(0);
}

const source = fs.readFileSync(sourcePath, 'utf8')
  .replace(/^import .*;\n/gm, '')
  .replace(/\bexport\s+(?=function\s+)/g, '')
  .replace(/\bexport\s+const\s+SNIPPETS_KEY\s*=/, 'const SNIPPETS_KEY =')
  .replace(/\bexport\s+const\s+SNIPPET_PACKAGES_KEY\s*=/, 'const SNIPPET_PACKAGES_KEY =')
  .replace(/\bexport\s+const\s+snippetStore\s*=/, 'const snippetStore =')
  + '\nObject.assign(this, { SNIPPETS_KEY, SNIPPET_PACKAGES_KEY, createSnippetId, normalizeSnippetPackage, normalizeSnippet, toTerminalPayload, snippetStore });';

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

const sandbox = {
  console,
  createStore,
  localStorage: localStorageMock,
  Date,
  Math
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

localStorageMock.setItem('termix-snippet-packages', JSON.stringify([
  { id: 'pkg-z', name: '  Zeta  ', order: 20 },
  { id: 'pkg-a', name: 'Alpha', order: 10 },
  { id: '', name: '', order: 'bad' }
]));
localStorageMock.setItem('termix-snippets', JSON.stringify([
  {
    id: 'snip-b',
    name: '  Memory Check  ',
    description: ' check memory ',
    script: 'free -h\r\n',
    packageId: 'pkg-z',
    targetHostIds: ['host-2', '', 'host-1'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    order: 30
  },
  {
    id: 'snip-a',
    name: '',
    description: 'Disk usage',
    script: 'df -h',
    packageId: '',
    targetHostIds: 'host-3',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    order: 10
  }
]));

sandbox.snippetStore.getState().loadSnippets();

assertEqual(
  sandbox.snippetStore.getState().packages.map(pkg => ({ id: pkg.id, name: pkg.name, order: pkg.order })),
  [
    { id: sandbox.snippetStore.getState().packages[0].id, name: 'Default Package', order: 2 },
    { id: 'pkg-a', name: 'Alpha', order: 10 },
    { id: 'pkg-z', name: 'Zeta', order: 20 }
  ],
  'Package 載入時會清洗名稱並依 order 排序'
);

assertEqual(
  sandbox.snippetStore.getState().snippets.map(snippet => ({
    id: snippet.id,
    name: snippet.name,
    script: snippet.script,
    targetHostIds: snippet.targetHostIds,
    order: snippet.order
  })),
  [
    { id: 'snip-a', name: 'Disk usage', script: 'df -h', targetHostIds: [], order: 10 },
    { id: 'snip-b', name: 'Memory Check', script: 'free -h\n', targetHostIds: ['host-2', 'host-1'], order: 30 }
  ],
  'Snippet 載入時會清洗名稱、換行、targetHostIds 並排序'
);

const packageCreated = sandbox.snippetStore.getState().addPackage('Ops Package');
assertEqual(
  sandbox.snippetStore.getState().packages.find(pkg => pkg.id === packageCreated.id).name,
  'Ops Package',
  'Package 可新增並保存'
);

const packageUpdated = sandbox.snippetStore.getState().updatePackage(packageCreated.id, { name: 'Ops Scripts' });
assertEqual(
  packageUpdated.name,
  'Ops Scripts',
  'Package 可更新名稱'
);

const created = sandbox.snippetStore.getState().upsertSnippet({
  name: 'Docker Status',
  description: 'docker containers',
  script: 'docker ps --format "table {{.Names}}\\t{{.Status}}\\t{{.Ports}}"',
  packageId: packageCreated.id,
  targetHostIds: ['host-1']
});
assertEqual(
  {
    name: created.name,
    script: created.script,
    packageId: created.packageId,
    targetHostIds: created.targetHostIds
  },
  {
    name: 'Docker Status',
    script: 'docker ps --format "table {{.Names}}\\t{{.Status}}\\t{{.Ports}}"',
    packageId: packageCreated.id,
    targetHostIds: ['host-1']
  },
  'Snippet 可新增並保存腳本'
);

const updated = sandbox.snippetStore.getState().upsertSnippet({
  ...created,
  script: 'uptime',
  targetHostIds: ['host-2']
});
assertEqual(
  sandbox.snippetStore.getState().snippets.find(snippet => snippet.id === updated.id).script,
  'uptime',
  'Snippet 可更新既有資料'
);

sandbox.snippetStore.getState().saveTargets(updated.id, ['host-3', '', 'host-4']);
assertEqual(
  sandbox.snippetStore.getState().snippets.find(snippet => snippet.id === updated.id).targetHostIds,
  ['host-3', 'host-4'],
  '批次 target 保存時會清除空值'
);

sandbox.snippetStore.getState().deletePackage(packageUpdated.id);
assertEqual(
  sandbox.snippetStore.getState().snippets.find(snippet => snippet.id === updated.id).packageId,
  '',
  '刪除 Package 後會將 Snippet 移回未分類'
);

sandbox.snippetStore.getState().deleteSnippet(updated.id);
assertEqual(
  sandbox.snippetStore.getState().snippets.some(snippet => snippet.id === updated.id),
  false,
  'Snippet 可刪除'
);

assertEqual(sandbox.toTerminalPayload('echo hi', 'paste'), 'echo hi', 'Paste payload 不自動補換行');
assertEqual(sandbox.toTerminalPayload('echo hi', 'run'), 'echo hi\n', 'Run payload 會補結尾換行');

console.log('=== SnippetStore 沙盒測試通過 ===');

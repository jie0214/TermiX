// TermiX HostStore migration sandbox test
// 驗證舊 Host localStorage 會遷移到後端，並清除前端主資料來源。

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const modelPath = path.join(__dirname, '..', 'frontend', 'src', 'modules', 'hostvault', 'HostVaultModel.js');
const storePath = path.join(__dirname, '..', 'frontend', 'src', 'modules', 'hostvault', 'HostStore.js');

const modelSource = fs.readFileSync(modelPath, 'utf8')
  .replace(/\bexport\s+const\s+([A-Z0-9_]+)\s*=/g, 'const $1 =')
  .replace(/\bexport\s+(?=function\s+)/g, '')
  + `
this.createHostProfile = createHostProfile;
this.ensureSecretRefs = ensureSecretRefs;
this.getAvailableControlPanelIds = getAvailableControlPanelIds;
this.getHostSecretStatusMap = getHostSecretStatusMap;
this.getSecretMask = getSecretMask;
this.normalizeVaultData = normalizeVaultData;
`;

const storeSource = fs.readFileSync(storePath, 'utf8')
  .replace(/import[\s\S]*?from\s+['"][^'"]+['"];\n/g, '')
  .replace(/\bexport\s+const\s+hostStore\s*=/, 'const hostStore =')
  + '\nthis.hostStore = hostStore;';

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

const backendVault = { hosts: [], groups: [] };
let appSettings = {};
const savedSecrets = [];

const sandbox = {
  console,
  createStore,
  localStorage: localStorageMock,
  window: {
    confirm: () => true
  },
  HostAPI: {
    loadHostVault: async () => backendVault,
    getAppSettings: async () => appSettings,
    saveAppSettings: async (settings) => {
      appSettings = { ...appSettings, ...settings };
      return appSettings;
    },
    getHostSecretStatus: async (hostId) => ({
      hostId,
      sshPassword: {
        ref: `host/${hostId}/ssh-password`,
        configured: true,
        stored: true,
        length: 10
      },
      keyPassphrase: {
        ref: `host/${hostId}/key-passphrase`,
        configured: true,
        stored: false,
        length: 0
      },
      sudoPassword: {
        ref: `host/${hostId}/sudo-password`,
        configured: true,
        stored: true,
        length: 11
      },
      overallHealthy: true
    }),
    saveGroup: async (group) => {
      backendVault.groups.push(group);
      return group;
    },
    saveHost: async (host, secretsPayload) => {
      backendVault.hosts.push(host);
      savedSecrets.push({ hostId: host.id, secretsPayload });
      return host;
    },
    deleteHost: async () => null,
    deleteGroup: async () => null
  }
};

vm.createContext(sandbox);
vm.runInContext(modelSource, sandbox, { filename: modelPath });
vm.runInContext(storeSource, sandbox, { filename: storePath });

localStorageMock.setItem('termix-custom-components', JSON.stringify([
  { id: 'snippet-alpha', type: 'function', name: 'Snippet Alpha' },
  { id: 'snippet-beta', type: 'switch', name: 'Snippet Beta' }
]));

localStorageMock.setItem('termix-connection-history', JSON.stringify([
  {
    id: 'host-1',
    label: 'Primary Host',
    config: {
      host: '10.0.0.8',
      username: 'deploy',
      authMode: 'password',
      password: 'ssh-secret',
      sudoPassword: 'sudo-secret',
      groupId: 'missing-group',
      startupSnippetIds: ['snippet-alpha', '', null, 'snippet-beta'],
      customComponents: [
        { id: 'snippet-beta', visible: true, order: 20 },
        { id: 'snippet-alpha', visible: true, order: 10 }
      ]
    }
  }
]));

(async () => {
  await sandbox.hostStore.getState().loadFromBackend();

  const loadedHost = sandbox.hostStore.getState().hosts[0];
  assertEqual(loadedHost.config.startupSnippetIds, ['snippet-alpha', 'snippet-beta'], '遷移後 Host startupSnippetIds 會清除空值並保留順序');
  assertEqual(loadedHost.config.customComponents, [
    { id: 'snippet-alpha', visible: true, order: 0 },
    { id: 'snippet-beta', visible: true, order: 1 }
  ], '遷移後掛載項目會依 order 重新排序');
  assertEqual(Boolean(loadedHost.config.password), false, '遷移後前端 Host config 不保留 password');
  assertEqual(Boolean(loadedHost.config.sudoPassword), false, '遷移後前端 Host config 不保留 sudoPassword');
  assertEqual(loadedHost.groupId, null, '遷移時不存在的 groupId 會改為未分類');
  assertEqual(localStorageMock.getItem('termix-connection-history'), null, '遷移成功後移除舊 Host localStorage 主資料');
  assertEqual(appSettings.hostVaultMigrationVersion, 1, '遷移成功後寫入 HostVault migration version');
  assertEqual(savedSecrets[0].secretsPayload.sshPassword.hasValue, true, 'legacy SSH password 會轉為後端 secret DTO');
  assertEqual(savedSecrets[0].secretsPayload.sudoPassword.hasValue, true, 'legacy sudoPassword 會轉為後端 secret DTO');
  assertEqual(sandbox.getSecretMask({ stored: true, length: 8 }), '********', '已儲存密碼會依長度產生遮罩');
  assertEqual(sandbox.getHostSecretStatusMap({
    id: 'host-empty-ref',
    config: { secretRefs: { sshPasswordRef: 'host/host-empty-ref/ssh-password' } }
  }).sshPassword.status, 'unset', '只有 secret reference 不會被推定為已儲存密碼');
  const savedAfterPasswordEdit = await sandbox.hostStore.getState().saveHost({
    hostId: loadedHost.id,
    sourceHost: loadedHost,
    overrides: loadedHost,
    secretsPayload: {
      sshPassword: {
        ref: loadedHost.config.secretRefs.sshPasswordRef,
        value: 'new-secret',
        hasValue: true,
        clear: false
      }
    }
  });
  assertEqual(savedSecrets[1].secretsPayload.sshPassword.hasValue, true, 'Edit Host 密碼輸入後會送出 secret 寫入 payload');
  assertEqual(savedAfterPasswordEdit.secretStatus.sshPassword.status, 'stored', 'Edit Host 密碼儲存後會重新載入已儲存狀態');
  assertEqual(sandbox.getSecretMask(savedAfterPasswordEdit.secretStatus.sshPassword), '**********', '重新進入 Edit Host 時會依後端長度顯示 SSH password 遮罩');
  assertEqual(sandbox.getSecretMask(savedAfterPasswordEdit.secretStatus.sudoPassword), '***********', '重新進入 Edit Host 時會依後端長度顯示 sudo password 遮罩');
  sandbox.hostStore.getState().setSelectedHost({
    ...savedAfterPasswordEdit,
    secretStatus: {
      sshPassword: { status: 'unset', stored: false, length: 0 }
    }
  });
  const refreshedHost = await sandbox.hostStore.getState().refreshHostSecretStatus(savedAfterPasswordEdit.id);
  assertEqual(refreshedHost.secretStatus.sshPassword.status, 'stored', '重新開啟 Edit Host 時會強制刷新 SSH password 狀態');
  assertEqual(sandbox.hostStore.getState().selectedHost.secretStatus.sshPassword.status, 'stored', '目前編輯中的 Host 也會同步刷新 secret 狀態');

  console.log('=== HostStore migration 沙盒測試通過 ===');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

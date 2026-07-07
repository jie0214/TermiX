// TermiX HostAPI 沙盒測試
// 驗證 Host Vault API 會透過共用 Wails facade 呼叫並解析 OperationResult。

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sourcePath = path.join(__dirname, '..', 'frontend', 'src', 'modules', 'hostvault', 'HostAPI.js');
const source = fs.readFileSync(sourcePath, 'utf8')
  .replace(/^import[\s\S]*?from\s+['"].*?['"];\n/, '')
  .replace(/\bexport\s+const\s+HostAPI\s*=/, 'const HostAPI =')
  + '\nthis.HostAPI = HostAPI;';

const calls = [];
const appBindings = {};

function operationResult(output = '', success = true, error = '') {
  return {
    success,
    output,
    error,
    sessionKey: '',
    isSudo: false
  };
}

function setBinding(methodName, handler) {
  appBindings[methodName] = (...args) => {
    calls.push([methodName, ...args]);
    return handler(...args);
  };
}

function clearBindings() {
  Object.keys(appBindings).forEach((methodName) => {
    delete appBindings[methodName];
  });
}

const sandbox = {
  console,
  getAppBinding: (methodName) => appBindings[methodName],
  requireAppBinding: (methodName) => {
    const binding = appBindings[methodName];
    if (typeof binding !== 'function') {
      throw new Error(`缺少後端 API：${methodName}`);
    }
    return binding;
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

(async () => {
  clearBindings();
  setBinding('ListHostVault', async () =>
    operationResult(JSON.stringify({
      hosts: [{ id: 'host-1' }],
      groups: [{ id: 'group-1' }]
    }))
  );
  const vault = await sandbox.HostAPI.loadHostVault();
  assertEqual(
    vault,
    { hosts: [{ id: 'host-1' }], groups: [{ id: 'group-1' }] },
    '新版 ListHostVault 會經 facade 載入並解析 Vault'
  );

  clearBindings();
  setBinding('ListHosts', async () =>
    operationResult(JSON.stringify([{ id: 'host-fallback' }]))
  );
  setBinding('ListHostGroups', async () =>
    operationResult(JSON.stringify([{ id: 'group-fallback' }]))
  );
  const fallbackVault = await sandbox.HostAPI.loadHostVault();
  assertEqual(
    fallbackVault,
    {
      hosts: [{ id: 'host-fallback' }],
      groups: [{ id: 'group-fallback' }]
    },
    '缺少聚合方法時會透過個別 Host 與 Group 方法載入'
  );

  clearBindings();
  setBinding('GetHostSecretValue', async (request) =>
    operationResult(JSON.stringify({
      ...request,
      value: 'secret',
      found: true
    }))
  );
  const secret = await sandbox.HostAPI.getHostSecretValue('host-2', 'sudoPassword');
  assertEqual(
    secret,
    {
      hostId: 'host-2',
      field: 'sudoPassword',
      value: 'secret',
      found: true
    },
    'Secret Value 查詢會傳入具名 request 物件'
  );

  clearBindings();
  setBinding('RemoveKnownHost', async () => operationResult());
  await sandbox.HostAPI.removeKnownHost('10.20.30.40', 22022);
  assertEqual(
    calls.pop(),
    ['RemoveKnownHost', '10.20.30.40', 22022],
    'Known Host 重置會透過 Host API facade 呼叫'
  );

  clearBindings();
  const integration = {
    groupId: 'group-aws',
    name: 'Production',
    region: 'ap-northeast-1'
  };
  const secrets = {
    secretAccessKey: { value: 'secret-key', hasValue: true },
    defaultPassword: { value: '', hasValue: false }
  };
  setBinding('SaveAWSIntegration', async (value) =>
    operationResult(JSON.stringify(value))
  );
  const savedIntegration = await sandbox.HostAPI.saveAWSIntegration(
    integration,
    secrets,
    'group-old'
  );
  assertEqual(savedIntegration, integration, 'AWS Integration 會解析後端保存結果');
  assertEqual(
    calls.pop(),
    ['SaveAWSIntegration', integration, secrets, 'group-old'],
    'AWS Integration 會保留 secrets 與 previousGroupId 參數'
  );

  clearBindings();
  setBinding('SyncAWSIntegration', async (groupId) =>
    operationResult(JSON.stringify({ groupId, synced: true }))
  );
  const syncResult = await sandbox.HostAPI.syncAWSIntegration('group-legacy');
  assertEqual(
    syncResult,
    { groupId: 'group-legacy', synced: true },
    '舊版 SyncAWSIntegration 方法仍可透過 fallback 使用'
  );

  clearBindings();
  const gcpIntegration = {
    groupId: 'group-gcp',
    name: 'GCP Production',
    projectId: 'demo-project'
  };
  const gcpSecrets = {
    serviceAccountJson: { value: '{"type":"service_account"}', hasValue: true },
    defaultPassword: { value: '', hasValue: false }
  };
  setBinding('SaveGCPIntegration', async (value) =>
    operationResult(JSON.stringify(value))
  );
  const savedGcpIntegration = await sandbox.HostAPI.saveGCPIntegration(
    gcpIntegration,
    gcpSecrets,
    'group-old'
  );
  assertEqual(savedGcpIntegration, gcpIntegration, 'GCP Integration 會解析後端保存結果');
  assertEqual(
    calls.pop(),
    ['SaveGCPIntegration', gcpIntegration, gcpSecrets, 'group-old'],
    'GCP Integration 會保留 secrets 與 previousGroupId 參數'
  );

  clearBindings();
  setBinding('SyncGCPIntegration', async (groupId) =>
    operationResult(JSON.stringify({ groupId, synced: true }))
  );
  const gcpSyncResult = await sandbox.HostAPI.syncGCPIntegration('group-gcp-legacy');
  assertEqual(
    gcpSyncResult,
    { groupId: 'group-gcp-legacy', synced: true },
    '舊版 SyncGCPIntegration 方法仍可透過 fallback 使用'
  );

  clearBindings();
  setBinding('DeleteHost', async () =>
    operationResult('', false, '主機不存在')
  );
  let errorMessage = '';
  try {
    await sandbox.HostAPI.deleteHost('missing-host');
  } catch (error) {
    errorMessage = error.message;
  }
  assertEqual(errorMessage, '主機不存在', 'OperationResult 失敗會拋出後端錯誤');

  clearBindings();
  setBinding('SaveBackupFile', async (...args) => operationResult(args.join('|')));
  await sandbox.HostAPI.saveBackupFile('hosts.json', '{}', 'json');
  assertEqual(
    calls.pop(),
    ['SaveBackupFile', 'hosts.json', '{}', 'json'],
    '檔案操作會透過 requireAppBinding 呼叫'
  );

  console.log('=== HostAPI 沙盒測試通過 ===');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

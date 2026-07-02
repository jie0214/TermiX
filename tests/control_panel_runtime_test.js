// TermiX Control Panel runtime 沙盒測試
// 驗證 FunctionBox 遠端輸出轉本機環境變數與 placeholder 替換邏輯。

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sourcePath = path.join(__dirname, '..', 'frontend', 'src', 'modules', 'controlpanel', 'ControlPanelRuntime.js');
const source = fs.readFileSync(sourcePath, 'utf8')
  .replace(/^import .*;\n/gm, '')
  .replace(/\bexport\s+(?=(async\s+)?function\s+)/g, '');

const sandbox = {
  console,
  ControlPanelAPI: {},
  TerminalAPI: {}
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

async function runAsyncTests() {
  let localCommand = null;
  let localEnv = null;
  sandbox.TerminalAPI.executeSessionCommandIsolated = async () => ({
    success: true,
    output: '123456789\n'
  });
  sandbox.ControlPanelAPI.executeLocalCommand = async (command, env) => {
    localCommand = command;
    localEnv = env;
    return { success: true, output: '' };
  };

  const result = await sandbox.executeFunctionBox({
    remoteCommand: 'sudo rustdesk --get-id',
    exportVars: 'ID',
    localCommand: 'open "rustdesk://$ID"'
  }, 'session-1');

  assertEqual(result.success, true, 'RUSTDESK FunctionBox 串接成功');
  assertEqual(localCommand, 'open "rustdesk://123456789"', 'RUSTDESK 本機 open 指令已替換 ID');
  assertEqual(localEnv, { ID: '123456789' }, 'RUSTDESK ID 已傳入本機 env');
}

assertEqual(
  sandbox.parseExportVarNames('ID, IP TERMIX_HOST invalid-name 9BAD'),
  ['ID', 'IP', 'TERMIX_HOST'],
  '只接受合法 env 變數名稱'
);

assertEqual(
  sandbox.buildLocalCommandEnv('ID,IP', 'ID=abc-123\nIP=10.0.0.8\n'),
  { ID: 'abc-123', IP: '10.0.0.8' },
  '從 KEY=VALUE 輸出解析 env'
);

assertEqual(
  sandbox.buildLocalCommandEnv('ID,IP', '{"ID":"abc-123","IP":"10.0.0.8"}'),
  { ID: 'abc-123', IP: '10.0.0.8' },
  '從 JSON object 輸出解析 env'
);

assertEqual(
  sandbox.buildLocalCommandEnv('ID', '123456789\n'),
  { ID: '123456789' },
  '單一 exportVars 可接受純 ID 輸出，支援 RUSTDESK'
);

assertEqual(
  sandbox.buildLocalCommandEnv('ID,IP', 'abc-123\n10.0.0.8\n'),
  {},
  '不接受未標名的依序輸出，避免錯值傳入本機'
);

assertEqual(
  sandbox.applyEnvToLocalCommand('open https://example.com/{{ID}}?ip=${IP}&host=$HOST', {
    ID: 'abc-123',
    IP: '10.0.0.8',
    HOST: 'server-1'
  }),
  'open https://example.com/abc-123?ip=10.0.0.8&host=server-1',
  '替換本機指令 placeholder'
);

runAsyncTests()
  .then(() => {
    console.log('=== Control Panel runtime 沙盒測試通過 ===');
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

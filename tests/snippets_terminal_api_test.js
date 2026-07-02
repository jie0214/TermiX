// TermiX Snippets TerminalAPI 沙盒測試
// 驗證 Snippet Paste/Run 需要的字串會原樣交給 Wails binding。

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sourcePath = path.join(__dirname, '..', 'frontend', 'src', 'modules', 'terminal', 'TerminalAPI.js');
const source = fs.readFileSync(sourcePath, 'utf8')
  .replace(/^import[\s\S]*?from\s+['"].*?['"];\n/, '')
  .replace(/\bexport\s+const\s+TerminalAPI\s*=/, 'const TerminalAPI =')
  + '\nthis.TerminalAPI = TerminalAPI;';

const calls = [];
const appBindings = {
  ConnectTerminal: (...args) => {
    calls.push(['ConnectTerminal', ...args]);
    return { success: true };
  },
  ConnectHostTerminal: (...args) => {
    calls.push(['ConnectHostTerminal', ...args]);
    return { success: true, sessionKey: `session-${args[0]?.sessionId}` };
  },
  CancelConnectHostTerminal: (...args) => {
    calls.push(['CancelConnectHostTerminal', ...args]);
    return { success: true, output: 'canceled' };
  },
  CancelConnectHost: (...args) => {
    calls.push(['CancelConnectHost', ...args]);
    return { success: true, output: 'canceled' };
  },
  ExecuteSessionCommand: (...args) => {
    calls.push(['ExecuteSessionCommand', ...args]);
    return { success: true, output: '' };
  },
  ExecuteSessionCommandIsolated: (...args) => {
    calls.push(['ExecuteSessionCommandIsolated', ...args]);
    return { success: true, output: '' };
  },
  TestConnection: (...args) => {
    calls.push(['TestConnection', ...args]);
    return { success: true };
  },
  CancelConnectTerminal: (...args) => {
    calls.push(['CancelConnectTerminal', ...args]);
  },
  CloseTerminalSession: (...args) => {
    calls.push(['CloseTerminalSession', ...args]);
  },
  ResizeTerminal: (...args) => {
    calls.push(['ResizeTerminal', ...args]);
    return { success: true };
  },
  StartLocalTerminal: (...args) => {
    calls.push(['StartLocalTerminal', ...args]);
    return { success: true };
  },
  GetAutocompleteSuggestions: (...args) => {
    calls.push(['GetAutocompleteSuggestions', ...args]);
    return { success: true, suggestions: [] };
  },
  WriteTerminalInput: (...args) => {
    calls.push(['WriteTerminalInput', ...args]);
  }
};

const sandbox = {
  console,
  window: {
    go: {
      app: {
        App: appBindings
      }
    }
  },
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

sandbox.TerminalAPI.executeSessionCommand('session-1', 'systemctl status nginx');
assertEqual(
  calls.pop(),
  ['ExecuteSessionCommand', 'session-1', 'systemctl status nginx'],
  'Snippet Run 會以原始 command 呼叫 ExecuteSessionCommand'
);

sandbox.TerminalAPI.writeTerminalInput('session-1', 'echo "hello from snippet"\n');
assertEqual(
  calls.pop(),
  ['WriteTerminalInput', 'session-1', 'echo "hello from snippet"\n'],
  'Snippet Paste 會以原始輸入字串呼叫 WriteTerminalInput，保留換行'
);

sandbox.TerminalAPI.startLocalTerminal('/bin/bash');
assertEqual(
  calls.pop(),
  ['StartLocalTerminal', '/bin/bash'],
  'Local Terminal 會將使用者選擇的 Shell 路徑傳給 Wails binding'
);

sandbox.TerminalAPI.executeSessionCommandIsolated('session-2', 'sudo journalctl -u app --no-pager');
assertEqual(
  calls.pop(),
  ['ExecuteSessionCommandIsolated', 'session-2', 'sudo journalctl -u app --no-pager'],
  '隔離式執行會保留 sudo 指令字串'
);

sandbox.TerminalAPI.connectTarget({ hostId: 'host-1', config: { sessionId: 'sess-a' } });
assertEqual(
  calls.pop(),
  ['ConnectHostTerminal', { hostId: 'host-1', sessionId: 'sess-a' }],
  'HostVault 連線會帶入 sessionId 建立獨立 session'
);

sandbox.TerminalAPI.connectTarget({ hostId: 'host-1', config: { sessionId: 'sess-b' } });
assertEqual(
  calls.pop(),
  ['ConnectHostTerminal', { hostId: 'host-1', sessionId: 'sess-b' }],
  '同一 HostVault 卡片再次連線會使用不同 sessionId'
);

sandbox.TerminalAPI.cancelConnectTarget({ hostId: 'host-1', config: { sessionId: 'sess-a' } });
assertEqual(
  calls.pop(),
  ['CancelConnectHostTerminal', { hostId: 'host-1', sessionId: 'sess-a' }],
  'HostVault 連線取消會帶入 sessionId 取消指定連線'
);

const sshConfig = {
  host: '10.20.30.40',
  port: 22,
  username: 'termix',
  sessionId: 'sess-direct'
};
sandbox.TerminalAPI.cancelConnectTerminal(sshConfig);
assertEqual(
  calls.pop(),
  ['CancelConnectTerminal', sshConfig],
  '直接 SSH 連線取消會傳入完整 SSHConfig，而非 session key'
);

console.log('=== Snippets TerminalAPI 沙盒測試通過 ===');

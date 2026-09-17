// TermiX Session Log 沙盒測試
// 驗證 Logs 歷史紀錄讀取、清空與 session 關閉保存行為。

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const storePath = path.join(__dirname, '..', 'frontend', 'src', 'modules', 'terminal', 'SessionLogStore.js');
const lifecyclePath = path.join(__dirname, '..', 'frontend', 'src', 'modules', 'terminal', 'TerminalLifecycle.js');
const terminalPagePath = path.join(__dirname, '..', 'frontend', 'src', 'modules', 'terminal', 'TerminalPage.js');
const appPath = path.join(__dirname, '..', 'frontend', 'src', 'App.js');

const localStorageMock = (() => {
  const data = new Map();
  let maxWriteLength = Number.POSITIVE_INFINITY;
  return {
    getItem: (key) => data.has(key) ? data.get(key) : null,
    setItem: (key, value) => {
      const serialized = String(value);
      if (serialized.length > maxWriteLength) {
        const error = new Error('quota exceeded');
        error.name = 'QuotaExceededError';
        throw error;
      }
      data.set(key, serialized);
    },
    removeItem: (key) => data.delete(key),
    clear: () => data.clear(),
    seed: (key, value) => data.set(key, String(value)),
    setMaxWriteLength: (length) => {
      maxWriteLength = length;
    }
  };
})();

let logsChangedCount = 0;
const sandbox = {
  console,
  localStorage: localStorageMock,
  CustomEvent: class CustomEvent {
    constructor(type) {
      this.type = type;
    }
  },
  window: {
    dispatchEvent: (event) => {
      if (event.type === 'termix-session-logs-changed') {
        logsChangedCount += 1;
      }
    }
  },
  terminalStore: {
    getState: () => sandbox.terminalState
  },
  terminalState: {
    sessions: {},
    xtermInstances: {},
    removeXtermInstance: () => {},
    removeBroadcastSession: () => {},
    removeSession: (sessionKey) => {
      delete sandbox.terminalState.sessions[sessionKey];
    }
  }
};

function loadModule(filePath) {
  const source = fs.readFileSync(filePath, 'utf8')
    .replace(/^import[\s\S]*?;\n/gm, '')
    .replace(/\bexport\s+(?=function\s+)/g, '')
    .replace(/^export\s+\{[\s\S]*?\};\n?/gm, '');
  vm.runInContext(source, sandbox, { filename: filePath });
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

vm.createContext(sandbox);
loadModule(storePath);
loadModule(lifecyclePath);

sandbox.terminalState.sessions.live = {
  label: 'Live',
  outputHtml: '清空前的舊輸出',
  config: {}
};

sandbox.clearSessionLogs(sandbox.terminalState.sessions);
assertEqual(sandbox.terminalState.sessions.live.outputHtml, '', '清空歷史紀錄會同步清除 live session 舊輸出');
assertEqual(logsChangedCount, 1, '清空歷史紀錄會發出 Logs 變更事件');

localStorageMock.setItem('termix-session-logs', JSON.stringify([
  { id: 'old', timestamp: 1000, outputHtml: 'old output' },
  { id: 'new', timestamp: 2000, outputHtml: 'new output' }
]));

assertEqual(
  sandbox.readSessionLogs().map((log) => log.id),
  ['new', 'old'],
  '讀取既有歷史紀錄時依 timestamp 由新到舊排序'
);

localStorageMock.setItem('termix-session-logs', JSON.stringify([
  { id: 'ansi', timestamp: 3000, outputHtml: '\u001b[31m紅字\u001b[0m\r\nroot\u0008\u0008\u0008\u0008user' }
]));
assertEqual(
  sandbox.readSessionLogs()[0].outputHtml,
  '紅字\nuser',
  '讀取歷史紀錄時會移除 ANSI 與終端控制字元'
);

sandbox.clearSessionLogs();
assertEqual(localStorageMock.getItem('termix-session-logs'), null, '清空歷史紀錄會移除 localStorage 資料');
assertEqual(logsChangedCount, 2, '再次清空歷史紀錄會發出 Logs 變更事件');

sandbox.terminalState.sessions.s1 = {
  label: 'Production',
  config: {
    username: 'manage',
    host: '10.20.33.120',
    alias: 'prod'
  },
  outputHtml: '連線建立成功\nwhoami\nmanage\n'
};

sandbox.persistSessionLog('s1');
sandbox.persistSessionLog('s1');

const logs = sandbox.readSessionLogs();
assertEqual(logs.length, 1, '同一個 session 關閉流程重複觸發時只保存一次');
assertEqual(logs[0].hostName, '10.20.33.120', '保存的歷史紀錄包含 Host');
assertEqual(logs[0].outputHtml.includes('whoami'), true, '保存的歷史紀錄包含終端輸出內容');

sandbox.deleteSessionLogs([logs[0].id]);
assertEqual(sandbox.readSessionLogs().length, 0, '可以刪除指定歷史日誌');

const oversizedLogs = Array.from({ length: 20 }, (_, index) => ({
  id: `oversized-${index}`,
  timestamp: 10000 - index,
  outputHtml: `output-${index}-` + 'x'.repeat(50000)
}));
localStorageMock.seed('termix-session-logs', JSON.stringify(oversizedLogs));
localStorageMock.setMaxWriteLength(100000);
sandbox.writeSessionLog({
  id: 'newest',
  timestamp: 20000,
  outputHtml: 'new-' + 'y'.repeat(50000)
});
const recoveredLogs = sandbox.readSessionLogs();
assertEqual(recoveredLogs.length, 15, 'Session Logs 超過配額時只保留最新 15 筆');
assertEqual(recoveredLogs[0].id, 'newest', 'Session Logs 配額復原會保留最新紀錄');
assertEqual(
  recoveredLogs.every((log) => log.outputHtml.length <= 5000),
  true,
  'Session Logs 配額復原會限制每筆輸出長度'
);
localStorageMock.setMaxWriteLength(Number.POSITIVE_INFINITY);
localStorageMock.clear();

sandbox.cleanupFrontendSession('s1');
assertEqual(!!sandbox.terminalState.sessions.s1, false, '清理前端 session 後移除 session 狀態');

const terminalPageSource = fs.readFileSync(terminalPagePath, 'utf8');
const appSource = fs.readFileSync(appPath, 'utf8');
assertEqual(
  terminalPageSource.includes("session.isLogView ? '' : 'hidden'"),
  true,
  'Log View 會顯示唯讀歷史輸出區塊'
);
assertEqual(
  terminalPageSource.includes("if (session?.isLogView) return;"),
  true,
  'Log View 不建立 live xterm 實例'
);
assertEqual(
  terminalPageSource.includes('const safeSessionKey = escapeHtml(pane.sessionKey);') &&
    terminalPageSource.includes('${escapeHtml(session.label)}') &&
    appSource.includes('${escapeHtml(ws.label)}') &&
    appSource.includes('const snippetId = escapeHtml(snippet.id);'),
  true,
  'Terminal 工作階段、工作區與 Snippet 的持久化鍵值及標籤寫入 HTML 前會跳脫'
);
assertEqual(
  terminalPageSource.includes('Number.isFinite(paneHeightValue)') &&
    terminalPageSource.includes('Number.isFinite(columnWidthValue)'),
  true,
  'Terminal 持久化版面尺寸只接受有限數值'
);
assertEqual(
  appSource.includes("import { compactStoredSessionLogs } from './modules/terminal/SessionLogStore';") &&
    appSource.includes('compactStoredSessionLogs();') &&
    !appSource.includes('Storage.prototype.setItem'),
  true,
  'Session Logs 配額復原集中於 Store，不修改全域 Storage prototype'
);

console.log('=== Session Log 沙盒測試通過 ===');

// Local Terminal Settings 原始碼契約測試。

const fs = require('fs');
const path = require('path');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'App.js'), 'utf8');
const bindingSource = fs.readFileSync(path.join(__dirname, '..', 'backend', 'app', 'bindings_terminal.go'), 'utf8');

const shellPaths = ['/bin/bash', '/bin/csh', '/bin/dash', '/bin/ksh', '/bin/sh', '/bin/tcsh', '/bin/zsh'];

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`PASS: ${message}`);
}

assert(appSource.includes('id="localTerminalPathInput"'), 'Settings 顯示 Local Terminal Path 輸入欄位');
assert(appSource.includes('list="localTerminalPathOptions"'), 'Local Terminal Path 輸入欄位連結下拉建議');
for (const shellPath of shellPaths) {
  assert(appSource.includes(`'${shellPath}'`), `下拉建議包含 ${shellPath}`);
}
assert(appSource.includes('TerminalAPI.startLocalTerminal(themeStore.getState().localTerminalPath)'), '建立 Local Terminal 時使用已保存路徑');
assert(bindingSource.includes('StartLocalTerminal(shellPath string)'), 'Wails binding 接收 Shell 路徑');

console.log('=== Local Terminal Settings 契約測試通過 ===');

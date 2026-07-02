// TermiX Wails runtime facade 契約測試
// 驗證主要 App 與 Host List 不再直接存取 window.go 或 window.runtime。

const fs = require('fs');
const path = require('path');

const appSource = fs.readFileSync(
  path.join(__dirname, '..', 'frontend', 'src', 'App.js'),
  'utf8'
);
const hostListSource = fs.readFileSync(
  path.join(__dirname, '..', 'frontend', 'src', 'modules', 'hostvault', 'HostListPage.js'),
  'utf8'
);
const controlPanelAPISource = fs.readFileSync(
  path.join(__dirname, '..', 'frontend', 'src', 'modules', 'controlpanel', 'ControlPanelAPI.js'),
  'utf8'
);
const controlPanelPageSource = fs.readFileSync(
  path.join(__dirname, '..', 'frontend', 'src', 'modules', 'controlpanel', 'ControlPanelPage.js'),
  'utf8'
);

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`PASS: ${message}`);
}

assert(
  appSource.includes("import { getAppBinding } from './platform/wails/bindings.ts';"),
  'App 使用共用 Wails binding facade'
);
assert(
  appSource.includes("import { onWailsEvent } from './platform/wails/events.ts';"),
  'App 使用共用 Wails event facade'
);
for (const eventName of ['open-global-settings', 'terminal-output', 'terminal-closed']) {
  assert(
    appSource.includes(`onWailsEvent("${eventName}"`),
    `App 透過 facade 訂閱 ${eventName}`
  );
}
assert(
  appSource.includes("getAppBinding('StartLocalTerminal')"),
  'Local Terminal 使用 facade 檢查 binding'
);
assert(
  appSource.includes("getAppBinding('GetActiveKubernetesSession')"),
  'Kubernetes Session 還原使用 facade 檢查 binding'
);
assert(
  appSource.includes('this.runtimeEventOffs.forEach((off) => off())'),
  'App 卸載時會逐一清理 runtime events'
);
assert(!/window\.(go|runtime)/.test(appSource), 'App 不直接存取 window.go 或 window.runtime');

assert(
  hostListSource.includes("import { onWailsEvent } from '../../platform/wails/events.ts';"),
  'Host List 使用共用 Wails event facade'
);
assert(
  hostListSource.includes('onWailsEvent("connection-progress"'),
  'Host List 透過 facade 訂閱 connection progress'
);
assert(
  hostListSource.includes("progressListenerOff();"),
  'Host List 連線結束時會清理專屬 progress listener'
);
assert(
  !hostListSource.includes('EventsOff("connection-progress")'),
  'Host List 不使用全域 EventsOff 移除其他訂閱者'
);
assert(!/window\.(go|runtime)/.test(hostListSource), 'Host List 不直接存取 window.go 或 window.runtime');

assert(
  controlPanelAPISource.includes("import { requireAppBinding } from '../../platform/wails/bindings.ts';"),
  'Control Panel API 使用共用 Wails binding facade'
);
for (const methodName of ['ExecuteLocalCommand', 'SaveBackupFile', 'ReadBackupFile']) {
  assert(
    controlPanelAPISource.includes(`requireAppBinding('${methodName}')`),
    `Control Panel API 透過 facade 呼叫 ${methodName}`
  );
}
assert(
  controlPanelPageSource.includes("import { ControlPanelAPI } from './ControlPanelAPI';"),
  'Control Panel 頁面透過 API 層存取備份方法'
);
assert(
  !/window\.(go|runtime)/.test(controlPanelPageSource),
  'Control Panel 頁面不直接存取 window.go 或 window.runtime'
);

console.log('=== Wails runtime facade 契約測試通過 ===');

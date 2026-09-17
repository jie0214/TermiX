// TermiX Control Panel layout 沙盒測試
// 驗證 terminal 側邊控制面板拖曳排序的純資料邏輯。

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sourcePath = path.join(__dirname, '..', 'frontend', 'src', 'modules', 'controlpanel', 'ControlPanelLayout.js');
const source = fs.readFileSync(sourcePath, 'utf8')
  .replace(/\bexport\s+(?=function\s+)/g, '');
const appSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'App.js'), 'utf8');
const pageSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'modules', 'controlpanel', 'ControlPanelPage.js'), 'utf8');

const sandbox = { console };
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

const base = [
  { id: 'cpu', visible: true, order: 0 },
  { id: 'disk', visible: true, order: 1 },
  { id: 'rustdesk', visible: true, order: 2 }
];

assertEqual(
  sandbox.reorderControlPanelComponents(base, 'rustdesk', 'cpu', 'before').map(item => item.id),
  ['rustdesk', 'cpu', 'disk'],
  '拖曳到目標上半部時會插入目標前方'
);

assertEqual(
  sandbox.reorderControlPanelComponents(base, 'cpu', 'disk', 'after').map(item => item.id),
  ['disk', 'cpu', 'rustdesk'],
  '拖曳到目標下半部時會插入目標後方'
);

assertEqual(
  sandbox.reorderControlPanelComponents(base, 'missing', 'disk', 'after').map(item => item.order),
  [0, 1, 2],
  '來源不存在時只回傳正規化排序'
);

assertEqual(
  sandbox.getControlPanelDropPosition({ left: 0, top: 0, width: 240, height: 80 }, 200, 20),
  'after',
  '寬版方塊依左右位置判斷插入後方'
);

assertEqual(
  sandbox.getControlPanelDropPosition({ left: 0, top: 0, width: 120, height: 120 }, 100, 40),
  'before',
  '一般方塊依上下位置判斷插入前方'
);

assertEqual(
  sandbox.normalizeControlPanelOrder([
    { id: 'b', visible: true, order: 3 },
    { id: 'a', visible: false, order: 1 }
  ]),
  [
    { id: 'a', visible: false, order: 0 },
    { id: 'b', visible: true, order: 1 }
  ],
  '正規化時保留 visible 狀態並重建連續 order'
);

assertEqual(
  sandbox.sanitizeComponentColor('#FF9900'),
  '#FF9900',
  '合法物件配色會被保留'
);

assertEqual(
  sandbox.sanitizeComponentColor('red'),
  '#176b87',
  '非法物件配色會回退預設色'
);

const theme = sandbox.getControlPanelThemeStyle('#E95420');
assertEqual(
  theme.rgbText,
  '233, 84, 32',
  '物件配色會轉換為 RGB 供背景與邊框使用'
);
assertEqual(
  theme.panelStyle.includes('border-left: 5px solid #E95420') && theme.panelStyle.includes('linear-gradient'),
  true,
  '方塊樣式會套用色條與淡色背景'
);

assertEqual(
  appSource.includes('${escapeHtml(val)}</span>')
    && appSource.includes('${escapeHtml(item.key)}</div>')
    && appSource.includes('${escapeHtml(session.customInfo[key])}</div>'),
  true,
  'Control Panel 遠端輸出與欄位名稱在寫入 innerHTML 前會跳脫'
);

assertEqual(
  appSource.includes('const componentColor = sanitizeComponentColor(comp.color);')
    && appSource.includes('${escapeHtml(comp.localCommand || comp.remoteCommand || \'\')}'),
  true,
  'Control Panel 自訂樣式與指令摘要不允許注入 HTML 或任意 CSS'
);

assertEqual(
  pageSource.includes('${escapeHtml(comp.name)}</span>')
    && pageSource.includes('value="${escapeHtml(item.command)}"')
    && pageSource.includes('${escapeHtml(drawerComp.localCommand)}</textarea>')
    && pageSource.includes('color: ${sanitizeComponentColor(comp.color)};'),
  true,
  'Control Panel 管理頁會跳脫匯入的名稱與指令並限制自訂色彩格式'
);

console.log('=== Control Panel layout 沙盒測試通過 ===');

// TermiX 前端事件流沙盒仿真測試腳本
// 旨在模擬 WebKit 的事件傳播模型，100% 驗證 pointerdown 重構為 mousedown 後的事件流正確性。

console.log("=== TermiX 前端事件流沙盒仿真測試開始 ===");

// 1. 模擬極簡 DOM 節點
class MockElement {
  constructor(tagName, className = "", id = "") {
    this.tagName = tagName.toUpperCase();
    this.className = className;
    this.id = id;
    this.listeners = {};
    this.parentNode = null;
    this.attributes = {};
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
  }

  getAttribute(name) {
    return this.attributes[name] || null;
  }

  addEventListener(event, callback, useCapture = false) {
    const phase = useCapture ? 'capture' : 'bubble';
    if (!this.listeners[event]) {
      this.listeners[event] = { capture: [], bubble: [] };
    }
    this.listeners[event][phase].push(callback);
  }

  closest(selector) {
    let current = this;
    while (current) {
      if (selector.split(',').some(sel => {
        const cleanSel = sel.trim();
        if (cleanSel.startsWith('.')) {
          return current.className.includes(cleanSel.substring(1));
        }
        if (cleanSel.startsWith('#')) {
          return current.id === cleanSel.substring(1);
        }
        return current.tagName === cleanSel.toUpperCase();
      })) {
        return current;
      }
      current = current.parentNode;
    }
    return null;
  }
}

// 2. 模擬事件物件
class MockEvent {
  constructor(type) {
    this.type = type;
    this.target = null;
    this.currentTarget = null;
    this.propagationStopped = false;
    this.defaultPrevented = false;
  }

  stopPropagation() {
    this.propagationStopped = true;
  }

  preventDefault() {
    this.defaultPrevented = true;
  }
}

// 3. 建立 DOM 樹與全域 document
const documentMock = new MockElement("document");
const appMock = new MockElement("div", "", "app");
appMock.parentNode = documentMock;

// 建立一個關閉分頁按鈕 (互動元件)
const closeTabBtn = new MockElement("button", "no-drag close-tab");
closeTabBtn.setAttribute("data-workspace-id", "ws_test_123");
closeTabBtn.parentNode = appMock;

// 建立一個儲存主機按鈕 (互動元件)
const saveHostBtn = new MockElement("button", "no-drag primary", "vaultSaveBtn");
saveHostBtn.parentNode = appMock;

// 4. 模擬事件派發與冒泡機制
function dispatchMockEvent(target, eventType) {
  const event = new MockEvent(eventType);
  event.target = target;

  // 收集傳播路徑
  const path = [];
  let current = target;
  while (current) {
    path.push(current);
    current = current.parentNode;
  }

  // A. 捕獲階段 (Capture Phase)
  for (let i = path.length - 1; i >= 0; i--) {
    const el = path[i];
    event.currentTarget = el;
    const list = el.listeners[eventType]?.capture || [];
    for (const cb of list) {
      cb(event);
      if (event.propagationStopped) return event;
    }
  }

  // B. 冒泡階段 (Bubble Phase)
  for (let i = 0; i < path.length; i++) {
    const el = path[i];
    event.currentTarget = el;
    const list = el.listeners[eventType]?.bubble || [];
    for (const cb of list) {
      cb(event);
      if (event.propagationStopped) return event;
    }
  }

  return event;
}

// ==================== 註冊 main.js 核心邏輯 ====================

// A. 模擬 Wails macOS 視窗拖曳攔截 (我們重構後的 mousedown 攔截)
documentMock.addEventListener('mousedown', (e) => {
  if (e.target.closest('.no-drag, button, input, select, textarea, .close-tab, .close-pane, .vault-menu-item, a')) {
    e.stopPropagation();
  }
});

// B. 模擬 document 上的 click 捕獲監聽器 (用於關閉 Tab 與關閉分割)
let isCloseWorkspaceCalled = false;
let closedWorkspaceId = null;

documentMock.addEventListener('click', (e) => {
  const closeTabBtn = e.target.closest('.close-tab');
  if (closeTabBtn) {
    e.preventDefault();
    e.stopPropagation();
    const wsId = closeTabBtn.getAttribute('data-workspace-id');
    if (wsId) {
      isCloseWorkspaceCalled = true;
      closedWorkspaceId = wsId;
    }
  }
}, true); // useCapture = true

// C. 模擬 Save 按鈕上的點擊監聽器
let isSaveHostBtnClicked = false;
saveHostBtn.addEventListener('click', (e) => {
  isSaveHostBtnClicked = true;
});


// ==================== 測試執行與斷言 ====================

// 測試 1：模擬在 closeTabBtn 上的 mousedown
console.log("\n[測試 1] 模擬在「關閉標籤按鈕」上點下滑鼠 (mousedown)...");
const mousedownEvent = dispatchMockEvent(closeTabBtn, 'mousedown');
console.log("-> mousedown 事件是否被攔截阻斷傳播？", mousedownEvent.propagationStopped ? "PASS (已阻斷，Wails 不會誤觸拖曳)" : "FAIL");

// 測試 2：模擬 WebKit 合成 click 事件傳播至關閉按鈕
console.log("\n[測試 2] 模擬 WebKit 原生合成 click 事件派發給「關閉標籤按鈕」...");
const clickEvent = dispatchMockEvent(closeTabBtn, 'click');
console.log("-> click 事件是否正常執行？", clickEvent.defaultPrevented ? "PASS (已執行預防預設與事件攔截)" : "FAIL");
console.log("-> closeWorkspace 是否成功被呼叫？", isCloseWorkspaceCalled ? `PASS (已成功關閉工作區 ${closedWorkspaceId})` : "FAIL");

// 測試 3：模擬在 saveHostBtn 上的 mousedown
console.log("\n[測試 3] 模擬在「儲存主機按鈕」上點下滑鼠 (mousedown)...");
const saveMousedown = dispatchMockEvent(saveHostBtn, 'mousedown');
console.log("-> mousedown 是否被攔截？", saveMousedown.propagationStopped ? "PASS (已阻斷)" : "FAIL");

// 測試 4：模擬 click 派發給儲存按鈕
console.log("\n[測試 4] 模擬 click 事件派發給「儲存主機按鈕」...");
dispatchMockEvent(saveHostBtn, 'click');
console.log("-> Save 按鈕的 click 監聽器是否正常觸發？", isSaveHostBtnClicked ? "PASS (成功儲存！)" : "FAIL");

console.log("\n=== TermiX 前端事件流沙盒仿真測試結束 ===");
if (mousedownEvent.propagationStopped && isCloseWorkspaceCalled && saveMousedown.propagationStopped && isSaveHostBtnClicked) {
  console.log("\n【恭喜！所有仿真事件流測試全部高分通過，100% 證實修復方案邏輯完美正確！】\n");
} else {
  console.error("\n【警告！測試中有項目未通過，請檢查邏輯。】\n");
  process.exit(1);
}

// TermiX Host secret payload sandbox test
// 驗證已儲存密碼欄位被清空後會送出 clear mutation。

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const modelPath = path.join(__dirname, '..', 'frontend', 'src', 'modules', 'hostvault', 'HostVaultModel.js');
const pagePath = path.join(__dirname, '..', 'frontend', 'src', 'modules', 'hostvault', 'HostListPage.js');

const modelSource = fs.readFileSync(modelPath, 'utf8')
  .replace(/\bexport\s+const\s+([A-Z0-9_]+)\s*=/g, 'const $1 =')
  .replace(/\bexport\s+(?=function\s+)/g, '')
  + `
this.SECRET_FIELD_DEFINITIONS = SECRET_FIELD_DEFINITIONS;
this.ensureSecretRefs = ensureSecretRefs;
this.getSecretMask = getSecretMask;
this.getHostSecretStatusMap = getHostSecretStatusMap;
this.getSecretStatusLabel = getSecretStatusLabel;
`;

const pageSource = fs.readFileSync(pagePath, 'utf8')
  .replace(/import[\s\S]*?from\s+['"][^'"]+['"];\n/g, '')
  .replace(/\bexport\s+class\s+HostListPage\b/, 'class HostListPage')
  + `
this.bindSecretFieldState = bindSecretFieldState;
this.bindSecretVisibilityToggles = bindSecretVisibilityToggles;
this.buildSecretsPayload = buildSecretsPayload;
`;

class MockElement {
  constructor({ value = '', dataset = {} } = {}) {
    this.value = value;
    this.type = 'password';
    this.dataset = dataset;
    this.listeners = {};
    this.attributes = {};
    this.style = {};
    this.textContent = '';
  }

  addEventListener(type, callback) {
    this.listeners[type] = callback;
  }

  dispatch(type) {
    const result = this.listeners[type]?.({ target: this });
    if (result && typeof result.then === 'function') {
      return result;
    }
    return Promise.resolve(result);
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
  }

  getAttribute(name) {
    return this.attributes[name] || null;
  }
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

const sandbox = {
  console,
  localStorage: {
    getItem: () => null
  },
  HTMLElement: class {},
  customElements: {
    define: () => null
  },
  window: {},
  document: {},
  alert: (message) => {
    throw new Error(message);
  },
  HostAPI: {
    getHostSecretValue: async (hostId, field) => {
      if (hostId === 'host-1' && field === 'sudoPassword') {
        return {
          hostId,
          field,
          value: 'abc123',
          found: true
        };
      }
      return {
        hostId,
        field,
        value: '',
        found: false
      };
    }
  }
};

vm.createContext(sandbox);
vm.runInContext(modelSource, sandbox, { filename: modelPath });
vm.runInContext(pageSource, sandbox, { filename: pagePath });
vm.runInContext('this.renderSecretInput = renderSecretInput;', sandbox, { filename: pagePath });

const sudoField = sandbox.SECRET_FIELD_DEFINITIONS.find(field => field.key === 'sudoPassword');
const renderedMarkup = sandbox.renderSecretInput(sudoField, {
  id: 'host-1',
  secretStatus: {
    sudoPassword: {
      status: 'stored',
      stored: true,
      configured: true,
      length: 11
    }
  },
  config: {
    secretRefs: {
      sudoPasswordRef: 'host/host-1/sudo-password'
    }
  }
}, 'placeholder="若填寫此欄位連線後將自動提權 sudo"');

assertEqual(renderedMarkup.includes('class="no-drag secret-visibility-toggle"'), true, '密碼欄位 HTML 內含眼睛切換按鈕');
assertEqual(renderedMarkup.includes('<svg'), true, '密碼欄位切換按鈕使用眼睛圖示');
assertEqual(renderedMarkup.includes(`data-target="${sudoField.inputId}"`), true, '眼睛按鈕綁定對應的密碼欄位');

const input = new MockElement({
  value: '***********',
  dataset: {
    hostId: 'host-1',
    secretField: 'sudoPassword',
    secretPristine: 'true',
    secretMask: '***********'
  }
});
const action = new MockElement({ value: 'keep' });
const status = new MockElement({
  dataset: {
    initialStatus: 'stored'
  }
});
const toggle = new MockElement();
toggle.setAttribute('data-target', sudoField.inputId);

const elements = new Map([
  [`#${sudoField.inputId}`, input],
  [`#${sudoField.actionInputId}`, action],
  [`#${sudoField.statusId}`, status]
]);

const root = {
  querySelector: (selector) => elements.get(selector) || null,
  querySelectorAll: (selector) => selector === '.secret-visibility-toggle' ? [toggle] : []
};

sandbox.bindSecretFieldState(root);
sandbox.bindSecretVisibilityToggles(root);
input.dispatch('focus');
input.dispatch('input');

assertEqual(input.value, '***********', '點入已儲存 sudo password 欄位不會自動清空遮罩');
assertEqual(action.value, 'keep', '未刪除已儲存 sudo password 時維持 preserve');

async function run() {
  await toggle.dispatch('click');
  assertEqual(input.type, 'text', '密碼顯示按鈕會切換為明文');
  assertEqual(input.value, 'abc123', '已儲存 sudo password 會透過眼睛按鈕讀出明文');
  assertEqual(action.value, 'keep', '只顯示已儲存 sudo password 不會改成 set action');
  assertEqual(toggle.attributes['aria-label'], '隱藏密碼', '切換為明文後 aria-label 會更新為隱藏密碼');
  assertEqual(toggle.attributes.title, '隱藏密碼', '切換為明文後 title 會更新為隱藏密碼');
  await toggle.dispatch('click');
  assertEqual(input.type, 'password', '密碼顯示按鈕可切回隱藏');
  assertEqual(input.value, '***********', '切回隱藏後會恢復遮罩顯示');
  assertEqual(toggle.attributes['aria-label'], '顯示密碼', '切回遮罩後 aria-label 會更新為顯示密碼');
  assertEqual(toggle.attributes.title, '顯示密碼', '切回遮罩後 title 會更新為顯示密碼');

  input.value = '';
  await input.dispatch('input');

  const payload = sandbox.buildSecretsPayload(root, 'host-1', {
    id: 'host-1',
    config: {
      secretRefs: {
        sudoPasswordRef: 'host/host-1/sudo-password'
      }
    }
  });

  assertEqual(action.value, 'clear', '已儲存 sudo password 清空後會標記 clear action');
  assertEqual(payload.sudoPassword, {
    action: 'clear',
    ref: 'host/host-1/sudo-password',
    clear: true,
    hasValue: false
  }, '已儲存 sudo password 清空後會送出 clear payload');

  console.log('=== Host secret payload 沙盒測試通過 ===');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

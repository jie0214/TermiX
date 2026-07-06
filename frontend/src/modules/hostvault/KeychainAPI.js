import { getAppBinding } from '../../platform/wails';

function parseOperationPayload(result) {
  if (!result || typeof result !== 'object') return result;
  if (!Object.prototype.hasOwnProperty.call(result, 'success')) return result;
  if (!result.success) {
    throw new Error(result.error || '後端操作失敗');
  }
  if (!result.output) return null;
  try {
    return JSON.parse(result.output);
  } catch (e) {
    return result.output;
  }
}

async function callApp(methodName, ...args) {
  const binding = getAppBinding(methodName);
  if (typeof binding !== 'function') {
    throw new Error(`缺少後端 API：${methodName}`);
  }
  const result = await binding(...args);
  return parseOperationPayload(result);
}

export const KeychainAPI = {
  list() {
    return callApp('ListKeychainKeys');
  },
  generate(request) {
    return callApp('GenerateKeychainKey', request);
  },
  importKey(request) {
    return callApp('ImportKeychainKey', request);
  },
  deleteKey(keyId) {
    return callApp('DeleteKeychainKey', keyId);
  },
  exportKey(request) {
    return callApp('ExportKeychainKey', request);
  }
};

// @ts-check
// @ts-ignore -- 與專案慣例一致，binding facade 以 `.ts` 副檔名匯入；此處僅抑制 TS5097，不改變執行期行為。
import { requireAppBinding } from '../../platform/wails/bindings.ts';
import { t } from '../../i18n/index.ts';

/**
 * @typedef {import('../../domain').OperationResult} OperationResult
 * @typedef {import('../../platform/wails/contracts').WailsAppMethodName} WailsAppMethodName
 */

/**
 * @param {unknown} result
 * @returns {unknown}
 */
function parseOperationPayload(result) {
  if (!result || typeof result !== 'object') return result;
  if (!Object.prototype.hasOwnProperty.call(result, 'success')) return result;
  const operation = /** @type {OperationResult} */ (result);
  if (!operation.success) {
    throw new Error(operation.error || t('k8s.err.backendOperationFailed'));
  }
  if (!operation.output) return null;
  try {
    return JSON.parse(operation.output);
  } catch (e) {
    return operation.output;
  }
}

/**
 * @param {WailsAppMethodName} methodName
 * @param {...unknown} args
 * @returns {Promise<unknown>}
 */
async function callApp(methodName, ...args) {
  const binding = /** @type {(...callArgs: unknown[]) => Promise<unknown>} */ (
    requireAppBinding(methodName)
  );
  const result = await binding(...args);
  return parseOperationPayload(result);
}

/**
 * @param {unknown} payload
 * @returns {unknown[]}
 */
function normalizeListPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  const record = /** @type {Record<string, unknown>} */ (payload);
  if (Array.isArray(record.clusters)) return record.clusters;
  if (Array.isArray(record.items)) return record.items;
  return [];
}

export const KubernetesAPI = {
  async listClusters() {
    return normalizeListPayload(await callApp('ListKubernetesClusters'));
  },

  /** @param {unknown} profile */
  saveCluster(profile) {
    return callApp('SaveKubernetesCluster', profile);
  },

  /** @param {string} id */
  deleteCluster(id) {
    return callApp('DeleteKubernetesCluster', id);
  },

  /** @param {unknown} request */
  switchContext(request) {
    return callApp('SwitchKubernetesContext', request);
  },

  /** @param {unknown} request */
  connectCluster(request) {
    return callApp('ConnectKubernetesCluster', request);
  },

  disconnectCluster() {
    return callApp('DisconnectKubernetesCluster');
  },

  getActiveSession() {
    return callApp('GetActiveKubernetesSession');
  },

  /** @param {string} namespace */
  getDashboard(namespace, scope = '') {
    return callApp('GetKubernetesDashboard', { namespace, scope });
  },

  /** 輕量列出 namespace 名稱（供篩選下拉快速填充，不必等整包 dashboard）。 */
  async listNamespaces() {
    const payload = await callApp('GetKubernetesNamespaces');
    return Array.isArray(payload) ? payload : [];
  },

  /** @param {unknown} request */
  getResourceDetail(request) {
    return callApp('GetKubernetesResourceDetail', request);
  },

  /** @param {unknown} request */
  getPodLogs(request) {
    return callApp('GetKubernetesPodLogs', request);
  },

  /** @param {unknown} request */
  startPodShell(request) {
    return callApp('StartKubernetesPodShell', request);
  },

  /** @param {unknown} request */
  writePodShellInput(request) {
    return callApp('WriteKubernetesPodShellInput', request);
  },

  /** @param {unknown} request */
  resizePodShell(request) {
    return callApp('ResizeKubernetesPodShell', request);
  },

  /** @param {string} sessionId */
  closePodShell(sessionId) {
    return callApp('CloseKubernetesPodShell', sessionId);
  },

  /** @param {unknown} request */
  deletePod(request) {
    return callApp('DeleteKubernetesPod', request);
  },

  /** @param {unknown} request */
  deleteResource(request) {
    return callApp('DeleteKubernetesResource', request);
  },

  /** @param {unknown} request */
  updateResource(request) {
    return callApp('UpdateKubernetesResource', request);
  },

  /** @param {unknown} request */
  startPodPortForward(request) {
    return callApp('StartKubernetesPodPortForward', request);
  },

  /** @param {unknown} request */
  listPodPortForwards(request) {
    return callApp('ListKubernetesPodPortForwards', request);
  },

  /** @param {unknown} request */
  stopPodPortForward(request) {
    return callApp('StopKubernetesPodPortForward', request);
  },

  /** @param {unknown} request */
  startServicePortForward(request) {
    return callApp('StartKubernetesServicePortForward', request);
  },

  /** @param {unknown} request */
  listServicePortForwards(request) {
    return callApp('ListKubernetesServicePortForwards', request);
  },

  /** @param {unknown} request */
  createResource(request) {
    return callApp('CreateKubernetesResource', request);
  },

  /**
   * @param {string} defaultFilename
   * @param {string} content
   */
  saveResourceYAML(defaultFilename, content) {
    return callApp('SaveKubernetesResourceYAML', defaultFilename, content);
  },

  /**
   * @param {string} defaultFilename
   * @param {string} content
   */
  savePodLogs(defaultFilename, content) {
    return callApp('SaveKubernetesPodLogs', defaultFilename, content);
  }
};

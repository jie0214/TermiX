import { createStore } from 'zustand/vanilla';
import { KubernetesAPI } from './KubernetesAPI.js';
import { createResourceTemplate, KUBERNETES_CREATE_RESOURCE_TYPES } from './KubernetesResourceTemplates.js';
import { showToast } from '../../components/feedback/toast.js';
import { t } from '../../i18n/index.ts';

// 讀取全域設定中的「預設 namespace」偏好（由 ThemeStore 持久化於 localStorage）。
// 直接讀 localStorage 而非 import ThemeStore，避免耦合其相依鏈。'*' = All、具體名稱 = 單選、'' = 未設定。
function readDefaultNamespacePreference() {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('termix-global-settings') : null;
    if (!raw) return '';
    return String(JSON.parse(raw)?.defaultNamespace || '').trim();
  } catch {
    return '';
  }
}

export const KUBERNETES_SESSION_ID = 'kubernetes-tab';

const CREATE_RESOURCE_INITIAL_STATE = Object.freeze({
  createOpen: false,
  createResourceType: 'Pod',
  createResourceYAML: '',
  createLoading: false,
  createError: '',
  createSaving: false,
  createSaveError: '',
  createSavedPath: ''
});

const INITIAL_STATE = Object.freeze({
  sessionOpen: false,
  connectionStatus: 'idle',
  connectedCluster: null,
  selectedNamespace: '',
  // 多選 namespace 狀態：陣列存放具體 namespace 名稱，空陣列 = All Namespaces。
  // selectedNamespace 仍保留供既有單一 namespace 操作（logs / create 預設 /
  // resource detail）相容：等於 selectedNamespaces.length === 1 時的該值，否則為 ''。
  selectedNamespaces: [],
  activeSection: 'overview',
  loadError: '',
  dashboard: null,
  namespaces: [],
  dashboardLoading: false,
  dashboardError: '',
  lastUpdatedAt: '',
  detailOpen: false,
  detailLoading: false,
  // 相關事件改為抽屜開啟後非同步延後載入，獨立於 detail 載入。
  eventsLoading: false,
  detailError: '',
  detailTab: 'overview',
  selectedResource: null,
  resourceDetail: null,
  podLogs: '',
  logsTruncated: false,
  logsLoading: false,
  logsError: '',
  logOptions: null,
  podForwards: [],
  forwardsLoading: false,
  forwardsError: '',
  deleteLoading: false,
  deleteError: '',
  // 調整副本數（ScaleKubernetesResource）狀態。
  scaleLoading: false,
  scaleError: '',
  // 資源 YAML 編輯套用（UpdateKubernetesResource）狀態。
  updateLoading: false,
  updateError: '',
  podActionView: null,
  ...CREATE_RESOURCE_INITIAL_STATE
});

function errorMessage(error) {
  return error?.message || String(error) || t('k8s.err.connectFailed');
}

function createConnectRequest(cluster) {
  const source = cluster && typeof cluster === 'object' ? cluster : {};
  const clusterId = String(source.clusterId || source.id || '').trim();
  if (!clusterId) throw new Error(t('k8s.err.missingClusterId'));

  return {
    clusterId,
    displayName: String(source.displayName || '').trim(),
    contextName: String(source.contextName || '').trim(),
    clusterName: String(source.clusterName || '').trim(),
    server: String(source.server || '').trim(),
    kubeconfigPath: String(source.kubeconfigPath || '').trim(),
    namespace: String(source.namespace || '').trim()
  };
}

function normalizeSession(session) {
  if (!session || typeof session !== 'object') return null;
  return {
    ...session,
    sessionId: session.sessionId || KUBERNETES_SESSION_ID
  };
}

function resourceIdentity(kind, item) {
  const source = item && typeof item === 'object' ? item : {};
  const metadata = source.metadata && typeof source.metadata === 'object' ? source.metadata : {};
  const normalizedKind = String(kind || source.kind || '').trim().toLowerCase();
  const name = String(source.name || metadata.name || '').trim();
  const namespace = String(source.namespace || metadata.namespace || '').trim();
  // apiVersion：優先取傳入 item 的 apiVersion（列點擊會帶入），否則沿用 source 內既有值。
  const apiVersion = String(source.apiVersion || metadata.apiVersion || '').trim();
  if (!normalizedKind) throw new Error(t('k8s.err.missingKind'));
  if (!name) throw new Error(t('k8s.err.missingName'));
  return { ...source, kind: normalizedKind, name, namespace, apiVersion };
}

function normalizeLogOptions(options, selectedResource, selectedNamespace) {
  const source = options && typeof options === 'object' ? options : {};
  const resource = selectedResource && typeof selectedResource === 'object' ? selectedResource : {};
  const podName = String(source.podName || resource.name || '').trim();
  if (!podName) throw new Error(t('k8s.err.missingLogsPodName'));
  const tailLines = source.tailLines === undefined || source.tailLines === null || source.tailLines === ''
    ? 200
    : Number(source.tailLines);
  if (!Number.isInteger(tailLines) || tailLines < 1 || tailLines > 1000) {
    throw new Error(t('k8s.err.tailLinesRange'));
  }
  return {
    namespace: String(source.namespace || resource.namespace || selectedNamespace || 'default').trim(),
    podName,
    container: String(source.container || '').trim(),
    previous: Boolean(source.previous),
    tailLines
  };
}

function logsContent(payload) {
  if (typeof payload === 'string') return payload;
  if (!payload || typeof payload !== 'object') return '';
  return String(payload.logs ?? payload.content ?? '');
}

function podRequest(state) {
  const resource = state.selectedResource || {};
  if (String(resource.kind || '').toLowerCase() !== 'pod' || !resource.name) {
    throw new Error(t('k8s.err.noPodSelected'));
  }
  return {
    namespace: String(resource.namespace || state.selectedNamespace || 'default').trim(),
    podName: String(resource.name).trim()
  };
}

function serviceRequest(state) {
  const resource = state.selectedResource || {};
  if (String(resource.kind || '').toLowerCase() !== 'service' || !resource.name) {
    throw new Error(t('k8s.err.noServiceSelected'));
  }
  return {
    namespace: String(resource.namespace || state.selectedNamespace || 'default').trim(),
    serviceName: String(resource.name).trim()
  };
}

function resourceDeleteRequest(state) {
  const resource = state.selectedResource || {};
  const kind = String(resource.kind || state.resourceDetail?.kind || '').trim().toLowerCase();
  const name = String(resource.name || state.resourceDetail?.name || '').trim();
  if (!kind || !name) throw new Error(t('k8s.err.noResourceSelected'));
  return {
    kind,
    name,
    namespace: String(resource.namespace || state.resourceDetail?.namespace || state.selectedNamespace || '').trim(),
    uid: String(state.resourceDetail?.uid || resource.uid || '').trim(),
    // apiVersion：優先取 detail 回傳值，否則沿用列點擊帶入的 selectedResource.apiVersion。
    apiVersion: String(state.resourceDetail?.apiVersion || resource.apiVersion || '').trim()
  };
}

function dashboardKeyForKind(kind) {
  if (!kind) return null;
  const k = String(kind).toLowerCase();
  switch (k) {
    case 'node': return 'nodes';
    case 'pod': return 'pods';
    case 'deployment': return 'deployments';
    case 'statefulset': return 'statefulSets';
    case 'service': return 'services';
    case 'ingress': return 'ingresses';
    case 'persistentvolumeclaim': return 'persistentVolumeClaims';
    case 'persistentvolume': return 'persistentVolumes';
    case 'storageclass': return 'storageClasses';
    default: return null;
  }
}

// 把任意輸入正規化成「具體 namespace 名稱」的去重複陣列（過濾 All 標記 '*' 與空值）。
function normalizeNamespaceList(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const result = [];
  for (const raw of list) {
    const value = String(raw ?? '').trim();
    if (!value || value === '*') continue;
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

// dashboard 一律以 '*' 抓取（記憶體恆有全 namespace 資料），namespace 選取改由前端過濾，
// 讓切換 namespace 能即時呈現、不必每次重抓。selectedNamespace 為相容欄位（恰好選 1 個 → 該值）。
function deriveNamespaceState(selectedNamespaces) {
  const list = normalizeNamespaceList(selectedNamespaces);
  return { selectedNamespaces: list, fetchNamespace: '*', selectedNamespace: list.length === 1 ? list[0] : '' };
}

export function createKubernetesSessionStore(api = KubernetesAPI) {
  let sessionRequestVersion = 0;
  let dashboardRequestVersion = 0;
  let detailRequestVersion = 0;
  let logsRequestVersion = 0;
  let forwardRequestVersion = 0;
  let createRequestVersion = 0;

  function invalidateResourceRequests() {
    detailRequestVersion += 1;
    logsRequestVersion += 1;
    forwardRequestVersion += 1;
    createRequestVersion += 1;
  }

  return createStore((set, get) => ({
    ...INITIAL_STATE,

    connectCluster: async (cluster) => {
      let request;
      try {
        request = createConnectRequest(cluster);
      } catch (error) {
        set({
          connectionStatus: get().sessionOpen ? 'connected' : 'error',
          loadError: errorMessage(error)
        });
        throw error;
      }

      const requestVersion = ++sessionRequestVersion;
      set({ connectionStatus: 'connecting', loadError: '' });
      try {
        const session = normalizeSession(await api.connectCluster(request));
        if (!session) throw new Error(t('k8s.err.noSession'));
        if (requestVersion !== sessionRequestVersion) return session;
        dashboardRequestVersion += 1;
        invalidateResourceRequests();
        // 初始 namespace 篩選：設定的全域「預設 namespace」為明確值時優先（'*' = All Namespaces、
        // 具體名稱 = 單選該 namespace），可覆蓋 kubeconfig context 的 namespace；未設定（空）則沿用
        // 叢集 session 的 namespace（既有行為）。
        const nsPreference = readDefaultNamespacePreference();
        const initialNamespaces = nsPreference
          ? normalizeNamespaceList([nsPreference])
          : normalizeNamespaceList([session.namespace || request.namespace || '']);
        const derivedNamespaces = deriveNamespaceState(initialNamespaces);
        set({
          sessionOpen: true,
          connectionStatus: 'connected',
          connectedCluster: session,
          selectedNamespace: derivedNamespaces.selectedNamespace,
          selectedNamespaces: derivedNamespaces.selectedNamespaces,
          activeSection: 'overview',
          loadError: '',
          dashboard: null,
          namespaces: [],
          dashboardLoading: false,
          dashboardError: '',
          lastUpdatedAt: '',
          detailOpen: false,
          detailLoading: false,
          detailError: '',
          detailTab: 'overview',
          selectedResource: null,
          resourceDetail: null,
          podLogs: '',
          logsTruncated: false,
          logsLoading: false,
          logsError: '',
          logOptions: null,
          podForwards: [],
          forwardsLoading: false,
          forwardsError: '',
          deleteLoading: false,
          deleteError: '',
          podActionView: null,
          ...CREATE_RESOURCE_INITIAL_STATE
        });
        // 後端連線時已把 kubeconfig current-context 切到該 context；重載 cluster
        // 清單讓 KubernetesPage 的「目前使用中」徽章即時反映。以動態 import 取用
        // kubernetesStore 以避免 store 之間的循環相依；重載失敗不影響連線流程。
        import('./KubernetesStore.js')
          .then(({ kubernetesStore }) => kubernetesStore.getState().reloadClusters())
          .catch(() => {});
        // 連線成功即以輕量 API 填充 namespace 篩選下拉，不必等整包 dashboard（大叢集很慢）。
        get().loadNamespaces();
        return session;
      } catch (error) {
        if (requestVersion === sessionRequestVersion) {
          set({
            connectionStatus: get().sessionOpen ? 'connected' : 'error',
            loadError: errorMessage(error)
          });
        }
        throw error;
      }
    },

    switchCluster: async (cluster) => get().connectCluster(cluster),

    restoreSession: async () => {
      const requestVersion = ++sessionRequestVersion;
      set({ connectionStatus: 'connecting', loadError: '' });
      try {
        const session = normalizeSession(await api.getActiveSession());
        if (requestVersion !== sessionRequestVersion) return session;
        if (!session) {
          dashboardRequestVersion += 1;
          invalidateResourceRequests();
          set({ ...INITIAL_STATE });
          return null;
        }
        dashboardRequestVersion += 1;
        invalidateResourceRequests();
        set({
          sessionOpen: true,
          connectionStatus: 'connected',
          connectedCluster: session,
          selectedNamespace: String(session.namespace || ''),
          // 還原 session 時同樣以其預設 namespace 作為初始單選（無則為 All Namespaces）。
          selectedNamespaces: normalizeNamespaceList([session.namespace || '']),
          activeSection: 'overview',
          loadError: '',
          dashboard: null,
          namespaces: [],
          dashboardLoading: false,
          dashboardError: '',
          lastUpdatedAt: '',
          detailOpen: false,
          detailLoading: false,
          detailError: '',
          detailTab: 'overview',
          selectedResource: null,
          resourceDetail: null,
          podLogs: '',
          logsTruncated: false,
          logsLoading: false,
          logsError: '',
          logOptions: null,
          podForwards: [],
          forwardsLoading: false,
          forwardsError: '',
          deleteLoading: false,
          deleteError: '',
          podActionView: null,
          ...CREATE_RESOURCE_INITIAL_STATE
        });
        return session;
      } catch (error) {
        if (requestVersion === sessionRequestVersion) {
          set({ connectionStatus: 'error', loadError: errorMessage(error) });
        }
        throw error;
      }
    },

    disconnect: async () => {
      const requestVersion = ++sessionRequestVersion;
      try {
        await api.disconnectCluster();
        if (requestVersion !== sessionRequestVersion) return;
        dashboardRequestVersion += 1;
        invalidateResourceRequests();
        set({ ...INITIAL_STATE });
      } catch (error) {
        if (requestVersion === sessionRequestVersion) {
          set({ connectionStatus: 'error', loadError: errorMessage(error) });
        }
        throw error;
      }
    },

    // 只載入 namespace 名稱清單（輕量），與整包 dashboard 解耦，讓篩選下拉快速可用。
    loadNamespaces: async () => {
      if (!get().connectedCluster) return;
      try {
        const names = await api.listNamespaces();
        if (Array.isArray(names) && names.length) set({ namespaces: names });
      } catch (error) {
        // 靜默失敗：dashboard 快照仍會補上 namespace 清單。
      }
    },

    loadDashboard: async (namespace = get().selectedNamespace, scope = '') => {
      if (!get().connectedCluster) throw new Error(t('k8s.err.notConnected'));
      const targetNamespace = String(namespace || get().connectedCluster.namespace || 'default');
      const requestVersion = ++dashboardRequestVersion;
      set({ dashboardLoading: true, dashboardError: '' });
      try {
        const dashboard = await api.getDashboard(targetNamespace, scope);
        if (!dashboard || typeof dashboard !== 'object') {
          throw new Error(t('k8s.err.noDashboard'));
        }
        if (requestVersion !== dashboardRequestVersion) return dashboard;
        // 保留現有多選狀態。selectedNamespace（相容欄位）：
        // 僅在「真正多選」（>=2 個具體 namespace，此時抓取用 '*'）時才強制為 ''；
        // 其餘情況（All 或單選，含直接呼叫 loadDashboard(ns)）沿用舊行為，
        // 採後端回傳的 namespace，以維持既有單一 namespace 操作不回歸。
        const currentSelected = normalizeNamespaceList(get().selectedNamespaces);
        const compatNamespace = currentSelected.length >= 2
          ? ''
          : String(dashboard.namespace || targetNamespace);
        set({
          dashboard,
          namespaces: (Array.isArray(dashboard.namespaces) && dashboard.namespaces.length) ? dashboard.namespaces : get().namespaces,
          selectedNamespaces: currentSelected,
          selectedNamespace: compatNamespace,
          dashboardLoading: false,
          dashboardError: '',
          lastUpdatedAt: String(dashboard.generatedAt || new Date().toISOString())
        });
        return dashboard;
      } catch (error) {
        if (requestVersion === dashboardRequestVersion) {
          set({ dashboardLoading: false, dashboardError: errorMessage(error) });
        }
        throw error;
      }
    },

    // 首屏漸進載入：尚無資料時先抓 core（Overview 所需，快速回應）讓畫面先出，
    // 再抓 full 補齊其餘 section；已有資料則直接抓 full。core 失敗不阻擋 full。
    loadDashboardProgressive: async (namespace = get().selectedNamespace) => {
      if (get().dashboard) return get().loadDashboard(namespace);
      try {
        await get().loadDashboard(namespace, 'core');
      } catch {
        // core 失敗（例如逾時）就交給後續 full 載入補救，不中斷流程。
      }
      return get().loadDashboard(namespace);
    },

    refreshDashboard: async () => {
      // 抓取所用 namespace 由多選狀態推導：恰好選 1 個 → 該 namespace；否則 '*' 抓全部。
      const { fetchNamespace } = deriveNamespaceState(get().selectedNamespaces);
      return get().loadDashboard(fetchNamespace || get().selectedNamespace);
    },
    selectNamespace: async (namespace) => {
      // 相容既有單選 API：'*'（All）→ 清空多選陣列；其他 → 設為單一元素陣列。
      const value = String(namespace || 'default');
      const nextSelected = value === '*' ? [] : normalizeNamespaceList([value]);
      const derived = deriveNamespaceState(nextSelected);
      // 純前端過濾：立即更新選取即重繪呈現；dashboard 已是 '*' 全 namespace 資料，不重抓。
      set({ selectedNamespaces: derived.selectedNamespaces, selectedNamespace: derived.selectedNamespace });
      if (!get().dashboard) return get().loadDashboardProgressive('*');
      return get().dashboard;
    },
    // 多選：設定完整的 namespace 清單（空陣列 = All Namespaces）。純前端過濾、不重抓。
    setSelectedNamespaces: async (list) => {
      const derived = deriveNamespaceState(list);
      set({ selectedNamespaces: derived.selectedNamespaces, selectedNamespace: derived.selectedNamespace });
      if (!get().dashboard) return get().loadDashboardProgressive('*');
      return get().dashboard;
    },
    // 多選：切換單一 namespace 的勾選狀態（勾任一具體 namespace 會自動取消 All）。
    toggleNamespace: async (namespace) => {
      const value = String(namespace || '').trim();
      if (!value || value === '*') return get().setSelectedNamespaces([]);
      const current = normalizeNamespaceList(get().selectedNamespaces);
      const next = current.includes(value)
        ? current.filter(item => item !== value)
        : [...current, value];
      return get().setSelectedNamespaces(next);
    },
    // 多選：選 All Namespaces（清空具體選取）。
    selectAllNamespaces: async () => get().setSelectedNamespaces([]),
    selectSection: (section) => set({ activeSection: String(section || 'overview'), podActionView: null }),

    openPodLogsView: async (pod, container) => {
      const selectedResource = resourceIdentity('pod', pod);
      const containerName = String(container || selectedResource.containers?.[0]?.name || '').trim();
      if (!containerName) throw new Error(t('k8s.err.noLogsContainer'));
      set({
        selectedResource,
        podActionView: { type: 'logs', container: containerName },
        podLogs: '', logsLoading: true, logsError: '', logsTruncated: false,
        logOptions: { namespace: selectedResource.namespace, podName: selectedResource.name, container: containerName, previous: false, tailLines: 500 }
      });
      return get().loadPodLogs({ container: containerName, tailLines: 500 });
    },

    closePodActionView: () => set({ podActionView: null, selectedResource: null, podLogs: '', logsError: '', logsLoading: false }),

    openPodForwardFromSummary: async (pod) => {
      const selectedResource = resourceIdentity('pod', pod);
      const containers = (selectedResource.containers || []).map(container => ({ ...container, image: '', ready: selectedResource.phase === 'Running' }));
      set({
        selectedResource,
        resourceDetail: { kind: 'Pod', name: selectedResource.name, namespace: selectedResource.namespace, uid: selectedResource.uid || '', containers },
        detailOpen: true, detailLoading: false, detailError: '', detailTab: 'forward', podForwards: [], forwardsError: ''
      });
      return get().loadPodPortForwards();
    },

    openResource: async (kind, item) => {
      if (!get().connectedCluster) throw new Error(t('k8s.err.notConnected'));
      let selectedResource;
      try {
        selectedResource = resourceIdentity(kind, item);
      } catch (error) {
        set({ detailError: errorMessage(error) });
        throw error;
      }

      const requestVersion = ++detailRequestVersion;
      logsRequestVersion += 1;
      forwardRequestVersion += 1;
      createRequestVersion += 1;
      set({
        detailOpen: true,
        detailLoading: true,
        eventsLoading: true,
        detailError: '',
        detailTab: 'overview',
        selectedResource,
        resourceDetail: null,
        podLogs: '',
        logsTruncated: false,
        logsLoading: false,
        logsError: '',
        logOptions: null,
        podForwards: [],
        forwardsLoading: false,
        forwardsError: '',
        deleteLoading: false,
        deleteError: '',
        updateLoading: false,
        updateError: '',
        ...CREATE_RESOURCE_INITIAL_STATE
      });
      try {
        const detail = await api.getResourceDetail({
          kind: selectedResource.kind,
          name: selectedResource.name,
          namespace: selectedResource.namespace,
          apiVersion: selectedResource.apiVersion || ''
        });
        if (!detail || typeof detail !== 'object') {
          throw new Error(t('k8s.err.noResourceDetail'));
        }
        if (requestVersion !== detailRequestVersion) return detail;
        set({ resourceDetail: detail, detailLoading: false, detailError: '' });
        // detail 到手即開抽屜；相關事件背景載入，好了再併入（不阻塞抽屜顯示）。
        get().loadResourceEvents(detail, requestVersion).catch(() => {});
        return detail;
      } catch (error) {
        if (requestVersion === detailRequestVersion) {
          set({ detailLoading: false, eventsLoading: false, detailError: errorMessage(error) });
        }
        throw error;
      }
    },

    // 非同步載入資源相關事件並併入目前 resourceDetail；以 detailRequestVersion 防過期覆蓋。
    loadResourceEvents: async (detail, version) => {
      if (!detail) return;
      set({ eventsLoading: true });
      try {
        const res = await api.getResourceEvents({
          kind: detail.kind || '', name: detail.name || '', namespace: detail.namespace || '', uid: detail.uid || ''
        });
        if (version !== detailRequestVersion) return;
        const current = get().resourceDetail;
        if (!current) return;
        set({
          resourceDetail: { ...current, events: Array.isArray(res?.events) ? res.events : [], eventsError: res?.eventsError || '' },
          eventsLoading: false
        });
      } catch (error) {
        if (version !== detailRequestVersion) return;
        set({ eventsLoading: false });
        console.error('[Kubernetes][Store][Events] 載入資源事件失敗', error);
      }
    },

    closeResourceDetail: () => {
      invalidateResourceRequests();
      set({
        detailOpen: false,
        detailLoading: false,
        detailError: '',
        detailTab: 'overview',
        selectedResource: null,
        resourceDetail: null,
        podLogs: '',
        logsTruncated: false,
        logsLoading: false,
        logsError: '',
        logOptions: null,
        podForwards: [],
        forwardsLoading: false,
        forwardsError: '',
        deleteLoading: false,
        deleteError: '',
        updateLoading: false,
        updateError: ''
      });
    },

    selectDetailTab: (tab) => {
      const allowed = new Set(['overview', 'env', 'yaml', 'logs', 'forward', 'delete']);
      const value = String(tab || '').toLowerCase();
      set({ detailTab: allowed.has(value) ? value : 'overview' });
    },

    openCreateResource: () => {
      if (!get().connectedCluster) throw new Error(t('k8s.err.notConnected'));
      invalidateResourceRequests();
      const namespace = get().selectedNamespace === '*' ? 'default' : (get().selectedNamespace || 'default');
      set({
        detailOpen: false,
        detailLoading: false,
        detailError: '',
        selectedResource: null,
        resourceDetail: null,
        createOpen: true,
        createResourceType: 'Pod',
        createResourceYAML: createResourceTemplate('Pod', namespace),
        createLoading: false,
        createError: '',
        createSaving: false,
        createSaveError: '',
        createSavedPath: ''
      });
    },

    closeCreateResource: () => {
      createRequestVersion += 1;
      set({ ...CREATE_RESOURCE_INITIAL_STATE });
    },

    selectCreateResourceType: (resourceType) => {
      const type = String(resourceType || '');
      if (!KUBERNETES_CREATE_RESOURCE_TYPES.includes(type)) {
        set({ createError: t('k8s.err.unsupportedType') });
        return;
      }
      createRequestVersion += 1;
      const namespace = get().selectedNamespace === '*' ? 'default' : (get().selectedNamespace || 'default');
      set({
        createResourceType: type,
        createResourceYAML: createResourceTemplate(type, namespace),
        createLoading: false,
        createError: '',
        createSaving: false,
        createSaveError: '',
        createSavedPath: ''
      });
    },

    saveCreateResourceYAML: async (yamlContent) => {
      const content = String(yamlContent ?? get().createResourceYAML).trim();
      if (!content) {
        const error = new Error(t('k8s.err.yamlEmpty'));
        set({ createSaveError: error.message });
        throw error;
      }
      if (new TextEncoder().encode(content).length > 1024 * 1024) {
        const error = new Error(t('k8s.err.yamlTooLarge'));
        set({ createSaveError: error.message });
        throw error;
      }
      const filenameType = String(get().createResourceType || 'resource')
        .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
        .toLowerCase();
      const requestVersion = ++createRequestVersion;
      set({
        createResourceYAML: content,
        createSaving: true,
        createSaveError: '',
        createSavedPath: ''
      });
      try {
        const path = String(await api.saveResourceYAML(`termix-${filenameType}.yaml`, content) || '');
        if (requestVersion !== createRequestVersion) return path;
        set({ createSaving: false, createSaveError: '', createSavedPath: path });
        return path;
      } catch (error) {
        if (requestVersion === createRequestVersion) {
          set({ createSaving: false, createSaveError: errorMessage(error), createSavedPath: '' });
        }
        throw error;
      }
    },

    applyCreateResource: async (yamlContent) => {
      const content = String(yamlContent ?? get().createResourceYAML).trim();
      if (!content) {
        const error = new Error(t('k8s.err.yamlEmpty'));
        set({ createError: error.message });
        throw error;
      }
      if (new TextEncoder().encode(content).length > 1024 * 1024) {
        const error = new Error(t('k8s.err.yamlTooLarge'));
        set({ createError: error.message });
        throw error;
      }
      const requestVersion = ++createRequestVersion;
      const namespace = get().selectedNamespace === '*' ? 'default' : (get().selectedNamespace || 'default');
      const request = {
        resourceType: get().createResourceType,
        namespace,
        yaml: content
      };
      set({ createResourceYAML: content, createLoading: true, createError: '' });
      try {
        const result = await api.createResource(request);
        if (requestVersion !== createRequestVersion) return result;
        set({ ...CREATE_RESOURCE_INITIAL_STATE });
        showToast(t('k8s.toast.applied', { type: request.resourceType, namespace }), { type: 'success', title: t('k8s.toast.applyTitle') });
        get().refreshDashboard().catch(() => {});
        return result;
      } catch (error) {
        if (requestVersion === createRequestVersion) {
          set({ createLoading: false, createError: errorMessage(error) });
        }
        throw error;
      }
    },

    loadPodLogs: async (options = {}) => {
      if (!get().connectedCluster) throw new Error(t('k8s.err.notConnected'));
      let request;
      try {
        request = normalizeLogOptions(options, get().selectedResource, get().selectedNamespace);
      } catch (error) {
        set({ logsError: errorMessage(error) });
        throw error;
      }

      const requestVersion = ++logsRequestVersion;
      set({ logsLoading: true, logsError: '', logOptions: request });
      try {
        const payload = await api.getPodLogs(request);
        if (requestVersion !== logsRequestVersion) return payload;
        set({
          podLogs: logsContent(payload),
          logsTruncated: Boolean(payload && typeof payload === 'object' && payload.truncated),
          logsLoading: false,
          logsError: ''
        });
        return payload;
      } catch (error) {
        if (requestVersion === logsRequestVersion) {
          set({ logsLoading: false, logsError: errorMessage(error) });
        }
        throw error;
      }
    },

    clearPodLogs: () => {
      logsRequestVersion += 1;
      set({ podLogs: '', logsTruncated: false, logsLoading: false, logsError: '', logOptions: null });
    },

    loadPodPortForwards: async () => {
      let request;
      try {
        request = podRequest(get());
      } catch (error) {
        set({ forwardsError: errorMessage(error) });
        throw error;
      }
      const requestVersion = ++forwardRequestVersion;
      set({ forwardsLoading: true, forwardsError: '' });
      try {
        const payload = await api.listPodPortForwards(request);
        const forwards = Array.isArray(payload) ? payload : [];
        if (requestVersion !== forwardRequestVersion) return forwards;
        set({ podForwards: forwards, forwardsLoading: false, forwardsError: '' });
        return forwards;
      } catch (error) {
        if (requestVersion === forwardRequestVersion) {
          set({ forwardsLoading: false, forwardsError: errorMessage(error) });
        }
        throw error;
      }
    },

    startPodPortForward: async ({ localPort, remotePort }) => {
      let request;
      try {
        request = {
          ...podRequest(get()),
          localPort: Number(localPort),
          remotePort: Number(remotePort)
        };
        if (!Number.isInteger(request.localPort) || request.localPort < 0 || request.localPort > 65535 ||
            !Number.isInteger(request.remotePort) || request.remotePort < 1 || request.remotePort > 65535) {
          throw new Error(t('k8s.err.portFormat'));
        }
      } catch (error) {
        set({ forwardsError: errorMessage(error) });
        throw error;
      }
      const requestVersion = ++forwardRequestVersion;
      set({ forwardsLoading: true, forwardsError: '' });
      try {
        const forward = await api.startPodPortForward(request);
        if (requestVersion !== forwardRequestVersion) return forward;
        set(state => ({
          podForwards: forward ? [...state.podForwards.filter(item => item.id !== forward.id), forward] : state.podForwards,
          forwardsLoading: false,
          forwardsError: ''
        }));
        return forward;
      } catch (error) {
        if (requestVersion === forwardRequestVersion) {
          set({ forwardsLoading: false, forwardsError: errorMessage(error) });
        }
        throw error;
      }
    },

    openServiceForwardFromSummary: async (service) => {
      const selectedResource = resourceIdentity('service', service);
      set({
        selectedResource,
        resourceDetail: { kind: 'Service', name: selectedResource.name, namespace: selectedResource.namespace, uid: selectedResource.uid || '' },
        detailOpen: true, detailLoading: false, detailError: '', detailTab: 'forward', podForwards: [], forwardsError: ''
      });
      return get().loadServicePortForwards();
    },

    loadServicePortForwards: async () => {
      let request;
      try {
        request = serviceRequest(get());
      } catch (error) {
        set({ forwardsError: errorMessage(error) });
        throw error;
      }
      const requestVersion = ++forwardRequestVersion;
      set({ forwardsLoading: true, forwardsError: '' });
      try {
        const payload = await api.listServicePortForwards(request);
        const forwards = Array.isArray(payload) ? payload : [];
        if (requestVersion !== forwardRequestVersion) return forwards;
        set({ podForwards: forwards, forwardsLoading: false, forwardsError: '' });
        return forwards;
      } catch (error) {
        if (requestVersion === forwardRequestVersion) {
          set({ forwardsLoading: false, forwardsError: errorMessage(error) });
        }
        throw error;
      }
    },

    startServicePortForward: async ({ localPort, remotePort }) => {
      let request;
      try {
        request = {
          ...serviceRequest(get()),
          localPort: Number(localPort),
          remotePort: Number(remotePort)
        };
        if (!Number.isInteger(request.localPort) || request.localPort < 0 || request.localPort > 65535 ||
            !Number.isInteger(request.remotePort) || request.remotePort < 1 || request.remotePort > 65535) {
          throw new Error(t('k8s.err.portFormat'));
        }
      } catch (error) {
        set({ forwardsError: errorMessage(error) });
        throw error;
      }
      const requestVersion = ++forwardRequestVersion;
      set({ forwardsLoading: true, forwardsError: '' });
      try {
        const forward = await api.startServicePortForward(request);
        if (requestVersion !== forwardRequestVersion) return forward;
        set(state => ({
          podForwards: forward ? [...state.podForwards.filter(item => item.id !== forward.id), forward] : state.podForwards,
          forwardsLoading: false,
          forwardsError: ''
        }));
        return forward;
      } catch (error) {
        if (requestVersion === forwardRequestVersion) {
          set({ forwardsLoading: false, forwardsError: errorMessage(error) });
        }
        throw error;
      }
    },

    stopPodPortForward: async (id) => {
      const value = String(id || '').trim();
      if (!value) throw new Error(t('k8s.err.missingForwardId'));
      const requestVersion = ++forwardRequestVersion;
      set({ forwardsLoading: true, forwardsError: '' });
      try {
        await api.stopPodPortForward({ id: value });
        if (requestVersion !== forwardRequestVersion) return;
        set(state => ({
          podForwards: state.podForwards.filter(item => item.id !== value),
          forwardsLoading: false,
          forwardsError: ''
        }));
      } catch (error) {
        if (requestVersion === forwardRequestVersion) {
          set({ forwardsLoading: false, forwardsError: errorMessage(error) });
        }
        throw error;
      }
    },

    deleteSelectedResource: async () => {
      let request;
      try {
        request = resourceDeleteRequest(get());
      } catch (error) {
        console.error('[Kubernetes][Store][Delete] 建立刪除請求失敗', error);
        set({ deleteError: errorMessage(error) });
        throw error;
      }
      set({ deleteLoading: true, deleteError: '' });
      try {
        if (typeof api.deleteResource === 'function') {
          await api.deleteResource(request);
        } else if (request.kind === 'pod') {
          await api.deletePod({ namespace: request.namespace, podName: request.name, uid: request.uid });
        } else {
          throw new Error(t('k8s.err.missingDeleteApi'));
        }
        const deletedId = `${request.kind}${request.namespace ? `/${request.namespace}` : ''}/${request.name}`;
        showToast(t('k8s.toast.deleted', { id: deletedId }), { type: 'success', title: t('k8s.toast.deleteTitle') });

        // 刪除成功後，立即從本地 dashboard 快照移除被刪除的資源
        const dashboard = get().dashboard;
        if (dashboard) {
          const updated = { ...dashboard };
          const matchKey = dashboardKeyForKind(request.kind);
          if (matchKey && Array.isArray(updated[matchKey])) {
            updated[matchKey] = updated[matchKey].filter(item =>
              !(item.name === request.name && (item.namespace || '') === (request.namespace || ''))
            );
          }
          set({ dashboard: updated });
        }

        const current = get().selectedResource || {};
        if (current.name === request.name && String(current.kind || '').toLowerCase() === request.kind) {
          get().closeResourceDetail();
        } else {
          set({ deleteLoading: false, deleteError: '' });
        }
        get().refreshDashboard().catch(() => {});
      } catch (error) {
        const current = get().selectedResource || {};
        if (current.name === request.name && String(current.kind || '').toLowerCase() === request.kind) {
          set({ deleteLoading: false, deleteError: errorMessage(error) });
        }
        console.error('[Kubernetes][Store][Delete] 後端 API 呼叫失敗', {
          kind: request?.kind,
          name: request?.name,
          namespace: request?.namespace || '',
          error
        });
        throw error;
      }
    },

    // 批量刪除：逐筆呼叫既有刪除 API，收集成功/失敗；成功項即時從本地快照移除，
    // 最後統一 refreshDashboard。回傳 { ok, fail } 供 UI 顯示彙總並保留失敗項的勾選。
    // list 每項：{ kind, name, namespace, apiVersion }（kind 不分大小寫）。彙總 toast 由 UI 端負責。
    batchDeleteResources: async (list) => {
      const targets = (Array.isArray(list) ? list : [])
        .map(item => ({
          kind: String(item?.kind || '').trim().toLowerCase(),
          name: String(item?.name || '').trim(),
          namespace: String(item?.namespace || '').trim(),
          apiVersion: String(item?.apiVersion || '').trim(),
          uid: ''
        }))
        .filter(item => item.kind && item.name);
      if (!targets.length) return { ok: [], fail: [] };

      set({ deleteLoading: true, deleteError: '' });
      const ok = [];
      const fail = [];
      for (const request of targets) {
        try {
          if (typeof api.deleteResource === 'function') {
            await api.deleteResource(request);
          } else if (request.kind === 'pod') {
            await api.deletePod({ namespace: request.namespace, podName: request.name, uid: request.uid });
          } else {
            throw new Error(t('k8s.err.missingDeleteApi'));
          }
          ok.push(request);
        } catch (error) {
          console.error('[Kubernetes][Store][BatchDelete] 刪除失敗', { kind: request.kind, name: request.name, namespace: request.namespace, error });
          fail.push(request);
        }
      }

      // 成功項即時從本地 dashboard 快照移除（僅限有對應 key 的 kind；其餘靠 refresh 補上）。
      if (ok.length) {
        const dashboard = get().dashboard;
        if (dashboard) {
          const updated = { ...dashboard };
          for (const request of ok) {
            const matchKey = dashboardKeyForKind(request.kind);
            if (matchKey && Array.isArray(updated[matchKey])) {
              updated[matchKey] = updated[matchKey].filter(item =>
                !(item.name === request.name && (item.namespace || '') === (request.namespace || ''))
              );
            }
          }
          set({ dashboard: updated });
        }
        // 若目前於 Drawer 開啟的資源已被刪除，關閉抽屜。
        const current = get().selectedResource || {};
        const currentDeleted = ok.some(r =>
          r.name === current.name
          && r.kind === String(current.kind || '').toLowerCase()
          && (r.namespace || '') === (current.namespace || '')
        );
        if (currentDeleted) get().closeResourceDetail();
      }

      set({ deleteLoading: false, deleteError: '' });
      get().refreshDashboard().catch(() => {});
      return { ok, fail };
    },

    // 調整 Deployment / StatefulSet 副本數：呼叫 ScaleKubernetesResource，
    // 成功後本地快照即時更新 desiredReplicas（readyReplicas 交給 refresh 追上）、toast、refreshDashboard。
    scaleResource: async ({ kind, name, namespace, apiVersion, replicas }) => {
      const k = String(kind || '').trim().toLowerCase();
      const nm = String(name || '').trim();
      const ns = String(namespace || '').trim();
      const target = Math.max(0, Math.floor(Number(replicas)));
      if (!k || !nm) throw new Error(t('k8s.err.noResourceSelected'));
      if (!Number.isFinite(target)) throw new Error(t('k8s.err.noResourceSelected'));
      set({ scaleLoading: true, scaleError: '' });
      try {
        if (typeof api.scaleResource !== 'function') throw new Error(t('k8s.err.missingScaleApi'));
        await api.scaleResource({ kind: k, name: nm, namespace: ns, apiVersion: String(apiVersion || '').trim(), replicas: target });
        const dashboard = get().dashboard;
        if (dashboard) {
          const matchKey = dashboardKeyForKind(k);
          if (matchKey && Array.isArray(dashboard[matchKey])) {
            const updated = { ...dashboard };
            updated[matchKey] = updated[matchKey].map(item =>
              (item.name === nm && (item.namespace || '') === ns) ? { ...item, desiredReplicas: target } : item
            );
            set({ dashboard: updated });
          }
        }
        showToast(t('k8s.toast.scaled', { id: `${k}/${ns ? ns + '/' : ''}${nm}`, replicas: target }), { type: 'success', title: t('k8s.toast.scaleTitle') });
        set({ scaleLoading: false, scaleError: '' });
        get().refreshDashboard().catch(() => {});
      } catch (error) {
        set({ scaleLoading: false, scaleError: errorMessage(error) });
        console.error('[Kubernetes][Store][Scale] 後端 API 呼叫失敗', { kind: k, name: nm, namespace: ns, error });
        throw error;
      }
    },

    deleteSelectedPod: async () => get().deleteSelectedResource(),

    // 套用（更新）目前選取資源的 YAML：呼叫 UpdateKubernetesResource（GVK/name 由 yaml 解析，
    // namespace 用 selectedResource.namespace 作為 fallback）。成功後 toast、重載 detail 並刷新 dashboard。
    applyResourceYAML: async (yamlText) => {
      const content = String(yamlText ?? '').trim();
      if (!content) {
        const error = new Error(t('k8s.err.yamlEmpty'));
        set({ updateError: error.message });
        throw error;
      }
      if (new TextEncoder().encode(content).length > 1024 * 1024) {
        const error = new Error(t('k8s.err.yamlTooLarge'));
        set({ updateError: error.message });
        throw error;
      }
      const selected = get().selectedResource || {};
      const namespace = String(selected.namespace || get().selectedNamespace || '').trim();
      set({ updateLoading: true, updateError: '' });
      try {
        const result = await api.updateResource({ namespace, yaml: content });
        set({ updateLoading: false, updateError: '' });
        showToast(t('k8s.toast.appliedResource', { resource: `${selected.kind || 'resource'}/${selected.name || ''}` }), { type: 'success', title: t('k8s.toast.applyTitle') });
        // 重載 detail 以取得更新後的 resourceVersion / YAML；沿用既有 openResource 流程。
        if (selected.kind && selected.name) {
          get().openResource(selected.kind, selected).catch(() => {});
        }
        get().refreshDashboard().catch(() => {});
        return result;
      } catch (error) {
        set({ updateLoading: false, updateError: errorMessage(error) });
        throw error;
      }
    },

    clearError: () => set({
      loadError: '',
      dashboardError: '',
      detailError: '',
      logsError: '',
      forwardsError: '',
      deleteError: '',
      updateError: '',
      createError: '',
      createSaveError: ''
    })
  }));
}

export const kubernetesSessionStore = createKubernetesSessionStore();

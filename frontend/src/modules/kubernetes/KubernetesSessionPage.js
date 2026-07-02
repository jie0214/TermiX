import { kubernetesSessionStore } from './KubernetesSessionStore.js';
import { KUBERNETES_CREATE_RESOURCE_GROUPS } from './KubernetesResourceTemplates.js';
import { KubernetesAPI } from './KubernetesAPI.js';
import { onWailsEvent } from '../../platform/wails/events.ts';
import { confirmDialog } from '../../components/feedback/confirmDialog';
import { showToast } from '../../components/feedback/toast.js';
import { suppressScrollbarAutohide } from '../../runtime/scrollbarAutohide';
import { Terminal } from '@xterm/xterm';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// 高風險 Kubernetes 資源類型：刪除這些資源影響範圍大且難以復原，
// 因此採用「輸入資源名稱比對」的嚴格確認，而非脆弱的雙擊 + 自動逾時機制。
// 註：Deployment 與 StatefulSet 亦列為高風險——刪除它們會連帶砍光其管理的 Pod，
// 破壞力與其他 controller 相當，故改走輸入名稱確認流程。
// Pod 維持低風險（controller 會自動重建，破壞力低），採兩段點擊確認。
const HIGH_RISK_KUBERNETES_KINDS = new Set([
  'deployment', 'statefulset', 'daemonset', 'replicaset',
  'persistentvolume', 'persistentvolumeclaim', 'pv', 'pvc',
  'namespace', 'node', 'service', 'ingress',
  'configmap', 'secret', 'job', 'cronjob'
]);

function isHighRiskKubernetesKind(kind) {
  return HIGH_RISK_KUBERNETES_KINDS.has(String(kind || '').toLowerCase());
}

const SECTION_GROUPS = [
  ['CLUSTER', [['overview', 'Overview'], ['namespaces', 'Namespaces'], ['nodes', 'Nodes'], ['events', 'Events'], ['customResourceDefinitions', 'CRDs']]],
  ['WORKLOADS', [['pods', 'Pods'], ['deployments', 'Deployments'], ['statefulsets', 'StatefulSets'], ['daemonSets', 'DaemonSets'], ['jobs', 'Jobs'], ['cronJobs', 'CronJobs']]],
  ['CONFIG', [['configMaps', 'ConfigMaps'], ['secrets', 'Secrets']]],
  ['NETWORKING', [['services', 'Services'], ['ingresses', 'Ingresses'], ['endpoints', 'Endpoints'], ['networkPolicies', 'Network Policies']]],
  ['STORAGE', [['persistentVolumeClaims', 'Persistent Volume Claims'], ['persistentVolumes', 'Persistent Volumes'], ['storageClasses', 'Storage Classes']]],
  ['AUTOSCALING & POLICY', [['horizontalPodAutoscalers', 'HPA'], ['podDisruptionBudgets', 'Pod Disruption Budgets'], ['resourceQuotas', 'Resource Quotas']]],
  ['ACCESS CONTROL', [['serviceAccounts', 'Service Accounts'], ['roles', 'Roles'], ['roleBindings', 'Role Bindings'], ['clusterRoles', 'Cluster Roles'], ['clusterRoleBindings', 'Cluster Role Bindings']]]
];
const SECTIONS = SECTION_GROUPS.flatMap(([, sections]) => sections);
const REFRESHABLE_SECTIONS = new Set([
  'namespaces',
  'nodes',
  'pods',
  'deployments',
  'statefulsets',
  'daemonSets',
  'jobs',
  'cronJobs',
  'configMaps',
  'secrets',
  'services',
  'ingresses',
  'endpoints',
  'networkPolicies',
  'persistentVolumeClaims',
  'persistentVolumes',
  'storageClasses',
  'serviceAccounts',
  'roles',
  'roleBindings',
  'clusterRoles',
  'clusterRoleBindings',
  'horizontalPodAutoscalers',
  'podDisruptionBudgets',
  'resourceQuotas',
  'customResourceDefinitions'
]);

// cluster-scoped section：這些資源不受 namespace 篩選影響，故頂部 namespace 多選控制項應 disabled。
const CLUSTER_SCOPED_SECTIONS = new Set([
  'nodes',
  'namespaces',
  'persistentVolumes',
  'storageClasses',
  'clusterRoles',
  'clusterRoleBindings',
  'customResourceDefinitions'
]);

// section → { kind, apiVersion }：涵蓋所有可點開 detail drawer 的資源。
// kind 沿用既有小寫單數命名慣例；apiVersion 為該 GVK 的 group/version（core 為 'v1'）。
const RESOURCE_META = Object.freeze({
  namespaces: { kind: 'namespace', apiVersion: 'v1' },
  nodes: { kind: 'node', apiVersion: 'v1' },
  pods: { kind: 'pod', apiVersion: 'v1' },
  deployments: { kind: 'deployment', apiVersion: 'apps/v1' },
  statefulsets: { kind: 'statefulset', apiVersion: 'apps/v1' },
  daemonSets: { kind: 'daemonset', apiVersion: 'apps/v1' },
  jobs: { kind: 'job', apiVersion: 'batch/v1' },
  cronJobs: { kind: 'cronjob', apiVersion: 'batch/v1' },
  configMaps: { kind: 'configmap', apiVersion: 'v1' },
  secrets: { kind: 'secret', apiVersion: 'v1' },
  services: { kind: 'service', apiVersion: 'v1' },
  ingresses: { kind: 'ingress', apiVersion: 'networking.k8s.io/v1' },
  endpoints: { kind: 'endpoints', apiVersion: 'v1' },
  networkPolicies: { kind: 'networkpolicy', apiVersion: 'networking.k8s.io/v1' },
  persistentVolumeClaims: { kind: 'persistentvolumeclaim', apiVersion: 'v1' },
  persistentVolumes: { kind: 'persistentvolume', apiVersion: 'v1' },
  storageClasses: { kind: 'storageclass', apiVersion: 'storage.k8s.io/v1' },
  horizontalPodAutoscalers: { kind: 'horizontalpodautoscaler', apiVersion: 'autoscaling/v2' },
  podDisruptionBudgets: { kind: 'poddisruptionbudget', apiVersion: 'policy/v1' },
  resourceQuotas: { kind: 'resourcequota', apiVersion: 'v1' },
  serviceAccounts: { kind: 'serviceaccount', apiVersion: 'v1' },
  roles: { kind: 'role', apiVersion: 'rbac.authorization.k8s.io/v1' },
  roleBindings: { kind: 'rolebinding', apiVersion: 'rbac.authorization.k8s.io/v1' },
  clusterRoles: { kind: 'clusterrole', apiVersion: 'rbac.authorization.k8s.io/v1' },
  clusterRoleBindings: { kind: 'clusterrolebinding', apiVersion: 'rbac.authorization.k8s.io/v1' },
  customResourceDefinitions: { kind: 'customresourcedefinition', apiVersion: 'apiextensions.k8s.io/v1' }
});

// 通用 renderResourceTable 用：section → singular kind（由 RESOURCE_META 派生）。
const RESOURCE_KINDS = Object.freeze(
  Object.fromEntries(Object.entries(RESOURCE_META).map(([section, meta]) => [section, meta.kind]))
);

// Pod 依 namespace 上色的調色盤：10 種在深/淺色主題都有足夠對比的顏色，
// 僅用於色點（非文字）。namespaceColor() 以決定性 hash 從此取色。
const NAMESPACE_COLOR_PALETTE = Object.freeze([
  '#2f9e8f', '#3b82c4', '#a855c7', '#d9534f', '#e08e0b',
  '#5fa832', '#c2528a', '#6b7bd6', '#0d9488', '#b45309'
]);

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!bytes) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / (1024 ** index)).toFixed(index > 2 ? 2 : 1)} ${units[index]}`;
}

function formatCPU(value) {
  const milli = Number(value || 0);
  return milli >= 1000 ? `${(milli / 1000).toFixed(2)} cores` : `${milli}m`;
}

function formatAge(value) {
  const timestamp = Date.parse(value || '');
  if (!Number.isFinite(timestamp)) return '-';
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

// 通用表格排序型別推斷：時間欄按 Date.parse、已知數值欄按數值，其餘（未列）為字串。
const NUMERIC_SORT_KEYS = new Set([
  'cpuUsageMilli', 'memoryUsageBytes', 'restarts',
  'readyReplicas', 'desiredReplicas', 'availableReplicas'
]);
// 通用表格中易過長、需截斷 + hover title 的欄位（僅套於「無 formatter」的純文字欄）。
const ELLIPSIS_KEYS = new Set([
  'name', 'clusterIp', 'externalAddresses', 'hosts', 'addresses',
  'volumeName', 'claim', 'provisioner', 'roles'
]);
function sortTypeForKey(key) {
  if (key === 'creationTimestamp') return 'time';
  if (NUMERIC_SORT_KEYS.has(key)) return 'number';
  return '';
}

function percent(used, capacity) {
  const total = Number(capacity || 0);
  if (!total) return 0;
  return Math.min(100, Math.max(0, (Number(used || 0) / total) * 100));
}

function statusBadge(value) {
  const status = String(value || 'Unknown');
  const normalized = status.toLowerCase().replace(/[^a-z]+/g, '-');
  return `<span class="kubernetes-status-badge status-${normalized}">${escapeHtml(status)}</span>`;
}

function dashboardErrorTitle(error, hasSnapshot = false) {
  const message = String(error || '');
  if (/沒有 list 權限|forbidden|RBAC/i.test(message)) return 'Kubernetes RBAC 權限不足';
  if (/認證已失效|unauthorized/i.test(message)) return 'Kubernetes 認證已失效';
  return hasSnapshot ? '重新整理失敗，以下為上次成功資料' : '載入叢集資料失敗';
}

function objectEntries(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== '');
}

function normalizeEntries(value) {
  if (Array.isArray(value)) {
    return value.map(item => Array.isArray(item)
      ? [item[0], item[1]]
      : [item?.name || item?.key || item?.type || '-', item?.value ?? item?.status ?? item?.message ?? '-']);
  }
  return objectEntries(value);
}

function logLevelForLine(line) {
  const value = String(line || '').toLowerCase();
  if (/\b(error|err|fatal|panic|failed|failure)\b/.test(value)) return 'error';
  if (/\b(warn|warning)\b/.test(value)) return 'warning';
  if (/\b(debug|trace)\b/.test(value)) return 'debug';
  if (/\b(info|notice)\b/.test(value)) return 'info';
  return 'info';
}

function splitLogTimestamp(line) {
  const value = String(line || '');
  const match = value.match(/^(\d{4}[-/]\d{2}[-/]\d{2}[T ][^\s]+(?:Z|[+-]\d{2}:?\d{2})?)(\s+)(.*)$/);
  if (!match) return null;
  const normalized = match[1].replace(/\//g, '-');
  const timestamp = Date.parse(normalized);
  if (!Number.isFinite(timestamp)) return null;
  return { timestamp, separator: match[2], message: match[3] };
}

function renderKubernetesIcon(name, size = 14) {
  const icons = {
    search: '<circle cx="11" cy="11" r="7"></circle><path d="m16 16 4 4"></path>',
    filter: '<path d="M4 5h16l-6 7v7l-4 2v-9z"></path>',
    pause: '<path d="M7 5v14"></path><path d="M17 5v14"></path>',
    play: '<path d="m8 5 11 7-11 7z"></path>',
    download: '<path d="M12 3v10"></path><path d="m8 9 4 4 4-4"></path><path d="M5 21h14"></path>',
    sliders: '<path d="M4 6h16"></path><path d="M4 12h16"></path><path d="M4 18h16"></path><circle cx="9" cy="6" r="1.75"></circle><circle cx="15" cy="12" r="1.75"></circle><circle cx="11" cy="18" r="1.75"></circle>',
    trash: '<path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="M6 6l1 14h10l1-14"></path><path d="M10 11v5"></path><path d="M14 11v5"></path>',
    close: '<path d="m5 5 14 14"></path><path d="m19 5-14 14"></path>',
    edit: '<path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"></path>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15V5a2 2 0 0 1 2-2h10"></path>',
    check: '<path d="M20 6 9 17l-5-5"></path>'
  };
  const paths = icons[name] || '';
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg>`;
}

export class KubernetesSessionPage extends HTMLElement {
  constructor() {
    super();
    this.unsubscribe = null;
    this.detailReturnTarget = null;
    this.returnToCreateButton = false;
    this.createYAMLDraft = null;
    this.deleteConfirmInput = '';
    // 低風險資源刪除的兩段確認階段（狀態驅動，避免被背景輪詢重繪重置）。
    this.pendingDeleteConfirm = false;
    // YAML 頁籤本地狀態（不污染 store）：編輯草稿 / 是否編輯中 / 搜尋詞。
    this.yamlEditDraft = null;
    this.yamlEditing = false;
    this.yamlSearchTerm = '';
    this.yamlSearchOpen = false;
    this.podFilter = 'all';
    this.podSearch = '';
    // Events 表的 Type 篩選（純前端、存元件上，輪詢重繪保留）：'all' | 'Warning' | 'Normal'。
    this.eventsTypeFilter = 'all';
    // 資源清單排序狀態（純前端、存元件上，輪詢重繪保留）：
    // { [section]: { key, dir: 'asc' | 'desc' } }；無此鍵＝該 section 無排序（原序）。
    this.tableSort = {};
    // 資源清單通用搜尋詞（純前端、存元件上，避免污染 store）：{ [section]: term }。
    // Pods 沿用既有 this.podSearch，不納入此表。
    this.tableSearch = {};
    // 使用者手動點擊 Refresh 進行中的旗標（純前端）：期間停用按鈕並顯示「更新中…」，
    // 避免重複點擊；成功/失敗都要清除。與背景 3 秒輪詢的 loading 分開，不互相干擾。
    this.manualRefreshing = false;
    this.dashboardTimer = null;
    this.logsTimer = null;
    this.shellTerminal = null;
    this.shellSession = null;
    this.shellResizeObserver = null;
    this.runtimeEventOffs = [];
    this.namespaceSelectInteracting = false;
    this.namespaceInteractionTimer = null;
    this.namespaceDropdownOpen = false;
    // 側邊欄可收合分組：存放目前收合（隱藏子項）的分組名稱；預設全部展開。
    this.collapsedNavGroups = new Set();
    this.handleNamespaceOutsideClick = this.handleNamespaceOutsideClick.bind(this);
    this.logSearch = '';
    this.logRegex = false;
    this.logLevel = 'all';
    this.logPaused = false;
    this.logLineWrap = false;
    this.logTimestampMode = 'off';
    this.logDisplayOptionsOpen = false;
    this.handlePageClick = this.handlePageClick.bind(this);
    this.handlePageKeydown = this.handlePageKeydown.bind(this);
  }

  connectedCallback() {
    this.render();
    this.setupListeners();
    this.addEventListener('click', this.handlePageClick, true);
    this.addEventListener('keydown', this.handlePageKeydown);
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    this.unsubscribe = kubernetesSessionStore.subscribe((nextState) => {
      if (this.shellTerminal && nextState.podActionView?.type !== 'shell') this.disposePodShell();
      const previousDrawer = this.querySelector('.kubernetes-detail-drawer, .kubernetes-create-drawer');
      const hadDrawer = Boolean(previousDrawer);
      const previousFocus = previousDrawer?.contains(document.activeElement) ? document.activeElement : null;
      const previousFocusID = previousFocus?.id || '';
      const previousFocusWasClose = previousFocus?.classList.contains('kubernetes-drawer-close') === true;
      // 保存捲動位置：render() 會重建 innerHTML，否則垂直捲動會被重置為 0（閒置時滾回最上方）。
      const contentEl = this.querySelector('.kubernetes-session-content');
      const navEl = this.querySelector('.kubernetes-session-nav');
      const prevContentScroll = contentEl?.scrollTop || 0;
      const prevNavScroll = navEl?.scrollTop || 0;
      this.render();
      this.setupListeners();
      this.initPodShell();
      const drawer = this.querySelector('.kubernetes-detail-drawer, .kubernetes-create-drawer');
      if (!hadDrawer && drawer) {
        drawer.querySelector('.kubernetes-drawer-close')?.focus();
      } else if (drawer && previousFocus) {
        const replacement = previousFocusID ? drawer.querySelector(`[id="${previousFocusID}"]`) : null;
        const focusTarget = replacement && !replacement.disabled
          ? replacement
          : previousFocusWasClose || replacement?.disabled
            ? drawer.querySelector('.kubernetes-drawer-close')
            : null;
        focusTarget?.focus();
      } else if (hadDrawer && !drawer) {
        this.restoreDetailFocus();
      }
      // 還原捲動位置：放在 focus 之後，覆蓋 focus 可能造成的 scrollIntoView。
      // 以 suppressScrollbarAutohide 包住，避免程式還原（非使用者手動捲動）觸發的
      // scroll 事件讓捲動條每次輪詢刷新就閃現一次。
      suppressScrollbarAutohide(() => {
        const newContent = this.querySelector('.kubernetes-session-content');
        if (newContent) newContent.scrollTop = prevContentScroll;
        const newNav = this.querySelector('.kubernetes-session-nav');
        if (newNav) newNav.scrollTop = prevNavScroll;
      });
    });
    const state = kubernetesSessionStore.getState();
    if (state.connectedCluster && !state.dashboard && !state.dashboardLoading) {
      state.loadDashboard(state.selectedNamespace).catch(() => {});
    }
    this.startLiveUpdates();
    this.runtimeEventOffs.push(onWailsEvent('kubernetes-shell-output', data => {
      if (data?.sessionId === this.shellSession?.sessionId) this.shellTerminal?.write(data.data || '');
    }));
    this.runtimeEventOffs.push(onWailsEvent('kubernetes-shell-closed', data => {
      if (data?.sessionId !== this.shellSession?.sessionId) return;
      if (data.error) this.shellTerminal?.writeln(`\r\n${data.error}`);
      this.shellSession = null;
    }));
  }

  disconnectedCallback() {
    this.unsubscribe?.();
    this.removeEventListener('click', this.handlePageClick, true);
    this.removeEventListener('keydown', this.handlePageKeydown);
    clearInterval(this.dashboardTimer);
    clearInterval(this.logsTimer);
    clearTimeout(this.namespaceInteractionTimer);
    document.removeEventListener('pointerdown', this.handleNamespaceOutsideClick, true);
    if (this.deleteConfirmTimeout) {
      clearTimeout(this.deleteConfirmTimeout);
    }
    this.runtimeEventOffs.forEach(off => typeof off === 'function' && off());
    this.runtimeEventOffs = [];
    this.disposePodShell();
  }

  startLiveUpdates() {
    clearInterval(this.dashboardTimer);
    clearInterval(this.logsTimer);
    this.dashboardTimer = setInterval(() => {
      const state = kubernetesSessionStore.getState();
      if (!state.connectedCluster || state.dashboardLoading || state.detailOpen || state.createOpen || state.podActionView) return;
      if (this.isNamespaceSelectActive()) return;
      // 使用者正在清單搜尋框輸入時略過本次輪詢重繪，避免每 3 秒重建 DOM 打斷輸入 / 移動游標。
      const activeId = document.activeElement?.id;
      if (activeId === 'kubernetesPodSearch' || activeId === 'kubernetesSectionSearch') return;
      state.refreshDashboard().catch(() => {});
    }, 3000);
    this.logsTimer = setInterval(() => {
      const state = kubernetesSessionStore.getState();
      if (state.podActionView?.type !== 'logs' || state.logsLoading || this.logPaused) return;
      state.loadPodLogs(state.logOptions || {}).catch(() => {});
    }, 3000);
  }

  // 手動 Refresh：期間設 manualRefreshing 旗標讓按鈕呈 disabled + 「更新中…」，
  // 成功/失敗都清除旗標並重繪。重入保護避免重複點擊發多次請求。
  async runManualRefresh() {
    if (this.manualRefreshing) return;
    this.manualRefreshing = true;
    this.render();
    this.setupListeners();
    try {
      await kubernetesSessionStore.getState().refreshDashboard();
    } catch {
      // 錯誤已由 store 寫入 dashboardError 並於 render 呈現，此處僅需清旗標。
    } finally {
      this.manualRefreshing = false;
      this.render();
      this.setupListeners();
    }
  }

  handlePageKeydown(event) {
    const drawer = this.querySelector('.kubernetes-detail-drawer, .kubernetes-create-drawer');
    if (!drawer) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      // 經未存變更守衛關閉：有未存編輯時先確認。
      if (drawer.classList.contains('kubernetes-create-drawer')) {
        this.guardedCloseCreate();
      } else {
        this.guardedCloseDetail();
      }
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [...drawer.querySelectorAll('button:not([disabled]), select:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex="0"]')];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  markNamespaceSelectInteracting(active) {
    clearTimeout(this.namespaceInteractionTimer);
    this.namespaceSelectInteracting = Boolean(active);
    if (!active) return;
    this.namespaceInteractionTimer = setTimeout(() => {
      if (document.activeElement?.id === 'kubernetesNamespaceSelect') return;
      this.namespaceSelectInteracting = false;
    }, 8000);
  }

  isNamespaceSelectActive() {
    // 下拉開啟中、互動中、或焦點在相容用的原生 select 上時，皆視為互動中，
    // 讓 3 秒的 dashboard 輪詢重繪略過，避免下拉被關掉或勾選被清掉。
    return this.namespaceDropdownOpen
      || this.namespaceSelectInteracting
      || document.activeElement?.id === 'kubernetesNamespaceSelect'
      || Boolean(document.activeElement?.closest?.('[data-namespace-multiselect]'));
  }

  // 開合 namespace 多選面板。開啟時掛上「點擊面板外即關閉」的全域監聽，
  // 並把開啟狀態納入 isNamespaceSelectActive() 的 guard，避免輪詢重繪把面板關掉。
  setNamespaceDropdownOpen(open) {
    const next = Boolean(open);
    if (this.namespaceDropdownOpen === next) return;
    this.namespaceDropdownOpen = next;
    this.markNamespaceSelectInteracting(next);
    if (next) {
      document.addEventListener('pointerdown', this.handleNamespaceOutsideClick, true);
    } else {
      document.removeEventListener('pointerdown', this.handleNamespaceOutsideClick, true);
    }
    const panel = this.querySelector('.kubernetes-namespace-panel');
    const toggle = this.querySelector('#kubernetesNamespaceToggle');
    if (panel) {
      panel.classList.toggle('open', next);
      if (next) panel.removeAttribute('hidden');
      else panel.setAttribute('hidden', '');
    }
    toggle?.setAttribute('aria-expanded', next ? 'true' : 'false');
  }

  handleNamespaceOutsideClick(event) {
    if (event.target?.closest?.('[data-namespace-multiselect]')) return;
    this.setNamespaceDropdownOpen(false);
  }

  handlePageClick(event) {
    const detailTab = event.target.closest?.('[data-detail-tab]');
    if (detailTab && this.contains(detailTab)) {
      const store = kubernetesSessionStore.getState();
      // 離開 YAML 頁籤時退出編輯/搜尋狀態，避免草稿殘留到其他頁籤。
      if (detailTab.dataset.detailTab !== 'yaml') {
        this.yamlEditing = false;
        this.yamlEditDraft = null;
        this.yamlSearchOpen = false;
        this.yamlSearchTerm = '';
      }
      // 切換頁籤時重置低風險刪除的兩段確認階段。
      this.pendingDeleteConfirm = false;
      store.selectDetailTab(detailTab.dataset.detailTab);
      if (detailTab.dataset.detailTab === 'forward') {
        store.loadPodPortForwards().catch(error => {
          console.error('[Kubernetes][UI][DetailTab] 載入 Port Forward 失敗', error);
        });
      }
      return;
    }

    const deleteButton = event.target.closest?.('#deleteKubernetesResource');
    if (!deleteButton || !this.contains(deleteButton)) return;
    event.preventDefault();
    event.stopPropagation();
    const resource = kubernetesSessionStore.getState().selectedResource || {};
    const kind = resource.kind || 'Resource';
    if (deleteButton.disabled) return;

    if (isHighRiskKubernetesKind(kind)) {
      // 高風險 kind：按鈕僅在輸入名稱比對成功時才會啟用（render 階段控制 disabled）。
      // 此處不再依賴脆弱的 3 秒逾時雙擊，直接執行刪除流程。
      this.deleteConfirmInput = '';
      kubernetesSessionStore.getState().deleteSelectedResource().catch(error => {
        console.error('[Kubernetes][UI][Delete] 刪除流程失敗', error);
      });
      return;
    }

    // 低風險 kind：兩段式明確點擊。確認階段改為元件狀態驅動（this.pendingDeleteConfirm），
    // 避免背景輪詢重繪（會重建按鈕）把 DOM 上的確認階段靜默清掉。
    if (this.pendingDeleteConfirm) {
      this.pendingDeleteConfirm = false;
      kubernetesSessionStore.getState().deleteSelectedResource().catch(error => {
        console.error('[Kubernetes][UI][Delete] 刪除流程失敗', error);
      });
    } else {
      this.pendingDeleteConfirm = true;
      this.render();
      this.setupListeners();
    }
  }

  // 關閉 Create drawer 的統一守衛：若使用者已編輯 YAML（草稿與目前模板不同）則先確認，
  // 確認才關閉；非編輯狀態直接關閉。三個關閉入口（backdrop / Esc / 關閉鈕）皆走此守衛。
  async guardedCloseCreate() {
    const currentTemplate = kubernetesSessionStore.getState().createResourceYAML;
    const hasUnsavedChanges = this.createYAMLDraft !== null && this.createYAMLDraft !== currentTemplate;
    if (hasUnsavedChanges && !(await confirmDialog('有未儲存的變更，確定關閉並捨棄？', { title: '確認關閉', danger: true }))) {
      return;
    }
    this.createYAMLDraft = null;
    kubernetesSessionStore.getState().closeCreateResource();
  }

  // 關閉 Detail drawer 的統一守衛：若正在 YAML 編輯且草稿與原 YAML 不同則先確認，
  // 確認才關閉；其餘情況直接關閉。三個關閉入口皆走此守衛。
  async guardedCloseDetail() {
    const original = String(kubernetesSessionStore.getState().resourceDetail?.yaml || '');
    const hasUnsavedChanges = this.yamlEditing && this.yamlEditDraft !== null && this.yamlEditDraft !== original;
    if (hasUnsavedChanges && !(await confirmDialog('有未儲存的變更，確定關閉並捨棄？', { title: '確認關閉', danger: true }))) {
      return;
    }
    this.yamlEditing = false;
    this.yamlEditDraft = null;
    this.pendingDeleteConfirm = false;
    kubernetesSessionStore.getState().closeResourceDetail();
  }

  restoreDetailFocus() {
    if (this.returnToCreateButton) {
      this.querySelector('#openKubernetesCreateResource')?.focus();
      this.returnToCreateButton = false;
      return;
    }
    if (!this.detailReturnTarget) return;
    const target = [...this.querySelectorAll('.kubernetes-resource-row')].find(row =>
      row.dataset.resourceKind === this.detailReturnTarget.kind
      && row.dataset.resourceName === this.detailReturnTarget.name
      && row.dataset.resourceNamespace === this.detailReturnTarget.namespace
    );
    target?.focus();
    this.detailReturnTarget = null;
  }

  renderOverview(dashboard) {
    const counts = dashboard.overview || {};
    const metrics = dashboard.metrics || {};
    const cpuPercent = percent(metrics.cpuUsageMilli, metrics.cpuCapacityMilli);
    const memoryPercent = percent(metrics.memoryUsageBytes, metrics.memoryCapacityBytes);
    // ③ 依健康狀態決定各計數卡的 modifier：Failed pods → danger；Pending pods / warning events → warning。
    const failedPods = Number(counts.failedPods || 0);
    const pendingPods = Number(counts.pendingPods || 0);
    const warningEvents = Number(counts.warningEvents || 0);
    const notReadyNodes = Math.max(0, Number(counts.nodes || 0) - Number(counts.readyNodes || 0));
    const podsHealth = failedPods > 0 ? 'is-danger' : pendingPods > 0 ? 'is-warning' : 'is-neutral';
    const nodesHealth = notReadyNodes > 0 ? 'is-danger' : 'is-neutral';
    const eventsHealth = warningEvents > 0 ? 'is-warning' : 'is-neutral';
    return `
      <section class="kubernetes-overview-grid" aria-label="Cluster Overview">
        ${this.renderCountCard('Nodes', counts.nodes, `${counts.readyNodes || 0} ready`, nodesHealth)}
        ${this.renderCountCard('Pods', counts.pods, `${counts.runningPods || 0} running`, podsHealth)}
        ${this.renderCountCard('Deployments', counts.deployments, `${counts.readyDeployments || 0} ready`)}
        ${this.renderCountCard('StatefulSets', counts.statefulSets, `${counts.readyStatefulSets || 0} ready`)}
        ${this.renderCountCard('Services', counts.services, `${counts.warningEvents || 0} warning events`, eventsHealth)}
      </section>
      <section class="kubernetes-metrics-grid">
        ${metrics.available ? `
          ${this.renderMetricCard('CPU Usage', formatCPU(metrics.cpuUsageMilli), formatCPU(metrics.cpuCapacityMilli), cpuPercent, 'cpu')}
          ${this.renderMetricCard('Memory Usage', formatBytes(metrics.memoryUsageBytes), formatBytes(metrics.memoryCapacityBytes), memoryPercent, 'memory')}
        ` : `
          <div class="kubernetes-metrics-unavailable" role="status">
            <strong>Metrics API 無法使用</strong>
            <span>${escapeHtml(metrics.error || '叢集未回傳 CPU 與 Memory 使用量。')}</span>
          </div>
        `}
      </section>
      <section class="kubernetes-health-grid">
        <div class="kubernetes-health-card">
          <h2>Pod Status</h2>
          ${this.renderHealthRow('Running', counts.runningPods, 'healthy')}
          ${this.renderHealthRow('Pending', counts.pendingPods, 'pending')}
          ${this.renderHealthRow('Failed', counts.failedPods, 'failed')}
          ${this.renderHealthRow('Succeeded', counts.succeededPods, 'succeeded')}
        </div>
        <div class="kubernetes-health-card">
          <h2>Cluster Status</h2>
          ${this.renderHealthRow('Ready Nodes', counts.readyNodes, 'healthy')}
          ${this.renderHealthRow('Not Ready Nodes', Math.max(0, Number(counts.nodes || 0) - Number(counts.readyNodes || 0)), 'failed')}
          ${this.renderHealthRow('Warning Events', counts.warningEvents, 'pending')}
        </div>
      </section>`;
  }

  renderCountCard(label, value, detail, health = '') {
    // ③ health＝依健康狀態的 modifier class（is-danger/is-warning/is-neutral），空則維持既有中性綠。
    const cls = health ? ` ${health}` : '';
    return `<div class="kubernetes-overview-card${cls}"><span>${label}</span><strong>${Number(value || 0)}</strong><small>${escapeHtml(detail)}</small></div>`;
  }

  renderMetricCard(label, used, capacity, usagePercent, type) {
    // ④ 使用率警示色：≥90% danger、≥75% warning，否則維持原色（CSS 綁主題變數）。
    const usageClass = usagePercent >= 90 ? ' usage-danger' : usagePercent >= 75 ? ' usage-warning' : '';
    return `
      <div class="kubernetes-metric-card metric-${type}${usageClass}">
        <div><h2>${label}</h2><strong>${used} / ${capacity}</strong><span>${usagePercent.toFixed(1)}%</span></div>
        <div class="kubernetes-metric-track"><i style="width: ${usagePercent.toFixed(1)}%"></i></div>
      </div>`;
  }

  renderHealthRow(label, value, status) {
    return `<div class="kubernetes-health-row"><span><i class="health-${status}"></i>${label}</span><strong>${Number(value || 0)}</strong></div>`;
  }

  // ── 清單效率共用 helper（排序 / 搜尋 / 截斷） ──────────────────────────

  // 產生可排序表頭 <th>：帶 data-sort-key 供委派 handler 辨識，aria-sort 標示目前狀態，
  // 並在該 section 目前排序鍵相符時附上 ▲ / ▼ 箭頭。opts.type 標記欄位型別（number / time），
  // 供 applyTableSort 決定比較方式（預設字串 localeCompare）。
  sortableTh(section, key, label, opts = {}) {
    const sort = this.tableSort[section];
    const active = sort && sort.key === key;
    const dir = active ? sort.dir : '';
    const ariaSort = active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none';
    const arrow = active ? `<span class="kubernetes-sort-arrow" aria-hidden="true">${dir === 'asc' ? '▲' : '▼'}</span>` : '';
    const type = opts.type ? ` data-sort-type="${opts.type}"` : '';
    return `<th scope="col" class="kubernetes-sortable-th${active ? ' active' : ''}" data-sort-key="${escapeHtml(key)}"${type} aria-sort="${ariaSort}" role="columnheader" tabindex="0">${escapeHtml(label)}${arrow}</th>`;
  }

  // 依 this.tableSort[section] 對 items 做穩定排序；無排序時原序回傳。
  // 型別：'number' 按數值、'time'（creationTimestamp / 時間欄）按 Date.parse、其餘 localeCompare。
  applyTableSort(section, items) {
    const sort = this.tableSort[section];
    if (!sort || !Array.isArray(items)) return items;
    const { key, dir, type } = sort;
    const factor = dir === 'desc' ? -1 : 1;
    // 以 index 作 tie-breaker 實作穩定排序（原生 sort 在多數引擎已穩定，這裡明確保證）。
    const decorated = items.map((item, index) => ({ item, index }));
    const rank = (value) => {
      if (type === 'number') {
        const num = Number(value);
        return Number.isFinite(num) ? num : Number.NEGATIVE_INFINITY;
      }
      if (type === 'time') {
        const ts = Date.parse(value || '');
        return Number.isFinite(ts) ? ts : Number.NEGATIVE_INFINITY;
      }
      return null;
    };
    decorated.sort((a, b) => {
      const av = a.item?.[key];
      const bv = b.item?.[key];
      let cmp;
      if (type === 'number' || type === 'time') {
        cmp = rank(av) - rank(bv);
      } else {
        cmp = String(av ?? '').localeCompare(String(bv ?? ''), undefined, { numeric: true, sensitivity: 'base' });
      }
      if (cmp !== 0) return cmp * factor;
      return a.index - b.index; // 穩定：值相同維持原序
    });
    return decorated.map(entry => entry.item);
  }

  // 依 this.tableSearch[section]（不分大小寫）過濾 items，比對 name 與 namespace。
  // 空詞回傳原陣列。Pods 不走此路（沿用既有 podSearch）。
  applyTableSearch(section, items) {
    const term = String(this.tableSearch[section] || '').trim().toLowerCase();
    if (!term || !Array.isArray(items)) return items;
    return items.filter(item => `${item?.name ?? ''} ${item?.namespace ?? ''}`.toLowerCase().includes(term));
  }

  // 產生一個帶 title（hover 顯示完整值）的 <td> 內容，供易過長欄位（name 等）截斷用。
  // 內容與 title 皆 escape；空值以 '-' 呈現且不設 title。
  ellipsisCell(value, className = 'kubernetes-cell-ellipsis') {
    const text = value === undefined || value === null || value === '' ? '-' : String(value);
    const title = text === '-' ? '' : ` title="${escapeHtml(text)}"`;
    return `<td class="${className}"${title}>${escapeHtml(text)}</td>`;
  }

  renderResourceTable(section, dashboard) {
    const metricsAvailable = dashboard.metrics?.available === true;
    const cpuUsage = value => metricsAvailable ? formatCPU(value) : '-';
    const memoryUsage = value => metricsAvailable ? formatBytes(value) : '-';
    const definitions = {
      nodes: {
        items: dashboard.nodes || [],
        columns: [['name', 'Name'], ['status', 'Status', statusBadge], ['roles', 'Roles'], ['version', 'Version'], ['cpuUsageMilli', 'CPU Usage', cpuUsage], ['memoryUsageBytes', 'Memory Usage', memoryUsage], ['creationTimestamp', 'Age', formatAge]]
      },
      pods: {
        items: dashboard.pods || [],
        columns: [['name', 'Name'], ['namespace', 'Namespace'], ['status', 'Status', statusBadge], ['ready', 'Ready'], ['restarts', 'Restarts'], ['nodeName', 'Node'], ['cpuUsageMilli', 'CPU Usage', cpuUsage], ['memoryUsageBytes', 'Memory Usage', memoryUsage], ['creationTimestamp', 'Age', formatAge]]
      },
      deployments: {
        items: dashboard.deployments || [],
        columns: [['name', 'Name'], ['namespace', 'Namespace'], ['status', 'Status', statusBadge], ['readyReplicas', 'Ready'], ['desiredReplicas', 'Desired'], ['availableReplicas', 'Available'], ['creationTimestamp', 'Age', formatAge]]
      },
      statefulsets: {
        items: dashboard.statefulSets || [],
        columns: [['name', 'Name'], ['namespace', 'Namespace'], ['status', 'Status', statusBadge], ['readyReplicas', 'Ready'], ['desiredReplicas', 'Desired'], ['availableReplicas', 'Available'], ['creationTimestamp', 'Age', formatAge]]
      },
      services: {
        items: dashboard.services || [],
        columns: [['name', 'Name'], ['namespace', 'Namespace'], ['type', 'Type'], ['clusterIp', 'Cluster IP'], ['externalAddresses', 'External Addresses'], ['ports', 'Ports'], ['creationTimestamp', 'Age', formatAge]]
      },
      ingresses: {
        items: dashboard.ingresses || [],
        columns: [['name', 'Name'], ['namespace', 'Namespace'], ['ingressClass', 'Class'], ['hosts', 'Hosts'], ['addresses', 'Addresses'], ['creationTimestamp', 'Age', formatAge]]
      },
      persistentVolumeClaims: {
        items: dashboard.persistentVolumeClaims || [],
        columns: [['name', 'Name'], ['namespace', 'Namespace'], ['status', 'Status', statusBadge], ['volumeName', 'Volume'], ['capacity', 'Capacity'], ['storageClass', 'Storage Class'], ['accessModes', 'Access Modes'], ['creationTimestamp', 'Age', formatAge]]
      },
      persistentVolumes: {
        items: dashboard.persistentVolumes || [],
        columns: [['name', 'Name'], ['status', 'Status', statusBadge], ['capacity', 'Capacity'], ['storageClass', 'Storage Class'], ['accessModes', 'Access Modes'], ['reclaimPolicy', 'Reclaim Policy'], ['claim', 'Claim'], ['creationTimestamp', 'Age', formatAge]]
      },
      storageClasses: {
        items: dashboard.storageClasses || [],
        columns: [['name', 'Name'], ['provisioner', 'Provisioner'], ['reclaimPolicy', 'Reclaim Policy'], ['volumeBindingMode', 'Binding Mode'], ['allowExpansion', 'Allow Expansion', value => value ? 'Yes' : 'No'], ['isDefault', 'Default', value => value ? 'Yes' : 'No'], ['creationTimestamp', 'Age', formatAge]]
      }
    };
    const resourceError = dashboard.resourceErrors?.[section];
    if (resourceError) {
      return `<div class="kubernetes-session-error kubernetes-resource-section-error" role="alert"><strong>${escapeHtml(SECTIONS.find(([id]) => id === section)?.[1] || 'Kubernetes 資源')} 無法讀取</strong><span>${escapeHtml(resourceError)}</span></div>`;
    }
    if (section === 'pods') return this.renderPodsTable(dashboard.pods || [], metricsAvailable);
    if (section === 'namespaces') return this.renderNamespacesTable(dashboard.namespaceDetails || []);
    if (section === 'configMaps') return this.renderConfigMapsTable(dashboard.configMaps || []);
    if (section === 'secrets') return this.renderSecretsTable(dashboard.secrets || []);
    if (section === 'daemonSets') return this.renderDaemonSetsTable(dashboard.daemonSets || []);
    if (section === 'jobs') return this.renderJobsTable(dashboard.jobs || []);
    if (section === 'cronJobs') return this.renderCronJobsTable(dashboard.cronJobs || []);
    if (section === 'endpoints') return this.renderEndpointsTable(dashboard.endpoints || []);
    if (section === 'networkPolicies') return this.renderNetworkPoliciesTable(dashboard.networkPolicies || []);
    if (section === 'serviceAccounts') return this.renderServiceAccountsTable(dashboard.serviceAccounts || []);
    if (section === 'roles') return this.renderRolesTable(dashboard.roles || []);
    if (section === 'roleBindings') return this.renderRoleBindingsTable(dashboard.roleBindings || []);
    if (section === 'clusterRoles') return this.renderClusterRolesTable(dashboard.clusterRoles || []);
    if (section === 'clusterRoleBindings') return this.renderClusterRoleBindingsTable(dashboard.clusterRoleBindings || []);
    if (section === 'horizontalPodAutoscalers') return this.renderHorizontalPodAutoscalersTable(dashboard.horizontalPodAutoscalers || []);
    if (section === 'podDisruptionBudgets') return this.renderPodDisruptionBudgetsTable(dashboard.podDisruptionBudgets || []);
    if (section === 'resourceQuotas') return this.renderResourceQuotasTable(dashboard.resourceQuotas || []);
    if (section === 'customResourceDefinitions') return this.renderCustomResourceDefinitionsTable(dashboard.customResourceDefinitions || []);
    const definition = definitions[section];
    if (section === 'events') return this.renderEventsTable(dashboard.events || []);
    if (!definition) return '';
    // 先過濾（通用搜尋）再排序（穩定），與其餘表格一致。
    const items = this.applyTableSort(section, this.applyTableSearch(section, definition.items));
    if (items.length === 0) {
      // cluster-scoped section（nodes / persistentVolumes / storageClasses）維持「叢集沒有可顯示的 X」；
      // namespaced 則用「目前篩選範圍沒有此類資源」（多選/All 模式語意正確）。
      const clusterScopedEmpty = { nodes: '叢集沒有可顯示的 Node。', persistentVolumes: '叢集沒有可顯示的 Persistent Volume。', storageClasses: '叢集沒有可顯示的 Storage Class。' };
      const emptyText = this.tableSearch[section]
        ? '沒有符合的資源。'
        : (clusterScopedEmpty[section] || '目前篩選範圍沒有此類資源。');
      return `${this.renderSectionRefresh(section)}<div class="kubernetes-resource-empty">${emptyText}</div>`;
    }
    // 通用表格所有欄皆可排序：creationTimestamp 依時間、已知數值欄依數值，其餘依字串。
    return `
      ${this.renderSectionRefresh(section)}
      <div class="kubernetes-resource-table-wrap">
        <table class="kubernetes-resource-table">
          <caption class="kubernetes-table-caption">${escapeHtml(SECTIONS.find(([id]) => id === section)?.[1] || 'Kubernetes Resources')}</caption>
          <thead><tr>${definition.columns.map(([key, label]) => this.sortableTh(section, key, label, { type: sortTypeForKey(key) })).join('')}</tr></thead>
          <tbody>${items.map(item => `
            <tr class="kubernetes-resource-row" tabindex="0" role="button" data-resource-kind="${RESOURCE_KINDS[section]}" data-resource-name="${escapeHtml(item.name)}" data-resource-namespace="${escapeHtml(item.namespace || '')}" data-resource-apiversion="${escapeHtml(RESOURCE_META[section]?.apiVersion || '')}" aria-label="查看 ${escapeHtml(item.name)} 詳細資訊">${definition.columns.map(([key, , formatter]) => (!formatter && ELLIPSIS_KEYS.has(key)) ? this.ellipsisCell(item[key]) : `<td>${formatter ? formatter(item[key]) : escapeHtml(item[key] ?? '-')}</td>`).join('')}</tr>
          `).join('')}</tbody>
        </table>
      </div>`;
  }

  renderSectionRefresh(section) {
    if (!REFRESHABLE_SECTIONS.has(section)) return '';
    // 通用搜尋框（Pods 除外，Pods 有自己的搜尋 + 狀態 filter）：對目前 section 清單過濾 name/namespace。
    const term = escapeHtml(this.tableSearch[section] || '');
    return `<div class="kubernetes-section-toolbar">
      <div class="kubernetes-section-search no-drag"><span class="kubernetes-section-search-icon" aria-hidden="true">${renderKubernetesIcon('search', 14)}</span><input id="kubernetesSectionSearch" class="no-drag" data-section-search="${escapeHtml(section)}" value="${term}" placeholder="搜尋名稱…" aria-label="搜尋資源名稱"></div>
      ${this.renderRefreshButton('refreshKubernetesSection')}
    </div>`;
  }

  // 產生 Refresh 按鈕：手動 refresh 進行中時 disabled + mini spinner + 「更新中…」，
  // 避免重複點擊並提供回饋（Pods 與各 section 共用）。
  renderRefreshButton(id) {
    const busy = this.manualRefreshing;
    return `<button type="button" id="${id}" class="no-drag kubernetes-secondary-btn" ${busy ? 'disabled aria-busy="true"' : ''}>${busy ? '<span class="kubernetes-spinner-mini kubernetes-refresh-spinner" aria-hidden="true"></span><span>更新中…</span>' : 'Refresh'}</button>`;
  }

  // 依 namespace 名稱以決定性方式（簡單字串 hash）從固定調色盤取色，
  // 同一 namespace 每次都得到相同顏色。顏色僅用於「色點」，不改文字顏色，
  // 以確保深色主題可讀。
  namespaceColor(namespace) {
    const value = String(namespace || '');
    if (!value) return NAMESPACE_COLOR_PALETTE[0];
    let hash = 0;
    for (let i = 0; i < value.length; i += 1) {
      hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
    }
    return NAMESPACE_COLOR_PALETTE[hash % NAMESPACE_COLOR_PALETTE.length];
  }

  // 產生資源列（<tr>）可點擊開啟 detail drawer 所需的屬性字串：
  // class + tabindex/role + data-resource-*（含 apiVersion，由 RESOURCE_META 取）。
  // cluster-scoped 資源 namespace 留空。extraClass/extraStyle 供既有色條列併存。
  resourceRowAttrs(section, name, namespace, extraStyle = '') {
    const meta = RESOURCE_META[section] || {};
    return `class="kubernetes-resource-row" tabindex="0" role="button"${extraStyle ? ` style="${extraStyle}"` : ''} data-resource-kind="${escapeHtml(meta.kind || '')}" data-resource-name="${escapeHtml(name ?? '')}" data-resource-namespace="${escapeHtml(namespace || '')}" data-resource-apiversion="${escapeHtml(meta.apiVersion || '')}" aria-label="查看 ${escapeHtml(name ?? '')} 詳細資訊"`;
  }

  // 產生一列 namespace 儲存格內容：色點 + namespace 文字標籤。
  renderNamespaceCell(namespace) {
    // namespace 的辨識色改以「每列左側色條」呈現（見 renderPodsTable 的 tr border-left-color），
    // 此處不再加色點，僅顯示 namespace 文字。
    return escapeHtml(namespace || '-');
  }

  // Namespace 多選下拉：按鈕顯示摘要，展開後為「All Namespaces」＋每個 namespace 的 checkbox。
  // 另保留一個視覺隱藏的原生 <select> 作為無障礙/相容備援（沿用既有 guard 的 activeElement 判斷）。
  renderNamespaceMultiSelect(state, namespaces) {
    const selected = Array.isArray(state.selectedNamespaces) ? state.selectedNamespaces : [];
    const selectedSet = new Set(selected);
    const isAll = selected.length === 0;
    const specific = namespaces.filter(item => item !== '*');
    let summary;
    if (isAll) summary = 'All Namespaces';
    else if (selected.length === 1) summary = selected[0];
    else summary = `${selected.length} 個 namespace`;
    // cluster-scoped section 不受 namespace 篩選，停用整個多選控制項並加提示。
    const clusterScoped = CLUSTER_SCOPED_SECTIONS.has(state.activeSection || '');
    const disabled = (state.dashboardLoading || clusterScoped) ? 'disabled' : '';
    const scopeHint = clusterScoped ? ' title="此資源不受 namespace 篩選"' : '';
    const open = clusterScoped ? false : this.namespaceDropdownOpen;
    const legacyValue = isAll ? '*' : (selected.length === 1 ? selected[0] : '*');
    const options = specific.map(item => {
      const checked = selectedSet.has(item) ? 'checked' : '';
      const color = this.namespaceColor(item);
      return `<label class="kubernetes-namespace-option no-drag"><input type="checkbox" class="no-drag" data-namespace-option value="${escapeHtml(item)}" ${checked} ${disabled}><span class="kubernetes-namespace-dot" style="background:${color}" aria-hidden="true"></span><span>${escapeHtml(item)}</span></label>`;
    }).join('');
    return `<div class="kubernetes-namespace-field kubernetes-namespace-multiselect${clusterScoped ? ' cluster-scoped' : ''}" data-namespace-multiselect${scopeHint}>
      <span id="kubernetesNamespaceLabel">Namespace</span>
      <button type="button" id="kubernetesNamespaceToggle" class="no-drag kubernetes-namespace-toggle" aria-haspopup="true" aria-expanded="${open ? 'true' : 'false'}" aria-labelledby="kubernetesNamespaceLabel kubernetesNamespaceToggle"${scopeHint} ${disabled}>
        <span class="kubernetes-namespace-summary">${escapeHtml(summary)}</span>
        <span class="kubernetes-namespace-caret" aria-hidden="true">▾</span>
      </button>
      <div class="kubernetes-namespace-panel ${open ? 'open' : ''}" role="group" aria-label="選擇 Namespace" ${open ? '' : 'hidden'}>
        <label class="kubernetes-namespace-option no-drag"><input type="checkbox" class="no-drag" data-namespace-all ${isAll ? 'checked' : ''} ${disabled}><span>All Namespaces</span></label>
        ${options}
      </div>
      <select id="kubernetesNamespaceSelect" class="no-drag kubernetes-visually-hidden" tabindex="-1" aria-hidden="true" ${disabled}>${namespaces.map(item => `<option value="${escapeHtml(item)}" ${item === legacyValue ? 'selected' : ''}>${item === '*' ? 'All Namespaces' : escapeHtml(item)}</option>`).join('')}</select>
      ${clusterScoped ? '<small class="kubernetes-namespace-note">此資源不受 namespace 篩選</small>' : ''}
    </div>`;
  }

  renderPodsTable(allPods, metricsAvailable) {
    // 多選 namespace 篩選：selectedNamespaces 非空（非 All）時只顯示所選集合內的 pod；
    // 空（All）顯示全部。此篩選在 podFilter/podSearch 之前，counts（All/Running/…）
    // 以「namespace 篩選後」為母體計算，與可見範圍一致，避免計數誤導。
    const selectedNamespaces = kubernetesSessionStore.getState().selectedNamespaces || [];
    const namespaceSet = new Set(selectedNamespaces);
    const pods = namespaceSet.size === 0
      ? allPods
      : allPods.filter(pod => namespaceSet.has(pod.namespace));
    const counts = { all: pods.length, running: 0, pending: 0, unhealthy: 0, failed: 0, succeeded: 0 };
    const category = pod => {
      const phase = String(pod.phase || '').toLowerCase();
      const status = String(pod.status || '').toLowerCase();
      if (phase === 'running') return status === 'running' ? 'running' : 'unhealthy';
      if (['pending', 'failed', 'succeeded'].includes(phase)) return phase;
      return 'unhealthy';
    };
    pods.forEach(pod => {
      counts[category(pod)] += 1;
    });
    const filtered = pods.filter(pod => {
      const filterMatch = this.podFilter === 'all' || category(pod) === this.podFilter;
      const query = this.podSearch.toLowerCase();
      return filterMatch && (!query || `${pod.name} ${pod.namespace} ${pod.nodeName} ${pod.status}`.toLowerCase().includes(query));
    });
    // 先過濾（狀態 filter + 既有 Pod 搜尋）再排序（走通用穩定排序）。
    const visible = this.applyTableSort('pods', filtered);
    const filters = [['all', 'All'], ['running', 'Running'], ['pending', 'Pending'], ['unhealthy', 'Unhealthy'], ['failed', 'Failed'], ['succeeded', 'Succeeded']];
    return `<section class="kubernetes-pods-view">
      <div class="kubernetes-pods-toolbar"><div class="kubernetes-pod-filters">${filters.map(([id, label]) => `<button type="button" data-pod-filter="${id}" class="no-drag ${this.podFilter === id ? 'active' : ''}">${label} ${counts[id]}</button>`).join('')}</div><div class="kubernetes-pod-tools"><input id="kubernetesPodSearch" class="no-drag" value="${escapeHtml(this.podSearch)}" placeholder="搜尋 Pod"><span class="kubernetes-watching">Watching</span>${this.renderRefreshButton('refreshKubernetesPods')}</div></div>
      <div class="kubernetes-resource-table-wrap kubernetes-pods-table-wrap"><table class="kubernetes-resource-table kubernetes-pods-table"><thead><tr>${this.sortableTh('pods', 'name', 'Name')}${this.sortableTh('pods', 'namespace', 'Namespace')}<th scope="col">Ready</th>${this.sortableTh('pods', 'status', 'Status')}${this.sortableTh('pods', 'restarts', 'Restarts', { type: 'number' })}<th scope="col">Node</th>${this.sortableTh('pods', 'creationTimestamp', 'Age', { type: 'time' })}${this.sortableTh('pods', 'cpuUsageMilli', 'CPU', { type: 'number' })}${this.sortableTh('pods', 'memoryUsageBytes', 'Memory', { type: 'number' })}<th scope="col">Actions</th></tr></thead><tbody>
      ${visible.map(pod => {
        const container = pod.containers?.[0]?.name || '';
        const running = String(pod.phase || '').toLowerCase() === 'running';
        const hasPorts = (pod.containers || []).some(item => item.ports?.length);
        const encoded = encodeURIComponent(JSON.stringify(pod));
        return `<tr class="kubernetes-resource-row" tabindex="0" role="button" aria-label="查看 ${escapeHtml(pod.name)} 詳細資訊" style="border-left-color:${this.namespaceColor(pod.namespace)}" data-resource-kind="pod" data-resource-name="${escapeHtml(pod.name)}" data-resource-namespace="${escapeHtml(pod.namespace)}" data-resource-apiversion="v1">${this.ellipsisCell(pod.name)}<td>${this.renderNamespaceCell(pod.namespace)}</td><td>${escapeHtml(pod.ready)}</td><td>${statusBadge(pod.status)}</td><td>${pod.restarts || 0}</td><td>${escapeHtml(pod.nodeName || '-')}</td><td>${formatAge(pod.creationTimestamp)}</td><td>${metricsAvailable ? formatCPU(pod.cpuUsageMilli) : '-'}</td><td>${metricsAvailable ? formatBytes(pod.memoryUsageBytes) : '-'}</td><td class="kubernetes-pod-actions"><button data-pod-action="logs" data-pod="${encoded}" data-container="${escapeHtml(container)}" ${container ? '' : 'disabled'}>Logs</button><button data-pod-action="shell" data-pod="${encoded}" data-container="${escapeHtml(container)}" ${running && container ? '' : 'disabled'}>Shell</button><button data-pod-action="forward" data-pod="${encoded}" ${running && hasPorts ? '' : 'disabled'}>Forward</button></td></tr>`;
      }).join('')}</tbody></table></div></section>`;
  }

  renderPodActionView(state) {
    const pod = state.selectedResource || {};
    const action = state.podActionView || {};
    if (action.type === 'logs') {
      return `<section class="kubernetes-pod-action-view"><header><button id="closeKubernetesPodAction" class="no-drag kubernetes-secondary-btn">返回 Pods</button><div><h1>Logs：${escapeHtml(pod.name)}</h1><p>${escapeHtml(pod.namespace)} / ${escapeHtml(action.container)}</p></div><span class="kubernetes-watching">${this.logPaused ? 'Paused' : 'Streaming'}</span></header>${this.renderLogsPanel(state, [action.container].filter(Boolean), action.container, 'action')}</section>`;
    }
    return `<section class="kubernetes-pod-action-view kubernetes-shell-view"><header><button id="closeKubernetesPodAction" class="no-drag kubernetes-secondary-btn">返回 Pods</button><div><h1>Shell：${escapeHtml(pod.name)}</h1><p>${escapeHtml(pod.namespace)} / ${escapeHtml(action.container)}</p></div></header><div id="kubernetesPodShellTerminal" class="kubernetes-pod-shell-terminal"></div></section>`;
  }

  renderEventsTable(events) {
    if (!events.length) return '<div class="kubernetes-resource-empty">目前 Namespace 沒有事件。</div>';
    // 統一事件時間欄位（後端可能給 timestamp / time / lastTimestamp / eventTime），
    // 供顯示（formatAge 相對時間）與排序（_eventTime，Date.parse）共用。
    const withTime = events.map(event => ({
      ...event,
      _eventTime: event.timestamp || event.time || event.lastTimestamp || event.eventTime || ''
    }));
    // ② Type 篩選（All / Warning / Normal）：以元件狀態 eventsTypeFilter 保存，切換即重繪。
    const typeFilter = this.eventsTypeFilter || 'all';
    const filtered = typeFilter === 'all'
      ? withTime
      : withTime.filter(event => String(event.type || '') === typeFilter);
    // Events 表可排序 Type / Age（此表無 name/namespace，故僅套排序、不套通用搜尋）。
    const sorted = this.applyTableSort('events', filtered);
    const filterOption = (value, label) => `<option value="${value}"${typeFilter === value ? ' selected' : ''}>${label}</option>`;
    return `
      <div class="kubernetes-events-toolbar">
        <label class="kubernetes-events-filter no-drag">
          <span>Type</span>
          <select id="kubernetesEventsTypeFilter" class="no-drag" aria-label="依事件類型篩選">
            ${filterOption('all', 'All')}${filterOption('Warning', 'Warning')}${filterOption('Normal', 'Normal')}
          </select>
        </label>
      </div>
      <div class="kubernetes-resource-table-wrap">
        <table class="kubernetes-resource-table kubernetes-events-table">
          <caption class="kubernetes-table-caption">Kubernetes Events</caption>
          <thead><tr>${this.sortableTh('events', 'type', 'Type')}<th scope="col">Reason</th><th scope="col">Object</th><th scope="col">Message</th>${this.sortableTh('events', '_eventTime', 'Age', { type: 'time' })}</tr></thead>
          <tbody>${sorted.length ? sorted.map(event => `<tr>
            <td>${statusBadge(event.type)}</td>
            <td>${escapeHtml(event.reason || '-')}</td>
            ${this.ellipsisCell(event.object || event.involvedObject)}
            <td class="kubernetes-event-message">${escapeHtml(event.message || '-')}</td>
            <td${event._eventTime ? ` title="${escapeHtml(event._eventTime)}"` : ''}>${event._eventTime ? formatAge(event._eventTime) : '-'}</td>
          </tr>`).join('') : '<tr><td colspan="5" class="kubernetes-events-empty">沒有符合的事件。</td></tr>'}</tbody>
        </table>
      </div>`;
  }

  // Namespaces 為 cluster-scoped 資源，直接顯示 dashboard.namespaceDetails 全部，
  // 不套用 namespace 多選篩選（篩選僅用於 namespaced 資源如 Pod）。可點擊開啟 detail drawer。
  renderNamespacesTable(allNamespaces) {
    const namespaces = this.applyTableSort('namespaces', this.applyTableSearch('namespaces', allNamespaces));
    if (!namespaces.length) {
      return `${this.renderSectionRefresh('namespaces')}<div class="kubernetes-resource-empty">${this.tableSearch.namespaces ? '沒有符合的資源。' : '叢集沒有可顯示的 Namespace。'}</div>`;
    }
    return `
      ${this.renderSectionRefresh('namespaces')}
      <div class="kubernetes-resource-table-wrap">
        <table class="kubernetes-resource-table kubernetes-nscolored-table">
          <caption class="kubernetes-table-caption">Namespaces</caption>
          <thead><tr>${this.sortableTh('namespaces', 'name', 'Name')}${this.sortableTh('namespaces', 'status', 'Status')}${this.sortableTh('namespaces', 'creationTimestamp', 'Age', { type: 'time' })}</tr></thead>
          <tbody>${namespaces.map(item => `<tr ${this.resourceRowAttrs('namespaces', item.name, '', `border-left-color:${this.namespaceColor(item.name)}`)}>
            ${this.ellipsisCell(item.name)}
            <td>${statusBadge(item.status)}</td>
            <td>${formatAge(item.creationTimestamp)}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>`;
  }

  // ConfigMaps 為 namespaced 資源，套用與 Pod 相同的 selectedNamespaces 多選篩選；
  // 每列左側色條＝該 namespace 的辨識色。可點擊開啟 detail drawer。
  renderConfigMapsTable(allConfigMaps) {
    const selectedNamespaces = kubernetesSessionStore.getState().selectedNamespaces || [];
    const namespaceSet = new Set(selectedNamespaces);
    const nsFiltered = namespaceSet.size === 0
      ? allConfigMaps
      : allConfigMaps.filter(item => namespaceSet.has(item.namespace));
    const configMaps = this.applyTableSort('configMaps', this.applyTableSearch('configMaps', nsFiltered));
    if (!configMaps.length) {
      return `${this.renderSectionRefresh('configMaps')}<div class="kubernetes-resource-empty">${this.tableSearch.configMaps ? '沒有符合的資源。' : '目前篩選範圍沒有此類資源。'}</div>`;
    }
    return `
      ${this.renderSectionRefresh('configMaps')}
      <div class="kubernetes-resource-table-wrap">
        <table class="kubernetes-resource-table kubernetes-nscolored-table">
          <caption class="kubernetes-table-caption">ConfigMaps</caption>
          <thead><tr>${this.sortableTh('configMaps', 'name', 'Name')}${this.sortableTh('configMaps', 'namespace', 'Namespace')}${this.sortableTh('configMaps', 'dataKeys', 'Data', { type: 'number' })}${this.sortableTh('configMaps', 'creationTimestamp', 'Age', { type: 'time' })}</tr></thead>
          <tbody>${configMaps.map(item => `<tr ${this.resourceRowAttrs('configMaps', item.name, item.namespace, `border-left-color:${this.namespaceColor(item.namespace)}`)}>
            ${this.ellipsisCell(item.name)}
            <td>${this.renderNamespaceCell(item.namespace)}</td>
            <td>${Number(item.dataKeys || 0)}</td>
            <td>${formatAge(item.creationTimestamp)}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>`;
  }

  // Secrets 為 namespaced 資源，套用與 Pod 相同的 selectedNamespaces 多選篩選；
  // 每列左側色條＝該 namespace 的辨識色。可點擊開啟 detail drawer；列表僅顯示 metadata /
  // type / key 數量，後端 summary 不含任何 Secret value，前端亦不渲染任何機密內容。
  renderSecretsTable(allSecrets) {
    const selectedNamespaces = kubernetesSessionStore.getState().selectedNamespaces || [];
    const namespaceSet = new Set(selectedNamespaces);
    const nsFiltered = namespaceSet.size === 0
      ? allSecrets
      : allSecrets.filter(item => namespaceSet.has(item.namespace));
    const secrets = this.applyTableSort('secrets', this.applyTableSearch('secrets', nsFiltered));
    if (!secrets.length) {
      return `${this.renderSectionRefresh('secrets')}<div class="kubernetes-resource-empty">${this.tableSearch.secrets ? '沒有符合的資源。' : '目前篩選範圍沒有此類資源。'}</div>`;
    }
    return `
      ${this.renderSectionRefresh('secrets')}
      <div class="kubernetes-resource-table-wrap">
        <table class="kubernetes-resource-table kubernetes-nscolored-table">
          <caption class="kubernetes-table-caption">Secrets</caption>
          <thead><tr>${this.sortableTh('secrets', 'name', 'Name')}${this.sortableTh('secrets', 'namespace', 'Namespace')}${this.sortableTh('secrets', 'type', 'Type')}${this.sortableTh('secrets', 'dataKeys', 'Data', { type: 'number' })}${this.sortableTh('secrets', 'creationTimestamp', 'Age', { type: 'time' })}</tr></thead>
          <tbody>${secrets.map(item => `<tr ${this.resourceRowAttrs('secrets', item.name, item.namespace, `border-left-color:${this.namespaceColor(item.namespace)}`)}>
            ${this.ellipsisCell(item.name)}
            <td>${this.renderNamespaceCell(item.namespace)}</td>
            ${this.ellipsisCell(item.type)}
            <td>${Number(item.dataKeys || 0)}</td>
            <td>${formatAge(item.creationTimestamp)}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>`;
  }

  // DaemonSets 為 namespaced workload，套用與 Pod 相同的 selectedNamespaces 多選篩選；
  // 每列左側色條＝該 namespace 的辨識色。可點擊開啟 detail drawer。Ready 以 ready/desired 呈現。
  renderDaemonSetsTable(allDaemonSets) {
    const selectedNamespaces = kubernetesSessionStore.getState().selectedNamespaces || [];
    const namespaceSet = new Set(selectedNamespaces);
    const nsFiltered = namespaceSet.size === 0
      ? allDaemonSets
      : allDaemonSets.filter(item => namespaceSet.has(item.namespace));
    const daemonSets = this.applyTableSort('daemonSets', this.applyTableSearch('daemonSets', nsFiltered));
    if (!daemonSets.length) {
      return `${this.renderSectionRefresh('daemonSets')}<div class="kubernetes-resource-empty">${this.tableSearch.daemonSets ? '沒有符合的資源。' : '目前篩選範圍沒有此類資源。'}</div>`;
    }
    return `
      ${this.renderSectionRefresh('daemonSets')}
      <div class="kubernetes-resource-table-wrap">
        <table class="kubernetes-resource-table kubernetes-nscolored-table">
          <caption class="kubernetes-table-caption">DaemonSets</caption>
          <thead><tr>${this.sortableTh('daemonSets', 'name', 'Name')}${this.sortableTh('daemonSets', 'namespace', 'Namespace')}${this.sortableTh('daemonSets', 'status', 'Status')}${this.sortableTh('daemonSets', 'readyReplicas', 'Ready', { type: 'number' })}${this.sortableTh('daemonSets', 'creationTimestamp', 'Age', { type: 'time' })}</tr></thead>
          <tbody>${daemonSets.map(item => `<tr ${this.resourceRowAttrs('daemonSets', item.name, item.namespace, `border-left-color:${this.namespaceColor(item.namespace)}`)}>
            ${this.ellipsisCell(item.name)}
            <td>${this.renderNamespaceCell(item.namespace)}</td>
            <td>${statusBadge(item.status)}</td>
            <td>${Number(item.readyReplicas || 0)}/${Number(item.desiredReplicas || 0)}</td>
            <td>${formatAge(item.creationTimestamp)}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>`;
  }

  // Jobs 為 namespaced workload，套用與 Pod 相同的 selectedNamespaces 多選篩選；
  // 每列左側色條＝該 namespace 的辨識色。可點擊開啟 detail drawer。Completions 以 succeeded/desired 呈現。
  renderJobsTable(allJobs) {
    const selectedNamespaces = kubernetesSessionStore.getState().selectedNamespaces || [];
    const namespaceSet = new Set(selectedNamespaces);
    const nsFiltered = namespaceSet.size === 0
      ? allJobs
      : allJobs.filter(item => namespaceSet.has(item.namespace));
    const jobs = this.applyTableSort('jobs', this.applyTableSearch('jobs', nsFiltered));
    if (!jobs.length) {
      return `${this.renderSectionRefresh('jobs')}<div class="kubernetes-resource-empty">${this.tableSearch.jobs ? '沒有符合的資源。' : '目前篩選範圍沒有此類資源。'}</div>`;
    }
    return `
      ${this.renderSectionRefresh('jobs')}
      <div class="kubernetes-resource-table-wrap">
        <table class="kubernetes-resource-table kubernetes-nscolored-table">
          <caption class="kubernetes-table-caption">Jobs</caption>
          <thead><tr>${this.sortableTh('jobs', 'name', 'Name')}${this.sortableTh('jobs', 'namespace', 'Namespace')}<th scope="col">Completions</th>${this.sortableTh('jobs', 'status', 'Status')}${this.sortableTh('jobs', 'creationTimestamp', 'Age', { type: 'time' })}</tr></thead>
          <tbody>${jobs.map(item => `<tr ${this.resourceRowAttrs('jobs', item.name, item.namespace, `border-left-color:${this.namespaceColor(item.namespace)}`)}>
            ${this.ellipsisCell(item.name)}
            <td>${this.renderNamespaceCell(item.namespace)}</td>
            <td>${escapeHtml(item.completions ?? '-')}</td>
            <td>${statusBadge(item.status)}</td>
            <td>${formatAge(item.creationTimestamp)}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>`;
  }

  // CronJobs 為 namespaced workload，套用與 Pod 相同的 selectedNamespaces 多選篩選；
  // 每列左側色條＝該 namespace 的辨識色。可點擊開啟 detail drawer。
  renderCronJobsTable(allCronJobs) {
    const selectedNamespaces = kubernetesSessionStore.getState().selectedNamespaces || [];
    const namespaceSet = new Set(selectedNamespaces);
    const nsFiltered = namespaceSet.size === 0
      ? allCronJobs
      : allCronJobs.filter(item => namespaceSet.has(item.namespace));
    const cronJobs = this.applyTableSort('cronJobs', this.applyTableSearch('cronJobs', nsFiltered));
    if (!cronJobs.length) {
      return `${this.renderSectionRefresh('cronJobs')}<div class="kubernetes-resource-empty">${this.tableSearch.cronJobs ? '沒有符合的資源。' : '目前篩選範圍沒有此類資源。'}</div>`;
    }
    return `
      ${this.renderSectionRefresh('cronJobs')}
      <div class="kubernetes-resource-table-wrap">
        <table class="kubernetes-resource-table kubernetes-nscolored-table">
          <caption class="kubernetes-table-caption">CronJobs</caption>
          <thead><tr>${this.sortableTh('cronJobs', 'name', 'Name')}${this.sortableTh('cronJobs', 'namespace', 'Namespace')}${this.sortableTh('cronJobs', 'schedule', 'Schedule')}<th scope="col">Suspend</th><th scope="col">Last Schedule</th>${this.sortableTh('cronJobs', 'creationTimestamp', 'Age', { type: 'time' })}</tr></thead>
          <tbody>${cronJobs.map(item => `<tr ${this.resourceRowAttrs('cronJobs', item.name, item.namespace, `border-left-color:${this.namespaceColor(item.namespace)}`)}>
            ${this.ellipsisCell(item.name)}
            <td>${this.renderNamespaceCell(item.namespace)}</td>
            ${this.ellipsisCell(item.schedule)}
            <td>${item.suspend ? 'Yes' : 'No'}</td>
            <td>${item.lastSchedule && item.lastSchedule !== '-' ? formatAge(item.lastSchedule) : '-'}</td>
            <td>${formatAge(item.creationTimestamp)}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>`;
  }

  // Endpoints 為 namespaced 資源，套用與 Pod 相同的 selectedNamespaces 多選篩選；
  // 每列左側色條＝該 namespace 的辨識色。可點擊開啟 detail drawer。Addresses＝所有 subsets 位址加總。
  renderEndpointsTable(allEndpoints) {
    const selectedNamespaces = kubernetesSessionStore.getState().selectedNamespaces || [];
    const namespaceSet = new Set(selectedNamespaces);
    const nsFiltered = namespaceSet.size === 0
      ? allEndpoints
      : allEndpoints.filter(item => namespaceSet.has(item.namespace));
    const endpoints = this.applyTableSort('endpoints', this.applyTableSearch('endpoints', nsFiltered));
    if (!endpoints.length) {
      return `${this.renderSectionRefresh('endpoints')}<div class="kubernetes-resource-empty">${this.tableSearch.endpoints ? '沒有符合的資源。' : '目前篩選範圍沒有此類資源。'}</div>`;
    }
    return `
      ${this.renderSectionRefresh('endpoints')}
      <div class="kubernetes-resource-table-wrap">
        <table class="kubernetes-resource-table kubernetes-nscolored-table">
          <caption class="kubernetes-table-caption">Endpoints</caption>
          <thead><tr>${this.sortableTh('endpoints', 'name', 'Name')}${this.sortableTh('endpoints', 'namespace', 'Namespace')}${this.sortableTh('endpoints', 'addresses', 'Addresses', { type: 'number' })}${this.sortableTh('endpoints', 'creationTimestamp', 'Age', { type: 'time' })}</tr></thead>
          <tbody>${endpoints.map(item => `<tr ${this.resourceRowAttrs('endpoints', item.name, item.namespace, `border-left-color:${this.namespaceColor(item.namespace)}`)}>
            ${this.ellipsisCell(item.name)}
            <td>${this.renderNamespaceCell(item.namespace)}</td>
            <td>${Number(item.addresses || 0)}</td>
            <td>${formatAge(item.creationTimestamp)}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>`;
  }

  // NetworkPolicies 為 namespaced 資源，套用與 Pod 相同的 selectedNamespaces 多選篩選；
  // 每列左側色條＝該 namespace 的辨識色。可點擊開啟 detail drawer。Policy Types 為後端 join 之字串。
  renderNetworkPoliciesTable(allPolicies) {
    const selectedNamespaces = kubernetesSessionStore.getState().selectedNamespaces || [];
    const namespaceSet = new Set(selectedNamespaces);
    const nsFiltered = namespaceSet.size === 0
      ? allPolicies
      : allPolicies.filter(item => namespaceSet.has(item.namespace));
    const policies = this.applyTableSort('networkPolicies', this.applyTableSearch('networkPolicies', nsFiltered));
    if (!policies.length) {
      return `${this.renderSectionRefresh('networkPolicies')}<div class="kubernetes-resource-empty">${this.tableSearch.networkPolicies ? '沒有符合的資源。' : '目前篩選範圍沒有此類資源。'}</div>`;
    }
    return `
      ${this.renderSectionRefresh('networkPolicies')}
      <div class="kubernetes-resource-table-wrap">
        <table class="kubernetes-resource-table kubernetes-nscolored-table">
          <caption class="kubernetes-table-caption">Network Policies</caption>
          <thead><tr>${this.sortableTh('networkPolicies', 'name', 'Name')}${this.sortableTh('networkPolicies', 'namespace', 'Namespace')}<th scope="col">Policy Types</th>${this.sortableTh('networkPolicies', 'creationTimestamp', 'Age', { type: 'time' })}</tr></thead>
          <tbody>${policies.map(item => `<tr ${this.resourceRowAttrs('networkPolicies', item.name, item.namespace, `border-left-color:${this.namespaceColor(item.namespace)}`)}>
            ${this.ellipsisCell(item.name)}
            <td>${this.renderNamespaceCell(item.namespace)}</td>
            ${this.ellipsisCell(item.policyTypes)}
            <td>${formatAge(item.creationTimestamp)}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>`;
  }

  // ServiceAccounts 為 namespaced 資源，套用與 Pod 相同的 selectedNamespaces 多選篩選；
  // 每列左側色條＝該 namespace 的辨識色。可點擊開啟 detail drawer；列表 Secrets 僅顯示「數量」，
  // 後端 summary 不含任何 secret 名稱/token，前端亦不渲染任何機密內容。
  renderServiceAccountsTable(allServiceAccounts) {
    const selectedNamespaces = kubernetesSessionStore.getState().selectedNamespaces || [];
    const namespaceSet = new Set(selectedNamespaces);
    const nsFiltered = namespaceSet.size === 0
      ? allServiceAccounts
      : allServiceAccounts.filter(item => namespaceSet.has(item.namespace));
    const serviceAccounts = this.applyTableSort('serviceAccounts', this.applyTableSearch('serviceAccounts', nsFiltered));
    if (!serviceAccounts.length) {
      return `${this.renderSectionRefresh('serviceAccounts')}<div class="kubernetes-resource-empty">${this.tableSearch.serviceAccounts ? '沒有符合的資源。' : '目前篩選範圍沒有此類資源。'}</div>`;
    }
    return `
      ${this.renderSectionRefresh('serviceAccounts')}
      <div class="kubernetes-resource-table-wrap">
        <table class="kubernetes-resource-table kubernetes-nscolored-table">
          <caption class="kubernetes-table-caption">Service Accounts</caption>
          <thead><tr>${this.sortableTh('serviceAccounts', 'name', 'Name')}${this.sortableTh('serviceAccounts', 'namespace', 'Namespace')}${this.sortableTh('serviceAccounts', 'secrets', 'Secrets', { type: 'number' })}${this.sortableTh('serviceAccounts', 'creationTimestamp', 'Age', { type: 'time' })}</tr></thead>
          <tbody>${serviceAccounts.map(item => `<tr ${this.resourceRowAttrs('serviceAccounts', item.name, item.namespace, `border-left-color:${this.namespaceColor(item.namespace)}`)}>
            ${this.ellipsisCell(item.name)}
            <td>${this.renderNamespaceCell(item.namespace)}</td>
            <td>${Number(item.secrets || 0)}</td>
            <td>${formatAge(item.creationTimestamp)}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>`;
  }

  // Roles 為 namespaced RBAC 資源，套用與 Pod 相同的 selectedNamespaces 多選篩選；
  // 每列左側色條＝該 namespace 的辨識色。可點擊開啟 detail drawer。Rules 為規則數量。
  renderRolesTable(allRoles) {
    const selectedNamespaces = kubernetesSessionStore.getState().selectedNamespaces || [];
    const namespaceSet = new Set(selectedNamespaces);
    const nsFiltered = namespaceSet.size === 0
      ? allRoles
      : allRoles.filter(item => namespaceSet.has(item.namespace));
    const roles = this.applyTableSort('roles', this.applyTableSearch('roles', nsFiltered));
    if (!roles.length) {
      return `${this.renderSectionRefresh('roles')}<div class="kubernetes-resource-empty">${this.tableSearch.roles ? '沒有符合的資源。' : '目前篩選範圍沒有此類資源。'}</div>`;
    }
    return `
      ${this.renderSectionRefresh('roles')}
      <div class="kubernetes-resource-table-wrap">
        <table class="kubernetes-resource-table kubernetes-nscolored-table">
          <caption class="kubernetes-table-caption">Roles</caption>
          <thead><tr>${this.sortableTh('roles', 'name', 'Name')}${this.sortableTh('roles', 'namespace', 'Namespace')}${this.sortableTh('roles', 'rules', 'Rules', { type: 'number' })}${this.sortableTh('roles', 'creationTimestamp', 'Age', { type: 'time' })}</tr></thead>
          <tbody>${roles.map(item => `<tr ${this.resourceRowAttrs('roles', item.name, item.namespace, `border-left-color:${this.namespaceColor(item.namespace)}`)}>
            ${this.ellipsisCell(item.name)}
            <td>${this.renderNamespaceCell(item.namespace)}</td>
            <td>${Number(item.rules || 0)}</td>
            <td>${formatAge(item.creationTimestamp)}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>`;
  }

  // RoleBindings 為 namespaced RBAC 資源，套用與 Pod 相同的 selectedNamespaces 多選篩選；
  // 每列左側色條＝該 namespace 的辨識色。可點擊開啟 detail drawer。Role＝RoleRef.Kind/Name；Subjects 為 subject 數量。
  renderRoleBindingsTable(allRoleBindings) {
    const selectedNamespaces = kubernetesSessionStore.getState().selectedNamespaces || [];
    const namespaceSet = new Set(selectedNamespaces);
    const nsFiltered = namespaceSet.size === 0
      ? allRoleBindings
      : allRoleBindings.filter(item => namespaceSet.has(item.namespace));
    const roleBindings = this.applyTableSort('roleBindings', this.applyTableSearch('roleBindings', nsFiltered));
    if (!roleBindings.length) {
      return `${this.renderSectionRefresh('roleBindings')}<div class="kubernetes-resource-empty">${this.tableSearch.roleBindings ? '沒有符合的資源。' : '目前篩選範圍沒有此類資源。'}</div>`;
    }
    return `
      ${this.renderSectionRefresh('roleBindings')}
      <div class="kubernetes-resource-table-wrap">
        <table class="kubernetes-resource-table kubernetes-nscolored-table">
          <caption class="kubernetes-table-caption">Role Bindings</caption>
          <thead><tr>${this.sortableTh('roleBindings', 'name', 'Name')}${this.sortableTh('roleBindings', 'namespace', 'Namespace')}<th scope="col">Role</th>${this.sortableTh('roleBindings', 'subjects', 'Subjects', { type: 'number' })}${this.sortableTh('roleBindings', 'creationTimestamp', 'Age', { type: 'time' })}</tr></thead>
          <tbody>${roleBindings.map(item => `<tr ${this.resourceRowAttrs('roleBindings', item.name, item.namespace, `border-left-color:${this.namespaceColor(item.namespace)}`)}>
            ${this.ellipsisCell(item.name)}
            <td>${this.renderNamespaceCell(item.namespace)}</td>
            ${this.ellipsisCell(item.roleRef)}
            <td>${Number(item.subjects || 0)}</td>
            <td>${formatAge(item.creationTimestamp)}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>`;
  }

  // ClusterRoles 為 cluster-scoped RBAC 資源：不套用 namespace 多選篩選、不加色條/nscolored。
  // 可點擊開啟 detail drawer（namespace 留空）。Rules 為規則數量。
  renderClusterRolesTable(allClusterRoles) {
    const clusterRoles = this.applyTableSort('clusterRoles', this.applyTableSearch('clusterRoles', allClusterRoles));
    if (!clusterRoles.length) {
      return `${this.renderSectionRefresh('clusterRoles')}<div class="kubernetes-resource-empty">${this.tableSearch.clusterRoles ? '沒有符合的資源。' : '叢集沒有可顯示的 Cluster Role。'}</div>`;
    }
    return `
      ${this.renderSectionRefresh('clusterRoles')}
      <div class="kubernetes-resource-table-wrap">
        <table class="kubernetes-resource-table">
          <caption class="kubernetes-table-caption">Cluster Roles</caption>
          <thead><tr>${this.sortableTh('clusterRoles', 'name', 'Name')}${this.sortableTh('clusterRoles', 'rules', 'Rules', { type: 'number' })}${this.sortableTh('clusterRoles', 'creationTimestamp', 'Age', { type: 'time' })}</tr></thead>
          <tbody>${clusterRoles.map(item => `<tr ${this.resourceRowAttrs('clusterRoles', item.name, '')}>
            ${this.ellipsisCell(item.name)}
            <td>${Number(item.rules || 0)}</td>
            <td>${formatAge(item.creationTimestamp)}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>`;
  }

  // ClusterRoleBindings 為 cluster-scoped RBAC 資源：不套用 namespace 多選篩選、不加色條/nscolored。
  // 可點擊開啟 detail drawer（namespace 留空）。Role＝RoleRef.Kind/Name；Subjects 為 subject 數量。
  renderClusterRoleBindingsTable(allClusterRoleBindings) {
    const clusterRoleBindings = this.applyTableSort('clusterRoleBindings', this.applyTableSearch('clusterRoleBindings', allClusterRoleBindings));
    if (!clusterRoleBindings.length) {
      return `${this.renderSectionRefresh('clusterRoleBindings')}<div class="kubernetes-resource-empty">${this.tableSearch.clusterRoleBindings ? '沒有符合的資源。' : '叢集沒有可顯示的 Cluster Role Binding。'}</div>`;
    }
    return `
      ${this.renderSectionRefresh('clusterRoleBindings')}
      <div class="kubernetes-resource-table-wrap">
        <table class="kubernetes-resource-table">
          <caption class="kubernetes-table-caption">Cluster Role Bindings</caption>
          <thead><tr>${this.sortableTh('clusterRoleBindings', 'name', 'Name')}<th scope="col">Role</th>${this.sortableTh('clusterRoleBindings', 'subjects', 'Subjects', { type: 'number' })}${this.sortableTh('clusterRoleBindings', 'creationTimestamp', 'Age', { type: 'time' })}</tr></thead>
          <tbody>${clusterRoleBindings.map(item => `<tr ${this.resourceRowAttrs('clusterRoleBindings', item.name, '')}>
            ${this.ellipsisCell(item.name)}
            ${this.ellipsisCell(item.roleRef)}
            <td>${Number(item.subjects || 0)}</td>
            <td>${formatAge(item.creationTimestamp)}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>`;
  }

  // HPA 為 namespaced 資源，套用與 Pod 相同的 selectedNamespaces 多選篩選；
  // 每列左側色條＝該 namespace 的辨識色。可點擊開啟 detail drawer。Reference＝縮放目標 Kind/Name。
  renderHorizontalPodAutoscalersTable(allHpas) {
    const selectedNamespaces = kubernetesSessionStore.getState().selectedNamespaces || [];
    const namespaceSet = new Set(selectedNamespaces);
    const nsFiltered = namespaceSet.size === 0
      ? allHpas
      : allHpas.filter(item => namespaceSet.has(item.namespace));
    const hpas = this.applyTableSort('horizontalPodAutoscalers', this.applyTableSearch('horizontalPodAutoscalers', nsFiltered));
    if (!hpas.length) {
      return `${this.renderSectionRefresh('horizontalPodAutoscalers')}<div class="kubernetes-resource-empty">${this.tableSearch.horizontalPodAutoscalers ? '沒有符合的資源。' : '目前篩選範圍沒有此類資源。'}</div>`;
    }
    return `
      ${this.renderSectionRefresh('horizontalPodAutoscalers')}
      <div class="kubernetes-resource-table-wrap">
        <table class="kubernetes-resource-table kubernetes-nscolored-table">
          <caption class="kubernetes-table-caption">HPA</caption>
          <thead><tr>${this.sortableTh('horizontalPodAutoscalers', 'name', 'Name')}${this.sortableTh('horizontalPodAutoscalers', 'namespace', 'Namespace')}<th scope="col">Reference</th>${this.sortableTh('horizontalPodAutoscalers', 'minReplicas', 'Min', { type: 'number' })}${this.sortableTh('horizontalPodAutoscalers', 'maxReplicas', 'Max', { type: 'number' })}${this.sortableTh('horizontalPodAutoscalers', 'currentReplicas', 'Current', { type: 'number' })}${this.sortableTh('horizontalPodAutoscalers', 'creationTimestamp', 'Age', { type: 'time' })}</tr></thead>
          <tbody>${hpas.map(item => `<tr ${this.resourceRowAttrs('horizontalPodAutoscalers', item.name, item.namespace, `border-left-color:${this.namespaceColor(item.namespace)}`)}>
            ${this.ellipsisCell(item.name)}
            <td>${this.renderNamespaceCell(item.namespace)}</td>
            ${this.ellipsisCell(item.reference)}
            <td>${Number(item.minReplicas || 0)}</td>
            <td>${Number(item.maxReplicas || 0)}</td>
            <td>${Number(item.currentReplicas || 0)}</td>
            <td>${formatAge(item.creationTimestamp)}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>`;
  }

  // PDB 為 namespaced 資源，套用與 Pod 相同的 selectedNamespaces 多選篩選；
  // 每列左側色條＝該 namespace 的辨識色。可點擊開啟 detail drawer。Healthy 顯示 currentHealthy/desiredHealthy。
  renderPodDisruptionBudgetsTable(allPdbs) {
    const selectedNamespaces = kubernetesSessionStore.getState().selectedNamespaces || [];
    const namespaceSet = new Set(selectedNamespaces);
    const nsFiltered = namespaceSet.size === 0
      ? allPdbs
      : allPdbs.filter(item => namespaceSet.has(item.namespace));
    const pdbs = this.applyTableSort('podDisruptionBudgets', this.applyTableSearch('podDisruptionBudgets', nsFiltered));
    if (!pdbs.length) {
      return `${this.renderSectionRefresh('podDisruptionBudgets')}<div class="kubernetes-resource-empty">${this.tableSearch.podDisruptionBudgets ? '沒有符合的資源。' : '目前篩選範圍沒有此類資源。'}</div>`;
    }
    return `
      ${this.renderSectionRefresh('podDisruptionBudgets')}
      <div class="kubernetes-resource-table-wrap">
        <table class="kubernetes-resource-table kubernetes-nscolored-table">
          <caption class="kubernetes-table-caption">Pod Disruption Budgets</caption>
          <thead><tr>${this.sortableTh('podDisruptionBudgets', 'name', 'Name')}${this.sortableTh('podDisruptionBudgets', 'namespace', 'Namespace')}<th scope="col">Min Available</th><th scope="col">Max Unavailable</th>${this.sortableTh('podDisruptionBudgets', 'currentHealthy', 'Healthy', { type: 'number' })}${this.sortableTh('podDisruptionBudgets', 'creationTimestamp', 'Age', { type: 'time' })}</tr></thead>
          <tbody>${pdbs.map(item => `<tr ${this.resourceRowAttrs('podDisruptionBudgets', item.name, item.namespace, `border-left-color:${this.namespaceColor(item.namespace)}`)}>
            ${this.ellipsisCell(item.name)}
            <td>${this.renderNamespaceCell(item.namespace)}</td>
            <td>${escapeHtml(item.minAvailable ?? '-')}</td>
            <td>${escapeHtml(item.maxUnavailable ?? '-')}</td>
            <td>${Number(item.currentHealthy || 0)}/${Number(item.desiredHealthy || 0)}</td>
            <td>${formatAge(item.creationTimestamp)}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>`;
  }

  // ResourceQuota 為 namespaced 資源，套用與 Pod 相同的 selectedNamespaces 多選篩選；
  // 每列左側色條＝該 namespace 的辨識色。可點擊開啟 detail drawer。Hard Limits 為硬限制項目數量。
  renderResourceQuotasTable(allQuotas) {
    const selectedNamespaces = kubernetesSessionStore.getState().selectedNamespaces || [];
    const namespaceSet = new Set(selectedNamespaces);
    const nsFiltered = namespaceSet.size === 0
      ? allQuotas
      : allQuotas.filter(item => namespaceSet.has(item.namespace));
    const quotas = this.applyTableSort('resourceQuotas', this.applyTableSearch('resourceQuotas', nsFiltered));
    if (!quotas.length) {
      return `${this.renderSectionRefresh('resourceQuotas')}<div class="kubernetes-resource-empty">${this.tableSearch.resourceQuotas ? '沒有符合的資源。' : '目前篩選範圍沒有此類資源。'}</div>`;
    }
    return `
      ${this.renderSectionRefresh('resourceQuotas')}
      <div class="kubernetes-resource-table-wrap">
        <table class="kubernetes-resource-table kubernetes-nscolored-table">
          <caption class="kubernetes-table-caption">Resource Quotas</caption>
          <thead><tr>${this.sortableTh('resourceQuotas', 'name', 'Name')}${this.sortableTh('resourceQuotas', 'namespace', 'Namespace')}${this.sortableTh('resourceQuotas', 'hardLimits', 'Hard Limits', { type: 'number' })}<th scope="col">Scopes</th>${this.sortableTh('resourceQuotas', 'creationTimestamp', 'Age', { type: 'time' })}</tr></thead>
          <tbody>${quotas.map(item => `<tr ${this.resourceRowAttrs('resourceQuotas', item.name, item.namespace, `border-left-color:${this.namespaceColor(item.namespace)}`)}>
            ${this.ellipsisCell(item.name)}
            <td>${this.renderNamespaceCell(item.namespace)}</td>
            <td>${Number(item.hardLimits || 0)}</td>
            ${this.ellipsisCell(item.scopes)}
            <td>${formatAge(item.creationTimestamp)}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>`;
  }

  // CRD 為 cluster-scoped 資源：不套用 namespace 多選篩選、不加色條/nscolored。可點擊開啟 detail drawer（namespace 留空）。
  renderCustomResourceDefinitionsTable(allCrds) {
    const crds = this.applyTableSort('customResourceDefinitions', this.applyTableSearch('customResourceDefinitions', allCrds));
    if (!crds.length) {
      return `${this.renderSectionRefresh('customResourceDefinitions')}<div class="kubernetes-resource-empty">${this.tableSearch.customResourceDefinitions ? '沒有符合的資源。' : '叢集沒有可顯示的 CRD。'}</div>`;
    }
    return `
      ${this.renderSectionRefresh('customResourceDefinitions')}
      <div class="kubernetes-resource-table-wrap">
        <table class="kubernetes-resource-table">
          <caption class="kubernetes-table-caption">CRDs</caption>
          <thead><tr>${this.sortableTh('customResourceDefinitions', 'name', 'Name')}${this.sortableTh('customResourceDefinitions', 'group', 'Group')}${this.sortableTh('customResourceDefinitions', 'kind', 'Kind')}<th scope="col">Scope</th><th scope="col">Versions</th>${this.sortableTh('customResourceDefinitions', 'creationTimestamp', 'Age', { type: 'time' })}</tr></thead>
          <tbody>${crds.map(item => `<tr ${this.resourceRowAttrs('customResourceDefinitions', item.name, '')}>
            ${this.ellipsisCell(item.name)}
            ${this.ellipsisCell(item.group)}
            ${this.ellipsisCell(item.kind)}
            <td>${escapeHtml(item.scope ?? '-')}</td>
            <td>${escapeHtml(item.versions ?? '-')}</td>
            <td>${formatAge(item.creationTimestamp)}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>`;
  }

  renderDetailDrawer(state) {
    if (!state.detailOpen) return '';
    const detail = state.resourceDetail;
    const selected = state.selectedResource || {};
    const title = detail?.name || detail?.metadata?.name || selected.name || 'Resource Detail';
    const namespace = detail?.namespace || detail?.metadata?.namespace || selected.namespace || '';
    const kind = String(selected.kind || detail?.kind || '').toLowerCase();
    const isPod = kind === 'pod';
    let body = '';
    if (state.detailLoading && !detail) {
      body = '<div class="kubernetes-drawer-state"><span class="kubernetes-spinner"></span><span>正在載入資源詳細資訊</span></div>';
    } else if (state.detailError && !detail) {
      body = `<div class="kubernetes-session-error" role="alert"><strong>載入資源詳細資訊失敗</strong><span>${escapeHtml(state.detailError)}</span></div>`;
    } else if (detail) {
      body = this.renderResourceDetailTab(detail, selected, state);
    } else {
      body = '<div class="kubernetes-resource-empty">沒有可顯示的詳細資訊。</div>';
    }
    return `
      <div class="kubernetes-detail-backdrop no-drag" data-close-detail="true"></div>
      <aside class="kubernetes-detail-drawer no-drag ${isPod ? 'kubernetes-pod-detail-drawer' : ''}" role="dialog" aria-modal="true" aria-labelledby="kubernetesDetailTitle">
        <header><div><h2 id="kubernetesDetailTitle">${escapeHtml(title)}</h2><p><span class="kubernetes-detail-kind">${escapeHtml(selected.kind || detail?.kind || 'Kubernetes Resource')}</span>${namespace ? ` in ${escapeHtml(namespace)}` : ''}</p></div><button type="button" class="kubernetes-drawer-close no-drag" aria-label="關閉詳細資訊">${renderKubernetesIcon('close', 16)}</button></header>
        ${state.detailError && detail ? `<div class="kubernetes-session-error compact"><strong>重新整理失敗，以下為上次成功資料</strong><span>${escapeHtml(state.detailError)}</span></div>` : ''}
        ${detail ? this.renderResourceDetailTabs(state.detailTab, isPod) : ''}
        <div class="kubernetes-detail-body"${detail ? ` id="k8s-detail-panel" role="tabpanel" aria-labelledby="k8s-detail-tab-${escapeHtml(state.detailTab || 'overview')}"` : ''}>${body}</div>
      </aside>`;
  }

  renderResourceDetailTabs(activeTab = 'overview', isPod = false) {
    // 所有 kind 皆有 Overview / YAML / Delete；Pod 另保留 Logs / Forward。
    const tabs = isPod
      ? [['overview', 'Overview'], ['yaml', 'YAML'], ['logs', 'Logs'], ['forward', 'Forward'], ['delete', 'Delete']]
      : [['overview', 'Overview'], ['yaml', 'YAML'], ['delete', 'Delete']];
    // 內容面板 id 固定為 k8s-detail-panel；各 tab id 為 k8s-detail-tab-${id}。
    // aria-controls 指向面板、aria-selected 標示 active；面板側於 renderDetailDrawer 補 aria-labelledby。
    return `<nav class="kubernetes-pod-detail-tabs" aria-label="Pod 詳細資訊頁籤" role="tablist">${tabs.map(([id, label]) => `<button type="button" id="k8s-detail-tab-${id}" class="no-drag ${activeTab === id ? 'active' : ''} ${id === 'delete' ? 'danger' : ''}" data-detail-tab="${id}" role="tab" aria-selected="${activeTab === id}" aria-controls="k8s-detail-panel">${label}</button>`).join('')}</nav>`;
  }

  renderResourceDetailTab(detail, selected, state) {
    const isPod = String(selected.kind || detail.kind || '').toLowerCase() === 'pod';
    switch (state.detailTab) {
    case 'yaml':
      return this.renderDetailYAML(detail, selected, state);
    case 'logs':
      return isPod ? this.renderPodLogs(detail, selected, state, Array.isArray(detail.containers) ? detail.containers : []) : this.renderDetailContent(detail, selected, state);
    case 'forward':
      return isPod ? this.renderPodForward(detail, state) : this.renderDetailContent(detail, selected, state);
    case 'delete':
      return this.renderResourceDelete(detail, selected, state);
    default:
      return this.renderDetailContent(detail, selected, state);
    }
  }

  renderDetailContent(detail, selected, state) {
    const fields = detail.fields || detail.summary || {};
    const labels = detail.labels || detail.metadata?.labels || {};
    const conditions = Array.isArray(detail.conditions) ? detail.conditions : [];
    const containers = Array.isArray(detail.containers) ? detail.containers : [];
    const events = Array.isArray(detail.events) ? detail.events : [];
    const kind = detail.kind || selected.kind || '';
    // ① 核心欄位：即使空值也以 '—' 佔位，讓使用者能區分「沒有此欄」與「後端未回」。
    const coreEntries = [
      ['Status', detail.status],
      ['Namespace', detail.namespace || selected.namespace],
      ['UID', detail.uid],
      ['API Version', detail.apiVersion],
      ['Created At', detail.createdAt]
    ].map(([key, value]) => [key, (value === undefined || value === null || value === '') ? '—' : value]);
    // ① 動態 fields 維持有值才顯示（不佔位）。
    const dynamicEntries = normalizeEntries(fields)
      .filter(([, value]) => value !== undefined && value !== null && value !== '');
    const overviewEntries = [...coreEntries, ...dynamicEntries];
    return `
      ${this.renderDetailSection('Overview', overviewEntries, 'kubernetes-detail-fields')}
      ${this.renderDashboardSummarySection(kind, selected, state)}
      ${Array.isArray(detail.owners) && detail.owners.length ? `<section class="kubernetes-detail-section"><h3>Owned By</h3><div class="kubernetes-detail-owners">${detail.owners.map(owner => `<div><span>${escapeHtml(owner.kind || '-')}</span><strong>${escapeHtml(owner.name || '-')}</strong>${owner.controller ? '<small>controller</small>' : ''}</div>`).join('')}</div></section>` : ''}
      ${this.renderDetailSection('Labels', normalizeEntries(labels), 'kubernetes-detail-labels')}
      ${conditions.length ? `<section class="kubernetes-detail-section"><h3>Conditions</h3><div class="kubernetes-detail-conditions">${conditions.map(condition => `<div><strong>${escapeHtml(condition.type || '-')}</strong>${statusBadge(condition.status)}<span>${escapeHtml(condition.reason || '')}</span><p>${escapeHtml(condition.message || '')}</p></div>`).join('')}</div></section>` : ''}
      ${containers.length ? `<section class="kubernetes-detail-section"><h3>Containers</h3><div class="kubernetes-detail-containers">${containers.map(container => `<div><strong>${escapeHtml(container.name || '-')}</strong><span>${escapeHtml(container.image || '')}</span>${container.ready !== undefined ? statusBadge(container.ready ? 'Ready' : 'Not Ready') : ''}<small>${escapeHtml(container.state || container.status || '')}</small></div>`).join('')}</div></section>` : ''}
      ${detail.eventsError ? `<div class="kubernetes-session-error compact" role="status"><strong>Related Events 無法讀取</strong><span>${escapeHtml(detail.eventsError)}</span></div>` : ''}
      ${events.length ? `<section class="kubernetes-detail-section"><h3>Related Events</h3>${this.renderEventsTable(events)}</section>` : ''}`;
  }

  // ① Overview 重用 dashboard 快照摘要：依 kind 在對應摘要陣列中以 name(+namespace) 找到該資源，
  // 額外顯示該 kind 的重點欄位。找不到摘要（或該 kind 無對映）時略過此區塊（不報錯）。
  // 對映鍵沿用各表格 columns 的欄位名，值為 [欄位 key, 顯示標籤] 對。
  renderDashboardSummarySection(kind, selected, state) {
    const SUMMARY_FIELDS = {
      deployment: ['deployments', [['readyReplicas', 'Ready'], ['desiredReplicas', 'Desired'], ['availableReplicas', 'Available']]],
      statefulset: ['statefulSets', [['readyReplicas', 'Ready'], ['desiredReplicas', 'Desired'], ['availableReplicas', 'Available']]],
      service: ['services', [['type', 'Type'], ['clusterIp', 'Cluster IP'], ['ports', 'Ports']]],
      horizontalpodautoscaler: ['horizontalPodAutoscalers', [['reference', 'Reference'], ['minReplicas', 'Min'], ['maxReplicas', 'Max'], ['currentReplicas', 'Current']]],
      persistentvolumeclaim: ['persistentVolumeClaims', [['status', 'Status'], ['capacity', 'Capacity'], ['storageClass', 'Storage Class']]]
    };
    const mapping = SUMMARY_FIELDS[String(kind || '').toLowerCase()];
    if (!mapping) return '';
    const [arrayKey, fieldDefs] = mapping;
    const list = state?.dashboard?.[arrayKey];
    if (!Array.isArray(list)) return '';
    const name = selected?.name || '';
    const namespace = selected?.namespace || '';
    const summary = list.find(item =>
      item?.name === name && (item?.namespace || '') === (namespace || '')
    );
    if (!summary) return '';
    const entries = fieldDefs
      .map(([key, label]) => [label, summary[key]])
      .filter(([, value]) => value !== undefined && value !== null && value !== '');
    if (!entries.length) return '';
    return this.renderDetailSection('Summary', entries, 'kubernetes-detail-fields');
  }

  // ① object/array 值不再直接 JSON.stringify 成一長串：逐 key 呈現（key: value），
  // 每個值截斷 + hover title 顯示完整內容（如 annotations 類長物件）。純量值維持單值截斷。
  renderDetailValue(value) {
    if (value !== null && typeof value === 'object') {
      const entries = objectEntries(value);
      if (!entries.length) return '—';
      return entries.map(([key, item]) => {
        const text = typeof item === 'object' ? JSON.stringify(item) : String(item);
        return `<span class="kubernetes-detail-kv"><b>${escapeHtml(key)}:</b> <span class="kubernetes-detail-truncate" title="${escapeHtml(text)}">${escapeHtml(text)}</span></span>`;
      }).join('');
    }
    return escapeHtml(value);
  }

  renderDetailSection(title, entries, className) {
    if (!entries.length) return '';
    return `<section class="kubernetes-detail-section"><h3>${title}</h3><dl class="${className}">${entries.map(([key, value]) => `<div><dt>${escapeHtml(key)}</dt><dd>${this.renderDetailValue(value)}</dd></div>`).join('')}</dl></section>`;
  }

  renderPodLogs(detail, selected, state, containers) {
    const options = state.logOptions || {};
    const names = [...new Set(containers.map(item => item?.name).filter(Boolean))];
    const selectedContainer = options.container || names[0] || '';
    return `<section class="kubernetes-detail-section kubernetes-pod-logs">${this.renderLogsPanel(state, names, selectedContainer, 'drawer')}</section>`;
  }

  renderLogsPanel(state, containers, selectedContainer, variant) {
    const options = state.logOptions || {};
    const logs = this.visiblePodLogs(state.podLogs || '');
    const hasLogs = logs.length > 0;
    const canLoad = !state.logsLoading && selectedContainer;
    return `<div class="kubernetes-log-panel ${variant === 'action' ? 'kubernetes-log-panel-action' : ''}">
      <div class="kubernetes-log-header">
        <div><h3>Logs: ${escapeHtml(state.selectedResource?.name || 'Pod')}</h3><span>${escapeHtml(state.selectedResource?.namespace || options.namespace || '')}</span>${this.logPaused ? '<span class="kubernetes-log-paused">Paused</span>' : '<span class="kubernetes-watching">Streaming active</span>'}</div>
        <select id="kubernetesLogContainer" class="no-drag">${containers.map(name => `<option value="${escapeHtml(name)}" ${name === selectedContainer ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('')}</select>
      </div>
      <div class="kubernetes-log-load-controls">
        <div class="kubernetes-log-control-group">
          <span class="kubernetes-log-control-label">Tail Lines</span>
          <input id="kubernetesLogTailLines" class="no-drag" type="number" min="1" max="1000" value="${escapeHtml(options.tailLines || 200)}">
        </div>
        <label class="kubernetes-log-previous-toggle no-drag">
          <input id="kubernetesLogPrevious" type="checkbox" ${options.previous ? 'checked' : ''}>
          <span>Previous Logs</span>
        </label>
        <button type="button" id="reloadKubernetesPodLogs" class="no-drag kubernetes-primary-btn load-logs-btn" ${canLoad ? '' : 'disabled'}>
          ${state.logsLoading ? '<span class="kubernetes-spinner-mini"></span>' : ''}
          <span>${state.logsLoading ? '載入中...' : '載入 Logs'}</span>
        </button>
      </div>
      <div class="kubernetes-log-toolbar">
        <div class="kubernetes-log-toolbar-filters">
          <div class="kubernetes-log-search no-drag">
            <span class="kubernetes-log-search-icon" aria-hidden="true">${renderKubernetesIcon('search', 14)}</span>
            <input id="kubernetesLogSearch" class="no-drag" value="${escapeHtml(this.logSearch)}" placeholder="Search">
            <button type="button" aria-label="切換 Regex 比對" id="toggleKubernetesLogRegex" class="no-drag ${this.logRegex ? 'active' : ''}" title="切換 Regex 比對">.*</button>
          </div>
          <div class="kubernetes-log-level-group">
            <span class="kubernetes-log-level-icon" aria-hidden="true">${renderKubernetesIcon('filter', 14)}</span>
            <select id="kubernetesLogLevel" class="no-drag">
              <option value="all" ${this.logLevel === 'all' ? 'selected' : ''}>All Levels</option>
              <option value="error" ${this.logLevel === 'error' ? 'selected' : ''}>Error</option>
              <option value="warning" ${this.logLevel === 'warning' ? 'selected' : ''}>Warning</option>
              <option value="info" ${this.logLevel === 'info' ? 'selected' : ''}>Info</option>
              <option value="debug" ${this.logLevel === 'debug' ? 'selected' : ''}>Debug</option>
            </select>
          </div>
        </div>
        <div class="kubernetes-log-toolbar-actions">
          <button type="button" id="toggleKubernetesLogsPause" class="no-drag kubernetes-log-state-btn ${this.logPaused ? 'paused' : 'streaming'}">
            ${this.logPaused ? `${renderKubernetesIcon('play', 13)}<span>Follow</span>` : `${renderKubernetesIcon('pause', 13)}<span>Pause</span>`}
          </button>
          <div class="kubernetes-log-action-group">
            <button type="button" id="downloadKubernetesLogs" class="no-drag kubernetes-icon-btn" title="下載 Logs" aria-label="下載 Logs" ${hasLogs ? '' : 'disabled'}>
              ${renderKubernetesIcon('download', 16)}
            </button>
            <div class="kubernetes-log-options-wrap">
              <button type="button" id="toggleKubernetesLogOptions" class="no-drag kubernetes-icon-btn ${this.logDisplayOptionsOpen ? 'active' : ''}" title="Display Options" aria-label="Display Options">
                ${renderKubernetesIcon('sliders', 16)}
              </button>
              ${this.logDisplayOptionsOpen ? this.renderLogDisplayOptions() : ''}
            </div>
            <button type="button" id="clearKubernetesLogs" class="no-drag kubernetes-icon-btn danger" title="Clear" aria-label="Clear" ${state.podLogs ? '' : 'disabled'}>
              ${renderKubernetesIcon('trash', 16)}
            </button>
          </div>
        </div>
      </div>
      ${state.logsError ? `<div class="kubernetes-session-error compact" role="alert"><strong>Logs 載入失敗</strong><span>${escapeHtml(state.logsError)}</span></div>` : ''}
      ${state.logsTruncated ? '<div class="kubernetes-log-truncated" role="status">Logs 已達 1 MiB 顯示上限，內容已截斷。</div>' : ''}
      ${state.podLogs ? `<pre class="kubernetes-log-output ${this.logLineWrap ? 'wrap' : ''}" tabindex="0">${escapeHtml(logs.join('\n'))}</pre>` : `<div class="kubernetes-log-empty">${state.logsLoading ? '正在讀取 Pod Logs...' : '選擇 Container 後載入 Logs。'}</div>`}
    </div>`;
  }

  renderLogDisplayOptions() {
    return `<div class="kubernetes-log-options-menu no-drag" role="menu">
      <strong>DISPLAY OPTIONS</strong>
      <label><input id="kubernetesLogLineWrap" class="no-drag" type="checkbox" ${this.logLineWrap ? 'checked' : ''}>Line Wrap</label>
      <strong>TIMESTAMP</strong>
      <div class="kubernetes-log-timestamp-options">
        ${['off', 'utc', 'local'].map(mode => `<button type="button" class="no-drag ${this.logTimestampMode === mode ? 'active' : ''}" data-log-timestamp="${mode}">${mode === 'off' ? 'Off' : mode.toUpperCase()}</button>`).join('')}
      </div>
    </div>`;
  }

  visiblePodLogs(content) {
    const query = this.logSearch.trim();
    let matcher = null;
    if (query) {
      if (this.logRegex) {
        try {
          matcher = line => new RegExp(query, 'i').test(line);
        } catch {
          matcher = () => false;
        }
      } else {
        const lower = query.toLowerCase();
        matcher = line => line.toLowerCase().includes(lower);
      }
    }
    return String(content || '').split('\n')
      .filter(line => this.logLevel === 'all' || logLevelForLine(line) === this.logLevel)
      .filter(line => !matcher || matcher(line))
      .map(line => this.formatLogTimestamp(line));
  }

  formatLogTimestamp(line) {
    if (this.logTimestampMode === 'off') return line;
    const parts = splitLogTimestamp(line);
    if (!parts) return line;
    const date = new Date(parts.timestamp);
    const timestamp = this.logTimestampMode === 'utc' ? date.toISOString() : date.toLocaleString();
    return `${timestamp}${parts.separator}${parts.message}`;
  }

  downloadVisiblePodLogs() {
    const state = kubernetesSessionStore.getState();
    const content = this.visiblePodLogs(state.podLogs || '').join('\n');
    if (!content) return;
    const podName = state.selectedResource?.name || 'pod';
    const namespace = state.selectedResource?.namespace || state.logOptions?.namespace || 'default';
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${namespace}-${podName}-logs.txt`;
    link.click();
    URL.revokeObjectURL(url);
  }

  // 泛用 YAML 頁籤：工具列圖示（搜尋 / 編輯 / 複製）＋ 檢視 / 編輯兩態。
  // Secret（data 已遮蔽）與 Pod（已 sanitized 移除 env）不可編輯回寫，故停用編輯，只留搜尋 / 複製。
  renderDetailYAML(detail, selected, state) {
    const original = String(detail.yaml || '');
    const kind = String(selected.kind || detail.kind || '').toLowerCase();
    const editDisabled = kind === 'secret' || kind === 'pod';
    const editing = this.yamlEditing && !editDisabled;
    const draft = this.yamlEditDraft !== null ? this.yamlEditDraft : original;

    if (!original) {
      return '<section class="kubernetes-detail-section kubernetes-pod-yaml"><header><h3>YAML</h3></header><div class="kubernetes-resource-empty">目前沒有可顯示的 YAML。</div></section>';
    }

    // 檢視模式下依搜尋詞（不分大小寫）以 <mark> 標記符合處，第一個符合處加 id 供捲動定位。
    // 先 escapeHtml 內容與搜尋詞（讓兩者的特殊字元一致），再對 escaped 文字做正則標記。
    let viewHtml = escapeHtml(original);
    if (!editing) {
      const term = this.yamlSearchTerm.trim();
      if (term) {
        const escapedTerm = escapeHtml(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        let matched = false;
        viewHtml = viewHtml.replace(new RegExp(escapedTerm, 'gi'), (m) => {
          const id = matched ? '' : ' id="kubernetesYAMLFirstMatch"';
          matched = true;
          return `<mark${id}>${m}</mark>`;
        });
      }
    }

    const toolbar = `<div class="kubernetes-yaml-toolbar">
      <button type="button" id="toggleKubernetesYAMLSearch" class="no-drag kubernetes-icon-btn ${this.yamlSearchOpen ? 'active' : ''}" title="搜尋" aria-label="搜尋" ${editing ? 'disabled' : ''}>${renderKubernetesIcon('search', 16)}</button>
      <button type="button" id="editKubernetesYAML" class="no-drag kubernetes-icon-btn ${editing ? 'active' : ''}" title="${editDisabled ? '此資源的 YAML 已遮蔽，無法編輯套用' : '編輯'}" aria-label="編輯" ${editDisabled ? 'disabled' : ''}>${renderKubernetesIcon('edit', 16)}</button>
      <button type="button" id="copyKubernetesYAML" class="no-drag kubernetes-icon-btn" title="複製" aria-label="複製">${renderKubernetesIcon('copy', 16)}</button>
    </div>`;

    const searchBox = (this.yamlSearchOpen && !editing)
      ? `<div class="kubernetes-yaml-search no-drag"><span class="kubernetes-yaml-search-icon" aria-hidden="true">${renderKubernetesIcon('search', 14)}</span><input id="kubernetesYAMLSearch" class="no-drag" value="${escapeHtml(this.yamlSearchTerm)}" placeholder="搜尋 YAML"></div>`
      : '';

    const body = editing
      ? `${state.updateError ? `<div class="kubernetes-session-error compact" role="alert"><strong>套用 YAML 失敗</strong><span>${escapeHtml(state.updateError)}</span><button type="button" id="reloadKubernetesResourceYAML" class="no-drag kubernetes-secondary-btn" ${state.updateLoading ? 'disabled' : ''}>重新載入最新版本</button></div>` : ''}
        <textarea id="kubernetesYAMLEditor" class="no-drag kubernetes-yaml-editor" spellcheck="false" autocapitalize="off" autocomplete="off" ${state.updateLoading ? 'readonly' : ''}>${escapeHtml(draft)}</textarea>
        <div class="kubernetes-yaml-edit-actions">
          <button type="button" id="applyKubernetesYAML" class="no-drag kubernetes-primary-btn" title="套用" aria-label="套用" ${state.updateLoading ? 'disabled' : ''}>${renderKubernetesIcon('check', 14)}<span>${state.updateLoading ? '套用中...' : '套用'}</span></button>
          <button type="button" id="cancelKubernetesYAML" class="no-drag kubernetes-secondary-btn" title="取消" aria-label="取消" ${state.updateLoading ? 'disabled' : ''}>${renderKubernetesIcon('close', 14)}<span>取消</span></button>
        </div>`
      : `${editDisabled ? '<div class="kubernetes-yaml-readonly-hint" role="status">Secret/Pod 的 YAML 已遮蔽，無法編輯套用。</div>' : ''}
        <pre class="kubernetes-yaml-output" tabindex="0"><code>${viewHtml}</code></pre>`;

    return `<section class="kubernetes-detail-section kubernetes-pod-yaml kubernetes-detail-yaml"><header><h3>YAML</h3>${toolbar}</header>
      ${searchBox}
      ${body}
    </section>`;
  }

  renderPodForward(detail, state) {
    const ports = [];
    for (const container of Array.isArray(detail.containers) ? detail.containers : []) {
      for (const port of Array.isArray(container.ports) ? container.ports : []) {
        const value = Number(port.port);
        if (Number.isInteger(value) && value > 0 && !ports.some(item => item.port === value)) {
          ports.push({ ...port, port: value, container: container.name });
        }
      }
    }
    return `<section class="kubernetes-detail-section kubernetes-pod-forward"><h3>Port Forward</h3>
      ${state.forwardsError ? `<div class="kubernetes-session-error compact" role="alert"><strong>Port Forward 操作失敗</strong><span>${escapeHtml(state.forwardsError)}</span></div>` : ''}
      <div class="kubernetes-forward-list">${ports.map(port => `<div class="kubernetes-forward-card"><div><strong>${escapeHtml(port.name || port.container || `Port ${port.port}`)}</strong><span>${port.port}/${escapeHtml(port.protocol || 'TCP')}</span></div><label>本機 Port<input class="no-drag kubernetes-forward-local-port" type="number" min="0" max="65535" value="${port.port}"></label><button type="button" class="no-drag kubernetes-primary-btn start-kubernetes-forward" data-remote-port="${port.port}" ${state.forwardsLoading ? 'disabled' : ''}>Forward</button></div>`).join('')}</div>
      ${ports.length ? '' : '<p class="kubernetes-forward-empty">Pod 未宣告 Container Port，可使用自訂連接埠。</p>'}
      <div class="kubernetes-forward-custom"><label>本機 Port<input id="kubernetesForwardCustomLocal" class="no-drag" type="number" min="0" max="65535" value="0"></label><label>Pod Port<input id="kubernetesForwardCustomRemote" class="no-drag" type="number" min="1" max="65535"></label><button type="button" id="startKubernetesCustomForward" class="no-drag kubernetes-secondary-btn" ${state.forwardsLoading ? 'disabled' : ''}>建立自訂 Forward</button></div>
      <h3>Active Forwards</h3>
      ${state.podForwards.length ? `<div class="kubernetes-active-forwards">${state.podForwards.map(item => `<div><code>${escapeHtml(item.address)}:${item.localPort} → ${item.remotePort}</code><button type="button" class="no-drag stop-kubernetes-forward" data-forward-id="${escapeHtml(item.id)}" ${state.forwardsLoading ? 'disabled' : ''}>停止</button></div>`).join('')}</div>` : `<div class="kubernetes-forward-empty">${state.forwardsLoading ? '正在更新 Port Forward...' : '目前沒有作用中的 Port Forward。'}</div>`}
    </section>`;
  }

  renderResourceDelete(detail, selected, state) {
    const kind = detail.kind || selected.kind || 'Resource';
    const name = detail.name || selected.name || '';
    const namespace = detail.namespace || selected.namespace || '';
    const fullId = `${kind}${namespace ? `/${namespace}` : ''}/${name}`;
    const highRisk = isHighRiskKubernetesKind(kind);

    if (highRisk) {
      // 高風險 kind：移除脆弱的 3 秒自動重置，改為要求輸入完整資源名稱比對後才啟用刪除。
      const typed = this.deleteConfirmInput || '';
      const matched = name !== '' && typed === name;
      return `<section class="kubernetes-detail-section kubernetes-pod-delete">
        ${state.deleteError ? `<div class="kubernetes-session-error compact" role="alert"><strong>刪除 ${escapeHtml(kind)} 失敗</strong><span>${escapeHtml(state.deleteError)}</span></div>` : ''}
        <div class="kubernetes-delete-highrisk">
          <strong>Delete ${escapeHtml(fullId)}</strong>
          <small>此為高風險資源，動作無法復原。請輸入資源名稱 <code>${escapeHtml(name)}</code> 以啟用刪除。</small>
          <input type="text" id="kubernetesDeleteConfirmInput" class="no-drag" autocomplete="off" spellcheck="false" placeholder="輸入資源名稱以確認" value="${escapeHtml(typed)}" ${state.deleteLoading ? 'disabled' : ''}>
          <button type="button" id="deleteKubernetesResource" class="no-drag kubernetes-danger-btn" ${(state.deleteLoading || !matched) ? 'disabled' : ''}>${state.deleteLoading ? '刪除中...' : '確認刪除'}</button>
        </div>
      </section>`;
    }

    // 低風險 kind：兩段點擊確認，確認階段由 this.pendingDeleteConfirm 決定（狀態驅動，
    // 重繪不會重置）。第一次點擊後按鈕改為「確認刪除 X？」並套用 confirm-stage 樣式。
    const confirming = this.pendingDeleteConfirm === true;
    const buttonLabel = state.deleteLoading
      ? '刪除中...'
      : (confirming ? `確認刪除 ${escapeHtml(fullId)}？` : 'Delete');
    return `<section class="kubernetes-detail-section kubernetes-pod-delete">
      ${state.deleteError ? `<div class="kubernetes-session-error compact" role="alert"><strong>刪除 ${escapeHtml(kind)} 失敗</strong><span>${escapeHtml(state.deleteError)}</span></div>` : ''}
      <div><span><strong>Delete ${escapeHtml(fullId)}</strong><small>此動作無法復原，Controller 管理的 Pod 可能會自動重建。</small></span><button type="button" id="deleteKubernetesResource" class="no-drag kubernetes-danger-btn ${confirming ? 'confirm-stage' : ''}" ${state.deleteLoading ? 'disabled' : ''}>${buttonLabel}</button></div>
    </section>`;
  }

  renderCreateDrawer(state) {
    if (!state.createOpen) return '';
    const content = String(this.createYAMLDraft ?? state.createResourceYAML ?? '');
    const hasUnsavedChanges = this.createYAMLDraft !== null && this.createYAMLDraft !== state.createResourceYAML;
    const lineCount = Math.max(1, content.split('\n').length);
    return `
      <div class="kubernetes-detail-backdrop no-drag" data-close-create="true"></div>
      <aside class="kubernetes-create-drawer no-drag" role="dialog" aria-modal="true" aria-labelledby="kubernetesCreateResourceTitle">
        <header><h2 id="kubernetesCreateResourceTitle">Create Resource</h2><button type="button" class="kubernetes-drawer-close no-drag" aria-label="關閉建立資源視窗">${renderKubernetesIcon('close', 16)}</button></header>
        <div class="kubernetes-create-toolbar">
          <div class="kubernetes-create-actions"><button type="button" id="applyKubernetesResource" class="no-drag kubernetes-primary-btn" ${state.createLoading || state.createSaving ? 'disabled' : ''}>${state.createLoading ? '套用中...' : 'Apply'}</button><button type="button" id="saveKubernetesResourceYAML" class="no-drag kubernetes-secondary-btn" ${state.createLoading || state.createSaving ? 'disabled' : ''}>${state.createSaving ? '儲存中...' : 'Save'}</button></div>
          <label><span class="kubernetes-visually-hidden">Resource Type</span><select id="kubernetesCreateResourceType" class="no-drag" ${state.createLoading || state.createSaving ? 'disabled' : ''}>${KUBERNETES_CREATE_RESOURCE_GROUPS.map(([group, types]) => `<optgroup label="${escapeHtml(group)}">${types.map(type => `<option value="${type}" ${type === state.createResourceType ? 'selected' : ''}>${type}</option>`).join('')}</optgroup>`).join('')}</select></label>
        </div>
        ${state.createError || state.createSaveError ? `<div class="kubernetes-session-error compact kubernetes-create-error" role="alert"><strong>Kubernetes Resource YAML 操作失敗</strong><span>${escapeHtml(state.createError || state.createSaveError)}</span></div>` : ''}
        ${state.createSavedPath && !hasUnsavedChanges ? `<div class="kubernetes-create-saved" role="status">已儲存至：<code>${escapeHtml(state.createSavedPath)}</code></div>` : ''}
        <div class="kubernetes-create-editor">
          <pre id="kubernetesCreateLineNumbers" aria-hidden="true">${Array.from({ length: lineCount }, (_, index) => index + 1).join('\n')}</pre>
          <textarea id="kubernetesCreateYAML" class="no-drag" aria-label="Kubernetes Resource YAML" spellcheck="false" autocapitalize="off" autocomplete="off" ${state.createLoading ? 'readonly' : ''}>${escapeHtml(content)}</textarea>
        </div>
      </aside>`;
  }

  render() {
    const state = kubernetesSessionStore.getState();
    const cluster = state.connectedCluster;
    if (!cluster) {
      this.innerHTML = '<div class="kubernetes-session-empty"><div class="kubernetes-empty-icon">K8s</div><h1>尚未連接 Kubernetes Cluster</h1><p>請返回 Vaults 的 Kubernetes 頁面選擇叢集。</p></div>';
      return;
    }

    const dashboard = state.dashboard;
    const namespace = state.selectedNamespace || cluster.namespace || 'default';
    const activeSection = state.activeSection || 'overview';
    const clusterName = cluster.displayName || cluster.clusterName || cluster.contextName;
    const namespaces = Array.from(new Set(['*', ...(state.namespaces || []), namespace])).filter(Boolean);
    const sectionTitle = SECTIONS.find(([id]) => id === activeSection)?.[1] || 'Overview';
    const namespaceControl = this.renderNamespaceMultiSelect(state, namespaces);
    let content = '';
    if (state.podActionView) {
      content = this.renderPodActionView(state);
    } else
    if (state.dashboardLoading && !dashboard) {
      content = '<div class="kubernetes-session-loading" role="status" aria-live="polite"><span class="kubernetes-spinner" aria-hidden="true"></span><h2>正在讀取 Kubernetes API</h2></div>';
    } else if (state.dashboardError && !dashboard) {
      content = `<div class="kubernetes-session-error" role="alert"><strong>${dashboardErrorTitle(state.dashboardError)}</strong><span>${escapeHtml(state.dashboardError)}</span></div>`;
    } else if (dashboard) {
      content = activeSection === 'overview' ? this.renderOverview(dashboard) : this.renderResourceTable(activeSection, dashboard);
    }

    this.innerHTML = `
      <div class="kubernetes-session-layout no-drag">
        <aside class="kubernetes-session-nav">
          <div class="kubernetes-session-cluster"><span class="kubernetes-session-status" aria-hidden="true"></span><span class="kubernetes-visually-hidden">已連接</span><div><strong>${escapeHtml(clusterName)}</strong><small>${escapeHtml(cluster.contextName || '')}</small></div></div>
          ${namespaceControl}
          <nav aria-label="Kubernetes 資源導覽">${SECTION_GROUPS.map(([group, sections]) => `<div class="kubernetes-nav-group ${this.collapsedNavGroups.has(group) ? 'collapsed' : ''}"><button type="button" class="no-drag kubernetes-nav-heading" data-nav-group="${escapeHtml(group)}" aria-expanded="${this.collapsedNavGroups.has(group) ? 'false' : 'true'}"><span>${group}</span><svg class="kubernetes-nav-caret" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button>${sections.map(([id, label]) => `<button type="button" class="no-drag kubernetes-section-link ${activeSection === id ? 'active' : ''}" data-section="${id}" ${activeSection === id ? 'aria-current="page"' : ''}>${label}</button>`).join('')}</div>`).join('')}</nav>
        </aside>
        <main class="kubernetes-session-content">
          ${state.podActionView ? '' : `<header class="kubernetes-session-header"><div><span>Kubernetes Session</span><h1>${escapeHtml(sectionTitle)}</h1><p>${escapeHtml(cluster.server || cluster.clusterName || cluster.contextName)}${dashboard?.serverVersion ? ` · ${escapeHtml(dashboard.serverVersion)}` : ''}</p></div><div class="kubernetes-session-actions"><button type="button" id="openKubernetesCreateResource" class="no-drag kubernetes-primary-btn">Create Resource</button></div></header>`}
          ${state.dashboardError && dashboard ? `<div class="kubernetes-session-error compact" role="status"><strong>${dashboardErrorTitle(state.dashboardError, true)}</strong><span>${escapeHtml(state.dashboardError)}</span></div>` : ''}
          ${content}
        </main>
        ${this.renderDetailDrawer(state)}
        ${this.renderCreateDrawer(state)}
      </div>`;
  }

  setupListeners() {
    const namespaceSelect = this.querySelector('#kubernetesNamespaceSelect');
    namespaceSelect?.addEventListener('focus', () => this.markNamespaceSelectInteracting(true));
    namespaceSelect?.addEventListener('pointerdown', () => this.markNamespaceSelectInteracting(true));
    namespaceSelect?.addEventListener('mousedown', () => this.markNamespaceSelectInteracting(true));
    namespaceSelect?.addEventListener('blur', () => this.markNamespaceSelectInteracting(false));
    namespaceSelect?.addEventListener('change', (event) => {
      this.markNamespaceSelectInteracting(false);
      kubernetesSessionStore.getState().selectNamespace(event.target.value).catch(() => {});
    });

    // 多選下拉：切換面板開合。
    const namespaceToggle = this.querySelector('#kubernetesNamespaceToggle');
    namespaceToggle?.addEventListener('click', (event) => {
      event.stopPropagation();
      this.setNamespaceDropdownOpen(!this.namespaceDropdownOpen);
    });
    // 勾選 All Namespaces → 清空具體選取。
    this.querySelector('[data-namespace-all]')?.addEventListener('change', () => {
      this.markNamespaceSelectInteracting(true);
      kubernetesSessionStore.getState().selectAllNamespaces()
        .catch(() => {})
        .finally(() => this.markNamespaceSelectInteracting(false));
    });
    // 勾/取消單一具體 namespace（勾任一會自動取消 All，由 store toggle 處理）。
    this.querySelectorAll('[data-namespace-option]').forEach(input => {
      input.addEventListener('change', () => {
        this.markNamespaceSelectInteracting(true);
        kubernetesSessionStore.getState().toggleNamespace(input.value)
          .catch(() => {})
          .finally(() => this.markNamespaceSelectInteracting(false));
      });
    });

    this.querySelector('#refreshKubernetesSection')?.addEventListener('click', () => this.runManualRefresh());
    this.querySelector('#refreshKubernetesPods')?.addEventListener('click', () => this.runManualRefresh());
    this.querySelectorAll('[data-pod-filter]').forEach(button => button.addEventListener('click', () => {
      this.podFilter = button.dataset.podFilter;
      this.render();
      this.setupListeners();
    }));
    this.querySelector('#kubernetesPodSearch')?.addEventListener('input', event => {
      this.podSearch = event.target.value;
      const cursor = event.target.selectionStart;
      this.render();
      this.setupListeners();
      const replacement = this.querySelector('#kubernetesPodSearch');
      replacement?.focus();
      replacement?.setSelectionRange(cursor, cursor);
    });
    // 通用 section 搜尋：更新該 section 搜尋詞後重繪，並 refocus + 還原游標位置（同 pod search 做法）。
    this.querySelector('#kubernetesSectionSearch')?.addEventListener('input', event => {
      const section = event.target.dataset.sectionSearch;
      this.tableSearch[section] = event.target.value;
      const cursor = event.target.selectionStart;
      this.render();
      this.setupListeners();
      const replacement = this.querySelector('#kubernetesSectionSearch');
      replacement?.focus();
      replacement?.setSelectionRange(cursor, cursor);
    });
    // ② Events Type 篩選：切換後更新元件狀態並重繪（events 表存在於 Events 區段與 drawer Related Events）。
    this.querySelector('#kubernetesEventsTypeFilter')?.addEventListener('change', event => {
      this.eventsTypeFilter = event.target.value || 'all';
      this.render();
      this.setupListeners();
    });
    // 排序委派：點擊（或 Enter/Space）表頭 [data-sort-key] → 對該 section 切換 asc → desc → 無。
    const activeSectionForSort = kubernetesSessionStore.getState().activeSection || 'overview';
    const toggleSort = (th) => {
      const key = th.dataset.sortKey;
      if (!key) return;
      const type = th.dataset.sortType || '';
      const current = this.tableSort[activeSectionForSort];
      if (!current || current.key !== key) {
        this.tableSort[activeSectionForSort] = { key, dir: 'asc', type };
      } else if (current.dir === 'asc') {
        this.tableSort[activeSectionForSort] = { key, dir: 'desc', type };
      } else {
        delete this.tableSort[activeSectionForSort]; // desc → 無排序
      }
      this.render();
      this.setupListeners();
    };
    this.querySelectorAll('[data-sort-key]').forEach(th => {
      th.addEventListener('click', () => toggleSort(th));
      th.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        toggleSort(th);
      });
    });
    this.querySelectorAll('[data-pod-action]').forEach(button => button.addEventListener('click', event => {
      event.stopPropagation();
      const pod = JSON.parse(decodeURIComponent(button.dataset.pod));
      const store = kubernetesSessionStore.getState();
      if (button.dataset.podAction === 'logs') store.openPodLogsView(pod, button.dataset.container).catch(() => {});
      if (button.dataset.podAction === 'shell') store.openPodShellView(pod, button.dataset.container);
      if (button.dataset.podAction === 'forward') store.openPodForwardFromSummary(pod).catch(() => {});
    }));
    this.querySelector('#closeKubernetesPodAction')?.addEventListener('click', () => {
      this.disposePodShell();
      kubernetesSessionStore.getState().closePodActionView();
    });
    this.querySelector('#openKubernetesCreateResource')?.addEventListener('click', () => {
      this.returnToCreateButton = true;
      this.detailReturnTarget = null;
      this.createYAMLDraft = null;
      kubernetesSessionStore.getState().openCreateResource();
    });
    this.querySelectorAll('.kubernetes-nav-heading[data-nav-group]').forEach((heading) => {
      heading.addEventListener('click', () => {
        const group = heading.dataset.navGroup;
        if (this.collapsedNavGroups.has(group)) this.collapsedNavGroups.delete(group);
        else this.collapsedNavGroups.add(group);
        this.render();
        this.setupListeners();
      });
    });
    this.querySelectorAll('.kubernetes-section-link').forEach((button) => {
      button.addEventListener('click', () => kubernetesSessionStore.getState().selectSection(button.dataset.section));
    });
    this.querySelectorAll('.kubernetes-resource-row').forEach((row) => {
      const open = () => {
        // 切換到另一個資源時，清掉前一個資源的刪除確認輸入與 YAML 編輯/搜尋狀態，避免誤帶。
        this.deleteConfirmInput = '';
        this.pendingDeleteConfirm = false;
        this.yamlEditing = false;
        this.yamlEditDraft = null;
        this.yamlSearchTerm = '';
        this.yamlSearchOpen = false;
        this.detailReturnTarget = {
          kind: row.dataset.resourceKind,
          name: row.dataset.resourceName,
          namespace: row.dataset.resourceNamespace
        };
        kubernetesSessionStore.getState().openResource(row.dataset.resourceKind, {
          name: row.dataset.resourceName,
          namespace: row.dataset.resourceNamespace,
          apiVersion: row.dataset.resourceApiversion || ''
        }).catch(() => {});
      };
      row.addEventListener('click', open);
      row.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        open();
      });
    });
    // Detail drawer 關閉鈕 / backdrop：走未存變更守衛（YAML 編輯中有變更時先確認）。
    this.querySelector('.kubernetes-detail-drawer .kubernetes-drawer-close')?.addEventListener('click', () => this.guardedCloseDetail());
    this.querySelector('[data-close-detail="true"]')?.addEventListener('click', () => this.guardedCloseDetail());
    // Create drawer 關閉鈕 / backdrop：走未存變更守衛（YAML 有編輯時先確認）。
    this.querySelector('.kubernetes-create-drawer .kubernetes-drawer-close')?.addEventListener('click', () => this.guardedCloseCreate());
    this.querySelector('[data-close-create="true"]')?.addEventListener('click', () => this.guardedCloseCreate());
    this.querySelector('#kubernetesCreateResourceType')?.addEventListener('change', async event => {
      const select = event.target;
      const previousType = kubernetesSessionStore.getState().createResourceType;
      // 切換資源類型會以新模板覆蓋 YAML。若使用者已編輯（draft 與目前模板不同）則先確認，避免丟失編輯內容。
      const currentTemplate = kubernetesSessionStore.getState().createResourceYAML;
      const hasUnsavedChanges = this.createYAMLDraft !== null && this.createYAMLDraft !== currentTemplate;
      if (hasUnsavedChanges && !(await confirmDialog('切換資源類型將以新模板覆蓋目前的 YAML，您尚未套用的編輯內容會遺失。確定要切換嗎？', { title: '確認切換資源類型', danger: true }))) {
        // 還原下拉選單至原本的資源類型，不覆蓋編輯內容。
        select.value = previousType;
        return;
      }
      this.createYAMLDraft = null;
      kubernetesSessionStore.getState().selectCreateResourceType(select.value);
    });
    this.querySelector('#applyKubernetesResource')?.addEventListener('click', async () => {
      const yaml = this.querySelector('#kubernetesCreateYAML')?.value || '';
      // 破壞性操作二次確認：套用 YAML 前明確標示目標 cluster / namespace，避免誤套用到錯誤環境。
      const applyState = kubernetesSessionStore.getState();
      const applyCluster = applyState.connectedCluster || {};
      const clusterLabel = applyCluster.displayName || applyCluster.clusterName || applyCluster.contextName || '未知叢集';
      const namespaceLabel = applyState.selectedNamespace || applyCluster.namespace || 'default';
      if (!(await confirmDialog(`即將套用 YAML 至：\n\nCluster：${clusterLabel}\nNamespace：${namespaceLabel}\n\n此操作會在叢集上建立 / 變更資源，確定要套用嗎？`, { title: '確認套用資源', danger: true }))) {
        return;
      }
      kubernetesSessionStore.getState().applyCreateResource(yaml).catch(() => {});
    });
    this.querySelector('#saveKubernetesResourceYAML')?.addEventListener('click', () => {
      const yaml = this.querySelector('#kubernetesCreateYAML')?.value || '';
      kubernetesSessionStore.getState().saveCreateResourceYAML(yaml).catch(() => {});
    });
    // 高風險資源刪除：輸入名稱比對，即時切換刪除按鈕的 disabled 狀態（不重繪，避免輸入焦點遺失）。
    const deleteConfirmInput = this.querySelector('#kubernetesDeleteConfirmInput');
    if (deleteConfirmInput) {
      deleteConfirmInput.addEventListener('input', () => {
        this.deleteConfirmInput = deleteConfirmInput.value;
        const selected = kubernetesSessionStore.getState().selectedResource || {};
        const targetName = selected.name || '';
        const deleteBtn = this.querySelector('#deleteKubernetesResource');
        if (deleteBtn) {
          deleteBtn.disabled = !(targetName !== '' && deleteConfirmInput.value === targetName);
        }
      });
    }
    const createEditor = this.querySelector('#kubernetesCreateYAML');
    const createLineNumbers = this.querySelector('#kubernetesCreateLineNumbers');
    createEditor?.addEventListener('input', () => {
      this.createYAMLDraft = createEditor.value;
      this.querySelector('.kubernetes-create-saved')?.remove();
      const count = Math.max(1, createEditor.value.split('\n').length);
      if (createLineNumbers) createLineNumbers.textContent = Array.from({ length: count }, (_, index) => index + 1).join('\n');
    });
    createEditor?.addEventListener('scroll', () => {
      if (createLineNumbers) createLineNumbers.scrollTop = createEditor.scrollTop;
    });
    createEditor?.addEventListener('keydown', event => {
      if (event.key !== 'Tab') return;
      event.preventDefault();
      const start = createEditor.selectionStart;
      const end = createEditor.selectionEnd;
      createEditor.setRangeText('  ', start, end, 'end');
      createEditor.dispatchEvent(new Event('input'));
    });
    this.querySelector('#reloadKubernetesPodLogs')?.addEventListener('click', () => {
      const container = this.querySelector('#kubernetesLogContainer')?.value || '';
      const previous = this.querySelector('#kubernetesLogPrevious')?.checked === true;
      const tailLines = Number(this.querySelector('#kubernetesLogTailLines')?.value || 200);
      kubernetesSessionStore.getState().loadPodLogs({ container, previous, tailLines }).catch(() => {});
    });
    this.querySelector('#kubernetesLogSearch')?.addEventListener('input', event => {
      this.logSearch = event.target.value;
      const cursor = event.target.selectionStart;
      this.render();
      this.setupListeners();
      const replacement = this.querySelector('#kubernetesLogSearch');
      replacement?.focus();
      replacement?.setSelectionRange(cursor, cursor);
    });
    this.querySelector('#toggleKubernetesLogRegex')?.addEventListener('click', () => {
      this.logRegex = !this.logRegex;
      this.render();
      this.setupListeners();
    });
    this.querySelector('#kubernetesLogLevel')?.addEventListener('change', event => {
      this.logLevel = event.target.value || 'all';
      this.render();
      this.setupListeners();
    });
    this.querySelector('#toggleKubernetesLogsPause')?.addEventListener('click', () => {
      this.logPaused = !this.logPaused;
      this.render();
      this.setupListeners();
    });
    this.querySelector('#downloadKubernetesLogs')?.addEventListener('click', () => this.downloadVisiblePodLogs());
    this.querySelector('#toggleKubernetesLogOptions')?.addEventListener('click', () => {
      this.logDisplayOptionsOpen = !this.logDisplayOptionsOpen;
      this.render();
      this.setupListeners();
    });
    this.querySelector('#kubernetesLogLineWrap')?.addEventListener('change', event => {
      this.logLineWrap = event.target.checked === true;
      this.render();
      this.setupListeners();
    });
    this.querySelectorAll('[data-log-timestamp]').forEach(button => {
      button.addEventListener('click', () => {
        this.logTimestampMode = button.dataset.logTimestamp || 'off';
        this.render();
        this.setupListeners();
      });
    });
    this.querySelector('#clearKubernetesLogs')?.addEventListener('click', () => {
      kubernetesSessionStore.getState().clearPodLogs();
      this.logSearch = '';
      this.render();
      this.setupListeners();
    });
    // YAML 頁籤：複製目前 YAML（編輯中則複製草稿）。
    this.querySelector('#copyKubernetesYAML')?.addEventListener('click', () => {
      const editorValue = this.querySelector('#kubernetesYAMLEditor')?.value;
      const yaml = editorValue !== undefined ? editorValue : (kubernetesSessionStore.getState().resourceDetail?.yaml || '');
      if (!yaml) return;
      navigator.clipboard?.writeText(yaml)
        .then(() => showToast('已複製', { type: 'success' }))
        .catch(() => showToast('複製失敗', { type: 'error' }));
    });
    // YAML 頁籤：切換搜尋框；開啟後聚焦輸入。
    this.querySelector('#toggleKubernetesYAMLSearch')?.addEventListener('click', () => {
      this.yamlSearchOpen = !this.yamlSearchOpen;
      if (!this.yamlSearchOpen) this.yamlSearchTerm = '';
      this.render();
      this.setupListeners();
      this.querySelector('#kubernetesYAMLSearch')?.focus();
    });
    // YAML 搜尋輸入：即時標記並捲動到第一個符合處（重繪後重綁，保留焦點與游標）。
    this.querySelector('#kubernetesYAMLSearch')?.addEventListener('input', event => {
      this.yamlSearchTerm = event.target.value;
      const cursor = event.target.selectionStart;
      this.render();
      this.setupListeners();
      const replacement = this.querySelector('#kubernetesYAMLSearch');
      replacement?.focus();
      replacement?.setSelectionRange(cursor, cursor);
      this.querySelector('#kubernetesYAMLFirstMatch')?.scrollIntoView({ block: 'center' });
    });
    // YAML 頁籤：進入編輯模式（Secret/Pod 已停用按鈕，不會觸發）。
    this.querySelector('#editKubernetesYAML')?.addEventListener('click', () => {
      this.yamlEditing = true;
      this.yamlSearchOpen = false;
      this.yamlSearchTerm = '';
      this.yamlEditDraft = kubernetesSessionStore.getState().resourceDetail?.yaml || '';
      kubernetesSessionStore.getState().clearError();
      this.render();
      this.setupListeners();
      this.querySelector('#kubernetesYAMLEditor')?.focus();
    });
    const yamlEditor = this.querySelector('#kubernetesYAMLEditor');
    yamlEditor?.addEventListener('input', () => {
      this.yamlEditDraft = yamlEditor.value;
    });
    yamlEditor?.addEventListener('keydown', event => {
      if (event.key !== 'Tab') return;
      event.preventDefault();
      const start = yamlEditor.selectionStart;
      const end = yamlEditor.selectionEnd;
      yamlEditor.setRangeText('  ', start, end, 'end');
      this.yamlEditDraft = yamlEditor.value;
    });
    // YAML 頁籤：套用編輯（呼叫 store applyResourceYAML；成功後自動重載 detail）。
    this.querySelector('#applyKubernetesYAML')?.addEventListener('click', async () => {
      const yaml = this.querySelector('#kubernetesYAMLEditor')?.value || '';
      const applyState = kubernetesSessionStore.getState();
      const resource = applyState.selectedResource || {};
      const applyCluster = applyState.connectedCluster || {};
      const clusterLabel = applyCluster.displayName || applyCluster.clusterName || applyCluster.contextName || '未知叢集';
      if (!(await confirmDialog(`即將以編輯後的 YAML 更新資源：\n\nCluster：${clusterLabel}\n資源：${resource.kind || ''}/${resource.name || ''}\n\n此操作會變更叢集上的資源，確定要套用嗎？`, { title: '確認套用資源', danger: true }))) {
        return;
      }
      try {
        await kubernetesSessionStore.getState().applyResourceYAML(yaml);
        // 成功：退出編輯狀態（openResource 重載會重繪 detail）。
        this.yamlEditing = false;
        this.yamlEditDraft = null;
      } catch {
        // 失敗：保留編輯內容與錯誤訊息，重繪以顯示 updateError。
        this.render();
        this.setupListeners();
        this.querySelector('#kubernetesYAMLEditor')?.focus();
      }
    });
    // YAML 頁籤：套用失敗（尤其 409 Conflict）時，重新載入最新版本的 detail。
    // 退出編輯狀態並清掉草稿與 updateError，讓編輯器內容換成最新 YAML，
    // 使用者再依提示重新套用其變更（不做三方合併，行為誠實）。
    this.querySelector('#reloadKubernetesResourceYAML')?.addEventListener('click', () => {
      const store = kubernetesSessionStore.getState();
      const selected = store.selectedResource || {};
      this.yamlEditing = false;
      this.yamlEditDraft = null;
      store.clearError();
      if (selected.kind && selected.name) {
        store.openResource(selected.kind, selected).catch(() => {});
      }
      showToast('已載入最新版本，請重新套用你的變更', { type: 'info', title: 'Kubernetes YAML' });
    });
    // YAML 頁籤：取消編輯，還原檢視模式。
    this.querySelector('#cancelKubernetesYAML')?.addEventListener('click', () => {
      this.yamlEditing = false;
      this.yamlEditDraft = null;
      kubernetesSessionStore.getState().clearError();
      this.render();
      this.setupListeners();
    });
    this.querySelectorAll('.start-kubernetes-forward').forEach(button => {
      button.addEventListener('click', () => {
        const localPort = button.closest('.kubernetes-forward-card')?.querySelector('.kubernetes-forward-local-port')?.value;
        kubernetesSessionStore.getState().startPodPortForward({ localPort, remotePort: button.dataset.remotePort }).catch(() => {});
      });
    });
    this.querySelector('#startKubernetesCustomForward')?.addEventListener('click', () => {
      kubernetesSessionStore.getState().startPodPortForward({
        localPort: this.querySelector('#kubernetesForwardCustomLocal')?.value,
        remotePort: this.querySelector('#kubernetesForwardCustomRemote')?.value
      }).catch(() => {});
    });
    this.querySelectorAll('.stop-kubernetes-forward').forEach(button => {
      button.addEventListener('click', () => kubernetesSessionStore.getState().stopPodPortForward(button.dataset.forwardId).catch(() => {}));
    });
  }

  async initPodShell() {
    const state = kubernetesSessionStore.getState();
    const container = this.querySelector('#kubernetesPodShellTerminal');
    if (state.podActionView?.type !== 'shell' || !container || this.shellTerminal) return;
    const pod = state.selectedResource || {};
    this.shellTerminal = new Terminal({ cursorBlink: true, fontSize: 12, fontFamily: 'SFMono-Regular, Consolas, Liberation Mono, monospace' });
    this.shellTerminal.open(container);
    this.shellTerminal.writeln('正在連接 Pod Shell...');
    try {
      this.shellSession = await KubernetesAPI.startPodShell({ namespace: pod.namespace, podName: pod.name, container: state.podActionView.container, cols: this.shellTerminal.cols, rows: this.shellTerminal.rows });
      this.shellTerminal.clear();
      this.shellTerminal.onData(data => KubernetesAPI.writePodShellInput({ sessionId: this.shellSession?.sessionId || '', data }).catch(() => {}));
      this.shellResizeObserver = new ResizeObserver(() => this.resizePodShell(container));
      this.shellResizeObserver.observe(container);
      this.resizePodShell(container);
      this.shellTerminal.focus();
    } catch (error) {
      this.shellTerminal.writeln(`\r\n開啟 Pod Shell 失敗：${error?.message || error}`);
    }
  }

  resizePodShell(container) {
    if (!this.shellTerminal || !this.shellSession || !container?.isConnected) return;
    const rect = container.getBoundingClientRect();
    const dimensions = this.shellTerminal._core?._renderService?.dimensions?.css?.cell;
    const cols = Math.max(20, Math.floor(rect.width / (dimensions?.width || 7.5)));
    const rows = Math.max(5, Math.floor(rect.height / (dimensions?.height || 17)));
    if (cols === this.shellTerminal.cols && rows === this.shellTerminal.rows) return;
    this.shellTerminal.resize(cols, rows);
    KubernetesAPI.resizePodShell({ sessionId: this.shellSession.sessionId, cols, rows }).catch(() => {});
  }

  disposePodShell() {
    const sessionId = this.shellSession?.sessionId;
    this.shellResizeObserver?.disconnect();
    this.shellResizeObserver = null;
    this.shellTerminal?.dispose();
    this.shellTerminal = null;
    this.shellSession = null;
    if (sessionId) KubernetesAPI.closePodShell(sessionId).catch(() => {});
  }
}

if (!customElements.get('kubernetes-session-page')) {
  customElements.define('kubernetes-session-page', KubernetesSessionPage);
}

import { kubernetesSessionStore } from './KubernetesSessionStore.js';
import { KUBERNETES_CREATE_RESOURCE_GROUPS } from './KubernetesResourceTemplates.js';
import { KubernetesAPI } from './KubernetesAPI.js';
import { onWailsEvent, openBrowserURL } from '../../platform/wails/events.ts';
import { confirmDialog } from '../../components/feedback/confirmDialog';
import { showToast } from '../../components/feedback/toast.js';
import { suppressScrollbarAutohide } from '../../runtime/scrollbarAutohide';
import { terminalStore } from '../terminal/TerminalStore.js';
import { t } from '../../i18n/index.ts';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Kubernetes Session 不是文字輸入介面時，WebView 會將 Backspace 套用成瀏覽器歷史返回。
// 僅在真正可編輯的欄位放行，確保 Delete／Backspace 只負責刪除輸入文字。
function isTextEditingTarget(target) {
  return Boolean(target?.closest?.('input, textarea, [contenteditable="true"], [contenteditable=""]'));
}

// 高風險 Kubernetes 資源類型：刪除這些資源影響範圍大且難以復原，
// 因此採用「輸入資源名稱比對」的嚴格確認，而非脆弱的雙擊 + 自動逾時機制。
// 註：Deployment 與 StatefulSet 亦列為高風險——刪除它們會連帶砍光其管理的 Pod，
// 破壞力與其他 controller 相當，故改走輸入名稱確認流程。
// Pod 維持低風險（controller 會自動重建，破壞力低），採兩段點擊確認。
const HIGH_RISK_KUBERNETES_KINDS = new Set([
  'deployment', 'statefulset', 'daemonset', 'replicaset',
  'persistentvolume', 'persistentvolumeclaim', 'pv', 'pvc',
  'namespace', 'node', 'ingress',
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
// 每個 section 對應的 Tabler 圖示（左側導覽用），提升掃視性。未列者退回通用圖示。
const SECTION_ICONS = {
  overview: 'ti-layout-dashboard',
  namespaces: 'ti-box',
  nodes: 'ti-server-2',
  events: 'ti-bell',
  customResourceDefinitions: 'ti-puzzle',
  pods: 'ti-box-multiple',
  deployments: 'ti-rocket',
  statefulsets: 'ti-database',
  daemonSets: 'ti-topology-star-3',
  jobs: 'ti-briefcase',
  cronJobs: 'ti-clock-hour-4',
  configMaps: 'ti-file-text',
  secrets: 'ti-lock',
  services: 'ti-router',
  ingresses: 'ti-arrow-guide',
  endpoints: 'ti-plug',
  networkPolicies: 'ti-shield-lock',
  persistentVolumeClaims: 'ti-file-database',
  persistentVolumes: 'ti-database',
  storageClasses: 'ti-stack-2',
  horizontalPodAutoscalers: 'ti-arrows-maximize',
  podDisruptionBudgets: 'ti-shield-half',
  resourceQuotas: 'ti-gauge',
  serviceAccounts: 'ti-user-cog',
  roles: 'ti-user-shield',
  roleBindings: 'ti-users',
  clusterRoles: 'ti-shield-check',
  clusterRoleBindings: 'ti-users-group'
};
const sectionIcon = (id) => SECTION_ICONS[id] || 'ti-circle';

const SECTIONS = SECTION_GROUPS.flatMap(([, sections]) => sections);
const QUICK_ACCESS_GROUP = 'QUICK ACCESS';
const FAVORITES_SECTION = 'favorites';
const FAVORITE_RESOURCE_STORAGE_KEY = 'termix.k8s.favoriteResources';
const FAVORITABLE_SECTIONS = new Set(['deployments', 'statefulsets', 'daemonSets']);
const FAVORITE_DASHBOARD_KEYS = Object.freeze({
  deployments: 'deployments',
  statefulsets: 'statefulSets',
  daemonSets: 'daemonSets'
});
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

// namespace 篩選下拉：多於 1 個 namespace 即顯示搜尋框；單次最多渲染的 namespace 列數
// （含隱藏 select），避免大叢集每次重繪都建立/解析成千上萬個節點造成卡頓。
const NAMESPACE_SEARCH_THRESHOLD = 1;
const NAMESPACE_OPTION_CAP = 200;

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

// 「檢視關聯 Pods」支援的 kind（小寫）→ dashboard 快照中對應的 summary 陣列鍵。
// 這些 kind 的 summary 皆含 selector（Service.spec.selector 或 workload.spec.selector.matchLabels），
// 用來以 label 比對反查所屬 Pod（Deployment 的 Pod 由 ReplicaSet 擁有，故不用 ownerReferences）。
const POD_SOURCE_ARRAYS = Object.freeze({
  deployment: 'deployments',
  statefulset: 'statefulSets',
  daemonset: 'daemonSets',
  service: 'services'
});

// core scope（首屏漸進載入）已備妥資料的 section；其餘 section 在 full 到齊前顯示載入中。
const CORE_SECTIONS = new Set(['overview', 'pods', 'deployments', 'statefulsets', 'daemonSets', 'services', 'events', 'nodes', 'namespaces']);

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

// Pod 清單的非健康狀態採整列高亮：Pending 為警告，其餘高風險狀態為錯誤。
function podAttentionTone(pod) {
  const value = `${pod?.phase || ''} ${pod?.status || ''}`.toLowerCase();
  if (/pending/.test(value)) return 'warning';
  if (/failed|error|crash|evicted|lost|unhealthy|not[\s-]?ready|unknown/.test(value)) return 'danger';
  return '';
}

// 依狀態語意回傳色票 CSS 變數（供 metric 色點、condition 左側色條）。
function statusToneColor(value) {
  const s = String(value || '').toLowerCase();
  if (/running|active|ready|bound|succeeded|available|healthy|true/.test(s)) return 'var(--color-success)';
  if (/pending|progress|waiting|terminating|updating|scaling/.test(s)) return 'var(--color-warning)';
  if (/fail|error|crash|evicted|lost|unhealthy|notready|false/.test(s)) return 'var(--color-danger)';
  return 'var(--color-text-muted)';
}

function dashboardErrorTitle(error, hasSnapshot = false) {
  const message = String(error || '');
  if (/沒有 list 權限|forbidden|RBAC/i.test(message)) return t('k8s.dashboard.errorRbac');
  if (/認證已失效|unauthorized/i.test(message)) return t('k8s.dashboard.errorUnauthorized');
  return hasSnapshot ? t('k8s.dashboard.errorRefresh') : t('k8s.dashboard.errorLoad');
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
    arrowDown: '<path d="M12 5v14"></path><path d="m6 13 6 6 6-6"></path>',
    refresh: '<path d="M21 12a9 9 0 1 1-3-6.7"></path><path d="M21 4v5h-5"></path>',
    external: '<path d="M14 4h6v6"></path><path d="M20 4 11 13"></path><path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6"></path>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2"></rect>',
    sliders: '<path d="M4 6h16"></path><path d="M4 12h16"></path><path d="M4 18h16"></path><circle cx="9" cy="6" r="1.75"></circle><circle cx="15" cy="12" r="1.75"></circle><circle cx="11" cy="18" r="1.75"></circle>',
    trash: '<path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="M6 6l1 14h10l1-14"></path><path d="M10 11v5"></path><path d="M14 11v5"></path>',
    close: '<path d="m5 5 14 14"></path><path d="m19 5-14 14"></path>',
    edit: '<path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"></path>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15V5a2 2 0 0 1 2-2h10"></path>',
    check: '<path d="M20 6 9 17l-5-5"></path>',
    alert: '<path d="M12 3 2.8 20h18.4L12 3z"></path><path d="M12 9v4"></path><path d="M12 17h.01"></path>',
    box: '<path d="M12 3 3 7.5v9L12 21l9-4.5v-9z"></path><path d="M3 7.5 12 12l9-4.5"></path><path d="M12 12v9"></path>'
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
    // Secret data 已揭露明文的快取（key→明文）；切換資源時清空，避免跨 Secret 殘留。
    this.revealedSecrets = {};
    this.revealedSecretsFor = null;
    // YAML 頁籤本地狀態（不污染 store）：編輯草稿 / 是否編輯中 / 搜尋詞。
    this.yamlEditDraft = null;
    this.yamlEditing = false;
    this.yamlSearchTerm = '';
    this.yamlSearchOpen = false;
    this.podFilter = 'all';
    this.podSearch = '';
    // 從 workload/service 抽屜「檢視關聯 Pods」跳轉後的 label 過濾條件（純前端、存元件上）：
    // { kind, name, namespace, selector: { [key]: value } }；null＝無過濾。切換 section 或點清除即歸零。
    this.podLabelFilter = null;
    // Events 表的 Type 篩選（純前端、存元件上，輪詢重繪保留）：'all' | 'Warning' | 'Normal'。
    this.eventsTypeFilter = 'all';
    // Events 搜尋詞（比對 reason / namespace / object / message）。
    this.eventsSearch = '';
    // 目前於 Drawer 開啟檢視的事件（純前端本地狀態，點列開啟、關閉歸零）；null＝未開。
    this.selectedEvent = null;
    // 資源清單排序狀態（純前端、存元件上，輪詢重繪保留）：
    // { [section]: { key, dir: 'asc' | 'desc' } }；無此鍵＝該 section 無排序（原序）。
    this.tableSort = {};
    // 資源清單通用搜尋詞（純前端、存元件上，避免污染 store）：{ [section]: term }。
    // Pods 沿用既有 this.podSearch，不納入此表。
    this.tableSearch = {};
    // 資源清單多選狀態（純前端、存元件上）：key = `${kind}|${namespace}|${name}`
    // → { kind, name, namespace, apiVersion }。切換 section 即清空（見 section 導覽點擊處理）。
    this.selectedRows = new Map();
    // 使用者手動點擊 Refresh 進行中的旗標（純前端）：期間停用按鈕並顯示「更新中…」，
    // 避免重複點擊；成功/失敗都要清除。與背景 3 秒輪詢的 loading 分開，不互相干擾。
    this.manualRefreshing = false;
    this.dashboardTimer = null;
    this.logsTimer = null;
    this.runtimeEventOffs = [];
    this.namespaceSelectInteracting = false;
    this.namespaceInteractionTimer = null;
    this.namespaceDropdownOpen = false;
    // 多選 namespace 的草稿選取；下拉開啟期間累積，關閉時才套用（避免每勾一次就重載）。
    this.namespaceDraft = null;
    // namespace 搜尋詞（下拉內即時過濾用）。
    this.namespaceFilter = '';
    // 側邊欄可收合分組：存放目前收合（隱藏子項）的分組名稱；預設全部展開。
    this.collapsedNavGroups = new Set();
    // Quick access：使用者以星號收藏的資源類型（section id）。以 localStorage 持久化、跨 session 保留。
    this.quickAccessSections = this.loadQuickAccess();
    // 我的最愛：保存具體工作負載的穩定識別資訊；Dashboard 內的狀態與副本數不寫入，避免快取過期。
    this.favoriteResources = this.loadFavoriteResources();
    this.handleNamespaceOutsideClick = this.handleNamespaceOutsideClick.bind(this);
    this.logSearch = '';
    this.logRegex = false;
    this.logLevel = 'all';
    this.logPaused = false;
    this.logLineWrap = false;
    this.logTimestampMode = 'off';
    this.logDisplayOptionsOpen = false;
    // Log 輸出捲動體驗（純前端）：是否貼底自動跟隨、未讀新行數、上次渲染的可見行數。
    this.logStickBottom = true;
    this.logNewLines = 0;
    this.logLineCount = 0;
    // Tail lines / Previous logs 現收進 ⚙ 選單，選單關閉時 DOM 不存在，故值存元件上，Load 時讀取。
    this.logTailLines = 200;
    this.logPreviousLogs = false;
    this.handlePageClick = this.handlePageClick.bind(this);
    this.handlePageKeydown = this.handlePageKeydown.bind(this);
  }

  // 從 localStorage 載入 Quick access 收藏（僅保留目前仍存在的合法 section id）。
  loadQuickAccess() {
    try {
      const raw = globalThis.localStorage?.getItem('termix.k8s.quickAccess');
      const list = raw ? JSON.parse(raw) : [];
      const valid = Array.isArray(list) ? list.filter(id => SECTIONS.some(([sid]) => sid === id)) : [];
      return new Set(valid);
    } catch {
      return new Set();
    }
  }

  saveQuickAccess() {
    try {
      globalThis.localStorage?.setItem('termix.k8s.quickAccess', JSON.stringify([...this.quickAccessSections]));
    } catch {
      // localStorage 不可用時靜默略過（僅失去持久化，功能仍可用於當前 session）。
    }
  }

  toggleQuickAccess(sectionId) {
    if (!sectionId) return;
    if (this.quickAccessSections.has(sectionId)) this.quickAccessSections.delete(sectionId);
    else this.quickAccessSections.add(sectionId);
    this.saveQuickAccess();
    this.render();
    this.setupListeners();
  }

  // 目前連線叢集的穩定識別優先使用卡片 ID；舊資料或測試環境沒有 ID 時退回 context / cluster 名稱。
  favoriteClusterKey(cluster) {
    const source = cluster && typeof cluster === 'object' ? cluster : {};
    return String(source.clusterId || source.contextName || source.clusterName || '').trim();
  }

  loadFavoriteResources() {
    try {
      const raw = globalThis.localStorage?.getItem(FAVORITE_RESOURCE_STORAGE_KEY);
      const list = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(list)) return [];
      const seen = new Set();
      return list.filter((item) => {
        const section = String(item?.section || '');
        const clusterId = String(item?.clusterId || '').trim();
        const name = String(item?.name || '').trim();
        const namespace = String(item?.namespace || '').trim();
        const key = `${clusterId}|${section}|${namespace}|${name}`;
        if (!FAVORITABLE_SECTIONS.has(section) || !clusterId || !name || seen.has(key)) return false;
        seen.add(key);
        return true;
      }).map(item => ({
        clusterId: String(item.clusterId).trim(),
        clusterName: String(item.clusterName || '').trim(),
        section: String(item.section),
        kind: String(item.kind || RESOURCE_META[item.section]?.kind || '').trim(),
        apiVersion: String(item.apiVersion || RESOURCE_META[item.section]?.apiVersion || '').trim(),
        name: String(item.name).trim(),
        namespace: String(item.namespace || '').trim()
      }));
    } catch {
      return [];
    }
  }

  saveFavoriteResources() {
    try {
      globalThis.localStorage?.setItem(FAVORITE_RESOURCE_STORAGE_KEY, JSON.stringify(this.favoriteResources));
    } catch {
      // localStorage 不可用時靜默略過（僅失去持久化，功能仍可用於當前 session）。
    }
  }

  favoriteResourceKey(clusterId, section, namespace, name) {
    return `${String(clusterId || '').trim()}|${String(section || '')}|${String(namespace || '').trim()}|${String(name || '').trim()}`;
  }

  isFavoriteResource(section, item, cluster = kubernetesSessionStore.getState().connectedCluster) {
    const clusterId = this.favoriteClusterKey(cluster);
    const key = this.favoriteResourceKey(clusterId, section, item?.namespace, item?.name);
    return this.favoriteResources.some(favorite => this.favoriteResourceKey(favorite.clusterId, favorite.section, favorite.namespace, favorite.name) === key);
  }

  toggleFavoriteResource(raw) {
    let parsed;
    try { parsed = JSON.parse(decodeURIComponent(raw)); } catch { return; }
    const section = String(parsed?.section || '');
    const name = String(parsed?.name || '').trim();
    if (!FAVORITABLE_SECTIONS.has(section) || !name) return;
    const cluster = kubernetesSessionStore.getState().connectedCluster;
    const clusterId = this.favoriteClusterKey(cluster);
    if (!clusterId) return;
    const namespace = String(parsed.namespace || '').trim();
    const key = this.favoriteResourceKey(clusterId, section, namespace, name);
    const index = this.favoriteResources.findIndex(favorite => this.favoriteResourceKey(favorite.clusterId, favorite.section, favorite.namespace, favorite.name) === key);
    if (index >= 0) {
      this.favoriteResources.splice(index, 1);
    } else {
      this.favoriteResources.push({
        clusterId,
        clusterName: String(cluster?.displayName || cluster?.clusterName || cluster?.contextName || '').trim(),
        section,
        kind: RESOURCE_META[section]?.kind || '',
        apiVersion: RESOURCE_META[section]?.apiVersion || '',
        name,
        namespace
      });
    }
    this.saveFavoriteResources();
    this.rerenderPreservingScroll();
  }

  favoriteResourceButton(section, item) {
    if (!FAVORITABLE_SECTIONS.has(section) || !item?.name) return '';
    const favorite = this.isFavoriteResource(section, item);
    const label = favorite ? t('k8s.favorites.remove') : t('k8s.favorites.add');
    const payload = encodeURIComponent(JSON.stringify({ section, name: item.name, namespace: item.namespace || '' }));
    const starPath = 'M12 17.75l-6.172 3.245 1.18-6.874-5-4.867 6.9-1.002L12 2l3.086 6.253 6.9 1.002-4.993 4.867 1.18 6.873z';
    const icon = favorite
      ? `<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="${starPath}"/></svg>`
      : `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${starPath}"/></svg>`;
    return `<button type="button" class="no-drag kubernetes-resource-favorite ${favorite ? 'is-favorite' : ''}" data-toggle-resource-favorite="${payload}" title="${label}" aria-label="${label}" aria-pressed="${favorite}">${icon}</button>`;
  }

  currentClusterFavorites(cluster) {
    const clusterId = this.favoriteClusterKey(cluster);
    return this.favoriteResources.filter(favorite => favorite.clusterId === clusterId);
  }

  renderFavoritesNavLink(activeSection, count) {
    return `<div class="kubernetes-nav-group kubernetes-nav-favorites"><div class="kubernetes-nav-items"><button type="button" class="no-drag kubernetes-section-link kubernetes-favorites-nav-link ${activeSection === FAVORITES_SECTION ? 'active' : ''}" data-section="${FAVORITES_SECTION}" ${activeSection === FAVORITES_SECTION ? 'aria-current="page"' : ''}><i class="ti ti-star" aria-hidden="true"></i><span>${t('k8s.nav.favorites')}</span><span class="kubernetes-favorites-count" aria-label="${t('k8s.favorites.count', { count })}">${count}</span></button></div></div>`;
  }

  renderFavoriteResources(dashboard, state) {
    const favorites = this.currentClusterFavorites(state.connectedCluster);
    if (!favorites.length) {
      return `<div class="kubernetes-favorites-empty"><i class="ti ti-star" aria-hidden="true"></i><h2>${t('k8s.favorites.emptyTitle')}</h2><p>${t('k8s.favorites.emptyDetail')}</p></div>`;
    }
    const sectionLabel = section => SECTIONS.find(([id]) => id === section)?.[1] || section;
    const rows = favorites.map((favorite) => {
      const items = dashboard?.[FAVORITE_DASHBOARD_KEYS[favorite.section]] || [];
      const item = items.find(candidate => candidate?.name === favorite.name && String(candidate?.namespace || '') === favorite.namespace);
      const ready = item && ['deployments', 'statefulsets', 'daemonSets'].includes(favorite.section)
        ? `${Number(item.readyReplicas || 0)}/${Number(item.desiredReplicas || 0)}`
        : '-';
      const status = item ? statusBadge(item.status) : `<span class="kubernetes-favorite-missing">${t('k8s.favorites.notFound')}</span>`;
      const payload = encodeURIComponent(JSON.stringify(favorite));
      const rowAttrs = item
        ? `class="kubernetes-favorite-resource-row" tabindex="0" role="button" data-open-resource-favorite="${payload}" aria-label="${t('k8s.row.viewDetailAria', { name: escapeHtml(favorite.name) })}"`
        : 'class="kubernetes-favorite-resource-row is-missing"';
      return `<tr ${rowAttrs}>
        <td><span class="kubernetes-favorite-kind">${escapeHtml(sectionLabel(favorite.section))}</span></td>
        ${this.ellipsisCell(favorite.name)}
        <td>${escapeHtml(favorite.clusterName || state.connectedCluster?.displayName || state.connectedCluster?.clusterName || state.connectedCluster?.contextName || '-')}</td>
        <td>${this.renderNamespaceCell(favorite.namespace)}</td>
        <td>${status}</td>
        <td>${escapeHtml(ready)}</td>
        <td class="kubernetes-pod-actions kubernetes-row-actions">${this.favoriteResourceButton(favorite.section, favorite)}</td>
      </tr>`;
    }).join('');
    return `<div class="kubernetes-favorites-view"><p class="kubernetes-favorites-description">${t('k8s.favorites.description')}</p><div class="kubernetes-resource-table-wrap"><table class="kubernetes-resource-table kubernetes-favorites-table"><caption class="kubernetes-table-caption">${t('k8s.nav.favorites')}</caption><thead><tr><th scope="col">${t('k8s.favorites.type')}</th><th scope="col">${t('k8s.favorites.name')}</th><th scope="col">${t('k8s.favorites.cluster')}</th><th scope="col">${t('k8s.favorites.namespace')}</th><th scope="col">${t('k8s.favorites.status')}</th><th scope="col">${t('k8s.favorites.ready')}</th><th scope="col"><span class="kubernetes-visually-hidden">${t('k8s.favorites.actions')}</span></th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
  }

  // 判斷 pod 是否符合 selector：selector 的每個 key/value 都須存在於 pod.labels 且值相等（子集比對）。
  podMatchesSelector(pod, selector) {
    const keys = Object.keys(selector || {});
    if (!keys.length) return false;
    const labels = pod?.labels || {};
    return keys.every(key => labels[key] === selector[key]);
  }

  // 計算目前快照中，同 namespace 且 labels 符合 selector 的 Pod 數量（供按鈕徽章顯示）。
  matchingPodsCount(state, namespace, selector) {
    const pods = state?.dashboard?.pods;
    if (!Array.isArray(pods)) return 0;
    return pods.filter(pod => (pod.namespace || '') === (namespace || '') && this.podMatchesSelector(pod, selector)).length;
  }

  // 列表列上的「檢視關聯 Pods」小圖示鈕（平常隱藏、hover 該列才顯示）；無 selector 時不渲染。
  // stopPropagation 於 setupListeners 綁定，避免觸發該列開啟 detail drawer。
  viewPodsIconButton(kind, item) {
    const selector = item?.selector;
    if (!selector || !Object.keys(selector).length) return '';
    const payload = encodeURIComponent(JSON.stringify({ kind: String(kind || '').toLowerCase(), name: item.name, namespace: item.namespace || '', selector }));
    return `<button type="button" class="kubernetes-view-pods-btn no-drag" data-view-pods="${payload}" title="${t('k8s.detail.viewPods')}" aria-label="${t('k8s.detail.viewPods')}">${renderKubernetesIcon('box', 15)}</button>`;
  }

  // Overview 抽屜內的「檢視關聯 Pods · N」大按鈕；依 kind 在 dashboard 快照中找 selector。
  renderRelatedPodsAction(kind, selected, state) {
    const arrayKey = POD_SOURCE_ARRAYS[String(kind || '').toLowerCase()];
    if (!arrayKey) return '';
    const list = state?.dashboard?.[arrayKey];
    if (!Array.isArray(list)) return '';
    const name = selected?.name || '';
    const namespace = selected?.namespace || '';
    const summary = list.find(item => item?.name === name && (item?.namespace || '') === (namespace || ''));
    const selector = summary?.selector;
    if (!selector || !Object.keys(selector).length) return '';
    const count = this.matchingPodsCount(state, namespace, selector);
    const payload = encodeURIComponent(JSON.stringify({ kind: String(kind).toLowerCase(), name, namespace, selector }));
    return `<section class="kubernetes-detail-section"><button type="button" class="kubernetes-view-pods-cta no-drag" data-view-pods="${payload}">${renderKubernetesIcon('box', 16)}<span>${t('k8s.detail.viewPods')}</span><span class="kubernetes-view-pods-count">${count}</span></button></section>`;
  }

  // 點「檢視關聯 Pods」：設定 label 過濾條件、重置狀態/搜尋、關閉抽屜、切到 Pods 區段（由 store 訂閱重繪）。
  jumpToRelatedPods(raw) {
    let parsed;
    try { parsed = JSON.parse(decodeURIComponent(raw)); } catch { return; }
    if (!parsed?.selector || !Object.keys(parsed.selector).length) return;
    this.podLabelFilter = { kind: parsed.kind, name: parsed.name, namespace: parsed.namespace || '', selector: parsed.selector };
    this.podFilter = 'all';
    this.podSearch = '';
    this.clearSelection();
    const store = kubernetesSessionStore.getState();
    if (store.detailOpen) store.closeResourceDetail();
    store.selectSection('pods');
  }

  // 單一 nav 連結：icon + label + 收藏星號（平常隱藏，hover 該列或已收藏時顯示）。
  // 星號為 link 的兄弟節點（非巢狀 button），點擊只收藏、不觸發導覽。
  renderNavLink(id, label, activeSection) {
    const pinned = this.quickAccessSections.has(id);
    const starTitle = pinned ? t('k8s.nav.unpin') : t('k8s.nav.pin');
    // 已收藏＝實心星（fill），未收藏＝外框星（stroke）；皆平常隱藏、hover 該列才顯示。
    const starPath = 'M12 17.75l-6.172 3.245 1.18-6.874-5-4.867 6.9-1.002L12 2l3.086 6.253 6.9 1.002-4.993 4.867 1.18 6.873z';
    const starSvg = pinned
      ? `<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="${starPath}"/></svg>`
      : `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${starPath}"/></svg>`;
    return `<div class="kubernetes-nav-link-wrap">`
      + `<button type="button" class="no-drag kubernetes-section-link ${activeSection === id ? 'active' : ''}" data-section="${id}" ${activeSection === id ? 'aria-current="page"' : ''}><i class="ti ${sectionIcon(id)}" aria-hidden="true"></i><span>${label}</span></button>`
      + `<button type="button" class="no-drag kubernetes-nav-star ${pinned ? 'pinned' : ''}" data-star="${id}" title="${starTitle}" aria-label="${starTitle}" aria-pressed="${pinned}">${starSvg}</button>`
      + `</div>`;
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
      const previousDrawer = this.querySelector('.kubernetes-detail-drawer, .kubernetes-create-drawer, .kubernetes-event-drawer');
      const hadDrawer = Boolean(previousDrawer);
      const previousFocus = previousDrawer?.contains(document.activeElement) ? document.activeElement : null;
      const previousFocusID = previousFocus?.id || '';
      const previousFocusWasClose = previousFocus?.classList.contains('kubernetes-drawer-close') === true;
      // 保存捲動位置：render() 會重建 innerHTML，否則各捲動容器會被重置為 0（閒置時輪詢就回彈）。
      // 統一由 captureScrollState/restoreScrollState 處理所有容器（見該兩方法）。
      const scrollState = this.captureScrollState();
      this.render();
      this.setupListeners();
      const drawer = this.querySelector('.kubernetes-detail-drawer, .kubernetes-create-drawer, .kubernetes-event-drawer');
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
      this.restoreScrollState(scrollState);
    });
    const state = kubernetesSessionStore.getState();
    if (state.connectedCluster) {
      // 與 dashboard 平行、獨立載入 namespace 清單，讓篩選下拉即刻可用（不必等整包 dashboard）。
      state.loadNamespaces();
      // dashboard 一律抓 '*'（全 namespace），之後切換 namespace 純前端過濾、即時呈現。
      if (!state.dashboard && !state.dashboardLoading) {
        state.loadDashboardProgressive('*').catch(() => {});
      }
    }
    this.startLiveUpdates();
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
      this.rerenderPreservingScroll();
    }
  }

  handlePageKeydown(event) {
    if (
      (event.key === 'Delete' || event.key === 'Backspace')
      && !isTextEditingTarget(event.target)
    ) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    // Events Drawer（純本地狀態）：Escape 關閉、Tab 於 drawer 內循環。先於 resource/create drawer 處理，
    // 避免被下方通用邏輯誤當成 resource detail（會呼叫 store.closeResourceDetail）。
    const eventDrawer = this.querySelector('.kubernetes-event-drawer');
    if (eventDrawer) {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.closeEventDrawer();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = [...eventDrawer.querySelectorAll('button:not([disabled]), [tabindex="0"]')];
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
      return;
    }
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
      // 開啟：以目前選取初始化草稿；期間的勾選只改草稿。
      this.namespaceDraft = [...(kubernetesSessionStore.getState().selectedNamespaces || [])];
      document.addEventListener('pointerdown', this.handleNamespaceOutsideClick, true);
    } else {
      document.removeEventListener('pointerdown', this.handleNamespaceOutsideClick, true);
      this.namespaceFilter = ''; // 下次開啟從完整清單開始。
      // 關閉：選擇完畢，套用草稿（若有變更）→ 只重載一次。
      this.commitNamespaceDraft();
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

  // 關閉下拉時套用草稿：與目前選取（順序無關）比較，有變更才呼叫 store 重載一次。
  commitNamespaceDraft() {
    const draft = this.namespaceDraft;
    this.namespaceDraft = null;
    if (!Array.isArray(draft)) return;
    const current = kubernetesSessionStore.getState().selectedNamespaces || [];
    const normalize = list => [...list].map(String).sort().join('\0');
    if (normalize(draft) === normalize(current)) return;
    kubernetesSessionStore.getState().setSelectedNamespaces(draft).catch(() => {});
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
        const kind = String(store.selectedResource?.kind || store.resourceDetail?.kind || '').toLowerCase();
        const loader = kind === 'service' ? store.loadServicePortForwards() : store.loadPodPortForwards();
        loader.catch(error => {
          console.error('[Kubernetes][UI][DetailTab] 載入 Port Forward 失敗', error);
        });
      }
      return;
    }

    const secretButton = event.target.closest?.('[data-secret-copy], [data-secret-reveal]');
    if (secretButton && this.contains(secretButton)) {
      event.preventDefault();
      event.stopPropagation();
      const key = secretButton.getAttribute('data-secret-key') || '';
      if (secretButton.hasAttribute('data-secret-reveal')) {
        this.toggleSecretReveal(key);
      } else {
        this.copySecretValue(key);
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
    if (hasUnsavedChanges && !(await confirmDialog(t('k8s.guard.unsavedMessage'), { title: t('k8s.guard.unsavedTitle'), danger: true }))) {
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
    if (hasUnsavedChanges && !(await confirmDialog(t('k8s.guard.unsavedMessage'), { title: t('k8s.guard.unsavedTitle'), danger: true }))) {
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
    const backend = dashboard.overview || {};
    const metrics = dashboard.metrics || {};
    const cpuPercent = percent(metrics.cpuUsageMilli, metrics.cpuCapacityMilli);
    const memoryPercent = percent(metrics.memoryUsageBytes, metrics.memoryCapacityBytes);
    // Overview 計數需與 Pods / 資源表格同樣尊重 namespace 多選：非空（非 All）時只計所選 namespace 內的資源，
    // 否則後端全叢集數與前端篩選後數會對不上（例如 Overview 顯示 1 failed，Pods Failed 卻是 0）。
    // Nodes 為 cluster-scoped（無 namespace），不受此篩選影響，沿用後端計數。
    const selected = kubernetesSessionStore.getState().selectedNamespaces || [];
    const nsSet = new Set(selected);
    const inScope = item => nsSet.size === 0 || nsSet.has(item?.namespace);
    const podList = (dashboard.pods || []).filter(inScope);
    const deploymentList = (dashboard.deployments || []).filter(inScope);
    const statefulSetList = (dashboard.statefulSets || []).filter(inScope);
    const daemonSetList = (dashboard.daemonSets || []).filter(inScope);
    const serviceList = (dashboard.services || []).filter(inScope);
    const phaseCount = phase => podList.filter(pod => String(pod.phase || '').toLowerCase() === phase).length;
    const runningPods = phaseCount('running');
    const pendingPods = phaseCount('pending');
    const failedPods = phaseCount('failed');
    const succeededPods = phaseCount('succeeded');
    const podsTotal = podList.length;
    const nodes = Number(backend.nodes || 0);
    const readyNodes = Number(backend.readyNodes || 0);
    const notReadyNodes = Math.max(0, nodes - readyNodes);
    const deployments = deploymentList.length;
    const statefulSets = statefulSetList.length;
    const daemonSets = daemonSetList.length;
    const workloads = deployments + statefulSets + daemonSets;
    // ready 判定與後端一致（workload summary.status === 'Ready'）。
    const readyDeployments = deploymentList.filter(item => item.status === 'Ready').length;
    const readyStatefulSets = statefulSetList.filter(item => item.status === 'Ready').length;
    const services = serviceList.length;
    const loadBalancers = serviceList.filter(item => String(item.type) === 'LoadBalancer').length;
    // 健康總結橫幅：一律看「全叢集」（不受目前 namespace 篩選影響），並標示問題所在的 namespace，
    // 讓使用者即使正過濾在某 namespace，也能得知其他 namespace 的異常。
    const allPods = Array.isArray(dashboard.pods) ? dashboard.pods : [];
    const allEvents = Array.isArray(dashboard.events) ? dashboard.events : [];
    const clusterPhase = phase => allPods.filter(pod => String(pod.phase || '').toLowerCase() === phase);
    const clusterFailed = clusterPhase('failed');
    const clusterPending = clusterPhase('pending');
    const clusterWarnings = allEvents.filter(item => String(item.type || '') === 'Warning');
    const clusterRunning = clusterPhase('running').length;
    // 受影響 namespace（去重）；最多列 3 個，其餘以「+N」表示。nodes 為 cluster-scoped，不附 namespace。
    const affectedNamespaces = items => {
      const names = [...new Set(items.map(item => String(item.namespace || '').trim()).filter(Boolean))];
      if (!names.length) return '';
      const shown = names.slice(0, 3).join(', ');
      return ` in ${names.length > 3 ? `${shown} +${names.length - 3}` : shown}`;
    };
    const issues = [];
    if (clusterFailed.length) issues.push(`${clusterFailed.length} failed pod${clusterFailed.length > 1 ? 's' : ''}${affectedNamespaces(clusterFailed)}`);
    if (notReadyNodes > 0) issues.push(`${notReadyNodes} node${notReadyNodes > 1 ? 's' : ''} not ready`);
    if (clusterPending.length) issues.push(`${clusterPending.length} pending${affectedNamespaces(clusterPending)}`);
    if (clusterWarnings.length) issues.push(`${clusterWarnings.length} warning event${clusterWarnings.length > 1 ? 's' : ''}${affectedNamespaces(clusterWarnings)}`);
    const danger = clusterFailed.length > 0 || notReadyNodes > 0;
    const tone = issues.length === 0 ? 'ok' : danger ? 'danger' : 'warning';
    const bannerIcon = tone === 'ok' ? 'ti-circle-check' : tone === 'danger' ? 'ti-alert-octagon' : 'ti-alert-triangle';
    const bannerLabel = tone === 'ok' ? 'Cluster healthy' : tone === 'danger' ? 'Needs attention' : 'Minor warnings';
    const bannerDetail = issues.length ? issues.join(' · ') : `${readyNodes}/${nodes} nodes ready · ${clusterRunning}/${allPods.length} pods running`;
    // KPI 卡：icon + 數值 + 語意副標（tone class 上色）。
    const kpi = (icon, label, value, detail, detailTone = '', title = '') => `<div class="kubernetes-kpi-card"${title ? ` title="${escapeHtml(title)}"` : ''}><div class="kubernetes-kpi-head"><i class="ti ${icon}" aria-hidden="true"></i>${label}</div><strong>${value}</strong><small${detailTone ? ` class="${detailTone}"` : ''}>${escapeHtml(detail)}</small></div>`;
    const podsDetail = (failedPods || pendingPods) ? [failedPods ? `${failedPods} failed` : '', pendingPods ? `${pendingPods} pending` : ''].filter(Boolean).join(' · ') : `${runningPods} running`;
    const podsTone = failedPods ? 'is-danger' : pendingPods ? 'is-warning' : '';
    const nodesDetail = notReadyNodes ? `${notReadyNodes} not ready` : `${readyNodes} ready`;
    const nodesTone = notReadyNodes ? 'is-danger' : '';
    const workloadsDetail = `${deployments} deploy · ${statefulSets} sts · ${daemonSets} ds`;
    const workloadsTitle = `${readyDeployments}/${deployments} deployments ready · ${readyStatefulSets}/${statefulSets} statefulsets ready`;
    const servicesDetail = loadBalancers ? `${loadBalancers} load balancer${loadBalancers > 1 ? 's' : ''}` : 'all ClusterIP';
    return `
      <div class="kubernetes-overview-banner is-${tone}">
        <i class="ti ${bannerIcon}" aria-hidden="true"></i>
        <div><strong>${bannerLabel}</strong><span>${escapeHtml(bannerDetail)}</span></div>
        ${dashboard.serverVersion ? `<em>${escapeHtml(dashboard.serverVersion)}</em>` : ''}
      </div>
      <section class="kubernetes-kpi-grid" aria-label="Cluster Overview">
        ${kpi('ti-server-2', 'Nodes', nodes, nodesDetail, nodesTone)}
        ${kpi('ti-box', 'Pods', podsTotal, podsDetail, podsTone)}
        ${kpi('ti-stack-2', 'Workloads', workloads, workloadsDetail, '', workloadsTitle)}
        ${kpi('ti-router', 'Services', services, servicesDetail)}
      </section>
      <section class="kubernetes-metrics-grid">
        ${metrics.available ? `
          ${this.renderMetricCard('CPU Usage', formatCPU(metrics.cpuUsageMilli), formatCPU(metrics.cpuCapacityMilli), cpuPercent, 'cpu')}
          ${this.renderMetricCard('Memory Usage', formatBytes(metrics.memoryUsageBytes), formatBytes(metrics.memoryCapacityBytes), memoryPercent, 'memory')}
        ` : `
          <div class="kubernetes-metrics-unavailable" role="status">
            <strong>${t('k8s.metrics.unavailable')}</strong>
            <span>${escapeHtml(metrics.error || t('k8s.metrics.unavailableDetail'))}</span>
          </div>
        `}
      </section>
      ${this.renderPodStatusBar(runningPods, pendingPods, failedPods, succeededPods)}
      ${metrics.available ? this.renderTopConsumers(podList) : ''}`;
  }

  // Top CPU / Memory 消耗者：從 namespace 篩選後的 pod 依用量排序取前 5（僅在 metrics 可用時）。
  renderTopConsumers(pods) {
    const byCpu = [...pods].filter(pod => Number(pod.cpuUsageMilli) > 0).sort((a, b) => Number(b.cpuUsageMilli) - Number(a.cpuUsageMilli)).slice(0, 5);
    const byMem = [...pods].filter(pod => Number(pod.memoryUsageBytes) > 0).sort((a, b) => Number(b.memoryUsageBytes) - Number(a.memoryUsageBytes)).slice(0, 5);
    if (!byCpu.length && !byMem.length) return '';
    const row = (pod, value) => `<div class="kubernetes-top-row"><div class="kubernetes-top-meta"><span class="kubernetes-top-name" title="${escapeHtml(pod.name)}">${escapeHtml(pod.name)}</span><span class="kubernetes-top-ns" title="${escapeHtml(pod.namespace)}">${escapeHtml(pod.namespace)}</span></div><span class="kubernetes-top-value">${escapeHtml(value)}</span></div>`;
    const empty = `<div class="kubernetes-top-empty">${t('k8s.top.empty')}</div>`;
    return `<section class="kubernetes-top-grid">
      <div class="kubernetes-top-card"><h2 class="kubernetes-detail-heading"><i class="ti ti-cpu" aria-hidden="true"></i>${t('k8s.top.cpu')}</h2><div class="kubernetes-top-list">${byCpu.length ? byCpu.map(pod => row(pod, formatCPU(pod.cpuUsageMilli))).join('') : empty}</div></div>
      <div class="kubernetes-top-card"><h2 class="kubernetes-detail-heading"><i class="ti ti-database" aria-hidden="true"></i>${t('k8s.top.memory')}</h2><div class="kubernetes-top-list">${byMem.length ? byMem.map(pod => row(pod, formatBytes(pod.memoryUsageBytes))).join('') : empty}</div></div>
    </section>`;
  }

  // Pod 狀態堆疊條：以各 phase 佔比呈現一條分段條 + 圖例（總數為 0 時不顯示）。
  renderPodStatusBar(running, pending, failed, succeeded) {
    const total = running + pending + failed + succeeded;
    if (total === 0) return '';
    const seg = (value, cls) => value > 0 ? `<div class="kubernetes-podbar-seg ${cls}" style="width:${(value / total * 100).toFixed(2)}%"></div>` : '';
    const legend = (value, cls, label) => `<span class="kubernetes-podbar-legend ${cls}"><i aria-hidden="true"></i>${label} ${value}</span>`;
    return `<section class="kubernetes-podbar-card">
      <h2>Pod status</h2>
      <div class="kubernetes-podbar">${seg(running, 'is-running')}${seg(pending, 'is-pending')}${seg(failed, 'is-failed')}${seg(succeeded, 'is-succeeded')}</div>
      <div class="kubernetes-podbar-legends">${legend(running, 'is-running', 'Running')}${legend(pending, 'is-pending', 'Pending')}${legend(failed, 'is-failed', 'Failed')}${legend(succeeded, 'is-succeeded', 'Succeeded')}</div>
    </section>`;
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

  // 依目前選取的 namespace 過濾 namespaced 資源列（空選=All，不過濾）。
  // 多選時後端以 '*' 回傳全部 namespace，靠此在前端收斂到所選集合。
  filterBySelectedNamespaces(items) {
    const selected = kubernetesSessionStore.getState().selectedNamespaces || [];
    if (!selected.length) return items || [];
    const set = new Set(selected);
    return (items || []).filter(item => set.has(item.namespace));
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
      return `<div class="kubernetes-session-error kubernetes-resource-section-error" role="alert"><strong>${escapeHtml(SECTIONS.find(([id]) => id === section)?.[1] || t('k8s.resource.genericName'))} ${t('k8s.resource.loadFailedSuffix')}</strong><span>${escapeHtml(resourceError)}</span></div>`;
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
    // namespaced 資源（有 namespace 欄）：多選時後端以 '*' 回傳全部，需先依所選 namespace 收斂。
    const namespaced = definition.columns.some(([key]) => key === 'namespace');
    const scopedItems = namespaced ? this.filterBySelectedNamespaces(definition.items) : definition.items;
    // 先過濾（namespace + 通用搜尋）再排序（穩定），與其餘表格一致。
    const items = this.applyTableSort(section, this.applyTableSearch(section, scopedItems));
    if (items.length === 0) {
      // cluster-scoped section（nodes / persistentVolumes / storageClasses）維持「叢集沒有可顯示的 X」；
      // namespaced 則用「目前篩選範圍沒有此類資源」（多選/All 模式語意正確）。
      const clusterScopedEmpty = { nodes: t('k8s.empty.nodes'), persistentVolumes: t('k8s.empty.persistentVolumes'), storageClasses: t('k8s.empty.storageClasses') };
      const emptyText = this.tableSearch[section]
        ? t('k8s.empty.noMatch')
        : (clusterScopedEmpty[section] || t('k8s.empty.noResourcesInScope'));
      return `${this.renderSectionRefresh(section)}<div class="kubernetes-resource-empty">${emptyText}</div>`;
    }
    // namespaced 資源（有 namespace 欄）比照 Pod：每列左側以 namespaceColor 上色條，
    // 讓 Service/Deployment/StatefulSet/Ingress/PVC 等也能一眼辨識所屬 namespace。
    // Service 列表額外提供「Forward」action（其餘資源無 action 欄）。
    const withServiceForward = section === 'services';
    // workload / service 列額外提供「檢視關聯 Pods」hover 圖示；services 另有既有的 Forward。
    const withPodsLink = section === 'deployments' || section === 'statefulsets' || section === 'services';
    const withActions = withServiceForward || withPodsLink;
    // 通用表格所有欄皆可排序：creationTimestamp 依時間、已知數值欄依數值，其餘依字串。
    return `
      ${this.renderSectionRefresh(section)}
      <div class="kubernetes-resource-table-wrap">
        <table class="kubernetes-resource-table${namespaced ? ' kubernetes-nscolored-table' : ''}">
          <caption class="kubernetes-table-caption">${escapeHtml(SECTIONS.find(([id]) => id === section)?.[1] || t('k8s.resource.fallback'))}</caption>
          <thead><tr>${definition.columns.map(([key, label]) => this.sortableTh(section, key, label, { type: sortTypeForKey(key) })).join('')}${withActions ? '<th></th>' : ''}</tr></thead>
          <tbody>${items.map(item => `
            <tr class="kubernetes-resource-row" tabindex="0" role="button"${namespaced && item.namespace ? ` style="border-left-color:${this.namespaceColor(item.namespace)}"` : ''} data-resource-kind="${RESOURCE_KINDS[section]}" data-resource-name="${escapeHtml(item.name)}" data-resource-namespace="${escapeHtml(item.namespace || '')}" data-resource-apiversion="${escapeHtml(RESOURCE_META[section]?.apiVersion || '')}" aria-label="${t('k8s.row.viewDetailAria', { name: escapeHtml(item.name) })}">${definition.columns.map(([key, , formatter]) => (!formatter && ELLIPSIS_KEYS.has(key)) ? this.ellipsisCell(item[key]) : `<td>${formatter ? formatter(item[key]) : escapeHtml(item[key] ?? '-')}</td>`).join('')}${withActions ? `<td class="kubernetes-pod-actions kubernetes-row-actions">${this.favoriteResourceButton(section, item)}${(section === 'deployments' || section === 'statefulsets') ? this.scaleButton(RESOURCE_KINDS[section], RESOURCE_META[section]?.apiVersion || '', item) : ''}${withServiceForward ? `<button data-service-action="forward" data-service="${encodeURIComponent(JSON.stringify(item))}" ${(Array.isArray(item.portNumbers) && item.portNumbers.length) ? '' : 'disabled'}>Forward</button>` : ''}${this.viewPodsIconButton(RESOURCE_KINDS[section], item)}</td>` : ''}</tr>
          `).join('')}</tbody>
        </table>
      </div>`;
  }

  renderSectionRefresh(section) {
    if (!REFRESHABLE_SECTIONS.has(section)) return '';
    // 通用搜尋框（Pods 除外，Pods 有自己的搜尋 + 狀態 filter）：對目前 section 清單過濾 name/namespace。
    const term = escapeHtml(this.tableSearch[section] || '');
    return `<div class="kubernetes-section-toolbar">
      <div class="kubernetes-section-search no-drag"><span class="kubernetes-section-search-icon" aria-hidden="true">${renderKubernetesIcon('search', 14)}</span><input id="kubernetesSectionSearch" class="no-drag" data-section-search="${escapeHtml(section)}" value="${term}" placeholder="${t('k8s.table.searchNamePlaceholder')}" aria-label="${t('k8s.table.searchNameAria')}"></div>
      ${this.renderRefreshButton('refreshKubernetesSection')}
    </div>`;
  }

  // 產生 Refresh 按鈕：手動 refresh 進行中時 disabled + mini spinner + 「更新中…」，
  // 避免重複點擊並提供回饋（Pods 與各 section 共用）。
  renderRefreshButton(id) {
    const busy = this.manualRefreshing;
    return `<button type="button" id="${id}" class="no-drag kubernetes-secondary-btn" ${busy ? 'disabled aria-busy="true"' : ''}>${busy ? `<span class="kubernetes-spinner-mini kubernetes-refresh-spinner" aria-hidden="true"></span><span>${t('k8s.refresh.busy')}</span>` : t('common.refresh')}</button>`;
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
    return `class="kubernetes-resource-row" tabindex="0" role="button"${extraStyle ? ` style="${extraStyle}"` : ''} data-resource-kind="${escapeHtml(meta.kind || '')}" data-resource-name="${escapeHtml(name ?? '')}" data-resource-namespace="${escapeHtml(namespace || '')}" data-resource-apiversion="${escapeHtml(meta.apiVersion || '')}" aria-label="${t('k8s.row.viewDetailAria', { name: escapeHtml(name ?? '') })}"`;
  }

  // 多選：以 kind|namespace|name 作為一列的唯一鍵。
  selectionRowKey(kind, namespace, name) {
    return `${String(kind || '').toLowerCase()}|${namespace || ''}|${name || ''}`;
  }

  // 清空目前選取（切換 section 時呼叫）。
  clearSelection() {
    if (this.selectedRows.size) this.selectedRows.clear();
  }

  // 底部選取列：常駐於內容區底部，平時以 translateY 藏在畫面外，有勾選時加 .visible 滑出。
  // 常駐是為了讓「滑出/滑入」有前後狀態可過渡（選取變動走增量 DOM 更新、不整頁重繪，見 enhanceSelectionColumns）。
  renderSelectionBar() {
    const count = this.selectedRows.size;
    const hasHighRisk = [...this.selectedRows.values()].some(r => isHighRiskKubernetesKind(r.kind));
    return `<div class="kubernetes-selection-bar${count ? ' visible' : ''} no-drag" role="region" aria-label="${t('k8s.select.deleteSelected')}">`
      + `<div class="kubernetes-selection-bar-left">`
      + `<span class="kubernetes-selection-count">${t('k8s.select.count', { count })}</span>`
      + `<button type="button" id="kubernetesClearSelection" class="no-drag kubernetes-selection-clear">${renderKubernetesIcon('close', 14)}<span>${t('k8s.select.clearAria')}</span></button>`
      + `<span class="kubernetes-selection-risk"${hasHighRisk ? '' : ' style="display:none"'}>${t('k8s.select.hasHighRisk')}</span>`
      + `</div>`
      + `<button type="button" id="kubernetesBulkDelete" class="no-drag kubernetes-danger-btn kubernetes-selection-delete">${renderKubernetesIcon('trash', 14)}<span>${t('k8s.select.deleteSelected')}</span></button>`
      + `</div>`;
  }

  // 增量更新底部選取列（勾選變動時呼叫，不整頁重繪，讓滑出動畫成立）。
  updateSelectionBar() {
    const bar = this.querySelector('.kubernetes-selection-bar');
    if (!bar) return;
    const count = this.selectedRows.size;
    bar.classList.toggle('visible', count > 0);
    // 選取列滑出時，捲動容器底部同步縮進一個列高，確保橫向捲軸留在底部列上方、不被遮擋。
    this.querySelector('.kubernetes-session-scrollbody')?.classList.toggle('has-selection-bar', count > 0);
    const countEl = bar.querySelector('.kubernetes-selection-count');
    if (countEl) countEl.textContent = t('k8s.select.count', { count });
    const risk = bar.querySelector('.kubernetes-selection-risk');
    if (risk) risk.style.display = [...this.selectedRows.values()].some(r => isHighRiskKubernetesKind(r.kind)) ? '' : 'none';
  }

  // 依目前列勾選框狀態重算某張表的全選/半選態。
  updateSelectAllState(table) {
    const all = table.querySelector('.kubernetes-select-all');
    if (!all) return;
    const boxes = [...table.querySelectorAll('tbody .kubernetes-select-row')];
    const checked = boxes.filter(b => b.checked).length;
    all.checked = boxes.length > 0 && checked === boxes.length;
    all.indeterminate = checked > 0 && checked < boxes.length;
  }

  // 清空選取並同步 DOM（供清除鈕使用，走增量更新讓底部列滑入）。
  clearSelectionUI() {
    this.querySelectorAll('.kubernetes-select-row').forEach(cb => { cb.checked = false; });
    this.querySelectorAll('.kubernetes-resource-row.kubernetes-row-selected').forEach(row => row.classList.remove('kubernetes-row-selected'));
    this.querySelectorAll('.kubernetes-select-all').forEach(all => { all.checked = false; all.indeterminate = false; });
    this.selectedRows.clear();
    this.updateSelectionBar();
  }

  // 於每次 render 後（setupListeners 內）呼叫：在資源列表（.kubernetes-resource-table，
  // Events 表為 .kubernetes-eventlist-table 故不受影響）表頭最左注入全選框、每列最左注入列勾選框，
  // 並綁定事件。因每次 render 皆重建 innerHTML，重繪後再注入不會重複；勾選態依 this.selectedRows 還原。
  enhanceSelectionColumns() {
    this.querySelectorAll('.kubernetes-resource-table').forEach(table => {
      const headRow = table.querySelector('thead > tr');
      const bodyRows = [...table.querySelectorAll('tbody > tr.kubernetes-resource-row')];
      if (!headRow || !bodyRows.length || headRow.querySelector('.kubernetes-select-th')) return;

      const th = document.createElement('th');
      th.className = 'kubernetes-select-th';
      th.setAttribute('scope', 'col');
      const selectAll = document.createElement('input');
      selectAll.type = 'checkbox';
      selectAll.className = 'kubernetes-select-all no-drag';
      selectAll.setAttribute('aria-label', t('k8s.select.selectAllAria'));
      th.appendChild(selectAll);
      headRow.insertBefore(th, headRow.firstChild);

      const metas = [];
      bodyRows.forEach(row => {
        const kind = row.dataset.resourceKind || '';
        const name = row.dataset.resourceName || '';
        const namespace = row.dataset.resourceNamespace || '';
        const apiVersion = row.dataset.resourceApiversion || '';
        if (!kind || !name) return;
        const key = this.selectionRowKey(kind, namespace, name);
        const meta = { kind, name, namespace, apiVersion };
        const td = document.createElement('td');
        td.className = 'kubernetes-select-td';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.className = 'kubernetes-select-row no-drag';
        cb.checked = this.selectedRows.has(key);
        cb.setAttribute('aria-label', t('k8s.select.selectRowAria', { name }));
        td.appendChild(cb);
        row.insertBefore(td, row.firstChild);
        row.classList.toggle('kubernetes-row-selected', cb.checked);
        metas.push({ key, meta, cb, row });

        // 整格皆可點以放大判定範圍：點格內非勾選框處代為切換；一律阻止冒泡到列（列點擊會開 detail drawer）。
        td.addEventListener('click', event => {
          event.stopPropagation();
          if (event.target !== cb) cb.click();
        });
        cb.addEventListener('click', event => event.stopPropagation());
        // 增量更新（不整頁重繪）：更新選取集合、該列高亮、全選態、底部選取列（滑出/滑入動畫）。
        cb.addEventListener('change', event => {
          event.stopPropagation();
          if (cb.checked) this.selectedRows.set(key, meta);
          else this.selectedRows.delete(key);
          row.classList.toggle('kubernetes-row-selected', cb.checked);
          this.updateSelectAllState(table);
          this.updateSelectionBar();
        });
      });

      const selectedCount = metas.filter(m => this.selectedRows.has(m.key)).length;
      selectAll.checked = metas.length > 0 && selectedCount === metas.length;
      selectAll.indeterminate = selectedCount > 0 && selectedCount < metas.length;
      selectAll.addEventListener('change', () => {
        metas.forEach(m => {
          m.cb.checked = selectAll.checked;
          m.row.classList.toggle('kubernetes-row-selected', selectAll.checked);
          if (selectAll.checked) this.selectedRows.set(m.key, m.meta);
          else this.selectedRows.delete(m.key);
        });
        selectAll.indeterminate = false;
        this.updateSelectionBar();
      });
    });
  }

  // 批量刪除流程：確認（含高風險資源時要求打字 delete）後呼叫 store，彙總 toast，失敗項保留勾選。
  async handleBulkDelete() {
    const targets = [...this.selectedRows.values()];
    if (!targets.length) return;
    const hasHighRisk = targets.some(r => isHighRiskKubernetesKind(r.kind));
    const confirmed = await confirmDialog(
      t('k8s.bulkDelete.message', { count: targets.length }),
      {
        title: t('k8s.bulkDelete.title'),
        confirmText: t('k8s.select.deleteSelected'),
        danger: true,
        requireText: hasHighRisk ? 'delete' : '',
        requireTextHint: hasHighRisk ? t('k8s.bulkDelete.highRiskHint', { text: 'delete' }) : ''
      }
    );
    if (!confirmed) return;

    let result;
    try {
      result = await kubernetesSessionStore.getState().batchDeleteResources(targets);
    } catch (error) {
      console.error('[Kubernetes][UI][BulkDelete] 批量刪除流程失敗', error);
      return;
    }
    const okCount = result?.ok?.length || 0;
    const failCount = result?.fail?.length || 0;
    // 保留失敗項的勾選、移除成功項。
    this.selectedRows.clear();
    (result?.fail || []).forEach(r => {
      const key = this.selectionRowKey(r.kind, r.namespace, r.name);
      this.selectedRows.set(key, { kind: r.kind, name: r.name, namespace: r.namespace, apiVersion: r.apiVersion || '' });
    });
    if (failCount === 0) {
      showToast(t('k8s.bulkDelete.doneAllOk', { count: okCount }), { type: 'success', title: t('k8s.toast.deleteTitle') });
    } else {
      showToast(t('k8s.bulkDelete.donePartial', { ok: okCount, fail: failCount }), { type: 'error', title: t('k8s.toast.deleteTitle') });
    }
    this.rerenderPreservingScroll();
  }

  // Deployment / StatefulSet 列尾「調整副本數」膠囊鈕；payload 帶目前 desiredReplicas 供步進器帶入。
  scaleButton(kind, apiVersion, item) {
    const payload = encodeURIComponent(JSON.stringify({
      kind, name: item.name, namespace: item.namespace || '', apiVersion: apiVersion || '', desired: Number(item.desiredReplicas || 0)
    }));
    return `<button type="button" class="no-drag kubernetes-scale-btn" data-scale="${payload}" title="${t('k8s.scale.title')}" aria-label="${t('k8s.scale.title')}"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v18M7 8l5-5 5 5M7 16l5 5 5-5"/></svg><span>${t('k8s.scale.btn')}</span></button>`;
  }

  // 開啟副本數步進器對話框（append 到 body，不受元件重繪影響）。列尾鈕與 drawer 共用。
  // resource: { kind, name, namespace, apiVersion, desired }
  openScaleDialog(resource) {
    if (!resource || !resource.name) return;
    const kind = String(resource.kind || '').toLowerCase();
    const current = Math.max(0, Math.floor(Number(resource.desired) || 0));
    const fullId = `${kind}/${resource.namespace ? resource.namespace + '/' : ''}${resource.name}`;
    const overlay = document.createElement('div');
    overlay.className = 'kubernetes-scale-overlay';
    overlay.setAttribute('role', 'presentation');
    overlay.innerHTML = `
      <div class="kubernetes-scale-dialog no-drag" role="dialog" aria-modal="true" aria-label="${t('k8s.scale.title')}">
        <h2 class="kubernetes-scale-title">${t('k8s.scale.title')}</h2>
        <p class="kubernetes-scale-res">${escapeHtml(fullId)}</p>
        <div class="kubernetes-scale-stepper">
          <button type="button" data-step="dec" aria-label="${t('k8s.scale.decAria')}">−</button>
          <input type="text" inputmode="numeric" class="kubernetes-scale-input" value="${current}" aria-label="${t('k8s.scale.inputAria')}">
          <button type="button" data-step="inc" aria-label="${t('k8s.scale.incAria')}">+</button>
        </div>
        <p class="kubernetes-scale-cur">${t('k8s.scale.current', { current })} <b class="kubernetes-scale-target">${current}</b></p>
        <p class="kubernetes-scale-warn" hidden>${t('k8s.scale.zeroWarn')}</p>
        <div class="kubernetes-scale-actions">
          <button type="button" class="no-drag kubernetes-secondary-btn" data-scale-cancel>${t('common.cancel')}</button>
          <button type="button" class="no-drag kubernetes-primary-btn" data-scale-apply>${t('k8s.scale.apply')}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const input = overlay.querySelector('.kubernetes-scale-input');
    const targetEl = overlay.querySelector('.kubernetes-scale-target');
    const warn = overlay.querySelector('.kubernetes-scale-warn');
    const applyBtn = overlay.querySelector('[data-scale-apply]');
    const clamp = v => { v = parseInt(v, 10); if (!Number.isFinite(v) || v < 0) v = 0; if (v > 999) v = 999; return v; };
    const refresh = () => {
      const v = clamp(input.value); input.value = v; targetEl.textContent = v;
      warn.hidden = v !== 0;
      applyBtn.disabled = v === current;
      applyBtn.classList.toggle('kubernetes-danger-btn', v === 0);
      applyBtn.classList.toggle('kubernetes-primary-btn', v !== 0);
    };
    let keyHandler = null;
    const close = () => { if (keyHandler) document.removeEventListener('keydown', keyHandler); overlay.remove(); };
    keyHandler = e => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
    document.addEventListener('keydown', keyHandler);
    overlay.addEventListener('mousedown', e => { if (e.target === overlay) close(); });
    overlay.querySelector('[data-step="dec"]').addEventListener('click', () => { input.value = clamp(input.value) - 1; refresh(); });
    overlay.querySelector('[data-step="inc"]').addEventListener('click', () => { input.value = clamp(input.value) + 1; refresh(); });
    input.addEventListener('input', refresh);
    overlay.querySelector('[data-scale-cancel]').addEventListener('click', close);
    applyBtn.addEventListener('click', async () => {
      const v = clamp(input.value);
      if (v === current) return;
      // 縮到 0 前再確認一次，避免誤停全部 Pod。
      if (v === 0 && !(await confirmDialog(t('k8s.scale.zeroConfirmMsg', { id: fullId }), { title: t('k8s.scale.zeroConfirmTitle'), danger: true }))) return;
      close();
      kubernetesSessionStore.getState().scaleResource({
        kind, name: resource.name, namespace: resource.namespace || '', apiVersion: resource.apiVersion || '', replicas: v
      }).catch(error => console.error('[Kubernetes][UI][Scale] 調整副本數失敗', error));
    });
    refresh();
    requestAnimationFrame(() => { try { input.focus(); input.select(); } catch (_) { /* noop */ } });
  }

  // 產生一列 namespace 儲存格內容：色點 + namespace 文字標籤。
  renderNamespaceCell(namespace) {
    // namespace 的辨識色改以「每列左側色條」呈現（見 renderPodsTable 的 tr border-left-color），
    // 此處不再加色點，僅顯示 namespace 文字。
    return escapeHtml(namespace || '-');
  }

  // Namespace 多選下拉：按鈕顯示摘要，展開後為搜尋框 ＋「All Namespaces」＋ 每個 namespace 的 checkbox。
  // 大叢集優化：超過門檻顯示搜尋框；選項與隱藏 select 皆截斷至 NAMESPACE_OPTION_CAP，
  // 避免每次重繪建立/解析成千上萬節點。另保留視覺隱藏的原生 <select> 作為無障礙/相容備援。
  renderNamespaceMultiSelect(state, namespaces) {
    const selected = Array.isArray(state.selectedNamespaces) ? state.selectedNamespaces : [];
    const selectedSet = new Set(selected);
    const isAll = selected.length === 0;
    const specific = namespaces.filter(item => item !== '*');
    this._nsSpecific = specific; // 供搜尋框局部重繪選項時重用同一份清單。
    let summary;
    if (isAll) summary = t('k8s.namespace.all');
    else if (selected.length === 1) summary = selected[0];
    else summary = t('k8s.namespace.countSelected', { count: selected.length });
    // cluster-scoped section 不受 namespace 篩選，停用整個多選控制項並加提示。
    // 注意：不因 dashboardLoading 停用——namespace 清單獨立載入（loadNamespaces），
    // 且草稿模式 + request-version 失效讓「載入中改選」安全；否則大叢集載入久時下拉會長時間鎖死。
    const clusterScoped = CLUSTER_SCOPED_SECTIONS.has(state.activeSection || '');
    const disabled = clusterScoped ? 'disabled' : '';
    const scopeHint = clusterScoped ? ` title="${t('k8s.namespace.scopeHint')}"` : '';
    const open = clusterScoped ? false : this.namespaceDropdownOpen;
    const legacyValue = isAll ? '*' : (selected.length === 1 ? selected[0] : '*');
    const showSearch = specific.length > NAMESPACE_SEARCH_THRESHOLD;
    // 隱藏原生 select 同樣截斷；確保目前單選值仍在清單內（相容 change 事件）。
    const selectItems = ['*', ...specific.slice(0, NAMESPACE_OPTION_CAP)];
    if (legacyValue !== '*' && !selectItems.includes(legacyValue)) selectItems.push(legacyValue);
    return `<div class="kubernetes-namespace-field kubernetes-namespace-multiselect${clusterScoped ? ' cluster-scoped' : ''}" data-namespace-multiselect${scopeHint}>
      <span id="kubernetesNamespaceLabel">${t('k8s.namespace.label')}</span>
      <button type="button" id="kubernetesNamespaceToggle" class="no-drag kubernetes-namespace-toggle" aria-haspopup="true" aria-expanded="${open ? 'true' : 'false'}" aria-labelledby="kubernetesNamespaceLabel kubernetesNamespaceToggle"${scopeHint} ${disabled}>
        <span class="kubernetes-namespace-summary">${escapeHtml(summary)}</span>
        <span class="kubernetes-namespace-caret" aria-hidden="true">▾</span>
      </button>
      <div class="kubernetes-namespace-panel ${open ? 'open' : ''}" role="group" aria-label="${t('k8s.namespace.selectAria')}" ${open ? '' : 'hidden'}>
        ${showSearch ? `<div class="kubernetes-namespace-search no-drag"><input type="text" id="kubernetesNamespaceFilter" class="no-drag" placeholder="${t('k8s.namespace.searchPlaceholder')}" value="${escapeHtml(this.namespaceFilter || '')}" autocomplete="off" spellcheck="false" ${disabled}></div>` : ''}
        <label class="kubernetes-namespace-option no-drag"><input type="checkbox" class="no-drag" data-namespace-all ${isAll ? 'checked' : ''} ${disabled}><span>${t('k8s.namespace.all')}</span></label>
        <div class="kubernetes-namespace-options" id="kubernetesNamespaceOptions">${this.renderNamespaceOptionsHtml(specific, selectedSet, disabled)}</div>
      </div>
      <select id="kubernetesNamespaceSelect" class="no-drag kubernetes-visually-hidden" tabindex="-1" aria-hidden="true" ${disabled}>${selectItems.map(item => `<option value="${escapeHtml(item)}" ${item === legacyValue ? 'selected' : ''}>${item === '*' ? t('k8s.namespace.all') : escapeHtml(item)}</option>`).join('')}</select>
    </div>`;
  }

  // 產生 namespace 選項列（套用搜尋過濾與 NAMESPACE_OPTION_CAP 截斷）。
  // 下拉開啟中以草稿（namespaceDraft）為勾選依據，確保過濾重繪不會清掉未提交的勾選。
  renderNamespaceOptionsHtml(specific, committedSet, disabled) {
    const activeSet = (this.namespaceDropdownOpen && Array.isArray(this.namespaceDraft))
      ? new Set(this.namespaceDraft)
      : committedSet;
    const filter = (this.namespaceFilter || '').trim().toLowerCase();
    const filtered = filter ? specific.filter(item => item.toLowerCase().includes(filter)) : specific;
    const shown = filtered.slice(0, NAMESPACE_OPTION_CAP);
    const rows = shown.map(item => {
      const checked = activeSet.has(item) ? 'checked' : '';
      const color = this.namespaceColor(item);
      return `<label class="kubernetes-namespace-option no-drag"><input type="checkbox" class="no-drag" data-namespace-option value="${escapeHtml(item)}" ${checked} ${disabled}><span class="kubernetes-namespace-dot" style="background:${color}" aria-hidden="true"></span><span>${escapeHtml(item)}</span></label>`;
    }).join('');
    if (filter && filtered.length === 0) {
      return `<div class="kubernetes-namespace-more">${t('k8s.namespace.noMatch')}</div>`;
    }
    const hidden = filtered.length - shown.length;
    const more = hidden > 0 ? `<div class="kubernetes-namespace-more">${t('k8s.namespace.moreHint', { count: hidden })}</div>` : '';
    return rows + more;
  }

  // 綁定 namespace 選項 checkbox 的 change（草稿模式）；因搜尋會局部重繪選項，需可重複呼叫。
  bindNamespaceOptionListeners() {
    this.querySelectorAll('[data-namespace-option]').forEach(input => {
      input.addEventListener('change', () => {
        this.markNamespaceSelectInteracting(true);
        const set = new Set(Array.isArray(this.namespaceDraft) ? this.namespaceDraft : []);
        if (input.checked) set.add(input.value);
        else set.delete(input.value);
        this.namespaceDraft = [...set];
        const allCb = this.querySelector('[data-namespace-all]');
        if (allCb) allCb.checked = this.namespaceDraft.length === 0;
      });
    });
  }

  renderPodsTable(allPods, metricsAvailable) {
    // 多選 namespace 篩選：selectedNamespaces 非空（非 All）時只顯示所選集合內的 pod；
    // 空（All）顯示全部。此篩選在 podFilter/podSearch 之前，counts（All/Running/…）
    // 以「namespace 篩選後」為母體計算，與可見範圍一致，避免計數誤導。
    const selectedNamespaces = kubernetesSessionStore.getState().selectedNamespaces || [];
    const namespaceSet = new Set(selectedNamespaces);
    const namespaceFiltered = namespaceSet.size === 0
      ? allPods
      : allPods.filter(pod => namespaceSet.has(pod.namespace));
    // 從 workload/service 跳轉的 label 過濾：只留同 namespace 且 labels 符合 selector 的 Pod。
    // 疊在 namespace 篩選之後，counts（All/Running/…）以此子集為母體，與可見範圍一致。
    const labelFilter = this.podLabelFilter;
    const pods = labelFilter
      ? namespaceFiltered.filter(pod => (pod.namespace || '') === (labelFilter.namespace || '') && this.podMatchesSelector(pod, labelFilter.selector))
      : namespaceFiltered;
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
    const filters = [['all', t('k8s.pods.filter.all')], ['running', t('k8s.pods.filter.running')], ['pending', t('k8s.pods.filter.pending')], ['unhealthy', t('k8s.pods.filter.unhealthy')], ['failed', t('k8s.pods.filter.failed')], ['succeeded', t('k8s.pods.filter.succeeded')]];
    const filterChip = labelFilter
      ? `<div class="kubernetes-pod-filter-chip no-drag"><span class="kubernetes-pod-filter-chip-icon" aria-hidden="true">${renderKubernetesIcon('filter', 14)}</span><span class="kubernetes-pod-filter-chip-kind">${escapeHtml(labelFilter.kind || '')}</span><span class="kubernetes-pod-filter-chip-name">${escapeHtml(labelFilter.name || '')}</span><span class="kubernetes-pod-filter-chip-suffix">${t('k8s.pods.filterBySuffix')}</span><button type="button" class="kubernetes-pod-filter-clear" data-clear-pod-filter="true" title="${t('k8s.pods.clearFilter')}" aria-label="${t('k8s.pods.clearFilter')}">${renderKubernetesIcon('close', 14)}</button></div>`
      : '';
    return `<section class="kubernetes-pods-view">
      ${filterChip}
      <div class="kubernetes-pods-toolbar"><div class="kubernetes-pod-filters">${filters.map(([id, label]) => `<button type="button" data-pod-filter="${id}" class="no-drag ${this.podFilter === id ? 'active' : ''}">${label} ${counts[id]}</button>`).join('')}</div><div class="kubernetes-pod-tools"><input id="kubernetesPodSearch" class="no-drag" value="${escapeHtml(this.podSearch)}" placeholder="${t('k8s.pods.searchPlaceholder')}"><span class="kubernetes-watching">${t('k8s.pods.watching')}</span>${this.renderRefreshButton('refreshKubernetesPods')}</div></div>
      <div class="kubernetes-resource-table-wrap kubernetes-pods-table-wrap"><table class="kubernetes-resource-table kubernetes-pods-table"><thead><tr>${this.sortableTh('pods', 'name', 'Name')}${this.sortableTh('pods', 'namespace', 'Namespace')}<th scope="col">Ready</th>${this.sortableTh('pods', 'status', 'Status')}${this.sortableTh('pods', 'restarts', 'Restarts', { type: 'number' })}<th scope="col">Node</th>${this.sortableTh('pods', 'creationTimestamp', 'Age', { type: 'time' })}${this.sortableTh('pods', 'cpuUsageMilli', 'CPU', { type: 'number' })}${this.sortableTh('pods', 'memoryUsageBytes', 'Memory', { type: 'number' })}<th scope="col">Actions</th></tr></thead><tbody>
      ${visible.map(pod => {
        const container = pod.containers?.[0]?.name || '';
        const running = String(pod.phase || '').toLowerCase() === 'running';
        const hasPorts = (pod.containers || []).some(item => item.ports?.length);
        const encoded = encodeURIComponent(JSON.stringify(pod));
        const attentionTone = podAttentionTone(pod);
        const needsAttention = attentionTone !== '';
        const status = needsAttention
          ? `<span class="kubernetes-pod-alert-status is-${attentionTone}">${renderKubernetesIcon('alert', 14)}${statusBadge(pod.status)}</span>`
          : statusBadge(pod.status);
        return `<tr class="kubernetes-resource-row ${needsAttention ? `kubernetes-pod-row-alert kubernetes-pod-row-alert--${attentionTone}` : ''}" tabindex="0" role="button" aria-label="${t('k8s.row.viewDetailAria', { name: escapeHtml(pod.name) })}" style="border-left-color:${this.namespaceColor(pod.namespace)}" data-resource-kind="pod" data-resource-name="${escapeHtml(pod.name)}" data-resource-namespace="${escapeHtml(pod.namespace)}" data-resource-apiversion="v1">${this.ellipsisCell(pod.name)}<td>${this.renderNamespaceCell(pod.namespace)}</td><td>${escapeHtml(pod.ready)}</td><td>${status}</td><td>${pod.restarts || 0}</td><td>${escapeHtml(pod.nodeName || '-')}</td><td>${formatAge(pod.creationTimestamp)}</td><td>${metricsAvailable ? formatCPU(pod.cpuUsageMilli) : '-'}</td><td>${metricsAvailable ? formatBytes(pod.memoryUsageBytes) : '-'}</td><td class="kubernetes-pod-actions"><button data-pod-action="logs" data-pod="${encoded}" data-container="${escapeHtml(container)}" ${container ? '' : 'disabled'}>Logs</button><button data-pod-action="shell" data-pod="${encoded}" data-container="${escapeHtml(container)}" ${running && container ? '' : 'disabled'}>Shell</button><button data-pod-action="forward" data-pod="${encoded}" ${running && hasPorts ? '' : 'disabled'}>Forward</button></td></tr>`;
      }).join('')}</tbody></table></div></section>`;
  }

  renderPodActionView(state) {
    const pod = state.selectedResource || {};
    const action = state.podActionView || {};
    if (action.type === 'logs') {
      return `<section class="kubernetes-pod-action-view"><header><button id="closeKubernetesPodAction" class="no-drag kubernetes-secondary-btn">${t('k8s.podAction.backToPods')}</button><div><h1>${t('k8s.podAction.logsTitle', { name: escapeHtml(pod.name) })}</h1><p>${escapeHtml(pod.namespace)} / ${escapeHtml(action.container)}</p></div><span class="kubernetes-watching">${this.logPaused ? t('k8s.podAction.paused') : t('k8s.podAction.streaming')}</span></header>${this.renderLogsPanel(state, [action.container].filter(Boolean), action.container, 'action')}</section>`;
    }
    return '';
  }

  // 事件嚴重度：Warning 以外一律視為 Normal（Kubernetes 目前僅有 Normal / Warning 兩種 type）。
  eventSeverity(type) {
    return String(type || '').toLowerCase() === 'warning' ? 'warning' : 'normal';
  }

  // 扁平（不分組）單行對齊列表：欄位固定寬度上下對齊，最左依 namespace 分色，
  // Message 單行不省略、放不下靠外層水平捲軸捲看，點列開 Drawer 看完整內容。
  // options.interactive=false 時（如 Detail Drawer 的 Related Events）不加點列開 Drawer 與工具列。
  renderEventsTable(events, options = {}) {
    const interactive = options.interactive !== false;
    if (!events.length) return `<div class="kubernetes-resource-empty">${t('k8s.empty.noEvents')}</div>`;
    // 統一事件時間欄位（後端可能給 timestamp / time / lastTimestamp / eventTime）；
    // 後端一律輸出 UTC RFC3339（尾碼 Z），故字串比較即等同時間先後，供排序與 Age 顯示共用。
    const withTime = events.map(event => ({
      ...event,
      _eventTime: event.timestamp || event.time || event.lastTimestamp || event.eventTime || ''
    }));
    // ② Type 篩選（All / Warning / Normal）＋ 搜尋（reason / namespace / object / message）。
    const typeFilter = this.eventsTypeFilter || 'all';
    const search = (this.eventsSearch || '').trim().toLowerCase();
    const filtered = withTime.filter(event => {
      if (typeFilter !== 'all' && String(event.type || '') !== typeFilter) return false;
      if (!search) return true;
      return `${event.reason || ''} ${event.namespace || ''} ${event.object || event.involvedObject || ''} ${event.message || ''}`.toLowerCase().includes(search);
    });
    // 不分組：Warning 優先，其次依時間新到舊。
    const sorted = filtered.slice().sort((a, b) => {
      const aw = this.eventSeverity(a.type) === 'warning';
      const bw = this.eventSeverity(b.type) === 'warning';
      if (aw !== bw) return aw ? -1 : 1;
      return (b._eventTime || '').localeCompare(a._eventTime || '');
    });
    const colspan = interactive ? 8 : 7;
    const rows = sorted.length
      ? sorted.map(event => this.renderEventRow(event, interactive)).join('')
      : `<tr><td colspan="${colspan}" class="kubernetes-events-empty">${t('k8s.empty.noMatchingEvents')}</td></tr>`;
    const table = `
      <div class="kubernetes-eventlist-scroll">
        <table class="kubernetes-eventlist-table${interactive ? '' : ' kubernetes-eventlist-static'}">
          <caption class="kubernetes-table-caption">Kubernetes Events</caption>
          <thead><tr>
            <th class="kubernetes-eventlist-spacer" aria-hidden="true"></th>
            <th scope="col">${t('k8s.events.colReason')}</th>
            <th scope="col">${t('k8s.events.colNamespace')}</th>
            <th scope="col">${t('k8s.events.colObject')}</th>
            <th scope="col">${t('k8s.events.colMessage')}</th>
            <th scope="col" class="kubernetes-eventlist-num">${t('k8s.events.colAge')}</th>
            <th scope="col" class="kubernetes-eventlist-num">${t('k8s.events.colCount')}</th>
            ${interactive ? '<th class="kubernetes-eventlist-spacer" aria-hidden="true"></th>' : ''}
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
    if (!interactive) return table;
    const filterOption = (value, label) => `<option value="${value}"${typeFilter === value ? ' selected' : ''}>${label}</option>`;
    return `
      <div class="kubernetes-events-toolbar">
        <div class="kubernetes-section-search no-drag"><span class="kubernetes-section-search-icon" aria-hidden="true">${renderKubernetesIcon('search', 14)}</span><input id="kubernetesEventsSearch" class="no-drag" value="${escapeHtml(this.eventsSearch || '')}" placeholder="${t('k8s.events.searchPlaceholder')}" aria-label="${t('k8s.events.searchAria')}"></div>
        <label class="kubernetes-events-filter no-drag">
          <span>${t('k8s.events.type')}</span>
          <select id="kubernetesEventsTypeFilter" class="no-drag" aria-label="${t('k8s.events.filterAria')}">
            ${filterOption('all', t('k8s.events.typeAll'))}${filterOption('Warning', t('k8s.events.typeWarning'))}${filterOption('Normal', t('k8s.events.typeNormal'))}
          </select>
        </label>
      </div>
      ${table}`;
  }

  // 單一事件列：色條(namespace) → 嚴重度點 → reason 徽章 → namespace → object(名稱截斷) →
  // message(單行不省略) → age → count(×N)。interactive 時整列可點/Enter 開 Drawer。
  renderEventRow(event, interactive) {
    const sev = this.eventSeverity(event.type);
    const reason = event.reason || '-';
    const namespace = event.namespace || '';
    const obj = event.object || event.involvedObject || '';
    const slash = obj.indexOf('/');
    const oname = slash > 0 ? obj.slice(slash + 1) : obj;
    const count = Number(event.count) || 1;
    const chevron = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';
    const payload = encodeURIComponent(JSON.stringify({
      type: event.type || '', reason, namespace, object: obj, message: event.message || '', count, timestamp: event._eventTime || ''
    }));
    const rowAttrs = interactive
      ? ` role="button" tabindex="0" data-event-row data-event="${payload}" aria-label="${t('k8s.events.viewDetailAria', { reason: escapeHtml(reason) })}"`
      : '';
    return `<tr class="kubernetes-eventlist-row kubernetes-event--${sev}"${rowAttrs}>`
      + `<td class="kubernetes-eventlist-dotcell" style="box-shadow:inset 4px 0 0 ${this.namespaceColor(namespace)}"><span class="kubernetes-eventlist-dot" aria-hidden="true"></span></td>`
      + `<td class="kubernetes-eventlist-reason"><span class="kubernetes-eventlist-reason-badge">${escapeHtml(reason)}</span></td>`
      + `<td class="kubernetes-eventlist-ns" title="${escapeHtml(namespace || '-')}">${escapeHtml(namespace || '-')}</td>`
      + `<td class="kubernetes-eventlist-obj" title="${escapeHtml(obj || '-')}">${escapeHtml(oname || '-')}</td>`
      + `<td class="kubernetes-eventlist-msg">${escapeHtml(event.message || '-')}</td>`
      + `<td class="kubernetes-eventlist-num kubernetes-eventlist-age"${event._eventTime ? ` title="${escapeHtml(event._eventTime)}"` : ''}>${event._eventTime ? formatAge(event._eventTime) : '-'}</td>`
      + `<td class="kubernetes-eventlist-num kubernetes-eventlist-cnt">${count > 1 ? `<span class="kubernetes-event-count" title="${t('k8s.events.repeatedAria', { count })}">×${count}</span>` : '—'}</td>`
      + (interactive ? `<td class="kubernetes-eventlist-chev" aria-hidden="true">${chevron}</td>` : '')
      + '</tr>';
  }

  // Namespaces 為 cluster-scoped 資源，直接顯示 dashboard.namespaceDetails 全部，
  // 不套用 namespace 多選篩選（篩選僅用於 namespaced 資源如 Pod）。可點擊開啟 detail drawer。
  renderNamespacesTable(allNamespaces) {
    const namespaces = this.applyTableSort('namespaces', this.applyTableSearch('namespaces', allNamespaces));
    if (!namespaces.length) {
      return `${this.renderSectionRefresh('namespaces')}<div class="kubernetes-resource-empty">${this.tableSearch.namespaces ? t('k8s.empty.noMatch') : t('k8s.empty.namespaces')}</div>`;
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
      return `${this.renderSectionRefresh('configMaps')}<div class="kubernetes-resource-empty">${this.tableSearch.configMaps ? t('k8s.empty.noMatch') : t('k8s.empty.noResourcesInScope')}</div>`;
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
      return `${this.renderSectionRefresh('secrets')}<div class="kubernetes-resource-empty">${this.tableSearch.secrets ? t('k8s.empty.noMatch') : t('k8s.empty.noResourcesInScope')}</div>`;
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
      return `${this.renderSectionRefresh('daemonSets')}<div class="kubernetes-resource-empty">${this.tableSearch.daemonSets ? t('k8s.empty.noMatch') : t('k8s.empty.noResourcesInScope')}</div>`;
    }
    return `
      ${this.renderSectionRefresh('daemonSets')}
      <div class="kubernetes-resource-table-wrap">
        <table class="kubernetes-resource-table kubernetes-nscolored-table">
          <caption class="kubernetes-table-caption">DaemonSets</caption>
          <thead><tr>${this.sortableTh('daemonSets', 'name', 'Name')}${this.sortableTh('daemonSets', 'namespace', 'Namespace')}${this.sortableTh('daemonSets', 'status', 'Status')}${this.sortableTh('daemonSets', 'readyReplicas', 'Ready', { type: 'number' })}${this.sortableTh('daemonSets', 'creationTimestamp', 'Age', { type: 'time' })}<th></th></tr></thead>
          <tbody>${daemonSets.map(item => `<tr ${this.resourceRowAttrs('daemonSets', item.name, item.namespace, `border-left-color:${this.namespaceColor(item.namespace)}`)}>
            ${this.ellipsisCell(item.name)}
            <td>${this.renderNamespaceCell(item.namespace)}</td>
            <td>${statusBadge(item.status)}</td>
            <td>${Number(item.readyReplicas || 0)}/${Number(item.desiredReplicas || 0)}</td>
            <td>${formatAge(item.creationTimestamp)}</td>
            <td class="kubernetes-pod-actions kubernetes-row-actions">${this.favoriteResourceButton('daemonSets', item)}${this.viewPodsIconButton('daemonset', item)}</td>
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
      return `${this.renderSectionRefresh('jobs')}<div class="kubernetes-resource-empty">${this.tableSearch.jobs ? t('k8s.empty.noMatch') : t('k8s.empty.noResourcesInScope')}</div>`;
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
      return `${this.renderSectionRefresh('cronJobs')}<div class="kubernetes-resource-empty">${this.tableSearch.cronJobs ? t('k8s.empty.noMatch') : t('k8s.empty.noResourcesInScope')}</div>`;
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
      return `${this.renderSectionRefresh('endpoints')}<div class="kubernetes-resource-empty">${this.tableSearch.endpoints ? t('k8s.empty.noMatch') : t('k8s.empty.noResourcesInScope')}</div>`;
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
      return `${this.renderSectionRefresh('networkPolicies')}<div class="kubernetes-resource-empty">${this.tableSearch.networkPolicies ? t('k8s.empty.noMatch') : t('k8s.empty.noResourcesInScope')}</div>`;
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
      return `${this.renderSectionRefresh('serviceAccounts')}<div class="kubernetes-resource-empty">${this.tableSearch.serviceAccounts ? t('k8s.empty.noMatch') : t('k8s.empty.noResourcesInScope')}</div>`;
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
      return `${this.renderSectionRefresh('roles')}<div class="kubernetes-resource-empty">${this.tableSearch.roles ? t('k8s.empty.noMatch') : t('k8s.empty.noResourcesInScope')}</div>`;
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
      return `${this.renderSectionRefresh('roleBindings')}<div class="kubernetes-resource-empty">${this.tableSearch.roleBindings ? t('k8s.empty.noMatch') : t('k8s.empty.noResourcesInScope')}</div>`;
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
      return `${this.renderSectionRefresh('clusterRoles')}<div class="kubernetes-resource-empty">${this.tableSearch.clusterRoles ? t('k8s.empty.noMatch') : t('k8s.empty.clusterRoles')}</div>`;
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
      return `${this.renderSectionRefresh('clusterRoleBindings')}<div class="kubernetes-resource-empty">${this.tableSearch.clusterRoleBindings ? t('k8s.empty.noMatch') : t('k8s.empty.clusterRoleBindings')}</div>`;
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
      return `${this.renderSectionRefresh('horizontalPodAutoscalers')}<div class="kubernetes-resource-empty">${this.tableSearch.horizontalPodAutoscalers ? t('k8s.empty.noMatch') : t('k8s.empty.noResourcesInScope')}</div>`;
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
      return `${this.renderSectionRefresh('podDisruptionBudgets')}<div class="kubernetes-resource-empty">${this.tableSearch.podDisruptionBudgets ? t('k8s.empty.noMatch') : t('k8s.empty.noResourcesInScope')}</div>`;
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
      return `${this.renderSectionRefresh('resourceQuotas')}<div class="kubernetes-resource-empty">${this.tableSearch.resourceQuotas ? t('k8s.empty.noMatch') : t('k8s.empty.noResourcesInScope')}</div>`;
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
      return `${this.renderSectionRefresh('customResourceDefinitions')}<div class="kubernetes-resource-empty">${this.tableSearch.customResourceDefinitions ? t('k8s.empty.noMatch') : t('k8s.empty.crds')}</div>`;
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

  // Events 專用 Drawer（不走抓 YAML 的 resource detail 流程，純本地 selectedEvent 驅動）：
  // 顯示 namespace / object / type / count / age 與完整 message。沿用 detail drawer 版面樣式。
  renderEventDrawer() {
    const ev = this.selectedEvent;
    if (!ev) return '';
    const sev = this.eventSeverity(ev.type);
    const count = Number(ev.count) || 1;
    const fields = [
      [t('k8s.events.colNamespace'), ev.namespace || '—'],
      [t('k8s.events.colObject'), ev.object || '—'],
      [t('k8s.events.type'), ev.type || '—'],
      [t('k8s.events.colCount'), count > 1 ? `×${count}` : String(count)],
      [t('k8s.events.colAge'), ev.timestamp ? formatAge(ev.timestamp) : '—']
    ];
    return `
      <div class="kubernetes-detail-backdrop no-drag" data-close-event="true"></div>
      <aside class="kubernetes-detail-drawer kubernetes-event-drawer no-drag" role="dialog" aria-modal="true" aria-labelledby="kubernetesEventTitle">
        <header><div><h2 id="kubernetesEventTitle">${escapeHtml(ev.reason || '-')}</h2><p><span class="kubernetes-detail-kind kubernetes-event-drawer-sev kubernetes-event--${sev}">${escapeHtml(ev.type || 'Normal')}</span></p></div><button type="button" class="kubernetes-drawer-close no-drag" aria-label="${t('k8s.events.drawerCloseAria')}">${renderKubernetesIcon('close', 22)}</button></header>
        <div class="kubernetes-detail-body">
          <section class="kubernetes-detail-section"><dl class="kubernetes-detail-fields kubernetes-detail-fields--striped">${fields.map(([key, value]) => `<div><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(String(value))}</dd></div>`).join('')}</dl></section>
          <section class="kubernetes-detail-section"><h3>${t('k8s.events.message')}</h3><div class="kubernetes-event-drawer-message">${escapeHtml(ev.message || '-')}</div></section>
        </div>
      </aside>`;
  }

  // 點事件列開啟 Drawer：解析列上序列化的事件資料存為本地狀態並重繪（保存捲動避免回彈）。
  openEventDrawer(event) {
    this.selectedEvent = event;
    this.rerenderPreservingScroll();
    this.querySelector('.kubernetes-event-drawer .kubernetes-drawer-close')?.focus();
  }

  closeEventDrawer() {
    if (!this.selectedEvent) return;
    this.selectedEvent = null;
    this.rerenderPreservingScroll();
  }

  // 擷取所有可捲動容器目前位置（render() 重建 innerHTML 前呼叫）。
  // 涵蓋：主內容（垂直＋水平，pod 等寬表格靠它水平捲動）、側欄（垂直）、
  // Events 列表（水平）、Detail Drawer 內文（垂直＋水平）。
  captureScrollState() {
    const read = (sel, axes) => {
      const el = this.querySelector(sel);
      if (!el) return null;
      const pos = {};
      if (axes.includes('y')) pos.top = el.scrollTop;
      if (axes.includes('x')) pos.left = el.scrollLeft;
      return pos;
    };
    return {
      '.kubernetes-session-scrollbody': read('.kubernetes-session-scrollbody', 'xy'),
      '.kubernetes-session-nav': read('.kubernetes-session-nav', 'y'),
      '.kubernetes-eventlist-scroll': read('.kubernetes-eventlist-scroll', 'x'),
      '.kubernetes-detail-body': read('.kubernetes-detail-body', 'xy'),
      '.kubernetes-session-logs': read('.kubernetes-session-logs', 'y'),
      // Pod Action Logs 每次串流更新都會重建輸出節點；必須保留其水平位置，
      // 否則長行日誌的捲軸會在每次更新後回到最左側。
      '#kubernetesLogOutput': read('#kubernetesLogOutput', 'xy')
    };
  }

  // 依 captureScrollState() 的結果還原各容器位置。以 suppressScrollbarAutohide 包住，
  // 避免程式還原（非使用者手動捲動）觸發的 scroll 事件讓捲動條每次刷新就閃現。
  restoreScrollState(state) {
    if (!state) return;
    suppressScrollbarAutohide(() => {
      for (const [sel, pos] of Object.entries(state)) {
        if (!pos) continue;
        const el = this.querySelector(sel);
        if (!el) continue;
        if (pos.top !== undefined) el.scrollTop = pos.top;
        if (pos.left !== undefined) el.scrollLeft = pos.left;
      }
    });
  }

  // render()+setupListeners() 並保存還原所有捲動容器位置（供 Drawer 開/關等直接重繪路徑使用）。
  rerenderPreservingScroll() {
    const scrollState = this.captureScrollState();
    this.render();
    this.setupListeners();
    this.restoreScrollState(scrollState);
  }

  renderDetailDrawer(state) {
    if (!state.detailOpen) return '';
    const detail = state.resourceDetail;
    const selected = state.selectedResource || {};
    const title = detail?.name || detail?.metadata?.name || selected.name || t('k8s.detail.fallbackTitle');
    const namespace = detail?.namespace || detail?.metadata?.namespace || selected.namespace || '';
    const kind = String(selected.kind || detail?.kind || '').toLowerCase();
    const isPod = kind === 'pod';
    const isService = kind === 'service';
    // Deployment / StatefulSet：drawer 內提供 Scale 鈕（目前副本數取自 dashboard 快照）。
    const isScalable = kind === 'deployment' || kind === 'statefulset';
    let scaleBtnHtml = '';
    if (isScalable) {
      const dash = state.dashboard;
      const arr = dash ? (kind === 'deployment' ? dash.deployments : dash.statefulSets) : null;
      const found = Array.isArray(arr) ? arr.find(it => it.name === (selected.name || '') && (it.namespace || '') === (namespace || '')) : null;
      const desired = Number((found && found.desiredReplicas) ?? detail?.desiredReplicas ?? 0);
      scaleBtnHtml = this.scaleButton(kind, selected.apiVersion || detail?.apiVersion || 'apps/v1', { name: selected.name, namespace, desiredReplicas: desired });
    }
    let body = '';
    if (state.detailLoading && !detail) {
      body = `<div class="kubernetes-drawer-state"><span class="kubernetes-spinner"></span><span>${t('k8s.detail.loading')}</span></div>`;
    } else if (state.detailError && !detail) {
      body = `<div class="kubernetes-session-error" role="alert"><strong>${t('k8s.detail.loadFailed')}</strong><span>${escapeHtml(state.detailError)}</span></div>`;
    } else if (detail) {
      body = this.renderResourceDetailTab(detail, selected, state);
    } else {
      body = `<div class="kubernetes-resource-empty">${t('k8s.empty.noDetail')}</div>`;
    }
    return `
      <div class="kubernetes-detail-backdrop no-drag" data-close-detail="true"></div>
      <aside class="kubernetes-detail-drawer ${isPod ? 'kubernetes-pod-detail-drawer' : ''} no-drag" role="dialog" aria-modal="true" aria-labelledby="kubernetesDetailTitle">
        <header><div><h2 id="kubernetesDetailTitle">${escapeHtml(title)}</h2><p><span class="kubernetes-detail-kind">${escapeHtml(selected.kind || detail?.kind || t('k8s.resource.genericName'))}</span>${namespace ? ` ${t('k8s.detail.inNamespace', { namespace: escapeHtml(namespace) })}` : ''}</p></div><div class="kubernetes-detail-header-actions">${scaleBtnHtml}<button type="button" class="kubernetes-drawer-close no-drag" aria-label="${t('k8s.detail.closeAria')}">${renderKubernetesIcon('close', 22)}</button></div></header>
        ${state.detailError && detail ? `<div class="kubernetes-session-error compact"><strong>${t('k8s.detail.refreshFailedSnapshot')}</strong><span>${escapeHtml(state.detailError)}</span></div>` : ''}
        ${detail ? this.renderResourceDetailTabs(state.detailTab, isPod, isService, Array.isArray(detail.containers) && detail.containers.some(c => (Array.isArray(c.env) && c.env.length) || (Array.isArray(c.envFrom) && c.envFrom.length))) : ''}
        <div class="kubernetes-detail-body"${detail ? ` id="k8s-detail-panel" role="tabpanel" aria-labelledby="k8s-detail-tab-${escapeHtml(state.detailTab || 'overview')}"` : ''}>${body}</div>
      </aside>`;
  }

  renderResourceDetailTabs(activeTab = 'overview', isPod = false, isService = false, hasEnv = false) {
    // 所有 kind 皆有 Overview / YAML / Delete；有容器環境變數（Pod 或 workload 範本）時加 ENV；
    // Pod 另有 Logs / Forward；Service 另有 Forward。
    const tabs = [['overview', 'Overview']];
    if (hasEnv) tabs.push(['env', 'ENV']);
    tabs.push(['yaml', 'YAML']);
    if (isPod) tabs.push(['logs', 'Logs']);
    if (isPod || isService) tabs.push(['forward', 'Forward']);
    tabs.push(['delete', 'Delete']);
    // 內容面板 id 固定為 k8s-detail-panel；各 tab id 為 k8s-detail-tab-${id}。
    // aria-controls 指向面板、aria-selected 標示 active；面板側於 renderDetailDrawer 補 aria-labelledby。
    return `<nav class="kubernetes-pod-detail-tabs" aria-label="${t('k8s.detail.tabsAria')}" role="tablist">${tabs.map(([id, label]) => `<button type="button" id="k8s-detail-tab-${id}" class="no-drag ${activeTab === id ? 'active' : ''} ${id === 'delete' ? 'danger' : ''}" data-detail-tab="${id}" role="tab" aria-selected="${activeTab === id}" aria-controls="k8s-detail-panel">${label}</button>`).join('')}</nav>`;
  }

  renderResourceDetailTab(detail, selected, state) {
    const kind = String(selected.kind || detail.kind || '').toLowerCase();
    const isPod = kind === 'pod';
    const isService = kind === 'service';
    switch (state.detailTab) {
    case 'env':
      return this.renderEnvTab(detail);
    case 'yaml':
      return this.renderDetailYAML(detail, selected, state);
    case 'logs':
      return isPod ? this.renderPodLogs(detail, selected, state, Array.isArray(detail.containers) ? detail.containers : []) : this.renderDetailContent(detail, selected, state);
    case 'forward':
      return isPod ? this.renderPodForward(detail, state) : isService ? this.renderServiceForward(selected, state) : this.renderDetailContent(detail, selected, state);
    case 'delete':
      return this.renderResourceDelete(detail, selected, state);
    default:
      return this.renderDetailContent(detail, selected, state);
    }
  }

  // 判斷單一 env 的類型徽章與（valueFrom 時的）來源參照。後端 Source 格式為「<Kind> <ref>」。
  // 依 valueFrom 來源的第一個詞挑選圖示；Secret 不顯示明文值，僅顯示來源參照。
  envRefIcon(kind) {
    if (kind === 'Secret') return '<i class="ti ti-lock kubernetes-env-ref-icon k-secret" aria-hidden="true"></i>';
    if (kind === 'ConfigMap') return '<i class="ti ti-file-text kubernetes-env-ref-icon k-cm" aria-hidden="true"></i>';
    return '<i class="ti ti-tag kubernetes-env-ref-icon k-field" aria-hidden="true"></i>';
  }

  // ENV 頁籤：按容器分組，並依來源分區——「直接值」與「參照來源」各為一張條紋雙欄表。
  renderEnvTab(detail) {
    const containers = (Array.isArray(detail.containers) ? detail.containers : [])
      .filter(c => (Array.isArray(c.env) && c.env.length) || (Array.isArray(c.envFrom) && c.envFrom.length));
    if (!containers.length) return `<div class="kubernetes-resource-empty">${t('k8s.detail.noEnv')}</div>`;
    const hasValue = entry => entry.value !== undefined && entry.value !== '';
    const firstWord = src => {
      const sp = src.indexOf(' ');
      return sp > 0 ? src.slice(0, sp) : src;
    };
    return containers.map(container => {
      const env = Array.isArray(container.env) ? container.env : [];
      const envFrom = Array.isArray(container.envFrom) ? container.envFrom : [];
      const direct = env.filter(hasValue);
      const refs = env.filter(entry => !hasValue(entry));

      const directRows = direct
        .map(entry => `<div><dt>${escapeHtml(entry.name || '')}</dt><dd>${escapeHtml(entry.value)}</dd></div>`)
        .join('');
      const refRows = refs.map(entry => {
        const source = String(entry.source || 'valueFrom');
        return `<div><dt>${escapeHtml(entry.name || '')}</dt><dd class="kubernetes-env-ref">${this.envRefIcon(firstWord(source))}<span>${escapeHtml(source)}</span></dd></div>`;
      }).join('');
      const fromRows = envFrom.map(src => {
        const source = String(src);
        return `<div><dt>envFrom</dt><dd class="kubernetes-env-ref">${this.envRefIcon(firstWord(source))}<span>${escapeHtml(source)}</span></dd></div>`;
      }).join('');

      const directBlock = direct.length
        ? `<div class="kubernetes-env-subhead"><i class="ti ti-equal" aria-hidden="true"></i>${t('k8s.detail.envDirect')}</div>`
          + `<dl class="kubernetes-detail-fields kubernetes-detail-fields--striped">${directRows}</dl>`
        : '';
      const refBlock = (refs.length || envFrom.length)
        ? `<div class="kubernetes-env-subhead"><i class="ti ti-link" aria-hidden="true"></i>${t('k8s.detail.envRefs')}</div>`
          + `<dl class="kubernetes-detail-fields kubernetes-detail-fields--striped">${refRows}${fromRows}</dl>`
        : '';

      return `<section class="kubernetes-detail-section"><h3>${escapeHtml(container.name || '-')}</h3><div class="kubernetes-env-groups">${directBlock}${refBlock}</div></section>`;
    }).join('');
  }

  // Secret 專屬：overview 顯示 Type 與 Data。data 值預設遮蔽，可即時取值複製 / 查看明文。
  renderSecretSection(detail) {
    if (String(detail.kind || '').toLowerCase() !== 'secret') return '';
    const type = detail.secretType || '';
    const keys = Array.isArray(detail.secretDataKeys) ? detail.secretDataKeys : [];
    // 切換到不同 Secret 時清掉已揭露快取，避免跨資源殘留明文。
    const resourceKey = `${detail.namespace || ''}/${detail.name || ''}`;
    if (this.revealedSecretsFor !== resourceKey) {
      this.revealedSecrets = {};
      this.revealedSecretsFor = resourceKey;
    }
    const typeBlock = type
      ? `<section class="kubernetes-detail-section"><h3 class="kubernetes-detail-heading"><i class="ti ti-shield-lock" aria-hidden="true"></i>Type</h3><div class="kubernetes-secret-type">${escapeHtml(type)}</div></section>`
      : '';
    if (!keys.length) return typeBlock;
    const rows = keys.map(key => {
      const revealed = Object.prototype.hasOwnProperty.call(this.revealedSecrets || {}, key);
      const valueHtml = revealed
        ? `<span class="kubernetes-secret-plaintext">${escapeHtml(this.revealedSecrets[key])}</span>`
        : '••••••••';
      const eyeIcon = revealed ? 'ti-eye-off' : 'ti-eye';
      const eyeLabel = revealed ? t('k8s.detail.secretHide') : t('k8s.detail.secretReveal');
      return `<div class="kubernetes-secret-row">
        <div class="kubernetes-secret-row-head">
          <code class="kubernetes-secret-key">${escapeHtml(key)}</code>
          <div class="kubernetes-secret-actions">
            <button type="button" class="kubernetes-secret-btn" data-secret-copy data-secret-key="${escapeHtml(key)}" aria-label="${t('k8s.detail.secretCopy')}" title="${t('k8s.detail.secretCopy')}"><i class="ti ti-copy" aria-hidden="true"></i></button>
            <button type="button" class="kubernetes-secret-btn" data-secret-reveal data-secret-key="${escapeHtml(key)}" aria-label="${eyeLabel}" title="${eyeLabel}"><i class="ti ${eyeIcon}" aria-hidden="true"></i></button>
          </div>
        </div>
        <div class="kubernetes-secret-value">${valueHtml}</div>
      </div>`;
    }).join('');
    return `${typeBlock}<section class="kubernetes-detail-section"><h3 class="kubernetes-detail-heading"><i class="ti ti-key" aria-hidden="true"></i>Data</h3><div class="kubernetes-secret-data">${rows}</div></section>`;
  }

  // 取單一 Secret data key 明文（即時向後端要，不隨 detail 一併下傳）。
  async fetchSecretValue(key) {
    const detail = kubernetesSessionStore.getState().resourceDetail || {};
    const result = await KubernetesAPI.getSecretValue({
      namespace: detail.namespace || '',
      name: detail.name || '',
      key
    });
    return result?.value ?? '';
  }

  async toggleSecretReveal(key) {
    if (!this.revealedSecrets) this.revealedSecrets = {};
    if (Object.prototype.hasOwnProperty.call(this.revealedSecrets, key)) {
      delete this.revealedSecrets[key];
      this.render();
      this.setupListeners();
      return;
    }
    try {
      this.revealedSecrets[key] = await this.fetchSecretValue(key);
      this.render();
      this.setupListeners();
    } catch (error) {
      showToast(t('k8s.detail.secretRevealFailed', { error: error.message || error }), { type: 'error' });
    }
  }

  async copySecretValue(key) {
    try {
      const value = (this.revealedSecrets && Object.prototype.hasOwnProperty.call(this.revealedSecrets, key))
        ? this.revealedSecrets[key]
        : await this.fetchSecretValue(key);
      await navigator.clipboard?.writeText(value);
      showToast(t('k8s.detail.secretCopied'), { type: 'success' });
    } catch (error) {
      showToast(t('k8s.detail.secretRevealFailed', { error: error.message || error }), { type: 'error' });
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
    const isPod = String(kind).toLowerCase() === 'pod';
    return `
      ${isPod ? this.renderPodMetricCards(detail, selected) : ''}
      ${this.renderMetadataSection(overviewEntries)}
      ${this.renderSecretSection(detail)}
      ${this.renderDashboardSummarySection(kind, selected, state)}
      ${this.renderRelatedPodsAction(kind, selected, state)}
      ${Array.isArray(detail.owners) && detail.owners.length ? `<section class="kubernetes-detail-section"><h3>Owned By</h3><div class="kubernetes-detail-owners">${detail.owners.map(owner => `<div><span>${escapeHtml(owner.kind || '-')}</span><strong>${escapeHtml(owner.name || '-')}</strong>${owner.controller ? '<small>controller</small>' : ''}</div>`).join('')}</div></section>` : ''}
      ${this.renderLabelChipsSection(labels)}
      ${conditions.length ? `<section class="kubernetes-detail-section"><h3>Conditions</h3><div class="kubernetes-detail-conditions">${conditions.map(condition => `<div class="kubernetes-condition-card" style="border-left-color:${statusToneColor(condition.status)}"><div class="kubernetes-condition-head"><strong>${escapeHtml(condition.type || '-')}</strong>${statusBadge(condition.status)}</div>${condition.reason ? `<span>${escapeHtml(condition.reason)}</span>` : ''}${condition.message ? `<p>${escapeHtml(condition.message)}</p>` : ''}</div>`).join('')}</div></section>` : ''}
      ${containers.length ? `<section class="kubernetes-detail-section"><h3>Containers</h3><div class="kubernetes-detail-containers">${containers.map(container => `<div><strong>${escapeHtml(container.name || '-')}</strong><span>${escapeHtml(container.image || '')}</span>${container.state ? `${statusBadge(container.ready ? 'Ready' : 'Not Ready')}<small>${escapeHtml(container.state)}</small>` : ''}</div>`).join('')}</div></section>` : ''}
      ${detail.eventsError ? `<div class="kubernetes-session-error compact" role="status"><strong>${t('k8s.detail.relatedEventsError')}</strong><span>${escapeHtml(detail.eventsError)}</span></div>` : ''}
      ${events.length
        ? `<section class="kubernetes-detail-section"><h3>Related Events</h3>${this.renderEventsTable(events, { interactive: false })}</section>`
        : (state?.eventsLoading ? `<section class="kubernetes-detail-section"><h3>Related Events</h3><div class="kubernetes-detail-events-loading"><span class="kubernetes-spinner-mini" aria-hidden="true"></span><span>${t('k8s.detail.eventsLoading')}</span></div></section>` : '')}`;
  }

  // Pod 專屬：頂部三張狀態卡（狀態 + 語意色點 / Age / 重啟數）。
  renderPodMetricCards(detail, selected) {
    const status = String(detail.status || selected?.status || '-');
    const age = formatAge(selected?.creationTimestamp || detail.createdAt);
    // 重啟數優先取 dashboard 列的彙總值；沒有時退回加總各容器的 restartCount。
    const restarts = selected?.restarts
      ?? (Array.isArray(detail.containers) ? detail.containers.reduce((sum, c) => sum + (Number(c.restartCount) || 0), 0) : 0);
    return `<div class="kubernetes-detail-metrics">
      <div><span>Pod status</span><strong>${escapeHtml(status)}<i class="kubernetes-metric-dot" style="background:${statusToneColor(status)}" aria-hidden="true"></i></strong></div>
      <div><span>Age</span><strong>${escapeHtml(age)}</strong></div>
      <div><span>Restart count</span><strong>${escapeHtml(String(restarts))}</strong></div>
    </div>`;
  }

  // Metadata 區塊：帶圖示標題 + 條紋表格（核心欄位 + 動態欄位）。
  renderMetadataSection(entries) {
    if (!entries.length) return '';
    return `<section class="kubernetes-detail-section"><h3 class="kubernetes-detail-heading"><i class="ti ti-list-details" aria-hidden="true"></i>Metadata</h3><dl class="kubernetes-detail-fields kubernetes-detail-fields--striped">${entries.map(([key, value]) => `<div><dt>${escapeHtml(key)}</dt><dd>${this.renderDetailValue(value)}</dd></div>`).join('')}</dl></section>`;
  }

  // Labels 以彩色 chips 呈現；顏色由 label key 決定性 hash（重用 namespaceColor 調色盤）。
  renderLabelChipsSection(labels) {
    const entries = normalizeEntries(labels);
    if (!entries.length) return '';
    const chips = entries.map(([key, value]) => {
      const text = (value !== undefined && value !== null && value !== '' && value !== '-') ? `${key}: ${value}` : String(key);
      const color = this.namespaceColor(String(key));
      return `<span class="kubernetes-detail-chip" title="${escapeHtml(text)}" style="color:${color}; background:color-mix(in srgb, ${color} 16%, transparent); border-color:color-mix(in srgb, ${color} 42%, transparent);">${escapeHtml(text)}</span>`;
    }).join('');
    return `<section class="kubernetes-detail-section"><h3>Labels</h3><div class="kubernetes-detail-chips">${chips}</div></section>`;
  }

  // ① Overview 重用 dashboard 快照摘要：依 kind 在對應摘要陣列中以 name(+namespace) 找到該資源，
  // 額外顯示該 kind 的重點欄位。找不到摘要（或該 kind 無對映）時略過此區塊（不報錯）。
  // 對映鍵沿用各表格 columns 的欄位名，值為 [欄位 key, 顯示標籤] 對。
  renderDashboardSummarySection(kind, selected, state) {
    const SUMMARY_FIELDS = {
      deployment: ['deployments', [['readyReplicas', 'Ready'], ['desiredReplicas', 'Desired'], ['availableReplicas', 'Available']]],
      statefulset: ['statefulSets', [['readyReplicas', 'Ready'], ['desiredReplicas', 'Desired'], ['availableReplicas', 'Available']]],
      service: ['services', [['type', 'Type'], ['clusterIp', 'Cluster IP'], ['externalAddresses', 'External Addresses'], ['ports', 'Ports']]],
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
        <div><h3>${t('k8s.logs.title', { name: escapeHtml(state.selectedResource?.name || 'Pod') })}</h3><span>${escapeHtml(state.selectedResource?.namespace || options.namespace || '')}</span>${this.logPaused ? `<span class="kubernetes-log-stream paused">${t('k8s.logs.paused')}</span>` : `<span class="kubernetes-log-stream">${t('k8s.logs.streamingActive')}</span>`}</div>
        <select id="kubernetesLogContainer" class="no-drag">${containers.map(name => `<option value="${escapeHtml(name)}" ${name === selectedContainer ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('')}</select>
      </div>
      <div class="kubernetes-log-bar no-drag">
        <div class="kubernetes-log-bar-search">
          <span class="kubernetes-log-bar-icon" aria-hidden="true">${renderKubernetesIcon('search', 15)}</span>
          <input id="kubernetesLogSearch" class="no-drag" value="${escapeHtml(this.logSearch)}" placeholder="${t('k8s.logs.searchPlaceholder')}">
          <button type="button" aria-label="${t('k8s.logs.toggleRegex')}" id="toggleKubernetesLogRegex" class="kubernetes-log-rex ${this.logRegex ? 'active' : ''}" title="${t('k8s.logs.toggleRegex')}">.*</button>
        </div>
        <div class="kubernetes-log-bar-level">
          <select id="kubernetesLogLevel" class="no-drag">
            <option value="all" ${this.logLevel === 'all' ? 'selected' : ''}>${t('k8s.logs.allLevels')}</option>
            <option value="error" ${this.logLevel === 'error' ? 'selected' : ''}>${t('k8s.logs.levelError')}</option>
            <option value="warning" ${this.logLevel === 'warning' ? 'selected' : ''}>${t('k8s.logs.levelWarning')}</option>
            <option value="info" ${this.logLevel === 'info' ? 'selected' : ''}>${t('k8s.logs.levelInfo')}</option>
            <option value="debug" ${this.logLevel === 'debug' ? 'selected' : ''}>${t('k8s.logs.levelDebug')}</option>
          </select>
        </div>
        <button type="button" id="toggleKubernetesLogsPause" class="kubernetes-log-bar-btn ${this.logPaused ? 'paused' : ''}" title="${this.logPaused ? t('k8s.logs.follow') : t('k8s.logs.pause')}" aria-label="${this.logPaused ? t('k8s.logs.follow') : t('k8s.logs.pause')}">${this.logPaused ? renderKubernetesIcon('play', 16) : renderKubernetesIcon('pause', 16)}</button>
        <button type="button" id="reloadKubernetesPodLogs" class="kubernetes-log-bar-btn accent" title="${t('k8s.logs.load')}" aria-label="${t('k8s.logs.load')}" ${canLoad ? '' : 'disabled'}>${state.logsLoading ? '<span class="kubernetes-spinner-mini kubernetes-refresh-spinner"></span>' : renderKubernetesIcon('refresh', 16)}</button>
        <button type="button" id="downloadKubernetesLogs" class="kubernetes-log-bar-btn" title="${t('k8s.logs.download')}" aria-label="${t('k8s.logs.download')}" ${hasLogs ? '' : 'disabled'}>${renderKubernetesIcon('download', 16)}</button>
        <div class="kubernetes-log-options-wrap">
          <button type="button" id="toggleKubernetesLogOptions" class="kubernetes-log-bar-btn ${this.logDisplayOptionsOpen ? 'active' : ''}" title="${t('k8s.logs.displayOptions')}" aria-label="${t('k8s.logs.displayOptions')}">${renderKubernetesIcon('sliders', 16)}</button>
          ${this.logDisplayOptionsOpen ? this.renderLogDisplayOptions() : ''}
        </div>
        <button type="button" id="clearKubernetesLogs" class="kubernetes-log-bar-btn danger" title="${t('k8s.logs.clear')}" aria-label="${t('k8s.logs.clear')}" ${state.podLogs ? '' : 'disabled'}>${renderKubernetesIcon('trash', 16)}</button>
      </div>
      ${state.logsError ? `<div class="kubernetes-session-error compact" role="alert"><strong>${t('k8s.logs.loadFailed')}</strong><span>${escapeHtml(state.logsError)}</span></div>` : ''}
      ${state.logsTruncated ? `<div class="kubernetes-log-truncated" role="status">${t('k8s.logs.truncated')}</div>` : ''}
      ${state.podLogs ? `<div class="kubernetes-log-output-wrap">
        <div id="kubernetesLogOutput" class="kubernetes-log-output ${this.logLineWrap ? 'wrap' : ''}" data-count="${logs.length}" tabindex="0" role="log">${this.renderLogLines(logs)}</div>
        <button type="button" id="kubernetesLogJump" class="kubernetes-log-jump no-drag" hidden>${renderKubernetesIcon('arrowDown', 13)}<span class="kubernetes-log-jump-count">0</span><span>${t('k8s.logs.jumpLatest')}</span></button>
      </div>` : `<div class="kubernetes-log-empty">${state.logsLoading ? t('k8s.logs.reading') : t('k8s.logs.selectContainer')}</div>`}
    </div>`;
  }

  // 將可見 log 逐行結構化：行號 gutter ＋ 等級彩色標籤 ＋ 時間戳染色 ＋ 搜尋高亮。
  // 分級沿用 logLevelForLine()；時間戳僅在行首為 RFC3339 樣式時染色（off/utc 模式），
  // local 模式已被 formatLogTimestamp 改寫，會落回不染色但仍完整顯示。
  renderLogLines(lines) {
    const LEVEL_LABEL = { error: 'ERROR', warning: 'WARN', debug: 'DEBUG', info: 'INFO' };
    return lines.map((line, index) => {
      const level = logLevelForLine(line);
      const tsMatch = String(line).match(/^(\d{4}[-/]\d{2}[-/]\d{2}[T ][^\s]+)(\s+)([\s\S]*)$/);
      const message = tsMatch ? tsMatch[3] : line;
      const tsHtml = tsMatch ? `<span class="kubernetes-log-ts">${escapeHtml(tsMatch[1])}</span>${escapeHtml(tsMatch[2])}` : '';
      return `<div class="kubernetes-log-line kubernetes-log-line--${level}">`
        + `<span class="kubernetes-log-gutter" aria-hidden="true">${index + 1}</span>`
        + `<span class="kubernetes-log-dot kubernetes-log-dot--${level}" title="${LEVEL_LABEL[level]}"></span>`
        + `<span class="kubernetes-log-msg">${tsHtml}${this.highlightLogSearch(message)}</span>`
        + `</div>`;
    }).join('');
  }

  // 於訊息中高亮搜尋命中（支援 regex 開關）；先跳脫再包 <mark>，避免 XSS 與零長度死迴圈。
  highlightLogSearch(text) {
    const str = String(text);
    const query = this.logSearch.trim();
    if (!query) return escapeHtml(str);
    let regex;
    try {
      const source = this.logRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      regex = new RegExp(source, 'ig');
    } catch {
      return escapeHtml(str);
    }
    let out = '';
    let last = 0;
    let match;
    while ((match = regex.exec(str)) !== null) {
      if (match[0].length === 0) {
        regex.lastIndex += 1;
        continue;
      }
      out += escapeHtml(str.slice(last, match.index));
      out += `<mark class="kubernetes-log-mark">${escapeHtml(match[0])}</mark>`;
      last = match.index + match[0].length;
    }
    out += escapeHtml(str.slice(last));
    return out;
  }

  // 綁定 log 輸出捲動：使用者離開底部時停止自動跟隨並累計未讀新行；回到底部即清零。
  // 於 setupListeners 末端呼叫（每次重繪後 output 皆為新元素，舊監聽隨舊元素回收）。
  bindLogOutput() {
    const output = this.querySelector('#kubernetesLogOutput');
    if (!output) {
      this.logLineCount = 0;
      return;
    }
    const count = Number(output.dataset.count || 0);
    if (!this.logStickBottom && count > this.logLineCount) {
      this.logNewLines += count - this.logLineCount;
    }
    this.logLineCount = count;
    output.addEventListener('scroll', () => {
      const atBottom = output.scrollHeight - output.scrollTop - output.clientHeight < 24;
      this.logStickBottom = atBottom;
      if (atBottom) this.logNewLines = 0;
      this.updateLogJump();
    });
    const jump = this.querySelector('#kubernetesLogJump');
    jump?.addEventListener('click', () => {
      output.scrollTop = output.scrollHeight;
      this.logStickBottom = true;
      this.logNewLines = 0;
      this.updateLogJump();
    });
    if (this.logStickBottom) {
      output.scrollTop = output.scrollHeight;
      this.logNewLines = 0;
    }
    this.updateLogJump();
  }

  updateLogJump() {
    const jump = this.querySelector('#kubernetesLogJump');
    if (!jump) return;
    if (this.logNewLines > 0 && !this.logStickBottom) {
      jump.hidden = false;
      const badge = jump.querySelector('.kubernetes-log-jump-count');
      if (badge) badge.textContent = String(this.logNewLines);
    } else {
      jump.hidden = true;
    }
  }

  renderLogDisplayOptions() {
    return `<div class="kubernetes-log-options-menu no-drag" role="menu">
      <strong>${t('k8s.logs.loadHeading')}</strong>
      <label class="kubernetes-log-opt-field"><span>${t('k8s.logs.tailLines')}</span><input id="kubernetesLogTailLines" class="no-drag" type="number" min="1" max="1000" value="${escapeHtml(this.logTailLines)}"></label>
      <label><input id="kubernetesLogPrevious" class="no-drag" type="checkbox" ${this.logPreviousLogs ? 'checked' : ''}>${t('k8s.logs.previous')}</label>
      <strong>${t('k8s.logs.displayOptionsHeading')}</strong>
      <label><input id="kubernetesLogLineWrap" class="no-drag" type="checkbox" ${this.logLineWrap ? 'checked' : ''}>${t('k8s.logs.lineWrap')}</label>
      <strong>${t('k8s.logs.timestamp')}</strong>
      <div class="kubernetes-log-timestamp-options">
        ${['off', 'utc', 'local'].map(mode => `<button type="button" class="no-drag ${this.logTimestampMode === mode ? 'active' : ''}" data-log-timestamp="${mode}">${mode === 'off' ? t('k8s.logs.timestampOff') : mode.toUpperCase()}</button>`).join('')}
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

  // 下載目前可見 log：WKWebView 對 <a download> 支援不佳（按了沒反應），
  // 改走後端 Wails 原生存檔對話框，讓使用者選擇儲存位置後寫檔。
  async downloadVisiblePodLogs() {
    const state = kubernetesSessionStore.getState();
    const content = this.visiblePodLogs(state.podLogs || '').join('\n');
    if (!content) return;
    const podName = state.selectedResource?.name || 'pod';
    const namespace = state.selectedResource?.namespace || state.logOptions?.namespace || 'default';
    try {
      const path = await KubernetesAPI.savePodLogs(`${namespace}-${podName}-logs.log`, content);
      // 空路徑＝使用者取消對話框，不視為錯誤、不提示。
      if (path) showToast(t('k8s.logs.saved'), { type: 'success' });
    } catch {
      showToast(t('k8s.logs.saveFailed'), { type: 'error' });
    }
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
      return `<section class="kubernetes-detail-section kubernetes-pod-yaml"><header><h3>YAML</h3></header><div class="kubernetes-resource-empty">${t('k8s.yaml.empty')}</div></section>`;
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
      <button type="button" id="toggleKubernetesYAMLSearch" class="no-drag kubernetes-icon-btn ${this.yamlSearchOpen ? 'active' : ''}" title="${t('k8s.yaml.search')}" aria-label="${t('k8s.yaml.search')}" ${editing ? 'disabled' : ''}>${renderKubernetesIcon('search', 20)}</button>
      <button type="button" id="editKubernetesYAML" class="no-drag kubernetes-icon-btn ${editing ? 'active' : ''}" title="${editDisabled ? t('k8s.yaml.editDisabledHint') : t('k8s.yaml.edit')}" aria-label="${t('k8s.yaml.edit')}" ${editDisabled ? 'disabled' : ''}>${renderKubernetesIcon('edit', 20)}</button>
      <button type="button" id="copyKubernetesYAML" class="no-drag kubernetes-icon-btn" title="${t('k8s.yaml.copy')}" aria-label="${t('k8s.yaml.copy')}">${renderKubernetesIcon('copy', 20)}</button>
    </div>`;

    const searchBox = (this.yamlSearchOpen && !editing)
      ? `<div class="kubernetes-yaml-search no-drag"><span class="kubernetes-yaml-search-icon" aria-hidden="true">${renderKubernetesIcon('search', 14)}</span><input id="kubernetesYAMLSearch" class="no-drag" value="${escapeHtml(this.yamlSearchTerm)}" placeholder="${t('k8s.yaml.searchPlaceholder')}"></div>`
      : '';

    const body = editing
      ? `${state.updateError ? `<div class="kubernetes-session-error compact" role="alert"><strong>${t('k8s.yaml.applyFailed')}</strong><span>${escapeHtml(state.updateError)}</span><button type="button" id="reloadKubernetesResourceYAML" class="no-drag kubernetes-secondary-btn" ${state.updateLoading ? 'disabled' : ''}>${t('k8s.yaml.reloadLatest')}</button></div>` : ''}
        <textarea id="kubernetesYAMLEditor" class="no-drag kubernetes-yaml-editor" spellcheck="false" autocapitalize="off" autocomplete="off" ${state.updateLoading ? 'readonly' : ''}>${escapeHtml(draft)}</textarea>
        <div class="kubernetes-yaml-edit-actions">
          <button type="button" id="applyKubernetesYAML" class="no-drag kubernetes-primary-btn" title="${t('k8s.yaml.apply')}" aria-label="${t('k8s.yaml.apply')}" ${state.updateLoading ? 'disabled' : ''}>${renderKubernetesIcon('check', 14)}<span>${state.updateLoading ? t('k8s.yaml.applying') : t('k8s.yaml.apply')}</span></button>
          <button type="button" id="cancelKubernetesYAML" class="no-drag kubernetes-secondary-btn" title="${t('k8s.yaml.cancel')}" aria-label="${t('k8s.yaml.cancel')}" ${state.updateLoading ? 'disabled' : ''}>${renderKubernetesIcon('close', 14)}<span>${t('k8s.yaml.cancel')}</span></button>
        </div>`
      : `${editDisabled ? `<div class="kubernetes-yaml-readonly-hint" role="status">${t('k8s.yaml.readonlyHint')}</div>` : ''}
        <pre class="kubernetes-yaml-output" tabindex="0"><code>${viewHtml}</code></pre>`;

    return `<section class="kubernetes-detail-section kubernetes-pod-yaml kubernetes-detail-yaml"><header><h3>YAML</h3>${toolbar}</header>
      ${searchBox}
      ${body}
    </section>`;
  }

  // 建議的本機埠：特權埠（<1024）自動 +8000（80→8080、443→8443），其餘沿用原埠，
  // 避免綁定特權埠失敗，同時給出好記的預設值。使用者仍可用 Custom 自訂。
  forwardSuggestedLocalPort(remotePort) {
    const p = Number(remotePort);
    if (!Number.isInteger(p) || p <= 0) return p;
    return p < 1024 ? p + 8000 : p;
  }

  // 由 startedAt（RFC3339）算出運行時間字串，如 45s / 1m 23s / 2h 5m。無效則回空字串。
  formatForwardUptime(startedAt) {
    const ts = Date.parse(startedAt || '');
    if (!Number.isFinite(ts)) return '';
    let secs = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    const h = Math.floor(secs / 3600); secs -= h * 3600;
    const m = Math.floor(secs / 60); const s = secs - m * 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }

  // 在系統預設瀏覽器開啟轉發位址（透過 platform facade，內部使用 Wails BrowserOpenURL）。
  openForwardUrl(url) {
    openBrowserURL(url);
  }

  // 複製轉發的本機位址（localhost:port）到剪貼簿並提示。
  copyForwardAddress(addr) {
    const value = String(addr || '').trim();
    if (!value) return;
    const notify = () => showToast(t('k8s.forward.copied', { addr: value }), { type: 'success' });
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard.writeText(value).then(notify).catch(() => {});
    }
  }

  // Active Forwards 卡片（Pod / Service 共用）：狀態點 + 運行時間 + Open / Copy / Stop。
  renderForwardActive(state, kind) {
    const forwards = Array.isArray(state.podForwards) ? state.podForwards : [];
    if (!forwards.length) {
      return `<div class="kubernetes-forward-empty">${state.forwardsLoading ? t('k8s.forward.updating') : t('k8s.forward.noActive')}</div>`;
    }
    const targetPrefix = kind === 'service' ? 'svc' : 'pod';
    return `<div class="kubernetes-active-forwards">${forwards.map(item => {
      const addr = `${item.address}:${item.localPort}`;
      const uptime = this.formatForwardUptime(item.startedAt);
      return `<div class="kubernetes-forward-row">
        <span class="kubernetes-forward-dot live" aria-hidden="true"></span>
        <code class="kubernetes-forward-map">${escapeHtml(item.address)}:<b>${item.localPort}</b> → ${targetPrefix}:${item.remotePort}</code>
        ${uptime ? `<span class="kubernetes-forward-uptime">· ${t('k8s.forward.uptime', { time: uptime })}</span>` : ''}
        <span class="kubernetes-forward-spring"></span>
        <div class="kubernetes-forward-row-actions">
          <button type="button" class="no-drag kubernetes-forward-iconbtn open-kubernetes-forward" data-forward-url="http://${escapeHtml(addr)}" title="${t('k8s.forward.open')}" aria-label="${t('k8s.forward.open')}">${renderKubernetesIcon('external', 15)}</button>
          <button type="button" class="no-drag kubernetes-forward-iconbtn copy-kubernetes-forward" data-forward-addr="${escapeHtml(addr)}" title="${t('k8s.forward.copy')}" aria-label="${t('k8s.forward.copy')}">${renderKubernetesIcon('copy', 15)}</button>
          <button type="button" class="no-drag kubernetes-forward-iconbtn danger stop-kubernetes-forward" data-forward-id="${escapeHtml(item.id)}" title="${t('k8s.forward.stop')}" aria-label="${t('k8s.forward.stop')}" ${state.forwardsLoading ? 'disabled' : ''}>${renderKubernetesIcon('stop', 15)}</button>
        </div>
      </div>`;
    }).join('')}</div>`;
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
    const cards = ports.map(port => {
      const local = this.forwardSuggestedLocalPort(port.port);
      const label = escapeHtml(port.name || port.container || t('k8s.forward.portLabel', { port: port.port }));
      return `<div class="kubernetes-forward-row"><span class="kubernetes-forward-dot" aria-hidden="true"></span><span class="kubernetes-forward-name">${label}</span><span class="kubernetes-forward-badge">${port.port}/${escapeHtml(port.protocol || 'TCP')}</span><span class="kubernetes-forward-map">localhost:<b>${local}</b> → pod:${port.port}</span><span class="kubernetes-forward-spring"></span><button type="button" class="no-drag kubernetes-forward-go start-kubernetes-forward" data-local-port="${local}" data-remote-port="${port.port}" ${state.forwardsLoading ? 'disabled' : ''}>${t('k8s.forward.forward')}</button></div>`;
    }).join('');
    return `<section class="kubernetes-detail-section kubernetes-pod-forward"><h3>${t('k8s.forward.title')}</h3>
      ${state.forwardsError ? `<div class="kubernetes-session-error compact" role="alert"><strong>${t('k8s.forward.operationFailed')}</strong><span>${escapeHtml(state.forwardsError)}</span></div>` : ''}
      <div class="kubernetes-forward-subhead">${t('k8s.forward.suggested')}</div>
      <div class="kubernetes-forward-list">${cards}</div>
      ${ports.length ? '' : `<p class="kubernetes-forward-empty">${t('k8s.forward.noContainerPort')}</p>`}
      <div class="kubernetes-forward-subhead">${t('k8s.forward.custom')}</div>
      <div class="kubernetes-forward-custom">
        <div class="kubernetes-forward-custombar">
          <span class="kubernetes-forward-cseg">localhost:<input id="kubernetesForwardCustomLocal" class="no-drag" type="number" min="0" max="65535" placeholder="${t('k8s.forward.autoPort')}"></span>
          <span class="kubernetes-forward-cseg">pod:<input id="kubernetesForwardCustomRemote" class="no-drag" type="number" min="1" max="65535" placeholder="${t('k8s.forward.portPlaceholder')}"></span>
        </div>
        <button type="button" id="startKubernetesCustomForward" class="no-drag kubernetes-forward-go ghost" ${state.forwardsLoading ? 'disabled' : ''}>${t('k8s.forward.createCustom')}</button>
      </div>
      <p class="kubernetes-forward-hint"><span class="kubernetes-forward-hint-icon" aria-hidden="true">ⓘ</span> ${t('k8s.forward.portConflictHint')}</p>
      <h3>${t('k8s.forward.active')}</h3>
      ${this.renderForwardActive(state, 'pod')}
    </section>`;
  }

  // Service 版 Port Forward：以 Service 的連接埠清單（selected.portNumbers）為預設，
  // 後端會把 Service port 解析成後端 Pod 的 targetPort 再轉發。停止沿用 pod 的 stop 流程。
  renderServiceForward(selected, state) {
    const ports = [];
    for (const value of Array.isArray(selected.portNumbers) ? selected.portNumbers : []) {
      const num = Number(value);
      if (Number.isInteger(num) && num > 0 && !ports.includes(num)) ports.push(num);
    }
    const cards = ports.map(port => {
      const local = this.forwardSuggestedLocalPort(port);
      return `<div class="kubernetes-forward-row"><span class="kubernetes-forward-dot" aria-hidden="true"></span><span class="kubernetes-forward-name">${t('k8s.forward.servicePortLabel', { port })}</span><span class="kubernetes-forward-badge">${port}/TCP</span><span class="kubernetes-forward-map">localhost:<b>${local}</b> → svc:${port}</span><span class="kubernetes-forward-spring"></span><button type="button" class="no-drag kubernetes-forward-go start-kubernetes-service-forward" data-local-port="${local}" data-remote-port="${port}" ${state.forwardsLoading ? 'disabled' : ''}>${t('k8s.forward.forward')}</button></div>`;
    }).join('');
    return `<section class="kubernetes-detail-section kubernetes-pod-forward"><h3>${t('k8s.forward.title')}</h3>
      ${state.forwardsError ? `<div class="kubernetes-session-error compact" role="alert"><strong>${t('k8s.forward.operationFailed')}</strong><span>${escapeHtml(state.forwardsError)}</span></div>` : ''}
      <div class="kubernetes-forward-subhead">${t('k8s.forward.suggested')}</div>
      <div class="kubernetes-forward-list">${cards}</div>
      ${ports.length ? '' : `<p class="kubernetes-forward-empty">${t('k8s.forward.noServicePort')}</p>`}
      <div class="kubernetes-forward-subhead">${t('k8s.forward.custom')}</div>
      <div class="kubernetes-forward-custom">
        <div class="kubernetes-forward-custombar">
          <span class="kubernetes-forward-cseg">localhost:<input id="kubernetesServiceForwardCustomLocal" class="no-drag" type="number" min="0" max="65535" placeholder="${t('k8s.forward.autoPort')}"></span>
          <span class="kubernetes-forward-cseg">svc:<input id="kubernetesServiceForwardCustomRemote" class="no-drag" type="number" min="1" max="65535" placeholder="${t('k8s.forward.portPlaceholder')}"></span>
        </div>
        <button type="button" id="startKubernetesServiceCustomForward" class="no-drag kubernetes-forward-go ghost" ${state.forwardsLoading ? 'disabled' : ''}>${t('k8s.forward.createCustom')}</button>
      </div>
      <p class="kubernetes-forward-hint"><span class="kubernetes-forward-hint-icon" aria-hidden="true">ⓘ</span> ${t('k8s.forward.portConflictHint')}</p>
      <h3>${t('k8s.forward.active')}</h3>
      ${this.renderForwardActive(state, 'service')}
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
        ${state.deleteError ? `<div class="kubernetes-session-error compact" role="alert"><strong>${t('k8s.delete.failed', { kind: escapeHtml(kind) })}</strong><span>${escapeHtml(state.deleteError)}</span></div>` : ''}
        <div class="kubernetes-delete-highrisk">
          <strong>${t('k8s.delete.deleteLabel', { id: escapeHtml(fullId) })}</strong>
          <small>${t('k8s.delete.highRiskHint', { name: `<code>${escapeHtml(name)}</code>` })}</small>
          <input type="text" id="kubernetesDeleteConfirmInput" class="no-drag" autocomplete="off" spellcheck="false" placeholder="${t('k8s.delete.confirmPlaceholder')}" value="${escapeHtml(typed)}" ${state.deleteLoading ? 'disabled' : ''}>
          <button type="button" id="deleteKubernetesResource" class="no-drag kubernetes-danger-btn" ${(state.deleteLoading || !matched) ? 'disabled' : ''}>${state.deleteLoading ? t('k8s.delete.deleting') : t('k8s.delete.confirm')}</button>
        </div>
      </section>`;
    }

    // 低風險 kind：兩段點擊確認，確認階段由 this.pendingDeleteConfirm 決定（狀態驅動，
    // 重繪不會重置）。第一次點擊後按鈕改為「確認刪除 X？」並套用 confirm-stage 樣式。
    const confirming = this.pendingDeleteConfirm === true;
    const buttonLabel = state.deleteLoading
      ? t('k8s.delete.deleting')
      : (confirming ? t('k8s.delete.confirmDelete', { id: escapeHtml(fullId) }) : t('k8s.delete.delete'));
    return `<section class="kubernetes-detail-section kubernetes-pod-delete">
      ${state.deleteError ? `<div class="kubernetes-session-error compact" role="alert"><strong>${t('k8s.delete.failed', { kind: escapeHtml(kind) })}</strong><span>${escapeHtml(state.deleteError)}</span></div>` : ''}
      <div><span><strong>${t('k8s.delete.deleteLabel', { id: escapeHtml(fullId) })}</strong><small>${t('k8s.delete.lowRiskHint')}</small></span><button type="button" id="deleteKubernetesResource" class="no-drag kubernetes-danger-btn ${confirming ? 'confirm-stage' : ''}" ${state.deleteLoading ? 'disabled' : ''}>${buttonLabel}</button></div>
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
        <header><h2 id="kubernetesCreateResourceTitle">${t('k8s.create.title')}</h2><button type="button" class="kubernetes-drawer-close no-drag" aria-label="${t('k8s.create.closeAria')}">${renderKubernetesIcon('close', 22)}</button></header>
        <div class="kubernetes-create-toolbar">
          <div class="kubernetes-create-actions"><button type="button" id="applyKubernetesResource" class="no-drag kubernetes-primary-btn" ${state.createLoading || state.createSaving ? 'disabled' : ''}>${state.createLoading ? t('k8s.create.applying') : t('k8s.create.apply')}</button><button type="button" id="saveKubernetesResourceYAML" class="no-drag kubernetes-secondary-btn" ${state.createLoading || state.createSaving ? 'disabled' : ''}>${state.createSaving ? t('k8s.create.saving') : t('k8s.create.save')}</button></div>
          <label><span class="kubernetes-visually-hidden">${t('k8s.create.resourceType')}</span><select id="kubernetesCreateResourceType" class="no-drag" ${state.createLoading || state.createSaving ? 'disabled' : ''}>${KUBERNETES_CREATE_RESOURCE_GROUPS.map(([group, types]) => `<optgroup label="${escapeHtml(group)}">${types.map(type => `<option value="${type}" ${type === state.createResourceType ? 'selected' : ''}>${type}</option>`).join('')}</optgroup>`).join('')}</select></label>
        </div>
        ${state.createError || state.createSaveError ? `<div class="kubernetes-session-error compact kubernetes-create-error" role="alert"><strong>${t('k8s.create.operationFailed')}</strong><span>${escapeHtml(state.createError || state.createSaveError)}</span></div>` : ''}
        ${state.createSavedPath && !hasUnsavedChanges ? `<div class="kubernetes-create-saved" role="status">${t('k8s.create.savedTo')}<code>${escapeHtml(state.createSavedPath)}</code></div>` : ''}
        <div class="kubernetes-create-editor">
          <pre id="kubernetesCreateLineNumbers" aria-hidden="true">${Array.from({ length: lineCount }, (_, index) => index + 1).join('\n')}</pre>
          <textarea id="kubernetesCreateYAML" class="no-drag" aria-label="${t('k8s.create.yamlAria')}" spellcheck="false" autocapitalize="off" autocomplete="off" ${state.createLoading ? 'readonly' : ''}>${escapeHtml(content)}</textarea>
        </div>
      </aside>`;
  }

  render() {
    const state = kubernetesSessionStore.getState();
    const cluster = state.connectedCluster;
    if (!cluster) {
      this.innerHTML = `<div class="kubernetes-session-empty"><div class="kubernetes-empty-icon">K8s</div><h1>${t('k8s.session.notConnectedTitle')}</h1><p>${t('k8s.session.notConnectedDetail')}</p></div>`;
      return;
    }

    const dashboard = state.dashboard;
    const namespace = state.selectedNamespace || cluster.namespace || 'default';
    const activeSection = state.activeSection || 'overview';
    const clusterName = cluster.displayName || cluster.clusterName || cluster.contextName;
    const namespaces = Array.from(new Set(['*', ...(state.namespaces || []), namespace])).filter(Boolean);
    const sectionTitle = activeSection === FAVORITES_SECTION
      ? t('k8s.nav.favorites')
      : (SECTIONS.find(([id]) => id === activeSection)?.[1] || 'Overview');
    const namespaceControl = this.renderNamespaceMultiSelect(state, namespaces);
    let content = '';
    if (state.podActionView) {
      content = this.renderPodActionView(state);
    } else
    if (state.dashboardLoading && !dashboard) {
      content = `<div class="kubernetes-session-loading" role="status" aria-live="polite"><span class="kubernetes-spinner" aria-hidden="true"></span><h2>${t('k8s.session.loadingApi')}</h2></div>`;
    } else if (state.dashboardError && !dashboard) {
      content = `<div class="kubernetes-session-error" role="alert"><strong>${dashboardErrorTitle(state.dashboardError)}</strong><span>${escapeHtml(state.dashboardError)}</span></div>`;
    } else if (dashboard) {
      // 首屏 core scope（dashboard.partial）只含核心 section 資料；使用者若在 full 補齊前切到
      // 非核心 section，顯示載入中而非誤導的「沒有資源」。full 到齊後 partial 為 false，恢復正常。
      if (activeSection === FAVORITES_SECTION) {
        content = this.renderFavoriteResources(dashboard, state);
      } else if (dashboard.partial && !CORE_SECTIONS.has(activeSection)) {
        content = `<div class="kubernetes-session-loading" role="status" aria-live="polite"><span class="kubernetes-spinner" aria-hidden="true"></span><h2>${t('k8s.session.loadingApi')}</h2></div>`;
      } else {
        content = activeSection === 'overview' ? this.renderOverview(dashboard) : this.renderResourceTable(activeSection, dashboard);
      }
    }

    this.innerHTML = `
      <div class="kubernetes-session-layout no-drag">
        <aside class="kubernetes-session-nav">
          <div class="kubernetes-session-cluster"><span class="kubernetes-session-status" aria-hidden="true"></span><span class="kubernetes-visually-hidden">${t('k8s.session.connected')}</span><div class="kubernetes-session-cluster-meta"><strong>${escapeHtml(clusterName)}</strong><small title="${escapeHtml(cluster.contextName || '')}">${escapeHtml(cluster.contextName || '')}</small></div><i class="ti ti-cloud kubernetes-session-cluster-icon" aria-hidden="true"></i></div>
          ${namespaceControl}
          <nav aria-label="${t('k8s.session.navAria')}">${(() => {
            const pins = [...this.quickAccessSections].map(pid => SECTIONS.find(([sid]) => sid === pid)).filter(Boolean);
            const favorites = this.currentClusterFavorites(cluster);
            const quickAccessCollapsed = this.collapsedNavGroups.has(QUICK_ACCESS_GROUP);
            return `${this.renderFavoritesNavLink(activeSection, favorites.length)}${pins.length ? `<div class="kubernetes-nav-group kubernetes-nav-quick ${quickAccessCollapsed ? 'collapsed' : ''}"><button type="button" class="no-drag kubernetes-nav-heading kubernetes-nav-quick-heading" data-nav-group="${QUICK_ACCESS_GROUP}" aria-expanded="${quickAccessCollapsed ? 'false' : 'true'}"><span><i class="ti ti-star" aria-hidden="true"></i>${t('k8s.nav.quickAccess')}</span><svg class="kubernetes-nav-caret" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button><div class="kubernetes-nav-items">${pins.map(([id, label]) => this.renderNavLink(id, label, activeSection)).join('')}</div></div>` : ''}`;
          })()}${SECTION_GROUPS.map(([group, sections]) => `<div class="kubernetes-nav-group ${this.collapsedNavGroups.has(group) ? 'collapsed' : ''}"><button type="button" class="no-drag kubernetes-nav-heading" data-nav-group="${escapeHtml(group)}" aria-expanded="${this.collapsedNavGroups.has(group) ? 'false' : 'true'}"><span>${group}</span><svg class="kubernetes-nav-caret" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button><div class="kubernetes-nav-items">${sections.map(([id, label]) => this.renderNavLink(id, label, activeSection)).join('')}</div></div>`).join('')}</nav>
        </aside>
        <main class="kubernetes-session-content">
          ${state.podActionView ? '' : `<header class="kubernetes-session-header"><div><span>${t('k8s.session.label')}</span><h1>${escapeHtml(sectionTitle)}</h1><p>${escapeHtml(cluster.server || cluster.clusterName || cluster.contextName)}${dashboard?.serverVersion ? ` · ${escapeHtml(dashboard.serverVersion)}` : ''}</p></div><div class="kubernetes-session-actions"><button type="button" id="openKubernetesCreateResource" class="no-drag kubernetes-primary-btn">${t('k8s.session.createResource')}</button></div></header>`}
          <div class="kubernetes-session-scrollbody${!state.podActionView && this.selectedRows.size ? ' has-selection-bar' : ''}">
          ${state.dashboardError && dashboard ? `<div class="kubernetes-session-error compact" role="status"><strong>${dashboardErrorTitle(state.dashboardError, true)}</strong><span>${escapeHtml(state.dashboardError)}</span></div>` : ''}
          ${content}
          </div>
          ${state.podActionView ? '' : this.renderSelectionBar()}
        </main>
        ${this.renderDetailDrawer(state)}
        ${this.renderCreateDrawer(state)}
        ${this.renderEventDrawer()}
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
    // 多選改為「草稿模式」：勾選期間只更新本地草稿，不重載 dashboard；
    // 待關閉下拉（選擇完畢）時才一次套用（commitNamespaceDraft），避免每勾一次就重載造成卡頓。
    this.querySelector('[data-namespace-all]')?.addEventListener('change', (event) => {
      this.markNamespaceSelectInteracting(true);
      if (event.target.checked) {
        this.namespaceDraft = [];
        this.querySelectorAll('[data-namespace-option]').forEach(cb => { cb.checked = false; });
      } else {
        // 空選即代表 All，不允許把 All 取消成「什麼都沒選」，維持勾選。
        event.target.checked = true;
      }
    });
    this.bindNamespaceOptionListeners();
    // 搜尋框：即時過濾 namespace，只重繪選項容器（不整頁重繪），輸入框本身不被替換故焦點不失。
    this.querySelector('#kubernetesNamespaceFilter')?.addEventListener('input', (event) => {
      this.markNamespaceSelectInteracting(true);
      this.namespaceFilter = event.target.value;
      const container = this.querySelector('#kubernetesNamespaceOptions');
      if (!container) return;
      const selected = kubernetesSessionStore.getState().selectedNamespaces || [];
      container.innerHTML = this.renderNamespaceOptionsHtml(this._nsSpecific || [], new Set(selected), '');
      this.bindNamespaceOptionListeners();
    });

    this.querySelector('#refreshKubernetesSection')?.addEventListener('click', () => this.runManualRefresh());
    this.querySelector('#refreshKubernetesPods')?.addEventListener('click', () => this.runManualRefresh());
    this.querySelectorAll('[data-pod-filter]').forEach(button => button.addEventListener('click', () => {
      this.podFilter = button.dataset.podFilter;
      this.render();
      this.setupListeners();
    }));
    // 「檢視關聯 Pods」按鈕（列表 hover 圖示 + 抽屜 CTA 共用）：阻止冒泡（避免觸發列開啟），跳轉並過濾。
    this.querySelectorAll('[data-view-pods]').forEach(button => button.addEventListener('click', event => {
      event.stopPropagation();
      this.jumpToRelatedPods(button.dataset.viewPods);
    }));
    // 清除 label 過濾 chip：歸零 podLabelFilter 後就地重繪。
    this.querySelector('[data-clear-pod-filter]')?.addEventListener('click', () => {
      this.podLabelFilter = null;
      this.render();
      this.setupListeners();
    });
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
    // Events 搜尋：更新搜尋詞後重繪，並 refocus + 還原游標位置（同 section search 做法）。
    this.querySelector('#kubernetesEventsSearch')?.addEventListener('input', event => {
      this.eventsSearch = event.target.value;
      const cursor = event.target.selectionStart;
      this.render();
      this.setupListeners();
      const replacement = this.querySelector('#kubernetesEventsSearch');
      replacement?.focus();
      replacement?.setSelectionRange(cursor, cursor);
    });
    // Events 列點擊 / Enter / Space：解析列上序列化事件並開啟 Drawer 看完整內容。
    this.querySelectorAll('[data-event-row]').forEach(row => {
      const open = () => {
        try {
          this.openEventDrawer(JSON.parse(decodeURIComponent(row.dataset.event)));
        } catch (error) {
          console.error('[Kubernetes][UI][Events] 解析事件資料失敗', error);
        }
      };
      row.addEventListener('click', open);
      row.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        open();
      });
    });
    // Events Drawer 關閉鈕 / backdrop。
    this.querySelector('.kubernetes-event-drawer .kubernetes-drawer-close')?.addEventListener('click', () => this.closeEventDrawer());
    this.querySelector('[data-close-event="true"]')?.addEventListener('click', () => this.closeEventDrawer());
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
      if (button.dataset.podAction === 'shell') this.openPodShellSession(pod, button.dataset.container);
      if (button.dataset.podAction === 'forward') store.openPodForwardFromSummary(pod).catch(() => {});
    }));
    // Service 列表的 Forward action：開啟 detail drawer 的 Forward 頁籤。
    this.querySelectorAll('[data-service-action="forward"]').forEach(button => button.addEventListener('click', event => {
      event.stopPropagation();
      const service = JSON.parse(decodeURIComponent(button.dataset.service));
      kubernetesSessionStore.getState().openServiceForwardFromSummary(service).catch(() => {});
    }));
    this.querySelector('#closeKubernetesPodAction')?.addEventListener('click', () => {
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
      button.addEventListener('click', () => {
        // 手動切換區段一律清除「檢視關聯 Pods」的 label 過濾（含點回 Pods 本身），避免殘留。
        this.podLabelFilter = null;
        // 切換 section 清空多選（避免跨資源類型誤刪）。
        this.clearSelection();
        kubernetesSessionStore.getState().selectSection(button.dataset.section);
      });
    });
    this.querySelectorAll('.kubernetes-nav-star').forEach((star) => {
      star.addEventListener('click', (event) => {
        event.stopPropagation();
        this.toggleQuickAccess(star.dataset.star);
      });
    });
    // 工作負載我的最愛：獨立於 Quick access（後者收藏的是區段），避免點星號觸發列的 Detail Drawer。
    this.querySelectorAll('[data-toggle-resource-favorite]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        this.toggleFavoriteResource(button.dataset.toggleResourceFavorite);
      });
    });
    // 我的最愛頁面點列：先切換 namespace 與資源區段，再開啟相同 Kubernetes Session 內的 Detail Drawer。
    this.querySelectorAll('[data-open-resource-favorite]').forEach((row) => {
      const open = async () => {
        let favorite;
        try { favorite = JSON.parse(decodeURIComponent(row.dataset.openResourceFavorite)); } catch { return; }
        if (!favorite?.name || !FAVORITABLE_SECTIONS.has(favorite.section)) return;
        const store = kubernetesSessionStore.getState();
        this.clearSelection();
        this.podLabelFilter = null;
        await store.selectNamespace(favorite.namespace || '*');
        store.selectSection(favorite.section);
        await store.openResource(favorite.kind, {
          name: favorite.name,
          namespace: favorite.namespace,
          apiVersion: favorite.apiVersion
        });
      };
      row.addEventListener('click', () => { open().catch(() => {}); });
      row.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        open().catch(() => {});
      });
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
    // 多選：注入勾選欄並綁定；工具列選取區的清除 / 批量刪除鍵。
    this.enhanceSelectionColumns();
    this.querySelector('#kubernetesClearSelection')?.addEventListener('click', () => {
      this.clearSelectionUI();
    });
    this.querySelector('#kubernetesBulkDelete')?.addEventListener('click', () => {
      this.handleBulkDelete().catch(error => console.error('[Kubernetes][UI][BulkDelete] 失敗', error));
    });
    // 調整副本數：列尾 / drawer 的 Scale 鈕 → 開步進器對話框（stopPropagation 避免開 detail drawer）。
    this.querySelectorAll('[data-scale]').forEach(btn => btn.addEventListener('click', event => {
      event.stopPropagation();
      try { this.openScaleDialog(JSON.parse(decodeURIComponent(btn.dataset.scale))); } catch (_) { /* noop */ }
    }));
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
      if (hasUnsavedChanges && !(await confirmDialog(t('k8s.guard.switchTypeMessage'), { title: t('k8s.guard.switchTypeTitle'), danger: true }))) {
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
      const clusterLabel = applyCluster.displayName || applyCluster.clusterName || applyCluster.contextName || t('k8s.cluster.unknown');
      const namespaceLabel = applyState.selectedNamespace || applyCluster.namespace || 'default';
      if (!(await confirmDialog(t('k8s.apply.confirmCreateMessage', { cluster: clusterLabel, namespace: namespaceLabel }), { title: t('k8s.apply.confirmTitle'), danger: true }))) {
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
      kubernetesSessionStore.getState().loadPodLogs({ container, previous: this.logPreviousLogs, tailLines: this.logTailLines }).catch(() => {});
    });
    // Tail lines / Previous logs 現位於 ⚙ 選單（可能未開啟）：值即時同步到元件狀態，供 Load 讀取。
    this.querySelector('#kubernetesLogTailLines')?.addEventListener('input', event => {
      this.logTailLines = Math.max(1, Math.min(1000, Number(event.target.value) || 200));
    });
    this.querySelector('#kubernetesLogPrevious')?.addEventListener('change', event => {
      this.logPreviousLogs = event.target.checked === true;
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
        .then(() => showToast(t('k8s.toast.copied'), { type: 'success' }))
        .catch(() => showToast(t('k8s.toast.copyFailed'), { type: 'error' }));
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
      const clusterLabel = applyCluster.displayName || applyCluster.clusterName || applyCluster.contextName || t('k8s.cluster.unknown');
      if (!(await confirmDialog(t('k8s.apply.confirmUpdateMessage', { cluster: clusterLabel, resource: `${resource.kind || ''}/${resource.name || ''}` }), { title: t('k8s.apply.confirmTitle'), danger: true }))) {
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
      showToast(t('k8s.toast.reloadedLatest'), { type: 'info', title: t('k8s.toast.yamlTitle') });
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
        kubernetesSessionStore.getState().startPodPortForward({ localPort: button.dataset.localPort, remotePort: button.dataset.remotePort }).catch(() => {});
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
    // Active Forward 卡片的 Open / Copy 動作（Pod / Service 共用）。
    this.querySelectorAll('.open-kubernetes-forward').forEach(button => {
      button.addEventListener('click', () => this.openForwardUrl(button.dataset.forwardUrl));
    });
    this.querySelectorAll('.copy-kubernetes-forward').forEach(button => {
      button.addEventListener('click', () => this.copyForwardAddress(button.dataset.forwardAddr));
    });
    // Service Forward：每個 Service 連接埠一顆按鈕 + 自訂埠。停止沿用 .stop-kubernetes-forward。
    this.querySelectorAll('.start-kubernetes-service-forward').forEach(button => {
      button.addEventListener('click', () => {
        kubernetesSessionStore.getState().startServicePortForward({ localPort: button.dataset.localPort, remotePort: button.dataset.remotePort }).catch(() => {});
      });
    });
    this.querySelector('#startKubernetesServiceCustomForward')?.addEventListener('click', () => {
      kubernetesSessionStore.getState().startServicePortForward({
        localPort: this.querySelector('#kubernetesServiceForwardCustomLocal')?.value,
        remotePort: this.querySelector('#kubernetesServiceForwardCustomRemote')?.value
      }).catch(() => {});
    });
    this.bindLogOutput();
  }

  async openPodShellSession(pod, container) {
    const podName = String(pod?.name || '').trim();
    const namespace = String(pod?.namespace || kubernetesSessionStore.getState().selectedNamespace || 'default').trim();
    const containerName = String(container || pod?.containers?.[0]?.name || '').trim();
    if (!podName || !containerName) {
      showToast(t('k8s.err.noShellContainer'), { type: 'error' });
      return;
    }

    try {
      const shell = await KubernetesAPI.startPodShell({ namespace, podName, container: containerName, cols: 80, rows: 24 });
      const sessionKey = `kubernetes-shell:${shell.sessionId}`;
      const label = `Shell: ${podName}`;
      const workspaceId = `ws_kubernetes_shell_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      terminalStore.getState().addSession(sessionKey, {
        label,
        isKubernetesShell: true,
        config: {
          alias: label,
          host: `${namespace}/${podName}`,
          isKubernetesShell: true,
          kubernetesShellSessionId: shell.sessionId,
          namespace,
          podName,
          container: containerName
        },
        outputHtml: '',
        isSudo: false,
        infoBoxOutputs: {}
      });
      terminalStore.setState((state) => ({
        workspaces: [...state.workspaces, {
          id: workspaceId,
          label,
          isCustomLabel: false,
          columns: [{ id: `col_${sessionKey}`, width: 100, panes: [{ sessionKey, height: 100 }] }]
        }],
        workspaceCounter: state.workspaceCounter + 1,
        activeWorkspaceId: workspaceId,
        activePaneSessionKey: sessionKey
      }));
      window.location.hash = '#/terminal';
    } catch (error) {
      showToast(t('k8s.shell.openFailed', { error: error?.message || error }), { type: 'error' });
    }
  }
}

if (!customElements.get('kubernetes-session-page')) {
  customElements.define('kubernetes-session-page', KubernetesSessionPage);
}

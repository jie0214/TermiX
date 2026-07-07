import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const appSource = await readFile(new URL('../../../App.js', import.meta.url), 'utf8');
const routesSource = await readFile(new URL('../../../routing/routes.ts', import.meta.url), 'utf8');
const legacyRouterSource = await readFile(new URL('../../../routing/legacyRouter.js', import.meta.url), 'utf8');
const pageSource = await readFile(new URL('../KubernetesPage.js', import.meta.url), 'utf8');
const sessionSource = await readFile(new URL('../KubernetesSessionPage.js', import.meta.url), 'utf8');

test('Kubernetes 固定分頁位於 Vaults 與 Terminal 工作區之間', () => {
  const vaultIndex = appSource.indexOf('<span>Vaults</span>');
  const kubernetesIndex = appSource.indexOf('kubernetes-session-tab');
  const workspaceIndex = appSource.indexOf('workspaces.forEach');
  assert.ok(vaultIndex >= 0 && kubernetesIndex > vaultIndex && workspaceIndex > kubernetesIndex);
  assert.match(appSource, /data-workspace-id="\$\{KUBERNETES_SESSION_ID\}"/);
  assert.match(appSource, /isKubernetesOpen/);
});

test('Kubernetes 分頁不參與 Terminal 拖曳、合併與關閉流程', () => {
  assert.match(appSource, /wsId !== 'host-tab' && wsId !== KUBERNETES_SESSION_ID/);
  assert.match(appSource, /includes\(KUBERNETES_SESSION_ID\)/);
  assert.match(appSource, /kubernetesSessionStore\.getState\(\)\.disconnect\(\)/);
  assert.match(routesSource, /path: '\/kubernetes-session'/);
});

test('直接進入 Kubernetes 路由時依後端 Session 同步活動分頁', () => {
  assert.match(appSource, /window\.location\.hash !== '#\/kubernetes-session'/);
  assert.match(appSource, /if \(session\) \{[\s\S]*setActiveWorkspaceId\(KUBERNETES_SESSION_ID\)/);
  assert.match(appSource, /setActiveWorkspaceId\('host-tab'\);[\s\S]*window\.location\.hash = '#\/hosts'/);
  assert.match(legacyRouterSource, /pathname === '\/kubernetes-session'/);
  assert.match(legacyRouterSource, /setActiveWorkspaceId\(KUBERNETES_SESSION_ID\)/);
});

test('Cluster 卡片使用單一 Session 連接流程', () => {
  assert.match(pageSource, /kubernetes-connect-btn/);
  assert.match(pageSource, /connectCluster\(cluster\)/);
  assert.match(pageSource, /setActiveWorkspaceId\(KUBERNETES_SESSION_ID\)/);
  assert.doesNotMatch(pageSource, /switchContext\(button\.dataset\.clusterId\)/);
});

test('Session 骨架提供 Namespace 與資源導覽', () => {
  for (const label of ['Overview', 'Nodes', 'Events', 'Pods', 'Deployments', 'StatefulSets', 'Services', 'Ingresses', 'Persistent Volume Claims', 'Persistent Volumes', 'Storage Classes']) {
    assert.match(sessionSource, new RegExp(`'${label}'`));
  }
  for (const group of ['CLUSTER', 'WORKLOADS', 'NETWORKING', 'STORAGE']) {
    assert.match(sessionSource, new RegExp(`'${group}'`));
  }
  assert.match(sessionSource, /selectNamespace\(event\.target\.value\)/);
  assert.match(sessionSource, /selectSection\(button\.dataset\.section\)/);
  assert.match(sessionSource, /All Namespaces/);
  assert.match(sessionSource, /loadDashboard\(state\.selectedNamespace\)/);
});

test('Pod Shell runtime events 使用共用 facade 並在卸載時清理', () => {
  assert.match(sessionSource, /import \{ onWailsEvent[^}]*\} from '\.\.\/\.\.\/platform\/wails\/events\.ts'/);
  assert.match(sessionSource, /onWailsEvent\('kubernetes-shell-output'/);
  assert.match(sessionSource, /onWailsEvent\('kubernetes-shell-closed'/);
  assert.match(sessionSource, /this\.runtimeEventOffs\.forEach\(off => typeof off === 'function' && off\(\)\)/);
  assert.doesNotMatch(sessionSource, /window\.runtime/);
});

test('Session 只在指定區段顯示重新整理按鈕', () => {
  assert.match(sessionSource, /const REFRESHABLE_SECTIONS = new Set/);
  for (const section of ['nodes', 'pods', 'deployments', 'statefulsets', 'services', 'ingresses', 'persistentVolumeClaims', 'persistentVolumes', 'storageClasses']) {
    assert.match(sessionSource, new RegExp(`'${section}'`));
  }
  assert.match(sessionSource, /renderSectionRefresh\(section\)/);
  assert.match(sessionSource, /renderRefreshButton\('refreshKubernetesSection'\)/);
  assert.doesNotMatch(sessionSource, /id="refreshKubernetesDashboard"/);
});

test('Session 提供 Create Resource Drawer、類型選單與 YAML 編輯器', () => {
  assert.match(sessionSource, /openKubernetesCreateResource/);
  assert.match(sessionSource, /k8s\.session\.createResource/);
  assert.match(sessionSource, /KUBERNETES_CREATE_RESOURCE_GROUPS/);
  assert.match(sessionSource, /kubernetesCreateResourceType/);
  assert.match(sessionSource, /kubernetesCreateYAML/);
  assert.match(sessionSource, /applyCreateResource\(yaml\)/);
  assert.match(sessionSource, /createLineNumbers/);
  assert.match(sessionSource, /event\.key !== 'Tab'/);
  assert.match(sessionSource, /closeCreateResource\(\)/);
  assert.match(sessionSource, /saveKubernetesResourceYAML/);
  assert.match(sessionSource, /createSaving \? t\('k8s\.create\.saving'\) : t\('k8s\.create\.save'\)/);
  assert.match(sessionSource, /saveCreateResourceYAML\(yaml\)/);
  assert.match(sessionSource, /createSavedPath/);
});

test('Networking 與 Storage 使用 Dashboard 快照及共用資源表格', () => {
  const resources = [
    ['services', 'service'],
    ['ingresses', 'ingress'],
    ['persistentVolumeClaims', 'persistentvolumeclaim'],
    ['persistentVolumes', 'persistentvolume'],
    ['storageClasses', 'storageclass']
  ];
  for (const [section, kind] of resources) {
    assert.match(sessionSource, new RegExp(`dashboard\\.${section}`));
    // section → singular kind 由 RESOURCE_META 派生：`<section>: { kind: '<kind>', ... }`。
    assert.match(sessionSource, new RegExp(`${section}: \\{ kind: '${kind}'`));
  }
  for (const field of ['clusterIp', 'externalAddresses', 'ingressClass', 'volumeName', 'storageClass', 'accessModes', 'reclaimPolicy', 'claim', 'provisioner', 'volumeBindingMode', 'allowExpansion', 'isDefault']) {
    assert.match(sessionSource, new RegExp(`'${field}'`));
  }
  assert.match(sessionSource, /class="kubernetes-resource-row"/);
  assert.match(sessionSource, /data-resource-kind="\$\{RESOURCE_KINDS\[section\]\}"/);
});

test('資源區段個別呈現安全錯誤且 Cluster Scope 資源不受 Namespace 過濾', () => {
  assert.match(sessionSource, /dashboard\.resourceErrors\?\.\[section\]/);
  assert.match(sessionSource, /kubernetes-resource-section-error/);
  assert.match(sessionSource, /escapeHtml\(resourceError\)/);
  assert.match(sessionSource, /items: dashboard\.persistentVolumes \|\| \[\]/);
  assert.match(sessionSource, /items: dashboard\.storageClasses \|\| \[\]/);
  assert.doesNotMatch(sessionSource, /dashboard\.persistentVolumes[^\n]*filter/);
  assert.doesNotMatch(sessionSource, /dashboard\.storageClasses[^\n]*filter/);
});

test('資源列支援滑鼠與鍵盤開啟 Session 內 Detail Drawer', () => {
  assert.match(sessionSource, /kubernetes-resource-row/);
  assert.match(sessionSource, /tabindex="0" role="button"/);
  assert.match(sessionSource, /event\.key !== 'Enter' && event\.key !== ' '/);
  assert.match(sessionSource, /openResource\(row\.dataset\.resourceKind/);
  assert.match(sessionSource, /kubernetes-detail-drawer/);
  assert.match(sessionSource, /closeResourceDetail\(\)/);
  assert.doesNotMatch(sessionSource, /KUBERNETES_SESSION_ID.*resourceDetail/);
});

test('Detail Drawer 支援鍵盤焦點管理與關閉後焦點回復', () => {
  assert.match(sessionSource, /event\.key === 'Escape'/);
  assert.match(sessionSource, /event\.key !== 'Tab'/);
  assert.match(sessionSource, /document\.activeElement === first/);
  assert.match(sessionSource, /document\.activeElement === last/);
  assert.match(sessionSource, /drawer\.querySelector\('\.kubernetes-drawer-close'\)\?\.focus\(\)/);
  assert.match(sessionSource, /previousDrawer\?\.contains\(document\.activeElement\)/);
  assert.match(sessionSource, /previousFocusID \? drawer\.querySelector/);
  assert.match(sessionSource, /restoreDetailFocus\(\)/);
  assert.match(sessionSource, /target\?\.focus\(\)/);
});

test('Session 對載入、錯誤、導覽與表格提供可及性語意', () => {
  assert.match(sessionSource, /role="status" aria-live="polite"/);
  assert.match(sessionSource, /class="kubernetes-session-error" role="alert"/);
  assert.match(sessionSource, /aria-current="page"/);
  assert.match(sessionSource, /kubernetes-table-caption/);
  assert.match(sessionSource, /Kubernetes Events<\/caption>/);
  assert.match(sessionSource, /kubernetes-visually-hidden">\$\{t\('k8s\.session\.connected'\)\}/);
});

test('Detail Drawer 呈現結構化資料與安全的 Pod Logs', () => {
  for (const label of ['Overview', 'YAML', 'Logs', 'Forward', 'Delete', 'Labels', 'Conditions', 'Containers', 'Related Events']) {
    assert.match(sessionSource, new RegExp(label));
  }
  for (const tab of ['overview', 'yaml', 'logs', 'forward', 'delete']) {
    assert.match(sessionSource, new RegExp(`'${tab}'`));
  }
  assert.match(sessionSource, /renderResourceDetailTabs/);
  assert.match(sessionSource, /escapeHtml\(content\)/);
  assert.match(sessionSource, /startPodPortForward/);
  assert.match(sessionSource, /stopPodPortForward/);
  assert.match(sessionSource, /pendingDeleteConfirm/);
  assert.match(sessionSource, /deleteSelectedResource/);
  assert.match(sessionSource, /visiblePodLogs/);
  assert.match(sessionSource, /escapeHtml\(logs\.join\('\\n'\)\)/);
  assert.match(sessionSource, /\['Status', detail\.status\]/);
  assert.match(sessionSource, /\['Created At', detail\.createdAt\]/);
  assert.match(sessionSource, /state\.logsTruncated/);
  assert.match(sessionSource, /escapeHtml\(detail\.eventsError\)/);
  assert.match(sessionSource, /k8s\.logs\.truncated/);
  assert.match(sessionSource, /kubernetes-log-output/);
  assert.match(sessionSource, /loadPodLogs\(\{ container, previous, tailLines \}\)/);
  for (const control of ['kubernetesLogSearch', 'toggleKubernetesLogRegex', 'kubernetesLogLevel', 'toggleKubernetesLogsPause', 'downloadKubernetesLogs', 'toggleKubernetesLogOptions', 'clearKubernetesLogs']) {
    assert.match(sessionSource, new RegExp(control));
  }
  for (const key of ['k8s.logs.allLevels', 'k8s.logs.levelError', 'k8s.logs.levelWarning', 'k8s.logs.levelInfo', 'k8s.logs.levelDebug', 'k8s.logs.displayOptionsHeading', 'k8s.logs.lineWrap', 'k8s.logs.timestamp', 'k8s.logs.pause', 'k8s.logs.follow']) {
    assert.match(sessionSource, new RegExp(key.replace(/\./g, '\\.')));
  }
  assert.match(sessionSource, /max="1000"/);
});

test('Events 使用 Dashboard 快照欄位且不開啟額外 Session', () => {
  assert.match(sessionSource, /dashboard\.events/);
  for (const field of ['event.type', 'event.reason', 'event.object', 'event.message', 'event.timestamp']) {
    assert.match(sessionSource, new RegExp(field.replace('.', '\\.')));
  }
  assert.match(sessionSource, /k8s\.empty\.noEvents/);
});

test('Session 顯示真實 Overview、Metrics 與資源表格', () => {
  for (const field of ['readyNodes', 'runningPods', 'readyDeployments', 'readyStatefulSets', 'services', 'warningEvents']) {
    assert.match(sessionSource, new RegExp(`counts\\.${field}`));
  }
  assert.match(sessionSource, /metrics\.available/);
  assert.match(sessionSource, /k8s\.metrics\.unavailable/);
  assert.match(sessionSource, /dashboard\.nodes/);
  assert.match(sessionSource, /dashboard\.pods/);
  assert.match(sessionSource, /dashboard\.deployments/);
  assert.match(sessionSource, /dashboard\.statefulSets/);
  assert.match(sessionSource, /metricsAvailable \? formatCPU\(value\) : '-'/);
});

test('Session 區分首次載入、過期快照、空資料與 RBAC 錯誤', () => {
  assert.match(sessionSource, /state\.dashboardLoading && !dashboard/);
  assert.match(sessionSource, /state\.dashboardError && dashboard/);
  assert.match(sessionSource, /k8s\.detail\.refreshFailedSnapshot/);
  assert.match(sessionSource, /k8s\.empty\.noResourcesInScope/);
  assert.match(sessionSource, /k8s\.dashboard\.errorRbac/);
  assert.match(sessionSource, /escapeHtml\(state\.dashboardError\)/);
});

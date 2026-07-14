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
  assert.match(sessionSource, /loadDashboardProgressive\('\*'\)/);
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

test('Workload/Service 可經 selector 比對跳轉到關聯 Pods 並過濾', () => {
  // 以 label selector（非 ownerReferences）子集比對反查 Pod。
  assert.match(sessionSource, /podMatchesSelector\(pod, selector\)/);
  assert.match(sessionSource, /keys\.every\(key => labels\[key\] === selector\[key\]\)/);
  // 入口：列表列 hover 圖示鈕 + 抽屜 Overview CTA，皆帶 data-view-pods。
  assert.match(sessionSource, /viewPodsIconButton\('daemonset', item\)/);
  assert.match(sessionSource, /renderRelatedPodsAction\(kind, selected, state\)/);
  assert.match(sessionSource, /data-view-pods="/);
  // 跳轉：設定 podLabelFilter、關閉抽屜、切到 Pods 區段。
  assert.match(sessionSource, /this\.podLabelFilter = \{ kind: parsed\.kind/);
  assert.match(sessionSource, /event\.stopPropagation\(\);\s*this\.jumpToRelatedPods/);
  // Pods 清單套用 label 過濾並顯示可清除的來源 chip。
  assert.match(sessionSource, /kubernetes-pod-filter-chip/);
  assert.match(sessionSource, /data-clear-pod-filter="true"/);
  // 手動切換區段會清除 label 過濾與多選，避免殘留。
  assert.match(sessionSource, /this\.podLabelFilter = null;[\s\S]*?this\.clearSelection\(\);[\s\S]*?kubernetesSessionStore\.getState\(\)\.selectSection/);
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
  assert.match(sessionSource, /renderLogLines\(logs\)/);
  assert.match(sessionSource, /highlightLogSearch/);
  assert.match(sessionSource, /kubernetes-log-mark/);
  assert.match(sessionSource, /\['Status', detail\.status\]/);
  assert.match(sessionSource, /\['Created At', detail\.createdAt\]/);
  assert.match(sessionSource, /state\.logsTruncated/);
  assert.match(sessionSource, /escapeHtml\(detail\.eventsError\)/);
  assert.match(sessionSource, /k8s\.logs\.truncated/);
  assert.match(sessionSource, /kubernetes-log-output/);
  assert.match(sessionSource, /loadPodLogs\(\{ container, previous: this\.logPreviousLogs, tailLines: this\.logTailLines \}\)/);
  assert.match(sessionSource, /kubernetes-log-bar/);
  assert.match(sessionSource, /kubernetes-log-dot/);
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

test('Events 為扁平單行對齊列表：namespace 色條、不分組、Warning 優先、×N、可搜尋', () => {
  // 不再分組：無 reason 群組相關程式。
  assert.doesNotMatch(sessionSource, /data-event-group/);
  assert.doesNotMatch(sessionSource, /collapsedEventGroups/);
  // 每列可點開 Drawer；最左依 namespace 分色（以首格 inset box-shadow 呈現 4px 色條）。
  assert.match(sessionSource, /data-event-row/);
  assert.match(sessionSource, /box-shadow:inset 4px 0 0 \$\{this\.namespaceColor\(namespace\)\}/);
  // 固定欄寬列表放在可水平捲動容器內；Reason 以徽章呈現。
  assert.match(sessionSource, /kubernetes-eventlist-scroll/);
  assert.match(sessionSource, /kubernetes-eventlist-reason-badge/);
  // 排序：Warning 優先，其次時間新到舊。
  assert.match(sessionSource, /if \(aw !== bw\) return aw \? -1 : 1;/);
  // object 只顯示名稱（去掉 kind/ 前綴），重複次數以 ×N 徽章呈現。
  assert.match(sessionSource, /obj\.slice\(slash \+ 1\)/);
  assert.match(sessionSource, /kubernetes-event-count/);
  assert.match(sessionSource, /#kubernetesEventsSearch/);
});

test('Events 點列開啟專用 Drawer（本地 selectedEvent、Escape 關閉、非互動不加點列）', () => {
  // 本地狀態驅動的 Events Drawer：開/關與完整訊息區塊。
  assert.match(sessionSource, /openEventDrawer\(event\)/);
  assert.match(sessionSource, /this\.selectedEvent = event;/);
  assert.match(sessionSource, /closeEventDrawer\(\)/);
  assert.match(sessionSource, /kubernetes-event-drawer-message/);
  // 開/關 Drawer 走保存捲動的重繪，避免捲到右方後回彈。
  assert.match(sessionSource, /rerenderPreservingScroll\(\)/);
  // Escape 於事件 Drawer 先於 resource/create drawer 處理。
  assert.match(sessionSource, /const eventDrawer = this\.querySelector\('\.kubernetes-event-drawer'\)/);
  // Detail Drawer 的 Related Events 以非互動模式渲染（不加點列開 Drawer）。
  assert.match(sessionSource, /renderEventsTable\(events, \{ interactive: false \}\)/);
});

test('捲動保存涵蓋所有容器（主內容含水平、側欄、Events、Detail Drawer），輪詢重繪不回彈', () => {
  // 統一 capture/restore；主內容抓 x+y（pod 等寬表格靠 scrollbody 水平捲動、避免輪詢回彈）。
  assert.match(sessionSource, /captureScrollState\(\)/);
  assert.match(sessionSource, /restoreScrollState\(scrollState\)/);
  assert.match(sessionSource, /read\('\.kubernetes-session-scrollbody', 'xy'\)/);
  assert.match(sessionSource, /read\('\.kubernetes-eventlist-scroll', 'x'\)/);
  assert.match(sessionSource, /read\('\.kubernetes-detail-body', 'xy'\)/);
  // 還原以 suppressScrollbarAutohide 包住，避免捲動條每次刷新閃現。
  assert.match(sessionSource, /suppressScrollbarAutohide\(\(\) => \{[\s\S]*el\.scrollLeft = pos\.left/);
});

test('Session 顯示真實 Overview、Metrics 與資源表格', () => {
  // Overview 計數尊重 namespace 多選（與 Pods / 資源表格一致），Nodes 為 cluster-scoped 沿用後端。
  assert.match(sessionSource, /const inScope = item => nsSet\.size === 0 \|\| nsSet\.has\(item\?\.namespace\)/);
  assert.match(sessionSource, /String\(pod\.phase \|\| ''\)\.toLowerCase\(\) === phase/);
  assert.match(sessionSource, /const readyDeployments = deploymentList\.filter\(item => item\.status === 'Ready'\)/);
  assert.match(sessionSource, /Number\(backend\.readyNodes \|\| 0\)/);
  assert.match(sessionSource, /metrics\.available/);
  assert.match(sessionSource, /k8s\.metrics\.unavailable/);
  assert.match(sessionSource, /dashboard\.nodes/);
  assert.match(sessionSource, /dashboard\.pods/);
  assert.match(sessionSource, /dashboard\.deployments/);
  assert.match(sessionSource, /dashboard\.statefulSets/);
  assert.match(sessionSource, /metricsAvailable \? formatCPU\(value\) : '-'/);
});

test('Overview 以健康橫幅 + KPI 卡 + Pod 狀態堆疊條呈現', () => {
  // 健康總結橫幅（ok / warning / danger）與問題列表。
  assert.match(sessionSource, /kubernetes-overview-banner is-\$\{tone\}/);
  assert.match(sessionSource, /const tone = issues\.length === 0 \? 'ok' : danger \? 'danger' : 'warning'/);
  // KPI 卡整併 Workloads（deploy + sts + ds），DaemonSets 由 dashboard 陣列取數。
  assert.match(sessionSource, /kubernetes-kpi-grid/);
  assert.match(sessionSource, /const daemonSetList = \(dashboard\.daemonSets \|\| \[\]\)\.filter\(inScope\)/);
  // Services 副標改為負載平衡器數（不再誤植 warning events）。
  assert.match(sessionSource, /item\.type\) === 'LoadBalancer'/);
  // Pod 狀態堆疊條。
  assert.match(sessionSource, /renderPodStatusBar\(runningPods, pendingPods, failedPods, succeededPods\)/);
  assert.match(sessionSource, /kubernetes-podbar-seg/);
  // 健康橫幅看全叢集（不受 namespace 篩選），並標示受影響 namespace。
  assert.match(sessionSource, /const allPods = Array\.isArray\(dashboard\.pods\)/);
  assert.match(sessionSource, /const clusterFailed = clusterPhase\('failed'\)/);
  assert.match(sessionSource, /affectedNamespaces\(clusterFailed\)/);
});

test('Overview 顯示 Top CPU / Memory 消耗者且首屏漸進載入', () => {
  // Top 消耗者：依 cpu/mem 用量排序取前 5，僅在 metrics 可用時渲染。
  assert.match(sessionSource, /renderTopConsumers\(podList\)/);
  assert.match(sessionSource, /Number\(b\.cpuUsageMilli\) - Number\(a\.cpuUsageMilli\)/);
  assert.match(sessionSource, /Number\(b\.memoryUsageBytes\) - Number\(a\.memoryUsageBytes\)/);
  assert.match(sessionSource, /kubernetes-top-grid/);
  // 首屏漸進：非核心 section 在 full 到齊前（dashboard.partial）顯示載入中，不誤報「沒有資源」。
  assert.match(sessionSource, /dashboard\.partial && !CORE_SECTIONS\.has\(activeSection\)/);
});

test('Session 區分首次載入、過期快照、空資料與 RBAC 錯誤', () => {
  assert.match(sessionSource, /state\.dashboardLoading && !dashboard/);
  assert.match(sessionSource, /state\.dashboardError && dashboard/);
  assert.match(sessionSource, /k8s\.detail\.refreshFailedSnapshot/);
  assert.match(sessionSource, /k8s\.empty\.noResourcesInScope/);
  assert.match(sessionSource, /k8s\.dashboard\.errorRbac/);
  assert.match(sessionSource, /escapeHtml\(state\.dashboardError\)/);
});

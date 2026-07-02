import assert from 'node:assert/strict';
import test from 'node:test';
import { KubernetesAPI } from '../KubernetesAPI.js';
import { createKubernetesSessionStore } from '../KubernetesSessionStore.js';

function cluster(id, namespace = 'default') {
  return {
    id,
    displayName: `Cluster ${id}`,
    contextName: `context-${id}`,
    clusterName: `cluster-${id}`,
    server: `https://${id}.example.test`,
    kubeconfigPath: `/tmp/${id}-config`,
    namespace
  };
}

function sessionFor(request) {
  return {
    sessionId: 'kubernetes-tab',
    ...request,
    connectedAt: '2026-06-18T12:00:00Z'
  };
}

function dashboardFor(namespace, generatedAt = '2026-06-19T08:00:00Z') {
  return {
    namespace,
    namespaces: ['default', 'kube-system', 'monitoring'],
    generatedAt,
    serverVersion: 'v1.34.0',
    overview: { nodes: 3, pods: 12 }
  };
}

test('連接成功後只保存唯一 Kubernetes Session', async () => {
  const requests = [];
  const store = createKubernetesSessionStore({
    connectCluster: async (request) => {
      requests.push(request);
      return sessionFor(request);
    }
  });

  await store.getState().connectCluster(cluster('a'));

  const state = store.getState();
  assert.equal(state.sessionOpen, true);
  assert.equal(state.connectionStatus, 'connected');
  assert.equal(state.connectedCluster.sessionId, 'kubernetes-tab');
  assert.equal(state.connectedCluster.clusterId, 'a');
  assert.equal(state.selectedNamespace, 'default');
  assert.equal(requests.length, 1);
  assert.equal(Array.isArray(state.connectedCluster), false);
});

test('切換叢集會覆蓋既有 Session 而不累積', async () => {
  const store = createKubernetesSessionStore({
    connectCluster: async (request) => sessionFor(request)
  });

  await store.getState().connectCluster(cluster('a'));
  store.setState({
    dashboard: dashboardFor('default'),
    namespaces: ['default'],
    dashboardLoading: true,
    dashboardError: '舊錯誤',
    lastUpdatedAt: '2026-06-19T08:00:00Z'
  });
  store.getState().selectSection('pods');
  await store.getState().switchCluster(cluster('b', 'monitoring'));

  const state = store.getState();
  assert.equal(state.connectedCluster.clusterId, 'b');
  assert.equal(state.connectedCluster.sessionId, 'kubernetes-tab');
  assert.equal(state.selectedNamespace, 'monitoring');
  assert.equal(state.activeSection, 'overview');
  assert.equal(state.dashboard, null);
  assert.deepEqual(state.namespaces, []);
  assert.equal(state.dashboardLoading, false);
  assert.equal(state.dashboardError, '');
  assert.equal(state.lastUpdatedAt, '');
});

test('連接失敗不會開啟 Session 並保存繁中錯誤', async () => {
  const store = createKubernetesSessionStore({
    connectCluster: async () => {
      throw new Error('叢集認證失敗。');
    }
  });

  await assert.rejects(store.getState().connectCluster(cluster('a')), /叢集認證失敗/);

  assert.equal(store.getState().sessionOpen, false);
  assert.equal(store.getState().connectionStatus, 'error');
  assert.equal(store.getState().loadError, '叢集認證失敗。');
});

test('切換失敗會保留原本已連接的唯一 Session', async () => {
  let shouldFail = false;
  const store = createKubernetesSessionStore({
    connectCluster: async (request) => {
      if (shouldFail) throw new Error('新叢集連接失敗。');
      return sessionFor(request);
    }
  });

  await store.getState().connectCluster(cluster('a'));
  const oldDashboard = dashboardFor('default');
  store.setState({
    dashboard: oldDashboard,
    namespaces: oldDashboard.namespaces,
    lastUpdatedAt: oldDashboard.generatedAt
  });
  shouldFail = true;
  await assert.rejects(store.getState().switchCluster(cluster('b')), /新叢集連接失敗/);

  assert.equal(store.getState().sessionOpen, true);
  assert.equal(store.getState().connectionStatus, 'connected');
  assert.equal(store.getState().connectedCluster.clusterId, 'a');
  assert.equal(store.getState().loadError, '新叢集連接失敗。');
  assert.equal(store.getState().dashboard, oldDashboard);
  assert.deepEqual(store.getState().namespaces, oldDashboard.namespaces);
  assert.equal(store.getState().lastUpdatedAt, oldDashboard.generatedAt);
});

test('同時切換叢集時只提交最後發出的連接請求', async () => {
  const resolvers = new Map();
  const store = createKubernetesSessionStore({
    connectCluster: (request) => new Promise((resolve) => {
      resolvers.set(request.clusterId, () => resolve(sessionFor(request)));
    })
  });

  const first = store.getState().connectCluster(cluster('a'));
  const second = store.getState().connectCluster(cluster('b', 'monitoring'));
  resolvers.get('b')();
  await second;
  resolvers.get('a')();
  await first;

  const state = store.getState();
  assert.equal(state.connectedCluster.clusterId, 'b');
  assert.equal(state.selectedNamespace, 'monitoring');
  assert.equal(state.connectionStatus, 'connected');
  assert.equal(state.loadError, '');
});

test('舊連接請求失敗不會污染較新的成功 Session', async () => {
  let rejectFirst;
  const store = createKubernetesSessionStore({
    connectCluster: async (request) => {
      if (request.clusterId === 'a') {
        return new Promise((resolve, reject) => { rejectFirst = reject; });
      }
      return sessionFor(request);
    }
  });

  const first = store.getState().connectCluster(cluster('a'));
  await store.getState().connectCluster(cluster('b'));
  rejectFirst(new Error('舊叢集網路中斷。'));
  await assert.rejects(first, /舊叢集網路中斷/);

  assert.equal(store.getState().connectedCluster.clusterId, 'b');
  assert.equal(store.getState().connectionStatus, 'connected');
  assert.equal(store.getState().loadError, '');
});

test('還原後端 Session 並支援無 Session 狀態', async () => {
  let active = sessionFor({
    clusterId: 'a',
    displayName: 'Cluster a',
    contextName: 'context-a',
    clusterName: 'cluster-a',
    server: 'https://a.example.test',
    kubeconfigPath: '/tmp/a-config',
    namespace: 'kube-system'
  });
  const store = createKubernetesSessionStore({
    getActiveSession: async () => active
  });

  await store.getState().restoreSession();
  assert.equal(store.getState().sessionOpen, true);
  assert.equal(store.getState().selectedNamespace, 'kube-system');

  active = null;
  await store.getState().restoreSession();
  assert.equal(store.getState().sessionOpen, false);
  assert.equal(store.getState().connectionStatus, 'idle');
  assert.equal(store.getState().connectedCluster, null);
});

test('載入 Dashboard 會更新 Snapshot、Namespace 與時間戳記', async () => {
  const requests = [];
  const snapshot = dashboardFor('kube-system');
  const store = createKubernetesSessionStore({
    connectCluster: async (request) => sessionFor(request),
    getDashboard: async (namespace) => {
      requests.push(namespace);
      return snapshot;
    }
  });

  await store.getState().connectCluster(cluster('a'));
  const loadPromise = store.getState().loadDashboard('kube-system');
  assert.equal(store.getState().dashboardLoading, true);
  await loadPromise;

  const state = store.getState();
  assert.deepEqual(requests, ['kube-system']);
  assert.equal(state.dashboard, snapshot);
  assert.deepEqual(state.namespaces, snapshot.namespaces);
  assert.equal(state.selectedNamespace, 'kube-system');
  assert.equal(state.dashboardLoading, false);
  assert.equal(state.dashboardError, '');
  assert.equal(state.lastUpdatedAt, snapshot.generatedAt);
});

test('Metrics API 缺失時仍提交可用的核心資源 Dashboard', async () => {
  const snapshot = {
    ...dashboardFor('default'),
    metrics: {
      available: false,
      error: 'Metrics API 無法使用。',
      cpuUsage: 0,
      memoryUsage: 0
    },
    pods: [{ name: 'api-0', namespace: 'default', status: 'Running' }]
  };
  const store = createKubernetesSessionStore({
    connectCluster: async (request) => sessionFor(request),
    getDashboard: async () => snapshot
  });

  await store.getState().connectCluster(cluster('a'));
  await store.getState().loadDashboard('default');

  assert.equal(store.getState().dashboard.metrics.available, false);
  assert.equal(store.getState().dashboard.metrics.error, 'Metrics API 無法使用。');
  assert.equal(store.getState().dashboard.pods[0].name, 'api-0');
  assert.equal(store.getState().dashboardError, '');
});

test('RBAC 權限不足時結束載入並顯示後端安全錯誤', async () => {
  const store = createKubernetesSessionStore({
    connectCluster: async (request) => sessionFor(request),
    getDashboard: async () => {
      throw new Error('Kubernetes RBAC 權限不足，無法讀取 Pods。');
    }
  });

  await store.getState().connectCluster(cluster('a'));
  await assert.rejects(store.getState().loadDashboard(), /RBAC 權限不足/);

  assert.equal(store.getState().dashboard, null);
  assert.equal(store.getState().dashboardLoading, false);
  assert.equal(store.getState().dashboardError, 'Kubernetes RBAC 權限不足，無法讀取 Pods。');
});

test('認證過期時保留既有 Snapshot 並公開可重試錯誤', async () => {
  let expired = false;
  const snapshot = dashboardFor('default');
  const store = createKubernetesSessionStore({
    connectCluster: async (request) => sessionFor(request),
    getDashboard: async () => {
      if (expired) throw new Error('Kubernetes 認證已過期，請重新連接。');
      return snapshot;
    }
  });

  await store.getState().connectCluster(cluster('a'));
  await store.getState().loadDashboard();
  expired = true;
  await assert.rejects(store.getState().refreshDashboard(), /認證已過期/);

  assert.equal(store.getState().dashboard, snapshot);
  assert.equal(store.getState().dashboardLoading, false);
  assert.equal(store.getState().dashboardError, 'Kubernetes 認證已過期，請重新連接。');
});

test('網路中斷時保留目前 Namespace 與最後成功資料', async () => {
  let disconnected = false;
  const snapshot = dashboardFor('monitoring');
  const store = createKubernetesSessionStore({
    connectCluster: async (request) => sessionFor(request),
    getDashboard: async () => {
      if (disconnected) throw new Error('無法連線至 Kubernetes API Server。');
      return snapshot;
    }
  });

  await store.getState().connectCluster(cluster('a', 'monitoring'));
  await store.getState().loadDashboard();
  disconnected = true;
  await assert.rejects(store.getState().refreshDashboard(), /無法連線/);

  assert.equal(store.getState().selectedNamespace, 'monitoring');
  assert.equal(store.getState().dashboard, snapshot);
  assert.equal(store.getState().lastUpdatedAt, snapshot.generatedAt);
  assert.equal(store.getState().dashboardError, '無法連線至 Kubernetes API Server。');
});

test('選擇 Namespace 會查詢新 Dashboard 並在成功後提交狀態', async () => {
  const requests = [];
  const store = createKubernetesSessionStore({
    connectCluster: async (request) => sessionFor(request),
    getDashboard: async (namespace) => {
      requests.push(namespace);
      return dashboardFor(namespace);
    }
  });

  await store.getState().connectCluster(cluster('a'));
  await store.getState().loadDashboard('default');
  await store.getState().selectNamespace('monitoring');

  assert.deepEqual(requests, ['default', 'monitoring']);
  assert.equal(store.getState().selectedNamespace, 'monitoring');
  assert.equal(store.getState().dashboard.namespace, 'monitoring');
});

test('重新整理會使用目前 Namespace 並替換 Dashboard', async () => {
  let generatedAt = '2026-06-19T08:00:00Z';
  const requests = [];
  const store = createKubernetesSessionStore({
    connectCluster: async (request) => sessionFor(request),
    getDashboard: async (namespace) => {
      requests.push(namespace);
      return dashboardFor(namespace, generatedAt);
    }
  });

  await store.getState().connectCluster(cluster('a', 'monitoring'));
  await store.getState().loadDashboard();
  generatedAt = '2026-06-19T08:05:00Z';
  await store.getState().refreshDashboard();

  assert.deepEqual(requests, ['monitoring', 'monitoring']);
  assert.equal(store.getState().lastUpdatedAt, generatedAt);
});

test('Namespace 查詢失敗會保留舊 Snapshot、選取值與更新時間', async () => {
  let shouldFail = false;
  const oldDashboard = dashboardFor('default');
  const store = createKubernetesSessionStore({
    connectCluster: async (request) => sessionFor(request),
    getDashboard: async (namespace) => {
      if (shouldFail) throw new Error('Namespace 查詢失敗。');
      return namespace === 'default' ? oldDashboard : dashboardFor(namespace);
    }
  });

  await store.getState().connectCluster(cluster('a'));
  await store.getState().loadDashboard('default');
  shouldFail = true;
  await assert.rejects(store.getState().selectNamespace('monitoring'), /Namespace 查詢失敗/);

  const state = store.getState();
  assert.equal(state.dashboard, oldDashboard);
  assert.deepEqual(state.namespaces, oldDashboard.namespaces);
  assert.equal(state.selectedNamespace, 'default');
  assert.equal(state.dashboardLoading, false);
  assert.equal(state.dashboardError, 'Namespace 查詢失敗。');
  assert.equal(state.lastUpdatedAt, oldDashboard.generatedAt);
});

test('切換叢集後忽略前一個 Session 尚未完成的 Dashboard 回應', async () => {
  let resolveDashboard;
  const store = createKubernetesSessionStore({
    connectCluster: async (request) => sessionFor(request),
    getDashboard: async () => new Promise((resolve) => {
      resolveDashboard = resolve;
    })
  });

  await store.getState().connectCluster(cluster('a'));
  const pendingLoad = store.getState().loadDashboard('default');
  await store.getState().switchCluster(cluster('b', 'monitoring'));
  resolveDashboard(dashboardFor('default'));
  await pendingLoad;

  const state = store.getState();
  assert.equal(state.connectedCluster.clusterId, 'b');
  assert.equal(state.selectedNamespace, 'monitoring');
  assert.equal(state.dashboard, null);
  assert.deepEqual(state.namespaces, []);
  assert.equal(state.dashboardLoading, false);
  assert.equal(state.lastUpdatedAt, '');
});

test('中斷連線會清除全部 Session 與 Dashboard 狀態', async () => {
  let disconnected = false;
  const store = createKubernetesSessionStore({
    connectCluster: async (request) => sessionFor(request),
    disconnectCluster: async () => {
      disconnected = true;
    }
  });

  await store.getState().connectCluster(cluster('a'));
  store.getState().selectSection('nodes');
  store.setState({
    selectedNamespace: 'kube-system',
    dashboard: dashboardFor('kube-system'),
    namespaces: ['default', 'kube-system'],
    dashboardLoading: true,
    dashboardError: '舊錯誤',
    lastUpdatedAt: '2026-06-19T08:00:00Z'
  });
  await store.getState().disconnect();

  const state = store.getState();
  assert.equal(disconnected, true);
  assert.equal(state.sessionOpen, false);
  assert.equal(state.connectionStatus, 'idle');
  assert.equal(state.connectedCluster, null);
  assert.equal(state.selectedNamespace, '');
  assert.equal(state.activeSection, 'overview');
  assert.equal(state.loadError, '');
  assert.equal(state.dashboard, null);
  assert.deepEqual(state.namespaces, []);
  assert.equal(state.dashboardLoading, false);
  assert.equal(state.dashboardError, '');
  assert.equal(state.lastUpdatedAt, '');
});

test('中斷失敗會保留目前 Session 並顯示錯誤', async () => {
  const store = createKubernetesSessionStore({
    connectCluster: async (request) => sessionFor(request),
    disconnectCluster: async () => {
      throw new Error('Kubernetes API Server 網路中斷。');
    }
  });

  await store.getState().connectCluster(cluster('a'));
  await assert.rejects(store.getState().disconnect(), /網路中斷/);

  assert.equal(store.getState().sessionOpen, true);
  assert.equal(store.getState().connectedCluster.clusterId, 'a');
  assert.equal(store.getState().connectionStatus, 'error');
  assert.equal(store.getState().loadError, 'Kubernetes API Server 網路中斷。');
});

test('中斷連線會使尚未完成的連接回應失效', async () => {
  let resolveConnect;
  const store = createKubernetesSessionStore({
    connectCluster: (request) => new Promise((resolve) => {
      resolveConnect = () => resolve(sessionFor(request));
    }),
    disconnectCluster: async () => {}
  });

  const connecting = store.getState().connectCluster(cluster('a'));
  await store.getState().disconnect();
  resolveConnect();
  await connecting;

  assert.equal(store.getState().sessionOpen, false);
  assert.equal(store.getState().connectedCluster, null);
  assert.equal(store.getState().connectionStatus, 'idle');
});

test('Dashboard API 以物件傳遞 Namespace 給動態 Wails binding', async () => {
  const originalWindow = globalThis.window;
  const requests = [];
  globalThis.window = {
    go: {
      app: {
        App: {
          GetKubernetesDashboard: async (request) => {
            requests.push(request);
            return dashboardFor(request.namespace);
          }
        }
      }
    }
  };

  try {
    const result = await KubernetesAPI.getDashboard('monitoring');
    assert.deepEqual(requests, [{ namespace: 'monitoring' }]);
    assert.equal(result.namespace, 'monitoring');
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test('Kubernetes API 缺少 Wails binding 時會回報具名錯誤', async () => {
  const originalWindow = globalThis.window;
  globalThis.window = { go: { app: { App: {} } } };

  try {
    await assert.rejects(
      () => KubernetesAPI.getDashboard('default'),
      /缺少後端 API：GetKubernetesDashboard/
    );
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test('開啟資源會載入明細並保存標準化識別資訊', async () => {
  const requests = [];
  const detail = { kind: 'Pod', name: 'api-0', namespace: 'monitoring', yaml: 'kind: Pod' };
  const store = createKubernetesSessionStore({
    connectCluster: async (request) => sessionFor(request),
    getResourceDetail: async (request) => {
      requests.push(request);
      return detail;
    }
  });

  await store.getState().connectCluster(cluster('a'));
  const load = store.getState().openResource('Pod', {
    metadata: { name: 'api-0', namespace: 'monitoring' },
    status: 'Running'
  });
  assert.equal(store.getState().detailOpen, true);
  assert.equal(store.getState().detailLoading, true);
  await load;

  const state = store.getState();
  assert.deepEqual(requests, [{ kind: 'pod', name: 'api-0', namespace: 'monitoring', apiVersion: '' }]);
  assert.equal(state.selectedResource.name, 'api-0');
  assert.equal(state.selectedResource.namespace, 'monitoring');
  assert.equal(state.selectedResource.status, 'Running');
  assert.equal(state.resourceDetail, detail);
  assert.equal(state.detailLoading, false);
  assert.equal(state.detailError, '');
});

test('資源明細失敗會保持 Drawer 開啟並顯示錯誤', async () => {
  const store = createKubernetesSessionStore({
    connectCluster: async (request) => sessionFor(request),
    getResourceDetail: async () => {
      throw new Error('沒有讀取 Pod 的權限。');
    }
  });

  await store.getState().connectCluster(cluster('a'));
  await assert.rejects(
    store.getState().openResource('Pod', { name: 'api-0', namespace: 'default' }),
    /沒有讀取 Pod 的權限/
  );

  assert.equal(store.getState().detailOpen, true);
  assert.equal(store.getState().selectedResource.name, 'api-0');
  assert.equal(store.getState().resourceDetail, null);
  assert.equal(store.getState().detailLoading, false);
  assert.equal(store.getState().detailError, '沒有讀取 Pod 的權限。');
});

test('切換資源後會忽略前一個資源的延遲回應', async () => {
  let resolveFirst;
  const store = createKubernetesSessionStore({
    connectCluster: async (request) => sessionFor(request),
    getResourceDetail: async ({ name }) => {
      if (name === 'old-pod') {
        return new Promise((resolve) => { resolveFirst = resolve; });
      }
      return { name };
    }
  });

  await store.getState().connectCluster(cluster('a'));
  const oldLoad = store.getState().openResource('Pod', { name: 'old-pod', namespace: 'default' });
  await store.getState().openResource('Pod', { name: 'new-pod', namespace: 'default' });
  resolveFirst({ name: 'old-pod' });
  await oldLoad;

  assert.equal(store.getState().selectedResource.name, 'new-pod');
  assert.deepEqual(store.getState().resourceDetail, { name: 'new-pod' });
});

test('載入 Pod Logs 會合併預設值並保存內容與選項', async () => {
  const requests = [];
  const store = createKubernetesSessionStore({
    connectCluster: async (request) => sessionFor(request),
    getResourceDetail: async () => ({ containers: ['api'] }),
    getPodLogs: async (request) => {
      requests.push(request);
      return { container: 'api', content: '第一行\n第二行', truncated: true };
    }
  });

  await store.getState().connectCluster(cluster('a', 'monitoring'));
  await store.getState().openResource('Pod', { name: 'api-0', namespace: 'monitoring' });
  const load = store.getState().loadPodLogs({ container: 'api', previous: true, tailLines: 100 });
  assert.equal(store.getState().logsLoading, true);
  await load;

  assert.deepEqual(requests, [{
    namespace: 'monitoring',
    podName: 'api-0',
    container: 'api',
    previous: true,
    tailLines: 100
  }]);
  assert.equal(store.getState().podLogs, '第一行\n第二行');
  assert.equal(store.getState().logsTruncated, true);
  assert.equal(store.getState().logsLoading, false);
  assert.equal(store.getState().logsError, '');
  assert.deepEqual(store.getState().logOptions, requests[0]);
});

test('Pod Logs 載入失敗會保留既有內容', async () => {
  let shouldFail = false;
  const store = createKubernetesSessionStore({
    connectCluster: async (request) => sessionFor(request),
    getResourceDetail: async () => ({}),
    getPodLogs: async () => {
      if (shouldFail) throw new Error('Logs 讀取失敗。');
      return '既有 Logs';
    }
  });

  await store.getState().connectCluster(cluster('a'));
  await store.getState().openResource('Pod', { name: 'api-0', namespace: 'default' });
  await store.getState().loadPodLogs();
  shouldFail = true;
  await assert.rejects(store.getState().loadPodLogs({ previous: true }), /Logs 讀取失敗/);

  assert.equal(store.getState().podLogs, '既有 Logs');
  assert.equal(store.getState().logsTruncated, false);
  assert.equal(store.getState().logsLoading, false);
  assert.equal(store.getState().logsError, 'Logs 讀取失敗。');
});

test('Pod Drawer 頁籤只接受 Overview、YAML、Logs、Forward 與 Delete', async () => {
  const store = createKubernetesSessionStore({
    connectCluster: async (request) => sessionFor(request),
    getResourceDetail: async () => ({ kind: 'Pod', name: 'api-0' })
  });
  await store.getState().connectCluster(cluster('a'));
  await store.getState().openResource('Pod', { name: 'api-0', namespace: 'default' });

  for (const tab of ['overview', 'yaml', 'logs', 'forward', 'delete']) {
    store.getState().selectDetailTab(tab);
    assert.equal(store.getState().detailTab, tab);
  }
  store.getState().selectDetailTab('unknown');
  assert.equal(store.getState().detailTab, 'overview');
});

test('Pod Port Forward 可建立、列出與停止且固定使用目前 Pod', async () => {
  const requests = [];
  const store = createKubernetesSessionStore({
    connectCluster: async (request) => sessionFor(request),
    getResourceDetail: async () => ({ kind: 'Pod', name: 'api-0' }),
    listPodPortForwards: async (request) => {
      requests.push(['list', request]);
      return [];
    },
    startPodPortForward: async (request) => {
      requests.push(['start', request]);
      return { id: 'forward-a', address: '127.0.0.1', localPort: 18080, remotePort: request.remotePort };
    },
    stopPodPortForward: async (request) => requests.push(['stop', request])
  });
  await store.getState().connectCluster(cluster('a'));
  await store.getState().openResource('Pod', { name: 'api-0', namespace: 'monitoring' });
  await store.getState().loadPodPortForwards();
  await store.getState().startPodPortForward({ localPort: 18080, remotePort: 8080 });
  assert.equal(store.getState().podForwards[0].address, '127.0.0.1');
  await store.getState().stopPodPortForward('forward-a');

  assert.deepEqual(requests, [
    ['list', { namespace: 'monitoring', podName: 'api-0' }],
    ['start', { namespace: 'monitoring', podName: 'api-0', localPort: 18080, remotePort: 8080 }],
    ['stop', { id: 'forward-a' }]
  ]);
  assert.deepEqual(store.getState().podForwards, []);
});

test('刪除 Pod 使用 UID 防止刪除已被取代的資源並關閉 Drawer', async () => {
  const deleteRequests = [];
  const store = createKubernetesSessionStore({
    connectCluster: async (request) => sessionFor(request),
    getResourceDetail: async () => ({ kind: 'Pod', name: 'api-0', namespace: 'default', uid: 'pod-a' }),
    deleteResource: async (request) => deleteRequests.push(request),
    getDashboard: async (namespace) => dashboardFor(namespace)
  });
  await store.getState().connectCluster(cluster('a'));
  await store.getState().openResource('Pod', { name: 'api-0', namespace: 'default' });
  await store.getState().deleteSelectedResource();

  assert.deepEqual(deleteRequests, [{ kind: 'pod', namespace: 'default', name: 'api-0', uid: 'pod-a', apiVersion: '' }]);
  assert.equal(store.getState().detailOpen, false);
  assert.equal(store.getState().selectedResource, null);
  assert.equal(store.getState().deleteLoading, false);
});

test('刪除非 Pod 資源會使用通用 Delete Resource API', async () => {
  const deleteRequests = [];
  const store = createKubernetesSessionStore({
    connectCluster: async (request) => sessionFor(request),
    getResourceDetail: async () => ({ kind: 'Deployment', name: 'api', namespace: 'default', uid: 'deploy-a' }),
    deleteResource: async (request) => deleteRequests.push(request),
    getDashboard: async (namespace) => dashboardFor(namespace)
  });
  await store.getState().connectCluster(cluster('a'));
  await store.getState().openResource('Deployment', { name: 'api', namespace: 'default' });
  await store.getState().deleteSelectedResource();

  assert.deepEqual(deleteRequests, [{ kind: 'deployment', namespace: 'default', name: 'api', uid: 'deploy-a', apiVersion: '' }]);
  assert.equal(store.getState().detailOpen, false);
});

test('刪除資源成功後會立即從 Dashboard 快照中移除該資源', async () => {
  let resolveDashboard;
  const dashboardPromise = new Promise(resolve => {
    resolveDashboard = resolve;
  });

  const store = createKubernetesSessionStore({
    connectCluster: async (request) => sessionFor(request),
    getResourceDetail: async () => ({ kind: 'Pod', name: 'api-0', namespace: 'default', uid: 'pod-a' }),
    deleteResource: async () => {},
    getDashboard: async () => dashboardPromise
  });
  await store.getState().connectCluster(cluster('a'));

  // 模擬 Dashboard 已經有 pods 的快照
  store.setState({
    dashboard: {
      pods: [
        { name: 'api-0', namespace: 'default' },
        { name: 'api-1', namespace: 'default' }
      ]
    }
  });

  await store.getState().openResource('Pod', { name: 'api-0', namespace: 'default' });
  await store.getState().deleteSelectedResource();

  const dashboard = store.getState().dashboard;
  assert.ok(dashboard);
  assert.equal(dashboard.pods.length, 1);
  assert.equal(dashboard.pods[0].name, 'api-1');

  // 清理 Promise 避免洩漏
  resolveDashboard(dashboardFor('default'));
});



test('開啟 Create Resource 會依目前 Namespace 載入 Pod 範本', async () => {
  const store = createKubernetesSessionStore({ connectCluster: async request => sessionFor(request) });
  await store.getState().connectCluster(cluster('a', 'monitoring'));
  store.getState().openCreateResource();

  assert.equal(store.getState().createOpen, true);
  assert.equal(store.getState().createResourceType, 'Pod');
  assert.match(store.getState().createResourceYAML, /kind: Pod/);
  assert.match(store.getState().createResourceYAML, /namespace: "monitoring"/);
});

test('切換 Create Resource 類型會替換對應 YAML 範本', async () => {
  const store = createKubernetesSessionStore({ connectCluster: async request => sessionFor(request) });
  await store.getState().connectCluster(cluster('a'));
  store.getState().openCreateResource();
  store.getState().selectCreateResourceType('CronJob');

  assert.equal(store.getState().createResourceType, 'CronJob');
  assert.match(store.getState().createResourceYAML, /apiVersion: batch\/v1/);
  assert.match(store.getState().createResourceYAML, /kind: CronJob/);
});

test('套用自訂 YAML 後關閉 Drawer 並重新整理 Dashboard', async () => {
  const createRequests = [];
  const store = createKubernetesSessionStore({
    connectCluster: async request => sessionFor(request),
    createResource: async request => {
      createRequests.push(request);
      return { apiVersion: 'v1', kind: 'Pod', name: 'custom-pod', namespace: 'default' };
    },
    getDashboard: async namespace => dashboardFor(namespace)
  });
  await store.getState().connectCluster(cluster('a'));
  store.getState().openCreateResource();
  const yaml = 'apiVersion: v1\nkind: Pod\nmetadata:\n  name: custom-pod';
  const result = await store.getState().applyCreateResource(yaml);

  assert.equal(result.name, 'custom-pod');
  assert.deepEqual(createRequests, [{ resourceType: 'Pod', namespace: 'default', yaml }]);
  assert.equal(store.getState().createOpen, false);
  assert.equal(store.getState().createError, '');
});

test('建立 Resource 失敗時保留 Drawer 與使用者 YAML', async () => {
  const store = createKubernetesSessionStore({
    connectCluster: async request => sessionFor(request),
    createResource: async () => { throw new Error('沒有建立 Pod 的權限。'); }
  });
  await store.getState().connectCluster(cluster('a'));
  store.getState().openCreateResource();
  const yaml = 'apiVersion: v1\nkind: Pod\nmetadata:\n  name: denied';
  await assert.rejects(store.getState().applyCreateResource(yaml), /沒有建立 Pod/);

  assert.equal(store.getState().createOpen, true);
  assert.equal(store.getState().createResourceYAML, yaml);
  assert.equal(store.getState().createLoading, false);
  assert.equal(store.getState().createError, '沒有建立 Pod 的權限。');
});

test('Save 會使用資源類型預設檔名並保留 Drawer', async () => {
  const saveRequests = [];
  const store = createKubernetesSessionStore({
    connectCluster: async request => sessionFor(request),
    saveResourceYAML: async (filename, content) => {
      saveRequests.push({ filename, content });
      return `/tmp/${filename}`;
    }
  });
  await store.getState().connectCluster(cluster('a'));
  store.getState().openCreateResource();
  store.getState().selectCreateResourceType('ReplicationController');
  const yaml = 'apiVersion: v1\nkind: ReplicationController\nmetadata:\n  name: custom-rc';
  const path = await store.getState().saveCreateResourceYAML(yaml);

  assert.equal(path, '/tmp/termix-replication-controller.yaml');
  assert.deepEqual(saveRequests, [{ filename: 'termix-replication-controller.yaml', content: yaml }]);
  assert.equal(store.getState().createOpen, true);
  assert.equal(store.getState().createSaving, false);
  assert.equal(store.getState().createSavedPath, path);
});

test('取消 Save 對話框不顯示錯誤', async () => {
  const store = createKubernetesSessionStore({
    connectCluster: async request => sessionFor(request),
    saveResourceYAML: async () => ''
  });
  await store.getState().connectCluster(cluster('a'));
  store.getState().openCreateResource();
  const path = await store.getState().saveCreateResourceYAML();

  assert.equal(path, '');
  assert.equal(store.getState().createOpen, true);
  assert.equal(store.getState().createSaving, false);
  assert.equal(store.getState().createSaveError, '');
  assert.equal(store.getState().createSavedPath, '');
});

test('Save 失敗時保留 YAML 與安全錯誤', async () => {
  const store = createKubernetesSessionStore({
    connectCluster: async request => sessionFor(request),
    saveResourceYAML: async () => { throw new Error('儲存 Kubernetes Resource YAML 失敗'); }
  });
  await store.getState().connectCluster(cluster('a'));
  store.getState().openCreateResource();
  const yaml = 'apiVersion: v1\nkind: Pod\nmetadata:\n  name: save-failed';
  await assert.rejects(store.getState().saveCreateResourceYAML(yaml), /儲存 Kubernetes/);

  assert.equal(store.getState().createResourceYAML, yaml);
  assert.equal(store.getState().createSaving, false);
  assert.equal(store.getState().createSaveError, '儲存 Kubernetes Resource YAML 失敗');
});

test('關閉 Drawer 與切換叢集會讓尚未完成的明細與 Logs 回應失效', async () => {
  let resolveDetail;
  let resolveLogs;
  const store = createKubernetesSessionStore({
    connectCluster: async (request) => sessionFor(request),
    getResourceDetail: async () => new Promise((resolve) => { resolveDetail = resolve; }),
    getPodLogs: async () => new Promise((resolve) => { resolveLogs = resolve; })
  });

  await store.getState().connectCluster(cluster('a'));
  const detailLoad = store.getState().openResource('Pod', { name: 'api-0', namespace: 'default' });
  store.getState().closeResourceDetail();
  resolveDetail({ name: 'api-0' });
  await detailLoad;
  assert.equal(store.getState().detailOpen, false);
  assert.equal(store.getState().resourceDetail, null);

  store.setState({ selectedResource: { kind: 'Pod', name: 'api-0', namespace: 'default' } });
  const logsLoad = store.getState().loadPodLogs();
  await store.getState().switchCluster(cluster('b', 'monitoring'));
  resolveLogs('舊叢集 Logs');
  await logsLoad;

  const state = store.getState();
  assert.equal(state.connectedCluster.clusterId, 'b');
  assert.equal(state.detailOpen, false);
  assert.equal(state.selectedResource, null);
  assert.equal(state.podLogs, '');
  assert.equal(state.logsLoading, false);
  assert.equal(state.logOptions, null);
});

test('資源明細與 Pod Logs API 以 request 物件呼叫動態 Wails binding', async () => {
  const originalWindow = globalThis.window;
  const detailRequests = [];
  const logsRequests = [];
  globalThis.window = {
    go: {
      app: {
        App: {
          GetKubernetesResourceDetail: async (request) => {
            detailRequests.push(request);
            return { name: request.name };
          },
          GetKubernetesPodLogs: async (request) => {
            logsRequests.push(request);
            return { container: request.container, content: 'log content', truncated: false };
          }
        }
      }
    }
  };

  const detailRequest = { kind: 'Pod', name: 'api-0', namespace: 'default' };
  const logsRequest = {
    namespace: 'default',
    podName: 'api-0',
    container: 'api',
    previous: false,
    tailLines: 200
  };
  try {
    assert.deepEqual(await KubernetesAPI.getResourceDetail(detailRequest), { name: 'api-0' });
    assert.deepEqual(await KubernetesAPI.getPodLogs(logsRequest), {
      container: 'api',
      content: 'log content',
      truncated: false
    });
    assert.deepEqual(detailRequests, [detailRequest]);
    assert.deepEqual(logsRequests, [logsRequest]);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test('Pod Delete 與 Port Forward API 使用對應的 Wails binding', async () => {
  const originalWindow = globalThis.window;
  const calls = [];
  globalThis.window = { go: { app: { App: {
    DeleteKubernetesPod: async request => calls.push(['delete', request]),
    DeleteKubernetesResource: async request => calls.push(['deleteResource', request]),
    StartKubernetesPodPortForward: async request => {
      calls.push(['start', request]);
      return { id: 'forward-a', ...request };
    },
    ListKubernetesPodPortForwards: async request => {
      calls.push(['list', request]);
      return [];
    },
    StopKubernetesPodPortForward: async request => calls.push(['stop', request])
  } } } };
  const pod = { namespace: 'default', podName: 'api-0' };
  try {
    await KubernetesAPI.deletePod({ ...pod, uid: 'pod-a' });
    await KubernetesAPI.deleteResource({ kind: 'deployment', namespace: 'default', name: 'api', uid: 'deploy-a' });
    await KubernetesAPI.startPodPortForward({ ...pod, localPort: 18080, remotePort: 8080 });
    await KubernetesAPI.listPodPortForwards(pod);
    await KubernetesAPI.stopPodPortForward({ id: 'forward-a' });
    assert.deepEqual(calls, [
      ['delete', { ...pod, uid: 'pod-a' }],
      ['deleteResource', { kind: 'deployment', namespace: 'default', name: 'api', uid: 'deploy-a' }],
      ['start', { ...pod, localPort: 18080, remotePort: 8080 }],
      ['list', pod],
      ['stop', { id: 'forward-a' }]
    ]);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test('Create Resource API 使用自訂 YAML 呼叫 Wails binding', async () => {
  const originalWindow = globalThis.window;
  const requests = [];
  globalThis.window = { go: { app: { App: {
    CreateKubernetesResource: async request => {
      requests.push(request);
      return { apiVersion: 'apps/v1', kind: 'Deployment', name: 'web', namespace: 'default' };
    }
  } } } };
  const request = {
    resourceType: 'Deployment',
    namespace: 'default',
    yaml: 'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: web'
  };
  try {
    const result = await KubernetesAPI.createResource(request);
    assert.deepEqual(requests, [request]);
    assert.equal(result.kind, 'Deployment');
    assert.equal(result.name, 'web');
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test('Save Resource YAML API 傳遞預設檔名與內容給 Wails binding', async () => {
  const originalWindow = globalThis.window;
  const calls = [];
  globalThis.window = { go: { app: { App: {
    SaveKubernetesResourceYAML: async (filename, content) => {
      calls.push({ filename, content });
      return `/Users/test/${filename}`;
    }
  } } } };
  try {
    const path = await KubernetesAPI.saveResourceYAML('termix-pod.yaml', 'kind: Pod');
    assert.equal(path, '/Users/test/termix-pod.yaml');
    assert.deepEqual(calls, [{ filename: 'termix-pod.yaml', content: 'kind: Pod' }]);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test('Pod Logs 與 Shell Action 在固定 Kubernetes Session 內切換內容', async () => {
  const logRequests = [];
  const store = createKubernetesSessionStore({
    connectCluster: async request => sessionFor(request),
    getPodLogs: async request => {
      logRequests.push(request);
      return { content: 'ready', truncated: false };
    }
  });
  await store.getState().connectCluster(cluster('a'));
  const pod = { name: 'api-0', namespace: 'default', phase: 'Running', containers: [{ name: 'api', ports: [] }] };

  await store.getState().openPodLogsView(pod, 'api');
  assert.equal(store.getState().sessionOpen, true);
  assert.equal(store.getState().podActionView.type, 'logs');
  assert.equal(store.getState().podLogs, 'ready');
  assert.equal(logRequests[0].podName, 'api-0');

  store.getState().openPodShellView(pod, 'api');
  assert.equal(store.getState().podActionView.type, 'shell');
  assert.equal(store.getState().podActionView.container, 'api');
  store.getState().closePodActionView();
  assert.equal(store.getState().podActionView, null);
  assert.equal(store.getState().sessionOpen, true);
});

test('Pod Shell API 使用專用 Wails bindings', async () => {
  const originalWindow = globalThis.window;
  const calls = [];
  globalThis.window = { go: { app: { App: {
    StartKubernetesPodShell: async request => ({ sessionId: 'shell-a', ...request }),
    WriteKubernetesPodShellInput: async request => calls.push(['write', request]),
    ResizeKubernetesPodShell: async request => calls.push(['resize', request]),
    CloseKubernetesPodShell: async sessionId => calls.push(['close', sessionId])
  } } } };
  try {
    const session = await KubernetesAPI.startPodShell({ namespace: 'default', podName: 'api-0', container: 'api' });
    await KubernetesAPI.writePodShellInput({ sessionId: session.sessionId, data: 'ls\r' });
    await KubernetesAPI.resizePodShell({ sessionId: session.sessionId, cols: 100, rows: 30 });
    await KubernetesAPI.closePodShell(session.sessionId);
    assert.deepEqual(calls, [
      ['write', { sessionId: 'shell-a', data: 'ls\r' }],
      ['resize', { sessionId: 'shell-a', cols: 100, rows: 30 }],
      ['close', 'shell-a']
    ]);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

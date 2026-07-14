export interface KubernetesClusterProfile {
  id: string;
  displayName: string;
  contextName: string;
  clusterName: string;
  server: string;
  userName: string;
  namespace: string;
  certificateAuthority: string;
  insecureSkipTLSVerify: boolean;
  source: string;
  isCurrent: boolean;
  kubeconfigPath: string;
  createdAt: string;
  updatedAt: string;
}

export interface KubernetesContextSwitchRequest {
  contextName: string;
  kubeconfigPath: string;
}

export interface KubernetesConnectRequest {
  clusterId: string;
  displayName: string;
  contextName: string;
  clusterName: string;
  server: string;
  kubeconfigPath: string;
  namespace: string;
}

export interface KubernetesSession extends KubernetesConnectRequest {
  sessionId: string;
  connectedAt: string;
}

export interface KubernetesDashboardRequest {
  namespace: string;
  scope?: string;
}

export interface KubernetesResourceIdentity {
  kind: string;
  name: string;
  namespace: string;
}

export interface KubernetesResourceDetailRequest
  extends KubernetesResourceIdentity {
  // 選填 GVK 版本；Pod 走 typed 可省略，其餘資源建議帶入以精準定位。
  apiVersion?: string;
}

export interface KubernetesPodLogsRequest {
  namespace: string;
  podName: string;
  container: string;
  previous: boolean;
  tailLines: number;
}

export interface KubernetesPodLogs {
  container: string;
  content: string;
  truncated: boolean;
}

export interface KubernetesPodShellStartRequest {
  namespace: string;
  podName: string;
  container: string;
  cols: number;
  rows: number;
}

export interface KubernetesPodShellSessionRequest {
  sessionId: string;
  data: string;
  cols: number;
  rows: number;
}

export interface KubernetesPodShellSession {
  sessionId: string;
  namespace: string;
  podName: string;
  container: string;
}

export interface KubernetesPodDeleteRequest {
  namespace: string;
  podName: string;
  uid: string;
}

export interface KubernetesResourceDeleteRequest
  extends KubernetesResourceIdentity {
  uid: string;
  // 選填 GVK 版本；供後端精準定位要刪除的資源。
  apiVersion?: string;
}

// 更新資源：GVK/name 由 yaml 內解析，namespace 僅為 fallback。
export interface KubernetesResourceUpdateRequest {
  namespace: string;
  yaml: string;
}

export interface KubernetesResourceUpdateResult
  extends KubernetesResourceIdentity {
  apiVersion: string;
}

// 調整副本數（僅 Deployment / StatefulSet）：以 kind/name/namespace + apiVersion 定位，patch spec.replicas。
export interface KubernetesResourceScaleRequest
  extends KubernetesResourceIdentity {
  apiVersion?: string;
  replicas: number;
}

export interface KubernetesPodPortForwardRequest {
  namespace: string;
  podName: string;
  localPort: number;
  remotePort: number;
}

export interface KubernetesPodPortForwardListRequest {
  namespace: string;
  podName: string;
}

export interface KubernetesPodPortForwardStopRequest {
  id: string;
}

export interface KubernetesPodPortForward {
  id: string;
  namespace: string;
  podName: string;
  serviceName: string;
  address: string;
  localPort: number;
  remotePort: number;
  startedAt: string;
}

export interface KubernetesServicePortForwardRequest {
  namespace: string;
  serviceName: string;
  localPort: number;
  remotePort: number;
}

export interface KubernetesServicePortForwardListRequest {
  namespace: string;
  serviceName: string;
}

export interface KubernetesResourceCreateRequest {
  resourceType: string;
  namespace: string;
  yaml: string;
}

export interface KubernetesResourceCreateResult
  extends KubernetesResourceIdentity {
  apiVersion: string;
}

export interface KubernetesKeyValue {
  key: string;
  value: string;
}

export interface KubernetesResourceDetail
  extends KubernetesResourceIdentity {
  status: string;
  createdAt: string;
  uid: string;
  apiVersion: string;
  yaml: string;
  labels: KubernetesKeyValue[];
  fields: KubernetesKeyValue[];
  eventsError: string;
  [key: string]: unknown;
}

// 獨立查詢資源相關事件（抽屜開啟後非同步延後載入）。
export interface KubernetesResourceEventsRequest
  extends KubernetesResourceIdentity {
  uid: string;
}

export interface KubernetesResourceEvents {
  events: unknown[];
  eventsError: string;
}

// 即時取回單一 Secret data key 的明文值（點擊複製 / 查看明文時才呼叫）。
export interface KubernetesSecretValueRequest {
  namespace: string;
  name: string;
  key: string;
}

export interface KubernetesSecretValue {
  key: string;
  value: string;
}

export interface KubernetesDashboardSnapshot {
  sessionId: string;
  clusterName: string;
  contextName: string;
  namespace: string;
  serverVersion: string;
  generatedAt: string;
  namespaces: string[];
  resourceErrors: Record<string, string>;
  events: unknown[];
  [key: string]: unknown;
}


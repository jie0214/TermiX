import { t } from '../../i18n/index.ts';

export const DEFAULT_KUBERNETES_CLUSTER = Object.freeze({
  id: '',
  displayName: '',
  contextName: '',
  clusterName: '',
  server: '',
  userName: '',
  namespace: 'default',
  certificateAuthority: '',
  insecureSkipTLSVerify: false,
  source: 'managed',
  isCurrent: false,
  kubeconfigPath: '~/.kube/config',
  createdAt: '',
  updatedAt: ''
});

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function createKubernetesDraftId() {
  return `k8s_draft_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeKubernetesCluster(cluster = {}) {
  if (!cluster || typeof cluster !== 'object') return null;

  const contextName = text(cluster.contextName || cluster.context);
  const clusterName = text(cluster.clusterName || cluster.cluster);
  const id = text(cluster.id) || [text(cluster.kubeconfigPath), contextName].filter(Boolean).join('::') || createKubernetesDraftId();

  return {
    ...DEFAULT_KUBERNETES_CLUSTER,
    ...cluster,
    id,
    displayName: text(cluster.displayName || cluster.name) || contextName || clusterName || t('k8s.model.unnamedCluster'),
    contextName,
    clusterName,
    server: text(cluster.server),
    userName: text(cluster.userName || cluster.user),
    namespace: text(cluster.namespace) || 'default',
    certificateAuthority: text(cluster.certificateAuthority),
    insecureSkipTLSVerify: Boolean(cluster.insecureSkipTLSVerify),
    source: text(cluster.source) || 'discovered',
    isCurrent: Boolean(cluster.isCurrent),
    kubeconfigPath: text(cluster.kubeconfigPath) || '~/.kube/config',
    createdAt: text(cluster.createdAt),
    updatedAt: text(cluster.updatedAt)
  };
}

export function normalizeKubernetesClusters(clusters = []) {
  const records = new Map();
  for (const rawCluster of Array.isArray(clusters) ? clusters : []) {
    const cluster = normalizeKubernetesCluster(rawCluster);
    if (cluster) records.set(cluster.id, cluster);
  }
  return [...records.values()].sort((left, right) => {
    if (left.isCurrent !== right.isCurrent) return left.isCurrent ? -1 : 1;
    return left.displayName.localeCompare(right.displayName, 'zh-Hant');
  });
}

export function createKubernetesClusterDraft(source = {}) {
  const normalized = normalizeKubernetesCluster({
    ...DEFAULT_KUBERNETES_CLUSTER,
    ...source,
    id: source.id || createKubernetesDraftId(),
    source: source.source || 'managed'
  });
  return normalized;
}

export function getAvailableKubernetesUsers(clusters = []) {
  return [...new Set((Array.isArray(clusters) ? clusters : [])
    .map(cluster => text(cluster?.userName))
    .filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, 'zh-Hant'));
}

export function validateKubernetesCluster(cluster = {}) {
  const normalized = normalizeKubernetesCluster(cluster);
  const errors = {};

  if (!normalized.displayName) errors.displayName = t('k8s.model.errDisplayName');
  if (!normalized.contextName) errors.contextName = t('k8s.model.errContextName');
  if (!normalized.clusterName) errors.clusterName = t('k8s.model.errClusterName');
  if (!normalized.server) {
    errors.server = t('k8s.model.errServerRequired');
  } else {
    try {
      const url = new URL(normalized.server);
      if (!['https:', 'http:'].includes(url.protocol)) {
        errors.server = t('k8s.model.errServerScheme');
      }
    } catch (e) {
      errors.server = t('k8s.model.errServerFormat');
    }
  }
  if (!normalized.userName) errors.userName = t('k8s.model.errUserName');
  if (!normalized.kubeconfigPath) errors.kubeconfigPath = t('k8s.model.errKubeconfigPath');
  if (normalized.certificateAuthority && normalized.insecureSkipTLSVerify) {
    errors.insecureSkipTLSVerify = t('k8s.model.errCaAndInsecure');
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    value: normalized
  };
}

export function assertValidKubernetesCluster(cluster = {}) {
  const result = validateKubernetesCluster(cluster);
  if (!result.valid) {
    const error = new Error(Object.values(result.errors)[0]);
    error.validationErrors = result.errors;
    throw error;
  }
  return result.value;
}

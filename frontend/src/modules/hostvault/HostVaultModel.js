const CUSTOM_COMPONENTS_KEY = 'termix-custom-components';

export const SECRET_FIELD_DEFINITIONS = [
  {
    key: 'sshPassword',
    refKey: 'sshPasswordRef',
    inputId: 'sshPassword',
    actionInputId: 'sshPasswordAction',
    statusId: 'sshPasswordStatus',
    label: 'SSH Password'
  },
  {
    key: 'keyPassphrase',
    refKey: 'keyPassphraseRef',
    inputId: 'keyPassphrase',
    actionInputId: 'keyPassphraseAction',
    statusId: 'keyPassphraseStatus',
    label: 'Key Passphrase'
  },
  {
    key: 'sudoPassword',
    refKey: 'sudoPasswordRef',
    inputId: 'sudoPassword',
    actionInputId: 'sudoPasswordAction',
    statusId: 'sudoPasswordStatus',
    label: 'Sudo Password'
  }
];

export const DEFAULT_HOST_CONFIG = {
  host: '127.0.0.1',
  port: 22,
  username: 'user',
  authMode: 'password',
  privateKeyPath: '',
  certPath: '',
  customComponents: [],
  showSnippetsInControlPanel: true,
  startupSnippetIds: [],
  startupCommandMode: 'none',
  startupSnippetId: '',
  startupCommandText: '',
  secretRefs: {
    sshPasswordRef: '',
    keyPassphraseRef: '',
    sudoPasswordRef: ''
  }
};

export function getAvailableControlPanelIds() {
  try {
    const rawComponents = localStorage.getItem(CUSTOM_COMPONENTS_KEY);
    const components = rawComponents ? JSON.parse(rawComponents) : [];
    return new Set((Array.isArray(components) ? components : [])
      .filter(comp => comp && comp.id && ['info', 'switch', 'function'].includes(comp.type))
      .map(comp => comp.id));
  } catch (e) {
    return new Set();
  }
}

function normalizeMountedComponents(customComponents, availableIds) {
  return (Array.isArray(customComponents) ? customComponents : [])
    .filter(item => item && item.id && item.visible && availableIds.has(item.id))
    .map((item, idx) => ({ id: item.id, visible: true, order: item.order ?? idx }))
    .sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999))
    .map((item, idx) => ({ ...item, order: idx }));
}

function normalizeLegacySecretRefs(config = {}, hostId = '') {
  const secretRefs = {
    sshPasswordRef: config.secretRefs?.sshPasswordRef || config.secret?.sshPasswordRef || '',
    keyPassphraseRef: config.secretRefs?.keyPassphraseRef || config.secret?.keyPassphraseRef || '',
    sudoPasswordRef: config.secretRefs?.sudoPasswordRef || config.secret?.sudoPasswordRef || ''
  };

  if (!secretRefs.sshPasswordRef && config.password) {
    secretRefs.sshPasswordRef = buildDefaultSecretRef(hostId, 'ssh-password');
  }
  if (!secretRefs.keyPassphraseRef && config.keyPassphrase) {
    secretRefs.keyPassphraseRef = buildDefaultSecretRef(hostId, 'key-passphrase');
  }
  if (!secretRefs.sudoPasswordRef && config.sudoPassword) {
    secretRefs.sudoPasswordRef = buildDefaultSecretRef(hostId, 'sudo-password');
  }

  return secretRefs;
}

function normalizeRawSecretStatus(statusValue) {
  if (!statusValue || typeof statusValue !== 'string') return '';
  const normalized = statusValue.trim().toLowerCase();
  if (['stored', 'saved', 'configured', 'present', 'exists'].includes(normalized)) return 'stored';
  if (['updated', 'pending', 'dirty', 'new'].includes(normalized)) return 'updated';
  if (['cleared', 'deleted', 'removed', 'empty'].includes(normalized)) return 'cleared';
  if (['unset', 'missing', 'none', 'not-set'].includes(normalized)) return 'unset';
  return '';
}

function getSecretStatusValue(status) {
  if (!status) return '';
  if (typeof status === 'string') return normalizeRawSecretStatus(status);
  if (typeof status !== 'object') return '';
  return normalizeRawSecretStatus(status.status || status.state || status.value || '');
}

function normalizeSecretStatusEntry(statusValue, refValue) {
  const normalizedStatus = getSecretStatusValue(statusValue);
  if (typeof statusValue === 'object' && statusValue) {
    const configured = Boolean(statusValue.configured || statusValue.ref || refValue);
    const stored = Boolean(statusValue.stored || normalizedStatus === 'stored');
    const length = Number.isFinite(Number(statusValue.length)) ? Math.max(0, Number(statusValue.length)) : 0;
    return {
      status: normalizedStatus || (stored ? 'stored' : (configured ? 'unset' : 'unset')),
      ref: statusValue.ref || refValue || '',
      configured,
      stored,
      length
    };
  }
  if (normalizedStatus) {
    return {
      status: normalizedStatus,
      ref: refValue || '',
      configured: Boolean(refValue),
      stored: normalizedStatus === 'stored',
      length: 0
    };
  }
  if (refValue) {
    return {
      status: 'unset',
      ref: refValue,
      configured: true,
      stored: false,
      length: 0
    };
  }
  return {
    status: 'unset',
    ref: '',
    configured: false,
    stored: false,
    length: 0
  };
}

export function buildDefaultSecretRef(hostId, suffix) {
  if (!hostId) return '';
  return `host/${hostId}/${suffix}`;
}

export function ensureSecretRefs(hostId, config = {}) {
  const existingRefs = normalizeLegacySecretRefs(config, hostId);
  return {
    sshPasswordRef: existingRefs.sshPasswordRef || buildDefaultSecretRef(hostId, 'ssh-password'),
    keyPassphraseRef: existingRefs.keyPassphraseRef || buildDefaultSecretRef(hostId, 'key-passphrase'),
    sudoPasswordRef: existingRefs.sudoPasswordRef || buildDefaultSecretRef(hostId, 'sudo-password')
  };
}

export function getHostSecretStatusMap(host = {}) {
  const config = host.config || {};
  const refs = ensureSecretRefs(host.id || '', config);
  const rawStatusMap = host.secretStatus || host.secretStatuses || host.secretState || config.secretStatus || {};

  return SECRET_FIELD_DEFINITIONS.reduce((acc, field) => {
    const refValue = refs[field.refKey];
    acc[field.key] = normalizeSecretStatusEntry(rawStatusMap[field.key] || rawStatusMap[field.refKey] || '', refValue);
    return acc;
  }, {});
}

export function getSecretStatusLabel(status) {
  const statusValue = typeof status === 'object' && status ? status.status : status;
  switch (statusValue) {
    case 'stored':
      return '已儲存於系統鑰匙圈';
    case 'updated':
      return '本次更新';
    case 'cleared':
      return '已清除';
    case 'unset':
    default:
      return '未設定';
  }
}

export function getSecretMask(status) {
  const statusEntry = normalizeSecretStatusEntry(status, status?.ref || '');
  if (statusEntry.status !== 'stored') return '';
  return '*'.repeat(statusEntry.length > 0 ? statusEntry.length : 4);
}

export function normalizeHostRecord(host, availableIds = getAvailableControlPanelIds()) {
  if (!host || typeof host !== 'object') return null;

  const normalizedId = host.id || `h_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const config = {
    ...DEFAULT_HOST_CONFIG,
    ...(host.config || {})
  };
  const secretRefs = ensureSecretRefs(normalizedId, config);

  const normalizedHost = {
    ...host,
    id: normalizedId,
    label: host.label || host.alias || `${config.username || 'user'}@${config.host || 'host'}`,
    alias: host.alias || '',
    groupId: host.groupId || null,
    config: {
      ...config,
      secretRefs,
      customComponents: normalizeMountedComponents(config.customComponents, availableIds),
      showSnippetsInControlPanel: config.showSnippetsInControlPanel !== false,
      startupSnippetIds: Array.isArray(config.startupSnippetIds)
        ? config.startupSnippetIds.filter(Boolean)
        : [],
      startupCommandMode: config.startupCommandMode || 'none',
      startupSnippetId: config.startupSnippetId || '',
      startupCommandText: config.startupCommandText || ''
    }
  };

  delete normalizedHost.config.password;
  delete normalizedHost.config.keyPassword;
  delete normalizedHost.config.keyPassphrase;
  delete normalizedHost.config.sudoPassword;
  normalizedHost.secretStatus = getHostSecretStatusMap(normalizedHost);

  return normalizedHost;
}

export function normalizeGroupRecord(group) {
  if (!group || typeof group !== 'object') return null;
  return {
    ...group,
    id: group.id || `g_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    name: group.name || 'Untitled Group'
  };
}

export function normalizeVaultData({ hosts = [], groups = [] } = {}, availableIds = getAvailableControlPanelIds()) {
  return {
    hosts: (Array.isArray(hosts) ? hosts : [])
      .map(host => normalizeHostRecord(host, availableIds))
      .filter(Boolean),
    groups: (Array.isArray(groups) ? groups : [])
      .map(normalizeGroupRecord)
      .filter(Boolean)
  };
}

export function createHostProfile(hostId, source = {}, overrides = {}) {
  const config = {
    ...DEFAULT_HOST_CONFIG,
    ...(source.config || {}),
    ...(overrides.config || {})
  };
  const mergedHost = {
    ...source,
    ...overrides,
    id: hostId || source.id,
    alias: overrides.alias ?? source.alias ?? '',
    groupId: overrides.groupId ?? source.groupId ?? null,
    config: {
      ...config,
      secretRefs: ensureSecretRefs(hostId || source.id, config)
    }
  };

  delete mergedHost.config.password;
  delete mergedHost.config.keyPassphrase;
  delete mergedHost.config.keyPassword;
  delete mergedHost.config.sudoPassword;

  mergedHost.label = mergedHost.alias || `${mergedHost.config.username || 'user'}@${mergedHost.config.host || 'host'}`;

  return normalizeHostRecord(mergedHost, getAvailableControlPanelIds());
}

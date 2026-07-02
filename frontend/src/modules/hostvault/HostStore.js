import { createStore } from 'zustand/vanilla';
import { HostAPI } from './HostAPI';
import { confirmDialog } from '../../components/feedback/confirmDialog';
import { t } from '../../i18n/index.ts';
import {
  createHostProfile,
  ensureSecretRefs,
  getAvailableControlPanelIds,
  normalizeVaultData
} from './HostVaultModel';

const LEGACY_HOSTS_KEY = 'termix-connection-history';
const HOSTVAULT_MIGRATION_VERSION_KEY = 'hostVaultMigrationVersion';
const HOSTVAULT_MIGRATION_VERSION = 1;

async function enrichSecretStatus(hosts = []) {
  const enriched = await Promise.all((Array.isArray(hosts) ? hosts : []).map(async (host) => {
    return enrichHostSecretStatus(host);
  }));

  return normalizeVaultData({ hosts: enriched, groups: [] }, getAvailableControlPanelIds()).hosts;
}

async function enrichHostSecretStatus(host) {
  if (!host?.id) return host;
  try {
    const secretStatus = await HostAPI.getHostSecretStatus(host.id);
    if (secretStatus && typeof secretStatus === 'object') {
      return {
        ...host,
        secretStatus: {
          ...(host.secretStatus || {}),
          ...secretStatus
        }
      };
    }
  } catch (e) {
    if (!/缺少後端 API/.test(String(e?.message || e))) {
      console.warn('[TermiX] 讀取 secret 狀態失敗', e);
    }
  }
  return host;
}

function readLegacyVaultData() {
  try {
    const raw = localStorage.getItem(LEGACY_HOSTS_KEY);
    if (!raw) return { hosts: [], groups: [] };
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return { hosts: parsed, groups: [] };
    if (parsed && typeof parsed === 'object') {
      return {
        hosts: Array.isArray(parsed.hosts) ? parsed.hosts : [],
        groups: Array.isArray(parsed.groups) ? parsed.groups : []
      };
    }
  } catch (e) {
    console.warn('[TermiX] 舊 Host localStorage 解析失敗，略過自動遷移', e);
  }
  return { hosts: [], groups: [] };
}

function hasLegacySecretValues(hosts = []) {
  return hosts.some((host) => {
    const config = host?.config || {};
    return Boolean(config.password || config.keyPassphrase || config.keyPassword || config.sudoPassword);
  });
}

async function shouldMigrateLegacySecrets(hosts = []) {
  if (!hasLegacySecretValues(hosts)) return false;
  if (typeof document === 'undefined' || !document.body) {
    return true;
  }
  return confirmDialog(t('hostvault.legacyMigrateConfirm'), { title: t('hostvault.legacyMigrateTitle') });
}

function buildSecretMutation(ref, value) {
  if (!value) return null;
  return {
    ref,
    value,
    hasValue: true,
    clear: false
  };
}

function buildLegacySecretsPayload(hostId, config = {}, importSecretValues = false) {
  if (!importSecretValues) return {};
  const refs = ensureSecretRefs(hostId, config);
  const payload = {};
  const authMode = config.authMode || 'password';
  const legacyPassword = config.password || '';
  const keyPassphrase = config.keyPassphrase || config.keyPassword || '';

  if (legacyPassword && authMode === 'key') {
    payload.keyPassphrase = buildSecretMutation(refs.keyPassphraseRef, legacyPassword);
  } else if (legacyPassword) {
    payload.sshPassword = buildSecretMutation(refs.sshPasswordRef, legacyPassword);
  }
  if (keyPassphrase) {
    payload.keyPassphrase = buildSecretMutation(refs.keyPassphraseRef, keyPassphrase);
  }
  if (config.sudoPassword) {
    payload.sudoPassword = buildSecretMutation(refs.sudoPasswordRef, config.sudoPassword);
  }

  return Object.fromEntries(Object.entries(payload).filter(([, value]) => Boolean(value)));
}

function normalizeLegacyGroups(groups = []) {
  const seen = new Set();
  return (Array.isArray(groups) ? groups : [])
    .filter(group => group && group.id && !seen.has(group.id) && seen.add(group.id));
}

function normalizeLegacyHostGroup(host = {}, validGroupIds = new Set()) {
  const groupId = host.groupId || host.config?.groupId || '';
  if (!groupId || validGroupIds.has(groupId)) {
    return host;
  }
  return {
    ...host,
    groupId: null
  };
}

function getMigrationVersion(settings = {}) {
  const value = settings[HOSTVAULT_MIGRATION_VERSION_KEY];
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function markMigrationComplete(settings = {}) {
  await HostAPI.saveAppSettings({
    ...settings,
    [HOSTVAULT_MIGRATION_VERSION_KEY]: HOSTVAULT_MIGRATION_VERSION
  });
}

async function migrateLegacyHostVaultIfNeeded(snapshot = { hosts: [], groups: [] }) {
  let settings = {};
  try {
    settings = await HostAPI.getAppSettings() || {};
  } catch (e) {
    console.warn('[TermiX] 讀取 HostVault migration 設定失敗，略過自動遷移', e);
    return false;
  }

  if (getMigrationVersion(settings) >= HOSTVAULT_MIGRATION_VERSION) {
    return false;
  }

  const legacy = readLegacyVaultData();
  if ((snapshot.hosts || []).length > 0 || legacy.hosts.length === 0) {
    localStorage.removeItem(LEGACY_HOSTS_KEY);
    await markMigrationComplete(settings);
    return false;
  }

  const importSecretValues = await shouldMigrateLegacySecrets(legacy.hosts);
  const legacyGroups = normalizeLegacyGroups(legacy.groups);
  const validGroupIds = new Set(legacyGroups.map(group => group.id));
  for (const group of legacyGroups) {
    await HostAPI.saveGroup(group);
  }
  for (const legacyHost of legacy.hosts) {
    const hostId = legacyHost.id || `h_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    const normalizedLegacyHost = normalizeLegacyHostGroup(legacyHost, validGroupIds);
    const hostProfile = createHostProfile(hostId, normalizedLegacyHost, normalizedLegacyHost);
    const secretsPayload = buildLegacySecretsPayload(hostId, legacyHost.config || {}, importSecretValues);
    await HostAPI.saveHost(hostProfile, secretsPayload);
  }

  localStorage.removeItem(LEGACY_HOSTS_KEY);
  await markMigrationComplete(settings);
  return true;
}

export const hostStore = createStore((set, get) => ({
  hosts: [],
  groups: [],
  awsIntegrations: [],
  isLoading: false,
  loadError: '',
  activeGroupId: null,
  searchQuery: '',
  drawerOpen: false,
  drawerMode: 'host',
  selectedHost: null,
  selectedTab: 'hosts',

  applyVaultData: (payload) => {
    const normalized = normalizeVaultData(payload, getAvailableControlPanelIds());
    set({
      hosts: normalized.hosts,
      groups: normalized.groups
    });
    return normalized;
  },

  loadFromBackend: async () => {
    set({ isLoading: true, loadError: '' });
    try {
      let payload = await HostAPI.loadHostVault();
      if (await migrateLegacyHostVaultIfNeeded(payload)) {
        payload = await HostAPI.loadHostVault();
      }
      const normalized = get().applyVaultData(payload);
      const hostsWithStatus = await enrichSecretStatus(normalized.hosts);
      let awsIntegrations = [];
      try {
        awsIntegrations = await HostAPI.listAWSIntegrations() || [];
      } catch (awsErr) {
        console.warn('[TermiX] 載入 AWS 整合配置失敗：', awsErr);
      }
      set({
        hosts: hostsWithStatus,
        awsIntegrations,
        isLoading: false,
        loadError: ''
      });
      return { hosts: hostsWithStatus, groups: normalized.groups };
    } catch (e) {
      const message = e?.message || String(e);
      set({
        isLoading: false,
        loadError: message
      });
      throw e;
    }
  },

  refreshHosts: async () => get().loadFromBackend(),

  loadFromLocalStorage: async () => get().loadFromBackend(),

  setActiveGroupId: (activeGroupId) => set({ activeGroupId }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setDrawerOpen: (drawerOpen) => set({ drawerOpen }),
  setDrawerMode: (drawerMode) => set({ drawerMode }),
  setSelectedHost: (selectedHost) => set({ selectedHost }),
  setSelectedTab: (selectedTab) => set({ selectedTab }),

  refreshHostSecretStatus: async (hostId) => {
    const currentHost = get().hosts.find(item => item.id === hostId);
    if (!currentHost) return null;

    const enrichedHost = await enrichHostSecretStatus(currentHost);
    const normalizedHost = createHostProfile(enrichedHost.id, currentHost, enrichedHost);
    const currentHosts = get().hosts.filter(item => item.id !== normalizedHost.id);
    set({
      hosts: [...currentHosts, normalizedHost].sort((a, b) => (a.alias || a.label || '').localeCompare(b.alias || b.label || '')),
      selectedHost: get().selectedHost?.id === normalizedHost.id ? normalizedHost : get().selectedHost
    });
    return normalizedHost;
  },

  saveHost: async ({ hostId, sourceHost, overrides, secretsPayload }) => {
    const resolvedId = hostId || sourceHost?.id || `h_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    const hostProfile = createHostProfile(resolvedId, sourceHost, overrides);
    const saved = await HostAPI.saveHost(hostProfile, secretsPayload || {});
    const savedWithSecretStatus = await enrichHostSecretStatus(saved || hostProfile);
    const normalizedHost = createHostProfile(savedWithSecretStatus?.id || resolvedId, hostProfile, savedWithSecretStatus || {});
    const currentHosts = get().hosts.filter(item => item.id !== normalizedHost.id);
    set({
      hosts: [...currentHosts, normalizedHost].sort((a, b) => (a.alias || a.label || '').localeCompare(b.alias || b.label || ''))
    });
    return normalizedHost;
  },

  updateHost: async (id, updatedFields, secretsPayload = null) => {
    const currentHost = get().hosts.find(item => item.id === id);
    if (!currentHost) {
      throw new Error(`找不到 Host：${id}`);
    }
    return get().saveHost({
      hostId: id,
      sourceHost: currentHost,
      overrides: updatedFields,
      secretsPayload: secretsPayload || {}
    });
  },

  deleteHost: async (id) => {
    await HostAPI.deleteHost(id);
    set({
      hosts: get().hosts.filter(item => item.id !== id),
      selectedHost: get().selectedHost?.id === id ? null : get().selectedHost
    });
  },

  saveGroup: async (group) => {
    const payload = {
      ...group,
      id: group?.id || `g_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
    };
    const saved = await HostAPI.saveGroup(payload);
    const normalized = normalizeVaultData({ groups: [saved || payload] }).groups[0];
    const currentGroups = get().groups.filter(item => item.id !== normalized.id);
    set({
      groups: [...currentGroups, normalized].sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    });
    return normalized;
  },

  addGroup: async (group) => get().saveGroup(group),

  updateGroup: async (id, updatedFields) => {
    const currentGroup = get().groups.find(item => item.id === id);
    if (!currentGroup) {
      throw new Error(`找不到 Group：${id}`);
    }
    return get().saveGroup({
      ...currentGroup,
      ...updatedFields,
      id
    });
  },

  deleteGroup: async (id) => {
    await HostAPI.deleteGroup(id);
    set({
      groups: get().groups.filter(item => item.id !== id),
      hosts: get().hosts.map(host => host.groupId === id ? { ...host, groupId: null } : host),
      activeGroupId: get().activeGroupId === id ? null : get().activeGroupId
    });
  },

  saveAWSIntegration: async (integration, secrets, options = {}) => {
    const previousGroupId = options.previousGroupId || '';
    const saved = await HostAPI.saveAWSIntegration(integration, secrets, previousGroupId);
    const result = saved || integration;
    const currentIntegrations = get().awsIntegrations || [];
    const newIntegrations = currentIntegrations.filter(item => item.groupId !== result.groupId && item.groupId !== previousGroupId);
    set({
      awsIntegrations: [...newIntegrations, result]
    });
    return result;
  },

  updateAWSIntegration: async (id, updatedFields) => {
    const currentIntegrations = get().awsIntegrations || [];
    const current = currentIntegrations.find(item => item.id === id);
    if (!current) {
      throw new Error(`找不到 AWS 整合：${id}`);
    }
    const updated = {
      ...current,
      ...updatedFields,
      id
    };
    const saved = await HostAPI.saveAWSIntegration(updated);
    const result = saved || updated;
    const newIntegrations = currentIntegrations.filter(item => item.id !== id);
    set({
      awsIntegrations: [...newIntegrations, result]
    });
    return result;
  },

  deleteAWSIntegration: async (groupId) => {
    const normalizedGroupId = String(groupId || '').trim();
    if (!normalizedGroupId) {
      throw new Error('找不到要刪除的 AWS Integration 群組');
    }

    await HostAPI.deleteAWSIntegration(normalizedGroupId);
    set((state) => ({
      awsIntegrations: (state.awsIntegrations || []).filter(item => item.groupId !== normalizedGroupId)
    }));
  }
}));

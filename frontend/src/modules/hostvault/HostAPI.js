import {
  getAppBinding,
  requireAppBinding
} from '../../platform/wails';

function ensureMethod(methodNames) {
  const names = Array.isArray(methodNames) ? methodNames : [methodNames];
  for (const methodName of names) {
    const binding = getAppBinding(methodName);
    if (typeof binding === 'function') {
      return { methodName, binding };
    }
  }

  throw new Error(`缺少後端 API：${names.join(' / ')}`);
}

function parseOperationPayload(result) {
  if (!result || typeof result !== 'object') return result;
  if (!Object.prototype.hasOwnProperty.call(result, 'success')) return result;
  if (!result.success) {
    throw new Error(result.error || '後端操作失敗');
  }
  if (!result.output) return null;
  try {
    return JSON.parse(result.output);
  } catch (e) {
    return result.output;
  }
}

function normalizeVaultPayload(payload) {
  if (Array.isArray(payload)) {
    return { hosts: payload, groups: [] };
  }
  if (payload && typeof payload === 'object') {
    if (Array.isArray(payload.hosts) || Array.isArray(payload.groups)) {
      return {
        hosts: Array.isArray(payload.hosts) ? payload.hosts : [],
        groups: Array.isArray(payload.groups) ? payload.groups : []
      };
    }
    if (Array.isArray(payload.items)) {
      return {
        hosts: payload.items,
        groups: Array.isArray(payload.groups) ? payload.groups : []
      };
    }
  }
  return { hosts: [], groups: [] };
}

async function callApp(methodNames, ...args) {
  const { binding } = ensureMethod(methodNames);
  const result = await binding(...args);
  return parseOperationPayload(result);
}

export const HostAPI = {
  saveJSONFile: (filename, data) =>
    requireAppBinding('SaveJSONFile')(filename, data),
  saveBackupFile: (filename, data, format) =>
    requireAppBinding('SaveBackupFile')(filename, data, format),
  readBackupFile: (format) =>
    requireAppBinding('ReadBackupFile')(format),
  selectFile: (title) =>
    requireAppBinding('SelectFile')(title),

  async loadHostVault() {
    try {
      const payload = await callApp(['ListHostVault', 'ListHostsAndGroups']);
      return normalizeVaultPayload(payload);
    } catch (directError) {
      if (!/缺少後端 API/.test(String(directError?.message || directError))) {
        throw directError;
      }

      const [hosts, groups] = await Promise.all([
        callApp(['ListHosts']),
        callApp(['ListHostGroups', 'ListGroups'])
      ]);
      return normalizeVaultPayload({ hosts, groups });
    }
  },

  saveHost(hostProfile, secretsPayload = {}) {
    return callApp(['SaveHost'], hostProfile, secretsPayload);
  },

  deleteHost(hostId) {
    return callApp(['DeleteHost'], hostId);
  },

  saveGroup(group) {
    return callApp(['SaveHostGroup', 'SaveGroup'], group);
  },

  deleteGroup(groupId) {
    return callApp(['DeleteHostGroup', 'DeleteGroup'], groupId);
  },

  connectHost(hostId) {
    return callApp(['ConnectHost'], hostId);
  },

  testHostConnection(hostId) {
    return callApp(['TestHostConnection'], hostId);
  },

  getHostSecretStatus(hostId) {
    return callApp(['GetHostSecretStatus'], hostId);
  },

  getHostSecretValue(hostId, field) {
    return callApp(['GetHostSecretValue'], { hostId, field });
  },

  async listKnownHosts() {
    const raw = await callApp(['ListKnownHosts']);
    return Array.isArray(raw) ? raw : [];
  },

  removeKnownHost(host, port = 22) {
    return callApp(['RemoveKnownHost'], host, port);
  },

  exportHostsBackup(options) {
    return callApp(['ExportHostsBackup'], options);
  },

  importHostsBackup(filePath, options) {
    return callApp(['ImportHostsBackup'], filePath, options);
  },

  getAppSettings() {
    return callApp(['GetAppSettings']);
  },

  saveAppSettings(settings) {
    return callApp(['SaveAppSettings'], settings);
  },

  saveAWSIntegration(integration, secrets, previousGroupId = '') {
    return callApp(['SaveAWSIntegration'], integration, secrets, previousGroupId);
  },

  syncAWSIntegration(groupId) {
    return callApp(['SyncAWS', 'SyncAWSIntegration'], groupId);
  },

  getAWSIntegration(groupId) {
    return callApp(['GetAWSIntegration'], groupId);
  },
  deleteAWSIntegration(groupId) {
    return callApp(['DeleteAWSIntegration'], groupId);
  },
  listAWSIntegrations() {
    return callApp(['ListAWSIntegrations']);
  },

  saveGCPIntegration(integration, secrets, previousGroupId = '') {
    return callApp(['SaveGCPIntegration'], integration, secrets, previousGroupId);
  },

  syncGCPIntegration(groupId) {
    return callApp(['SyncGCP', 'SyncGCPIntegration'], groupId);
  },

  getGCPIntegration(groupId) {
    return callApp(['GetGCPIntegration'], groupId);
  },
  deleteGCPIntegration(groupId) {
    return callApp(['DeleteGCPIntegration'], groupId);
  },
  listGCPIntegrations() {
    return callApp(['ListGCPIntegrations']);
  }
};

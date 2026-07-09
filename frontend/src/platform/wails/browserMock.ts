import type {
  WailsAppBindings,
} from './contracts';
import type { OperationResult } from '../../domain';
import type { WailsEventCallback, WailsRuntime } from './types';
import { t } from '../../i18n/index.ts';

function operationResult(
  success: boolean,
  output = '',
  error = '',
): OperationResult {
  return {
    success,
    output,
    error,
    sessionKey: '',
    isSudo: false,
  };
}

function operationFailure(error = t('misc.wails.mockUnavailable')): OperationResult {
  return operationResult(false, '', error);
}

function createAppMock(): WailsAppBindings {
  return {
    StartLocalTerminal: async (shellPath: string) =>
      operationFailure(t('misc.wails.mockUnavailableShell', { shell: shellPath })),
    SelectFile: async () => '',
    ConnectTerminal: async () => operationFailure(),
    CancelConnectTerminal: async () => undefined,
    CloseTerminalSession: async () => undefined,
    ResizeTerminal: async () => operationResult(true),
    WriteTerminalInput: async () => undefined,
    ExecuteSessionCommand: async () => operationFailure(),
    ExecuteSessionCommandIsolated: async () => operationFailure(),
    GetAutocompleteSuggestions: async () => ({
      success: true,
      suggestions: [],
      lastWord: '',
      isPath: false,
    }),
    TestConnection: async () => operationFailure(),
    TestHostConnection: async () => operationFailure(),
    ConnectHost: async () => operationFailure(),
    ConnectHostTerminal: async () => operationFailure(),
    CancelConnectHost: async () => operationResult(true, 'canceled'),
    CancelConnectHostTerminal: async () => operationResult(true, 'canceled'),
    ListHosts: async () => operationResult(true, '[]'),
    ListGroups: async () => [],
    ListHostGroups: async () => operationResult(true, '[]'),
    ListHostVault: async () =>
      operationResult(true, JSON.stringify({ hosts: [], groups: [] })),
    SaveHost: async (hostProfile) =>
      operationResult(true, JSON.stringify(hostProfile)),
    DeleteHost: async () => operationResult(true),
    SaveGroup: async (group: unknown) => group,
    SaveHostGroup: async (group) =>
      operationResult(true, JSON.stringify(group)),
    DeleteGroup: async () => null,
    DeleteHostGroup: async () => operationResult(true),
    GetHostSecretStatus: async (hostId) =>
      operationResult(
        true,
        JSON.stringify({
          hostId,
          sshPassword: {
            ref: '',
            configured: false,
            stored: false,
            length: 0,
          },
          keyPassphrase: {
            ref: '',
            configured: false,
            stored: false,
            length: 0,
          },
          sudoPassword: {
            ref: '',
            configured: false,
            stored: false,
            length: 0,
          },
          overallHealthy: true,
        }),
      ),
    GetHostSecretValue: async (request) =>
      operationResult(
        true,
        JSON.stringify({
          hostId: request.hostId,
          field: request.field,
          value: '',
          found: false,
        }),
      ),
    GetAppSettings: async () =>
      operationResult(
        true,
        JSON.stringify({
          theme: 'dark',
          terminalTextSize: 12.5,
          localTerminalPath: '/bin/zsh',
        }),
      ),
    SaveAppSettings: async (settings) =>
      operationResult(true, JSON.stringify(settings)),
    ExportHostsBackup: async () => operationFailure(),
    ImportHostsBackup: async () => operationFailure(),
    ExecuteLocalCommand: async () => operationFailure(),
    ExecuteTerminalCommand: async () => operationFailure(),
    SaveJSONFile: async () => operationResult(true),
    SaveBackupFile: async () =>
      operationResult(true, '/tmp/mock-backup.json'),
    SaveKubernetesResourceYAML: async (filename: string) => `/tmp/${filename}`,
    SaveKubernetesPodLogs: async (filename: string) => `/tmp/${filename}`,
    StartKubernetesPodShell: async (request) => ({
      sessionId: 'mock-kubernetes-shell',
      namespace: request.namespace,
      podName: request.podName,
      container: request.container,
    }),
    WriteKubernetesPodShellInput: async () => undefined,
    ResizeKubernetesPodShell: async () => undefined,
    CloseKubernetesPodShell: async () => undefined,
    ReadBackupFile: async () => operationFailure(),
    SelectDirectory: async () => '',
    RemoveKnownHost: async () => operationFailure(),
    ConfirmUnknownHostKey: async () => operationFailure(),
    ListAWSIntegrations: async () => operationResult(true, '[]'),
    GetAWSIntegration: async () => operationFailure(),
    SaveAWSIntegration: async (integration) =>
      operationResult(true, JSON.stringify(integration)),
    DeleteAWSIntegration: async () => operationResult(true),
    SyncAWS: async () => operationResult(true),
    ListGCPIntegrations: async () => operationResult(true, '[]'),
    GetGCPIntegration: async () => operationFailure(),
    SaveGCPIntegration: async (integration) =>
      operationResult(true, JSON.stringify(integration)),
    DeleteGCPIntegration: async () => operationResult(true),
    SyncGCP: async () => operationResult(true),
    CheckForUpdate: async () => ({
      currentVersion: 'dev',
      latestVersion: '',
      releaseUrl: '',
      hasUpdate: false,
    }),
    DownloadUpdate: async () => ({
      success: false,
      filePath: '',
      error: 'unavailable in browser',
    }),
  };
}

function createRuntimeMock(): WailsRuntime {
  const listeners = new Map<string, Set<WailsEventCallback>>();

  const removeEvents = (eventNames: string[]) => {
    eventNames.forEach((eventName) => listeners.delete(eventName));
  };

  const onMultiple = (
    eventName: string,
    callback: WailsEventCallback,
    maxCallbacks: number,
  ) => {
    let invocationCount = 0;
    const wrappedCallback: WailsEventCallback = (...data) => {
      invocationCount += 1;
      callback(...data);
      if (maxCallbacks > 0 && invocationCount >= maxCallbacks) {
        listeners.get(eventName)?.delete(wrappedCallback);
      }
    };

    const eventListeners = listeners.get(eventName) ?? new Set();
    eventListeners.add(wrappedCallback);
    listeners.set(eventName, eventListeners);

    return () => eventListeners.delete(wrappedCallback);
  };

  return {
    EventsEmit(eventName, ...data) {
      listeners.get(eventName)?.forEach((callback) => callback(...data));
    },
    EventsOn(eventName, callback) {
      return onMultiple(eventName, callback, -1);
    },
    EventsOnMultiple: onMultiple,
    EventsOnce(eventName, callback) {
      return onMultiple(eventName, callback, 1);
    },
    EventsOff(eventName, ...additionalEventNames) {
      removeEvents([eventName, ...additionalEventNames]);
    },
    EventsOffAll() {
      listeners.clear();
    },
  };
}

export function installBrowserWailsMock(): boolean {
  if (typeof window === 'undefined' || window.go?.app?.App) {
    return false;
  }

  console.warn(
    '[TermiX Mock] 目前為非 Wails 瀏覽器環境，已啟用 Go bindings 與 runtime events 模擬層。',
  );

  window.go = { app: { App: createAppMock() } };
  window.runtime ??= createRuntimeMock();
  return true;
}

import type {
  AWSIntegration,
  AWSIntegrationSecretsInput,
  GCPIntegration,
  GCPIntegrationSecretsInput,
  AppSettings,
  AutocompleteResult,
  HostConnectionRequest,
  HostGroup,
  HostProfile,
  HostSecretValueRequest,
  HostSecretsInput,
  HostTransferOptions,
  KubernetesClusterProfile,
  KubernetesConnectRequest,
  KubernetesContextSwitchRequest,
  KubernetesDashboardRequest,
  KubernetesDashboardSnapshot,
  KubernetesPodDeleteRequest,
  KubernetesPodLogs,
  KubernetesPodLogsRequest,
  KubernetesPodPortForward,
  KubernetesPodPortForwardListRequest,
  KubernetesPodPortForwardRequest,
  KubernetesPodPortForwardStopRequest,
  KubernetesServicePortForwardListRequest,
  KubernetesServicePortForwardRequest,
  KubernetesPodShellSession,
  KubernetesPodShellSessionRequest,
  KubernetesPodShellStartRequest,
  KubernetesResourceCreateRequest,
  KubernetesResourceCreateResult,
  KubernetesResourceDeleteRequest,
  KubernetesResourceDetail,
  KubernetesResourceDetailRequest,
  KubernetesResourceEvents,
  KubernetesResourceEventsRequest,
  KubernetesResourceScaleRequest,
  KubernetesResourceUpdateRequest,
  KubernetesResourceUpdateResult,
  KubernetesSecretValue,
  KubernetesSecretValueRequest,
  KubernetesSession,
  OperationResult,
  SSHConfig,
  UpdateInfo,
  DownloadResult,
} from '../../domain';

export interface WailsAppContract {
  StartLocalTerminal(shellPath: string): Promise<OperationResult>;
  ConnectTerminal(config: SSHConfig): Promise<OperationResult>;
  ConnectHost(hostId: string): Promise<OperationResult>;
  ConnectHostTerminal(request: HostConnectionRequest): Promise<OperationResult>;
  CancelConnectTerminal(config: SSHConfig): Promise<void>;
  CancelConnectHost(hostId: string): Promise<OperationResult>;
  CancelConnectHostTerminal(
    request: HostConnectionRequest,
  ): Promise<OperationResult>;
  CloseTerminalSession(sessionKey: string): Promise<void>;
  ResizeTerminal(
    sessionKey: string,
    cols: number,
    rows: number,
  ): Promise<OperationResult>;
  WriteTerminalInput(sessionKey: string, data: string): Promise<void>;
  ExecuteSessionCommand(
    sessionKey: string,
    command: string,
  ): Promise<OperationResult>;
  ExecuteSessionCommandIsolated(
    sessionKey: string,
    command: string,
  ): Promise<OperationResult>;
  TestConnection(config: SSHConfig): Promise<OperationResult>;
  TestHostConnection(hostId: string): Promise<OperationResult>;
  GetAutocompleteSuggestions(
    sessionKey: string,
    prefix: string,
  ): Promise<AutocompleteResult>;

  ListHostVault(): Promise<OperationResult>;
  ListHosts(): Promise<OperationResult>;
  ListHostGroups(): Promise<OperationResult>;
  SaveHost(
    host: HostProfile,
    secrets: HostSecretsInput,
  ): Promise<OperationResult>;
  DeleteHost(hostId: string): Promise<OperationResult>;
  SaveHostGroup(group: HostGroup): Promise<OperationResult>;
  DeleteHostGroup(groupId: string): Promise<OperationResult>;
  GetHostSecretStatus(hostId: string): Promise<OperationResult>;
  GetHostSecretValue(
    request: HostSecretValueRequest,
  ): Promise<OperationResult>;
  ExportHostsBackup(options: HostTransferOptions): Promise<OperationResult>;
  ImportHostsBackup(
    filePath: string,
    options: HostTransferOptions,
  ): Promise<OperationResult>;
  GetAppSettings(): Promise<OperationResult>;
  SaveAppSettings(settings: AppSettings): Promise<OperationResult>;
  SelectFile(title: string): Promise<string>;
  SaveJSONFile(filename: string, data: string): Promise<OperationResult>;
  SaveBackupFile(
    filename: string,
    data: string,
    format: string,
  ): Promise<OperationResult>;
  ReadBackupFile(format: string): Promise<OperationResult>;
  RemoveKnownHost(host: string, port: number): Promise<OperationResult>;
  ConfirmUnknownHostKey(host: string, port: number): Promise<OperationResult>;
  ExecuteLocalCommand(
    command: string,
    environment: Record<string, string>,
  ): Promise<OperationResult>;
  ListAWSIntegrations(): Promise<OperationResult>;
  GetAWSIntegration(groupId: string): Promise<OperationResult>;
  SaveAWSIntegration(
    integration: AWSIntegration,
    secrets: AWSIntegrationSecretsInput,
    previousGroupId: string,
  ): Promise<OperationResult>;
  DeleteAWSIntegration(groupId: string): Promise<OperationResult>;
  SyncAWS(groupId: string): Promise<OperationResult>;

  ListGCPIntegrations(): Promise<OperationResult>;
  GetGCPIntegration(groupId: string): Promise<OperationResult>;
  SaveGCPIntegration(
    integration: GCPIntegration,
    secrets: GCPIntegrationSecretsInput,
    previousGroupId: string,
  ): Promise<OperationResult>;
  DeleteGCPIntegration(groupId: string): Promise<OperationResult>;
  SyncGCP(groupId: string): Promise<OperationResult>;

  ListKubernetesClusters(): Promise<KubernetesClusterProfile[]>;
  SaveKubernetesCluster(
    profile: KubernetesClusterProfile,
  ): Promise<KubernetesClusterProfile>;
  DeleteKubernetesCluster(id: string): Promise<void>;
  SwitchKubernetesContext(
    request: KubernetesContextSwitchRequest,
  ): Promise<void>;
  ConnectKubernetesCluster(
    request: KubernetesConnectRequest,
  ): Promise<KubernetesSession>;
  DisconnectKubernetesCluster(): Promise<void>;
  GetActiveKubernetesSession(): Promise<KubernetesSession>;
  GetKubernetesDashboard(
    request: KubernetesDashboardRequest,
  ): Promise<KubernetesDashboardSnapshot>;
  GetKubernetesNamespaces(): Promise<string[]>;
  GetKubernetesResourceDetail(
    request: KubernetesResourceDetailRequest,
  ): Promise<KubernetesResourceDetail>;
  GetKubernetesResourceEvents(
    request: KubernetesResourceEventsRequest,
  ): Promise<KubernetesResourceEvents>;
  GetKubernetesSecretValue(
    request: KubernetesSecretValueRequest,
  ): Promise<KubernetesSecretValue>;
  GetKubernetesPodLogs(
    request: KubernetesPodLogsRequest,
  ): Promise<KubernetesPodLogs>;
  StartKubernetesPodShell(
    request: KubernetesPodShellStartRequest,
  ): Promise<KubernetesPodShellSession>;
  WriteKubernetesPodShellInput(
    request: KubernetesPodShellSessionRequest,
  ): Promise<void>;
  ResizeKubernetesPodShell(
    request: KubernetesPodShellSessionRequest,
  ): Promise<void>;
  CloseKubernetesPodShell(sessionId: string): Promise<void>;
  DeleteKubernetesPod(request: KubernetesPodDeleteRequest): Promise<void>;
  DeleteKubernetesResource(
    request: KubernetesResourceDeleteRequest,
  ): Promise<void>;
  UpdateKubernetesResource(
    request: KubernetesResourceUpdateRequest,
  ): Promise<KubernetesResourceUpdateResult>;
  ScaleKubernetesResource(
    request: KubernetesResourceScaleRequest,
  ): Promise<void>;
  StartKubernetesPodPortForward(
    request: KubernetesPodPortForwardRequest,
  ): Promise<KubernetesPodPortForward>;
  ListKubernetesPodPortForwards(
    request: KubernetesPodPortForwardListRequest,
  ): Promise<KubernetesPodPortForward[]>;
  StopKubernetesPodPortForward(
    request: KubernetesPodPortForwardStopRequest,
  ): Promise<void>;
  StartKubernetesServicePortForward(
    request: KubernetesServicePortForwardRequest,
  ): Promise<KubernetesPodPortForward>;
  ListKubernetesServicePortForwards(
    request: KubernetesServicePortForwardListRequest,
  ): Promise<KubernetesPodPortForward[]>;
  CreateKubernetesResource(
    request: KubernetesResourceCreateRequest,
  ): Promise<KubernetesResourceCreateResult>;
  SaveKubernetesResourceYAML(
    defaultFilename: string,
    content: string,
  ): Promise<string>;
  SaveKubernetesPodLogs(
    defaultFilename: string,
    content: string,
  ): Promise<string>;

  CheckForUpdate(): Promise<UpdateInfo>;

  DownloadUpdate(): Promise<DownloadResult>;
}

export type WailsAppMethodName = keyof WailsAppContract;
export type WailsAppMethod = WailsAppContract[WailsAppMethodName];
export type WailsAppBindings = Partial<WailsAppContract> &
  Record<string, (...args: any[]) => any>;

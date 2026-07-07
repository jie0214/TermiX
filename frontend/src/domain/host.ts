import type { AppSettings } from './settings';

export type HostAuthMode = 'password' | 'privateKey' | 'certificate' | string;
export type SecretField = 'sshPassword' | 'keyPassphrase' | 'sudoPassword';
export type SecretAction = 'preserve' | 'set' | 'clear';

export interface HostSecretRefs {
  sshPasswordRef: string;
  keyPassphraseRef: string;
  sudoPasswordRef: string;
}

export interface HostCustomComponent {
  id: string;
  visible: boolean;
  order: number;
}

export interface PersistedHostConfig {
  host: string;
  port: number;
  username: string;
  authMode: HostAuthMode;
  privateKeyPath: string;
  certPath: string;
  secretRefs: HostSecretRefs;
  showSnippetsInControlPanel: boolean;
  startupSnippetIds: string[];
  startupCommandMode: string;
  startupCommandText: string;
  customComponents: HostCustomComponent[];
  enableCustomQuery: boolean;
  customQueryScript: string;
}

export interface HostProfile {
  id: string;
  label: string;
  alias: string;
  groupId: string;
  awsInstanceId: string;
  gcpInstanceId: string;
  config: PersistedHostConfig;
  createdAt: string;
  updatedAt: string;
}

export interface HostGroup {
  id: string;
  name: string;
  parentId: string;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface SecretValueInput {
  ref: string;
  value: string;
  hasValue: boolean;
  clear: boolean;
}

export interface HostSecretsInput {
  sshPassword: SecretValueInput;
  keyPassphrase: SecretValueInput;
  sudoPassword: SecretValueInput;
}

export interface SecretStatusEntry {
  ref: string;
  configured: boolean;
  stored: boolean;
  length: number;
}

export interface HostSecretStatus {
  hostId: string;
  sshPassword: SecretStatusEntry;
  keyPassphrase: SecretStatusEntry;
  sudoPassword: SecretStatusEntry;
  overallHealthy: boolean;
}

export interface HostSecretValueRequest {
  hostId: string;
  field: SecretField;
}

export interface HostSecretValue {
  hostId: string;
  field: SecretField;
  value: string;
  found: boolean;
}

export interface HostVaultSnapshot {
  hosts: HostProfile[];
  groups: HostGroup[];
  settings: Partial<AppSettings>;
}

export interface HostConnectionRequest {
  hostId: string;
  sessionId: string;
}

export interface HostTransferOptions {
  format: string;
  mode: string;
}

export interface AWSIntegration {
  groupId: string;
  name: string;
  region: string;
  accessKeyId: string;
  secretAccessKeyRef: string;
  defaultPasswordRef: string;
  importSource: string;
  ipAddressType: string;
  defaultPort: number;
  defaultUsername: string;
  authMode: string;
  privateKeyPath: string;
  certPath: string;
  lastSyncAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface AWSIntegrationSecretsInput {
  secretAccessKey: SecretValueInput;
  defaultPassword: SecretValueInput;
}

export interface GCPIntegration {
  groupId: string;
  name: string;
  projectId: string;
  serviceAccountJsonRef: string;
  defaultPasswordRef: string;
  ipAddressType: string;
  defaultPort: number;
  defaultUsername: string;
  authMode: string;
  privateKeyPath: string;
  certPath: string;
  lastSyncAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface GCPIntegrationSecretsInput {
  serviceAccountJson: SecretValueInput;
  defaultPassword: SecretValueInput;
}

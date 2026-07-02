import type { OperationResult } from './common';

export interface SSHConfig {
  host: string;
  port: number;
  username: string;
  authMode: string;
  password: string;
  privateKeyPath: string;
  certPath: string;
  sudoPassword: string;
  sessionId: string;
  enableCustomQuery: boolean;
  customQueryScript: string;
}

export interface TerminalConnectionTarget {
  hostId?: string;
  config?: Partial<SSHConfig>;
}

export interface TerminalCommandRequest {
  ssh: SSHConfig;
  command: string;
}

export interface AutocompleteResult {
  success: boolean;
  suggestions: string[];
  lastWord: string;
  isPath: boolean;
}

export interface TerminalSession {
  sessionKey: string;
  title: string;
  hostId: string;
  isLocal: boolean;
  connected: boolean;
  operation?: OperationResult;
}

export interface TerminalPane {
  id: string;
  sessionKey: string;
}

export interface TerminalColumn {
  id: string;
  panes: TerminalPane[];
}

export interface TerminalWorkspace {
  id: string;
  title: string;
  columns: TerminalColumn[];
  activeSessionKey: string;
}


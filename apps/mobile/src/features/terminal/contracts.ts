import type { Credentials } from '../hosts/credentials.ts';
import type { Host } from '../hosts/repository.ts';

export interface SSHCredentials {
  getCredentials(id: string, expected?: Host): Promise<Credentials | null>;
  updatePrivateKeyPassphrase(id: string, passphrase: string, expected?: Host): Promise<void>;
}
export interface HostKey {
  key: string;
  fingerprint: string;
  algorithm: string;
}
export type SSHEvent = ({ type: 'hostKey' } & HostKey) | { type: 'connected' | 'closed' } |
  { type: 'data'; data: string } | { type: 'error'; code: string };
export interface SSHConfig {
  id: string; address: string; port: number; username: string; credentials: Credentials;
  expectedKey: string; cols: number; rows: number;
}
export interface SSHTransport {
  start(config: SSHConfig): Promise<void>;
  poll(id: string): Promise<SSHEvent[]>;
  trust(id: string, accept: boolean): Promise<void>;
  write(id: string, data: string): Promise<void>;
  resize(id: string, cols: number, rows: number): Promise<void>;
  disconnect(id: string): Promise<void>;
}
export interface KnownHosts {
  get(host: Host): Promise<string>;
  save(host: Host, key: string): Promise<void>;
}
export interface TerminalState {
  status: 'idle' | 'connecting' | 'trust' | 'connected' | 'closing' | 'closed' | 'error';
  sessionId: string;
  host?: Host;
  challenge?: HostKey;
  message: string;
  errorCode?: string;
}

import { randomUUID } from 'expo-crypto';
import { TerminalSession } from '../features/terminal/session';
import { nativeTransport } from '../features/terminal/nativeTransport';
import { hostRepository } from './hosts';
import { knownHosts } from './knownHosts';

export const terminalSession = new TerminalSession(nativeTransport, hostRepository, knownHosts, randomUUID);

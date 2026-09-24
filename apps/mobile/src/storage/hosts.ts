import Storage from 'expo-sqlite/kv-store';
import { randomUUID } from 'expo-crypto';
import { HostRepository } from '../features/hosts/repository';
import { credentialStore } from './credentials';

export const hostRepository = new HostRepository(Storage, randomUUID, credentialStore);

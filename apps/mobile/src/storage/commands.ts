import { randomUUID } from 'expo-crypto';
import { CommandRepository } from '../features/commands/repository';
import { credentialStore } from './credentials';

export const commandRepository = new CommandRepository(credentialStore, randomUUID);
